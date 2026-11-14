// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

/**
 * closegap.js — the "Close the gap" module: what happens to the similarity of an Earth
 * analog with its reference (pair_id) when test-bed interventions are added.
 *
 * Data (analysis/what_if.py, never computed here):
 *   data/interventions.csv    what each intervention is, its class, source, warning
 *   data/what_if.csv          effect of every intervention alone + the default plan
 *   data/what_if_combos.csv   score and per-criterion similarity for EVERY combination of
 *                             the score-changing interventions → the toggles only look up
 * Default solution = field interventions for criteria < 0.5 (in_default = true);
 * chamber / mechanical / partial are visible but switched off.
 */
import { t, getLang, pick } from './i18n.js';
import { BODIES, CRITERIA } from './data.js';

export const CLASS_ORDER = ['field', 'chamber', 'mechanical', 'partial'];

/** Line icon: wrench (inline SVG, inherits currentColor). */
export const WRENCH_SVG = `<svg class="gap-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.6 17.1a1.8 1.8 0 0 0 2.6 2.6l5.7-5.7a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
/** Intervention text in the interface language: name / method / warning (_en, _uk columns). */
const L = (m, key) => pick(m?.[`${key}_en`] ?? '', m?.[`${key}_uk`] ?? '');
const f2 = (v) => (v === null ? '—' : Number(v).toFixed(2));
const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

/** Button for the popup and the sidebar of Earth analogs (none for Mars / Moon sites). */
export function gapButtonHtml(site) {
  const target = site.role === 'analog' ? site.analog_of : null;
  if (!target) return '';
  return `<button type="button" class="btn-gap btn-gap--${esc(target)}" data-action="close-gap" data-site="${esc(site.id)}">
    ${WRENCH_SVG}<span>${esc(t(`gap.btn.${target}`))}</span></button>`;
}

/** "a crater field", "an icy simulant…" for the summary sentence. */
function withArticle(name) {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return getLang() === 'uk' ? lower : `${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower}`;
}

function joinAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${t('gap.and')} ${items[items.length - 1]}`;
}

/**
 * Everything the module needs for one analog.
 * @returns {null | {site, ref, rows, def, ivs, defaultOn: Set, comboFor: (on:Set) => object}}
 */
export function gapModel(site, ref, whatIf) {
  if (!whatIf || !site || !ref) return null;
  const rows = whatIf.rows.filter((r) => r.analog_id === site.id);
  const def = rows.find((r) => r.intervention_id === 'default');
  if (!def) return null;
  const meta = Object.fromEntries(whatIf.interventions.map((i) => [i.intervention_id, i]));
  const ivs = rows.filter((r) => r.intervention_id !== 'default').map((r) => ({ ...r, meta: meta[r.intervention_id] }));
  const defaultOn = new Set(ivs.filter((r) => r.in_default === 'true').map((r) => r.intervention_id));
  const combos = new Map(whatIf.combos.filter((c) => c.analog_id === site.id).map((c) => [c.combo, c]));
  const scoring = new Set(ivs.filter((r) => r.meta?.sets).map((r) => r.intervention_id));
  const comboFor = (on) => combos.get([...on].filter((id) => scoring.has(id)).sort().join('+')) ?? null;
  return { site, ref, rows, def, ivs, defaultOn, comboFor };
}

