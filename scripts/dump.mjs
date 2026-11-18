// Temporary: save full raw responses (key redacted) to site/raw/ for building parsers and test fixtures.
import { mkdir, writeFile } from "node:fs/promises";

const raw = (process.env.DATA_GO_KR_KEY || "").trim();
const KEY = /%[0-9A-F]{2}/i.test(raw) ? decodeURIComponent(raw) : raw;
const redact = (s) => (KEY ? s.split(KEY).join("***").split(encodeURIComponent(KEY)).join("***") : s);

function kst(hours = 0) {
  const d = new Date(Date.now() + (9 - hours) * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`, hour: d.getUTCHours(), min: d.getUTCMinutes(), p };
}
const nx = 51, ny = 32;
const h1 = kst(1);
const t = kst(0);
const fc = t.min >= 45 ? kst(0) : kst(1);
const vil = (() => {
  const x = kst(0.25);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23].filter((h) => h <= x.hour);
  return slots.length ? { date: x.date, time: `${x.p(slots.at(-1))}00` } : { date: kst(x.hour + 1).date, time: "2300" };
})();
const midTm = (() => {
  const x = kst(0.25);
  if (x.hour >= 18) return `${x.date}1800`;
  if (x.hour >= 6) return `${x.date}0600`;
  return `${kst(x.hour + 1).date}1800`;
})();
const K = "https://apis.data.go.kr/1360000";
const J = { dataType: "JSON", pageNo: 1 };
const CALLS = {
  ncst: [`${K}/VilageFcstInfoService_2.0/getUltraSrtNcst`, { ...J, numOfRows: 100, base_date: h1.date, base_time: `${h1.p(h1.hour)}00`, nx, ny }],
  ufcst: [`${K}/VilageFcstInfoService_2.0/getUltraSrtFcst`, { ...J, numOfRows: 100, base_date: fc.date, base_time: `${fc.p(fc.hour)}30`, nx, ny }],
  vil: [`${K}/VilageFcstInfoService_2.0/getVilageFcst`, { ...J, numOfRows: 1000, base_date: vil.date, base_time: vil.time, nx, ny }],
  vil0200: [`${K}/VilageFcstInfoService_2.0/getVilageFcst`, { ...J, numOfRows: 1000, base_date: t.date, base_time: "0200", nx, ny }],
  midland: [`${K}/MidFcstInfoService/getMidLandFcst`, { ...J, numOfRows: 10, regId: "11G00000", tmFc: midTm }],
  midta: [`${K}/MidFcstInfoService/getMidTa`, { ...J, numOfRows: 10, regId: "11G00401", tmFc: midTm }],
  pwnstatus: [`${K}/WthrWrnInfoService/getPwnStatus`, { ...J, numOfRows: 10 }],
  pwncd: [`${K}/WthrWrnInfoService/getPwnCd`, { ...J, numOfRows: 1000 }],
  wrnlist: [`${K}/WthrWrnInfoService/getWthrWrnList`, { ...J, numOfRows: 100, stnId: 184, fromTmFc: kst(24 * 5).date, toTmFc: t.date }],
  wrnlistAll: [`${K}/WthrWrnInfoService/getWthrWrnList`, { ...J, numOfRows: 100, fromTmFc: kst(24 * 5).date, toTmFc: t.date }],
  pwnlist: [`${K}/WthrWrnInfoService/getWthrPwnList`, { ...J, numOfRows: 100, stnId: 184, fromTmFc: kst(24 * 5).date, toTmFc: t.date }],
  wrnmsg: [`${K}/WthrWrnInfoService/getWthrWrnMsg`, { ...J, numOfRows: 10, stnId: 184, fromTmFc: kst(24 * 5).date, toTmFc: t.date }],
  air: ["https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty", { returnType: "json", numOfRows: 100, pageNo: 1, sidoName: "제주", ver: "1.0" }],
  airStations: ["https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList", { returnType: "json", numOfRows: 100, pageNo: 1, addr: "제주" }],
};

await mkdir("site/raw", { recursive: true });
const index = {};
await Promise.all(Object.entries(CALLS).map(async ([name, [base, q]]) => {
  const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
  try {
    const res = await fetch(`${base}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(30000) });
    const body = redact(await res.text());
    await writeFile(`site/raw/${name}.txt`, body);
    index[name] = { status: res.status, endpoint: `${base}?${qs}`, bytes: body.length };
  } catch (e) {
    index[name] = { endpoint: `${base}?${qs}`, error: redact(String(e?.cause?.code ?? e?.message ?? e)) };
  }
}));
index.ranAt = new Date().toISOString();
await writeFile("site/raw/index.json", JSON.stringify(index, null, 2));
console.log(JSON.stringify(index, null, 2));
