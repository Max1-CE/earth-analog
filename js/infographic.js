// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

/**
 * infographic.js — "Can humans live here?" (infographic.html).
 *
 * Reads only data files; there are no data values in this file or in the HTML:
 *   data/habitability.csv             per-site values (analysis/habitability.py)
 *   data/habitability_constants.json  triple point, Armstrong limit, solar constant,
 *                                     gravity, comm delay, vapour curve, sources
 *   data/sites.csv                    English site names
 *   data/limits.json                  team texts for the survival kit
 * Values with status estimate / check are drawn in grey italics (class .ig-uncertain).
 */

const Chart = window.Chart;
const BODIES = ['Earth', 'Mars', 'Moon'];
const BODY_KEY = { Earth: 'earth', Mars: 'mars', Moon: 'moon' };

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

const VERSION = document.querySelector('meta[name="app-version"]')?.content ?? '';
const withVersion = (url) => (VERSION && VERSION !== '0' ? `${url}?v=${encodeURIComponent(VERSION)}` : url);

function loadCsv(url) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(withVersion(url), {
      download: true, header: true, comments: '#', skipEmptyLines: 'greedy',
      complete: (r) => resolve(r.data),
      error: (e) => reject(new Error(`${url}: ${e?.message || e}`)),
    });
  });
}

