# weather-data

Weather for the QM2027 site, fetched from data.go.kr (KMA forecasts and warnings, AirKorea air quality)
by GitHub Actions and published to GitHub Pages under https://qm2027.github.io/weather-data/.
Nothing is committed; the site reads the published JSON.

The data.go.kr key lives only in the `DATA_GO_KR_KEY` Actions secret (organization secret shared with
this repository and `tour-data`). Never commit it.

Right now only `probe.yml` runs: it checks that each service answers from a GitHub runner and writes
`probe.json`.
