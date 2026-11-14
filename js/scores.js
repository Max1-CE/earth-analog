/**
 * scores.js — queries over scores.csv / ranking.csv (computed by analysis/metrics.py).
 *
 * The site does not compute similarity itself: every number comes from the CSVs.
 * Scenario choice:
 *   'auto'  → each reference uses its body's scenario (Mars: mars_landing,
 *             Moon: moon_base), exactly as in ranking.csv;
 *   other   → that scenario for every reference (equal / moon_base / mars_landing).
 */
import { CRITERIA, SCENARIOS, BODY_SCENARIO } from './data.js';
import { t } from './i18n.js';

/** Scenario choices for the selects; labels follow the interface language. */
export const SCENARIO_CHOICES = ['auto', ...Object.keys(SCENARIOS)].map((key) => ({
  key,
  get label() { return t(`scenario.${key}`); },
}));

/** A criterion "matches" when its similarity s is at least this value. */
export const MATCH_THRESHOLD = 0.7;

/** Qualitative bands for the UI (checked top-down). */
export const SIMILARITY_LEVELS = [
  { min: 0.8, key: 'high' },
  { min: 0.6, key: 'moderate' },
  { min: 0, key: 'low' },
];
for (const l of SIMILARITY_LEVELS) Object.defineProperty(l, 'label', { get: () => t(`level.${l.key}`), enumerable: true });
export function similarityLevel(score) {
  if (score === null || score === undefined) return null;
  return SIMILARITY_LEVELS.find((l) => score >= l.min) ?? null;
}

export class ScoreBook {
  /**
   * @param {{sites: object[], scores: object[], ranking: object[]}} data
   */
  constructor({ sites, scores, ranking }) {
    this.sites = new Map(sites.map((s) => [s.id, s]));
    this.scores = scores;
    this.ranking = ranking;
    this._idx = new Map(scores.map((r) => [`${r.analogId}|${r.referenceId}|${r.scenario}`, r]));
  }

  /** Concrete scenario for a reference under a UI choice ('auto' | scenario key). */
  scenarioFor(referenceId, choice = 'auto') {
    if (choice !== 'auto') return choice;
    return BODY_SCENARIO[this.sites.get(referenceId)?.body] ?? 'equal';
  }

  get(analogId, referenceId, choice = 'auto') {
    return this._idx.get(`${analogId}|${referenceId}|${this.scenarioFor(referenceId, choice)}`) ?? null;
  }

  /**
   * Analogs ranked for one reference, best first.
   * In 'auto' the order and ranks come straight from ranking.csv; for an explicit
   * scenario they are sorted from scores.csv (same method: rank 'min').
   */
  rankingFor(referenceId, choice = 'auto') {
    let rows;
    if (choice === 'auto') {
      rows = this.ranking.filter((r) => r.referenceId === referenceId);
    } else {
      rows = this.scores
        .filter((r) => r.referenceId === referenceId && r.scenario === choice)
        .sort((a, b) => b.score - a.score);
      rows = rows.map((r) => ({ ...r, rank: 1 + rows.filter((q) => q.score > r.score).length }));
    }
    return rows.map((r) => ({ ...r, analog: this.sites.get(r.analogId) }));
  }

  /** All references scored for one analog, best first. */
  referencesFor(analogId, choice = 'auto') {
    const refIds = [...new Set(this.scores.map((r) => r.referenceId))];
    return refIds
      .map((id) => this.get(analogId, id, choice))
      .filter(Boolean)
      .map((r) => ({ ...r, reference: this.sites.get(r.referenceId) }))
      .sort((a, b) => b.score - a.score);
  }

  analogIds() { return [...new Set(this.scores.map((r) => r.analogId))]; }
  referenceIds() { return [...new Set(this.scores.map((r) => r.referenceId))]; }
}

/**
 * Per-criterion breakdown of one score row.
 * gain  = how much the total would rise if this criterion matched exactly (s = 1);
 * share = this criterion's part of the total weighted shortfall Σ w(1 − s).
 * @returns {{matches: Item[], mismatches: Item[], skipped: Item[], weights: object}}
 *   Item = {crit, s, weight, gain, share}
 */
export function breakdown(row) {
  const weights = SCENARIOS[row.scenario]?.weights ?? {};
  const items = CRITERIA.map((crit) => ({ crit, s: row.s[crit.key], weight: weights[crit.key] ?? 0, gain: 0, share: 0 }));
  const used = items.filter((i) => i.s !== null && i.weight > 0);
  const W = used.reduce((a, i) => a + i.weight, 0);
  const shortfall = used.reduce((a, i) => a + i.weight * (1 - i.s), 0);
  for (const i of used) {
    i.gain = W ? (i.weight * (1 - i.s)) / W : 0;
    i.share = shortfall ? (i.weight * (1 - i.s)) / shortfall : 0;
  }
  return {
    weights,
    matches: used.filter((i) => i.s >= MATCH_THRESHOLD).sort((a, b) => b.weight - a.weight || b.s - a.s),
    mismatches: used.filter((i) => i.s < MATCH_THRESHOLD).sort((a, b) => b.gain - a.gain),
    skipped: items.filter((i) => !used.includes(i)),
  };
}
