/**
 * data.js — loading and describing the data.
 *
 * Data files (the site never changes their numbers, it only displays them):
 *   data/sites.csv    one row per site: references (Mars / Moon) and Earth analogs
 *   data/scores.csv   similarity of every analog with every reference, per criterion
 *                     and per weighting scenario (computed by analysis/metrics.py)
 *   data/ranking.csv  analogs ranked for each reference in that body's scenario
 *
 * Everything that knows about the CSV schemas lives here:
 *   - PARAMS:    raw parameters shown in the sidebar (label, unit, status column)
 *   - CRITERIA:  the 8 similarity criteria s_* in scores.csv
 *   - SCENARIOS: weighting scenarios (must mirror SCENARIOS in analysis/metrics.py)
 *   - STATUS:    how status_* values are shown
 */

/** @typedef {'earth'|'mars'|'moon'} Body */

/**
 * @typedef {Object} Site
 * @property {string} id            site_id
 * @property {string} name          name_en
 * @property {string} nameUk        name_uk
 * @property {Body} body
 * @property {'reference'|'analog'} role
 * @property {string|null} pairId   analogs: the reference this analog was chosen for
 * @property {Body|null} analog_of  analogs: body of their paired reference
 * @property {number} lat
 * @property {number} lon
 * @property {string} region
 * @property {string} description   desc_en
 * @property {string} limits        limits_en
 * @property {{img:string, page:string, author:string, license:string}|null} photo
 * @property {Object<string, number|string|null>} values  raw columns keyed by PARAMS[].key
 * @property {Object<string, string>} status              status_* columns without the prefix
 */

export const BODIES = {
  earth: { label: 'Earth', short: 'Earth' },
  mars: { label: 'Mars', short: 'Mars' },
  moon: { label: 'Moon (South Pole)', short: 'Moon' },
};

/**
 * Raw parameters as shown in the sidebar. `status` = suffix of the status_*
 * column that describes the value (null = the CSV has no status for it).
 */
export const PARAMS = [
  { key: 't_surf_min_c',          label: 'Surface temperature, min',  unit: '°C',        digits: 1, status: 'temp' },
  { key: 't_surf_mean_c',         label: 'Surface temperature, mean', unit: '°C',        digits: 1, status: 'temp' },
  { key: 't_surf_max_c',          label: 'Surface temperature, max',  unit: '°C',        digits: 1, status: 'temp' },
  { key: 'crater_density_1e6km2', label: 'Crater density',            unit: '/10⁶ km²',  digits: 0, status: 'craters' },
  { key: 'slope_mean_deg',        label: 'Mean slope',                unit: '°',         digits: 1, status: 'slope' },
  { key: 'relief_m',              label: 'Relief',                    unit: 'm',         digits: 0, status: null },
  { key: 'ice_water_frac',        label: 'Water ice fraction',        unit: '',          digits: 3, status: 'ice' },
  { key: 'aridity_ai',            label: 'Aridity index',             unit: '',          digits: 2, status: null },
  { key: 'rock_class',            label: 'Rock class',                unit: '',          text: true, status: 'rock' },
  { key: 'sun_elev_max_deg',      label: 'Max solar elevation',       unit: '°',         digits: 2, status: 'sun' },
  { key: 'sun_elev_min_deg',      label: 'Min solar elevation',       unit: '°',         digits: 2, status: 'sun' },
];
export const PARAM = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

/**
 * Similarity criteria (columns s_<key> in scores.csv), each 0..1.
 * `raw` = parameter used to tell whether the analog is higher or lower than the
 * reference (for the "How to close the gap" advice).
 */
export const CRITERIA = [
  { key: 'temp_mean',  label: 'Mean temperature',  short: 'T mean',   raw: (s) => s.values.t_surf_mean_c,  status: 'temp' },
  { key: 'temp_range', label: 'Temperature range', short: 'T range',  raw: (s) => diff(s.values.t_surf_max_c, s.values.t_surf_min_c), status: 'temp' },
  { key: 'craters',    label: 'Crater density',    short: 'Craters',  raw: (s) => s.values.crater_density_1e6km2, status: 'craters' },
  { key: 'slope',      label: 'Slope',             short: 'Slope',    raw: (s) => s.values.slope_mean_deg, status: 'slope' },
  { key: 'relief',     label: 'Relief',            short: 'Relief',   raw: (s) => s.values.relief_m,       status: null },
  { key: 'ice',        label: 'Water ice',         short: 'Ice',      raw: (s) => s.values.ice_water_frac, status: 'ice' },
  { key: 'sun',        label: 'Solar elevation',   short: 'Sun',      raw: (s) => s.values.sun_elev_max_deg, status: 'sun' },
  { key: 'rock',       label: 'Rock type',         short: 'Rock',     raw: () => null,                     status: 'rock' },
];
function diff(a, b) { return a === null || b === null ? null : a - b; }

