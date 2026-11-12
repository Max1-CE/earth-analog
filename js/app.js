/**
 * app.js — application state, view switching, theming and sidebar.
 *
 * Flow: loadSites() → state.sites → MapViews created lazily when shown →
 *       marker click → selectSite() → renderSidebar().
 */
import { loadSites, BODIES, PARAMS, sitesOnBody, analogsOf, formatCoords, formatParam } from './data.js';
import { MapView, mapKeyFor, projectionControl } from './maps.js';
import {
  similarity, WEIGHTS, rankMatches, comparisonBody, similarityLevel,
  compareParameters, weightsFor, scoreWithout, MATCH_THRESHOLD,
} from './similarity.js';
import { gapAdvice, TIP_KINDS, CLOSABLE_LABELS } from './gap.js';

const state = {
  view: 'earth',          // 'earth' | 'mars' | 'moon' | 'compare'
  compareTarget: 'mars',  // 'mars' | 'moon'
  moonProjection: 'polar', // 'polar' (south polar stereographic) | 'global' (equirectangular)
  sites: [],
  selected: null,         // Site | null
  referenceId: null,      // site compared against in the similarity index (null = best match)
};

/** @type {Record<string, MapView>} single-view maps, keyed by body */
const singleMaps = {};
/** @type {{earth: MapView|null, target: MapView|null}} */
const compareMaps = { earth: null, target: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme() {
  // In Compare mode the UI takes the target's theme; each pane keeps its own.
  document.body.dataset.theme = state.view === 'compare' ? state.compareTarget : state.view;
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

function sitesFor(body, { compare = false } = {}) {
  if (body === 'earth' && compare) return analogsOf(state.sites, state.compareTarget);
  return sitesOnBody(state.sites, body);
}

/** Extra Leaflet controls per body (Moon gets the projection toggle). */
function controlsFor(body) {
  if (body !== 'moon') return [];
  return [projectionControl(state.moonProjection, (p) => {
    state.moonProjection = p;
    render();
  })];
}

/** Return `existing` if it still matches, otherwise (re)build the MapView. */
function ensureMap(existing, el, body) {
  const key = mapKeyFor(body, state.moonProjection);
  if (existing && existing.mapKey === key) return existing;
  existing?.destroy(); // different CRS/tiles → rebuild
  return new MapView(el, key, { onSelect: selectSite, controls: controlsFor(body) });
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
  return state.view === 'compare'
    ? [compareMaps.earth, compareMaps.target].filter(Boolean)
    : [singleMaps[state.view]].filter(Boolean);
}

function render() {
  applyTheme();

  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === state.view)));
  $$('#compare-bar .segmented__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.target === state.compareTarget)));

  const isCompare = state.view === 'compare';
  $('#single-view').hidden = isCompare;
  $('#compare-view').hidden = !isCompare;
  $('#compare-bar').hidden = !isCompare;

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

  renderCharts();
  writeHash();
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                           */
/* ------------------------------------------------------------------ */

function selectSite(site) {
  if (state.selected?.id !== site.id) state.referenceId = null; // new site → best match
  state.selected = site;
  visibleMaps().forEach((m) => m.highlight(site.id));
  renderSidebar(site);
  $('#sidebar').classList.add('is-open');
  renderCharts();
  writeHash();
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function siteBadge(site) {
  if (site.body === 'earth' && site.analog_of) return `Earth · ${BODIES[site.analog_of].short} analog`;
  return BODIES[site.body].label;
}

/* ---------- Similarity index ---------- */

const fmtScore = (s) => (s === null || s === undefined ? '—' : s.toFixed(2));

/**
 * Ranked comparisons for `site` and the one currently used as reference
 * (user-picked via state.referenceId, otherwise the best match).
 */
function similarityFor(site) {
  const ranking = rankMatches(site, state.sites, WEIGHTS);
  const reference = ranking.find((r) => r.target.id === state.referenceId) ?? ranking[0] ?? null;
  const body = comparisonBody(site);
  // Per-parameter breakdown, shared by "What matches" and "How to close the gap"
  const cmp = reference ? compareParameters(site, reference.target, weightsFor(body, WEIGHTS)) : null;
  return { ranking, reference, body, cmp };
}

function similarityCard(site, { ranking, reference, body }) {
  if (!reference) {
    const why = body
      ? `No ${BODIES[body].short} sites to compare with yet.`
      : 'Not marked as an analog of Mars or the Moon.';
    return `
      <div class="index-card">
        <div class="index-card__head">
          <span class="index-card__label">Similarity index</span>
          <span class="index-card__value">—</span>
        </div>
        <p class="index-card__ref">${escapeHtml(why)}</p>
      </div>`;
  }

  const { score, used, total, target } = reference;
  const level = similarityLevel(score);
  const isBest = reference === ranking[0];
  const pct = score === null ? 0 : Math.round(score * 100);

  return `
    <div class="index-card">
      <div class="index-card__head">
        <span class="index-card__label">Similarity index</span>
        <span class="index-card__score">
          ${level ? `<span class="level level--${level.key}">${level.label}</span>` : ''}
          <span class="index-card__value">${fmtScore(score)}</span>
        </span>
      </div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${score ?? 0}"
           aria-label="Similarity index"><span style="width:${pct}%"></span></div>
      <p class="index-card__ref">
        vs <strong>${escapeHtml(target.name)}</strong>${isBest ? ' (best match)' : ''}
        · ${escapeHtml(BODIES[body].short)} weights · ${used}/${total} parameters
      </p>
    </div>`;
}

function rankingList({ ranking, reference }) {
  if (ranking.length < 2) return '';
  const rows = ranking.map((r) => {
    const pct = r.score === null ? 0 : Math.round(r.score * 100);
    const active = r === reference;
    return `
      <li>
        <button type="button" class="rank" data-ref="${escapeHtml(r.target.id)}" aria-pressed="${active}">
          <span class="rank__name">${escapeHtml(r.target.name)}</span>
          <span class="meter meter--small"><span style="width:${pct}%"></span></span>
          <span class="rank__score">${fmtScore(r.score)}</span>
        </button>
      </li>`;
  }).join('');
  return `
    <section>
      <h3 class="section-title">Compared with</h3>
      <ul class="rank-list">${rows}</ul>
    </section>`;
}

/* ---------- What matches / What doesn't ---------- */

/** "−20 °C" — value with unit; dimensionless 0–1 indices get no unit. */
function valueWithUnit(param, v) {
  const unit = param.unit && param.unit !== '0–1' ? ` ${param.unit}` : '';
  return `${formatParam(param, v)}${v === null || v === undefined ? '' : unit}`;
}

function matchItem(item, kind) {
  const { param, a, b, share } = item;
  const showShare = kind === 'no' && share >= 0.05;
  return `
    <li class="match-item">
      <span class="match-item__label">${escapeHtml(param.label)}</span>
      <span class="match-item__values">${escapeHtml(valueWithUnit(param, a))} <span class="vs">vs</span> ${escapeHtml(valueWithUnit(param, b))}</span>
      ${showShare ? `<span class="match-item__share" title="Share of the total weighted difference">${Math.round(share * 100)}% of gap</span>` : ''}
    </li>`;
}

function matchSection(site, { reference, cmp }) {
  let content = '';
  if (!reference) {
    content = '<p class="match-empty">No reference site to compare with.</p>';
  } else {
    const other = reference.target;
    const { matches, mismatches, skipped } = cmp;
    const list = (items, kind, empty) => (items.length
      ? `<ul>${items.map((i) => matchItem(i, kind)).join('')}</ul>`
      : `<p class="match-empty">${empty}</p>`);

    content = `
      <p class="match-caption">
        This site <span class="vs">vs</span> <strong>${escapeHtml(other.name)}</strong>
        · match = within ${Math.round(MATCH_THRESHOLD * 100)}% of the parameter range
      </p>
      <div class="match-grid">
        <div class="match-col match-col--yes">
          <h4>What matches <span class="count">${matches.length}</span></h4>
          ${list(matches, 'yes', 'No parameter is close enough.')}
        </div>
        <div class="match-col match-col--no">
          <h4>What doesn't <span class="count">${mismatches.length}</span></h4>
          ${list(mismatches, 'no', 'Everything compared is within range.')}
        </div>
      </div>
      ${skipped.length
        ? `<p class="match-skipped">Not compared (missing data or zero weight): ${skipped.map((i) => escapeHtml(i.param.label)).join(', ')}</p>`
        : ''}`;
  }
  return `
    <section>
      <h3 class="section-title">What matches / What doesn't</h3>
      ${content}
    </section>`;
}

/* ---------- How to close the gap ---------- */

const GAP_SUMMARY_TOP = 3;   // gaps included in the "closing the top N…" line
const GAP_TIPS_PER_CARD = 3; // tips shown per parameter

function gapCard(item, site, body) {
  const isEarth = site.body === 'earth';
  const earthValue = isEarth ? item.a : item.b;
  const targetValue = isEarth ? item.b : item.a;
  const advice = gapAdvice(item.param.key, earthValue, targetValue, body);
  const tips = advice.tips.slice(0, GAP_TIPS_PER_CARD).map((t) => `
    <li><span class="tip-kind tip-kind--${t.kind}">${escapeHtml(TIP_KINDS[t.kind] ?? t.kind)}</span>${escapeHtml(t.text)}</li>`).join('');

  return `
    <article class="gap-card">
      <header class="gap-card__head">
        <span class="gap-card__title">${escapeHtml(item.param.label)} — ${escapeHtml(advice.summary)}</span>
        <span class="gap-card__gain" title="Index gain if this parameter matched exactly">+${item.gain.toFixed(2)}</span>
      </header>
      <div class="gap-card__meta">
        <span>Earth ${escapeHtml(valueWithUnit(item.param, earthValue))} <span class="vs">vs</span> target ${escapeHtml(valueWithUnit(item.param, targetValue))}</span>
        <span>${Math.round(item.share * 100)}% of gap</span>
        <span class="closable closable--${advice.closable}">${escapeHtml(CLOSABLE_LABELS[advice.closable])}</span>
      </div>
      <ul class="tips">${tips}</ul>
    </article>`;
}

function gapSection(site, { reference, body, cmp }) {
  let content;
  if (!reference) {
    content = '<p class="match-empty">No reference site to compare with.</p>';
  } else if (!cmp.mismatches.length) {
    content = '<p class="match-empty">No significant gaps — every compared parameter is within the match threshold.</p>';
  } else {
    const top = cmp.mismatches.slice(0, GAP_SUMMARY_TOP);
    const now = scoreWithout(cmp, []);
    const after = scoreWithout(cmp, top);
    const earthName = site.body === 'earth' ? site.name : reference.target.name;
    content = `
      <p class="match-caption">
        Closing the top ${top.length} gap${top.length > 1 ? 's' : ''} would raise the index
        from <strong>${fmtScore(now)}</strong> to <strong>${fmtScore(after)}</strong>.
        Advice applies to the Earth analog <strong>${escapeHtml(earthName)}</strong>.
      </p>
      <div class="gap-list">${cmp.mismatches.map((i) => gapCard(i, site, body)).join('')}</div>`;
  }
  return `
    <section>
      <h3 class="section-title">How to close the gap</h3>
      ${content}
    </section>`;
}

function renderSidebar(site) {
  const rows = PARAMS.map((p) => `
    <tr>
      <th scope="row">${escapeHtml(p.label)}</th>
      <td>${formatParam(p, site.params[p.key])}${p.unit ? `<span class="unit">${escapeHtml(p.unit)}</span>` : ''}</td>
    </tr>`).join('');

  const sim = similarityFor(site);

  $('#sidebar-content').innerHTML = `
    <header class="site-head">
      <span class="site-head__badge">${escapeHtml(siteBadge(site))}</span>
      <h2 class="site-head__name">${escapeHtml(site.name)}</h2>
      <div class="site-head__coords">${formatCoords(site.lat, site.lon)}</div>
    </header>

    <!-- TODO: real photo (add a photo_url column to sites.csv) -->
    <div class="photo" role="img" aria-label="Photo placeholder">Photo coming soon</div>

    ${similarityCard(site, sim)}
    ${rankingList(sim)}

    <section>
      <h3 class="section-title">Parameters</h3>
      <table class="params"><tbody>${rows}</tbody></table>
    </section>

    ${matchSection(site, sim)}

    ${gapSection(site, sim)}

    ${site.source ? `<p class="source">Source: ${escapeHtml(site.source)}</p>` : ''}
  `;
}

/* ------------------------------------------------------------------ */
/* Charts (placeholder)                                                */
/* ------------------------------------------------------------------ */

/**
 * TODO: comparison charts (e.g. radar of normalized parameters,
 *       bar chart of parameterDiffs). Container: #charts .charts__body.
 */
function renderCharts() {
  /* intentionally empty */
}

/* ------------------------------------------------------------------ */
/* Events & init                                                       */
/* ------------------------------------------------------------------ */

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
  // Pick a different reference site for the similarity index
  $('#sidebar-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ref]');
    if (!btn || !state.selected) return;
    state.referenceId = btn.dataset.ref;
    renderSidebar(state.selected);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  window.addEventListener('resize', () => visibleMaps().forEach((m) => m.invalidate()));
}

/* Shareable state in the URL hash: #view=compare&target=moon&site=Jezero%20Crater */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (['earth', 'mars', 'moon', 'compare'].includes(h.get('view'))) state.view = h.get('view');
  if (['mars', 'moon'].includes(h.get('target'))) state.compareTarget = h.get('target');
  if (['polar', 'global'].includes(h.get('proj'))) state.moonProjection = h.get('proj');
  return h.get('site');
}

function writeHash() {
  const h = new URLSearchParams({ view: state.view });
  if (state.view === 'compare') h.set('target', state.compareTarget);
  const moonShown = state.view === 'moon' || (state.view === 'compare' && state.compareTarget === 'moon');
  if (moonShown && state.moonProjection !== 'polar') h.set('proj', state.moonProjection);
  if (state.selected) h.set('site', state.selected.name);
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
    state.sites = await loadSites('data/sites.csv');
  } catch (err) {
    console.error(err);
    const fileProto = location.protocol === 'file:';
    showStatus(fileProto
      ? 'Could not load <code>data/sites.csv</code> from a local file. Serve the folder over HTTP, e.g. <code>python -m http.server 8000</code>, then open <code>http://localhost:8000</code>.'
      : `Could not load site data: ${escapeHtml(err.message || err)}`);
  }
  const siteName = readHash();
  render();
  const site = siteName && state.sites.find((s) => s.name === siteName);
  if (site) selectSite(site);

  // Debug handle for the console: window.EA.similarity(a, b)
  window.EA = { state, similarity, WEIGHTS };
}

init();
