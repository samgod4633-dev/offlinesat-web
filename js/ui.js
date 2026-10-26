import { downloadTiles, EST_BYTES_PER_TILE, MAX_TILES, MAX_ZOOM } from './downloader.js';
import { importMBTiles } from './mbtiles.js';
import { CUSTOM_ID, settings, SOURCES } from './settings.js';
import { tileCount, tilesIn } from './tileMath.js';
import { tileStore } from './tileStore.js';

const $ = (id) => document.getElementById(id);

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

let toastTimer;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** { usage, quota, free } in bytes, or null when the browser can't tell. */
export async function storageEstimate() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota, free: Math.max(estimate.quota - (estimate.usage ?? 0), 0) };
  } catch {
    return null;
  }
}

async function requestWakeLock() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}

/** Offline Maps sheet: area download, MBTiles import, storage, imagery source. */
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
    const estimate = await storageEstimate();
    if (estimate) text += ` · ${formatBytes(estimate.usage)} used · ${formatBytes(estimate.free)} free`;
    $('stored').textContent = text;
  }

  function renderSource() {
    const source = settings.source();
    $('source-select').value = source.id;
    $('source-note').textContent = source.note || '';
    $('custom-source').hidden = source.id !== CUSTOM_ID;
    $('template').value = settings.customTemplate;
  }

  function open() {
    if (!controller) {
      const zoom = Math.min(Math.max(Math.floor(map.getZoom()), 0), MAX_ZOOM);
      minZoom = zoom;
      maxZoom = Math.min(zoom + 3, MAX_ZOOM);
    }
    renderSource();
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
  $('sheet-backdrop').addEventListener('click', close);
  $('select-area-btn').addEventListener('click', () => {
    close();
    onSelectArea();
  });

  for (const button of document.querySelectorAll('[data-step]')) {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.delta);
      if (button.dataset.step === 'min') minZoom = Math.min(Math.max(minZoom + delta, 0), maxZoom);
      else maxZoom = Math.min(Math.max(maxZoom + delta, minZoom), MAX_ZOOM);
      render();
    });
  }

  // --- Downloads (visible area here; hand-picked squares via areaSelect.js) ---

  /** Asks for confirmation, then downloads in the background. Resolves true if it started. */
  async function runDownload(tiles) {
    const count = tiles.length;
    if (controller || count === 0 || count > MAX_TILES) return false;
    const needed = count * EST_BYTES_PER_TILE;
    const estimate = await storageEstimate();
    let message = `Download ${count.toLocaleString()} tiles from ${settings.source().name} (about ${formatBytes(needed)})?`;
    if (estimate) {
      message += `\n\n${formatBytes(estimate.free)} of storage is free for the app.`;
      if (needed > estimate.free) message += ' That may not be enough; the download stops when storage is full.';
    }
    message += '\n\nUse Wi-Fi, and keep the app open on screen until it finishes.';
    if (!window.confirm(message)) return false;
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
    navigator.storage?.persist?.().catch(() => {});
    controller = new AbortController();
    const wakeLock = await requestWakeLock();
    $('dl-result').textContent = '';
    $('dl-progress').hidden = false;
    $('dl-start').hidden = true;
    $('dl-cancel').hidden = false;
    render();

    const started = performance.now();
    let lastPaint = 0;
    const showProgress = (p, force = false) => {
      const now = performance.now();
      if (!force && now - lastPaint < 250 && p.processed < p.total) return;
      lastPaint = now;
      const fraction = p.total ? p.processed / p.total : 0;
      const elapsed = (now - started) / 1000;
      const remaining = p.processed > 20 ? (elapsed / p.processed) * (p.total - p.processed) : NaN;
      const eta = p.retrying ? 'retrying failed tiles…' : formatDuration(remaining) && `~${formatDuration(remaining)} left`;
      $('dl-bar').value = fraction;
      $('dl-text').textContent = [
        `${p.processed.toLocaleString()}/${p.total.toLocaleString()}`,
        `${p.failed.toLocaleString()} failed`,
        formatBytes(p.bytes),
        eta,
      ].filter(Boolean).join(' · ');
      onDownloadProgress?.(fraction, eta);
    };
    showProgress({ total: tiles.length, processed: 0, failed: 0, bytes: 0 }, true);

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
    const status = result.storageFull ? 'Storage full' : cancelled ? 'Cancelled' : 'Finished';
    $('dl-result').textContent =
      `${status}: ${result.downloaded.toLocaleString()} downloaded, ` +
      `${result.skipped.toLocaleString()} already saved, ${result.failed.toLocaleString()} failed.` +
      (result.failed ? ' Run the same download again to fill the gaps.' : '');
    toast(result.storageFull ? 'Storage full – download stopped' : cancelled ? 'Download cancelled' : 'Area saved for offline use');
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
    if (!window.confirm('Delete all saved tiles (every imagery source) from this device?')) return;
    try {
      await tileStore.clear();
      toast('Saved tiles cleared');
    } catch (error) {
      toast(`Could not clear: ${error.message}`);
    }
    refreshStorage();
    onTilesChanged();
  });

  // --- Imagery source ---
  const select = $('source-select');
  for (const source of SOURCES) select.add(new Option(source.name, source.id));
  select.add(new Option('Custom URL…', CUSTOM_ID));

  function setSource(id) {
    settings.sourceId = id;
    renderSource();
    onSourceChanged();
  }

  select.addEventListener('change', () => setSource(select.value));
  $('template').addEventListener('change', (event) => {
    settings.customTemplate = event.target.value;
    event.target.value = settings.customTemplate;
    onSourceChanged();
  });
  $('save-browsing').addEventListener('change', (event) => {
    settings.saveWhileBrowsing = event.target.checked;
  });

  return { open, close, runDownload, setSource, isDownloading: () => Boolean(controller) };
}
