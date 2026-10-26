/* global L */
import { EST_BYTES_PER_TILE, MAX_TILES, MAX_ZOOM } from './downloader.js';
import { cellTileCount, cellTiles, latToTileY, lonToTileX, tileRanges } from './tileMath.js';
import { formatBytes, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const MIN_LEVEL = 2;
const MAX_LEVEL = 16;
const MAX_CELLS = 4000;
const EARTH_CIRCUMFERENCE_M = 40_075_016;

/** Draws the selection grid (cells at `state.level`) and fills selected cells, at any map zoom. */
const SelectionGrid = L.GridLayer.extend({
  initialize(state, options) {
    this._state = state;
    L.GridLayer.prototype.initialize.call(this, options);
  },

  createTile(coords) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const { level, cells } = this._state;
    const { x, y, z } = this._wrapCoords(coords);
    ctx.fillStyle = 'rgba(10, 132, 255, 0.38)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;

    if (z <= level) {
      // This map tile holds n×n selection cells.
      const n = 2 ** (level - z);
      const px = 256 / n;
      for (const key of cells) {
        const [cx, cy] = key.split('/').map(Number);
        const lx = cx - x * n;
        const ly = cy - y * n;
        if (lx >= 0 && lx < n && ly >= 0 && ly < n) {
          ctx.fillRect(lx * px, ly * px, Math.max(px, 1), Math.max(px, 1));
        }
      }
      if (px >= 6) {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const p = i * px;
          ctx.moveTo(p, 0);
          ctx.lineTo(p, 256);
          ctx.moveTo(0, p);
          ctx.lineTo(256, p);
        }
        ctx.stroke();
      }
    } else {
      // This map tile is one piece of a larger cell; draw only the cell's outer edges.
      const d = z - level;
      const n = 2 ** d;
      if (cells.has(`${x >> d}/${y >> d}`)) ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath();
      if (x % n === 0) { ctx.moveTo(1, 0); ctx.lineTo(1, 256); }
      if ((x + 1) % n === 0) { ctx.moveTo(255, 0); ctx.lineTo(255, 256); }
      if (y % n === 0) { ctx.moveTo(0, 1); ctx.lineTo(256, 1); }
      if ((y + 1) % n === 0) { ctx.moveTo(0, 255); ctx.lineTo(256, 255); }
      ctx.stroke();
    }
    return canvas;
  },
});

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

/**
 * "Select area" mode: zoom out, tap squares (or All) to pick the area, set square size
 * and detail, then download every tile for those squares plus overview tiles above them.
 */
export function initAreaSelect({ map, runDownload, isDownloading }) {
  const state = { level: 10, cells: new Set() };
  const grid = new SelectionGrid(state, { zIndex: 10, maxZoom: 21, keepBuffer: 1 });
  let maxZoom = 17;
  let active = false;

  function render() {
    const count = cellTileCount(state.cells, state.level, maxZoom);
    const squares = state.cells.size;
    const width = (EARTH_CIRCUMFERENCE_M * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** state.level;
    $('sel-size').textContent = `≈${formatDistance(width)}`;
    $('sel-max').textContent = `z${maxZoom}`;
    $('sel-count').textContent = `${squares.toLocaleString()} square${squares === 1 ? '' : 's'}`;
    const estimate = $('sel-estimate');
    estimate.textContent = squares ? `${count.toLocaleString()} tiles · ~${formatBytes(count * EST_BYTES_PER_TILE)}` : '';
    estimate.classList.toggle('over', count > MAX_TILES);
    $('sel-hint').textContent = count > MAX_TILES
      ? `Over the ${MAX_TILES.toLocaleString()} tile limit: lower the detail or pick fewer squares.`
      : 'Tap squares to choose the area to save. Pinch and drag to move around.';
    $('sel-bigger').disabled = state.level <= MIN_LEVEL;
    $('sel-smaller').disabled = state.level >= MAX_LEVEL;
    $('sel-minus').disabled = maxZoom <= state.level;
    $('sel-plus').disabled = maxZoom >= MAX_ZOOM;
    $('sel-download').disabled = squares === 0 || count > MAX_TILES || isDownloading();
    $('sel-clear').disabled = squares === 0;
  }

  function redraw() {
    grid.redraw();
    render();
  }

  /** Changes square size, keeping the selected area: bigger → parent squares, smaller → 4 children each. */
  function setLevel(level) {
    if (level < MIN_LEVEL || level > MAX_LEVEL || level === state.level) return;
    const next = new Set();
    for (const key of state.cells) {
      const [cx, cy] = key.split('/').map(Number);
      if (level < state.level) {
        const shift = state.level - level;
        next.add(`${cx >> shift}/${cy >> shift}`);
      } else {
        for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) next.add(`${cx * 2 + dx}/${cy * 2 + dy}`);
      }
    }
    if (next.size > MAX_CELLS) {
      toast('Too many squares at that size');
      return;
    }
    state.level = level;
    state.cells = next;
    grid._state = state;
    maxZoom = Math.max(maxZoom, level);
    redraw();
  }

  function selectAllVisible() {
    const b = map.getBounds();
    const r = tileRanges({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, state.level);
    const added = (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
    if (state.cells.size + added > MAX_CELLS) {
      toast('Too many squares – make them bigger first');
      return;
    }
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) state.cells.add(`${x}/${y}`);
    }
    redraw();
  }

  function enter() {
    // One square per map tile at the current zoom: about 256 screen points wide.
    state.level = Math.min(Math.max(Math.round(map.getZoom()), MIN_LEVEL), MAX_LEVEL);
    state.cells = new Set();
    grid._state = state;
    maxZoom = Math.min(Math.max(state.level + 5, 15), 17);
    grid.addTo(map);
    active = true;
    document.body.classList.add('selecting');
    $('select-bar').hidden = false;
    redraw();
  }

  function exit() {
    active = false;
    map.removeLayer(grid);
    document.body.classList.remove('selecting');
    $('select-bar').hidden = true;
  }

  map.on('click', (event) => {
    if (!active) return;
    const latLng = event.latlng.wrap();
    const key = `${lonToTileX(latLng.lng, state.level)}/${latToTileY(latLng.lat, state.level)}`;
    if (state.cells.has(key)) state.cells.delete(key);
    else state.cells.add(key);
    redraw();
  });
  map.on('moveend', () => { if (active) render(); });

  $('sel-bigger').addEventListener('click', () => setLevel(state.level - 1));
  $('sel-smaller').addEventListener('click', () => setLevel(state.level + 1));
  $('sel-minus').addEventListener('click', () => { maxZoom = Math.max(maxZoom - 1, state.level); render(); });
  $('sel-plus').addEventListener('click', () => { maxZoom = Math.min(maxZoom + 1, MAX_ZOOM); render(); });
  $('sel-clear').addEventListener('click', () => { state.cells.clear(); redraw(); });
  $('sel-all').addEventListener('click', selectAllVisible);
  $('sel-cancel').addEventListener('click', exit);
  $('sel-download').addEventListener('click', async () => {
    if (await runDownload(cellTiles(state.cells, state.level, maxZoom))) exit();
  });

  return { enter, exit };
}
