// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

/**
 * globe.js — the "space infographic" home screen: 3D globes (globe.gl) and the
 * animated Earth → Mars / Moon transition.
 *
 * States of the stage (data-mode on #globe-stage):
 *   idle     Earth rotates slowly, analog points pulse; close sites are one group marker
 *   group    a group marker was clicked: camera zooms in, members fan out, card lists them
 *   focus    a point was clicked: rotation stops, camera flies to it, card slides in
 *   compare  Earth shrinks to the left, the target globe comes in from the right and
 *            turns to the reference point (pair_id); radar between, details below
 * "Back" walks the same steps in reverse.
 *
 * Motion is CSS transitions (slots, card, accent colour) + globe.gl pointOfView tweens.
 * Durations live in TIMING (JS) and in the --t-* custom properties (css/style.css);
 * with prefers-reduced-motion both drop to 0.
 */

import { t, pick, nSites } from './i18n.js';

const Globe = window.Globe;

/** Camera altitude (in globe radii) per state; smaller = closer. */
export const ALTITUDE = { idle: 1.75, focus: 1.6, compare: 1.7, target: 1.7 };

export const TIMING = {
  fly: 1200,      // camera flight to a clicked point (ms)
  compare: 1500,  // Earth → target transition (ms)
  autoRotateSpeed: 0.35,
};

export const TEXTURES = {
  earth: 'assets/textures/earth.jpg',
  mars: 'assets/textures/mars.jpg',
  moon: 'assets/textures/moon.jpg',
};

/** Solid colours used when a texture fails to load. */
const FALLBACK_COLORS = { earth: '#1d4f7a', mars: '#a4522f', moon: '#8d97a3' };

/** Marker colours: Mars analogs orange, Moon analogs silver (and the references themselves). */
export const MARKER_COLORS = { mars: '#ff8a4c', moon: '#d7e2f0' };

/**
 * Sites that sit too close together to click on the whole-Earth view. Each group is one
 * marker while the globe is idle; clicking it zooms in and fans the members out on a
 * small ring (SPREAD.ringDeg), with a thin leader line back to each site's exact spot.
 * Analogs not listed here stay single points.
 */
export const GROUPS = [
  { id: 'arctic', nameEn: 'Devon & Ellesmere islands', nameUk: 'Острови Девон і Елсмір', regionEn: 'Canadian High Arctic', regionUk: 'Канадська Арктика', members: ['DEV-HAU', 'DEV-PLT', 'ELL-FOS'] },
  { id: 'mcmurdo', nameEn: 'McMurdo Dry Valleys', nameUk: 'Сухі долини Мак-Мердо', regionEn: 'Antarctica', regionUk: 'Антарктида', members: ['MDV-TAY', 'MDV-WRI', 'MDV-DJP', 'MDV-BEA'] },
  { id: 'mistastin', nameEn: 'Mistastin Lake crater', nameUk: 'Кратер озера Містастін', regionEn: 'Labrador, Canada', regionUk: 'Лабрадор, Канада', members: ['MIS-ANO', 'MIS-MLT'] },
  { id: 'namib', nameEn: 'Namib Desert', nameUk: 'Пустеля Наміб', regionEn: 'Namibia', regionUk: 'Намібія', members: ['NAM-DUN', 'NAM-RK', 'NAM-GRV'] },
];

/** Fan-out geometry for an open group (degrees of arc, globe radii for altitude). */
export const SPREAD = { ringDeg: 5.5, altitude: 1.45, compareAltitude: 1.7, memberRadius: 1.0, focusedRadius: 1.3, anchorRadius: 0.28 };

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Mean direction of points on the sphere (works across the date line and near poles). */
function sphericalCenter(pts) {
  let x = 0; let y = 0; let z = 0;
  for (const p of pts) {
    const la = toRad(p.lat); const lo = toRad(p.lon);
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) };
}

/** Initial bearing (rad) from a to b. */
function bearing(a, b) {
  const la1 = toRad(a.lat); const la2 = toRad(b.lat); const dl = toRad(b.lon - a.lon);
  return Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl));
}

/** Point at angular distance dDeg from p along bearing brg (rad). */
function destination(p, brg, dDeg) {
  const d = toRad(dDeg); const la1 = toRad(p.lat); const lo1 = toRad(p.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: ((toDeg(lo2) + 540) % 360) - 180 };
}

/**
 * Resolve GROUPS against the loaded sites: centre, colour and a fanned-out display
 * position for every member. Members keep their geographic order around the ring
 * (sorted by bearing from the centre), evenly spaced.
 */
