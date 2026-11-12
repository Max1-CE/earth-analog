/**
 * similarity.js — Earth-analog similarity index (STUB).
 *
 *   S = 1 - sqrt( Σ w_i (x_i - y_i)² / Σ w_i )
 *
 * x_i, y_i are parameters of the candidate site and the target site,
 * each normalized to 0..1 using PARAMS[].range from data.js.
 * S = 1 → identical, S = 0 → maximally different (on the chosen ranges).
 *
 * TODO: per-target weight presets (Mars vs Moon care about different things).
 * TODO: per-parameter contribution breakdown for "What matches / What doesn't".
 * TODO: decide how to treat missing values (currently: parameter is skipped).
 */
import { PARAMS } from './data.js';

/**
 * Weights configuration. Keys must match PARAMS[].key.
 * 0 disables a parameter. Values are relative — they don't need to sum to 1.
 */
export const WEIGHTS = {
  default: {
    surface_temp_mean_c: 1,
    surface_temp_range_c: 1,
    crater_density: 1,
    median_slope_deg: 1,
    precip_log: 1,
    soil_match: 1,
    sun_max_elev_deg: 1,
    ground_ice: 1,
  },
  // TODO: tune with the team
  mars: {
    surface_temp_mean_c: 1,
    surface_temp_range_c: 0.5,
    crater_density: 0.5,
    median_slope_deg: 0.5,
    precip_log: 2,
    soil_match: 2,
    sun_max_elev_deg: 0.25,
    ground_ice: 1,
  },
  moon: {
    surface_temp_mean_c: 1,
    surface_temp_range_c: 1,
    crater_density: 1,
    median_slope_deg: 1,
    precip_log: 1,
    soil_match: 1.5,
    sun_max_elev_deg: 2, // low sun angle is the defining south-pole feature
    ground_ice: 1.5,
  },
};

