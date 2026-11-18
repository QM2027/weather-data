// One-off check: can GitHub Actions (overseas IPs) reach the data.go.kr APIs with our key?
// Calls each approved service once and writes site/probe.json with status codes, data.go.kr
// result codes and a short response sample. The key never appears in the output.

import { mkdir, writeFile } from "node:fs/promises";

const ICC = { lat: 33.2416, lng: 126.4235 };

// The portal shows an "Encoding" and a "Decoding" key; accept either.
const raw = (process.env.DATA_GO_KR_KEY || "").trim();
const KEY = /%[0-9A-F]{2}/i.test(raw) ? decodeURIComponent(raw) : raw;

/** KMA forecast grid (Lambert conformal conic) for a lat/lng. */
function kmaGrid({ lat, lng }) {
  const RE = 6371.00877 / 5.0, DEG = Math.PI / 180;
  const s1 = 30 * DEG, s2 = 60 * DEG, olon = 126 * DEG, olat = 38 * DEG;
  let sn = Math.tan(Math.PI / 4 + s2 / 2) / Math.tan(Math.PI / 4 + s1 / 2);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI / 4 + s1 / 2);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + olat / 2), sn);
  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + lat * DEG / 2), sn);
  let theta = lng * DEG - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}

// Korea time parts, shifted back by `hours`.
function kst(hours = 0) {
  const d = new Date(Date.now() + (9 - hours) * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`, hour: d.getUTCHours(), p };
}

const { nx, ny } = kmaGrid(ICC);
const now1 = kst(1); // last full hour is published at :40, so one hour back is safe
const vil = (() => {
  // Short-range forecast issues at 02, 05, …, 23 (available ~10 min after); take the last one.
  const t = kst(1);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23].filter((h) => h <= t.hour);
  if (slots.length) return { date: t.date, time: `${t.p(slots.at(-1))}00` };
  const y = kst(t.hour + 2);
  return { date: y.date, time: "2300" };
})();
const mid = (() => {
  // Mid-range forecast issues at 06 and 18.
  const t = kst(1);
  if (t.hour >= 18) return `${t.date}1800`;
  if (t.hour >= 6) return `${t.date}0600`;
  return `${kst(t.hour + 2).date}1800`;
})();
const today = kst().date;
const weekAgo = kst(24 * 7).date;

const KMA = "https://apis.data.go.kr/1360000";
const TOUR = "https://apis.data.go.kr/B551011";
const tourCommon = { MobileOS: "ETC", MobileApp: "QM2027", _type: "json", numOfRows: 3, pageNo: 1 };

const CALLS = [
  { name: "KMA ultra-short nowcast", base: `${KMA}/VilageFcstInfoService_2.0/getUltraSrtNcst`, q: { dataType: "JSON", numOfRows: 10, pageNo: 1, base_date: now1.date, base_time: `${now1.p(now1.hour)}00`, nx, ny } },
  { name: "KMA short-range forecast", base: `${KMA}/VilageFcstInfoService_2.0/getVilageFcst`, q: { dataType: "JSON", numOfRows: 12, pageNo: 1, base_date: vil.date, base_time: vil.time, nx, ny } },
  { name: "KMA mid-range land (Jeju)", base: `${KMA}/MidFcstInfoService/getMidLandFcst`, q: { dataType: "JSON", numOfRows: 10, pageNo: 1, regId: "11G00000", tmFc: mid } },
  { name: "KMA mid-range temperature (Seogwipo)", base: `${KMA}/MidFcstInfoService/getMidTa`, q: { dataType: "JSON", numOfRows: 10, pageNo: 1, regId: "11G00401", tmFc: mid } },
  { name: "KMA warnings list (Jeju)", base: `${KMA}/WthrWrnInfoService/getWthrWrnList`, q: { dataType: "JSON", numOfRows: 10, pageNo: 1, stnId: 184, fromTmFc: weekAgo, toTmFc: today } },
  { name: "KMA warnings in force", base: `${KMA}/WthrWrnInfoService/getPwnStatus`, q: { dataType: "JSON", numOfRows: 10, pageNo: 1 } },
  { name: "AirKorea Jeju stations", base: "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty", q: { returnType: "json", numOfRows: 100, pageNo: 1, sidoName: "제주", ver: "1.0" }, sample: 1500 },
  // TourAPI was re-versioned in 2025 (…Service2 / …2); try both so we know which one the key opens.
  { name: "TourAPI English v2 area list", base: `${TOUR}/EngService2/areaBasedList2`, q: tourCommon },
  { name: "TourAPI English v1 area list", base: `${TOUR}/EngService1/areaBasedList1`, q: { ...tourCommon, areaCode: 39 } },
  { name: "Tour photo gallery search", base: `${TOUR}/PhotoGalleryService1/gallerySearchList1`, q: { ...tourCommon, keyword: "제주" } },
];

const redact = (s) => (KEY ? s.split(KEY).join("***").split(encodeURIComponent(KEY)).join("***") : s);

/** data.go.kr reports errors in several shapes: JSON header, XML header, or the gateway's XML. */
function resultOf(body) {
  try {
    const j = JSON.parse(body);
    const h = j?.response?.header ?? j?.header;
    if (h) return { resultCode: h.resultCode, resultMsg: h.resultMsg };
  } catch {}
  const tag = (t) => body.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
  const code = tag("resultCode") ?? tag("returnReasonCode");
  return code ? { resultCode: code, resultMsg: tag("resultMsg") ?? tag("returnAuthMsg") ?? tag("errMsg") } : {};
}

async function call({ name, base, q, sample = 500 }) {
  const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
  const url = `${base}?serviceKey=${encodeURIComponent(KEY)}&${qs}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    return {
      name, endpoint: `${base}?${qs}`, status: res.status, ms: Date.now() - started,
      contentType: res.headers.get("content-type"), ...resultOf(body), sample: redact(body.slice(0, sample)),
    };
  } catch (e) {
    return { name, endpoint: `${base}?${qs}`, error: redact(String(e?.cause?.code ?? e?.message ?? e)), ms: Date.now() - started };
  }
}

const out = { checkedAt: new Date().toISOString(), runner: process.env.RUNNER_NAME ?? null, keySet: Boolean(KEY), grid: { nx, ny } };
if (KEY) out.results = await Promise.all(CALLS.map(call));
else out.error = "DATA_GO_KR_KEY is not set for this repository";

// Where the runner appears to be, to read any blocks in context.
try {
  const ip = await (await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5000) })).json();
  out.runnerLocation = { country: ip.country, region: ip.region, org: ip.org };
} catch {}

await mkdir("site", { recursive: true });
await writeFile("site/probe.json", JSON.stringify(out, null, 2));
for (const r of out.results ?? []) console.log(`${r.status ?? r.error}\t${r.resultCode ?? ""}\t${r.name}`);
if (out.error) console.log(out.error);
