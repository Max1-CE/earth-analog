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
index.html          layout: header + tabs, map panes, charts panel, sidebar
css/style.css       themes ([data-theme="earth|mars|moon"]), layout, responsive rules
js/app.js           state, tab/compare switching, theme, sidebar rendering
js/maps.js          BODY_MAPS config (CRS, tiles), MapView class, markers, grid fallback
js/data.js          CSV loading, PARAMS schema (labels/units/ranges), formatting
js/similarity.js    WEIGHTS config + similarity(site, target, weights), per-parameter breakdown
js/gap.js           GAP_RULES: "How to close the gap" advice per parameter / direction / target
data/sites.csv      sites (approximate test values)
```

## Where to change things

| Task | File |
|---|---|
| Add a site | `data/sites.csv` |
| Popup text / photo | `region`, `description`, `photo_url`, `photo_credit`, `photo_license`, `photo_page` columns in `data/sites.csv` (photos: Earth only, free licence; `TODO:` notes in `description` are hidden from visitors) |
| Coordinates checked? | `coords_verified` (`yes`/`no`) + where they came from in `source`; `no` shows "≈ approx." in the UI |
| Popup layout | `sitePopup()` in `js/app.js`, `.popup*` / `.site-popup` in `css/style.css`; open one via URL `#view=earth&popup=<site name>` |
| Add a parameter | new CSV column + entry in `PARAMS` (`js/data.js`) + weight in `WEIGHTS` |
| Change basemap | `BODY_MAPS[key].tiles` in `js/maps.js` (`moon` = south polar, `moonGlobal` = equirectangular) |
| Moon projection default | `state.moonProjection` in `js/app.js` (`'polar'` / `'global'`), or URL `#view=moon&proj=global` |
| Change colors | theme blocks at the top of `css/style.css` |
| Similarity weights | `WEIGHTS` in `js/similarity.js` |
| High / Moderate / Low thresholds | `SIMILARITY_LEVELS` in `js/similarity.js` |
| Which sites are compared | `comparisonCandidates()` in `js/similarity.js` |
| Gap advice texts | `GAP_RULES` in `js/gap.js` (`higher` / `lower` = Earth value vs target; `mars` / `moon` extra tips) |
| "Matches" threshold | `MATCH_THRESHOLD` in `js/similarity.js` (normalized difference, default 0.2) |
| Sidebar content | `renderSidebar()` and helpers in `js/app.js` |
| Charts | `renderCharts()` in `js/app.js`, container `#charts .charts__body` |