async function loadJson(url) {
  const res = await fetch(withVersion(url));
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const num = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const color = (body) => css(`--accent-${BODY_KEY[body]}`);
/** '#e8743f' + 0.5 → 'rgba(232, 116, 63, 0.5)' (canvas does not take color-mix). */
function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const uncertain = (status) => status === 'estimate' || status === 'check';

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

/** 101300 → "101.3 kPa", 850 → "850 Pa", 1e-12 → "1 × 10⁻¹² Pa". */
function fmtPressure(p) {
  if (p === null) return 'no data';
  if (p === 0) return '0 Pa';
  if (p >= 1000) return `${(p / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} kPa`;
  if (p >= 1) return `${p.toLocaleString('en', { maximumFractionDigits: 1 })} Pa`;
  const e = Math.floor(Math.log10(p));
  const m = Number((p / 10 ** e).toPrecision(2));
  return `${m === 1 ? '' : `${m} × `}10${sup(e)} Pa`;
}

/** [730, 850] → "730–850 Pa"; mixed units fall back to two full values. */
function pressureRange(ps) {
  const vs = ps.filter((v) => v !== null);
  if (!vs.length) return 'no data';
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  if (lo === hi) return fmtPressure(lo);
  const [a, ua] = fmtPressure(lo).split(/ (?=\S+$)/);
  const [b, ub] = fmtPressure(hi).split(/ (?=\S+$)/);
  return ua === ub ? `${a}–${b} ${ub}` : `${fmtPressure(lo)} – ${fmtPressure(hi)}`;
}

const fmtNum = (v, digits = 2) => (v === null ? 'no data' : v.toLocaleString('en', { maximumFractionDigits: digits }));
/** Two significant figures for "×~N" ratios: 92.9 → 93, 200 → 200. */
const twoSig = (v) => Number(v.toPrecision(2)).toLocaleString('en');

function range(values, f = (v) => v) {
  const vs = values.filter((v) => v !== null);
  if (!vs.length) return 'no data';
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
}

/** Worst status among rows: check > estimate > computed > literature. */
function statusOf(rows) {
  const order = ['literature', 'computed', 'estimate', 'check'];
  return rows.reduce((acc, r) => (order.indexOf(r.data_status) > order.indexOf(acc) ? r.data_status : acc), 'literature');
}

const badge = (status) => `<span class="ig-st ig-st--${esc(status)}">${esc(status)}</span>`;
const val = (text, status) => `<span class="${uncertain(status) ? 'ig-uncertain' : ''}">${esc(text)}</span>`;

function sources(id, keys, statuses, C) {
  const uniq = [...new Set(statuses)];
  $(id).innerHTML = `<span>Sources: ${keys.map((k) => esc(C.sources[k] ?? k)).join(' · ')}</span>
    <span class="ig-sources__st">Status: ${uniq.map(badge).join(' ')}</span>`;
}

/* ------------------------------------------------------------------ */
/* Chart.js setup                                                      */
/* ------------------------------------------------------------------ */

function chartDefaults() {
  Chart.defaults.color = css('--space-text');
  Chart.defaults.font.family = css('--font-label');
  Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}

/** Horizontal reference lines across the plot: options.plugins.igLines = [{y, label, color, dash}]. */
const linesPlugin = {
  id: 'igLines',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    for (const l of opts.lines ?? []) {
      const py = y.getPixelForValue(l.y);
      if (py < a.top || py > a.bottom) continue;
      ctx.save();
      ctx.strokeStyle = l.color;
      ctx.setLineDash(l.dash ?? [6, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = l.color;
      ctx.font = `11px ${css('--font-label')}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(l.label, a.right - 4, py - 3);
      ctx.restore();
    }
  },
};

/** Short ticks on bars with a label: options.plugins.igMarks.marks = [{index, y, label, dash}]. */
const marksPlugin = {
  id: 'igMarks',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, scales: { y } } = chart;
    const meta = chart.getDatasetMeta(0);
    for (const m of opts.marks ?? []) {
      const bar = meta.data[m.index];
      if (!bar) continue;
      const py = y.getPixelForValue(m.y);
      const half = bar.width / 2 + 8;
      ctx.save();
      ctx.strokeStyle = m.color ?? '#fff';
      ctx.setLineDash(m.dash ?? []);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bar.x - half, py); ctx.lineTo(bar.x + half, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color ?? '#fff';
      ctx.font = `11px ${css('--font-label')}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.label, bar.x - half - 6, py);
      ctx.restore();
    }
  },
};

/** Text above bars: options.plugins.igTop.labels = [string per bar]. */
const topPlugin = {
  id: 'igTop',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx } = chart;
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const text = opts.labels?.[i];
      if (!text) return;
      ctx.save();
      ctx.fillStyle = css('--space-text');
      ctx.font = `600 13px ${css('--font-label')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, bar.x, bar.y - 6);
      ctx.restore();
    });
  },
};

function logAxis(minV, maxV, title) {
  return {
    type: 'logarithmic',
    min: 10 ** (Math.floor(Math.log10(minV)) - 1),
    max: 10 ** (Math.ceil(Math.log10(maxV)) + 1),
    title: { display: true, text: title },
    ticks: {
      callback: (v) => {
        const e = Math.log10(v);
        return Number.isInteger(Math.round(e * 1e6) / 1e6) ? `10${sup(Math.round(e))}` : '';
      },
    },
    grid: { color: 'rgba(255, 255, 255, 0.06)' },
  };
}

/** Diagonal hatch for the liquid-water area. */
function hatch(col) {
  const c = document.createElement('canvas');
  c.width = c.height = 10;
  const g = c.getContext('2d');
  g.strokeStyle = col;
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, 10); g.lineTo(10, 0); g.stroke();
  return g.createPattern(c, 'repeat');
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function hero(H, C) {
  const gEarth = C.bodies.Earth.gravity_m_s2;
  $('#hero-cols').innerHTML = BODIES.map((b) => {
    const rows = H.filter((r) => r.body === b);
    const st = statusOf(rows);
    const p = rows.map((r) => num(r.pressure_pa));
    let pNote = rows.length > 1 && Math.min(...p) !== Math.max(...p) ? 'range over the sites' : '';
    if (b === 'Mars') pNote = `sites · planetary mean ~${fmtPressure(C.mars_mean_pressure_pa.value)}`;
    if (b === 'Moon') pNote = `NASA NSSDC night value: ${fmtPressure(C.moon_pressure_nssdc_pa.value)}`;
    const g = C.bodies[b].gravity_m_s2;
    const dose = rows.map((r) => num(r.radiation_msv_year));
    const o2 = rows.map((r) => num(r.o2_pct));
    return `
      <section class="ig-body" style="--body:${color(b)}">
        <h3 class="ig-body__name">${b}</h3>
        <dl class="ig-stats">
          <div><dt>Pressure</dt><dd>${val(pressureRange(p), st)}</dd>${pNote ? `<p class="ig-stats__note">${esc(pNote)}</p>` : ''}</div>
          <div><dt>O₂ in the air</dt><dd>${val(`${range(o2, (v) => fmtNum(v, 3))} %`, st)}</dd></div>
          <div><dt>Radiation dose per year</dt><dd>${val(`${range(dose, (v) => fmtNum(v, 1))} mSv`, st)}</dd></div>
          <div><dt>Gravity</dt><dd>${esc(`${fmtNum(g)} m/s²`)}</dd><p class="ig-stats__note">${esc(`${fmtNum(g / gEarth)} g`)}</p></div>
        </dl>
      </section>`;
  }).join('');
  sources('#src-hero', ['sites', 'nssdc', 'limits'], [...new Set(H.map((r) => r.data_status)), 'literature'], C);
}

function pressureCard(H, C) {
  const per = BODIES.map((b) => H.filter((r) => r.body === b));
  const maxP = per.map((rows) => Math.max(...rows.map((r) => num(r.pressure_pa))));
  const minP = per.map((rows) => Math.min(...rows.map((r) => num(r.pressure_pa))));
  const all = [...minP, ...maxP, C.moon_pressure_nssdc_pa.value, C.triple_point.p_pa, C.armstrong_limit_pa.value];
  const marks = [];
  const mi = BODIES.indexOf('Mars');
  marks.push({ index: mi, y: C.mars_mean_pressure_pa.value, label: `planetary mean ~${fmtPressure(C.mars_mean_pressure_pa.value)}`, dash: [3, 3] });
  marks.push({ index: BODIES.indexOf('Moon'), y: C.moon_pressure_nssdc_pa.value, label: `NSSDC night ${fmtPressure(C.moon_pressure_nssdc_pa.value)}`, dash: [3, 3] });

  new Chart($('#chart-pressure'), {
    type: 'bar',
    data: {
      labels: BODIES,
      datasets: [{
        data: maxP,
        backgroundColor: BODIES.map((b) => alpha(color(b), 0.55)),
        borderColor: BODIES.map(color),
        borderWidth: 2,
        borderDash: [5, 3],
        maxBarThickness: 70,
      }],
    },
    options: {
      layout: { padding: { right: 8 } },
      scales: { y: logAxis(Math.min(...all), Math.max(...all), 'Pa (log scale)'), x: { grid: { display: false } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${pressureRange(per[c.dataIndex].map((r) => num(r.pressure_pa)))} · ${statusOf(per[c.dataIndex])}` } },
        igLines: {
          lines: [
            { y: C.triple_point.p_pa, label: `${fmtPressure(C.triple_point.p_pa)} — water triple point`, color: css('--accent-earth') },
            { y: C.armstrong_limit_pa.value, label: `~${fmtPressure(C.armstrong_limit_pa.value)} — Armstrong limit (no spacesuit below)`, color: '#f0c674' },
          ],
        },
        igMarks: { marks },
      },
    },
    plugins: [linesPlugin, marksPlugin],
  });

  const mars = per[mi].map((r) => num(r.pressure_pa));
  $('#note-pressure').innerHTML = `<strong>Site value vs planetary mean.</strong> The Mars sites (${esc(pressureRange(mars))})
    lie in low basins and plains, so their pressure is above the ~${esc(fmtPressure(C.mars_mean_pressure_pa.value))} planetary mean
    from <code>limits.json</code>. Moon: <code>limits.json</code> gives ${esc(fmtPressure(minP[BODIES.indexOf('Moon')]))},
    NASA NSSDC ${esc(fmtPressure(C.moon_pressure_nssdc_pa.value))} at night ${badge('check')}. Dashed bars: values not verified yet.`;
  sources('#src-pressure', ['sites', 'limits', 'triple_point', 'armstrong', 'nssdc'], [...H.map((r) => r.data_status), 'literature'], C);
}

