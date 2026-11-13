/**
 * charts.js — Analysis charts (Chart.js 4 + chartjs-chart-matrix).
 *
 *   ranking  horizontal bars: analogs ranked for one reference (ranking.csv / scores.csv)
 *   radar    one analog vs one reference on the 8 criteria s_* (0..1)
 *   heatmap  analogs × references, colour = score
 *   raw      grouped bars "analog vs reference" in real units (4 small multiples)
 *
 * Colours: the Earth analog is always teal, a reference always wears its body's
 * colour (Mars rust, Moon lavender) — validated with the dataviz palette checker
 * on the dark theme surfaces. Text, grid and surfaces come from the CSS theme
 * of #analysis-view, so the charts follow the current theme.
 * Every chart draws its own title and background, so "Download PNG" gives a
 * self-contained image for slides.
 */
import { CRITERIA, PARAM, SCENARIOS, statusInfo } from './data.js';

const Chart = window.Chart;

export const SERIES = {
  analog: '#159e93',
  mars: '#d2532f',
  moon: '#a07ad0',
  earth: '#159e93',
};

/* Heatmap: one hue (teal), dim → bright on the dark surfaces. */
const RAMP_LO = [16, 46, 46];
const RAMP_HI = [143, 240, 227];

const charts = {}; // id -> Chart
const PNG_SCALE = 2;
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; // render at 2× so exported PNGs are sharp on slides

function themeColors(el) {
  const css = getComputedStyle(el);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  return {
    text: v('--c-text', '#eee'),
    muted: v('--c-muted', '#999'),
    border: v('--c-border', '#444'),
    surface: v('--c-surface', '#111'),
    surface2: v('--c-surface-2', '#222'),
    font: v('--font', 'system-ui, sans-serif'),
  };
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function ramp(t) {
  const k = Math.max(0, Math.min(1, t));
  const c = RAMP_LO.map((lo, i) => Math.round(lo + (RAMP_HI[i] - lo) * k));
  return `rgb(${c.join(',')})`;
}

/** Fills the canvas with the theme surface (otherwise PNGs are transparent). */
const backgroundPlugin = {
  id: 'eaBackground',
  beforeDraw(chart, _args, opts) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

function baseOptions(t, title, subtitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: Math.max(PNG_SCALE, window.devicePixelRatio || 1),
    animation: REDUCED_MOTION ? false : { duration: 250 },
    color: t.text,
    font: { family: t.font },
    layout: { padding: { top: 4, right: 16, bottom: 8, left: 8 } },
    plugins: {
      eaBackground: { color: t.surface },
      title: { display: true, text: title, color: t.text, align: 'start', font: { size: 14, weight: '600', family: t.font }, padding: { bottom: subtitle ? 2 : 10 } },
      subtitle: { display: Boolean(subtitle), text: subtitle, color: t.muted, align: 'start', font: { size: 11, family: t.font }, padding: { bottom: 10 } },
      legend: { labels: { color: t.text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3, font: { family: t.font } } },
      tooltip: {
        backgroundColor: t.surface2, titleColor: t.text, bodyColor: t.text, footerColor: t.muted,
        borderColor: t.border, borderWidth: 1, padding: 10, cornerRadius: 8,
      },
    },
  };
}

function axis(t, extra = {}) {
  return {
    grid: { color: withAlpha('#ffffff', 0.08), drawTicks: false },
    border: { color: t.border },
    ticks: { color: t.muted, padding: 6, font: { family: t.font } },
    title: { color: t.muted, font: { family: t.font } },
    ...extra,
  };
}

function mount(id, canvas, config) {
  charts[id]?.destroy();
  config.plugins = [backgroundPlugin, ...(config.plugins ?? [])];
  charts[id] = new Chart(canvas, config);
  return charts[id];
}

export function destroyAll() {
  for (const id of Object.keys(charts)) { charts[id].destroy(); delete charts[id]; }
}

const scenarioLabel = (key) => SCENARIOS[key]?.label ?? key;
const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

/* ------------------------------------------------------------------ */
/* a) Ranking                                                          */
/* ------------------------------------------------------------------ */

export function rankingChart(canvas, { rows, reference, scenario, selectedId, onPick }) {
  const t = themeColors(canvas);
  const other = withAlpha(t.muted, 0.45);
  canvas.parentElement.style.height = `${rows.length * 30 + 110}px`;
  const base = baseOptions(t, `Earth analogs ranked for ${reference.name}`,
    `Similarity score, scenario: ${scenarioLabel(scenario)} · click a bar to compare it on the radar`);
  return mount('ranking', canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.analog?.name ?? r.analogId),
      datasets: [{
        data: rows.map((r) => r.score),
        backgroundColor: rows.map((r) => (r.isPair ? SERIES.analog : other)),
        borderColor: rows.map((r) => (r.analogId === selectedId ? t.text : 'transparent')),
        borderWidth: rows.map((r) => (r.analogId === selectedId ? 2 : 0)),
        borderRadius: 4,
        borderSkipped: 'start',
        barThickness: 16,
      }],
    },
    options: {
      ...base,
      indexAxis: 'y',
      onClick: (_e, els) => { if (els[0]) onPick?.(rows[els[0].index].analogId); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      scales: {
        x: axis(t, { min: 0, max: 1, ticks: { color: t.muted, stepSize: 0.2 }, title: { display: true, text: 'Score (0 = no match, 1 = identical)', color: t.muted } }),
        y: axis(t, { grid: { display: false }, ticks: { color: t.text, autoSkip: false } }),
      },
      plugins: {
        ...base.plugins,
        legend: {
          position: 'bottom',
          labels: {
            ...base.plugins.legend.labels,
            generateLabels: () => [
              { text: 'Intended analog (pair)', fillStyle: SERIES.analog, strokeStyle: SERIES.analog, fontColor: t.text, lineWidth: 0 },
              { text: 'Other analogs', fillStyle: other, strokeStyle: other, fontColor: t.text, lineWidth: 0 },
            ],
          },
          onClick: () => {},
        },
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            label: (c) => `Score ${fmt(c.raw, 3)} · rank ${rows[c.dataIndex].rank}`,
            footer: (items) => {
              const r = rows[items[0].dataIndex];
              return [`Coverage ${fmt(r.coverage)}`, r.isPair ? 'Intended analog for this reference' : ''].filter(Boolean);
            },
          },
        },
      },
    },
    plugins: [valueLabelPlugin(rows, t)],
  });
}

