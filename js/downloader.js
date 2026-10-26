import { fetchTile } from './offlineLayer.js';
import { settings } from './settings.js';
import { tileStore } from './tileStore.js';

/** ~4 GB of satellite tiles. The real ceiling is the phone's free space (see storage estimate). */
export const MAX_TILES = 200_000;
export const MAX_ZOOM = 20;
/** Rough average satellite JPEG size, for estimates only. */
export const EST_BYTES_PER_TILE = 20_000;

/**
 * Downloads tiles for the current imagery source into IndexedDB with bounded concurrency,
 * skipping ones already saved and retrying failures once at the end.
 * Abort `signal` to cancel. Stops early (storageFull) if the device runs out of space.
 */
export async function downloadTiles(tiles, { signal, onProgress, concurrency = 8 }) {
  const source = settings.source();
  const progress = {
    total: tiles.length, processed: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0,
    storageFull: false, retrying: false,
  };
  const stopped = () => signal.aborted || progress.storageFull;
  const failedTiles = [];

  async function run(list, workers, isRetry) {
    let next = 0;
    async function worker() {
      while (next < list.length && !stopped()) {
        const tile = list[next++];
        const key = source.storageKey(tile.z, tile.x, tile.y);
        try {
          if (!isRetry && await tileStore.has(key)) {
            progress.skipped++;
          } else {
            const data = await fetchTile(source.tileUrl(tile.z, tile.x, tile.y), { signal, timeoutMs: 20000 });
            await tileStore.put(key, data);
            progress.downloaded++;
            progress.bytes += data.byteLength;
            if (isRetry) progress.failed--;
          }
        } catch (error) {
          if (signal.aborted) break;
          if (error?.name === 'QuotaExceededError') {
            progress.storageFull = true;
            break;
          }
          if (!isRetry) {
            progress.failed++;
            failedTiles.push(tile);
          }
        }
        if (!isRetry) progress.processed++;
        onProgress?.({ ...progress });
      }
    }
    await Promise.all(Array.from({ length: Math.min(workers, list.length) }, worker));
  }

  await run(tiles, concurrency, false);
  if (failedTiles.length && !stopped()) {
    progress.retrying = true;
    onProgress?.({ ...progress });
    await run(failedTiles, 4, true);
    progress.retrying = false;
  }
  onProgress?.({ ...progress });
  return progress;
}
