import { fetchTile } from './offlineLayer.js';
import { tileKey } from './tileMath.js';
import { tileStore } from './tileStore.js';

export const MAX_TILES = 25_000;
export const MAX_ZOOM = 19;
/** Rough average satellite JPEG size, for estimates only. */
export const EST_BYTES_PER_TILE = 20_000;

/**
 * Downloads tiles into IndexedDB with bounded concurrency, skipping ones already saved.
 * Abort `signal` to cancel. Resolves with the final counts.
 */
export async function downloadTiles(tiles, { signal, onProgress, concurrency = 6 }) {
  const progress = { total: tiles.length, processed: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0 };
  let next = 0;

  async function worker() {
    while (next < tiles.length && !signal.aborted) {
      const { z, x, y } = tiles[next++];
      const key = tileKey(z, x, y);
      try {
        if (await tileStore.has(key)) {
          progress.skipped++;
        } else {
          const data = await fetchTile(z, x, y, { signal, timeoutMs: 20000 });
          await tileStore.put(key, data);
          progress.downloaded++;
          progress.bytes += data.byteLength;
        }
      } catch {
        if (signal.aborted) break;
        progress.failed++;
      }
      progress.processed++;
      onProgress?.({ ...progress });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
  return progress;
}
