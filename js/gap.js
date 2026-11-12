/**
 * gap.js — "How to close the gap": rule-based recommendations.
 *
 * For every mismatching parameter we know whether the Earth analog is too
 * HIGH or too LOW compared with the target, and look up advice in GAP_RULES.
 *
 * GAP_RULES[paramKey][direction] = {
 *   summary:  short phrase shown as the card title suffix,
 *   closable: 'yes' | 'partly' | 'no'   (can fieldwork on Earth fix it?),
 *   tips:     Tip[]                     (shared by Mars and Moon)
 *   mars?/moon?: Tip[]                  (extra tips for that target only)
 * }
 * Tip = { kind: 'site' | 'season' | 'equipment' | 'lab' | 'analysis', text }
 *
 * To add advice: append a Tip. To add a parameter: add a key matching
 * PARAMS[].key in data.js. Missing rules fall back to a generic tip.
 * TODO: review texts with the team / domain experts; add references.
 */

export const TIP_KINDS = {
  site: 'Site choice',
  season: 'Timing',
  equipment: 'Equipment',
  lab: 'Lab / simulant',
  analysis: 'Analysis',
};

export const CLOSABLE_LABELS = {
  yes: 'Closable in the field',
  partly: 'Partly closable',
  no: 'Hard to close on Earth',
};