/** Clamp-normalize a value to 0..1 on [min, max]. */
export function normalize(value, [min, max]) {
  if (value === null || value === undefined || max === min) return null;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Per-parameter normalized differences. Useful for charts and explanations.
 * @returns {{key:string, label:string, x:number|null, y:number|null, diff:number|null, weight:number}[]}
 */
export function parameterDiffs(site, target, weights = WEIGHTS.default) {
  return PARAMS.map((p) => {
    const x = normalize(site.params[p.key], p.range);
    const y = normalize(target.params[p.key], p.range);
    const diff = x === null || y === null ? null : Math.abs(x - y);
    return { key: p.key, label: p.label, x, y, diff, weight: weights[p.key] ?? 0 };
  });
}

/**
 * Similarity index with bookkeeping.
 * @returns {{score: number|null, used: number, total: number}}
 *   used = parameters that entered the sum (both values present, weight > 0)
 */
export function similarityDetails(site, target, weights = WEIGHTS.default) {
  let num = 0;
  let den = 0;
  let used = 0;
  const diffs = parameterDiffs(site, target, weights);
  for (const d of diffs) {
    if (d.diff === null || d.weight <= 0) continue;
    num += d.weight * d.diff * d.diff;
    den += d.weight;
    used++;
  }
  return { score: den === 0 ? null : 1 - Math.sqrt(num / den), used, total: diffs.length };
}

/**
 * Similarity index between a candidate site and a target site.
 * @param {import('./data.js').Site} site
 * @param {import('./data.js').Site} target
 * @param {Object<string, number>} [weights]
 * @returns {number|null} 0..1, or null if no comparable parameters
 */
export function similarity(site, target, weights = WEIGHTS.default) {
  return similarityDetails(site, target, weights).score;
}

/* ------------------------------------------------------------------ */
/* What matches / What doesn't                                         */
/* ------------------------------------------------------------------ */

/**
 * A parameter "matches" when its normalized difference |x − y| is at most
 * this value (0..1 on the PARAMS range). TODO: tune per parameter if needed.
 */
export const MATCH_THRESHOLD = 0.2;

/**
 * Split parameters into matches / mismatches / skipped for a site pair.
 * `share` = this parameter's part of the total weighted gap Σ w·d², so the
 * biggest drivers of a low index stand out (useful for "How to close the gap").
 *
 * @returns {{
 *   matches: Item[], mismatches: Item[], skipped: Item[]
 * }} where Item = {param, a, b, diff, weight, share}
 *   a = value at `site`, b = value at `other` (raw units)
 *   matches sorted by weight desc, then diff asc; mismatches by share desc.
 */
export function compareParameters(site, other, weights = WEIGHTS.default, threshold = MATCH_THRESHOLD) {
  const items = PARAMS.map((param) => {
    const a = site.params[param.key];
    const b = other.params[param.key];
    const x = normalize(a, param.range);
    const y = normalize(b, param.range);
    const diff = x === null || y === null ? null : Math.abs(x - y);
    return { param, a, b, diff, weight: weights[param.key] ?? 0, share: 0 };
  });

  const compared = items.filter((i) => i.diff !== null && i.weight > 0);
  const gap = compared.reduce((s, i) => s + i.weight * i.diff ** 2, 0);
  const wsum = compared.reduce((s, i) => s + i.weight, 0);
  if (gap > 0) compared.forEach((i) => { i.share = (i.weight * i.diff ** 2) / gap; });
  // How much the index would rise if this parameter alone matched exactly
  compared.forEach((i) => { i.gain = scoreWithout({ gap, wsum }, [i]) - scoreWithout({ gap, wsum }, []); });

  return {
    gap,
    wsum,
    matches: compared
      .filter((i) => i.diff <= threshold)
      .sort((p, q) => q.weight - p.weight || p.diff - q.diff),
    mismatches: compared
      .filter((i) => i.diff > threshold)
      .sort((p, q) => q.share - p.share),
    skipped: items.filter((i) => !compared.includes(i)),
  };
}

/**
 * Index that would result if the given compared items matched exactly
 * (their w·d² removed from the gap, weights kept).
 * @param {{gap:number, wsum:number}} cmp  result of compareParameters()
 * @param {{weight:number, diff:number}[]} fixed
 */
export function scoreWithout({ gap, wsum }, fixed) {
  if (!wsum) return null;
  const rest = gap - fixed.reduce((s, i) => s + i.weight * i.diff ** 2, 0);
  return 1 - Math.sqrt(Math.max(0, rest) / wsum);
}

/* ------------------------------------------------------------------ */
/* Pairing: which sites a site is compared against                     */
/* ------------------------------------------------------------------ */

/**
 * Qualitative bands for the UI. Checked top-down; first `min` that fits wins.
 * TODO: calibrate thresholds once real data is in.
 */
export const SIMILARITY_LEVELS = [
  { min: 0.8, key: 'high', label: 'High' },
  { min: 0.6, key: 'moderate', label: 'Moderate' },
  { min: 0, key: 'low', label: 'Low' },
];

export function similarityLevel(score) {
  if (score === null || score === undefined) return null;
  return SIMILARITY_LEVELS.find((l) => score >= l.min) ?? null;
}

/**
 * The body whose conditions define the comparison (and the weight preset):
 * an Earth analog → the body it imitates; a Mars/Moon site → its own body.
 * @returns {'mars'|'moon'|null}
 */
export function comparisonBody(site) {
  if (site.body === 'earth') return site.analog_of ?? null;
  return site.body;
}

/**
 * Sites to compare `site` with:
 *   Earth analog of X → all target sites on X;
 *   target site on X  → all Earth analogs of X.
 */
export function comparisonCandidates(site, sites) {
  const body = comparisonBody(site);
  if (!body) return [];
  return site.body === 'earth'
    ? sites.filter((s) => s.body === body)
    : sites.filter((s) => s.body === 'earth' && s.analog_of === body);
}

/**
 * Rank all candidates by similarity, best first. Sites with no comparable
 * parameters are listed last with score null.
 * The Earth site is always passed as the first argument so the formula's
 * direction is consistent (it is symmetric anyway).
 * @returns {{target: object, score: number|null, used: number, total: number}[]}
 */
/** Weight preset for a comparison body ('mars' | 'moon'), falling back to default. */
export function weightsFor(body, weightsConfig = WEIGHTS) {
  return weightsConfig[body] ?? weightsConfig.default;
}

export function rankMatches(site, sites, weightsConfig = WEIGHTS) {
  const weights = weightsFor(comparisonBody(site), weightsConfig);
  return comparisonCandidates(site, sites)
    .map((other) => {
      const [earth, target] = site.body === 'earth' ? [site, other] : [other, site];
      return { target: other, ...similarityDetails(earth, target, weights) };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
