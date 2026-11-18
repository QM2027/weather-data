// Fixtures in test/fixtures are real responses (key removed) from 2026-11-19 03:2x KST, when
// a strong-wind warning was in force for northern Jeju.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ICC, JEJU_LAND, airIso, amount, apparent, assemble, buildCurrent, buildDaily, itemsOf, jejuAreas, kmaGrid, kmaIso,
  midBases, midDays, nowcastBases, parseWarnings, pickAir, ptyCode, shortDays, splitTop, textCode, ultraBases, vilageBases,
} from "../scripts/lib.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
const items = (name) => itemsOf(fixture(name));
const kst = (s) => new Date(`${s}+09:00`);

test("ICC Jeju is grid 51,32", () => {
  assert.deepEqual(kmaGrid(ICC), { nx: 51, ny: 32 });
});

test("base times step back to ones already published", () => {
  const at = kst("2026-11-19T03:23:00");
  assert.deepEqual(nowcastBases(at)[0], { date: "20261119", time: "0200" });
  assert.deepEqual(ultraBases(at)[0], { date: "20261119", time: "0230" });
  assert.deepEqual(vilageBases(at), [{ date: "20261119", time: "0200" }, { date: "20261118", time: "2300" }, { date: "20261118", time: "2000" }]);
  assert.deepEqual(midBases(at), ["202611181800", "202611180600", "202611171800"]);
  assert.deepEqual(nowcastBases(kst("2026-11-19T03:50:00"))[0], { date: "20261119", time: "0300" });
  // Just after midnight, and just before an issue is out.
  assert.deepEqual(vilageBases(kst("2026-03-22T01:05:00"))[0], { date: "20260321", time: "2300" });
  assert.deepEqual(vilageBases(kst("2026-03-22T02:05:00"))[0], { date: "20260321", time: "2300" });
  assert.deepEqual(vilageBases(kst("2026-03-22T02:15:00"))[0], { date: "20260322", time: "0200" });
  assert.deepEqual(midBases(kst("2026-03-22T05:59:00"))[0], "202603211800");
  assert.deepEqual(midBases(kst("2026-03-22T06:20:00"))[0], "202603220600");
  assert.deepEqual(nowcastBases(kst("2026-03-22T00:10:00"))[0], { date: "20260321", time: "2300" });
});

test("timestamps become ISO in Korea time", () => {
  assert.equal(kmaIso(202611190130), "2026-11-19T01:30:00+09:00");
  assert.equal(airIso("2026-11-19 03:00"), "2026-11-19T03:00:00+09:00");
  assert.equal(airIso("2026-03-31 24:00"), "2026-04-01T00:00:00+09:00");
  assert.equal(airIso("-"), null);
});

test("precipitation text and codes", () => {
  assert.equal(amount("강수없음"), 0);
  assert.equal(amount("1mm 미만"), 0.5);
  assert.equal(amount("30.0~50.0mm"), 30);
  assert.equal(amount("50.0mm 이상"), 50);
  assert.equal(ptyCode(0), undefined);
  assert.equal(ptyCode(1, 0.5), 61);
  assert.equal(ptyCode(1, 5), 63);
  assert.equal(ptyCode(1, 12), 65);
  assert.equal(ptyCode(2), 66);
  assert.equal(ptyCode(3, 0, 2), 73);
  assert.equal(ptyCode(4, 1), 80);
  assert.equal(ptyCode(5), 51);
  assert.equal(ptyCode(0, 0, 0, true), 95);
  assert.equal(textCode("맑음"), 0);
  assert.equal(textCode("구름많음"), 2);
  assert.equal(textCode("흐림"), 3);
  assert.equal(textCode("구름많고 비"), 61);
  assert.equal(textCode("흐리고 비/눈"), 66);
  assert.equal(textCode("흐리고 눈"), 71);
  assert.equal(textCode("구름많고 소나기"), 80);
});