export const GAP_RULES = {
  surface_temp_mean_c: {
    higher: {
      summary: 'too warm',
      closable: 'partly',
      tips: [
        { kind: 'season', text: 'Schedule the campaign in the coldest season (polar or high-altitude winter).' },
        { kind: 'lab', text: 'Qualify hardware in a cold chamber at target temperatures before and after field tests.' },
      ],
      moon: [
        { kind: 'lab', text: 'Lunar polar cold traps (below −200 °C) are out of reach outdoors — use cryogenic vacuum chambers.' },
      ],
    },
    lower: {
      summary: 'too cold',
      closable: 'yes',
      tips: [
        { kind: 'season', text: 'Move the campaign to a warmer season or a lower-latitude sub-site.' },
      ],
    },
  },

  surface_temp_range_c: {
    lower: {
      summary: 'temperature swing too small',
      closable: 'partly',
      tips: [
        { kind: 'lab', text: 'Add thermal-cycling tests that reproduce the target’s day–night swing.' },
        { kind: 'site', text: 'Prefer high, dry, clear-sky sites where diurnal swings are largest.' },
      ],
    },
    higher: {
      summary: 'temperature swing too large',
      closable: 'yes',
      tips: [
        { kind: 'season', text: 'Pick a period with stable weather; insulate instruments against extremes.' },
      ],
    },
  },

  crater_density: {
    lower: {
      summary: 'too few craters',
      closable: 'partly',
      tips: [
        { kind: 'site', text: 'Pair the site with a terrestrial impact structure (e.g. Haughton, Mistastin, Meteor Crater).' },
        { kind: 'equipment', text: 'Build an artificial crater field / obstacle course for rover navigation tests.' },
        { kind: 'analysis', text: 'Treat cratering-dependent results (regolith depth, hazard maps) as not transferable.' },
      ],
    },
    higher: {
      summary: 'too many craters',
      closable: 'yes',
      tips: [
        { kind: 'site', text: 'Restrict tests to smoother inter-crater terrain.' },
      ],
    },
  },

  median_slope_deg: {
    lower: {
      summary: 'terrain too flat',
      closable: 'yes',
      tips: [
        { kind: 'site', text: 'Use a steeper sub-area: crater walls, moraines, dune slip faces, canyon slopes.' },
        { kind: 'equipment', text: 'Run mobility tests on a tilt table at the target slope angles.' },
      ],
    },
    higher: {
      summary: 'terrain too steep',
      closable: 'yes',
      tips: [
        { kind: 'site', text: 'Plan traverses over flatter ground (valley floors, plains).' },
      ],
    },
  },

  precip_log: {
    higher: {
      summary: 'too wet',
      closable: 'partly',
      tips: [
        { kind: 'season', text: 'Run the campaign in the driest season and avoid post-rain days.' },
        { kind: 'equipment', text: 'Store samples sealed and desiccated; protect instruments from moisture.' },
        { kind: 'analysis', text: 'Flag aqueous alteration and biology — they have no present-day counterpart at the target.' },
      ],
      mars: [
        { kind: 'site', text: 'Hyper-arid cores (Atacama, Dry Valleys) get closest to Mars dryness.' },
      ],
    },
    lower: {
      summary: 'too dry',
      closable: 'yes',
      tips: [
        { kind: 'analysis', text: 'Rare case — check the data; the target should not be wetter than Earth.' },
      ],
    },
  },

  soil_match: {
    lower: {
      summary: 'soil differs from regolith',
      closable: 'partly',
      tips: [
        { kind: 'site', text: 'Sample a sub-site with closer mineralogy and grain size.' },
      ],
      mars: [
        { kind: 'lab', text: 'Use a Mars regolith simulant (e.g. MGS-1) in test beds for wheels, drills and ISRU.' },
        { kind: 'site', text: 'Look for basaltic soils and sulfate/clay deposits.' },
      ],
      moon: [
        { kind: 'lab', text: 'Use lunar simulants (e.g. LHS-1 for highlands, LMS-1 / JSC-1A for mare) for excavation and dust tests.' },
        { kind: 'site', text: 'Anorthosite outcrops (e.g. Mistastin) best match lunar highland rock.' },
      ],
    },
    higher: {
      summary: 'soil match higher than target',
      closable: 'yes',
      tips: [
        { kind: 'analysis', text: 'Check the data: soil_match for target sites should be 1.' },
      ],
    },
  },

  sun_max_elev_deg: {
    higher: {
      summary: 'Sun too high',
      closable: 'partly',
      tips: [
        { kind: 'season', text: 'Test near polar winter or at dawn / dusk to get low Sun angles and long shadows.' },
      ],
      moon: [
        { kind: 'equipment', text: 'Use low-angle artificial lighting rigs to test vision-based navigation in grazing light.' },
        { kind: 'analysis', text: 'Lunar south pole Sun stays within ~1.5° of the horizon — no Earth site reproduces it all day.' },
      ],
      mars: [
        { kind: 'site', text: 'Move to a higher latitude closer to the target’s.' },
      ],
    },
    lower: {
      summary: 'Sun too low',
      closable: 'yes',
      tips: [
        { kind: 'season', text: 'Shift to summer or to a lower-latitude sub-site.' },
      ],
    },
  },

  ground_ice: {
    lower: {
      summary: 'not enough ground ice',
      closable: 'partly',
      tips: [
        { kind: 'site', text: 'Choose a permafrost site or ice-cemented ground nearby.' },
        { kind: 'equipment', text: 'Bury prepared ice-bearing samples to test drills and ice prospecting.' },
      ],
    },
    higher: {
      summary: 'too much ground ice',
      closable: 'yes',
      tips: [
        { kind: 'site', text: 'Pick an ice-free sub-area or a warmer season.' },
      ],
    },
  },
};

const GENERIC = {
  summary: 'differs from target',
  closable: 'partly',
  tips: [{ kind: 'analysis', text: 'No specific advice yet — account for this difference when interpreting results.' }],
};

/**
 * Advice for one mismatching parameter.
 * @param {string} paramKey
 * @param {number} earthValue   value at the Earth analog
 * @param {number} targetValue  value at the Mars / Moon site
 * @param {'mars'|'moon'} body
 * @returns {{direction:'higher'|'lower', summary:string, closable:string, tips:{kind:string,text:string}[]}}
 */
export function gapAdvice(paramKey, earthValue, targetValue, body) {
  const direction = earthValue > targetValue ? 'higher' : 'lower';
  const rule = GAP_RULES[paramKey]?.[direction] ?? GENERIC;
  return {
    direction,
    summary: rule.summary,
    closable: rule.closable,
    tips: [...(rule[body] ?? []), ...rule.tips],
  };
}
