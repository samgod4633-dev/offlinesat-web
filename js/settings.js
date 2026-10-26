export const ESRI_TEMPLATE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const TEMPLATE_KEY = 'offlinesat.template';
const SAVE_KEY = 'offlinesat.saveWhileBrowsing';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export const settings = {
  get template() {
    return read(TEMPLATE_KEY) || ESRI_TEMPLATE;
  },
  set template(value) {
    write(TEMPLATE_KEY, (value || '').trim() || ESRI_TEMPLATE);
  },

  /** On by default: everything you look at online is kept for offline use. */
  get saveWhileBrowsing() {
    return read(SAVE_KEY) !== 'false';
  },
  set saveWhileBrowsing(value) {
    write(SAVE_KEY, String(Boolean(value)));
  },

  get attribution() {
    return this.template.includes('arcgisonline.com') ? 'Imagery © Esri, Maxar, Earthstar Geographics' : '';
  },

  tileUrl(z, x, y) {
    const tmsY = 2 ** z - 1 - y;
    return this.template
      .replaceAll('{z}', z)
      .replaceAll('{x}', x)
      .replaceAll('{-y}', tmsY)
      .replaceAll('{y}', y);
  },
};