test("wind chill applies only when cold and windy", () => {
  assert.equal(apparent(9.2, 5.9), 6.2);
  assert.equal(apparent(15, 8), 15);
  assert.equal(apparent(5, 1), 5);
});

test("current conditions from the nowcast", () => {
  const c = buildCurrent(items("ncst"), items("ufcst"));
  assert.deepEqual(c, { temperature_2m: 9.2, apparent_temperature: 6.2, precipitation: 0, wind_speed_10m: 5.9, weather_code: 2, cloud_cover: 60 });
});

test("short-range days: hourly days have wind, the three-hourly day doesn't", () => {
  const days = shortDays(items("vil"));
  assert.deepEqual(days.get("20261119"), { slots: 21, weather_code: 61, temperature_2m_max: 13, temperature_2m_min: 9, precipitation_probability_max: 60, wind_speed_10m_max: 6.8 });
  assert.equal(days.get("20261120").wind_speed_10m_max, 7.2);
  assert.equal(days.get("20261122").slots, 8);
  assert.equal(days.get("20261122").wind_speed_10m_max, null);
  assert.equal(days.get("20261122").temperature_2m_max, 14);
  assert.equal(days.get("20261123").slots, 1);
});

test("later issues override earlier ones hour by hour", () => {
  const early = [{ fcstDate: "20261119", fcstTime: "0300", category: "TMP", fcstValue: "5" }, { fcstDate: "20261119", fcstTime: "1500", category: "TMP", fcstValue: "10" }];
  const late = [{ fcstDate: "20261119", fcstTime: "1500", category: "TMP", fcstValue: "12" }];
  const d = shortDays([...early, ...late]).get("20261119");
  assert.equal(d.temperature_2m_max, 12);
  assert.equal(d.temperature_2m_min, 5);
});

test("mid-range field N is N days after the issue date", () => {
  const [land] = items("midland"), [ta] = items("midta");
  const days = midDays(land, ta, 202611181800);
  assert.deepEqual([...days.keys()], ["20261123", "20261124", "20261125", "20261126", "20261127", "20261128"]);
  assert.deepEqual(days.get("20261123"), { weather_code: 3, temperature_2m_max: 17, temperature_2m_min: 8, precipitation_probability_max: 40, wind_speed_10m_max: null });
});

