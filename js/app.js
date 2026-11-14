// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

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
import { rankingChart, radarChart, heatmapChart, rawCharts, downloadPng, destroyAll, RAW_GROUPS } from './charts.js';
import { GlobeStage, hasWebGL } from './globe.js';
import { t, getLang, setLang, onLangChange, applyStatic, nSites, LANGS } from './i18n.js';

const VIEWS = ['globe', 'earth', 'mars', 'moon', 'compare', 'analysis'];
const MAP_VIEWS = ['earth', 'mars', 'moon', 'compare'];
const WEBGL = hasWebGL(); // no WebGL (or globe.gl failed to load) → start on the Leaflet maps

const state = {
  view: WEBGL ? 'globe' : 'earth', // one of VIEWS
  lastMapView: 'earth',   // which map the "Map view" tab returns to
  compareTarget: 'mars',  // 'mars' | 'moon'
  moonProjection: 'polar', // 'polar' (south polar stereographic) | 'global' (equirectangular)
  scenario: 'auto',       // 'auto' | key of SCENARIOS
  sites: [],
  book: null,             // ScoreBook
  limitsByLang: {},       // {en: data/limits.json, uk: data/limits_uk.json}; either may be missing
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
/** "Limits of the analogy" in the interface language (falls back to English). */
const limitsData = () => state.limitsByLang[getLang()] ?? state.limitsByLang.en ?? null;

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function analysisReference() { return byId(state.analysis.referenceId); }

function currentTheme() {
  if (state.view === 'globe') return globeStage?.mode === 'compare' ? globeStage.targetBody : 'earth';
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

  const tab = state.view === 'globe' ? 'globe' : state.view === 'analysis' ? 'analysis' : 'map';
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  $$('#map-subnav .segmented__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  document.body.dataset.view = state.view;
  if (MAP_VIEWS.includes(state.view)) state.lastMapView = state.view;

  const isGlobe = state.view === 'globe';
  $('#globe-view').hidden = !isGlobe;
  $('main.layout').hidden = isGlobe;
  if (isGlobe) {
    destroyAll(['globe-radar']);
    ensureGlobe();
    writeHash();
    return;
  }
  globeStage?.pause();
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
    destroyAll(['globe-radar']); // charts are rebuilt when the tab is shown again
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
  const letter = st.kind === 'literature' ? 'L' : st.kind === 'computed' ? 'C' : code.startsWith('estimate') ? 'E' : 'T';
  return `<span class="st st--${st.kind}" title="${escapeHtml(`${st.label}: ${st.tip}`)}" aria-label="${escapeHtml(`${st.label}: ${st.tip}`)}">${letter}</span>`;
}

function siteBadge(site) {
  if (site.role === 'analog') return site.analog_of ? t(`site.analogBadge.${site.analog_of}`) : t('site.earthSite');
  return t(`site.refBadge.${site.body}`);
}

/** Photo block with author + licence, linked to the Commons file page. */
function photoBlock(site, cls = 'photo') {
  const p = site.photo;
  if (!p) return `<div class="${cls} ${cls}--empty" role="img" aria-label="${escapeHtml(t('photo.none'))}">${escapeHtml(t('photo.soon'))}</div>`;
  const credit = [p.author, p.license].filter(Boolean).map(escapeHtml).join(' · ') || escapeHtml(t('photo.source'));
  return `
    <figure class="${cls}">
      <img src="${escapeHtml(p.img)}" alt="${escapeHtml(site.name)}" loading="lazy" decoding="async"
           onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'photo-missing',textContent:${escapeHtml(JSON.stringify(t('photo.unavailable')))}}))">
      <figcaption>${escapeHtml(t('photo.prefix'))} <a href="${escapeHtml(p.page)}" target="_blank" rel="noopener">${credit}</a></figcaption>
    </figure>`;
}

function analogLine(site) {
  if (site.role === 'analog') {
    const ref = byId(site.pairId);
    return ref ? t('pop.analogOfHtml', { name: escapeHtml(ref.name), body: escapeHtml(BODIES[ref.body].short) }) : escapeHtml(t('site.earthSite'));
  }
  return t(`pop.refOnHtml.${site.body}`);
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
      ${site.limits ? `<p class="popup__limits"><strong>${escapeHtml(t('pop.limits'))}</strong> ${escapeHtml(site.limits)}</p>` : ''}
    </div>
    <footer class="popup__foot">
      <p class="popup__analog">${analogLine(site)}</p>
      <p class="popup__coords">${formatCoords(site.lat, site.lon)}</p>
      <button type="button" class="popup__btn" data-action="details">${escapeHtml(t('pop.more'))}</button>
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
      <span class="field__label">${escapeHtml(t('sb.scenario'))}</span>
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
        <span class="index-card__label">${escapeHtml(t('sb.score'))} <span class="st st--computed" title="${escapeHtml(t('sb.computedTip'))}">C</span></span>
        <span class="index-card__score">
          ${level ? `<span class="level level--${level.key}">${level.label}</span>` : ''}
          <span class="index-card__value">${fmtScore(row?.score)}</span>
        </span>
      </div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${row?.score ?? 0}"
           aria-label="${escapeHtml(t('sb.score'))}"><span style="width:${pct}%"></span></div>
      <p class="index-card__ref">
        ${t('sb.vsHtml', { ref: escapeHtml(refName) })}${isPair ? escapeHtml(t('sb.intendedPair')) : ''}
        ${row ? `· ${escapeHtml(scenarioName(row.scenario))} · ${escapeHtml(t('sb.coverage', { v: fmtScore(row.coverage) }))}` : ''}
      </p>
    </div>`;
}

function rankRows(items, { active, attr }) {
  return items.map((r) => {
    const pct = Math.round((r.score ?? 0) * 100);
    return `
      <li>
        <button type="button" class="rank" ${attr}="${escapeHtml(r.id)}" aria-pressed="${r.id === active}">
          <span class="rank__name">${escapeHtml(r.name)}${r.isPair ? ` <span class="pair-tag" title="${escapeHtml(t('sb.pairTitle'))}">${escapeHtml(t('sb.pairTag'))}</span>` : ''}</span>
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
      <span class="match-item__values">s = ${item.s.toFixed(2)} · ${escapeHtml(t('sb.weight', { w: item.weight }))}</span>
      ${kind === 'no' && item.gain >= 0.005 ? `<span class="match-item__share" title="${escapeHtml(t('sb.gainTip'))}">+${item.gain.toFixed(2)}</span>` : ''}
    </li>`;
}

function matchSection(bd) {
  const list = (items, kind, empty) => (items.length
    ? `<ul>${items.map((i) => critItem(i, kind)).join('')}</ul>`
    : `<p class="match-empty">${empty}</p>`);
  return `
    <section>
      <h3 class="section-title">${escapeHtml(t('sb.matchTitle'))}</h3>
      <p class="match-caption">${t('sb.matchCaptionHtml', { t: MATCH_THRESHOLD })}</p>
      <div class="match-grid">
        <div class="match-col match-col--yes">
          <h4>${escapeHtml(t('sb.matches'))} <span class="count">${bd.matches.length}</span></h4>
          ${list(bd.matches, 'yes', escapeHtml(t('sb.noMatch')))}
        </div>
        <div class="match-col match-col--no">
          <h4>${escapeHtml(t('sb.mismatches'))} <span class="count">${bd.mismatches.length}</span></h4>
          ${list(bd.mismatches, 'no', escapeHtml(t('sb.allMatch')))}
        </div>
      </div>
      ${bd.skipped.length ? `<p class="match-skipped">${escapeHtml(t('sb.skipped', { list: bd.skipped.map((i) => i.crit.label).join(', ') }))}</p>` : ''}
    </section>`;
}

/* ---------- How to close the gap ---------- */

function rawText(crit, site) {
  const v = crit.raw(site);
  if (crit.key === 'rock') return formatValue(PARAMS.find((p) => p.key === 'rock_class'), site.values.rock_class);
  if (v === null || v === undefined) return '—';
  const unit = { temp_mean: ' °C', temp_range: ' °C', craters: ` ${t('unit.km2')}`, slope: '°', relief: ` ${t('unit.m')}`, sun: '°' }[crit.key] ?? '';
  const digits = crit.key === 'ice' ? 3 : crit.key === 'craters' || crit.key === 'relief' ? 0 : 1;
  return `${Number(v).toFixed(digits)}${unit}`;
}

/** Criteria below this similarity get mitigations from limits.json in the sidebar. */
const MITIGATION_THRESHOLD = 0.5;

/** Team mitigations (limits.json) linked to a criterion via `criteria`, or the unmapped_criteria text. */
function mitigationsFor(body, critKey) {
  const L = limitsData()?.[body];
  if (!L) return { list: [], unmapped: null };
  const factorName = Object.fromEntries(L.factors.map((f) => [f.id, f.name]));
  const list = L.mitigations
    .filter((m) => m.criteria.includes(critKey))
    .map((m) => ({ ...m, addressNames: m.addresses.map((id) => factorName[id] ?? id) }));
  return { list, unmapped: list.length ? null : (limitsData().unmapped_criteria?.[critKey] ?? null) };
}

function gapSection(analog, reference, row, bd) {
  const weak = [...bd.matches, ...bd.mismatches]
    .filter((i) => i.s < MITIGATION_THRESHOLD)
    .sort((p, q) => q.gain - p.gain);
  const head = `
      <h3 class="section-title">${escapeHtml(t('sb.gapTitle'))}</h3>
      <p class="match-caption">${t('sb.gapCaptionHtml', { t: MITIGATION_THRESHOLD, ref: escapeHtml(reference.name), file: getLang() === 'uk' && state.limitsByLang.uk ? 'limits_uk.json' : 'limits.json' })}</p>`;
  if (!weak.length) return `<section>${head}<p class="match-empty">${escapeHtml(t('sb.gapNone', { t: MITIGATION_THRESHOLD }))}</p></section>`;

  const cards = weak.map((item) => {
    const { list, unmapped } = mitigationsFor(reference.body, item.crit.key);
    const team = list.length
      ? `<ul class="mitigations">${list.map((m) => `
          <li>${escapeHtml(m.method)}${m.addressNames.length ? `<span class="mitigations__for">${escapeHtml(t('sb.addresses', { list: m.addressNames.join(', ') }))}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="mitigations__none">${escapeHtml(unmapped ?? t('sb.noMitigation'))}</p>`;
    return `
      <article class="gap-card">
        <header class="gap-card__head">
          <span class="gap-card__title">${escapeHtml(item.crit.label)} <span class="vs">s = ${item.s.toFixed(2)}</span></span>
          <span class="gap-card__gain" title="${escapeHtml(t('sb.gainTip'))}">+${item.gain.toFixed(2)}</span>
        </header>
        <div class="gap-card__meta">
          <span>${t('sb.earthVsTargetHtml', { a: escapeHtml(rawText(item.crit, analog)), b: escapeHtml(rawText(item.crit, reference)) })}</span>
        </div>
        ${team}
      </article>`;
  }).join('');
  return `<section>${head}<div class="gap-list">${cards}</div>
      ${limitsData()?.meta?.criteria_link_note ? `<p class="match-skipped">${escapeHtml(limitsData().meta.criteria_link_note)}</p>` : ''}
    </section>`;
}

/* ---------- Parameters table with status badges ---------- */

function paramsTable(site, other = null, title = t('sb.params')) {
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
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <table class="params${other ? ' params--two' : ''}">${head}<tbody>${rows}</tbody></table>
      <p class="legend-line">${t('sb.legendHtml')}</p>
      ${hasPlaceholder ? `<p class="match-skipped">${escapeHtml(t('sb.placeholderWarn'))}</p>` : ''}
    </section>`;
}

function siteHead(site) {
  return `
    <header class="site-head">
      <span class="site-head__badge">${escapeHtml(siteBadge(site))}</span>
      <h2 class="site-head__name">${escapeHtml(site.name)}</h2>
      ${site.nameAlt ? `<div class="site-head__alt" lang="${getLang() === 'uk' ? 'en' : 'uk'}">${escapeHtml(site.nameAlt)}</div>` : ''}
      ${site.region ? `<div class="site-head__region">${escapeHtml(site.region)}</div>` : ''}
      <div class="site-head__coords">${formatCoords(site.lat, site.lon)}</div>
    </header>
    ${photoBlock(site)}
    ${site.description ? `<p class="site-desc">${escapeHtml(site.description)}</p>` : ''}`;
}

function limitsBlock(site) {
  const body = site.role === 'analog' ? site.analog_of : site.body;
  const hasCard = Boolean(limitsData()?.[body]);
  if (!site.limits && !hasCard) return '';
  return `
    <section>
      <h3 class="section-title">${escapeHtml(t('card.limits'))}</h3>
      ${site.limits ? `<p class="site-desc">${escapeHtml(site.limits)}</p>` : ''}
      ${hasCard ? `<button type="button" class="btn btn--block" data-action="limits">${escapeHtml(t(`sb.limitsBtn.${body}`))}</button>` : ''}
    </section>`;
}

/* ---------- Limits card in the Analysis view (data/limits.json) ---------- */

function renderLimits(body) {
  const data = limitsData();
  const L = data?.[body];
  $('#card-limits').hidden = !L;
  if (!L) return;
  const short = BODIES[body].short;
  $('#limits-title').textContent = t(`lim.title.${body}`);
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
          ${escapeHtml(m.addresses.length ? t('sb.addresses', { list: m.addresses.map((id) => factorName[id] ?? id).join(', ') }) : t('lim.general'))}
          ${m.criteria.length ? ` · ${escapeHtml(t('lim.criteria'))} ${m.criteria.map((c) => `<span class="chip">${escapeHtml(critLabel[c] ?? c)}</span>`).join(' ')}` : ''}
        </p>
      </li>`).join('');

  $('#limits-body').innerHTML = `
    <p class="limits__summary">${escapeHtml(L.summary)}</p>
    ${data.meta?.note ? `<p class="limits__muted">${escapeHtml(data.meta.note)}</p>` : ''}

    <section>
      <h3 class="section-title">${escapeHtml(t('lim.cant'))}</h3>
      <div class="table-scroll">
        <table class="limits-table">
          <thead><tr><th scope="col">${escapeHtml(t('lim.factor'))}</th><th scope="col">${escapeHtml(short)}</th><th scope="col">${escapeHtml(t('body.earth'))}</th><th scope="col">${escapeHtml(t('lim.why'))}</th></tr></thead>
          <tbody>${factorRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 class="section-title">${escapeHtml(t('sb.gapTitle'))}</h3>
      <ul class="mitigation-list">${mitigations}</ul>
      ${data.meta?.criteria_link_note ? `<p class="limits__muted">${escapeHtml(data.meta.criteria_link_note)}</p>` : ''}
    </section>

    <section class="limits__conclusion">
      <h3 class="section-title">${escapeHtml(t('lim.conclusion'))}</h3>
      <h4 class="limits__sub">${escapeHtml(t('lim.goodAt'))}</h4>
      <ul class="limits__list">${L.good_at.map((g) => {
        const i = g.indexOf(':');
        return i > 0 && i < 60 ? `<li><strong>${escapeHtml(g.slice(0, i))}:</strong>${escapeHtml(g.slice(i + 1))}</li>` : `<li>${escapeHtml(g)}</li>`;
      }).join('')}</ul>
      <p class="limits__text">${escapeHtml(L.conclusion)}</p>
    </section>
    ${data.meta?.translation_note ? `<p class="limits__muted">${escapeHtml(data.meta.translation_note)}</p>` : ''}`;
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
        <h3 class="section-title">${escapeHtml(t('sb.similarity'))}</h3>
        ${scenarioSelect('sb-scenario')}
      </div>
      ${reference ? indexCard(row, reference.name, row?.isPair) : `<p class="match-empty">${escapeHtml(t('sb.noRef'))}</p>`}
      ${reference ? `<button type="button" class="btn btn--primary btn--block" data-action="compare" data-analog="${escapeHtml(site.id)}" data-ref="${escapeHtml(reference.id)}">${escapeHtml(t('sb.compareBtn'))}</button>` : ''}
    </section>
    <section>
      <h3 class="section-title">${escapeHtml(t('sb.comparedWith'))}</h3>
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
        <h3 class="section-title">${escapeHtml(t('sb.bestAnalogs'))}</h3>
        ${scenarioSelect('sb-scenario')}
      </div>
      <ul class="rank-list">${rankRows(rows.map((r) => ({ id: r.analogId, name: r.analog.name, score: r.score, isPair: r.isPair })), { active: null, attr: 'data-analog-pick' })}</ul>
      <button type="button" class="btn btn--primary btn--block" data-action="compare" data-ref="${escapeHtml(site.id)}" data-analog="${escapeHtml(rows[0]?.analogId ?? '')}">${escapeHtml(t('sb.openAnalysis'))}</button>
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
    $('#analysis-note').textContent = t(window.Chart ? 'an.noData' : 'an.noChart');
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
  fillSelect($('#ctl-analog'), analogsAll.map((s) => ({ value: s.id, label: `${s.name}${s.pairId === referenceId ? t('an.pair') : ''}` })), analogId);

  const scenario = state.book.scenarioFor(referenceId, state.scenario);
  const heatScenario = state.scenario === 'auto' ? 'equal' : state.scenario;
  $('#analysis-note').innerHTML = state.scenario === 'auto'
    ? t('an.noteAutoHtml', { mars: escapeHtml(scenarioName('mars_landing')), moon: escapeHtml(scenarioName('moon_base')) })
    : t('an.noteOneHtml', { s: escapeHtml(scenarioName(state.scenario)) });

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
    downloadPng(RAW_GROUPS.map((g) => g.id), name, { title: t('an.rawPngTitle', { a: analog?.name, r: ref?.name }), background: bg });
  } else {
    downloadPng([kind], name);
  }
}

/* ------------------------------------------------------------------ */
/* Globe home screen (js/globe.js)                                     */
/* ------------------------------------------------------------------ */

let globeStage = null;

/** First 2–3 sentences of a description. */
function shortText(text, max = 3) {
  const parts = String(text).match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  return parts.slice(0, max).join('').trim();
}

/** Card for an open group of close sites: one row per member, click to focus it. */
function globeGroupCardHtml(group) {
  const bodies = new Set(group.members.map((s) => s.analog_of));
  const badge = bodies.size === 1
    ? `<span class="badge badge--${[...bodies][0]}">${escapeHtml(t(`gl.groupBadge.${[...bodies][0]}`))}</span>`
    : `<span class="badge">${escapeHtml(t('gl.groupBadge.mixed'))}</span>`;
  const rows = group.members.map((s) => {
    const ref = byId(s.pairId);
    const row = ref ? state.book.get(s.id, ref.id, 'auto') : null;
    return `<li><button type="button" class="group-pick" data-gaction="pick" data-site="${escapeHtml(s.id)}">
        <span class="group-pick__dot group-pick__dot--${s.analog_of ?? 'earth'}" aria-hidden="true"></span>
        <span class="group-pick__name">${escapeHtml(s.name)}<small>${escapeHtml(ref ? t('gl.refLine', { ref: ref.name }) : s.region)}</small></span>
        ${row ? `<strong class="group-pick__score">${fmtScore(row.score)}</strong>` : ''}
      </button></li>`;
  }).join('');
  return `
    ${badge}
    <h3 class="site-card__title">${escapeHtml(group.name)}</h3>
    <p class="kicker kicker--small">${escapeHtml(group.region)} · ${escapeHtml(nSites(group.members.length))} · ${formatCoords(group.lat, group.lon, 1)}</p>
    <p class="site-card__text">${escapeHtml(t('gl.groupText'))}</p>
    <ul class="group-list">${rows}</ul>`;
}

function globeCardHtml(site, group = null) {
  const target = site.analog_of;
  const ref = byId(site.pairId);
  const row = ref ? state.book.get(site.id, ref.id, 'auto') : null;
  const photo = site.photo
    ? `<figure class="site-card__photo">
        <img src="${escapeHtml(site.photo.img)}" alt="${escapeHtml(site.name)}" loading="lazy" decoding="async">
        <figcaption><a href="${escapeHtml(site.photo.page)}" target="_blank" rel="noopener">${escapeHtml([site.photo.author, site.photo.license].filter(Boolean).join(' · ') || t('photo.source'))}</a></figcaption>
      </figure>`
    : '';
  return `
    <span class="badge badge--${target ?? 'earth'}">${escapeHtml(target ? t(`gl.badge.${target}`) : t('site.earthSite'))}</span>
    <h3 class="site-card__title">${escapeHtml(site.name)}</h3>
    <p class="kicker kicker--small">${escapeHtml(site.region)} · ${formatCoords(site.lat, site.lon, 1)}</p>
    ${group ? `<p class="site-card__group">${t('gl.partOfHtml', { g: escapeHtml(group.name), n: escapeHtml(nSites(group.members.length)) })}</p>` : ''}
    ${photo}
    <p class="site-card__text">${escapeHtml(shortText(site.description))}</p>
    ${row ? `<p class="site-card__sim"><span class="kicker kicker--small">${escapeHtml(t('gl.similarity'))}</span> <strong>${fmtScore(row.score)}</strong>
        <span>${escapeHtml(t('gl.vsLine', { ref: ref.name, scn: scenarioName(row.scenario) }))}</span></p>` : ''}
    <div class="site-card__actions">
      ${ref ? `<button type="button" class="btn-accent" data-gaction="compare">${escapeHtml(t(`gl.compare.${ref.body}`))}</button>` : ''}
      <button type="button" class="btn-ghost" data-gaction="map">${escapeHtml(t('gl.openMap'))}</button>
    </div>`;
}

function globeCompare(analog, reference) {
  const row = state.book.get(analog.id, reference.id, 'auto');
  $('#globe-target-label').textContent = t(`gl.targetLabel.${reference.body}`);
  radarChart($('#globe-radar'), { row, analog, reference, id: 'globe-radar', compact: true });
  const bd = row ? breakdown(row) : null;
  const details = $('#globe-details');
  details.dataset.theme = reference.body;
  const level = row ? similarityLevel(row.score)?.label ?? '' : '';
  details.innerHTML = `
    <header class="space__details-head">
      <p class="kicker">${escapeHtml(t('gl.cmpKicker', { scn: scenarioName(row?.scenario ?? 'equal') }))}</p>
      <h3 class="display display--small">${escapeHtml(analog.name)} <span class="hl">${escapeHtml(t('gl.vs'))}</span> ${escapeHtml(reference.name)}</h3>
      ${row ? `<p class="lede">${t('gl.cmpLedeHtml', { s: fmtScore(row.score), level: escapeHtml(level) })}</p>` : ''}
    </header>
    <div class="space__details-grid">
      <div class="space-panel">${paramsTable(analog, reference, t(`gl.earthVs.${reference.body}`))}</div>
      <div class="space-panel">${bd ? gapSection(analog, reference, row, bd) : ''}</div>
    </div>`;
  details.hidden = false;
  writeHash();
}

function ensureGlobe() {
  if (!globeStage) {
    globeStage = new GlobeStage($('#globe-view'), {
      analogs: state.sites.filter((s) => s.role === 'analog'),
      references: references(state.sites),
      byId,
      cardHtml: globeCardHtml,
      groupCardHtml: globeGroupCardHtml,
      onCompare: globeCompare,
      onBack: (from) => {
        if (from === 'compare') {
          $('#globe-details').hidden = true;
          destroyAll(); // the radar between the globes
        }
      },
      onStateChange: () => { applyTheme(); writeHash(); },
    });
  } else {
    globeStage.resume();
  }
  applyTheme();
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
    const tab = t.dataset.tab;
    state.view = tab === 'map' ? state.lastMapView : tab;
    render();
  }));
  $$('#map-subnav .segmented__btn').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    render();
  }));
  $('#globe-back').addEventListener('click', () => globeStage?.back());
  $('#globe-card').addEventListener('click', (e) => {
    const a = e.target.closest('[data-gaction]');
    if (!a || !globeStage) return;
    if (a.dataset.gaction === 'pick') {
      const picked = byId(a.dataset.site);
      if (picked) globeStage.focus(picked);
      return;
    }
    const site = globeStage.focused;
    if (!site) return;
    if (a.dataset.gaction === 'compare') globeStage.compare(byId(site.pairId));
    if (a.dataset.gaction === 'map') {
      state.view = 'earth';
      render();
      selectSite(site);
    }
  });
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
    if (state.view === 'globe') globeStage?.resize();
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
  if (state.view === 'globe' && !WEBGL) state.view = 'earth'; // no WebGL → Leaflet maps
  if (['mars', 'moon'].includes(h.get('target'))) state.compareTarget = h.get('target');
  if (['polar', 'global'].includes(h.get('proj'))) state.moonProjection = h.get('proj');
  if (SCENARIO_CHOICES.some((c) => c.key === h.get('scn'))) state.scenario = h.get('scn');
  if (LANGS.includes(h.get('lang'))) setLang(h.get('lang'));
  state.analysis.referenceId = h.get('ref');
  state.analysis.analogId = h.get('analog');
  return { site: h.get('site'), popup: h.get('popup'), focus: h.get('focus'), group: h.get('group'), globeMode: h.get('g') };
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
  if (state.view === 'globe' && globeStage?.focused) {
    h.set('focus', globeStage.focused.id);
    if (globeStage.mode === 'compare') h.set('g', 'compare');
  } else if (state.view === 'globe' && globeStage?.mode === 'group') {
    h.set('group', globeStage.group.id);
  }
  if (state.scenario !== 'auto') h.set('scn', state.scenario);
  if (state.selected && state.view !== 'globe') h.set('site', state.selected.id);
  h.set('lang', getLang());
  history.replaceState(null, '', `#${h}`);
}

function showStatus(html) {
  const el = $('#status');
  el.innerHTML = html;
  el.hidden = false;
}

/** Language switch: redraw everything that holds text. Maps are rebuilt (legends, controls). */
function relocalize() {
  for (const k of Object.keys(singleMaps)) { singleMaps[k]?.destroy(); delete singleMaps[k]; }
  compareMaps.earth?.destroy();
  compareMaps.target?.destroy();
  compareMaps.earth = null;
  compareMaps.target = null;
  globeStage?.relocalize();
  render();
  if (state.selected && state.view !== 'globe') renderSidebar(state.selected);
}

async function init() {
  applyStatic();
  onLangChange(relocalize);
  $$('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  bindEvents();
  try {
    const [data, limitsEn, limitsUk] = await Promise.all([loadAll('data/'), loadLimits('data/limits.json'), loadLimits('data/limits_uk.json')]);
    state.sites = data.sites;
    state.book = new ScoreBook(data);
    state.limitsByLang = { en: limitsEn, uk: limitsUk };
  } catch (err) {
    console.error(err);
    const fileProto = location.protocol === 'file:';
    showStatus(fileProto ? t('status.file') : escapeHtml(t('status.error', { e: err.message || err })));
  }
  const { site: siteId, popup: popupId, focus: focusId, group: groupId, globeMode } = readHash();
  if (!WEBGL) $('.tab[data-tab="globe"]').hidden = true;
  render();
  const site = siteId && byId(siteId);
  if (site) selectSite(site);

  // #view=globe&group=<group_id>: open a group of close sites (see GROUPS in globe.js)
  const openGroup = state.view === 'globe' && groupId && globeStage?.groups.find((g) => g.id === groupId);
  if (openGroup && !focusId) globeStage.openGroup(openGroup, { instant: true });

  // #view=globe&focus=<site_id>[&g=compare]: restore the globe state (links, screenshot tests)
  const focusSite = state.view === 'globe' && focusId && byId(focusId);
  if (focusSite && globeStage) {
    globeStage.focus(focusSite, { instant: true });
    if (globeMode === 'compare') setTimeout(() => globeStage.compare(byId(focusSite.pairId), { instant: true }), 300);
  }

  // #popup=<site_id>: open that site's mini-window (after the initial fit has settled)
  const popupSite = popupId && byId(popupId);
  if (popupSite) setTimeout(() => visibleMaps().some((m) => m.openPopup(popupSite.id)), 400);

  // Debug handle for the console
  window.EA = { state, CRITERIA };
}

init();
