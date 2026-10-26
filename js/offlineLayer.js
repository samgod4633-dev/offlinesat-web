/* global L */
import { settings } from './settings.js';
import { tileKey } from './tileMath.js';
import { tileStore } from './tileStore.js';

async function localTile(z, x, y) {
  try {
    return await tileStore.get(tileKey(z, x, y));
  } catch {
    return undefined;
  }
}

/** Fetches one tile from the configured source. Rejects on HTTP errors, non-images and timeouts. */
export async function fetchTile(z, x, y, { signal, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);
  try {
    const response = await fetch(settings.tileUrl(z, x, y), {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('Tile server did not return an image');
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Crops and upscales the nearest saved ancestor (up to 4 levels up), so imagery
 * saved to z17 still shows something useful when zoomed to z19+ offline.
 */
async function overzoomedTile(z, x, y) {
  for (let dz = 1; dz <= 4 && z - dz >= 0; dz++) {
    const px = x >> dz;
    const py = y >> dz;
    const data = await localTile(z - dz, px, py);
    if (!data) continue;

    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([data]));
    } catch {
      continue;
    }
    const sub = bitmap.width / 2 ** dz;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, (x - (px << dz)) * sub, (y - (py << dz)) * sub, sub, sub, 0, 0, 256, 256);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }
  return null;
}

/** Saved tile → network (saved if enabled) → enlarged ancestor → empty. */
async function resolveTile(z, x, y) {
  const local = await localTile(z, x, y);
  if (local) return new Blob([local]);

  if (navigator.onLine) {
    try {
      const data = await fetchTile(z, x, y);
      if (settings.saveWhileBrowsing) tileStore.put(tileKey(z, x, y), data).catch(() => {});
      return new Blob([data]);
    } catch {
      // fall through to offline options
    }
  }
  return overzoomedTile(z, x, y);
}

export const OfflineTileLayer = L.GridLayer.extend({
  options: {
    tileSize: 256,
    maxZoom: 21,
    keepBuffer: 2,
    updateWhenIdle: true,
  },

  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('role', 'presentation');
    const { x, y, z } = this._wrapCoords(coords);

    resolveTile(z, x, y).then(
      (blob) => {
        if (!blob) {
          img.style.visibility = 'hidden';
          done(null, img);
          return;
        }
        const url = URL.createObjectURL(blob);
        img.onload = img.onerror = () => {
          URL.revokeObjectURL(url);
          done(null, img);
        };
        img.src = url;
      },
      () => done(null, img),
    );
    return img;
  },
});
