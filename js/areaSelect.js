/* global L */
import { EST_BYTES_PER_TILE, MAX_TILES, MAX_ZOOM } from './downloader.js';
import { cellTileCount, cellTiles, latToTileY, lonToTileX } from './tileMath.js';
import { formatBytes } from './ui.js';

const $ = (id) => document.getElementById(id);

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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;

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
      if (x % n === 0) { ctx.moveTo(0.75, 0); ctx.lineTo(0.75, 256); }
      if ((x + 1) % n === 0) { ctx.moveTo(255.25, 0); ctx.lineTo(255.25, 256); }
      if (y % n === 0) { ctx.moveTo(0, 0.75); ctx.lineTo(256, 0.75); }
      if ((y + 1) % n === 0) { ctx.moveTo(0, 255.25); ctx.lineTo(256, 255.25); }
      ctx.stroke();
    }
    return canvas;
  },
});

/**
 * "Select area" mode: zoom out, tap squares to pick the area, choose how much detail,
 * then download every tile for those squares (plus overview tiles above them).
 */
export function initAreaSelect({ map, runDownload, isDownloading }) {
  const state = { level: 12, cells: new Set() };
  const grid = new SelectionGrid(state, { zIndex: 10, maxZoom: 21, keepBuffer: 1 });
  let maxZoom = 17;
  let active = false;

  function render() {
    const count = cellTileCount(state.cells, state.level, maxZoom);
    const squares = state.cells.size;
    $('sel-max').textContent = `z${maxZoom}`;
    $('sel-count').textContent = `${squares} square${squares === 1 ? '' : 's'} selected`;
    const estimate = $('sel-estimate');
    estimate.textContent = squares ? `${count.toLocaleString()} tiles · ~${formatBytes(count * EST_BYTES_PER_TILE)}` : '';
    estimate.classList.toggle('over', count > MAX_TILES);
    $('sel-hint').textContent = count > MAX_TILES
      ? `Over the ${MAX_TILES.toLocaleString()} tile limit: lower the detail or pick fewer squares.`
      : 'Tap squares to choose the area to save. Pinch and drag to move around.';
    $('sel-minus').disabled = maxZoom <= state.level;
    $('sel-plus').disabled = maxZoom >= MAX_ZOOM;
    $('sel-download').disabled = squares === 0 || count > MAX_TILES || isDownloading();
    $('sel-clear').disabled = squares === 0;
  }

  function enter() {
    // Squares are 2 zoom levels finer than the current view, so a handful cover the screen.
    state.level = Math.min(Math.max(Math.round(map.getZoom()) + 2, 3), 16);
    state.cells.clear();
    maxZoom = Math.min(Math.max(state.level + 4, 15), MAX_ZOOM);
    grid.addTo(map);
    grid.redraw();
    active = true;
    document.body.classList.add('selecting');
    $('select-bar').hidden = false;
    render();
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
    grid.redraw();
    render();
  });

  $('sel-minus').addEventListener('click', () => { maxZoom = Math.max(maxZoom - 1, state.level); render(); });
  $('sel-plus').addEventListener('click', () => { maxZoom = Math.min(maxZoom + 1, MAX_ZOOM); render(); });
  $('sel-clear').addEventListener('click', () => { state.cells.clear(); grid.redraw(); render(); });
  $('sel-cancel').addEventListener('click', exit);
  $('sel-download').addEventListener('click', async () => {
    const tiles = cellTiles(state.cells, state.level, maxZoom);
    if (await runDownload(tiles)) exit();
  });

  return { enter, exit };
}