/** Score at the end of the intended analog's bar and the selected one (selective direct labels). */
function valueLabelPlugin(rows, t) {
  return {
    id: 'eaValueLabels',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const { ctx } = chart;
      ctx.save();
      ctx.font = `600 11px ${t.font}`;
      ctx.fillStyle = t.text;
      ctx.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const r = rows[i];
        if (!r.isPair && i !== 0) return; // label the winner and the intended pair only
        ctx.fillText(fmt(r.score), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };
}

/* ------------------------------------------------------------------ */
/* b) Radar                                                            */
/* ------------------------------------------------------------------ */

export function radarChart(canvas, { row, analog, reference }) {
  const t = themeColors(canvas);
  const refColor = SERIES[reference.body] ?? t.muted;
  const values = CRITERIA.map((c) => row?.s[c.key] ?? null);
  const base = baseOptions(t, `${analog.name} vs ${reference.name}`,
    row ? `Similarity per criterion (0–1) · total ${fmt(row.score)} · scenario: ${scenarioLabel(row.scenario)}` : 'No score for this pair');
  return mount('radar', canvas, {
    type: 'radar',
    data: {
      labels: CRITERIA.map((c) => c.label),
      datasets: [
        {
          label: `${analog.name} (Earth analog)`,
          data: values,
          borderColor: SERIES.analog,
          backgroundColor: withAlpha(SERIES.analog, 0.22),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: SERIES.analog,
          pointBorderColor: t.surface,
          pointBorderWidth: 2,
          spanGaps: false,
        },
        {
          label: `${reference.name} (reference = 1)`,
          data: CRITERIA.map(() => 1),
          borderColor: refColor,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHitRadius: 0,
        },
      ],
    },
    options: {
      ...base,
      scales: {
        r: {
          min: 0, max: 1,
          ticks: { stepSize: 0.25, color: t.muted, backdropColor: 'transparent', font: { size: 10, family: t.font } },
          grid: { color: withAlpha('#ffffff', 0.1) },
          angleLines: { color: withAlpha('#ffffff', 0.1) },
          pointLabels: { color: t.text, font: { size: 12, family: t.font } },
        },
      },
      plugins: {
        ...base.plugins,
        legend: { position: 'bottom', labels: base.plugins.legend.labels },
        tooltip: {
          ...base.plugins.tooltip,
          filter: (c) => c.datasetIndex === 0,
          callbacks: {
            label: (c) => {
              const crit = CRITERIA[c.dataIndex];
              const w = SCENARIOS[row?.scenario]?.weights?.[crit.key];
              return `s = ${fmt(c.raw, 3)}${w !== undefined ? ` · weight ${w}` : ''}`;
            },
          },
        },
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* c) Heatmap                                                          */
/* ------------------------------------------------------------------ */

export function heatmapChart(canvas, { analogs, references, cell, scenario, onPick }) {
  const t = themeColors(canvas);
  const xs = references.map((r) => r.name);
  const ys = analogs.map((a) => a.name);
  const data = [];
  for (const a of analogs) {
    for (const r of references) {
      const row = cell(a.id, r.id);
      if (row) data.push({ x: r.name, y: a.name, v: row.score, row, a, r });
    }
  }
  const mean = (body) => {
    const v = data.filter((d) => d.r.body === body).map((d) => d.v);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  // Colour domain = data range rounded out to 0.1, so differences stay visible
  // (scores cluster in ~0.3–0.8); the legend prints the actual bounds.
  const vs = data.map((d) => d.v);
  const lo = Math.floor(Math.min(...vs) * 10) / 10;
  const hi = Math.ceil(Math.max(...vs) * 10) / 10;
  const tOf = (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const best = new Map(); // reference name -> best cell
  for (const d of data) if (!best.has(d.x) || d.v > best.get(d.x).v) best.set(d.x, d);

  canvas.parentElement.style.height = `${ys.length * 30 + 190}px`;
  const LEGEND_H = 46;
  const base = baseOptions(t, 'Similarity of every Earth analog to every reference',
    `Scenario: ${scenarioLabel(scenario)} · mean score vs Mars ${fmt(mean('mars'))}, vs Moon ${fmt(mean('moon'))} · outlined = intended pair, number = best analog per reference`);

  return mount('heatmap', canvas, {
    type: 'matrix',
    data: {
      datasets: [{
        data,
        backgroundColor: (c) => ramp(tOf(c.raw?.v ?? lo)),
        borderColor: (c) => (c.raw?.row.isPair ? t.text : t.surface),
        borderWidth: (c) => (c.raw?.row.isPair ? 2 : 1),
        width: ({ chart }) => (chart.chartArea ? chart.chartArea.width / xs.length - 2 : 10),
        height: ({ chart }) => (chart.chartArea ? chart.chartArea.height / ys.length - 2 : 10),
      }],
    },
    options: {
      ...base,
      layout: { padding: { top: 4, right: 16, bottom: LEGEND_H, left: 8 } },
      onClick: (_e, els) => { const d = els[0] && data[els[0].index]; if (d) onPick?.(d.a.id, d.r.id); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      scales: {
        x: { type: 'category', labels: xs, position: 'top', offset: true, grid: { display: false }, border: { display: false }, ticks: { color: t.text, maxRotation: 0, autoSkip: false, font: { size: 11, family: t.font }, callback: (v, i) => wrap(xs[i], 14) } },
        y: { type: 'category', labels: ys, offset: true, reverse: false, grid: { display: false }, border: { display: false }, ticks: { color: t.text, autoSkip: false, font: { size: 11, family: t.font } } },
      },
      plugins: {
        ...base.plugins,
        legend: { display: false },
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            title: (items) => { const d = items[0].raw; return `${d.a.name} → ${d.r.name}`; },
            label: (c) => `Score ${fmt(c.raw.v, 3)} · coverage ${fmt(c.raw.row.coverage)}`,
            footer: (items) => (items[0].raw.row.isPair ? 'Intended pair' : ''),
          },
        },
      },
    },
    plugins: [{
      id: 'eaHeatLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = `600 11px ${t.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        meta.data.forEach((el, i) => {
          const d = data[i];
          if (best.get(d.x) !== d) return;
          const { x, y, width, height } = el.getProps(['x', 'y', 'width', 'height'], true);
          ctx.fillStyle = tOf(d.v) > 0.55 ? '#0b1f1d' : '#ffffff';
          ctx.fillText(fmt(d.v), x + width / 2, y + height / 2);
        });
        ctx.restore();
      },
      afterDraw(chart) {
        // Colour scale legend (drawn on the canvas so it is part of the PNG)
        const { ctx, chartArea: a } = chart;
        const w = Math.min(260, a.width);
        const x0 = a.left;
        const y0 = a.bottom + 18;
        ctx.save();
        const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, ramp(i / 10));
        ctx.fillStyle = g;
        ctx.fillRect(x0, y0, w, 10);
        ctx.fillStyle = t.muted;
        ctx.font = `11px ${t.font}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(lo.toFixed(1), x0, y0 + 14);
        ctx.textAlign = 'center';
        ctx.fillText('score', x0 + w / 2, y0 + 14);
        ctx.textAlign = 'right';
        ctx.fillText(hi.toFixed(1), x0 + w, y0 + 14);
        ctx.restore();
      },
    }],
  });
}

function wrap(text, n) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > n && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ */
/* d) Raw parameters                                                   */
/* ------------------------------------------------------------------ */

export const RAW_GROUPS = [
  { id: 'raw-temp', title: 'Surface temperature', unit: '°C', items: [['Min', 't_surf_min_c'], ['Mean', 't_surf_mean_c'], ['Max', 't_surf_max_c']] },
  { id: 'raw-sun', title: 'Solar elevation', unit: '°', items: [['Min', 'sun_elev_min_deg'], ['Max', 'sun_elev_max_deg']] },
  { id: 'raw-slope', title: 'Mean slope', unit: '°', items: [['Slope', 'slope_mean_deg']] },
  { id: 'raw-relief', title: 'Relief', unit: 'm', items: [['Relief', 'relief_m']] },
];

export function rawCharts(canvases, { analog, reference }) {
  const t = themeColors(canvases[0]);
  const refColor = SERIES[reference.body] ?? t.muted;
  return RAW_GROUPS.map((g, gi) => {
    const series = [[analog, SERIES.analog], [reference, refColor]];
    const base = baseOptions(t, `${g.title}, ${g.unit}`);
    return mount(g.id, canvases[gi], {
      type: 'bar',
      data: {
        labels: g.items.map(([l]) => l),
        datasets: series.map(([site, color]) => ({
          label: site.name,
          data: g.items.map(([, key]) => site.values[key]),
          backgroundColor: color,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 28,
          categoryPercentage: 0.7,
          barPercentage: 0.9,
          site,
        })),
      },
      options: {
        ...base,
        scales: {
          x: axis(t, { grid: { display: false }, ticks: { color: t.text } }),
          y: axis(t, { title: { display: true, text: g.unit, color: t.muted } }),
        },
        plugins: {
          ...base.plugins,
          legend: { position: 'bottom', labels: base.plugins.legend.labels },
          tooltip: {
            ...base.plugins.tooltip,
            callbacks: {
              label: (c) => {
                const key = g.items[c.dataIndex][1];
                const p = PARAM[key];
                const st = statusInfo(c.dataset.site.status[p.status]);
                return `${c.dataset.label}: ${fmt(c.raw, p.digits)} ${g.unit}${st ? ` · ${st.label}${st.kind === 'placeholder' ? ' (placeholder value, not yet verified)' : ''}` : ''}`;
              },
            },
          },
        },
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* PNG export                                                          */
/* ------------------------------------------------------------------ */

function download(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Download one chart, or several (small multiples) composed into one image. */
export function downloadPng(ids, name, { title, background } = {}) {
  const list = ids.map((id) => charts[id]).filter(Boolean);
  if (!list.length) return;
  if (list.length === 1) { download(list[0].toBase64Image('image/png', 1), `${slug(name)}.png`); return; }

  // 2-column grid of the chart canvases, with an optional heading
  const cols = 2;
  const cw = Math.max(...list.map((c) => c.canvas.width));
  const ch = Math.max(...list.map((c) => c.canvas.height));
  const head = title ? 56 * PNG_SCALE / 2 : 0;
  const out = document.createElement('canvas');
  out.width = cw * cols;
  out.height = head + ch * Math.ceil(list.length / cols);
  const ctx = out.getContext('2d');
  ctx.fillStyle = background || '#111';
  ctx.fillRect(0, 0, out.width, out.height);
  if (title) {
    ctx.fillStyle = themeColors(list[0].canvas).text;
    ctx.font = `600 ${16 * PNG_SCALE}px ${themeColors(list[0].canvas).font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 12 * PNG_SCALE, head / 2);
  }
  list.forEach((c, i) => ctx.drawImage(c.canvas, (i % cols) * cw, head + Math.floor(i / cols) * ch));
  download(out.toDataURL('image/png'), `${slug(name)}.png`);
}

export { themeColors };
