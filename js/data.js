// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

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
 *
 * Labels shown in the UI are getters over js/i18n.js, so they follow the language switch.
 */
import { t, pick } from './i18n.js';

/** @typedef {'earth'|'mars'|'moon'} Body */

/**
 * @typedef {Object} Site
 * @property {string} id            site_id
 * @property {string} name          name_uk or name_en, by interface language (getter)
 * @property {string} nameAlt       the other-language name (getter)
 * @property {string} nameEn        name_en
 * @property {string} nameUk        name_uk
 * @property {Body} body
 * @property {'reference'|'analog'} role
 * @property {string|null} pairId   analogs: the reference this analog was chosen for
 * @property {Body|null} analog_of  analogs: body of their paired reference
 * @property {number} lat
 * @property {number} lon
 * @property {string} region        region (English in the CSV; translated via i18n, getter)
 * @property {string} description   desc_uk / desc_en (getter)
 * @property {string} limits        limits_uk / limits_en (getter)
 * @property {{img:string, page:string, author:string, license:string}|null} photo
 * @property {Object<string, number|string|null>} values  raw columns keyed by PARAMS[].key
 * @property {Object<string, string>} status              status_* columns without the prefix
 */

export const BODIES = {
  earth: {},
  mars: {},
  moon: {},
};
for (const [key, b] of Object.entries(BODIES)) {
  Object.defineProperties(b, {
    label: { get: () => t(`bodyLong.${key}`), enumerable: true },
    short: { get: () => t(`body.${key}`), enumerable: true },
  });
}

/** Make `label` (and optionally other fields) follow the interface language. */
function localize(list, prefix) {
  for (const item of list) {
    Object.defineProperty(item, 'label', { get: () => t(`${prefix}.${item.key}`), enumerable: true, configurable: true });
  }
}

/**
 * Raw parameters as shown in the sidebar. `status` = suffix of the status_*
 * column that describes the value (null = the CSV has no status for it).
 */
export const PARAMS = [
  { key: 't_surf_min_c', unit: '°C',        digits: 1, status: 'temp' },
  { key: 't_surf_mean_c', unit: '°C',        digits: 1, status: 'temp' },
  { key: 't_surf_max_c', unit: '°C',        digits: 1, status: 'temp' },
  { key: 'crater_density_1e6km2', unitKey: 'unit.km2',  digits: 0, status: 'craters' },
  { key: 'slope_mean_deg', unit: '°',         digits: 1, status: 'slope' },
  { key: 'relief_m', unitKey: 'unit.m',    digits: 0, status: null },
  { key: 'ice_water_frac', unit: '',          digits: 3, status: 'ice' },
  { key: 'aridity_ai', unit: '',          digits: 2, status: null },
  { key: 'rock_class', unit: '',          text: true, status: 'rock' },
  { key: 'sun_elev_max_deg', unit: '°',         digits: 2, status: 'sun' },
  { key: 'sun_elev_min_deg', unit: '°',         digits: 2, status: 'sun' },
];
localize(PARAMS, 'param');
for (const p of PARAMS) if (p.unitKey) Object.defineProperty(p, 'unit', { get: () => t(p.unitKey), enumerable: true });
export const PARAM = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

/**
 * Similarity criteria (columns s_<key> in scores.csv), each 0..1.
 * `raw` = parameter used to tell whether the analog is higher or lower than the
 * reference (for the "How to close the gap" advice).
 */
export const CRITERIA = [
  { key: 'temp_mean', short: 'T mean',   raw: (s) => s.values.t_surf_mean_c,  status: 'temp' },
  { key: 'temp_range', short: 'T range',  raw: (s) => diff(s.values.t_surf_max_c, s.values.t_surf_min_c), status: 'temp' },
  { key: 'craters', short: 'Craters',  raw: (s) => s.values.crater_density_1e6km2, status: 'craters' },
  { key: 'slope', short: 'Slope',    raw: (s) => s.values.slope_mean_deg, status: 'slope' },
  { key: 'relief', short: 'Relief',   raw: (s) => s.values.relief_m,       status: null },
  { key: 'ice', short: 'Ice',      raw: (s) => s.values.ice_water_frac, status: 'ice' },
  { key: 'sun', short: 'Sun',      raw: (s) => s.values.sun_elev_max_deg, status: 'sun' },
  { key: 'rock', short: 'Rock',     raw: () => null,                     status: 'rock' },
];
localize(CRITERIA, 'crit');
function diff(a, b) { return a === null || b === null ? null : a - b; }

/**
 * Weighting scenarios — MUST mirror SCENARIOS in analysis/metrics.py.
 * Used only to explain scores (gain per criterion); the scores themselves come
 * from scores.csv, and loadAll() warns if they disagree with these weights.
 */
