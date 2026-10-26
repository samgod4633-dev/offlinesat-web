import { downloadTiles, EST_BYTES_PER_TILE, MAX_TILES, MAX_ZOOM } from './downloader.js';
import { importMBTiles } from './mbtiles.js';
import { ESRI_TEMPLATE, settings } from './settings.js';
import { tileCount, tilesIn } from './tileMath.js';
import { tileStore } from './tileStore.js';

const $ = (id) => document.getElementById(id);

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

let toastTimer;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function requestWakeLock() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}

/** Offline Maps sheet: area download, MBTiles import, storage, tile source. */
export function initOfflineSheet({ map, onTilesChanged, onSourceChanged, onDownloadProgress, onSelectArea }) {
  let minZoom = 12;
  let maxZoom = 15;
  let controller = null;

  const visibleBounds = () => {
    const b = map.getBounds();
    return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
  };

  function render() {
    $('min-z').textContent = minZoom;
    $('max-z').textContent = maxZoom;
    const count = tileCount(visibleBounds(), minZoom, maxZoom);
    const estimate = $('estimate');
    estimate.textContent = `${count.toLocaleString()} tiles · ~${formatBytes(count * EST_BYTES_PER_TILE)}`;
    estimate.classList.toggle('over', count > MAX_TILES);
    $('dl-start').disabled = Boolean(controller) || count === 0 || count > MAX_TILES;
    for (const button of document.querySelectorAll('[data-step]')) {
      const delta = Number(button.dataset.delta);
      const value = button.dataset.step === 'min' ? minZoom + delta : maxZoom + delta;
      const valid = button.dataset.step === 'min' ? value >= 0 && value <= maxZoom : value >= minZoom && value <= MAX_ZOOM;
      button.disabled = Boolean(controller) || !valid;
    }
  }

  async function refreshStorage() {
    let text;
    try {
      text = `${(await tileStore.count()).toLocaleString()} tiles`;
    } catch {
      text = 'Storage unavailable';
    }
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage != null) text += ` · ${formatBytes(estimate.usage)}`;
    } catch {
      // estimate unsupported
    }
    $('stored').textContent = text;
  }

  function open() {
    if (!controller) {
      const zoom = Math.min(Math.max(Math.floor(map.getZoom()), 0), MAX_ZOOM);
      minZoom = zoom;
      maxZoom = Math.min(zoom + 3, MAX_ZOOM);
    }
    $('template').value = settings.template;
    $('save-browsing').checked = settings.saveWhileBrowsing;
    render();
    refreshStorage();
    $('sheet-backdrop').hidden = false;
    $('sheet').hidden = false;
  }

  function close() {
    $('sheet').hidden = true;
    $('sheet-backdrop').hidden = true;
  }

  $('sheet-close').addEventListener('click', close);
  $('select-area-btn').addEventListener('click', () => {
    close();
    onSelectArea();
  });
  $('sheet-backdrop').addEventListener('click', close);

  for (const button of document.querySelectorAll('[data-step]')) {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.delta);
      if (button.dataset.step === 'min') minZoom = Math.min(Math.max(minZoom + delta, 0), maxZoom);
      else maxZoom = Math.min(Math.max(maxZoom + delta, minZoom), MAX_ZOOM);
      render();
    });
  }

  // --- Downloads (visible area here; hand-picked squares via areaSelect.js) ---

  /** Asks for confirmation, then downloads in the background. Returns true if it started. */
  function runDownload(tiles) {
    const count = tiles.length;
    if (controller || count === 0 || count > MAX_TILES) return false;
    const ok = window.confirm(
      `Download ${count.toLocaleString()} tiles (about ${formatBytes(count * EST_BYTES_PER_TILE)})?\n\n` +
      'Use Wi-Fi, and keep the app open until it finishes.',
    );
    if (!ok) return false;
    performDownload(tiles);
    return true;
  }

  $('dl-start').addEventListener('click', () => {
    const bounds = visibleBounds();
    const count = tileCount(bounds, minZoom, maxZoom);
    if (count === 0 || count > MAX_TILES) return;
    runDownload(Array.from(tilesIn(bounds, minZoom, maxZoom)));
  });

  async function performDownload(tiles) {
    const count = tiles.length;
    navigator.storage?.persist?.().catch(() => {});
    controller = new AbortController();
    const wakeLock = await requestWakeLock();
    $('dl-result').textContent = '';
    $('dl-progress').hidden = false;
    $('dl-start').hidden = true;
    $('dl-cancel').hidden = false;
    render();

    const showProgress = (p) => {
      const fraction = p.total ? p.processed / p.total : 0;
      $('dl-bar').value = fraction;
      $('dl-text').textContent =
        `${p.processed.toLocaleString()}/${p.total.toLocaleString()} · ${p.failed} failed · ${formatBytes(p.bytes)}`;
      onDownloadProgress?.(fraction);
    };
    showProgress({ total: count, processed: 0, failed: 0, bytes: 0 });

    const result = await downloadTiles(tiles, {
      signal: controller.signal,
      onProgress: showProgress,
    });

    const cancelled = controller.signal.aborted;
    controller = null;
    wakeLock?.release?.().catch(() => {});
    onDownloadProgress?.(null);
    $('dl-progress').hidden = true;
    $('dl-start').hidden = false;
    $('dl-cancel').hidden = true;
    $('dl-result').textContent =
      `${cancelled ? 'Cancelled' : 'Finished'}: ${result.downloaded.toLocaleString()} downloaded, ` +
      `${result.skipped.toLocaleString()} already saved, ${result.failed.toLocaleString()} failed.`;
    toast(cancelled ? 'Download cancelled' : 'Area saved for offline use');
    render();
    refreshStorage();
    onTilesChanged();
  }

  $('dl-cancel').addEventListener('click', () => controller?.abort());

  // --- MBTiles import ---
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    navigator.storage?.persist?.().catch(() => {});
    const status = $('import-status');
    $('import-btn').disabled = true;

    for (const file of files) {
      if (file.size > 300 * 1024 * 1024 &&
          !window.confirm(`${file.name} is ${formatBytes(file.size)}. Large files can crash the app. Try anyway?`)) {
        continue;
      }
      status.textContent = `Reading ${file.name}…`;
      try {
        const result = await importMBTiles(file, (done, total) => {
          status.textContent = `Importing ${file.name}: ${done.toLocaleString()}/${total.toLocaleString()}`;
        });
        status.textContent = `Imported ${result.count.toLocaleString()} tiles from ${result.name}.`;
      } catch (error) {
        status.textContent = `${file.name}: ${error.message || 'import failed'}`;
      }
    }
    $('import-btn').disabled = false;
    refreshStorage();
    onTilesChanged();
  });

  // --- Storage ---
  $('clear-btn').addEventListener('click', async () => {
    if (controller) return;
    if (!window.confirm('Delete all saved tiles from this device?')) return;
    try {
      await tileStore.clear();
      toast('Saved tiles cleared');
    } catch (error) {
      toast(`Could not clear: ${error.message}`);
    }
    refreshStorage();
    onTilesChanged();
  });

  // --- Tile source ---
  $('template').addEventListener('change', (event) => {
    settings.template = event.target.value;
    event.target.value = settings.template;
    onSourceChanged();
  });
  $('reset-template').addEventListener('click', () => {
    settings.template = ESRI_TEMPLATE;
    $('template').value = settings.template;
    onSourceChanged();
  });
  $('save-browsing').addEventListener('change', (event) => {
    settings.saveWhileBrowsing = event.target.checked;
  });

  return { open, close, runDownload, isDownloading: () => Boolean(controller) };
}