export function buildGroups(analogs) {
  const byId = new Map(analogs.map((s) => [s.id, s]));
  const groups = [];
  for (const cfg of GROUPS) {
    const members = cfg.members.map((id) => byId.get(id)).filter(Boolean);
    if (members.length < 2) continue; // a group of one is just a point
    const center = sphericalCenter(members);
    const ordered = members
      .map((s) => ({ s, b: bearing(center, s) }))
      .sort((p, q) => p.b - q.b);
    const step = (2 * Math.PI) / ordered.length;
    const start = ordered[0].b;
    const spread = new Map(ordered.map(({ s }, i) => [s, destination(center, start + i * step, SPREAD.ringDeg)]));
    const bodies = new Set(members.map((s) => s.analog_of));
    const color = bodies.size === 1 ? MARKER_COLORS[[...bodies][0]] ?? '#ffffff' : '#ffffff';
    groups.push({
      ...cfg, members, lat: center.lat, lon: center.lon, color, spread,
      get name() { return pick(cfg.nameEn, cfg.nameUk); },
      get region() { return pick(cfg.regionEn, cfg.regionUk); },
    });
  }
  return groups;
}

/** Atmosphere glow per body. */
const ATMOSPHERE = { earth: '#5fc8ff', mars: '#ff9a62', moon: '#c7d6ea' };

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const narrow = () => window.matchMedia?.('(max-width: 720px)').matches ?? false;

export function hasWebGL() {
  if (!Globe) return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Stars (one static 2D canvas, redrawn on resize)                     */
/* ------------------------------------------------------------------ */

export function drawStars(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const count = narrow() ? 90 : 180; // keep it light on phones
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const r = rnd() < 0.92 ? 0.6 : 1.1;
    ctx.globalAlpha = 0.15 + rnd() * 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* One globe                                                           */
/* ------------------------------------------------------------------ */

function makeGlobe(el, body) {
  const g = Globe({ animateIn: false })(el)
    .backgroundColor('rgba(0,0,0,0)')
    .showGraticules(true)
    .showAtmosphere(true)
    .atmosphereColor(ATMOSPHERE[body])
    .atmosphereAltitude(0.16)
    .pointAltitude(0.012)
    .pointRadius((d) => d.radius ?? 0.7)
    .pointColor((d) => d.color)
    .pointLabel((d) => `<div class="globe-tip">${d.label}</div>`)
    .pathPoints('path')
    .pathPointLat((p) => p[0])
    .pathPointLng((p) => p[1])
    .pathPointAlt(0.006)
    .pathColor((d) => hexAlpha(d.color, 0.7))
    .pathStroke(null)
    .pathTransitionDuration(0)
    .ringColor((d) => (t) => hexAlpha(d.color, 1 - t))
    .ringMaxRadius(3.6)
    .ringPropagationSpeed(1.6)
    .ringRepeatPeriod(1600);
  g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow() ? 1.25 : 1.5));
  const ctl = g.controls();
  ctl.enableZoom = false; // never hijack page scroll
  ctl.enablePan = false;
  setTexture(g, body);
  return g;
}

