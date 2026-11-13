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
index.html            layout: header + tabs (Globe · Map view · Analysis), globe stage, map panes, Analysis view, sidebar
css/style.css         themes ([data-theme="earth|mars|moon"]), layout, responsive rules
js/app.js             state, view switching, theme, sidebar, Analysis view wiring, URL hash
js/globe.js           home screen: globe.gl globes, focus / compare / back animation, stars, WebGL check
js/maps.js            BODY_MAPS config (CRS, tiles), MapView class, markers, grid fallback
js/data.js            CSV loading; PARAMS, CRITERIA, SCENARIOS (mirror of metrics.py), status badges
js/scores.js          ScoreBook: queries over scores.csv / ranking.csv; per-criterion breakdown
js/charts.js          Chart.js charts: ranking, radar, heat map, raw parameters; PNG export
data/sites.csv        the single source of site data (18 rows: references + Earth analogs)
data/rock_similarity.csv  rock-class similarity matrix
data/scores.csv       similarity of every analog with every reference (generated)
data/ranking.csv      analogs ranked per reference (generated)
data/limits.json      team file "Limits of the analogy" (factors, mitigations with criteria links, good_at, conclusion)
docs/limits_mars.pdf, docs/limits_moon.pdf   Ukrainian originals of the limits documents
assets/textures/      globe textures (earth, mars, moon; sources in TODO.md)
analysis/metrics.py   computes scores.csv and ranking.csv from sites.csv
analysis/CHANGES.md   what the data contains and what is still unverified
TODO.md               data errors / contradictions found, to be fixed by the team
tools/bump_version.py cache-busting version for index.html (run before each push)
```

The site never computes similarity itself: after editing `data/sites.csv`, run

```sh
python analysis/metrics.py   # rewrites data/scores.csv and data/ranking.csv
```

## Before each push: bump the version

GitHub Pages lets browsers cache files for 10 minutes, so right after a deploy a
browser may mix a new `index.html` with old scripts. Run

```sh
python tools/bump_version.py   # new ?v=<timestamp> for CSS, every JS module (import map) and the data files
```

and commit `index.html` together with your changes. A new module in `js/` is picked up
automatically the next time the script runs.

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
| Charts | `js/charts.js`; series colours in `SERIES` (validated for the dark themes) |
| Analysis view | URL `#view=analysis&ref=<site_id>&analog=<site_id>&scn=equal` |
| Change basemap | `BODY_MAPS[key].tiles` in `js/maps.js` (`moon` = south polar, `moonGlobal` = equirectangular) |
| Moon projection default | `state.moonProjection` in `js/app.js`, or URL `#view=moon&proj=global` |
| Change colors | theme blocks at the top of `css/style.css` |
| Limits / mitigations texts | `data/limits.json` (team file: `mitigations[].addresses` → `factors[].id`, `mitigations[].criteria` → s_* criteria, `unmapped_criteria`); Analysis card `renderLimits()`, sidebar `gapSection()` (criteria with s < `MITIGATION_THRESHOLD` = 0.5) in `js/app.js` |
| Globe colours | `--space-1`, `--space-2` (background), `--accent-earth`, `--accent-mars`, `--accent-moon` in the SPACE INFOGRAPHIC block of `css/style.css`; marker / glow colours: `MARKER_COLORS`, `ATMOSPHERE` in `js/globe.js` |
| Globe fonts | `--font-serif` (headlines), `--font-label` (small caps); Google Fonts link in `index.html` |
| Animation timing | CSS: `--t-accent` (colour, 0.6 s), `--t-slot` (Earth → target, 1.5 s), `--t-card` (card, 0.6 s); JS: `TIMING` (camera flight 1.2 s, compare 1.5 s, rotation speed) and `ALTITUDE` (camera distance) in `js/globe.js`. With prefers-reduced-motion everything switches instantly |
| Globe textures | `TEXTURES` in `js/globe.js` (falls back to a plain sphere if a file is missing) |
| Globe deep links | `#view=globe&focus=<site_id>` (card open), `&g=compare` (comparison) |
| Sidebar content | `renderSidebar()` and helpers in `js/app.js` |

Screenshot tests: headless Chrome with `--force-prefers-reduced-motion` (charts and CSS
transitions then render without animation); globes need `--use-angle=swiftshader --enable-unsafe-swiftshader`.
Without WebGL the site opens on the Leaflet maps and hides the Globe tab.
