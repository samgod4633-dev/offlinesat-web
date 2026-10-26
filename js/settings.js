export const ESRI_TEMPLATE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Built-in imagery sources. All send CORS headers, so their tiles can be saved for offline use. */
export const SOURCES = [
  {
    id: 'google',
    name: 'Google Satellite',
    note: 'Usually the newest and sharpest',
    template: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: '0123',
    attribution: 'Imagery © Google',
  },
  {
    id: 'bing',
    name: 'Bing Aerial',
    note: 'Good alternative, sometimes newer',
    template: 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1',
    subdomains: '0123',
    attribution: 'Imagery © Microsoft',
  },
  {
    id: 'esri',
    name: 'Esri World Imagery',
    note: 'Reliable, can be a few years old',
    template: ESRI_TEMPLATE,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'clarity',
    name: 'Esri Clarity',
    note: 'Sharper processing, often older',
    template: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri',
  },
];

export const CUSTOM_ID = 'custom';
const DEFAULT_SOURCE = 'google';
/** Tiles imported from .mbtiles files live in their own namespace and show under every source. */
export const IMPORT_PREFIX = 'mbt:';

const SOURCE_KEY = 'offlinesat.source';
const TEMPLATE_KEY = 'offlinesat.template';
const SAVE_KEY = 'offlinesat.saveWhileBrowsing';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** Esri keeps unprefixed keys so tiles saved by earlier versions still count. */
const prefixFor = (id) => (id === 'esri' ? '' : `${id}:`);
const ALL_PREFIXES = [...SOURCES.map((s) => prefixFor(s.id)), IMPORT_PREFIX, prefixFor(CUSTOM_ID)];

function quadKey(z, x, y) {
  let key = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += ((x & mask) ? 1 : 0) + ((y & mask) ? 2 : 0);
  }
  return key;
}

function buildSource(def) {
  const prefix = prefixFor(def.id);
  // Own namespace first, then imports, then whatever other sources have saved (better than nothing offline).
  const lookupPrefixes = [prefix, ...ALL_PREFIXES.filter((p) => p !== prefix)];
  return {
    ...def,
    prefix,
    tileUrl(z, x, y) {
      const sub = def.subdomains ? def.subdomains[(x + y) % def.subdomains.length] : '';
      return def.template
        .replaceAll('{s}', sub)
        .replaceAll('{q}', quadKey(z, x, y))
        .replaceAll('{z}', z)
        .replaceAll('{x}', x)
        .replaceAll('{-y}', 2 ** z - 1 - y)
        .replaceAll('{y}', y);
    },
    storageKey: (z, x, y) => `${prefix}${z}/${x}/${y}`,
    lookupKeys: (z, x, y) => lookupPrefixes.map((p) => `${p}${z}/${x}/${y}`),
  };
}

let cached = null;

export const settings = {
  get sourceId() {
    const id = read(SOURCE_KEY);
    if (id === CUSTOM_ID || SOURCES.some((s) => s.id === id)) return id;
    return DEFAULT_SOURCE;
  },
  set sourceId(id) {
    write(SOURCE_KEY, id);
    cached = null;
  },

  get customTemplate() {
    return read(TEMPLATE_KEY) || ESRI_TEMPLATE;
  },
  set customTemplate(value) {
    write(TEMPLATE_KEY, (value || '').trim() || ESRI_TEMPLATE);
    cached = null;
  },

  /** The active source with URL and storage-key helpers. */
  source() {
    if (!cached) {
      const id = this.sourceId;
      const def = id === CUSTOM_ID
        ? { id, name: 'Custom URL', note: '', template: this.customTemplate, attribution: '' }
        : SOURCES.find((s) => s.id === id);
      cached = buildSource(def);
    }
    return cached;
  },

  /** On by default: everything you look at online is kept for offline use. */
  get saveWhileBrowsing() {
    return read(SAVE_KEY) !== 'false';
  },
  set saveWhileBrowsing(value) {
    write(SAVE_KEY, String(Boolean(value)));
  },
};
