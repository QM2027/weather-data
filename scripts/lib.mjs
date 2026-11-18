// Pure helpers for sync.mjs: KMA / AirKorea responses → the published weather.json sections.
// Weather is reported in the Open-Meteo shape the site already uses (WMO weather codes, m/s),
// so the site can switch sources without touching its display code.

export const ICC = { lat: 33.2416, lng: 126.4235 };
export const ATTRIBUTION = "Korea Meteorological Administration (KMA); AirKorea, Korea Environment Corporation";

// ---------------------------------------------------------------- time (KST)

const pad = (n) => String(n).padStart(2, "0");

/** Calendar parts of an instant in Korea time. */
export function kstParts(at) {
  const d = new Date(at.getTime() + 9 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
/** "YYYYMMDD" in Korea time. */
export const kstDate = (at) => {
  const p = kstParts(at);
  return `${p.y}${pad(p.m)}${pad(p.d)}`;
};
/** "YYYYMMDD" → "YYYY-MM-DD". */
export const dashed = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
/** "YYYYMMDD" plus n days. */
export function addDays(ymd, n) {
  const t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n);
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
/** KMA "YYYYMMDDHHMM" (string or number) → ISO with +09:00. */
export function kmaIso(stamp) {
  const s = String(stamp);
  if (!/^\d{12}$/.test(s)) return null;
  return `${dashed(s.slice(0, 8))}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`;
}
/** AirKorea "YYYY-MM-DD HH:MM" (it writes midnight as 24:00 of the day before) → ISO with +09:00. */
export function airIso(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  let ymd = `${m[1]}${m[2]}${m[3]}`, h = +m[4];
  if (h === 24) {
    ymd = addDays(ymd, 1);
    h = 0;
  }
  return `${dashed(ymd)}T${pad(h)}:${m[5]}:00+09:00`;
}

/** An instant `hours` before `at`. */
const back = (at, hours) => new Date(at.getTime() - hours * 3600e3);

/** Ultra-short nowcast bases, newest first: HH00 appears around HH:40. */
export function nowcastBases(at) {
  return [0, 1, 2].map((k) => {
    const t = back(at, k + (kstParts(at).min < 40 ? 1 : 0));
    return { date: kstDate(t), time: `${pad(kstParts(t).h)}00` };
  });
}
/** Ultra-short forecast bases, newest first: HH30 appears around HH:45. */
export function ultraBases(at) {
  return [0, 1, 2].map((k) => {
    const t = back(at, k + (kstParts(at).min < 45 ? 1 : 0));
    return { date: kstDate(t), time: `${pad(kstParts(t).h)}30` };
  });
}
/** Short-range forecast bases, newest first: issued at 02, 05, …, 23 and available ~10 minutes later. */
export function vilageBases(at) {
  const out = [];
  let t = back(at, 1 / 6);
  while (out.length < 3) {
    const p = kstParts(t);
    const h = [23, 20, 17, 14, 11, 8, 5, 2].find((x) => x <= p.h);
    if (h === undefined) {
      t = back(t, p.h + 1); // before 02:00: the previous day's 23:00
      continue;
    }
    out.push({ date: kstDate(t), time: `${pad(h)}00` });
    t = back(t, p.h - h + 1);
  }
  return out;
}
/** Mid-range forecast issue times, newest first: 06:00 and 18:00, available a few minutes later. */
export function midBases(at) {
  const out = [];
  let t = back(at, 1 / 6);
  while (out.length < 3) {
    const p = kstParts(t);
    if (p.h >= 18) {
      out.push(`${kstDate(t)}1800`);
      t = back(t, p.h - 18 + 1);
    } else if (p.h >= 6) {
      out.push(`${kstDate(t)}0600`);
      t = back(t, p.h - 6 + 1);
    } else {
      t = back(t, p.h + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------- KMA grid

/** KMA 5 km forecast grid (Lambert conformal conic) for a lat/lng. */
export function kmaGrid({ lat, lng }) {
  const RE = 6371.00877 / 5.0, DEG = Math.PI / 180;
  const s1 = 30 * DEG, s2 = 60 * DEG, olon = 126 * DEG, olat = 38 * DEG;
  let sn = Math.tan(Math.PI / 4 + s2 / 2) / Math.tan(Math.PI / 4 + s1 / 2);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI / 4 + s1 / 2);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + olat / 2), sn);
  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI / 4 + (lat * DEG) / 2), sn);
  let theta = lng * DEG - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}

// ---------------------------------------------------------------- data.go.kr envelope

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Items from a data.go.kr JSON body, or throws ApiError (code "03" means no data for that base yet). */
export function itemsOf(body) {
  let j;
  try {
    j = JSON.parse(body);
  } catch {
    // Gateway errors come back as XML even when JSON was asked for.
    const tag = (t) => body.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
    throw new ApiError(tag("returnAuthMsg") ?? tag("resultMsg") ?? tag("errMsg") ?? `unreadable response: ${body.slice(0, 120)}`, tag("returnReasonCode") ?? tag("resultCode"));
  }
  const header = j?.response?.header;
  if (header && header.resultCode !== "00") throw new ApiError(`${header.resultCode} ${header.resultMsg}`, header.resultCode);
  const items = j?.response?.body?.items;
  return Array.isArray(items) ? items : (items?.item ?? []);
}

// ---------------------------------------------------------------- weather codes

/** "1mm 미만" / "2.5mm" / "30.0~50.0mm" / "50.0mm 이상" / "강수없음" / "0" → mm (lower bound). */
export function amount(text) {
  const s = String(text ?? "").trim();
  if (!s || s === "-" || s.includes("없음")) return 0;
  if (s.includes("미만")) return 0.5;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Precipitation type (PTY) with its hourly amount → WMO code; undefined when PTY is 0. */
export function ptyCode(pty, mm = 0, snowCm = 0, lightning = false) {
  if (lightning) return 95;
  switch (Number(pty)) {
    case 1: // rain
      return mm < 2.5 ? 61 : mm < 7.6 ? 63 : 65;
    case 2: // rain and snow (sleet). WMO 66 is "light freezing rain"; the site shows it as rain.
      return 66;
    case 3: // snow
      return snowCm < 1 ? 71 : snowCm < 5 ? 73 : 75;
    case 4: // shower
      return mm < 2.5 ? 80 : mm < 7.6 ? 81 : 82;
    case 5: // raindrops
      return 51;
    case 6: // raindrops with snow flurries
      return 56;
    case 7: // snow flurries
      return 71;
    default:
      return undefined;
  }
}
/** Sky state (SKY 1 clear, 3 mostly cloudy, 4 overcast) → WMO code. */
export const skyCode = (sky) => ({ 1: 0, 2: 1, 3: 2, 4: 3 })[Number(sky)] ?? 0;
/** Sky state → cloud cover %. */
export const skyCloud = (sky) => ({ 1: 10, 2: 30, 3: 60, 4: 90 })[Number(sky)] ?? null;
/** Mid-range Korean forecast text ("구름많고 비", "흐리고 비/눈", "맑음", …) → WMO code. */
export function textCode(text) {
  const s = String(text ?? "");
  if (s.includes("소나기")) return 80;
  if (s.includes("비/눈") || s.includes("눈/비")) return 66;
  if (s.includes("눈")) return 71;
  if (s.includes("비")) return 61;
  if (s.includes("흐")) return 3;
  if (s.includes("구름")) return 2;
  if (s.includes("맑")) return 0;
  return null;
}

/** KMA / NWS wind chill (°C) for temperature °C and wind m/s; the air temperature when it doesn't apply. */
export function apparent(t, windMs) {
  const v = windMs * 3.6;
  if (!(t <= 10) || !(v >= 4.8)) return t;
  const p = Math.pow(v, 0.16);
  return Math.round((13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p) * 10) / 10;
}

// ---------------------------------------------------------------- forecast

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const max = (xs) => (xs.length ? Math.max(...xs) : null);
const min = (xs) => (xs.length ? Math.min(...xs) : null);

/** Current conditions from the nowcast (observed) plus the first slot of the ultra-short forecast (sky, lightning). */
export function buildCurrent(ncst, ufcst) {
  const obs = Object.fromEntries(ncst.map((i) => [i.category, i.obsrValue]));
  const first = ufcst.map((i) => `${i.fcstDate}${i.fcstTime}`).sort()[0];
  const slot = Object.fromEntries(ufcst.filter((i) => `${i.fcstDate}${i.fcstTime}` === first).map((i) => [i.category, i.fcstValue]));
  const t = num(obs.T1H), wind = num(obs.WSD), rain = amount(obs.RN1);
  if (t === null || wind === null) throw new Error("nowcast is missing temperature or wind");
  const sky = slot.SKY ?? null;
  return {
    temperature_2m: t,
    apparent_temperature: apparent(t, wind),
    precipitation: rain,
    wind_speed_10m: wind,
    weather_code: ptyCode(obs.PTY, rain, 0, num(slot.LGT) > 0) ?? skyCode(sky),
    cloud_cover: skyCloud(sky) ?? (Number(obs.PTY) > 0 ? 90 : null),
  };
}

/**
 * Per-day summaries of the short-range forecast. Items from several bases may be passed oldest
 * first; later ones win for the same hour and element. The first three days are hourly; the
 * fourth comes every three hours with wind as a category (1 weak, 2 moderate, 3 strong), so its
 * wind is left out.
 */
export function shortDays(items) {
  const cell = new Map();
  for (const i of items) cell.set(`${i.fcstDate}${i.fcstTime}|${i.category}`, i.fcstValue);
  const days = new Map();
  for (const [key, value] of cell) {
    const [stamp, cat] = key.split("|");
    const date = stamp.slice(0, 8), time = stamp.slice(8);
    if (!days.has(date)) days.set(date, { hours: new Map(), tmx: null, tmn: null });
    const day = days.get(date);
    if (cat === "TMX") day.tmx = num(value);
    else if (cat === "TMN") day.tmn = num(value);
    else {
      if (!day.hours.has(time)) day.hours.set(time, {});
      day.hours.get(time)[cat] = value;
    }
  }
  const out = new Map();
  for (const [date, day] of days) {
    const sorted = [...day.hours.entries()].sort(([a], [b]) => a.localeCompare(b));
    const hours = sorted.map(([, h]) => h);
    const temps = hours.map((h) => num(h.TMP)).filter((x) => x !== null);
    // Hourly days have slots an hour apart; the three-hourly day's wind is a category, not m/s.
    const hourly = sorted.some(([t], k) => k > 0 && +t - +sorted[k - 1][0] === 100);
    const codes = hours.map((h) => ptyCode(h.PTY, amount(h.PCP), amount(h.SNO)) ?? skyCode(h.SKY));
    out.set(date, {
      slots: hours.length,
      weather_code: max(codes),
      temperature_2m_max: day.tmx ?? max(temps),
      temperature_2m_min: day.tmn ?? min(temps),
      precipitation_probability_max: max(hours.map((h) => num(h.POP)).filter((x) => x !== null)),
      wind_speed_10m_max: hourly ? max(hours.map((h) => num(h.WSD)).filter((x) => x !== null)) : null,
    });
  }
  return out;
}

/**
 * Per-day summaries of the mid-range forecast. Field N (wf5Am, taMax5, …) is N days after the
 * issue date: the 18:00 issue on the 18th gives wf5 = the 23rd, right after the short range ends.
 */
export function midDays(land, ta, tmFc) {
  const issued = String(tmFc).slice(0, 8);
  const out = new Map();
  for (let n = 3; n <= 10; n++) {
    const wf = [land?.[`wf${n}Am`], land?.[`wf${n}Pm`], land?.[`wf${n}`]].filter((x) => x != null && x !== "");
    const pop = [land?.[`rnSt${n}Am`], land?.[`rnSt${n}Pm`], land?.[`rnSt${n}`]].map(num).filter((x) => x !== null);
    const tmax = num(ta?.[`taMax${n}`]), tmin = num(ta?.[`taMin${n}`]);
    if (!wf.length && tmax === null) continue;
    out.set(addDays(issued, n), {
      weather_code: max(wf.map(textCode).filter((x) => x !== null)),
      temperature_2m_max: tmax,
      temperature_2m_min: tmin,
      precipitation_probability_max: max(pop),
      wind_speed_10m_max: null,
    });
  }
  return out;
}

const DAILY_KEYS = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "wind_speed_10m_max"];

/** Five days from today (KST): the short range where it covers the day, the mid range after. */
export function buildDaily(today, short, mid, count = 5) {
  const daily = { time: [], ...Object.fromEntries(DAILY_KEYS.map((k) => [k, []])) };
  for (let n = 0; n < count; n++) {
    const date = addDays(today, n);
    const s = short.get(date);
    // A day the short range only touches (the last base's trailing 00:00 slot) is better from the mid range.
    const day = s && (s.slots >= 8 || n === 0 || !mid.has(date)) ? s : (mid.get(date) ?? s);
    daily.time.push(dashed(date));
    for (const k of DAILY_KEYS) daily[k].push(day?.[k] ?? null);
  }
  return daily;
}

// ---------------------------------------------------------------- warnings

/** Jeju's land warning zones (특보구역) as KMA names them. ICC Jeju (Jungmun) is in 서귀포시남부. */
export const JEJU_LAND = ["제주시북부", "제주시동부", "제주시서부", "제주시중산간", "서귀포시남부", "서귀포시동부", "서귀포시서부", "서귀포시중산간", "제주도산지", "추자도"];
export const VENUE_ZONE = "서귀포시남부";

const KINDS = [
  ["폭풍해일", "storm-surge", "Storm surge"],
  ["강풍", "wind", "Strong wind"],
  ["호우", "rain", "Heavy rain"],
  ["대설", "snow", "Heavy snow"],
  ["풍랑", "seas", "High seas"],
  ["태풍", "typhoon", "Typhoon"],
  ["건조", "dry", "Dry weather"],
  ["한파", "cold", "Cold wave"],
  ["폭염", "heat", "Heat wave"],
  ["황사", "dust", "Yellow dust"],
  ["안개", "fog", "Fog"],
];

/** Split at commas that are not inside parentheses. */
export function splitTop(text) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "name(inner)" → { name, inner } with the outermost parentheses. */
function group(item) {
  const i = item.indexOf("(");
  if (i < 0 || !item.endsWith(")")) return { name: item.trim(), inner: null };
  return { name: item.slice(0, i).trim(), inner: item.slice(i + 1, -1).trim() };
}

/** Jeju zones in one comma-separated area list: land zones, and the Jeju sea and coastal areas. */
export function jejuAreas(list) {
  const land = new Set(), sea = [];
  for (const item of splitTop(list)) {
    const { name, inner } = group(item);
    if (name === "제주도") {
      // "제주도" alone is the whole island; "제주도(A, B 제외)" is everything except A and B.
      if (!inner) JEJU_LAND.forEach((z) => land.add(z));
      else if (/제외$/.test(inner)) {
        const except = splitTop(inner.replace(/\s*제외$/, ""));
        JEJU_LAND.filter((z) => !except.includes(z)).forEach((z) => land.add(z));
      } else splitTop(inner).forEach((z) => land.add(z));
    } else if (/제주|추자/.test(item)) {
      // "제주도앞바다(제주도북부앞바다, …)" lists sub-areas; "제주도동부앞바다(북동연안바다, …)" coastal strips.
      if (!inner) sea.push(name);
      else for (const sub of splitTop(inner)) sea.push(/^제주|추자/.test(sub) ? sub : `${name} ${sub}`);
    }
  }
  return [...[...land].sort((a, b) => JEJU_LAND.indexOf(a) - JEJU_LAND.indexOf(b)), ...sea];
}

function kindOf(word) {
  const k = KINDS.find(([ko]) => word.includes(ko));
  return k ? { kind: k[1], en: k[2] } : { kind: "other", en: word };
}

/** Add an item, merging areas into an existing one of the same kind, level and status. */
function addItem(items, item) {
  const same = items.find((x) => x.kind === item.kind && x.level === item.level && x.preliminary === item.preliminary && x.labelKo === item.labelKo);
  if (!same) items.push(item);
  else {
    for (const a of item.areas) if (!same.areas.includes(a)) same.areas.push(a);
    same.affectsVenue ||= item.affectsVenue;
  }
}

/** Jeju warnings from getPwnStatus: t6 lists those in force, t7 the preliminary ones (예비특보). */
export function parseWarnings(status) {
  const items = [];
  const venue = (areas) => areas.includes(VENUE_ZONE);
  // In force: "o 강풍주의보 : 서해5도, 강원도(…), 제주도(제주시북부, 서귀포시남부 제외)".
  for (const line of String(status?.t6 ?? "").split(/\r?\n/)) {
    const m = /^o\s*(\S+?)(주의보|경보)\s*:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const areas = jejuAreas(m[3]);
    if (!areas.length) continue;
    const { kind, en } = kindOf(m[1]);
    const level = m[2] === "경보" ? "warning" : "advisory";
    addItem(items, { kind, level, preliminary: false, labelKo: `${m[1]}${m[2]}`, label: `${en} ${level}`, areas, affectsVenue: venue(areas) });
  }
  // Preliminary: "(1) 강풍 예비특보" then "o 11월 18일 오후(12시~18시) : 제주도(서귀포시남부 제외)".
  let current = null;
  for (const line of String(status?.t7 ?? "").split(/\r?\n/)) {
    const head = /^\(\d+\)\s*(\S+?)\s*(경보|주의보)?\s*예비특보/.exec(line.trim());
    if (head) {
      current = { word: head[1], level: head[2] === "경보" ? "warning" : "advisory" };
      continue;
    }
    const m = /^o\s*.+?\s:\s(.+)$/.exec(line.trim());
    if (!m || !current) continue;
    const areas = jejuAreas(m[1]);
    if (!areas.length) continue;
    const { kind, en } = kindOf(current.word);
    const levelKo = current.level === "warning" ? "경보" : "주의보";
    addItem(items, {
      kind, level: current.level, preliminary: true,
      labelKo: `${current.word}${levelKo} 예비특보`, label: `${en} ${current.level} expected`,
      areas, affectsVenue: venue(areas),
    });
  }
  return items;
}

// ---------------------------------------------------------------- air quality

/**
 * AirKorea stations in Jeju with approximate positions (from their town names), used only to rank
 * them by distance from the venue. Gangjeong-dong is the nearest, about 5 km east of ICC Jeju.
 */
export const AIR_STATIONS = {
  강정동: [33.2375, 126.4805], 동홍동: [33.2555, 126.5665], 대정읍: [33.2235, 126.2510], 남원읍: [33.2790, 126.7120],
  고산리: [33.2950, 126.1620], 한림읍: [33.4105, 126.2650], 애월읍: [33.4620, 126.3300], 노형로: [33.4835, 126.4790],
  연동: [33.4885, 126.4930], 이도동: [33.5030, 126.5300], 제주항: [33.5200, 126.5430], 화북동: [33.5185, 126.5700],
  조천읍: [33.5390, 126.6350], 성산읍: [33.4500, 126.9100],
};

function km([lat1, lng1], [lat2, lng2]) {
  const r = Math.PI / 180;
  const x = (lng2 - lng1) * r * Math.cos(((lat1 + lat2) / 2) * r), y = (lat2 - lat1) * r;
  return Math.hypot(x, y) * 6371;
}

const grade = (v) => {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 4 ? n : null;
};

/** The nearest station with a reading (both PM values if any station has them). */
export function pickAir(items, origin = [ICC.lat, ICC.lng]) {
  const ranked = items
    .filter((i) => AIR_STATIONS[i.stationName])
    .map((i) => ({ i, d: km(origin, AIR_STATIONS[i.stationName]) }))
    .sort((a, b) => a.d - b.d)
    .map(({ i }) => ({
      station: i.stationName,
      dataTime: airIso(i.dataTime),
      pm10: num(i.pm10Value),
      pm25: num(i.pm25Value),
      // Hourly grades (ver 1.3) match the hourly values; the plain grade is the 24-hour one.
      pm10Grade: grade(i.pm10Grade1h ?? i.pm10Grade),
      pm25Grade: grade(i.pm25Grade1h ?? i.pm25Grade),
    }));
  const pick = ranked.find((r) => r.pm10 !== null && r.pm25 !== null) ?? ranked.find((r) => r.pm10 !== null || r.pm25 !== null);
  if (!pick) throw new Error("no Jeju station has a PM reading");
  return pick;
}

// ---------------------------------------------------------------- publish

/** Fresh sections where they were fetched; the previous section (and an error) where not. */
export function assemble({ generatedAt, fresh, failures, previous }) {
  const out = { generatedAt, attribution: ATTRIBUTION, forecast: null, warnings: null, air: null, errors: [] };
  for (const source of ["forecast", "warnings", "air"]) {
    if (fresh[source]) out[source] = fresh[source];
    else {
      out[source] = previous?.[source] ?? null;
      out.errors.push({ source, message: failures[source] ?? "not fetched" });
    }
  }
  return out;
}