/**
 * Weighting scenarios — MUST mirror SCENARIOS in analysis/metrics.py.
 * Used only to explain scores (gain per criterion); the scores themselves come
 * from scores.csv, and loadAll() warns if they disagree with these weights.
 */
export const SCENARIOS = {
  equal:        { label: 'Equal weights', weights: { temp_mean: 1, temp_range: 0.5, craters: 1, slope: 1, relief: 1, ice: 1, sun: 1, rock: 1 } },
  moon_base:    { label: 'Moon base',     weights: { temp_mean: 1, temp_range: 1, craters: 1, slope: 1, relief: 0.5, ice: 3, sun: 3, rock: 1 } },
  mars_landing: { label: 'Mars landing',  weights: { temp_mean: 1, temp_range: 0.5, craters: 1, slope: 3, relief: 2, ice: 1, sun: 0.5, rock: 2 } },
};
/** Scenario used for each reference body in ranking.csv (TARGET_SCENARIO in metrics.py). */
export const BODY_SCENARIO = { mars: 'mars_landing', moon: 'moon_base' };

/**
 * Status badges. literature = green, computed = blue, anything else
 * (test, estimate_*, unknown) = grey placeholder.
 */
const STATUS_KINDS = {
  literature: { kind: 'literature', label: 'Literature', tip: 'Value from published literature' },
  computed: { kind: 'computed', label: 'Computed', tip: 'Computed from coordinates / formula' },
  topographic_shadow: { kind: 'computed', label: 'Computed', tip: 'Computed: permanently shadowed by crater walls (max solar elevation set to 0°)' },
};
const PLACEHOLDER = 'placeholder value, not yet verified';

