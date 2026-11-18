#!/usr/bin/env node
// Fetch the venue weather from data.go.kr into site/weather.json, which the publish workflow
// deploys to https://qm2027.github.io/weather-data/weather.json.
//
//   DATA_GO_KR_KEY=… node scripts/sync.mjs
//
// Sources: KMA short-range (nowcast, ultra-short and village forecasts) and mid-range forecasts,
// KMA weather warnings in force and preliminary, and AirKorea's hourly PM10/PM2.5. Each of the
// three sections (forecast, warnings, air) is fetched on its own; one that fails keeps the
// published version (PREVIOUS_URL) and is listed under `errors`. This never fails the run.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  ICC,
  ApiError,
  assemble,
  buildCurrent,
  buildDaily,
  itemsOf,
  kmaGrid,
  kmaIso,
  kstDate,
  kstParts,
  midBases,
  midDays,
  nowcastBases,
  parseWarnings,
  pickAir,
  shortDays,
  ultraBases,
  vilageBases,
} from "./lib.mjs";

const OUT = "site";
const PREVIOUS_URL = process.env.PREVIOUS_URL?.replace(/\/$/, "");
// The portal shows an "Encoding" and a "Decoding" key; accept either.
const rawKey = (process.env.DATA_GO_KR_KEY || "").trim();
const KEY = /%[0-9A-F]{2}/i.test(rawKey) ? decodeURIComponent(rawKey) : rawKey;
const redact = (s) => (KEY ? String(s).split(KEY).join("***").split(encodeURIComponent(KEY)).join("***") : String(s));
const warn = (msg) => console.warn(`::warning::sync: ${redact(msg)}`);

const KMA = "https://apis.data.go.kr/1360000";
const AIR = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
const { nx, ny } = kmaGrid(ICC);

/** One data.go.kr call → items. Retries once on a network error. */
async function call(url, params) {
  if (!KEY) throw new Error("DATA_GO_KR_KEY is not set");
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${url}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(25_000) });
      const body = await res.text();
      if (!res.ok && !body.trim().startsWith("{") && !body.includes("<")) throw new Error(`HTTP ${res.status}`);
      return itemsOf(body);
    } catch (e) {
      if (e instanceof ApiError || attempt >= 1) throw new Error(`${url.split("/").pop()}: ${redact(e.message)}`, { cause: e });
    }
  }
}

/** Try bases newest first, moving on while a base has no data yet. */
async function newest(bases, fetchOne) {
  let last;
  for (const base of bases) {
    try {
      const items = await fetchOne(base);
      if (items.length) return { base, items };
      last = new Error(`no data for ${JSON.stringify(base)}`);
    } catch (e) {
      last = e;
      if (e.cause?.code !== "03") throw e; // 03 = NO_DATA: this base isn't out yet
    }
  }
  throw last;
}

const kmaJson = (rows) => ({ dataType: "JSON", pageNo: 1, numOfRows: rows });

async function fetchForecast(now, notes) {
  const vilage = (b) => call(`${KMA}/VilageFcstInfoService_2.0/getVilageFcst`, { ...kmaJson(1000), base_date: b.date, base_time: b.time, nx, ny });
  const [ncst, ufcst, vil] = await Promise.all([
    newest(nowcastBases(now), (b) => call(`${KMA}/VilageFcstInfoService_2.0/getUltraSrtNcst`, { ...kmaJson(100), base_date: b.date, base_time: b.time, nx, ny })),
    newest(ultraBases(now), (b) => call(`${KMA}/VilageFcstInfoService_2.0/getUltraSrtFcst`, { ...kmaJson(100), base_date: b.date, base_time: b.time, nx, ny })),
    newest(vilageBases(now), vilage),
  ]);

  // Today's 02:00 issue covers the whole day (and its min/max); later issues only the hours left.
  const today = kstDate(now);
  let dayStart = [];
  if (vil.base.date === today && vil.base.time !== "0200") {
    try {
      dayStart = await vilage({ date: today, time: "0200" });
    } catch (e) {
      notes.push({ source: "forecast", message: `today's 02:00 forecast: ${e.message}` });
    }
  }

  let mid = new Map();
  try {
    const { base: tmFc, items } = await newest(midBases(now), async (tmFc) => {
      const [land, ta] = await Promise.all([
        call(`${KMA}/MidFcstInfoService/getMidLandFcst`, { ...kmaJson(10), regId: "11G00000", tmFc }), // Jeju
        call(`${KMA}/MidFcstInfoService/getMidTa`, { ...kmaJson(10), regId: "11G00401", tmFc }), // Seogwipo
      ]);
      return land.length && ta.length ? [land[0], ta[0]] : [];
    });
    mid = midDays(items[0], items[1], tmFc);
  } catch (e) {
    notes.push({ source: "forecast", message: `mid-range: ${e.message}` });
  }

  return {
    fetchedAt: now.toISOString(),
    issuedAt: kmaIso(`${vil.base.date}${vil.base.time}`),
    current: buildCurrent(ncst.items, ufcst.items),
    daily: buildDaily(today, shortDays([...dayStart, ...vil.items]), mid),
  };
}

async function fetchWarnings(now) {
  const [status] = await call(`${KMA}/WthrWrnInfoService/getPwnStatus`, kmaJson(10));
  if (!status) throw new Error("getPwnStatus: empty");
  return { fetchedAt: now.toISOString(), issuedAt: kmaIso(status.tmFc), items: parseWarnings(status) };
}

async function fetchAir(now) {
  const items = await call(AIR, { returnType: "json", pageNo: 1, numOfRows: 100, sidoName: "제주", ver: "1.3" });
  return { fetchedAt: now.toISOString(), ...pickAir(items) };
}

async function loadPrevious() {
  try {
    if (PREVIOUS_URL) {
      const res = await fetch(`${PREVIOUS_URL}/weather.json`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }
    return JSON.parse(await readFile(`${OUT}/weather.json`, "utf8"));
  } catch (e) {
    console.log(`sync: no previous weather.json (${e.message})`);
    return undefined;
  }
}

const now = new Date();
const previous = await loadPrevious();
const notes = [];
const fresh = {}, failures = {};
const jobs = { forecast: () => fetchForecast(now, notes), warnings: () => fetchWarnings(now), air: () => fetchAir(now) };
await Promise.all(
  Object.entries(jobs).map(async ([source, job]) => {
    try {
      fresh[source] = await job();
    } catch (e) {
      failures[source] = redact(e.message);
    }
  }),
);

const out = assemble({ generatedAt: now.toISOString(), fresh, failures, previous });
out.errors.push(...notes.map((n) => ({ ...n, message: redact(n.message) })));
for (const e of out.errors) warn(`${e.source}: ${e.message}`);

await mkdir(OUT, { recursive: true });
const text = redact(JSON.stringify(out, null, 1));
JSON.parse(text); // never publish something the site can't read
await writeFile(`${OUT}/weather.json`, text);

const f = out.forecast, p = kstParts(now);
console.log(`sync: ${p.y}-${p.m}-${p.d} ${p.h}:${String(p.min).padStart(2, "0")} KST`);
if (f) console.log(`sync: now ${f.current.temperature_2m}°C code ${f.current.weather_code} wind ${f.current.wind_speed_10m} m/s; days ${f.daily.time.join(" ")}`);
console.log(`sync: ${out.warnings?.items.length ?? "no"} Jeju warnings; air ${out.air ? `${out.air.station} PM10 ${out.air.pm10} PM2.5 ${out.air.pm25}` : "none"}`);
