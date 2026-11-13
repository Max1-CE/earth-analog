# Earth Analog Explorer

NASA Space Apps 2026 — *Earth Analog* challenge. Compare places on Earth with
conditions on Mars and the lunar south pole.

Static site: HTML + CSS + JS, [Leaflet](https://leafletjs.com) maps,
[Papa Parse](https://www.papaparse.com) for CSV. No backend.

## Run

The CSV is fetched over HTTP, so open the site through a local server:

```sh
cd earth-analog
python -m http.server 8000
# open http://localhost:8000
```

## Structure

```
index.html            layout: header + tabs, map panes, Analysis view, sidebar
css/style.css         themes ([data-theme="earth|mars|moon"]), layout, responsive rules
js/app.js             state, view switching, theme, sidebar, Analysis view wiring, URL hash
js/maps.js            BODY_MAPS config (CRS, tiles), MapView class, markers, grid fallback
js/data.js            CSV loading; PARAMS, CRITERIA, SCENARIOS (mirror of metrics.py), status badges
js/scores.js          ScoreBook: queries over scores.csv / ranking.csv; per-criterion breakdown
js/charts.js          Chart.js charts: ranking, radar, heat map, raw parameters; PNG export
js/gap.js             GAP_RULES: "How to close the gap" advice per criterion / direction / target
data/sites.csv        the single source of site data (18 rows: references + Earth analogs)
data/rock_similarity.csv  rock-class similarity matrix
data/scores.csv       similarity of every analog with every reference (generated)
data/ranking.csv      analogs ranked per reference (generated)
data/limits.json      "Limits of the analogy" (English, from docs/limits_*.pdf): factors, mitigations, site notes
docs/limits_mars.pdf, docs/limits_moon.pdf   Ukrainian originals of the limits documents
analysis/metrics.py   computes scores.csv and ranking.csv from sites.csv
analysis/CHANGES.md   what the data contains and what is still unverified
TODO.md               data errors / contradictions found, to be fixed by the team
```

The site never computes similarity itself: after editing `data/sites.csv`, run

```sh
python analysis/metrics.py   # rewrites data/scores.csv and data/ranking.csv
```

## Where to change things

| Task | File |
|---|---|
| Add / edit a site | `data/sites.csv`, then rerun `analysis/metrics.py` |
| Popup text / photo | `desc_en`, `limits_en`, `photo_url` (Commons file page), `photo_author`, `photo_license` |
| Value status badges | `status_*` columns; display rules in `statusInfo()` (`js/data.js`) |
| Popup layout | `sitePopup()` in `js/app.js`; open one via URL `#view=earth&popup=<site_id>` |
| Scenario weights | `SCENARIOS` in `analysis/metrics.py` **and** the copy in `js/data.js` (the site warns in the console if they disagree) |
| High / Moderate / Low thresholds | `SIMILARITY_LEVELS` in `js/scores.js` |
| "Matches" threshold | `MATCH_THRESHOLD` in `js/scores.js` (criterion similarity s, default 0.7) |
| Gap advice texts | `GAP_RULES` in `js/gap.js` (`higher` / `lower` = Earth value vs target, `differs` for rock) |
| Charts | `js/charts.js`; series colours in `SERIES` (validated for the dark themes) |
| Analysis view | URL `#view=analysis&ref=<site_id>&analog=<site_id>&scn=equal` |
| Change basemap | `BODY_MAPS[key].tiles` in `js/maps.js` (`moon` = south polar, `moonGlobal` = equirectangular) |
| Moon projection default | `state.moonProjection` in `js/app.js`, or URL `#view=moon&proj=global` |
| Change colors | theme blocks at the top of `css/style.css` |
| Limits / mitigations texts | `data/limits.json` (`factors[].id` link `mitigations[].factors`; `site_notes[].site_id` = analog in `sites.csv`); shown by `renderLimits()` / `limitsBlock()` in `js/app.js` |
| Sidebar content | `renderSidebar()` and helpers in `js/app.js` |

Screenshot tests: headless Chrome with `--force-prefers-reduced-motion` (charts and CSS
transitions then render without animation).