export const SCENARIOS = {
  equal: { weights: { temp_mean: 1, temp_range: 0.5, craters: 1, slope: 1, relief: 1, ice: 1, sun: 1, rock: 1 } },
  moon_base: { weights: { temp_mean: 1, temp_range: 1, craters: 1, slope: 1, relief: 0.5, ice: 3, sun: 3, rock: 1 } },
  mars_landing: { weights: { temp_mean: 1, temp_range: 0.5, craters: 1, slope: 3, relief: 2, ice: 1, sun: 0.5, rock: 2 } },
};
for (const [key, sc] of Object.entries(SCENARIOS)) Object.defineProperty(sc, 'label', { get: () => t(`scenario.${key}`), enumerable: true });
/** Scenario used for each reference body in ranking.csv (TARGET_SCENARIO in metrics.py). */
export const BODY_SCENARIO = { mars: 'mars_landing', moon: 'moon_base' };

/**
 * Status badges. literature = green, computed = blue, anything else
 * (test, estimate_*, unknown) = grey placeholder.
 */
const STATUS_KINDS = {
  literature: { kind: 'literature', label: 'status.literature', tip: 'status.literatureTip' },
  computed: { kind: 'computed', label: 'status.computed', tip: 'status.computedTip' },
  topographic_shadow: { kind: 'computed', label: 'status.computed', tip: 'status.shadowTip' },
};

/** @returns {{kind:'literature'|'computed'|'placeholder', label:string, tip:string}|null} */
export function statusInfo(code) {
  if (!code) return null;
  const known = STATUS_KINDS[code];
  if (known) return { kind: known.kind, label: t(known.label), tip: t(known.tip) };
  const detail = code === 'test' ? '' : ` (${code.replace(/_/g, ' ')})`;
  return { kind: 'placeholder', label: t(code.startsWith('estimate') ? 'status.estimate' : 'status.test'), tip: t('status.placeholder') + detail };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Site version from <meta name="app-version"> (tools/bump_version.py); busts the 10-min Pages cache. */
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content ?? '';
export const withVersion = (url) => (APP_VERSION && APP_VERSION !== '0' ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(APP_VERSION)}` : url);

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
  for (const [k, v] of Object.entries(row)) if (k.startsWith('status_') && k !== 'status_life' && str(v)) status[k.slice(7)] = str(v); // status_life: habitability, not a value badge

  return {
    id,
    nameEn: str(row.name_en) || id,
    nameUk: str(row.name_uk),
    get name() { return pick(this.nameEn, this.nameUk); },
    get nameAlt() { const n = pick(this.nameUk, this.nameEn); return n === this.name ? '' : n; },
    body,
    role: str(row.role) === 'reference' ? 'reference' : 'analog',
    pairId: str(row.pair_id) || null,
    analog_of: null, // filled in loadAll() from the paired reference
    lat,
    lon,
    regionEn: str(row.region),
    get region() { return this.regionEn ? t(`region.${this.regionEn}`) : ''; },
    descEn: str(row.desc_en),
    descUk: str(row.desc_uk),
    get description() { return pick(this.descEn, this.descUk); },
    limitsEn: str(row.limits_en),
    limitsUk: str(row.limits_uk),
    get limits() { return pick(this.limitsEn, this.limitsUk); },
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
    window.Papa.parse(withVersion(url), {
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

/**
 * "Limits of the analogy" (data/limits.json, English version of docs/limits_*.pdf;
 * data/limits_uk.json is its Ukrainian translation, checked by tools/check_limits_uk.py).
 * Optional: if the file is missing, the site works without the limits sections.
 * @returns {Promise<{mars: object, moon: object}|null>}
 */
export function loadLimits(url = 'data/limits.json') {
  return loadJsonOptional(url);
}

/** Fetch a JSON file; null (and a console warning) if it is missing or broken. */
export async function loadJsonOptional(url) {
  try {
    const res = await fetch(withVersion(url));
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[data] ${url} not loaded`, err);
    return null;
  }
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
  const ns = t(lat >= 0 ? 'coord.N' : 'coord.S');
  const ew = t(lon >= 0 ? 'coord.E' : 'coord.W');
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}

/** "glacial_till" → "glacial till" / "льодовикова морена" (unknown classes: underscores → spaces) */
export const prettyRock = (v) => {
  if (!v) return '—';
  const key = `rock.${v}`;
  const s = t(key);
  return s === key ? String(v).replace(/_/g, ' ') : s;
};

export function formatValue(param, value) {
  if (value === null || value === undefined) return '—';
  if (param.text) return prettyRock(value);
  return Number(value).toFixed(param.digits ?? 2);
}
