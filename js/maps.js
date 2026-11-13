/**
 * maps.js — Leaflet map creation per planetary body.
 *
 * BODY_MAPS holds everything body-specific (CRS, tile URL, zoom, attribution).
 * To swap a basemap, edit only the `tiles` entry. Set `tiles: null` to force
 * the coordinate-grid placeholder.
 *
 * Tile sources (checked 2026-11):
 *   Earth — OpenStreetMap standard tiles (Web Mercator).
 *   Mars  — NASA Mars Trek WMTS, Viking MDIM 2.1 color mosaic, equirectangular
 *           (2×1 tiles at z0 → matches L.CRS.EPSG4326).
 *   Moon  — default: NASA Moon Trek LRO WAC south-pole mosaic, south polar
 *           stereographic (Proj4Leaflet). Disc down to 60° S, native zoom 0–4
 *           (~535 m/px at z4; higher zooms are upscaled).
 *           Alternative: LRO WAC global mosaic, equirectangular ("moonGlobal").
 * Alternative for Mars: OpenPlanetaryMap basemap (Web Mercator)
 *   https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png
 *
 * If tiles fail to load (offline, service down), the map falls back to a
 * themed lat/lon grid automatically (polar maps keep their graticule).
 *
 * BODY_MAPS keys are "map keys"; several map keys may share one `body`
 * (e.g. moon / moonGlobal) — `body` drives theme, legend and site filtering.
 */

const L = window.L;

const TREK = 'https://trek.nasa.gov/tiles';

/* ------------------------------------------------------------------ */
/* Lunar south polar stereographic CRS (matches Moon Trek "SP" tiles)  */
/* ------------------------------------------------------------------ */

const MOON_RADIUS_M = 1737400;
// Trek SP tile matrix: TopLeftCorner (-1095930, 1095930), z0 = one 256 px tile
// covering 2 × 1095930 m → 8561.953125 m/px, halving each level.
const MOON_SP_HALF_EXTENT = 1095930;
const MOON_SP_Z0_RES = (2 * MOON_SP_HALF_EXTENT) / 256;

function moonSouthPolarCRS() {
  if (!L.Proj) {
    console.warn('[maps] Proj4Leaflet not loaded — falling back to equirectangular');
    return null;
  }
  return new L.Proj.CRS(
    'IAU2000:30120',
    // NB: proj4js ignores "+R" (silently uses WGS84) — the sphere must be given as +a/+b.
    `+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=${MOON_RADIUS_M} +b=${MOON_RADIUS_M} +units=m +no_defs`,
    {
      origin: [-MOON_SP_HALF_EXTENT, MOON_SP_HALF_EXTENT],
      resolutions: Array.from({ length: 8 }, (_, z) => MOON_SP_Z0_RES / 2 ** z),
      bounds: L.bounds(
        [-MOON_SP_HALF_EXTENT, -MOON_SP_HALF_EXTENT],
        [MOON_SP_HALF_EXTENT, MOON_SP_HALF_EXTENT],
      ),
    },
  );
}

const MOON_SP_CRS = moonSouthPolarCRS();

