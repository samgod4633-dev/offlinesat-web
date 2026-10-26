const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;
const RETRY_DELAY_MS = 3000;

/**
 * Wraps navigator.geolocation. Dispatches "update" with the latest position and "error"
 * when a fix fails. Timeouts and "no signal" errors are retried automatically, falling
 * back to low-accuracy mode after repeated failures so a Wi-Fi/cell fix still shows.
 */
export class LocationTracker extends EventTarget {
  position = null;
  error = null;
  #watchId = null;
  #retryTimer = null;
  #failures = 0;

  get denied() {
    return this.error?.code === PERMISSION_DENIED;
  }

  get supported() {
    return 'geolocation' in navigator && window.isSecureContext;
  }

  /** Short, human description of the current problem, or '' when fine. */
  get problem() {
    if (!this.supported) return 'Location not available here';
    if (!this.error) return '';
    switch (this.error.code) {
      case PERMISSION_DENIED: return 'Location blocked';
      case POSITION_UNAVAILABLE: return 'No GPS signal – retrying';
      case TIMEOUT: return 'GPS slow – retrying';
      default: return 'Location error – retrying';
    }
  }

  start() {
    if (!this.supported) {
      this.error = { code: POSITION_UNAVAILABLE };
      this.dispatchEvent(new Event('error'));
      return;
    }
    this.#failures = 0;
    this.#watch(true);
  }

  /**
   * One-shot fix requested from a tap. iOS is more willing to show the permission
   * prompt for a user gesture, so the Center button calls this.
   */
  locateOnce() {
    if (!this.supported) return;
    navigator.geolocation.getCurrentPosition(
      (position) => this.#onPosition(position),
      (error) => this.#onError(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    if (this.#watchId === null) this.#watch(true);
  }

  #watch(highAccuracy) {
    clearTimeout(this.#retryTimer);
    if (this.#watchId !== null) navigator.geolocation.clearWatch(this.#watchId);
    this.#watchId = navigator.geolocation.watchPosition(
      (position) => this.#onPosition(position),
      (error) => this.#onError(error),
      { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 20000 },
    );
  }

  #onPosition(position) {
    this.position = position;
    this.error = null;
    this.#failures = 0;
    this.dispatchEvent(new Event('update'));
  }

  #onError(error) {
    this.error = error;
    this.dispatchEvent(new Event('error'));
    if (error.code === PERMISSION_DENIED) {
      if (this.#watchId !== null) navigator.geolocation.clearWatch(this.#watchId);
      this.#watchId = null;
      return;
    }
    // Restart the watch; after 2 failures try low accuracy (Wi-Fi / cell towers), then alternate.
    this.#failures++;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => this.#watch(this.#failures < 2 || this.#failures % 2 === 0), RETRY_DELAY_MS);
  }
}
