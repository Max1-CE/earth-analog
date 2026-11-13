/**
 * data.js — loading and describing site data.
 *
 * Everything that knows about the CSV schema lives here:
 *   - PARAMS: metadata for each comparable parameter (label, unit, normalization range).
 *     Add a new column to data/sites.csv + one entry here and it shows up in the
 *     sidebar table and becomes available to similarity.js automatically.
 *   - BODIES: display info for each planetary body.
 *   - loadSites(): CSV -> array of normalized Site objects.
 */

/** @typedef {'earth'|'mars'|'moon'} Body */

/**
 * @typedef {Object} Site
 * @property {string} id
 * @property {string} name
 * @property {Body} body
 * @property {Body|null} analog_of   // for Earth sites: which body they imitate
 * @property {number} lat
 * @property {number} lon
 * @property {string} source
 * @property {string} region
 * @property {string} description       // short popup text (English)
 * @property {boolean} coordsVerified
 * @property {{url:string, credit:string, license:string, page:string}|null} photo  // Earth only
 * @property {Object<string, number|null>} params  // keyed by PARAMS[].key
 */

export const BODIES = {
  earth: { label: 'Earth', short: 'Earth' },
  mars: { label: 'Mars', short: 'Mars' },
  moon: { label: 'Moon (South Pole)', short: 'Moon' },
};

/**
 * Comparable parameters. `range` is the [min, max] used to normalize to 0..1
 * in similarity.js — widen it if new data falls outside.
 * `digits` controls display rounding in the sidebar.
 */
export const PARAMS = [
  { key: 'surface_temp_mean_c',  label: 'Mean surface temperature', unit: '°C',        range: [-230, 50], digits: 0 },
  { key: 'surface_temp_range_c', label: 'Temperature range',        unit: '°C',        range: [0, 300],   digits: 0 },
  { key: 'crater_density',       label: 'Crater density',           unit: '/1000 km²', range: [0, 20],    digits: 2 },
  { key: 'median_slope_deg',     label: 'Median slope',             unit: '°',         range: [0, 45],    digits: 0 },
  { key: 'precip_log',           label: 'Precipitation (log₁₀ mm/yr)', unit: '',       range: [-3, 4],    digits: 1 },
  { key: 'soil_match',           label: 'Soil / regolith match',    unit: '0–1',       range: [0, 1],     digits: 2 },
  { key: 'sun_max_elev_deg',     label: 'Max solar elevation',      unit: '°',         range: [0, 90],    digits: 1 },
  { key: 'ground_ice',           label: 'Ground ice',               unit: '0–1',       range: [0, 1],     digits: 2 },
];

const NONE_VALUES = new Set(['', '—', '-', '–', 'none', 'null', 'na', 'n/a']);

function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (NONE_VALUES.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toBody(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s in BODIES ? s : null;
}

const str = (v) => String(v ?? '').trim();

/** Turn one raw CSV row into a Site, or null if it is unusable. */
function normalizeRow(row, index) {
  const body = toBody(row.body);
  const lat = toNumber(row.lat);
  const lon = toNumber(row.lon);
  if (!body || lat === null || lon === null) {
    console.warn('[data] skipping row', index, row);
    return null;
  }
  const params = {};
  for (const p of PARAMS) params[p.key] = toNumber(row[p.key]);

  return {
    id: `site-${index}`,
    name: String(row.name ?? `Site ${index}`).trim(),
    body,
    analog_of: toBody(row.analog_of),
    lat,
    lon,
    source: String(row.source ?? '').trim(),
    region: str(row.region),
    description: str(row.description),
    coordsVerified: str(row.coords_verified).toLowerCase() === 'yes',
    // Photos are shown for Earth sites only (Mars/Moon: none for now).
    photo: body === 'earth' && /^https:\/\//.test(str(row.photo_url))
      ? {
        url: str(row.photo_url),
        credit: str(row.photo_credit),
        license: str(row.photo_license),
        page: /^https:\/\//.test(str(row.photo_page)) ? str(row.photo_page) : '',
      }
      : null,
    params,
  };
}

/**
 * Load and parse the sites CSV.
 * NOTE: fetch/XHR does not work from file:// — serve the folder over HTTP
 * (e.g. `python -m http.server`).
 * @param {string} url
 * @returns {Promise<Site[]>}
 */
export function loadSites(url = 'data/sites.csv') {
  return new Promise((resolve, reject) => {
    if (!window.Papa) {
      reject(new Error('Papa Parse failed to load'));
      return;
    }
    window.Papa.parse(url, {
      download: true,
      header: true,
      comments: '#',
      skipEmptyLines: 'greedy',
      dynamicTyping: false, // we convert ourselves to handle "—" etc.
      complete: (res) => {
        if (res.errors?.length) console.warn('[data] CSV parse warnings', res.errors);
        resolve(res.data.map(normalizeRow).filter(Boolean));
      },
      error: (err) => reject(err),
    });
  });
}

export const sitesOnBody = (sites, body) => sites.filter((s) => s.body === body);

/** Earth sites that act as analogs of `target` ('mars' | 'moon'). */
export const analogsOf = (sites, target) =>
  sites.filter((s) => s.body === 'earth' && s.analog_of === target);

/** Format lat/lon as "24.00° S, 15.00° E". */
export function formatCoords(lat, lon, digits = 2) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}

export function formatParam(param, value) {
  if (value === null || value === undefined) return '—';
  return value.toFixed(param.digits ?? 2);
}
