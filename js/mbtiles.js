/* global initSqlJs */
import { IMPORT_PREFIX } from './settings.js';
import { tileKey } from './tileMath.js';
import { tileStore } from './tileStore.js';

const SQLJS_BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
const BATCH_SIZE = 500;

let sqlPromise;

/** Loads sql.js on first use (the service worker keeps a copy for offline use). */
function loadSql() {
  if (!sqlPromise) {
    sqlPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${SQLJS_BASE}sql-wasm.js`;
      script.crossOrigin = 'anonymous';
      script.onload = () => initSqlJs({ locateFile: (file) => SQLJS_BASE + file }).then(resolve, reject);
      script.onerror = () => reject(new Error('Could not load the MBTiles reader. Open the app once with internet, then try again.'));
      document.head.appendChild(script);
    }).catch((error) => {
      sqlPromise = undefined;
      throw error;
    });
  }
  return sqlPromise;
}

/**
 * Copies every tile from a raster .mbtiles file into the tile store.
 * MBTiles rows are TMS (origin bottom-left), so y is flipped to XYZ.
 */
export async function importMBTiles(file, onProgress) {
  const SQL = await loadSql();
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const meta = {};
    try {
      const rows = db.exec('SELECT name, value FROM metadata');
      for (const [name, value] of rows[0]?.values ?? []) meta[name] = value;
    } catch {
      // metadata table is optional
    }
    const format = String(meta.format || '').toLowerCase();
    if (format === 'pbf' || format === 'mvt') {
      throw new Error('This file has vector tiles; only raster (jpg/png/webp) MBTiles work.');
    }

    let total;
    try {
      total = db.exec('SELECT COUNT(*) FROM tiles')[0].values[0][0];
    } catch {
      throw new Error('This is not an MBTiles file.');
    }
    if (!total) throw new Error('This MBTiles file has no tiles.');

    const statement = db.prepare('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
    let batch = [];
    let done = 0;
    try {
      while (statement.step()) {
        const [z, x, row, data] = statement.get();
        if (!data) continue;
        batch.push([IMPORT_PREFIX + tileKey(z, x, 2 ** z - 1 - row), data.slice().buffer]);
        if (batch.length >= BATCH_SIZE) {
          await tileStore.putMany(batch);
          done += batch.length;
          batch = [];
          onProgress?.(done, total);
        }
      }
    } finally {
      statement.free();
    }
    if (batch.length) {
      await tileStore.putMany(batch);
      done += batch.length;
      onProgress?.(done, total);
    }
    return { name: meta.name || file.name, count: done };
  } finally {
    db.close();
  }
}