/** @returns {{kind:'literature'|'computed'|'placeholder', label:string, tip:string}|null} */
export function statusInfo(code) {
  if (!code) return null;
  if (STATUS_KINDS[code]) return STATUS_KINDS[code];
  const detail = code === 'test' ? '' : ` (${code.replace(/_/g, ' ')})`;
  return { kind: 'placeholder', label: code.startsWith('estimate') ? 'Estimate' : 'Test', tip: PLACEHOLDER + detail };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const NONE_VALUES = new Set(['', '—', '-', '–', 'none', 'null', 'na', 'n/a', 'nan']);
const str = (v) => String(v ?? '').trim();

function toNumber(v) {
  const s = str(v);
  if (NONE_VALUES.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toBody(v) {
  const s = str(v).toLowerCase();
  return s in BODIES ? s : null;
}

const toBool = (v) => str(v).toLowerCase() === 'true';

/**
 * photo_url in sites.csv is a Wikimedia Commons file page
 * (https://commons.wikimedia.org/wiki/File:…). Special:FilePath turns it into a
 * scaled image; other https URLs are used as the image itself.
 */
function photoFrom(row) {
  const url = str(row.photo_url);
  if (!/^https:\/\//.test(url)) return null;
  const m = url.match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
  return {
    img: m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}?width=800` : url,
    page: url,
    author: str(row.photo_author),
    license: str(row.photo_license),
  };
}

function normalizeSite(row, index) {
  const body = toBody(row.body);
  const lat = toNumber(row.lat);
  const lon = toNumber(row.lon);
  const id = str(row.site_id);
  if (!id || !body || lat === null || lon === null) {
    console.warn('[data] skipping sites.csv row', index, row);
    return null;
  }
  const values = {};
  for (const p of PARAMS) values[p.key] = p.text ? (str(row[p.key]) || null) : toNumber(row[p.key]);
  const status = {};
  for (const [k, v] of Object.entries(row)) if (k.startsWith('status_') && str(v)) status[k.slice(7)] = str(v);

  return {
    id,
    name: str(row.name_en) || id,
    nameUk: str(row.name_uk),
    body,
    role: str(row.role) === 'reference' ? 'reference' : 'analog',
    pairId: str(row.pair_id) || null,
    analog_of: null, // filled in loadAll() from the paired reference
    lat,
    lon,
    region: str(row.region),
    description: str(row.desc_en),
    limits: str(row.limits_en),
    photo: photoFrom(row),
    values,
    status,
  };
}

function normalizeScore(row) {
  const s = {};
  for (const c of CRITERIA) s[c.key] = toNumber(row[`s_${c.key}`]);
  return {
    analogId: str(row.analog_id),
    referenceId: str(row.reference_id),
    scenario: str(row.scenario),
    isPair: toBool(row.is_pair),
    score: toNumber(row.score),
    coverage: toNumber(row.coverage),
    rank: toNumber(row.rank),
    s,
  };
}

/**
 * Parse one CSV (fetch + Papa Parse).
 * NOTE: fetch does not work from file:// — serve the folder over HTTP.
 */
function parseCsv(url) {
  return new Promise((resolve, reject) => {
    if (!window.Papa) { reject(new Error('Papa Parse failed to load')); return; }
    window.Papa.parse(url, {
      download: true,
      header: true,
      comments: '#',
      skipEmptyLines: 'greedy',
      dynamicTyping: false, // converted by hand (handles "—", empty cells)
      complete: (res) => {
        if (res.errors?.length) console.warn(`[data] ${url} parse warnings`, res.errors);
        resolve(res.data);
      },
      error: (err) => reject(new Error(`${url}: ${err?.message || err}`)),
    });
  });
}

/** Recompute a score from its criteria and scenario weights (as metrics.py does). */
export function weightedScore(s, weights) {
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (w > 0 && s[k] !== null && s[k] !== undefined) { num += w * s[k]; den += w; }
  }
  return den ? num / den : null;
}

/**
 * Load sites, scores and ranking.
 * @returns {Promise<{sites: Site[], scores: object[], ranking: object[]}>}
 */
export async function loadAll(base = 'data/') {
  const [siteRows, scoreRows, rankRows] = await Promise.all(
    ['sites.csv', 'scores.csv', 'ranking.csv'].map((f) => parseCsv(base + f)),
  );
  const sites = siteRows.map(normalizeSite).filter(Boolean);
  const byId = new Map(sites.map((s) => [s.id, s]));
  for (const s of sites) {
    if (s.role === 'analog') {
      const ref = byId.get(s.pairId);
      if (!ref) console.warn(`[data] ${s.id}: pair_id "${s.pairId}" is not a site`);
      s.analog_of = ref && ref.body !== 'earth' ? ref.body : null;
    }
  }
  const scores = scoreRows.map(normalizeScore).filter((r) => byId.has(r.analogId) && byId.has(r.referenceId));
  const ranking = rankRows.map(normalizeScore).filter((r) => byId.has(r.analogId) && byId.has(r.referenceId));

  // Self-check: the JS copy of the scenario weights must reproduce scores.csv.
  const off = scores.filter((r) => {
    const w = SCENARIOS[r.scenario]?.weights;
    const v = w && weightedScore(r.s, w);
    return v === null || v === undefined || Math.abs(v - r.score) > 0.002;
  });
  if (off.length) console.warn(`[data] ${off.length} scores do not match SCENARIOS weights — update js/data.js to mirror analysis/metrics.py`, off.slice(0, 3));

  return { sites, scores, ranking };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const sitesOnBody = (sites, body) => sites.filter((s) => s.body === body);
export const references = (sites) => sites.filter((s) => s.role === 'reference');
export const analogs = (sites) => sites.filter((s) => s.role === 'analog');

/** Earth analogs whose paired reference is on `target` ('mars' | 'moon'). */
export const analogsOf = (sites, target) =>
  sites.filter((s) => s.role === 'analog' && s.analog_of === target);

/** Format lat/lon as "24.00° S, 15.00° E". */
export function formatCoords(lat, lon, digits = 2) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}

/** "glacial_till" → "glacial till" */
export const prettyRock = (v) => (v ? String(v).replace(/_/g, ' ') : '—');

export function formatValue(param, value) {
  if (value === null || value === undefined) return '—';
  if (param.text) return prettyRock(value);
  return Number(value).toFixed(param.digits ?? 2);
}