test("five days: short range first, mid range for the rest", () => {
  const [land] = items("midland"), [ta] = items("midta");
  const daily = buildDaily("20261119", shortDays(items("vil")), midDays(land, ta, 202611181800));
  assert.deepEqual(daily.time, ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
  assert.deepEqual(daily.temperature_2m_max, [13, 11, 12, 14, 17]);
  assert.deepEqual(daily.wind_speed_10m_max, [6.8, 7.2, 6.4, null, null]);
  for (const k of Object.keys(daily)) assert.equal(daily[k].length, 5, k);
});

test("area lists split at top-level commas", () => {
  assert.deepEqual(splitTop("서해5도, 강원도(태백, 동해산지), 제주도(제주시북부, 서귀포시남부 제외)"), ["서해5도", "강원도(태백, 동해산지)", "제주도(제주시북부, 서귀포시남부 제외)"]);
  assert.deepEqual(jejuAreas("제주도"), JEJU_LAND);
  assert.deepEqual(jejuAreas("제주도(서귀포시남부 제외)"), JEJU_LAND.filter((z) => z !== "서귀포시남부"));
  assert.deepEqual(jejuAreas("전라남도(흑산도.홍도), 제주도(제주시북부)"), ["제주시북부"]);
  assert.deepEqual(
    jejuAreas("남해서부서쪽먼바다, 제주도앞바다(제주도북부앞바다, 제주도동부앞바다), 제주도남쪽바깥먼바다"),
    ["제주도북부앞바다", "제주도동부앞바다", "제주도남쪽바깥먼바다"],
  );
  assert.deepEqual(jejuAreas("남해서부서쪽먼바다중 추자도연안바다, 제주도동부앞바다(북동연안바다, 우도연안바다)"), ["남해서부서쪽먼바다중 추자도연안바다", "제주도동부앞바다 북동연안바다", "제주도동부앞바다 우도연안바다"]);
  assert.deepEqual(jejuAreas("강원도(태백), 울릉도.독도"), []);
});

test("warnings in force for Jeju, from the live status", () => {
  const [status] = items("pwnstatus");
  const w = parseWarnings(status);
  const by = (labelKo) => w.find((x) => x.labelKo === labelKo);
  assert.deepEqual(w.map((x) => x.labelKo), ["강풍경보", "강풍주의보", "풍랑주의보", "대설주의보"]);
  assert.deepEqual(by("강풍경보"), { kind: "wind", level: "warning", preliminary: false, labelKo: "강풍경보", label: "Strong wind warning", areas: ["제주시북부"], affectsVenue: false });
  assert.deepEqual(by("강풍주의보").areas, JEJU_LAND.filter((z) => !["제주시북부", "서귀포시남부"].includes(z)));
  assert.equal(by("강풍주의보").affectsVenue, false);
  assert.equal(by("풍랑주의보").kind, "seas");
  assert.ok(by("풍랑주의보").areas.includes("제주도남서쪽안쪽먼바다"));
  assert.deepEqual(by("대설주의보").areas, ["제주도산지"]);
});

test("preliminary warnings, and the venue zone", () => {
  const msgs = items("wrnmsg");
  const w = parseWarnings(msgs.find((m) => m.tmSeq === 47));
  const pre = w.filter((x) => x.preliminary);
  assert.deepEqual(pre.map((x) => [x.kind, x.label, x.affectsVenue]), [["seas", "High seas advisory expected", false], ["wind", "Strong wind advisory expected", false]]);
  assert.deepEqual(pre[0].areas, ["제주도남동쪽안쪽먼바다", "제주도동부앞바다", "제주도서부앞바다", "제주도북부앞바다"]);
  const all = parseWarnings({ t6: "o 호우경보 : 제주도\r\no 한파주의보 : 강원도(태백)", t7: "o 없음" });
  assert.deepEqual(all.map((x) => [x.labelKo, x.affectsVenue]), [["호우경보", true]]);
});

test("air quality from the nearest station with a reading", () => {
  const list = items("air");
  assert.deepEqual(pickAir(list), { station: "강정동", dataTime: "2026-11-19T03:00:00+09:00", pm10: 4, pm25: 5, pm10Grade: 1, pm25Grade: 1 });
  const broken = list.map((i) => (i.stationName === "강정동" ? { ...i, pm10Value: "-", pm25Value: "-", pm10Grade: null, pm25Grade: null } : i));
  assert.equal(pickAir(broken).station, "동홍동");
  assert.throws(() => pickAir([]));
});

test("a failed section keeps the published one", () => {
  const previous = { forecast: { fetchedAt: "old" }, warnings: null, air: { fetchedAt: "old" } };
  const out = assemble({ generatedAt: "now", fresh: { warnings: { items: [] } }, failures: { forecast: "boom" }, previous });
  assert.deepEqual(out.forecast, { fetchedAt: "old" });
  assert.deepEqual(out.warnings, { items: [] });
  assert.deepEqual(out.air, { fetchedAt: "old" });
  assert.deepEqual(out.errors, [{ source: "forecast", message: "boom" }, { source: "air", message: "not fetched" }]);
  assert.equal(assemble({ generatedAt: "now", fresh: {}, failures: {}, previous: undefined }).forecast, null);
});

test("data.go.kr errors surface with their code", () => {
  assert.throws(() => itemsOf('{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}'), (e) => e.code === "03");
  assert.throws(() => itemsOf("<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"), (e) => e.code === "30");
});
