/* global L */
import { initAreaSelect } from './areaSelect.js';
import { LocationTracker } from './location.js';
import { OfflineTileLayer } from './offlineLayer.js';
import { settings } from './settings.js';
import { initOfflineSheet, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const VIEW_KEY = 'offlinesat.view';
const FOLLOW_ZOOM = 16;

// ---------- Map ----------

function loadView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}

const savedView = loadView();
const map = L.map('map', {
  zoomControl: false,
  attributionControl: false,
  minZoom: 2,
  maxZoom: 21,
  worldCopyJump: true,
}).setView(savedView?.center ?? [20, 0], savedView?.zoom ?? 3);

const tileLayer = new OfflineTileLayer().addTo(map);
L.control.scale({ position: 'bottomleft', maxWidth: 120 }).addTo(map);

map.on('moveend', () => {
  const c = map.getCenter();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() }));
  } catch {
    // storage unavailable
  }
});

// ---------- GPS ----------

const accuracyCircle = L.circle([0, 0], {
  radius: 0,
  interactive: false,
  color: '#0a84ff',
  weight: 1,
  fillColor: '#0a84ff',
  fillOpacity: 0.15,
});
const userMarker = L.marker([0, 0], {
  icon: L.divIcon({ className: 'user-dot', html: '<span class="pulse"></span><span class="dot"></span>', iconSize: [22, 22] }),
  interactive: false,
  keyboard: false,
  zIndexOffset: 1000,
});

const tracker = new LocationTracker();
let following = false;
let centeredOnFirstFix = false;

function currentLatLng() {
  const c = tracker.position?.coords;
  return c ? [c.latitude, c.longitude] : null;
}

tracker.addEventListener('update', () => {
  const c = tracker.position.coords;
  const latLng = [c.latitude, c.longitude];
  if (!map.hasLayer(userMarker)) {
    accuracyCircle.addTo(map);
    userMarker.addTo(map);
  }
  userMarker.setLatLng(latLng);
  accuracyCircle.setLatLng(latLng).setRadius(c.accuracy || 0);

  if (!centeredOnFirstFix) {
    centeredOnFirstFix = true;
    map.setView(latLng, Math.max(map.getZoom(), FOLLOW_ZOOM), { animate: false });
  } else if (following) {
    map.panTo(latLng, { animate: true, duration: 0.5 });
  }
  $('banner').hidden = true;
  renderStatus();
});

tracker.addEventListener('error', () => {
  $('banner').hidden = !tracker.denied;
  renderStatus();
});

$('banner-retry').addEventListener('click', () => tracker.start());

// iOS can stop delivering updates after the app was in the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tracker.start();
});

// ---------- Status readout ----------

function formatCoord(value, positive, negative) {
  return `${Math.abs(value).toFixed(6).padStart(10, ' ')}° ${value >= 0 ? positive : negative}`;
}

function accuracyClass(meters) {
  if (meters < 10) return 'good';
  if (meters < 30) return 'fair';
  return 'poor';
}

function renderStatus() {
  const c = tracker.position?.coords;
  const acc = $('st-acc');
  if (c) {
    $('st-lat').textContent = formatCoord(c.latitude, 'N', 'S');
    $('st-lon').textContent = formatCoord(c.longitude, 'E', 'W');
    $('st-alt').textContent = c.altitude == null
      ? 'ALT —'
      : `ALT ${Math.round(c.altitude)} m${c.altitudeAccuracy != null ? ` ±${Math.round(c.altitudeAccuracy)}` : ''}`;
    acc.textContent = `±${Math.round(c.accuracy)} m`;
    acc.className = accuracyClass(c.accuracy);
  } else {
    $('st-lat').textContent = tracker.denied ? 'Location blocked' : 'Waiting for GPS…';
    $('st-lon').textContent = '';
    $('st-alt').textContent = '';
    acc.textContent = '';
  }
  renderMapStatus();
}

function renderMapStatus() {
  $('st-zoom').textContent = `z${map.getZoom()}`;
  $('st-net').textContent = navigator.onLine ? 'Online' : 'Offline';
}

map.on('zoomend', renderMapStatus);
window.addEventListener('online', () => { renderMapStatus(); tileLayer.redraw(); });
window.addEventListener('offline', renderMapStatus);

$('status').addEventListener('click', async () => {
  const latLng = currentLatLng();
  if (!latLng) return;
  try {
    await navigator.clipboard.writeText(`${latLng[0].toFixed(6)}, ${latLng[1].toFixed(6)}`);
    toast('Coordinates copied');
  } catch {
    toast('Could not copy');
  }
});

// ---------- Controls ----------

function setFollowing(on) {
  following = on;
  $('btn-follow').setAttribute('aria-pressed', String(on));
  $('btn-follow').setAttribute('aria-label', on ? 'Stop following' : 'Follow me');
  const latLng = currentLatLng();
  if (on && latLng) map.setView(latLng, Math.max(map.getZoom(), FOLLOW_ZOOM));
}

// Dragging the map by hand ends Follow Me, like Apple Maps.
map.on('dragstart', () => {
  if (following) setFollowing(false);
});

$('btn-follow').addEventListener('click', () => {
  if (tracker.denied) {
    $('banner').hidden = false;
    return;
  }
  if (!tracker.position) tracker.start();
  setFollowing(!following);
});

$('btn-center').addEventListener('click', () => {
  const latLng = currentLatLng();
  if (latLng) {
    map.setView(latLng, Math.max(map.getZoom(), FOLLOW_ZOOM));
  } else {
    tracker.start();
    toast(tracker.denied ? 'Location is blocked' : 'Waiting for GPS…');
  }
});

$('btn-zoom-in').addEventListener('click', () => map.zoomIn());
$('btn-zoom-out').addEventListener('click', () => map.zoomOut());

// ---------- Offline sheet ----------

function renderAttribution() {
  $('attribution').textContent = settings.attribution;
}

const sheet = initOfflineSheet({
  map,
  onTilesChanged: () => tileLayer.redraw(),
  onSourceChanged: () => {
    renderAttribution();
    tileLayer.redraw();
  },
  onSelectArea: () => areaSelect.enter(),
  onDownloadProgress: (fraction) => {
    $('pill').hidden = fraction == null;
    if (fraction != null) {
      $('pill-bar').value = fraction;
      $('pill-text').textContent = `Saving tiles ${Math.round(fraction * 100)}%`;
    }
  },
});

const areaSelect = initAreaSelect({
  map,
  runDownload: sheet.runDownload,
  isDownloading: sheet.isDownloading,
});

$('btn-offline').addEventListener('click', sheet.open);
$('pill').addEventListener('click', sheet.open);

// ---------- Start ----------

renderAttribution();
renderStatus();
tracker.start();
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
