/* global L */
import { initAreaSelect } from './areaSelect.js';
import { LocationTracker } from './location.js';
import { OfflineTileLayer } from './offlineLayer.js';
import { settings, SOURCES } from './settings.js';
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

let bannerDismissed = false;

tracker.addEventListener('error', () => {
  $('banner').hidden = !tracker.denied || bannerDismissed;
  renderStatus();
});

$('banner-retry').addEventListener('click', () => tracker.locateOnce());
$('banner-hide').addEventListener('click', () => { bannerDismissed = true; $('banner').hidden = true; });

// iOS can stop delivering updates after the app was in the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !tracker.denied) tracker.start();
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
    // Accuracy over 1 km almost always means Precise Location is switched off for the app.
    acc.textContent = c.accuracy > 1000 ? `±${(c.accuracy / 1000).toFixed(1)} km (Precise off?)` : `±${Math.round(c.accuracy)} m`;
    acc.className = accuracyClass(c.accuracy);
  } else {
    $('st-lat').textContent = tracker.problem || 'Waiting for GPS…';
    $('st-lon').textContent = tracker.denied ? '' : 'Tap ⌖ to locate';
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
  if (!latLng) {
    tracker.locateOnce();
    return;
  }
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
  if (!tracker.position) tracker.locateOnce();
  setFollowing(!following);
});

$('btn-center').addEventListener('click', () => {
  const latLng = currentLatLng();
  if (latLng) {
    map.setView(latLng, Math.max(map.getZoom(), FOLLOW_ZOOM));
    return;
  }
  // Called from a tap so iOS shows the permission prompt if it hasn't yet.
  tracker.locateOnce();
  if (tracker.denied) $('banner').hidden = false;
  else toast('Finding your location…');
});

$('btn-zoom-in').addEventListener('click', () => map.zoomIn());
$('btn-zoom-out').addEventListener('click', () => map.zoomOut());

// ---------- Imagery source ----------

function renderAttribution() {
  $('attribution').textContent = settings.source().attribution || '';
}

function applySource(id) {
  sheet.setSource(id);
  toast(settings.source().name);
}

function renderLayersMenu() {
  const menu = $('layers-menu');
  menu.replaceChildren(...SOURCES.map((source) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(settings.sourceId === source.id));
    button.innerHTML = '<span class="name"></span><span class="note"></span>';
    button.querySelector('.name').textContent = source.name;
    button.querySelector('.note').textContent = source.note;
    button.addEventListener('click', () => {
      applySource(source.id);
      toggleLayersMenu(false);
    });
    return button;
  }));
}

function toggleLayersMenu(open) {
  const menu = $('layers-menu');
  const show = open ?? menu.hidden;
  if (show) renderLayersMenu();
  menu.hidden = !show;
  $('btn-layers').setAttribute('aria-expanded', String(show));
}

$('btn-layers').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleLayersMenu();
});
document.addEventListener('click', (event) => {
  if (!$('layers-menu').hidden && !$('layers-menu').contains(event.target)) toggleLayersMenu(false);
});

// ---------- Offline sheet & area selection ----------

const sheet = initOfflineSheet({
  map,
  onTilesChanged: () => tileLayer.redraw(),
  onSourceChanged: () => {
    renderAttribution();
    tileLayer.redraw();
  },
  onSelectArea: () => areaSelect.enter(),
  onDownloadProgress: (fraction, eta) => {
    $('pill').hidden = fraction == null;
    if (fraction != null) {
      $('pill-bar').value = fraction;
      $('pill-text').textContent = `Saving ${Math.round(fraction * 100)}%${eta ? ` · ${eta}` : ''}`;
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
  // When a new version takes over, reload once so you're never stuck on the old one.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || sheet.isDownloading()) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