export const BODY_MAPS = {
  earth: {
    body: 'earth',
    crs: L.CRS.EPSG3857,
    center: [20, 0],
    zoom: 2,
    minZoom: 1,
    maxZoom: 12,
    tiles: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
  },
  mars: {
    body: 'mars',
    crs: L.CRS.EPSG4326,
    center: [0, 0],
    zoom: 1,
    minZoom: 0,
    maxZoom: 9,
    tiles: {
      url: `${TREK}/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
      options: {
        maxNativeZoom: 7,
        noWrap: true,
        bounds: [[-90, -180], [90, 180]],
        attribution: 'NASA/JPL/USGS Viking MDIM 2.1 via <a href="https://trek.nasa.gov/mars/">Mars Trek</a>',
      },
    },
  },
  // Lunar south pole, polar stereographic (default Moon view)
  moon: MOON_SP_CRS ? {
    body: 'moon',
    polar: true,
    crs: MOON_SP_CRS,
    center: [-90, 0],
    zoom: 1,
    minZoom: 0,
    maxZoom: 7,
    graticule: { minLat: -60, latStep: 5, lonStep: 30 },
    tiles: {
      url: `${TREK}/Moon/SP/LRO_WAC_Mosaic_SPole60_100mp/1.0.0/default/default028mm/{z}/{y}/{x}.png`,
      options: {
        maxNativeZoom: 4,
        noWrap: true,
        attribution: 'NASA/GSFC/ASU LRO WAC south-pole mosaic via <a href="https://trek.nasa.gov/moon/">Moon Trek</a>',
      },
    },
    // TODO: higher-resolution south-pole layers (LOLA hillshade, NAC PSR mosaic)
    //       as switchable overlays once their SP tile endpoints are confirmed.
  } : null,
  // Global Moon, equirectangular
  moonGlobal: {
    body: 'moon',
    crs: L.CRS.EPSG4326,
    center: [-75, 0],
    zoom: 2,
    minZoom: 0,
    maxZoom: 9,
    tiles: {
      url: `${TREK}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
      options: {
        maxNativeZoom: 7,
        noWrap: true,
        bounds: [[-90, -180], [90, 180]],
        attribution: 'NASA/GSFC/ASU LRO WAC via <a href="https://trek.nasa.gov/moon/">Moon Trek</a>',
      },
    },
  },
};
if (!BODY_MAPS.moon) BODY_MAPS.moon = BODY_MAPS.moonGlobal;

/** Map key for a body + projection choice ('polar' | 'global'). */
export function mapKeyFor(body, moonProjection = 'polar') {
  if (body !== 'moon') return body;
  return moonProjection === 'global' || !MOON_SP_CRS ? 'moonGlobal' : 'moon';
}

/* ------------------------------------------------------------------ */
/* Polar graticule (vector, so it stays correct in any projection)     */
/* ------------------------------------------------------------------ */

function polarGraticule({ minLat, latStep, lonStep }) {
  const group = L.layerGroup();
  const style = { className: 'graticule', interactive: false, weight: 1 };
  const label = (latlng, text) =>
    L.marker(latlng, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: 'graticule-label', html: text, iconSize: null }),
    }).addTo(group);

  for (let lat = minLat; lat > -90; lat += -latStep) {
    const ring = [];
    for (let lon = -180; lon <= 180; lon += 3) ring.push([lat, lon]);
    L.polyline(ring, style).addTo(group);
    // Ring labels sit between meridians; the outer ring is labelled by the meridian labels.
    if (lat !== minLat) label([lat, lonStep / 2], `${Math.abs(lat)}°S`);
  }
  for (let lon = -180; lon < 180; lon += lonStep) {
    L.polyline([[minLat, lon], [-90, lon]], style).addTo(group);
    const text = lon === 0 || lon === -180 ? `${Math.abs(lon)}°` : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
    label([minLat + 1.5, lon], text);
  }
  return group;
}

/* ------------------------------------------------------------------ */
/* Projection toggle control (Moon: South Pole / Global)               */
/* ------------------------------------------------------------------ */

/**
 * @param {'polar'|'global'} current
 * @param {(p: 'polar'|'global') => void} onChange
 */
export function projectionControl(current, onChange) {
  const ctl = L.control({ position: 'topright' });
  ctl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-proj segmented');
    div.setAttribute('role', 'group');
    div.setAttribute('aria-label', 'Moon projection');
    for (const [value, text] of [['polar', 'South Pole'], ['global', 'Global']]) {
      const b = L.DomUtil.create('button', 'segmented__btn', div);
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(value === current));
      L.DomEvent.on(b, 'click', (e) => {
        L.DomEvent.stop(e);
        if (value !== current) onChange(value);
      });
    }
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  return ctl;
}

/* ------------------------------------------------------------------ */
/* Placeholder: themed coordinate grid                                 */
/* ------------------------------------------------------------------ */

const GridLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const ctx = tile.getContext('2d');

    const css = getComputedStyle(this._map.getContainer());
    const bg = css.getPropertyValue('--map-bg').trim() || '#222';
    const line = css.getPropertyValue('--map-grid').trim() || 'rgba(255,255,255,.2)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.x, size.y);

    // Tile corner in lat/lon
    const nwPoint = coords.scaleBy(size);
    const nw = this._map.unproject(nwPoint, coords.z);
    const se = this._map.unproject(nwPoint.add(size), coords.z);

    // Graticule step depends on zoom
    const step = coords.z <= 1 ? 30 : coords.z <= 3 ? 10 : coords.z <= 5 ? 5 : 1;
    ctx.strokeStyle = line;
    ctx.fillStyle = line;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';

    const toX = (lon) => ((lon - nw.lng) / (se.lng - nw.lng)) * size.x;
    const toY = (lat) => ((nw.lat - lat) / (nw.lat - se.lat)) * size.y;

    for (let lon = Math.ceil(nw.lng / step) * step; lon <= se.lng; lon += step) {
      const x = Math.round(toX(lon)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
      ctx.fillText(`${lon}°`, x + 3, 12);
    }
    for (let lat = Math.ceil(se.lat / step) * step; lat <= nw.lat; lat += step) {
      const y = Math.round(toY(lat)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
      ctx.fillText(`${lat}°`, 3, y - 3);
    }
    return tile;
  },
});

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

// Shapes: native site = circle, Earth analog of Mars = diamond,
// Earth analog of Moon = crescent. Colors come from CSS (theme variables).
const SHAPES = {
  native: '<circle cx="12" cy="12" r="7"/><circle class="m-core" cx="12" cy="12" r="2.5"/>',
  mars: '<path d="M12 3 L21 12 L12 21 L3 12 Z"/><circle class="m-core" cx="12" cy="12" r="2.5"/>',
  moon: '<path d="M15.5 3.5a9 9 0 1 0 5 13.5A7 7 0 0 1 15.5 3.5Z"/>',
};

export function markerKind(site) {
  return site.body === 'earth' && site.analog_of ? site.analog_of : 'native';
}

