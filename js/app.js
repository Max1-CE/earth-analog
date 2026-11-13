/**
 * app.js — application state, view switching, theming, sidebar and Analysis view.
 *
 * Flow: loadAll() → state.sites + ScoreBook → MapViews created lazily when shown →
 *       marker click → popup → "More details" → selectSite() → renderSidebar().
 *       Analysis tab → renderAnalysis() (js/charts.js).
 */
import {
  loadAll, loadLimits, BODIES, PARAMS, CRITERIA, SCENARIOS, statusInfo, sitesOnBody, references, analogsOf,
  formatCoords, formatValue,
} from './data.js';
import { MapView, mapKeyFor, projectionControl } from './maps.js';
import { ScoreBook, SCENARIO_CHOICES, breakdown, similarityLevel, MATCH_THRESHOLD } from './scores.js';
import { gapAdvice, TIP_KINDS } from './gap.js';
import { rankingChart, radarChart, heatmapChart, rawCharts, downloadPng, destroyAll, RAW_GROUPS } from './charts.js';

const VIEWS = ['earth', 'mars', 'moon', 'compare', 'analysis'];

const state = {
  view: 'earth',          // one of VIEWS
  compareTarget: 'mars',  // 'mars' | 'moon'
  moonProjection: 'polar', // 'polar' (south polar stereographic) | 'global' (equirectangular)
  scenario: 'auto',       // 'auto' | key of SCENARIOS
  sites: [],
  book: null,             // ScoreBook
  limits: null,           // data/limits.json ({mars, moon}) or null
  selected: null,         // Site shown in the sidebar
  referenceId: null,      // reference used for the selected analog (null = its pair)
  analysis: { referenceId: null, analogId: null }, // Analysis view selection
};

