// Web Mercator (XYZ) tile math. `y` counts down from the north edge.

export const MAX_LATITUDE = 85.05112878;

export const tileKey = (z, x, y) => `${z}/${x}/${y}`;

function clampTile(value, z) {
  return Math.min(Math.max(value, 0), 2 ** z - 1);
}

export function lonToTileX(lon, z) {
  return clampTile(Math.floor(((lon + 180) / 360) * 2 ** z), z);
}

export function latToTileY(lat, z) {
  const rad = (Math.min(Math.max(lat, -MAX_LATITUDE), MAX_LATITUDE) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
  return clampTile(Math.floor(y), z);
}

/** Tile ranges covering bounds {north, south, east, west} at zoom z. Antimeridian views are clipped. */
export function tileRanges(bounds, z) {
  const west = Math.min(Math.max(bounds.west, -180), 180);
  const east = Math.max(Math.min(Math.max(bounds.east, -180), 180), west);
  return {
    minX: lonToTileX(west, z),
    maxX: lonToTileX(east, z),
    minY: latToTileY(bounds.north, z),
    maxY: latToTileY(Math.min(bounds.south, bounds.north), z),
  };
}

export function tileCount(bounds, minZoom, maxZoom) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRanges(bounds, z);
    total += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  }
  return total;
}

// ---- Ground-distance squares (e.g. 1 km × 1 km) for hand-picked areas ----
//
// Squares live in normalized Web Mercator space (u, v ∈ [0, 1], v down from the north edge).
// Mercator is conformal, so a square there is a true square on the ground; its side `cs` is
// chosen so it measures exactly `km` at a reference latitude (within ~1% over 100 km north/south).

export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export const lngToU = (lng) => (lng + 180) / 360;

export function latToV(lat) {
  const rad = (Math.min(Math.max(lat, -MAX_LATITUDE), MAX_LATITUDE) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/** Side length, in normalized units, of a square `km` wide on the ground at latitude `lat`. */
export function squareSize(km, lat) {
  return (km * 1000) / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
}

/** Square key "i/j" containing the point (u, v). */
export const squareAt = (u, v, cs) => `${Math.floor(u / cs)}/${Math.floor(v / cs)}`;

const OVERVIEW_MIN_ZOOM = 5;
const EDGE = 1e-12;

/**
 * Calls visit(z, x, y) once per tile needed to show the squares from overview zoom 5 down
 * to maxZoom. Stops early (returning false) once more than `limit` tiles have been visited.
 */
function forEachSquareTile(cells, cs, maxZoom, limit, visit) {
  const parsed = [...cells].map((key) => key.split('/').map(Number));
  let visited = 0;
  for (let z = OVERVIEW_MIN_ZOOM; z <= maxZoom; z++) {
    const n = 2 ** z;
    const seen = new Set();
    for (const [i, j] of parsed) {
      const minX = Math.max(Math.floor(i * cs * n), 0);
      const maxX = Math.min(Math.floor(((i + 1) * cs - EDGE) * n), n - 1);
      const minY = Math.max(Math.floor(j * cs * n), 0);
      const maxY = Math.min(Math.floor(((j + 1) * cs - EDGE) * n), n - 1);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = x * n + y;
          if (seen.has(key)) continue;
          seen.add(key);
          visit(z, x, y);
          if (++visited > limit) return false;
        }
      }
    }
  }
  return true;
}

/** Number of tiles for the squares, capped at limit + 1 so huge selections stay fast. */
export function squareTileCount(cells, cs, maxZoom, limit) {
  let count = 0;
  forEachSquareTile(cells, cs, maxZoom, limit, () => { count++; });
  return count;
}

export function squareTiles(cells, cs, maxZoom) {
  const tiles = [];
  forEachSquareTile(cells, cs, maxZoom, Infinity, (z, x, y) => tiles.push({ z, x, y }));
  return tiles;
}

export function* tilesIn(bounds, minZoom, maxZoom) {
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRanges(bounds, z);
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) {
        yield { z, x, y };
      }
    }
  }
}
