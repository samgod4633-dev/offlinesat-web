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
