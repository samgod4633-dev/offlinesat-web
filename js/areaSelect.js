/* global L */
import { EST_BYTES_PER_TILE, MAX_TILES, MAX_ZOOM } from './downloader.js';
import { latToV, lngToU, squareAt, squareSize, squareTileCount, squareTiles } from './tileMath.js';
import { formatBytes, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const SIZES_KM = [0.25, 0.5, 1, 2, 5, 10, 25, 50];
const DEFAULT_SIZE_INDEX = SIZES_KM.indexOf(1);
const MAX_CELLS = 20_000;
const DEFAULT_DETAIL = 18;

const formatKm = (km) => (km < 1 ? `${km * 1000} m` : `${km} km`);
const formatArea = (km2) => `${km2 >= 10 ? Math.round(km2).toLocaleString() : km2.toFixed(2).replace(/\.?0+$/, '')} km²`;

/** Draws the square grid and fills selected squares, at any map zoom. */
const SquareGrid = L.GridLayer.extend({
  initialize(state, options) {
    this._state = state;
    L.GridLayer.prototype.initialize.call(this, options);
  },

  createTile(coords) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const { cs, cells } = this._state;
    const { x, y, z } = this._wrapCoords(coords);
    const scale = 256 * 2 ** z; // canvas px per normalized unit
    const u0 = x / 2 ** z;
    const v0 = y / 2 ** z;
    const u1 = (x + 1) / 2 ** z;
    const v1 = (y + 1) / 2 ** z;
    const cellPx = cs * scale;

    const iMin = Math.floor(u0 / cs);
    const iMax = Math.floor(u1 / cs);
    const jMin = Math.floor(v0 / cs);
    const jMax = Math.floor(v1 / cs);

    ctx.fillStyle = 'rgba(10, 132, 255, 0.4)';
    const fill = (i, j) => {
      const px = (i * cs - u0) * scale;
      const py = (j * cs - v0) * scale;
      ctx.fillRect(px, py, Math.max(cellPx, 1), Math.max(cellPx, 1));
    };
    if ((iMax - iMin + 1) * (jMax - jMin + 1) <= cells.size) {
      for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) if (cells.has(`${i}/${j}`)) fill(i, j);
    } else {
      for (const key of cells) {
        const [i, j] = key.split('/').map(Number);
        if (i >= iMin && i <= iMax && j >= jMin && j <= jMax) fill(i, j);
      }
    }

    if (cellPx >= 6) {
      ctx.strokeStyle = cellPx >= 30 ? 'rgba(255, 255, 255, 0.75)' : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = cellPx >= 30 ? 1.5 : 1;
      ctx.beginPath();
      for (let i = Math.ceil(u0 / cs); i * cs <= u1; i++) {
        const px = (i * cs - u0) * scale;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, 256);
      }
      for (let j = Math.ceil(v0 / cs); j * cs <= v1; j++) {
        const py = (j * cs - v0) * scale;
        ctx.moveTo(0, py);
        ctx.lineTo(256, py);
      }
      ctx.stroke();
    }
    return canvas;
  },
});

/**
 * "Select area" mode: a grid of true ground-distance squares (1 km × 1 km by default).
 * Tap squares, drag across them in Paint mode, or select everything on screen; choose the
 * detail level; then download every tile covering those squares.
 */