function setTexture(g, body) {
  const url = TEXTURES[body];
  const img = new Image();
  img.onload = () => g.globeImageUrl(url);
  img.onerror = () => {
    console.warn(`[globe] texture for ${body} not available — using a plain sphere`);
    g.globeImageUrl(null);
    g.globeMaterial().color.set(FALLBACK_COLORS[body]);
  };
  img.src = url;
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(3)})`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

export class GlobeStage {
  /**
   * @param {HTMLElement} root   #globe-view
   * @param {{
   *   analogs: object[], references: object[], byId: (id) => object,
   *   cardHtml: (site) => string,
   *   onCompare: (analog, reference) => void,   // fill radar + details after the transition
   *   onBack: () => void, onStateChange: () => void,
   * }} hooks
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.stage = root.querySelector('#globe-stage');
    this.card = root.querySelector('#globe-card');
    this.mode = 'idle';
    this.focused = null;   // analog site
    this.group = null;     // open (fanned-out) group, see GROUPS
    this.reference = null; // reference site in compare mode
    this.targetBody = null;
    this.timers = [];

    this.groups = buildGroups(hooks.analogs);
    this.groupOf = new Map(this.groups.flatMap((g) => g.members.map((s) => [s, g])));

    const earthEl = root.querySelector('#globe-earth .globe-canvas');
    this.earth = makeGlobe(earthEl, 'earth');
    this.earth
      .onPointClick((d) => {
        if (d.kind === 'group') this.openGroup(d.group);
        else this.focus(d.site);
      })
      .onPointHover((d) => { earthEl.style.cursor = d ? 'pointer' : 'grab'; });
    this.renderEarthMarkers();
    this.earth.pointOfView({ lat: 25, lng: 10, altitude: ALTITUDE.idle }, 0);
    this.setRotate(true);

    this.target = null; // created on first compare
    this.resize();
    this.setMode('idle');
  }

  /* ---------- helpers ---------- */

  later(fn, ms) {
    const id = setTimeout(fn, reducedMotion() ? 0 : ms);
    this.timers.push(id);
  }

  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  dur(ms) { return reducedMotion() ? 0 : ms; }

  setRotate(on) {
    const ctl = this.earth.controls();
    ctl.autoRotate = on && !reducedMotion();
    ctl.autoRotateSpeed = TIMING.autoRotateSpeed;
  }

  setMode(mode) {
    this.mode = mode;
    this.stage.dataset.mode = mode;
    this.root.dataset.body = mode === 'compare' && this.targetBody ? this.targetBody : 'earth';
    this.hooks.onStateChange?.();
  }

  /** Size each globe to its slot (slots are square, scaled with CSS transforms). */
  resize() {
    for (const [g, sel] of [[this.earth, '#globe-earth'], [this.target, '#globe-target']]) {
      if (!g) continue;
      const el = this.root.querySelector(sel);
      g.width(el.clientWidth).height(el.clientHeight);
    }
    drawStars(this.root.querySelector('.space__stars'));
  }

  pause() { this.earth.pauseAnimation(); this.target?.pauseAnimation(); }

  resume() { this.earth.resumeAnimation(); if (this.mode === 'compare') this.target?.resumeAnimation(); this.resize(); }

  /* ---------- Earth markers (singles, collapsed groups, the open group) ---------- */

  /** Rebuild the Earth's points, rings and leader lines from the current state. */
  renderEarthMarkers() {
    const pts = [];
    const rings = [];
    const paths = [];
    const colorOf = (s) => MARKER_COLORS[s.analog_of] ?? '#ffffff';
    for (const s of this.hooks.analogs) {
      if (this.groupOf.has(s)) continue;
      pts.push({ kind: 'site', site: s, lat: s.lat, lng: s.lon, color: colorOf(s), radius: s === this.focused ? 1.1 : 0.7, label: escapeHtml(s.name) });
      rings.push({ lat: s.lat, lng: s.lon, color: colorOf(s) });
    }
    for (const g of this.groups) {
      if (g !== this.group) {
        const names = g.members.map((s) => `<br>· ${escapeHtml(s.name)}`).join('');
        pts.push({ kind: 'group', group: g, lat: g.lat, lng: g.lon, color: g.color, radius: 1.05, label: `<strong>${escapeHtml(g.name)}</strong> · ${escapeHtml(nSites(g.members.length))}${names}` });
        rings.push({ lat: g.lat, lng: g.lon, color: g.color });
        continue;
      }
      for (const s of g.members) {
        const p = g.spread.get(s);
        const color = colorOf(s);
        const isFocused = s === this.focused;
        pts.push({ kind: 'site', site: s, lat: p.lat, lng: p.lon, color, radius: isFocused ? SPREAD.focusedRadius : SPREAD.memberRadius, label: escapeHtml(s.name) });
        pts.push({ kind: 'anchor', site: s, lat: s.lat, lng: s.lon, color: '#ffffff', radius: SPREAD.anchorRadius, label: escapeHtml(t('gl.exact', { name: s.name })) });
        paths.push({ path: [[s.lat, s.lon], [p.lat, p.lon]], color });
        if (isFocused || !this.focused) rings.push({ lat: p.lat, lng: p.lon, color });
      }
    }
    this.earth
      .pointsData(pts)
      .pathsData(paths)
      .ringsData(reducedMotion() ? [] : rings);
  }

  /** Redraw everything that shows text after a language switch (markers, card). */
  relocalize() {
    this.renderEarthMarkers();
    if (this.mode === 'group' && this.group) this.card.innerHTML = this.hooks.groupCardHtml(this.group);
    else if (this.focused) this.card.innerHTML = this.hooks.cardHtml(this.focused, this.group);
    if (this.mode === 'compare' && this.reference) {
      const refs = this.hooks.references.filter((r) => r.body === this.targetBody);
      const color = MARKER_COLORS[this.targetBody];
      this.target.pointsData(refs.map((r) => ({ site: r, lat: r.lat, lng: r.lon, color, radius: r === this.reference ? 1.1 : 0.6, label: escapeHtml(r.name) })));
      this.hooks.onCompare(this.focused, this.reference);
    }
  }

  /** Where the camera looks at a site: its fanned-out spot if it belongs to the open group. */
  viewOf(site) {
    const p = this.group?.spread.get(site);
    return p ? { lat: p.lat, lng: p.lon } : { lat: site.lat, lng: site.lon };
  }

  /* ---------- step 0: open a group of close sites ---------- */

  openGroup(group, { instant = false } = {}) {
    if (this.mode === 'compare' || !group) return;
    this.clearTimers();
    this.group = group;
    this.focused = null;
    this.setRotate(false);
    this.renderEarthMarkers();
    this.earth.pointOfView({ lat: group.lat, lng: group.lon, altitude: SPREAD.altitude }, instant ? 0 : this.dur(TIMING.fly));
    this.card.innerHTML = this.hooks.groupCardHtml(group);
    this.card.hidden = false;
    requestAnimationFrame(() => this.card.classList.add('is-open'));
    this.setMode('group');
  }

  /* ---------- step 1: focus a point ---------- */

  focus(site, { instant = false } = {}) {
    if (this.mode === 'compare') return;
    this.clearTimers();
    this.focused = site;
    this.group = this.groupOf.get(site) ?? null;
    this.setRotate(false);
    this.renderEarthMarkers();
    const altitude = this.group ? SPREAD.altitude : ALTITUDE.focus;
    this.earth.pointOfView({ ...this.viewOf(site), altitude }, instant ? 0 : this.dur(TIMING.fly));
    this.card.innerHTML = this.hooks.cardHtml(site, this.group);
    this.card.hidden = false;
    requestAnimationFrame(() => this.card.classList.add('is-open'));
    this.setMode('focus');
  }

  /* ---------- step 2 + 3: compare ---------- */

  compare(reference, { instant = false } = {}) {
    if (!this.focused || !reference) return;
    this.clearTimers();
    this.reference = reference;
    const body = reference.body;

    const targetEl = this.root.querySelector('#globe-target .globe-canvas');
    if (!this.target) {
      this.target = makeGlobe(targetEl, body);
      this.targetBody = body;
    } else if (this.targetBody !== body) {
      setTexture(this.target, body);
      this.target.atmosphereColor(ATMOSPHERE[body]);
      this.targetBody = body;
    }
    this.targetBody = body;
    this.target.resumeAnimation();
    const refs = this.hooks.references.filter((r) => r.body === body);
    const color = MARKER_COLORS[body];
    this.target
      .pointsData(refs.map((r) => ({ site: r, lat: r.lat, lng: r.lon, color, radius: r === reference ? 1.1 : 0.6, label: escapeHtml(r.name) })))
      .ringsData(reducedMotion() ? [] : [{ lat: reference.lat, lng: reference.lon, color }]);
    this.resize();

    // Start turned away, then rotate to the reference point while sliding in.
    const alt = ALTITUDE.target;
    this.target.pointOfView({ lat: reference.lat * 0.4, lng: reference.lon - 110, altitude: 3.2 }, 0);
    this.target.controls().autoRotate = false;
    const earthAlt = this.group ? SPREAD.compareAltitude : ALTITUDE.compare;
    this.earth.pointOfView({ ...this.viewOf(this.focused), altitude: earthAlt }, instant ? 0 : this.dur(TIMING.compare));

    this.card.classList.remove('is-open');
    this.setMode('compare');
    this.renderEarthMarkers();
    requestAnimationFrame(() => {
      this.target.pointOfView({ lat: reference.lat, lng: reference.lon, altitude: alt }, instant ? 0 : this.dur(TIMING.compare));
    });
    if (instant) this.hooks.onCompare(this.focused, reference);
    else this.later(() => this.hooks.onCompare(this.focused, reference), TIMING.compare * 0.6);
  }

  /* ---------- back ---------- */

  back() {
    this.clearTimers();
    if (this.mode === 'compare') {
      this.hooks.onBack?.('compare');
      this.target.pointOfView({ lat: this.reference.lat * 0.4, lng: this.reference.lon - 110, altitude: 3.2 }, this.dur(TIMING.compare));
      const altitude = this.group ? SPREAD.altitude : ALTITUDE.focus;
      this.earth.pointOfView({ ...this.viewOf(this.focused), altitude }, this.dur(TIMING.compare));
      this.reference = null;
      this.setMode('focus');
      this.renderEarthMarkers();
      this.card.classList.add('is-open');
      this.later(() => this.target?.pauseAnimation(), TIMING.compare);
      return;
    }
    if (this.mode === 'focus' && this.group) {
      // a grouped site goes back to its group's list, not straight to the whole Earth
      this.hooks.onBack?.('focus');
      this.openGroup(this.group);
      return;
    }
    if (this.mode === 'focus' || this.mode === 'group') {
      this.hooks.onBack?.(this.mode);
      const from = this.group ?? this.focused;
      this.card.classList.remove('is-open');
      this.later(() => { this.card.hidden = true; }, 600);
      this.earth.pointOfView({ lat: from.lat, lng: from.lon, altitude: ALTITUDE.idle }, this.dur(TIMING.fly));
      this.focused = null;
      this.group = null;
      this.setMode('idle');
      this.renderEarthMarkers();
      this.setRotate(true);
    }
  }
}