/** @type {Record<string, MapView>} single-view maps, keyed by body */
const singleMaps = {};
/** @type {{earth: MapView|null, target: MapView|null}} */
const compareMaps = { earth: null, target: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const byId = (id) => state.sites.find((s) => s.id === id) ?? null;

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function analysisReference() { return byId(state.analysis.referenceId); }

function currentTheme() {
  if (state.view === 'compare') return state.compareTarget;
  if (state.view === 'analysis') return analysisReference()?.body ?? 'mars';
  return state.view;
}

function applyTheme() {
  // Compare: UI takes the target's theme (each pane keeps its own).
  // Analysis: the theme of the selected reference's body.
  document.body.dataset.theme = currentTheme();
  $('#analysis-view').dataset.theme = currentTheme();
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

/** Earth map: analogs; Mars / Moon maps: references. */
function sitesFor(body, { compare = false } = {}) {
  if (body === 'earth') {
    return compare ? analogsOf(state.sites, state.compareTarget) : sitesOnBody(state.sites, 'earth');
  }
  return sitesOnBody(state.sites, body).filter((s) => s.role === 'reference');
}

function controlsFor(body) {
  if (body !== 'moon') return [];
  return [projectionControl(state.moonProjection, (p) => {
    state.moonProjection = p;
    render();
  })];
}

function ensureMap(existing, el, body) {
  const key = mapKeyFor(body, state.moonProjection);
  if (existing && existing.mapKey === key) return existing;
  existing?.destroy(); // different CRS/tiles → rebuild
  return new MapView(el, key, { onSelect: selectSite, popup: sitePopup, controls: controlsFor(body) });
}

function ensureSingleMap(body) {
  const before = singleMaps[body];
  singleMaps[body] = ensureMap(before, $(`#map-${body}`), body);
  if (singleMaps[body] !== before) singleMaps[body].setSites(sitesFor(body));
  return singleMaps[body];
}

function ensureCompareMaps() {
  compareMaps.earth = ensureMap(compareMaps.earth, $('#map-compare-earth'), 'earth');
  compareMaps.earth.setSites(sitesFor('earth', { compare: true }));

  const target = state.compareTarget;
  const pane = $('#compare-target-pane');
  pane.dataset.theme = target;
  pane.dataset.body = target;
  $('#compare-target-label').textContent = BODIES[target].short;
  compareMaps.target = ensureMap(compareMaps.target, $('#map-compare-target'), target);
  compareMaps.target.setSites(sitesFor(target));
}

function visibleMaps() {
  if (state.view === 'analysis') return [];
  return state.view === 'compare'
    ? [compareMaps.earth, compareMaps.target].filter(Boolean)
    : [singleMaps[state.view]].filter(Boolean);
}

function render() {
  applyTheme();

  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === state.view)));
  $$('#compare-bar .segmented__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.target === state.compareTarget)));

  const isCompare = state.view === 'compare';
  const isAnalysis = state.view === 'analysis';
  $('#single-view').hidden = isCompare || isAnalysis;
  $('#compare-view').hidden = !isCompare;
  $('#compare-bar').hidden = !isCompare;
  $('#analysis-view').hidden = !isAnalysis;

  if (isAnalysis) {
    renderAnalysis();
  } else {
    destroyAll(); // charts are rebuilt when the tab is shown again
    if (isCompare) {
      ensureCompareMaps();
    } else {
      $$('#single-view .map-pane').forEach((p) => { p.hidden = p.dataset.body !== state.view; });
      ensureSingleMap(state.view);
    }
    // Leaflet needs a size recalculation after display changes.
    requestAnimationFrame(() => {
      visibleMaps().forEach((m) => {
        m.invalidate();
        m.highlight(state.selected?.id);
      });
      if (isCompare) compareMaps.earth.fitToSites();
    });
  }
  writeHash();
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtScore = (s) => (s === null || s === undefined ? '—' : Number(s).toFixed(2));
const scenarioName = (key) => SCENARIOS[key]?.label ?? key;

/** Small status badge: L = literature (green), C = computed (blue), grey = placeholder. */
function statusBadge(code) {
  const st = statusInfo(code);
  if (!st) return '';
  const letter = st.kind === 'literature' ? 'L' : st.kind === 'computed' ? 'C' : st.label === 'Estimate' ? 'E' : 'T';
  return `<span class="st st--${st.kind}" title="${escapeHtml(`${st.label}: ${st.tip}`)}" aria-label="${escapeHtml(`${st.label}: ${st.tip}`)}">${letter}</span>`;
}

function siteBadge(site) {
  if (site.role === 'analog') return site.analog_of ? `Earth · ${BODIES[site.analog_of].short} analog` : 'Earth site';
  return `${BODIES[site.body].label} · reference`;
}

/** Photo block with author + licence, linked to the Commons file page. */
function photoBlock(site, cls = 'photo') {
  const p = site.photo;
  if (!p) return `<div class="${cls} ${cls}--empty" role="img" aria-label="No photo yet">Photo coming soon</div>`;
  const credit = [p.author, p.license].filter(Boolean).map(escapeHtml).join(' · ') || 'Photo source';
  return `
    <figure class="${cls}">
      <img src="${escapeHtml(p.img)}" alt="${escapeHtml(site.name)}" loading="lazy" decoding="async"
           onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'photo-missing',textContent:'Photo unavailable'}))">
      <figcaption>Photo: <a href="${escapeHtml(p.page)}" target="_blank" rel="noopener">${credit}</a></figcaption>
    </figure>`;
}

function analogLine(site) {
  if (site.role === 'analog') {
    const ref = byId(site.pairId);
    return ref ? `Analog of: <strong>${escapeHtml(ref.name)}</strong> (${escapeHtml(BODIES[ref.body].short)})` : 'Earth site';
  }
  return `Reference site on <strong>${escapeHtml(BODIES[site.body].short)}</strong>`;
}

/** Mini-window shown when a marker is clicked (inherits the map pane's theme). */
function sitePopup(site) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = `
    <header class="popup__head">
      <h3 class="popup__name">${escapeHtml(site.name)}</h3>
      ${site.region ? `<p class="popup__region">${escapeHtml(site.region)}</p>` : ''}
    </header>
    <div class="popup__body">
      ${photoBlock(site, 'popup__photo')}
      ${site.description ? `<p class="popup__desc">${escapeHtml(site.description)}</p>` : ''}
      ${site.limits ? `<p class="popup__limits"><strong>Limits:</strong> ${escapeHtml(site.limits)}</p>` : ''}
    </div>
    <footer class="popup__foot">
      <p class="popup__analog">${analogLine(site)}</p>
      <p class="popup__coords">${formatCoords(site.lat, site.lon)}</p>
      <button type="button" class="popup__btn" data-action="details">More details</button>
    </footer>`;
  return el;
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function selectSite(site, { referenceId = null } = {}) {
  if (state.selected?.id !== site.id || referenceId) state.referenceId = referenceId;
  state.selected = site;
  visibleMaps().forEach((m) => m.highlight(site.id));
  renderSidebar(site);
  $('#sidebar').classList.add('is-open');
  writeHash();
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
}

function scenarioSelect(id) {
  return `
    <label class="field field--inline">
      <span class="field__label">Scenario</span>
      <select id="${id}" data-scenario-select>
        ${SCENARIO_CHOICES.map((c) => `<option value="${c.key}"${c.key === state.scenario ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
    </label>`;
}

function indexCard(row, refName, isPair) {
  const level = similarityLevel(row?.score);
  const pct = row ? Math.round(row.score * 100) : 0;
  return `
    <div class="index-card">
      <div class="index-card__head">
        <span class="index-card__label">Similarity score <span class="st st--computed" title="Computed by analysis/metrics.py (scores.csv)">C</span></span>
        <span class="index-card__score">
          ${level ? `<span class="level level--${level.key}">${level.label}</span>` : ''}
          <span class="index-card__value">${fmtScore(row?.score)}</span>
        </span>
      </div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${row?.score ?? 0}"
           aria-label="Similarity score"><span style="width:${pct}%"></span></div>
      <p class="index-card__ref">
        vs <strong>${escapeHtml(refName)}</strong>${isPair ? ' (intended pair)' : ''}
        ${row ? `· ${escapeHtml(scenarioName(row.scenario))} · coverage ${fmtScore(row.coverage)}` : ''}
      </p>
    </div>`;
}

function rankRows(items, { active, attr }) {
  return items.map((r) => {
    const pct = Math.round((r.score ?? 0) * 100);
    return `
      <li>
        <button type="button" class="rank" ${attr}="${escapeHtml(r.id)}" aria-pressed="${r.id === active}">
          <span class="rank__name">${escapeHtml(r.name)}${r.isPair ? ' <span class="pair-tag" title="Intended pair">pair</span>' : ''}</span>
          <span class="meter meter--small"><span style="width:${pct}%"></span></span>
          <span class="rank__score">${fmtScore(r.score)}</span>
        </button>
      </li>`;
  }).join('');
}

/* ---------- What matches / What doesn't ---------- */

function critItem(item, kind) {
  return `
    <li class="match-item">
      <span class="match-item__label">${escapeHtml(item.crit.label)}</span>
      <span class="match-item__values">s = ${item.s.toFixed(2)} · weight ${item.weight}</span>
      ${kind === 'no' && item.gain >= 0.005 ? `<span class="match-item__share" title="Score gain if this criterion matched exactly">+${item.gain.toFixed(2)}</span>` : ''}
    </li>`;
}

function matchSection(bd) {
  const list = (items, kind, empty) => (items.length
    ? `<ul>${items.map((i) => critItem(i, kind)).join('')}</ul>`
    : `<p class="match-empty">${empty}</p>`);
  return `
    <section>
      <h3 class="section-title">What matches / What doesn't</h3>
      <p class="match-caption">Per-criterion similarity s from <code>scores.csv</code> · match = s ≥ ${MATCH_THRESHOLD}</p>
      <div class="match-grid">
        <div class="match-col match-col--yes">
          <h4>What matches <span class="count">${bd.matches.length}</span></h4>
          ${list(bd.matches, 'yes', 'No criterion is close enough.')}
        </div>
        <div class="match-col match-col--no">
          <h4>What doesn't <span class="count">${bd.mismatches.length}</span></h4>
          ${list(bd.mismatches, 'no', 'Everything compared is within range.')}
        </div>
      </div>
      ${bd.skipped.length ? `<p class="match-skipped">Not compared (missing data or zero weight): ${bd.skipped.map((i) => escapeHtml(i.crit.label)).join(', ')}</p>` : ''}
    </section>`;
}

/* ---------- How to close the gap ---------- */

const GAP_TIPS_PER_CARD = 3;

function rawText(crit, site) {
  const v = crit.raw(site);
  if (crit.key === 'rock') return formatValue(PARAMS.find((p) => p.key === 'rock_class'), site.values.rock_class);
  if (v === null || v === undefined) return '—';
  const unit = { temp_mean: ' °C', temp_range: ' °C', craters: ' /10⁶ km²', slope: '°', relief: ' m', sun: '°' }[crit.key] ?? '';
  const digits = crit.key === 'ice' ? 3 : crit.key === 'craters' || crit.key === 'relief' ? 0 : 1;
  return `${Number(v).toFixed(digits)}${unit}`;
}

/** Criteria below this similarity get mitigations from limits.json in the sidebar. */
const MITIGATION_THRESHOLD = 0.5;

/** Team mitigations (limits.json) linked to a criterion via `criteria`, or the unmapped_criteria text. */
function mitigationsFor(body, critKey) {
  const L = state.limits?.[body];
  if (!L) return { list: [], unmapped: null };
  const factorName = Object.fromEntries(L.factors.map((f) => [f.id, f.name]));
  const list = L.mitigations
    .filter((m) => m.criteria.includes(critKey))
    .map((m) => ({ ...m, addressNames: m.addresses.map((id) => factorName[id] ?? id) }));
  return { list, unmapped: list.length ? null : (state.limits.unmapped_criteria?.[critKey] ?? null) };
}

function gapSection(analog, reference, row, bd) {
  const weak = [...bd.matches, ...bd.mismatches]
    .filter((i) => i.s < MITIGATION_THRESHOLD)
    .sort((p, q) => q.gain - p.gain);
  const head = `
      <h3 class="section-title">How to close the gap</h3>
      <p class="match-caption">Criteria with similarity s &lt; ${MITIGATION_THRESHOLD} vs <strong>${escapeHtml(reference.name)}</strong>,
        with methods from the team’s <em>Limits of the analogy</em> documents (<code>limits.json</code>).</p>`;
  if (!weak.length) return `<section>${head}<p class="match-empty">No criterion is below ${MITIGATION_THRESHOLD}.</p></section>`;

  const cards = weak.map((item) => {
    const { list, unmapped } = mitigationsFor(reference.body, item.crit.key);
    const advice = gapAdvice(item.crit.key, item.crit.raw(analog), item.crit.raw(reference), reference.body);
    const tips = advice.tips.slice(0, GAP_TIPS_PER_CARD).map((t) => `
      <li><span class="tip-kind tip-kind--${t.kind}">${escapeHtml(TIP_KINDS[t.kind] ?? t.kind)}</span>${escapeHtml(t.text)}</li>`).join('');
    const team = list.length
      ? `<ul class="mitigations">${list.map((m) => `
          <li>${escapeHtml(m.method)}${m.addressNames.length ? `<span class="mitigations__for">Addresses: ${m.addressNames.map(escapeHtml).join(', ')}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="mitigations__none">${escapeHtml(unmapped ?? 'No mitigation listed.')}</p>`;
    return `
      <article class="gap-card">
        <header class="gap-card__head">
          <span class="gap-card__title">${escapeHtml(item.crit.label)} <span class="vs">s = ${item.s.toFixed(2)}</span></span>
          <span class="gap-card__gain" title="Score gain if this criterion matched exactly">+${item.gain.toFixed(2)}</span>
        </header>
        <div class="gap-card__meta">
          <span>Earth ${escapeHtml(rawText(item.crit, analog))} <span class="vs">vs</span> target ${escapeHtml(rawText(item.crit, reference))}</span>
        </div>
        ${team}
        <details class="field-tips">
          <summary>Field tips (site suggestions, not from the team documents)</summary>
          <ul class="tips">${tips}</ul>
        </details>
      </article>`;
  }).join('');
  return `<section>${head}<div class="gap-list">${cards}</div>
      ${state.limits?.meta?.criteria_link_note ? `<p class="match-skipped">${escapeHtml(state.limits.meta.criteria_link_note)}</p>` : ''}
    </section>`;
}

/* ---------- Parameters table with status badges ---------- */

function paramsTable(site, other = null) {
  const cell = (s, p) => `${escapeHtml(formatValue(p, s.values[p.key]))}${p.unit && s.values[p.key] !== null ? `<span class="unit">${escapeHtml(p.unit)}</span>` : ''} ${p.status ? statusBadge(s.status[p.status]) : ''}`;
  const rows = PARAMS.map((p) => `
    <tr>
      <th scope="row">${escapeHtml(p.label)}</th>
      <td>${cell(site, p)}</td>
      ${other ? `<td>${cell(other, p)}</td>` : ''}
    </tr>`).join('');
  const head = other ? `<thead><tr><th></th><th scope="col">${escapeHtml(site.name)}</th><th scope="col">${escapeHtml(other.name)}</th></tr></thead>` : '';
  const hasPlaceholder = [site, other].filter(Boolean).some((s) => Object.values(s.status).some((c) => statusInfo(c)?.kind === 'placeholder'));
  return `
    <section>
      <h3 class="section-title">Parameters</h3>
      <table class="params${other ? ' params--two' : ''}">${head}<tbody>${rows}</tbody></table>
      <p class="legend-line">
        <span class="st st--literature">L</span> literature
        <span class="st st--computed">C</span> computed
        <span class="st st--placeholder">T</span><span class="st st--placeholder">E</span> test / estimate — placeholder value, not yet verified
      </p>
      ${hasPlaceholder ? '<p class="match-skipped">Values marked T / E are placeholders for UI development; do not cite them.</p>' : ''}
    </section>`;
}

function siteHead(site) {
  return `
    <header class="site-head">
      <span class="site-head__badge">${escapeHtml(siteBadge(site))}</span>
      <h2 class="site-head__name">${escapeHtml(site.name)}</h2>
      ${site.nameUk ? `<div class="site-head__alt" lang="uk">${escapeHtml(site.nameUk)}</div>` : ''}
      ${site.region ? `<div class="site-head__region">${escapeHtml(site.region)}</div>` : ''}
      <div class="site-head__coords">${formatCoords(site.lat, site.lon)}</div>
    </header>
    ${photoBlock(site)}
    ${site.description ? `<p class="site-desc">${escapeHtml(site.description)}</p>` : ''}`;
}

function limitsBlock(site) {
  const body = site.role === 'analog' ? site.analog_of : site.body;
  const hasCard = Boolean(state.limits?.[body]);
  if (!site.limits && !hasCard) return '';
  return `
    <section>
      <h3 class="section-title">Limits of the analogy</h3>
      ${site.limits ? `<p class="site-desc">${escapeHtml(site.limits)}</p>` : ''}
      ${hasCard ? `<button type="button" class="btn btn--block" data-action="limits">What Earth can’t reproduce on ${escapeHtml(BODIES[body].short)} →</button>` : ''}
    </section>`;
}

/* ---------- Limits card in the Analysis view (data/limits.json) ---------- */

function renderLimits(body) {
  const L = state.limits?.[body];
  $('#card-limits').hidden = !L;
  if (!L) return;
  const short = BODIES[body].short;
  $('#limits-title').textContent = `Limits of the analogy: Earth — ${short}`;
  $('#limits-pdf').href = `docs/limits_${body}.pdf`;

  const factorName = Object.fromEntries(L.factors.map((f) => [f.id, f.name]));
  const critLabel = Object.fromEntries(CRITERIA.map((c) => [c.key, c.label]));
  const factorRows = L.factors.map((f) => `
      <tr>
        <th scope="row">${escapeHtml(f.name)}</th>
        <td>${escapeHtml(f.target)}</td>
        <td>${escapeHtml(f.earth)}</td>
        <td>${escapeHtml(f.why)}</td>
      </tr>`).join('');
  const mitigations = L.mitigations.map((m) => `
      <li class="mitigation">
        <p>${escapeHtml(m.method)}</p>
        <p class="mitigation__meta">
          ${m.addresses.length ? `Addresses: ${m.addresses.map((id) => escapeHtml(factorName[id] ?? id)).join(', ')}` : 'General (no specific factor)'}
          ${m.criteria.length ? ` · criteria: ${m.criteria.map((c) => `<span class="chip">${escapeHtml(critLabel[c] ?? c)}</span>`).join(' ')}` : ''}
        </p>
      </li>`).join('');

  $('#limits-body').innerHTML = `
    <p class="limits__summary">${escapeHtml(L.summary)}</p>
    ${state.limits.meta?.note ? `<p class="limits__muted">${escapeHtml(state.limits.meta.note)}</p>` : ''}

    <section>
      <h3 class="section-title">What Earth can’t reproduce</h3>
      <div class="table-scroll">
        <table class="limits-table">
          <thead><tr><th scope="col">Factor</th><th scope="col">${escapeHtml(short)}</th><th scope="col">Earth</th><th scope="col">Why it matters</th></tr></thead>
          <tbody>${factorRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 class="section-title">How to close the gap</h3>
      <ul class="mitigation-list">${mitigations}</ul>
      ${state.limits.meta?.criteria_link_note ? `<p class="limits__muted">${escapeHtml(state.limits.meta.criteria_link_note)}</p>` : ''}
    </section>

    <section class="limits__conclusion">
      <h3 class="section-title">Conclusion</h3>
      <h4 class="limits__sub">What Earth analogs are good at</h4>
      <ul class="limits__list">${L.good_at.map((g) => {
        const i = g.indexOf(':');
        return i > 0 && i < 60 ? `<li><strong>${escapeHtml(g.slice(0, i))}:</strong>${escapeHtml(g.slice(i + 1))}</li>` : `<li>${escapeHtml(g)}</li>`;
      }).join('')}</ul>
      <p class="limits__text">${escapeHtml(L.conclusion)}</p>
    </section>`;
}

function renderAnalogSidebar(site) {
  const refs = state.book.referencesFor(site.id, state.scenario);
  const refId = state.referenceId ?? site.pairId ?? refs[0]?.referenceId;
  const reference = byId(refId);
  const row = reference ? state.book.get(site.id, reference.id, state.scenario) : null;
  const bd = row ? breakdown(row) : null;

  return `
    ${siteHead(site)}
    <section>
      <div class="section-row">
        <h3 class="section-title">Similarity</h3>
        ${scenarioSelect('sb-scenario')}
      </div>
      ${reference ? indexCard(row, reference.name, row?.isPair) : '<p class="match-empty">No reference to compare with.</p>'}
      ${reference ? `<button type="button" class="btn btn--primary btn--block" data-action="compare" data-analog="${escapeHtml(site.id)}" data-ref="${escapeHtml(reference.id)}">Compare with reference</button>` : ''}
    </section>
    <section>
      <h3 class="section-title">Compared with</h3>
      <ul class="rank-list">${rankRows(refs.map((r) => ({ id: r.referenceId, name: r.reference.name, score: r.score, isPair: r.isPair })), { active: refId, attr: 'data-ref-pick' })}</ul>
    </section>
    ${bd ? matchSection(bd) : ''}
    ${bd ? gapSection(site, reference, row, bd) : ''}
    ${paramsTable(site, reference)}
    ${limitsBlock(site)}`;
}

function renderReferenceSidebar(site) {
  const rows = state.book.rankingFor(site.id, state.scenario);
  return `
    ${siteHead(site)}
    <section>
      <div class="section-row">
        <h3 class="section-title">Best Earth analogs</h3>
        ${scenarioSelect('sb-scenario')}
      </div>
      <ul class="rank-list">${rankRows(rows.map((r) => ({ id: r.analogId, name: r.analog.name, score: r.score, isPair: r.isPair })), { active: null, attr: 'data-analog-pick' })}</ul>
      <button type="button" class="btn btn--primary btn--block" data-action="compare" data-ref="${escapeHtml(site.id)}" data-analog="${escapeHtml(rows[0]?.analogId ?? '')}">Open in Analysis</button>
    </section>
    ${paramsTable(site)}
    ${limitsBlock(site)}`;
}

function renderSidebar(site) {
  $('#sidebar-content').innerHTML = site.role === 'reference' ? renderReferenceSidebar(site) : renderAnalogSidebar(site);
}

/* ------------------------------------------------------------------ */
/* Analysis view                                                       */
/* ------------------------------------------------------------------ */

function ensureAnalysisSelection() {
  const a = state.analysis;
  const refs = references(state.sites);
  if (!byId(a.referenceId)) a.referenceId = refs[0]?.id ?? null;
  if (!byId(a.analogId)) {
    const ranked = a.referenceId ? state.book.rankingFor(a.referenceId, state.scenario) : [];
    a.analogId = (ranked.find((r) => r.isPair) ?? ranked[0])?.analogId ?? null;
  }
}

function fillSelect(sel, options, value) {
  sel.innerHTML = options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

function renderAnalysis() {
  if (!state.book || !window.Chart) {
    $('#analysis-note').textContent = window.Chart ? 'Data not loaded.' : 'Chart.js failed to load.';
    return;
  }
  ensureAnalysisSelection();
  const { referenceId, analogId } = state.analysis;
  const reference = byId(referenceId);
  const analog = byId(analogId);
  const refs = references(state.sites);
  const analogsAll = state.sites.filter((s) => s.role === 'analog');

  fillSelect($('#ctl-scenario'), SCENARIO_CHOICES.map((c) => ({ value: c.key, label: c.label })), state.scenario);
  fillSelect($('#ctl-reference'), refs.map((r) => ({ value: r.id, label: `${BODIES[r.body].short} · ${r.name}` })), referenceId);
  fillSelect($('#ctl-analog'), analogsAll.map((s) => ({ value: s.id, label: `${s.name}${s.pairId === referenceId ? ' (pair)' : ''}` })), analogId);

  const scenario = state.book.scenarioFor(referenceId, state.scenario);
  const heatScenario = state.scenario === 'auto' ? 'equal' : state.scenario;
  $('#analysis-note').innerHTML = state.scenario === 'auto'
    ? `Auto: each reference uses its body's scenario (Mars — ${escapeHtml(scenarioName('mars_landing'))}, Moon — ${escapeHtml(scenarioName('moon_base'))}), as in <code>ranking.csv</code>. The heat map uses equal weights so Mars and Moon columns are comparable.`
    : `All charts use the ${escapeHtml(scenarioName(state.scenario))} scenario from <code>scores.csv</code>.`;

  // Charts need visible, laid-out canvases.
  requestAnimationFrame(() => {
    rankingChart($('#chart-ranking'), {
      rows: state.book.rankingFor(referenceId, state.scenario),
      reference,
      scenario,
      selectedId: analogId,
      onPick: (id) => { state.analysis.analogId = id; render(); },
    });
    radarChart($('#chart-radar'), { row: state.book.get(analogId, referenceId, state.scenario), analog, reference });

    // Heat map: analogs grouped by the body they imitate, references Mars first.
    const order = { mars: 0, moon: 1 };
    const refsSorted = [...refs].sort((p, q) => order[p.body] - order[q.body]);
    const analogsSorted = [...analogsAll].sort((p, q) => (order[p.analog_of] ?? 2) - (order[q.analog_of] ?? 2));
    heatmapChart($('#chart-heatmap'), {
      analogs: analogsSorted,
      references: refsSorted,
      scenario: heatScenario,
      cell: (aId, rId) => state.book.get(aId, rId, heatScenario),
      onPick: (aId, rId) => { state.analysis = { analogId: aId, referenceId: rId }; render(); },
    });
    rawCharts(RAW_GROUPS.map((g) => $(`#chart-${g.id}`)), { analog, reference });
  });
  renderLimits(reference.body);
}

function pngFor(kind) {
  const ref = analysisReference();
  const analog = byId(state.analysis.analogId);
  const bg = getComputedStyle($('#analysis-view')).getPropertyValue('--c-surface').trim();
  const name = {
    ranking: `ranking-${ref?.id}-${state.scenario}`,
    radar: `radar-${analog?.id}-vs-${ref?.id}`,
    heatmap: `heatmap-${state.scenario === 'auto' ? 'equal' : state.scenario}`,
    raw: `raw-${analog?.id}-vs-${ref?.id}`,
  }[kind];
  if (kind === 'raw') {
    downloadPng(RAW_GROUPS.map((g) => g.id), name, { title: `${analog?.name} vs ${ref?.name} — raw parameters`, background: bg });
  } else {
    downloadPng([kind], name);
  }
}

/* ------------------------------------------------------------------ */
/* Events & init                                                       */
/* ------------------------------------------------------------------ */

function openAnalysis(analogId, referenceId, scrollTo = '#card-radar') {
  state.analysis = { analogId: analogId || null, referenceId: referenceId || null };
  state.view = 'analysis';
  render();
  requestAnimationFrame(() => $(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function setScenario(value) {
  state.scenario = SCENARIO_CHOICES.some((c) => c.key === value) ? value : 'auto';
  if (state.selected) renderSidebar(state.selected);
  if (state.view === 'analysis') render(); else writeHash();
}

function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    state.view = t.dataset.view;
    render();
  }));
  $$('#compare-bar .segmented__btn').forEach((b) => b.addEventListener('click', () => {
    state.compareTarget = b.dataset.target;
    render();
  }));
  $('#sidebar-close').addEventListener('click', closeSidebar);

  const sidebar = $('#sidebar-content');
  sidebar.addEventListener('click', (e) => {
    const refPick = e.target.closest('[data-ref-pick]');
    if (refPick && state.selected) {
      state.referenceId = refPick.dataset.refPick;
      renderSidebar(state.selected);
      return;
    }
    const analogPick = e.target.closest('[data-analog-pick]');
    if (analogPick && state.selected) {
      const ref = state.selected;
      const site = byId(analogPick.dataset.analogPick);
      if (site) selectSite(site, { referenceId: ref.id });
      return;
    }
    const cmp = e.target.closest('[data-action="compare"]');
    if (cmp) openAnalysis(cmp.dataset.analog, cmp.dataset.ref);
    const lim = e.target.closest('[data-action="limits"]');
    if (lim && state.selected) {
      const s = state.selected;
      const refId = s.role === 'reference' ? s.id : (state.referenceId ?? s.pairId);
      openAnalysis(s.role === 'analog' ? s.id : null, refId, '#card-limits');
    }
  });
  sidebar.addEventListener('change', (e) => {
    if (e.target.matches('[data-scenario-select]')) setScenario(e.target.value);
  });

  $('#ctl-scenario').addEventListener('change', (e) => setScenario(e.target.value));
  $('#ctl-reference').addEventListener('change', (e) => {
    state.analysis.referenceId = e.target.value;
    render();
  });
  $('#ctl-analog').addEventListener('change', (e) => { state.analysis.analogId = e.target.value; render(); });
  $$('[data-png]').forEach((b) => b.addEventListener('click', () => pngFor(b.dataset.png)));

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  let resizeTimer;
  window.addEventListener('resize', () => {
    visibleMaps().forEach((m) => m.invalidate());
    if (state.view === 'analysis') { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderAnalysis, 200); }
  });
}

/*
 * Shareable state in the URL hash, e.g.
 *   #view=moon&site=MOON-MAL
 *   #view=analysis&ref=MARS-GALE&analog=NAM-DUN&scn=equal
 *   #view=earth&popup=DEV-HAU      (opens a popup — handy for screenshot tests)
 */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (VIEWS.includes(h.get('view'))) state.view = h.get('view');
  if (['mars', 'moon'].includes(h.get('target'))) state.compareTarget = h.get('target');
  if (['polar', 'global'].includes(h.get('proj'))) state.moonProjection = h.get('proj');
  if (SCENARIO_CHOICES.some((c) => c.key === h.get('scn'))) state.scenario = h.get('scn');
  state.analysis.referenceId = h.get('ref');
  state.analysis.analogId = h.get('analog');
  return { site: h.get('site'), popup: h.get('popup') };
}

function writeHash() {
  const h = new URLSearchParams({ view: state.view });
  if (state.view === 'compare') h.set('target', state.compareTarget);
  const moonShown = state.view === 'moon' || (state.view === 'compare' && state.compareTarget === 'moon');
  if (moonShown && state.moonProjection !== 'polar') h.set('proj', state.moonProjection);
  if (state.view === 'analysis') {
    if (state.analysis.referenceId) h.set('ref', state.analysis.referenceId);
    if (state.analysis.analogId) h.set('analog', state.analysis.analogId);
  }
  if (state.scenario !== 'auto') h.set('scn', state.scenario);
  if (state.selected) h.set('site', state.selected.id);
  history.replaceState(null, '', `#${h}`);
}

function showStatus(html) {
  const el = $('#status');
  el.innerHTML = html;
  el.hidden = false;
}

async function init() {
  bindEvents();
  try {
    const [data, limits] = await Promise.all([loadAll('data/'), loadLimits('data/limits.json')]);
    state.sites = data.sites;
    state.book = new ScoreBook(data);
    state.limits = limits;
  } catch (err) {
    console.error(err);
    const fileProto = location.protocol === 'file:';
    showStatus(fileProto
      ? 'Could not load the CSV files from a local file. Serve the folder over HTTP, e.g. <code>python -m http.server 8000</code>, then open <code>http://localhost:8000</code>.'
      : `Could not load site data: ${escapeHtml(err.message || err)}`);
  }
  const { site: siteId, popup: popupId } = readHash();
  render();
  const site = siteId && byId(siteId);
  if (site) selectSite(site);

  // #popup=<site_id>: open that site's mini-window (after the initial fit has settled)
  const popupSite = popupId && byId(popupId);
  if (popupSite) setTimeout(() => visibleMaps().some((m) => m.openPopup(popupSite.id)), 400);

  // Debug handle for the console
  window.EA = { state, CRITERIA };
}

init();