function radiationCard(H, C) {
  const per = BODIES.map((b) => H.filter((r) => r.body === b));
  const dose = per.map((rows) => Math.max(...rows.map((r) => num(r.radiation_msv_year))));
  const earth = dose[0];
  const labels = dose.map((d, i) => (i === 0 ? `${fmtNum(d, 1)} mSv · baseline` : `${fmtNum(d, 0)} mSv · ×~${twoSig(d / earth)}`));
  new Chart($('#chart-radiation'), {
    type: 'bar',
    data: {
      labels: BODIES,
      datasets: [{
        data: dose,
        backgroundColor: BODIES.map((b) => alpha(color(b), 0.55)),
        borderColor: BODIES.map(color),
        borderWidth: 2,
        borderDash: [5, 3],
        maxBarThickness: 70,
      }],
    },
    options: {
      layout: { padding: { top: 24 } },
      scales: { y: logAxis(Math.min(...dose), Math.max(...dose), 'mSv per year (log scale)'), x: { grid: { display: false } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${fmtNum(c.raw, 2)} mSv/year (${fmtNum(num(per[c.dataIndex][0].radiation_msv_day), 3)} mSv/day × 365) · ${statusOf(per[c.dataIndex])}` } },
        igTop: { labels },
      },
    },
    plugins: [topPlugin],
  });
  sources('#src-radiation', ['sites', 'limits'], H.map((r) => r.data_status), C);
}

function waterCard(H, C, names) {
  const curve = C.vapour_curve.map((p) => ({ x: p.t_c, y: p.p_pa }));
  const ps = H.map((r) => num(r.pressure_pa));
  const yMin = 10 ** (Math.floor(Math.log10(Math.min(...ps))) - 1);
  const yMax = 10 ** (Math.ceil(Math.log10(Math.max(...ps, ...curve.map((p) => p.y)))) + 1);
  const xMin = Math.floor(Math.min(...H.map((r) => num(r.t_surf_min_c))) / 50) * 50;
  const xMax = Math.ceil(Math.max(...curve.map((p) => p.x)) / 10) * 10;
  const tp = C.triple_point;
  const earthCol = css('--accent-earth');

  const datasets = [
    {
      label: 'Liquid water',
      data: curve,
      showLine: true, pointRadius: 0, borderColor: earthCol, borderWidth: 2,
      fill: 'end', backgroundColor: hatch(alpha(earthCol, 0.45)),
      order: 3,
    },
    {
      label: 'Melting line (0 °C)',
      data: [{ x: tp.t_c, y: tp.p_pa }, { x: tp.t_c, y: yMax }],
      showLine: true, pointRadius: 0, borderColor: earthCol, borderWidth: 1.5, borderDash: [4, 3],
      order: 3,
    },
    {
      label: 'Triple point',
      data: [{ x: tp.t_c, y: tp.p_pa }],
      pointRadius: 6, pointStyle: 'triangle', backgroundColor: '#fff', borderColor: '#fff',
      order: 1,
    },
  ];
  for (const b of BODIES) {
    const rows = H.filter((r) => r.body === b);
    datasets.push({
      label: b,
      data: rows.map((r) => ({ x: num(r.t_surf_mean_c), y: num(r.pressure_pa), row: r })),
      pointRadius: 5, backgroundColor: color(b), borderColor: '#05071a', borderWidth: 1,
      order: 0,
    });
    for (const r of rows) {
      datasets.push({
        label: `_range_${r.site_id}`,
        data: [{ x: num(r.t_surf_min_c), y: num(r.pressure_pa) }, { x: num(r.t_surf_max_c), y: num(r.pressure_pa) }],
        showLine: true, pointRadius: 0, borderColor: alpha(color(b), 0.6), borderWidth: 2,
        order: 2,
      });
    }
  }

  new Chart($('#chart-water'), {
    type: 'scatter',
    data: { datasets },
    options: {
      scales: {
        x: { type: 'linear', min: xMin, max: xMax, title: { display: true, text: 'Temperature, °C' }, grid: { color: 'rgba(255, 255, 255, 0.06)' } },
        y: { ...logAxis(yMin * 10, yMax / 10, 'Pressure, Pa (log scale)'), min: yMin, max: yMax },
      },
      plugins: {
        legend: { labels: { filter: (item) => !item.text.startsWith('_range_') } },
        tooltip: {
          filter: (item) => !item.dataset.label.startsWith('_range_'),
          callbacks: {
            label: (c) => {
              const r = c.raw.row;
              if (!r) return `${c.dataset.label}: ${fmtNum(c.raw.x, 2)} °C, ${fmtPressure(c.raw.y)}`;
              const tb = num(r.t_boil_c);
              return [
                `${names[r.site_id] ?? r.site_id}: ${fmtPressure(num(r.pressure_pa))}`,
                `T ${r.t_surf_min_c} … ${r.t_surf_mean_c} … ${r.t_surf_max_c} °C`,
                tb === null ? 'no liquid water at this pressure' : `liquid between 0 and ${fmtNum(tb, 1)} °C`,
                `water possible now: ${r.water_possible_now || 'no data'} · ${r.data_status}`,
              ];
            },
          },
        },
      },
    },
  });

  const per = BODIES.map((b) => {
    const rows = H.filter((r) => r.body === b);
    const now = rows.filter((r) => r.water_possible_now === 'true').length;
    const tb = rows.map((r) => num(r.t_boil_c)).filter((v) => v !== null);
    const win = tb.length ? `window 0 to ${range(tb, (v) => fmtNum(v, 1))} °C` : 'no liquid window';
    return `<strong style="color:${color(b)}">${b}</strong>: ${esc(win)}; liquid possible at ${now} of ${rows.length} sites`;
  });
  $('#note-water').innerHTML = per.join(' · ');
  sources('#src-water', ['buck', 'triple_point', 'sites'], ['computed', ...H.map((r) => r.data_status)], C);
}

function solarCard(H, C, names) {
  const rows = BODIES.flatMap((b) => H.filter((r) => r.body === b));
  $('#solar-box').style.height = `${rows.length * 26 + 90}px`;
  new Chart($('#chart-solar'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => names[r.site_id] ?? r.site_id),
      datasets: [{
        data: rows.map((r) => num(r.solar_max_w_m2)),
        backgroundColor: rows.map((r) => alpha(color(r.body), 0.7)),
        borderColor: rows.map((r) => color(r.body)),
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: { min: 0, title: { display: true, text: 'W/m², top-of-atmosphere upper bound' }, grid: { color: 'rgba(255, 255, 255, 0.06)' } },
        y: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            // phones: shorten long site names (the tooltip keeps the full name)
            callback(v) { const l = this.getLabelForValue(v); return window.innerWidth < 600 && l.length > 18 ? `${l.slice(0, 17)}…` : l; },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const r = rows[c.dataIndex];
              return `${c.label}: ${fmtNum(c.raw, 0)} W/m² at Sun elevation ${r.sun_elev_max_deg}° (${r.body})${num(r.solar_max_w_m2) === 0 ? ' · permanent shadow' : ''}`;
            },
          },
        },
      },
    },
  });
  sources('#src-solar', ['solar', 'nssdc', 'sites'], ['computed', 'literature'], C);
}

/* ---------- Yes / No grid ---------- */

const ICON = { good: '✓', bad: '✕', partial: '◐', unknown: '?' };
const cell = (kind, text, status = 'literature') => `
  <td class="ig-cell ig-cell--${kind}">
    <span class="ig-cell__icon" aria-hidden="true">${ICON[kind]}</span>
    <span class="ig-cell__text ${uncertain(status) ? 'ig-uncertain' : ''}">${esc(text)}</span>
  </td>`;

function gridCard(H, C) {
  const per = Object.fromEntries(BODIES.map((b) => [b, H.filter((r) => r.body === b)]));
  const minO2 = C.o2_breathable_min_pa.value;
  const gEarth = C.bodies.Earth.gravity_m_s2;
  const PERCHLORATE = /перхлорат/i;
  const NOT_PERCHLORATE = /не перхлорат/i;

  const rows = [
    ['Breathable O₂', (b, rs) => {
      const po2 = Math.max(...rs.map((r) => num(r.o2_partial_pa)));
      return cell(po2 >= minO2 ? 'good' : 'bad', `O₂ partial pressure ${fmtPressure(po2)}`, statusOf(rs));
    }],
    ['UV-C shielding', (b, rs) => {
      const reaches = rs.some((r) => r.uvc_surface === 'yes');
      return cell(reaches ? 'bad' : 'good', reaches ? 'UV-C reaches the surface' : 'UV-C blocked', statusOf(rs));
    }],
    ['Liquid water', (b, rs) => {
      const tb = rs.map((r) => num(r.t_boil_c)).filter((v) => v !== null);
      if (!tb.length) return cell('bad', 'pressure below the triple point', statusOf(rs));
      const steady = rs.some((r) => num(r.t_boil_c) !== null && num(r.t_surf_mean_c) >= 0 && num(r.t_surf_mean_c) <= num(r.t_boil_c));
      const brief = rs.some((r) => r.water_possible_now === 'true');
      const win = `0 to ${range(tb, (v) => fmtNum(v, 1))} °C`;
      if (steady) return cell('good', `liquid at mean temperature (${win})`, statusOf(rs));
      if (brief) return cell('partial', `only at peak temperatures (${win})`, statusOf(rs));
      return cell('bad', `too cold for the ${win} window`, statusOf(rs));
    }],
    ['Toxic perchlorates', (b, rs) => {
      const known = rs.filter((r) => r.toxic_salts_uk);
      if (!known.length) return cell('unknown', 'no data');
      const found = known.filter((r) => PERCHLORATE.test(r.toxic_salts_uk) && !NOT_PERCHLORATE.test(r.toxic_salts_uk));
      if (!found.length) return cell('good', `none reported (${known.length} of ${rs.length} sites with data)`, 'check');
      return cell(found.length === rs.length ? 'bad' : 'partial', `reported at ${found.length} of ${rs.length} sites`, 'check');
    }],
    ['Gravity', (b) => {
      const g = C.bodies[b].gravity_m_s2;
      return cell(g === gEarth ? 'good' : 'bad', `${fmtNum(g / gEarth)} g`);
    }],
    ['Comm delay to Earth', (b) => {
      const d = C.bodies[b].comm_delay;
      return cell(b === 'Earth' ? 'good' : 'partial', b === 'Earth' ? 'none' : d);
    }],
  ];

  $('#yes-no-grid').innerHTML = `
    <thead><tr><th></th>${BODIES.map((b) => `<th scope="col" style="color:${color(b)}">${b}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><th scope="row">${esc(label)}</th>${BODIES.map((b) => f(b, per[b])).join('')}</tr>`).join('')}</tbody>`;
  sources('#src-grid', ['sites', 'osha', 'triple_point', 'nssdc', 'comm'], [...H.map((r) => r.data_status), 'literature'], C);
}

/* ---------- Survival kit ---------- */

const KIT = [
  { title: 'Pressurized habitat', factor: 'atmosphere' },
  { title: 'O₂ supply', factor: 'atmosphere', o2: true },
  { title: 'Radiation shelter', factor: 'radiation' },
  { title: 'UV protection', factor: 'uv' },
  { title: 'Perchlorate filtering', factor: 'regolith', perchlorate: true },
];

function kitCard(H, C, limits) {
  const PERCHLORATE = /перхлорат/i;
  $('#kit-cols').innerHTML = ['Mars', 'Moon'].map((b) => {
    const L = limits[BODY_KEY[b]];
    const rs = H.filter((r) => r.body === b);
    const items = KIT.map((k) => {
      const f = L?.factors.find((x) => x.id === k.factor);
      let body;
      if (k.perchlorate && !rs.some((r) => PERCHLORATE.test(r.toxic_salts_uk))) {
        body = `<p class="ig-kit__muted">No perchlorates reported for the ${esc(b)} sites (no data).</p>`;
      } else if (!f) {
        body = `<p class="ig-kit__muted">Not listed in the team document for ${esc(b)}.</p>`;
      } else {
        const methods = L.mitigations.filter((m) => m.addresses.includes(k.factor));
        const po2 = k.o2 ? Math.max(...rs.map((r) => num(r.o2_partial_pa))) : null;
        body = `
          <p><span class="ig-kit__lbl">${esc(b)}</span> ${esc(f.target)}</p>
          ${k.o2 ? '' : `<p><span class="ig-kit__lbl">Earth</span> ${esc(f.earth)}</p>`}
          ${k.o2 ? `<p><span class="ig-kit__lbl">O₂</span> ${val(`partial pressure ${fmtPressure(po2)} vs ${fmtPressure(C.o2_breathable_min_pa.value)} needed`, statusOf(rs))}</p>` : ''}
          ${k.o2 ? '' : `<p class="ig-kit__why">${esc(f.why)}</p>`}
          ${methods.length && !k.o2 ? `<ul class="ig-kit__methods">${methods.map((m) => `<li>${esc(m.method)}</li>`).join('')}</ul>` : ''}`;
      }
      return `<li class="ig-kit__item"><h4>${esc(k.title)}</h4>${body}</li>`;
    }).join('');
    return `<section class="ig-kit__col" style="--body:${color(b)}"><h3 class="ig-body__name">${b}</h3><ul class="ig-kit__list">${items}</ul></section>`;
  }).join('');
  sources('#src-kit', ['limits', 'sites', 'osha'], ['literature', ...H.filter((r) => r.body !== 'Earth').map((r) => r.data_status)], C);
}

/* ------------------------------------------------------------------ */
/* PNG export (one card = one slide)                                   */
/* ------------------------------------------------------------------ */

async function downloadCard(id) {
  const card = document.getElementById(id);
  if (!card || !window.html2canvas) return;
  const canvas = await window.html2canvas(card, {
    backgroundColor: css('--space-2'),
    scale: 2,
    ignoreElements: (el) => el.classList?.contains('ig-png'),
  });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${id.replace(/^card-/, 'can-humans-live-here-')}.png`;
  a.click();
}

/* ------------------------------------------------------------------ */

async function init() {
  document.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', () => downloadCard(b.dataset.png)));
  try {
    const [H, C, sites, limits] = await Promise.all([
      loadCsv('data/habitability.csv'),
      loadJson('data/habitability_constants.json'),
      loadCsv('data/sites.csv'),
      loadJson('data/limits.json'),
    ]);
    const names = Object.fromEntries(sites.map((s) => [s.site_id, s.name_en || s.site_id]));
    chartDefaults();
    hero(H, C);
    pressureCard(H, C);
    radiationCard(H, C);
    waterCard(H, C, names);
    solarCard(H, C, names);
    gridCard(H, C);
    kitCard(H, C, limits);
    document.body.dataset.ready = 'true';
  } catch (err) {
    console.error(err);
    const el = $('#ig-status');
    el.hidden = false;
    el.textContent = location.protocol === 'file:'
      ? 'Open the page over HTTP (python -m http.server), the data files cannot be read from file://.'
      : `Could not load the data: ${err.message || err}`;
  }
}

init();
