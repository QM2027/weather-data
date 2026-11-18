# weather-data

Venue weather for the QM2027 site (ICC Jeju, Jungmun), fetched from data.go.kr by GitHub Actions
every hour and published to GitHub Pages:

**https://qm2027.github.io/weather-data/weather.json**

Nothing but code is committed; the site reads the published JSON. A source that fails keeps the
previously published section, so the file is always complete and valid.

## Sources (data.go.kr)

| Section | Service | Notes |
| --- | --- | --- |
| `forecast.current` | 기상청 단기예보: `getUltraSrtNcst` + `getUltraSrtFcst` | grid nx 51, ny 32 |
| `forecast.daily` | 기상청 단기예보 `getVilageFcst`, then 중기예보 `getMidLandFcst` (11G00000 제주도) + `getMidTa` (11G00401 서귀포) | 5 days from today (KST) |
| `warnings` | 기상청 기상특보 `getPwnStatus` | t6 = in force, t7 = preliminary (예비특보) |
| `air` | 에어코리아 `getCtprvnRltmMesureDnsty` (제주) | nearest station with a reading, usually 강정동 |

## Schema

```
{
  generatedAt, attribution,
  forecast: null | { fetchedAt, issuedAt, current: {…}, daily: {…} },   // Open-Meteo shape
  warnings: null | { fetchedAt, issuedAt, items: [{ kind, level, preliminary, labelKo, label, areas, affectsVenue }] },
  air:      null | { fetchedAt, station, dataTime, pm10, pm25, pm10Grade, pm25Grade },
  errors:   [{ source: "forecast" | "warnings" | "air", message }]
}
```

`forecast.current` and `forecast.daily` use the field names and WMO weather codes of the
Open-Meteo forecast the site already reads (`src/lib/weather.ts`), so the site can switch source
without touching its display code. Differences:

- `daily.wind_speed_10m_max` is `null` for the days KMA forecasts every three hours (its wind there
  is a category, not m/s) and for the mid-range days. Any daily value can be `null` if KMA has none.
- Sky and precipitation type map to WMO codes: clear 0, mostly cloudy 2, overcast 3; rain 61/63/65
  by the hour's amount, raindrops 51, rain and snow 66 (shown as rain), snow 71/73/75, showers
  80–82, lightning 95. The day's code is the most severe hour, like Open-Meteo's.
- `cloud_cover` is approximate (SKY 1 → 10 %, 3 → 60 %, 4 → 90 %).
- `apparent_temperature` is the KMA wind chill (below 10 °C with wind), otherwise the temperature.

Warnings list only Jeju areas. Land zones use KMA's names: 제주시북부/동부/서부/중산간,
서귀포시남부/동부/서부/중산간, 제주도산지, 추자도. ICC Jeju is in **서귀포시남부**, which sets
`affectsVenue`; 제주도산지 is the one for Hallasan. Sea areas are listed as KMA names them.
`kind` is one of wind, rain, snow, seas, storm-surge, typhoon, dry, cold, heat, dust, fog, other;
`level` is advisory (주의보) or warning (경보).

Grades are AirKorea's 1 good, 2 moderate, 3 bad, 4 very bad, for the hourly value.

## Schedule and key

`publish.yml` runs hourly at :50, on push and by hand (Actions → Publish weather → Run workflow).
The key is the `DATA_GO_KR_KEY` Actions secret (organization secret shared with this repository
and `tour-data`). Never commit it; the script redacts it from anything it logs or publishes.

Run the tests with `node --test` (no network; fixtures are real responses with the key removed).

## After the conference

The site copies a final snapshot (or drops live weather) when the conference is over; then disable
this workflow and archive the repository.
