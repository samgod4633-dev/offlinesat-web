/**
 * Wraps navigator.geolocation.watchPosition. Dispatches "update" with the latest
 * position and "error" when a fix fails (check `denied` for permission problems).
 */
export class LocationTracker extends EventTarget {
  position = null;
  error = null;
  #watchId = null;

  get denied() {
    return this.error?.code === 1; // GeolocationPositionError.PERMISSION_DENIED
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.error = { code: 2, message: 'Location is not available on this device.' };
      this.dispatchEvent(new Event('error'));
      return;
    }
    if (this.#watchId !== null) navigator.geolocation.clearWatch(this.#watchId);
    this.#watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.position = position;
        this.error = null;
        this.dispatchEvent(new Event('update'));
      },
      (error) => {
        this.error = error;
        this.dispatchEvent(new Event('error'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }
}