export function initAreaSelect({ map, runDownload, isDownloading }) {
  const state = { cs: 0, cells: new Set() };
  const grid = new SquareGrid(state, { zIndex: 10, maxZoom: 21, keepBuffer: 1 });
  let sizeIndex = DEFAULT_SIZE_INDEX;
  let refLat = 0;
  let maxZoom = DEFAULT_DETAIL;
  let active = false;
  let painting = false;

  const toUV = (latLng) => {
    const p = latLng.wrap();
    return [lngToU(p.lng), latToV(p.lat)];
  };

  function render() {
    const squares = state.cells.size;
    const count = squares ? squareTileCount(state.cells, state.cs, maxZoom, MAX_TILES) : 0;
    const km = SIZES_KM[sizeIndex];
    $('sel-size').textContent = formatKm(km);
    $('sel-max').textContent = `z${maxZoom}`;
    $('sel-count').textContent = `${squares.toLocaleString()} square${squares === 1 ? '' : 's'} · ${formatArea(km * km * squares)}`;
    const estimate = $('sel-estimate');
    estimate.textContent = squares
      ? (count > MAX_TILES ? `over ${MAX_TILES.toLocaleString()} tiles` : `${count.toLocaleString()} tiles · ~${formatBytes(count * EST_BYTES_PER_TILE)}`)
      : '';
    estimate.classList.toggle('over', count > MAX_TILES);

    const cellPx = state.cs * 256 * 2 ** map.getZoom();
    let hint;
    if (count > MAX_TILES) hint = 'Too many tiles: lower the detail or select fewer squares.';
    else if (cellPx < 6) hint = `Zoom in to see the ${formatKm(km)} grid.`;
    else if (painting) hint = 'Drag over squares to select them (start on a blue one to erase).';
    else hint = `Squares are ${formatKm(km)} × ${formatKm(km)}. Tap to select, or switch to Paint.`;
    $('sel-hint').textContent = hint;

    $('sel-bigger').disabled = sizeIndex >= SIZES_KM.length - 1;
    $('sel-smaller').disabled = sizeIndex <= 0;
    $('sel-minus').disabled = maxZoom <= 10;
    $('sel-plus').disabled = maxZoom >= MAX_ZOOM;
    $('sel-download').disabled = squares === 0 || count > MAX_TILES || isDownloading();
    $('sel-clear').disabled = squares === 0;
    $('sel-mode-move').setAttribute('aria-pressed', String(!painting));
    $('sel-mode-paint').setAttribute('aria-pressed', String(painting));
  }

  function redraw() {
    grid.redraw();
    render();
  }

  /** Changes square size, keeping the selected ground area covered. */
  function setSize(index) {
    if (index < 0 || index >= SIZES_KM.length || index === sizeIndex) return;
    const cs = squareSize(SIZES_KM[index], refLat);
    const next = new Set();
    for (const key of state.cells) {
      const [i, j] = key.split('/').map(Number);
      const iFrom = Math.floor((i * state.cs) / cs + 1e-9);
      const iTo = Math.floor(((i + 1) * state.cs) / cs - 1e-9);
      const jFrom = Math.floor((j * state.cs) / cs + 1e-9);
      const jTo = Math.floor(((j + 1) * state.cs) / cs - 1e-9);
      for (let a = iFrom; a <= iTo; a++) for (let b = jFrom; b <= jTo; b++) next.add(`${a}/${b}`);
      if (next.size > MAX_CELLS) break;
    }
    if (next.size > MAX_CELLS) {
      toast('Too many squares at that size');
      return;
    }
    sizeIndex = index;
    state.cs = cs;
    state.cells = next;
    redraw();
  }

  function selectAllVisible() {
    const b = map.getBounds();
    const [uW, vN] = toUV(b.getNorthWest());
    const [uE, vS] = toUV(b.getSouthEast());
    const iMin = Math.floor(uW / state.cs);
    const iMax = Math.floor(Math.max(uE, uW) / state.cs);
    const jMin = Math.floor(vN / state.cs);
    const jMax = Math.floor(vS / state.cs);
    if (state.cells.size + (iMax - iMin + 1) * (jMax - jMin + 1) > MAX_CELLS) {
      toast('Too many squares on screen – zoom in or make squares bigger');
      return;
    }
    for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) state.cells.add(`${i}/${j}`);
    redraw();
  }

  function setPainting(on) {
    painting = on;
    document.body.classList.toggle('painting', on);
    if (on) map.dragging.disable();
    else map.dragging.enable();
    render();
  }

  function enter() {
    // Squares measure exactly their size at the latitude where you start selecting.
    refLat = map.getCenter().lat;
    sizeIndex = DEFAULT_SIZE_INDEX;
    state.cs = squareSize(SIZES_KM[sizeIndex], refLat);
    state.cells = new Set();
    maxZoom = DEFAULT_DETAIL;
    painting = false;
    grid.addTo(map);
    active = true;
    document.body.classList.add('selecting');
    $('select-bar').hidden = false;
    redraw();
  }

  function exit() {
    active = false;
    setPainting(false);
    map.removeLayer(grid);
    document.body.classList.remove('selecting');
    $('select-bar').hidden = true;
  }

  // Tap to toggle (Move mode).
  map.on('click', (event) => {
    if (!active || painting) return;
    const key = squareAt(...toUV(event.latlng), state.cs);
    if (state.cells.has(key)) state.cells.delete(key);
    else state.cells.add(key);
    redraw();
  });
  map.on('zoomend moveend', () => { if (active) render(); });

  // Drag to paint (Paint mode). Two fingers still pinch-zoom.
  const container = map.getContainer();
  const pointers = new Set();
  let paintAdds = true;
  let lastKey = null;

  function paintAt(event) {
    const latLng = map.containerPointToLatLng(map.mouseEventToContainerPoint(event));
    const key = squareAt(...toUV(latLng), state.cs);
    if (key === lastKey) return;
    lastKey = key;
    if (paintAdds) {
      if (state.cells.size >= MAX_CELLS) return;
      state.cells.add(key);
    } else {
      state.cells.delete(key);
    }
    redraw();
  }

  container.addEventListener('pointerdown', (event) => {
    if (!active || !painting) return;
    pointers.add(event.pointerId);
    if (pointers.size > 1) {
      lastKey = null;
      return;
    }
    const latLng = map.containerPointToLatLng(map.mouseEventToContainerPoint(event));
    paintAdds = !state.cells.has(squareAt(...toUV(latLng), state.cs));
    lastKey = null;
    paintAt(event);
  });
  container.addEventListener('pointermove', (event) => {
    if (!active || !painting || pointers.size !== 1 || !pointers.has(event.pointerId)) return;
    paintAt(event);
  });
  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    lastKey = null;
  };
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);

  $('sel-mode-move').addEventListener('click', () => setPainting(false));
  $('sel-mode-paint').addEventListener('click', () => setPainting(true));
  $('sel-bigger').addEventListener('click', () => setSize(sizeIndex + 1));
  $('sel-smaller').addEventListener('click', () => setSize(sizeIndex - 1));
  $('sel-minus').addEventListener('click', () => { maxZoom = Math.max(maxZoom - 1, 10); render(); });
  $('sel-plus').addEventListener('click', () => { maxZoom = Math.min(maxZoom + 1, MAX_ZOOM); render(); });
  $('sel-clear').addEventListener('click', () => { state.cells.clear(); redraw(); });
  $('sel-all').addEventListener('click', selectAllVisible);
  $('sel-cancel').addEventListener('click', exit);
  $('sel-download').addEventListener('click', async () => {
    if (await runDownload(squareTiles(state.cells, state.cs, maxZoom))) exit();
  });

  return { enter, exit };
}
