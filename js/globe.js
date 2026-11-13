/**
 * globe.js — the "space infographic" home screen: 3D globes (globe.gl) and the
 * animated Earth → Mars / Moon transition.
 *
 * States of the stage (data-mode on #globe-stage):
 *   idle     Earth rotates slowly, analog points pulse
 *   focus    a point was clicked: rotation stops, camera flies to it, card slides in
 *   compare  Earth shrinks to the left, the target globe comes in from the right and
 *            turns to the reference point (pair_id); radar between, details below
 * "Back" walks the same steps in reverse.
 *
 * Motion is CSS transitions (slots, card, accent colour) + globe.gl pointOfView tweens.
 * Durations live in TIMING (JS) and in the --t-* custom properties (css/style.css);
 * with prefers-reduced-motion both drop to 0.
 */

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
    this.reference = null; // reference site in compare mode
    this.targetBody = null;
    this.timers = [];

    const earthEl = root.querySelector('#globe-earth .globe-canvas');
    this.earth = makeGlobe(earthEl, 'earth');
    this.earth
      .pointsData(hooks.analogs.map((s) => ({ site: s, lat: s.lat, lng: s.lon, color: MARKER_COLORS[s.analog_of] ?? '#ffffff', label: escapeHtml(s.name) })))
      .ringsData(reducedMotion() ? [] : hooks.analogs.map((s) => ({ lat: s.lat, lng: s.lon, color: MARKER_COLORS[s.analog_of] ?? '#ffffff' })))
      .onPointClick((d) => this.focus(d.site))
      .onPointHover((d) => { earthEl.style.cursor = d ? 'pointer' : 'grab'; });
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

  /* ---------- step 1: focus a point ---------- */

  focus(site, { instant = false } = {}) {
    if (this.mode === 'compare') return;
    this.clearTimers();
    this.focused = site;
    this.setRotate(false);
    this.earth.pointOfView({ lat: site.lat, lng: site.lon, altitude: ALTITUDE.focus }, instant ? 0 : this.dur(TIMING.fly));
    this.earth.pointRadius((d) => (d.site === site ? 1.1 : 0.7));
    this.card.innerHTML = this.hooks.cardHtml(site);
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
    this.earth.pointOfView({ lat: this.focused.lat, lng: this.focused.lon, altitude: ALTITUDE.compare }, instant ? 0 : this.dur(TIMING.compare));

    this.card.classList.remove('is-open');
    this.setMode('compare');
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
      this.earth.pointOfView({ lat: this.focused.lat, lng: this.focused.lon, altitude: ALTITUDE.focus }, this.dur(TIMING.compare));
      this.reference = null;
      this.setMode('focus');
      this.card.classList.add('is-open');
      this.later(() => this.target?.pauseAnimation(), TIMING.compare);
      return;
    }
    if (this.mode === 'focus') {
      this.hooks.onBack?.('focus');
      this.card.classList.remove('is-open');
      this.later(() => { this.card.hidden = true; }, 600);
      this.earth.pointRadius(() => 0.7);
      this.earth.pointOfView({ lat: this.focused.lat, lng: this.focused.lon, altitude: ALTITUDE.idle }, this.dur(TIMING.fly));
      this.focused = null;
      this.setRotate(true);
      this.setMode('idle');
    }
  }
}