/** One sentence (two at most), generated from the data. */
function summary(model, on, limits) {
  const { def, ivs, ref } = model;
  if (!def.weak_criteria) return t('gap.already');
  const before = num(def.score_before);
  const combo = model.comboFor(on);
  const after = num(combo?.score ?? def.score_before);
  const active = ivs.filter((r) => on.has(r.intervention_id));
  const parts = [];
  parts.push(active.length
    ? t('gap.sumAdd', { list: joinAnd(active.map((r) => withArticle(L(r.meta, 'name') || r.intervention_id))), gain: signed(after - before) })
    : t('gap.sumNone'));
  const crit = Object.fromEntries(CRITERIA.map((c) => [c.key, c.label]));
  const stillWeak = def.weak_criteria.split(';').filter((c) => c && num(combo?.[`s_${c}`]) !== null && num(combo[`s_${c}`]) < 0.5);
  const lowerAfterFirst = (names) => names.map((n, i) => (i ? n.charAt(0).toLowerCase() + n.slice(1) : n));
  if (stillWeak.length) parts.push(t('gap.sumWeak', { list: joinAnd(lowerAfterFirst(stillWeak.map((c) => crit[c] ?? c))) }));
  const lim = limits?.[ref.body === 'Moon' || ref.body === 'moon' ? 'moon' : 'mars'];
  const outside = (lim?.factors ?? []).filter((f) => ['atmosphere', 'radiation', 'gravity'].includes(f.id)).map((f) => f.name);
  if (outside.length) parts.push(t('gap.sumOutside', { list: joinAnd(lowerAfterFirst(outside)) }));
  return parts.join(' ');
}