function makeIcon(site) {
  const kind = markerKind(site);
  return L.divIcon({
    className: `site-marker site-marker--${kind}`,
    html: `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">${SHAPES[kind]}</svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function legendControl(body) {
  const ctl = L.control({ position: 'bottomleft' });
  ctl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    const row = (kind, text) =>
      `<div class="map-legend__row"><span class="site-marker site-marker--${kind}">` +
      `<svg viewBox="0 0 24 24" width="16" height="16">${SHAPES[kind]}</svg></span>${text}</div>`;
    div.innerHTML =
      body === 'earth'
        ? row('mars', 'Mars analog') + row('moon', 'Moon analog') + row('native', 'Other site')
        : row('native', `${body === 'mars' ? 'Mars' : 'Lunar'} target site`);
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  return ctl;
}

/* ------------------------------------------------------------------ */
/* MapView                                                             */
/* ------------------------------------------------------------------ */

export class MapView {
  /**
   * @param {HTMLElement} el      container (should carry data-theme)
   * @param {string} mapKey       key of BODY_MAPS ('earth' | 'mars' | 'moon' | 'moonGlobal')
   * @param {{onSelect?: (site) => void, popup?: (site) => HTMLElement, controls?: L.Control[]}} [opts]
   *   popup: builds the mini-window shown on marker click; an element inside it
   *   with [data-action="details"] calls onSelect (opens the full sidebar).
   *   Without `popup`, a marker click calls onSelect directly.
   */
  constructor(el, mapKey, { onSelect, popup, controls = [] } = {}) {
    const cfg = BODY_MAPS[mapKey];
    const body = cfg.body;
    this.mapKey = mapKey;
    this.body = body;
    this.polar = Boolean(cfg.polar);
    this.onSelect = onSelect;
    this.popup = popup;
    this.markers = new Map(); // site.id -> L.Marker
    el.classList.toggle('map--polar', this.polar);

    // maxBounds in lat/lon only makes sense for cylindrical projections.
    const cylindrical = body !== 'earth' && !this.polar;
    this.map = L.map(el, {
      crs: cfg.crs,
      center: cfg.center,
      zoom: cfg.zoom,
      minZoom: cfg.minZoom,
      maxZoom: cfg.maxZoom,
      worldCopyJump: body === 'earth',
      maxBounds: cylindrical ? [[-90, -180], [90, 180]] : null,
      maxBoundsViscosity: cylindrical ? 1 : 0,
      attributionControl: true,
    });

    this._addBasemap(cfg);
    if (cfg.graticule) polarGraticule(cfg.graticule).addTo(this.map);
    legendControl(body).addTo(this.map);
    controls.forEach((c) => c.addTo(this.map));
    this.layer = L.layerGroup().addTo(this.map);
  }

  _addBasemap(cfg) {
    const useGrid = () => {
      if (this._grid) return;
      // TODO: replace with a real basemap if the tile service is unavailable.
      // Polar maps already draw a vector graticule; the canvas grid assumes a
      // cylindrical projection, so it is used only there.
      if (!this.polar) {
        this._grid = new GridLayer({ noWrap: true }).addTo(this.map);
        this._grid.bringToBack();
      } else {
        this._grid = true;
      }
      this.map.attributionControl.addAttribution('Placeholder grid (tiles unavailable)');
    };

    if (!cfg.tiles) { useGrid(); return; }

    const tiles = L.tileLayer(cfg.tiles.url, cfg.tiles.options).addTo(this.map);
    let loaded = 0;
    let failed = 0;
    tiles.on('tileload', () => { loaded++; });
    tiles.on('tileerror', () => {
      failed++;
      if (failed >= 3 && loaded === 0) {
        this.map.removeLayer(tiles);
        useGrid();
      }
    });
  }

  /** Replace markers. */
  setSites(sites) {
    this.layer.clearLayers();
    this.markers.clear();
    for (const site of sites) {
      const m = L.marker([site.lat, site.lon], { icon: makeIcon(site), title: site.name, keyboard: true });
      m.bindTooltip(site.name, { direction: 'top', offset: [0, -12] });
      if (this.popup) {
        m.bindPopup(() => this._popupFor(site, m), {
          className: 'site-popup',
          maxWidth: 300,
          minWidth: 220,
          offset: [0, -8],
          autoPanPaddingTopLeft: [12, 12],
          autoPanPaddingBottomRight: [12, 12],
        });
        m.on('popupopen', () => m.closeTooltip());
      } else {
        m.on('click', () => this.onSelect?.(site));
      }
      m.addTo(this.layer);
      this.markers.set(site.id, m);
    }
  }

  _popupFor(site, marker) {
    const el = this.popup(site);
    // Called right before Leaflet lays the popup out: keep it inside the map
    // (content scrolls if the map is short, e.g. stacked Compare panes on phones).
    // The middle part (.popup__body) scrolls, header and button stay visible.
    el.style.setProperty('--popup-max', `${Math.max(200, this.map.getSize().y - 90)}px`);
    el.querySelector('[data-action="details"]')?.addEventListener('click', () => {
      marker.closePopup();
      this.onSelect?.(site);
    });
    return el;
  }

  /** Open a marker's popup programmatically (used by the #popup=<name> hash hook). */
  openPopup(siteId) {
    const m = this.markers.get(siteId);
    if (!m) return false;
    this.map.setView(m.getLatLng(), Math.max(this.map.getZoom(), 3), { animate: false });
    m.openPopup();
    return true;
  }

  highlight(siteId) {
    for (const [id, m] of this.markers) {
      m.getElement()?.classList.toggle('is-selected', id === siteId);
    }
  }

  fitToSites() {
    const pts = [...this.markers.values()].map((m) => m.getLatLng());
    if (pts.length > 1) this.map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 4 });
  }

  /** Call after the container becomes visible or changes size. */
  invalidate() {
    this.map.invalidateSize();
  }

  destroy() {
    this.map.remove();
  }
}
