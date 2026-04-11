/**
 * Gyroscope — DeviceOrientationEvent → panorama pan/tilt control.
 * Pattern: Singleton
 *
 * Maps device orientation to panorama view:
 *   alpha  (0–360°, compass heading)  → panorama pan
 *   beta   (–180–180°, front-to-back) → panorama tilt
 *
 * Tilt formula: targetTilt = 90 – beta  (holding phone upright = 0° tilt)
 * Calibration: on first reading the current panorama pan is saved as the
 *   offset so the view doesn't jump to absolute compass north.
 *
 * Low-pass filter (SMOOTHING ~0.15) keeps movement smooth without lag.
 *
 * iOS 13+ requires an explicit DeviceOrientationEvent.requestPermission() call
 * that MUST originate from a user gesture (tap).  The toggle button wires this.
 */
(function (Nav) {
  'use strict';

  var SMOOTHING        = 0.15;   // 0 = no smoothing, 1 = frozen
  var TILT_CLAMP_MAX   = 70;     // max up/down tilt in degrees
  var TILT_CLAMP_MIN   = -70;
  var RAF_INTERVAL_MS  = 50;     // min ms between pano updates (~20 fps)

  // ── State ────────────────────────────────────────────────────────────────────

  var _active        = false;
  var _calibrated    = false;
  var _panOffset     = 0;       // difference between device alpha and pano pan at calibration
  var _smoothPan     = 0;
  var _smoothTilt    = 0;
  var _lastRaf       = 0;
  var _rafId         = null;

  // ── Singleton ────────────────────────────────────────────────────────────────

  function Gyroscope() {}

  Gyroscope.prototype.isSupported = function () {
    return typeof DeviceOrientationEvent !== 'undefined';
  };

  /**
   * Toggle gyroscope on/off.
   * On iOS 13+ this must be called from a user-gesture handler so that
   * requestPermission() is allowed to fire.
   */
  Gyroscope.prototype.toggle = function () {
    if (_active) {
      this.stop();
    } else {
      this.start();
    }
  };

  Gyroscope.prototype.start = function () {
    if (_active) return;
    if (!this.isSupported()) {
      Nav.Toast.show('Gyroscope is not supported on this device.', 3000);
      return;
    }

    var self = this;

    // iOS 13+ requires explicit permission from a user-gesture
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(function (state) {
          if (state === 'granted') {
            self._activate();
          } else {
            Nav.Toast.show('Gyroscope permission denied.', 3000);
          }
        })
        .catch(function () {
          Nav.Toast.show('Could not request gyroscope permission.', 3000);
        });
    } else {
      this._activate();
    }
  };

  Gyroscope.prototype.stop = function () {
    if (!_active) return;
    _active     = false;
    _calibrated = false;
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    window.removeEventListener('deviceorientation', _handleOrientation);
    _updateToggleButton(false);
    Nav.Toast.show('Gyroscope off', 1800);
  };

  Gyroscope.prototype.isActive = function () { return _active; };

  // ── Private ──────────────────────────────────────────────────────────────────

  Gyroscope.prototype._activate = function () {
    _active      = true;
    _calibrated  = false;
    window.addEventListener('deviceorientation', _handleOrientation, true);
    _rafId = requestAnimationFrame(_rafLoop);
    _updateToggleButton(true);
    Nav.Toast.show('Gyroscope on — tilt & turn your device to look around', 2800);
  };

  // Latest raw values from the sensor (written by event, read by RAF)
  var _rawAlpha = null;
  var _rawBeta  = null;

  function _handleOrientation(evt) {
    if (evt.alpha === null || evt.beta === null) return;
    _rawAlpha = evt.alpha;
    _rawBeta  = evt.beta;
  }

  function _rafLoop(ts) {
    if (!_active) return;
    _rafId = requestAnimationFrame(_rafLoop);

    if (_rawAlpha === null) return;                    // no reading yet
    if (ts - _lastRaf < RAF_INTERVAL_MS) return;       // throttle
    _lastRaf = ts;

    if (!window.pano) return;

    // Calibrate on first valid reading: align device heading with current pan
    if (!_calibrated) {
      _panOffset  = _rawAlpha - pano.getPan();
      _smoothPan  = pano.getPan();
      _smoothTilt = pano.getTilt();
      _calibrated = true;
    }

    // Target pan: remove calibration offset so initial orientation feels natural
    var targetPan  = _rawAlpha - _panOffset;

    // Target tilt: holding phone vertically (beta≈90°) = looking straight ahead (0° tilt)
    //   targetTilt = -(beta - 90)  →  0° when upright, positive when tilting top back
    var targetTilt = -((_rawBeta || 90) - 90);
    if (targetTilt >  TILT_CLAMP_MAX) targetTilt =  TILT_CLAMP_MAX;
    if (targetTilt <  TILT_CLAMP_MIN) targetTilt =  TILT_CLAMP_MIN;

    // Low-pass filter
    _smoothPan  = _smoothPan  + SMOOTHING * (_shortestArc(_smoothPan, targetPan));
    _smoothTilt = _smoothTilt + SMOOTHING * (targetTilt - _smoothTilt);

    pano.setPanTiltFov(_smoothPan, _smoothTilt, pano.getFov());
  }

  /**
   * Returns the signed shortest arc from `from` to `to` (handles 0/360 wrap).
   */
  function _shortestArc(from, to) {
    var diff = ((to - from) % 360 + 540) % 360 - 180;
    return diff;
  }

  function _updateToggleButton(on) {
    var btn = document.getElementById('nav-gyro-btn');
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.title = on ? 'Gyroscope on (tap to disable)' : 'Use gyroscope to look around';
  }

  Nav.Gyroscope = new Gyroscope();

})(window.Nav = window.Nav || {});