/** Full module HTML for the current toggle state. */
export function renderGap(model, on, { limits, fmtCoords }) {
  const { site, ref, def, ivs } = model;
  const target = site.analog_of;
  const before = num(def.score_before);
  const combo = model.comboFor(on);
  const after = num(combo?.score ?? def.score_before);
  const baseCombo = model.comboFor(new Set());
  const crit = CRITERIA.map((c) => ({ key: c.key, label: c.label }));
  const warnings = ivs.filter((r) => on.has(r.intervention_id) && L(r.meta, 'warning'));
  const weak = new Set((def.weak_criteria || '').split(';').filter(Boolean));

  const item = (r) => {
    const m = r.meta ?? {};
    const effects = (r.criteria || '').split(';').filter(Boolean).map((c) => {
      const b = num((r.s_before.split(';').find((x) => x.startsWith(`${c}:`)) ?? '').split(':')[1]);
      const a = num((r.s_after.split(';').find((x) => x.startsWith(`${c}:`)) ?? '').split(':')[1]);
      return `<span class="cg-chip${weak.has(c) ? ' cg-chip--weak' : ''}">${esc(crit.find((x) => x.key === c)?.label ?? c)} ${f2(b)} → ${f2(a)}</span>`;
    }).join('');
    const gain = num(r.gain);
    return `
      <li class="cg-iv${on.has(r.intervention_id) ? ' is-on' : ''}">
        <label class="cg-iv__head">
          <input type="checkbox" class="cg-toggle" data-iv="${esc(r.intervention_id)}" ${on.has(r.intervention_id) ? 'checked' : ''}>
          <span class="cg-switch" aria-hidden="true"></span>
          <span class="cg-iv__name">${esc(L(m, 'name') || r.intervention_id)}</span>
          <span class="cg-iv__gain">${m.sets ? esc(signed(gain)) : esc(t('gap.noScore'))}</span>
        </label>
        ${effects ? `<div class="cg-iv__chips">${effects}</div>` : ''}
        <p class="cg-iv__method">${esc(L(m, 'method'))}</p>
        ${L(m, 'warning') ? `<p class="cg-iv__warn">⚠ ${esc(L(m, 'warning'))}</p>` : ''}
        <p class="cg-iv__src">${m.source_url ? `<a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.source)}</a>` : esc(m.source ?? '')}
          ${m.status && m.status !== 'literature' ? `<span class="cg-st">${esc(m.status)}</span>` : ''}
          ${m.effort_status === 'assumption' ? `<span class="cg-st" title="${esc(t('gap.effortTip'))}">${esc(t('gap.effort', { e: m.effort }))}</span>` : ''}</p>
      </li>`;
  };

  const groups = CLASS_ORDER.map((cls) => {
    const list = ivs.filter((r) => r.class === cls);
    if (!list.length) return '';
    const sorted = [...list].sort((a, b) => (num(a.default_rank) ?? 99) - (num(b.default_rank) ?? 99) || num(b.gain_per_effort) - num(a.gain_per_effort));
    return `<section class="cg-group cg-group--${cls}">
      <h3 class="cg-group__title">${esc(t(`gap.class.${cls}`))}</h3>
      <p class="cg-group__hint">${esc(t(`gap.classHint.${cls}`))}</p>
      <ul class="cg-list">${sorted.map(item).join('')}</ul>
    </section>`;
  }).join('');

  const rows = crit.map((c) => {
    const b = num(baseCombo?.[`s_${c.key}`]);
    const a = num(combo?.[`s_${c.key}`]);
    if (b === null) return '';
    return `<tr class="${weak.has(c.key) ? 'is-weak' : ''}">
      <th scope="row">${esc(c.label)}</th>
      <td>${f2(b)}</td>
      <td class="${a !== null && a > b ? 'is-up' : ''}">${f2(a)}</td>
      <td class="cg-mini"><span style="width:${Math.round((b ?? 0) * 100)}%"></span><span class="cg-mini__after" style="width:${Math.round((a ?? 0) * 100)}%"></span></td>
    </tr>`;
  }).join('');

  return `
    <div class="cg__panel" data-theme="${esc(target)}">
      <header class="cg__head">
        <div>
          <p class="cg__kicker">${WRENCH_SVG} ${esc(t('gap.kicker'))}</p>
          <h2 class="cg__title" id="cg-title">${esc(site.name)} <span class="cg__arrow">→</span> ${esc(ref.name)}</h2>
          <p class="cg__sub">${esc(site.region)} · ${esc(fmtCoords(site.lat, site.lon, 1))} · ${esc(t('gap.ref', { body: BODIES[target]?.short ?? target }))}</p>
        </div>
        <div class="cg__actions">
          <button type="button" class="btn" data-cg="reset">${esc(t('gap.reset'))}</button>
          <button type="button" class="btn btn--primary" data-cg="back">${esc(t('gap.back'))}</button>
        </div>
      </header>

      <section class="cg-score" aria-live="polite">
        <div class="cg-score__label">${esc(t('gap.similarity'))}
          <strong class="cg-score__nums"><span data-cg-before>${f2(before)}</span> → <span data-cg-after data-to="${after}">${f2(after)}</span></strong>
          <span class="cg-score__gain">${esc(signed(after - before))}</span>
        </div>
        <div class="cg-bar" role="img" aria-label="${esc(t('gap.barAria', { a: f2(before), b: f2(after) }))}">
          <span class="cg-bar__before" style="width:${Math.round(before * 100)}%"></span>
          <span class="cg-bar__after" data-w="${Math.round(after * 100)}" style="width:${Math.round(before * 100)}%"></span>
        </div>
        <p class="cg-summary">${esc(summary(model, on, limits))}</p>
        ${warnings.length ? `<div class="cg-warnings">${warnings.map((r) => `<p>⚠ <strong>${esc(L(r.meta, 'name'))}:</strong> ${esc(L(r.meta, 'warning'))}</p>`).join('')}</div>` : ''}
      </section>

      <div class="cg__grid">
        <div class="cg__ivs">${groups}</div>
        <section class="cg-criteria">
          <h3 class="cg-group__title">${esc(t('gap.criteria'))}</h3>
          <table class="cg-table">
            <thead><tr><th></th><th>${esc(t('gap.before'))}</th><th>${esc(t('gap.after'))}</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="cg-group__hint">${esc(t('gap.criteriaHint'))}</p>
        </section>
      </div>
    </div>`;
}

/** Animate the "after" bar and number from the before value (instant with reduced motion). */
export function animateGap(root, reduced) {
  const bar = root.querySelector('.cg-bar__after');
  const out = root.querySelector('[data-cg-after]');
  const from = Number(root.querySelector('[data-cg-before]')?.textContent);
  const to = Number(out?.dataset.to);
  if (!bar || !out) return;
  if (reduced) { bar.style.width = `${bar.dataset.w}%`; return; }
  requestAnimationFrame(() => { bar.style.width = `${bar.dataset.w}%`; });
  const t0 = performance.now();
  const dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - (1 - k) ** 3;
    out.textContent = (from + (to - from) * e).toFixed(2);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
