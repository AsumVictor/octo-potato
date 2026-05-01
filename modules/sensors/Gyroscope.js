// We added Gyroscope to let mobile users look around the panorama by physically
// turning their device instead of dragging with a finger.
// We map device alpha (compass heading) to panorama pan and device beta (tilt)
// to panorama tilt, calibrated on activation so the current view becomes the
// "home" orientation regardless of which direction the device is pointing.
// We also thought about using absolute orientation sensors but DeviceOrientation
// has wider browser support on the Android and iOS devices used on campus.
(function (Nav) {
  'use strict';

  var SMOOTHING        = 0.15;
  var TILT_CLAMP_MAX   = 70;
  var TILT_CLAMP_MIN   = -70;
  var RAF_INTERVAL_MS  = 50;

  var _active        = false;
  var _calibrated    = false;
  var _panOffset     = 0;
  var _smoothPan     = 0;
  var _smoothTilt    = 0;
  var _lastRaf       = 0;
  var _rafId         = null;

  function Gyroscope() {}

  Gyroscope.prototype.isSupported = function () {
    return typeof DeviceOrientationEvent !== 'undefined';
  };

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

    // We call requestPermission here because iOS 13+ requires it to be triggered
    // directly from a user gesture — calling it anywhere else silently fails.
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

  Gyroscope.prototype._activate = function () {
    _active      = true;
    _calibrated  = false;
    window.addEventListener('deviceorientation', _handleOrientation, true);
    _rafId = requestAnimationFrame(_rafLoop);
    _updateToggleButton(true);
    Nav.Toast.show('Gyroscope on — tilt & turn your device to look around', 2800);
  };

  var _rawAlpha = null;
  var _rawBeta  = null;

  // We decouple the sensor event from the RAF loop so the pano update happens
  // at a controlled rate (RAF_INTERVAL_MS) rather than at the sensor's firing
  // rate which can be 60+ Hz and would cause unnecessary CPU load.
  function _handleOrientation(evt) {
    if (evt.alpha === null || evt.beta === null) return;
    _rawAlpha = evt.alpha;
    _rawBeta  = evt.beta;
  }

  function _rafLoop(ts) {
    if (!_active) return;
    _rafId = requestAnimationFrame(_rafLoop);

    if (_rawAlpha === null) return;
    if (ts - _lastRaf < RAF_INTERVAL_MS) return;
    _lastRaf = ts;

    if (!window.pano) return;

    // We capture the offset between device heading and current pan on the first
    // valid reading so activating the gyroscope doesn't suddenly spin the view
    // to magnetic north.
    if (!_calibrated) {
      _panOffset  = _rawAlpha - pano.getPan();
      _smoothPan  = pano.getPan();
      _smoothTilt = pano.getTilt();
      _calibrated = true;
    }

    var targetPan  = _rawAlpha - _panOffset;

    // We subtract 90° from beta because holding the phone vertically gives
    // beta ≈ 90°, and we want that to map to 0° panorama tilt (straight ahead).
    var targetTilt = -((_rawBeta || 90) - 90);
    if (targetTilt >  TILT_CLAMP_MAX) targetTilt =  TILT_CLAMP_MAX;
    if (targetTilt <  TILT_CLAMP_MIN) targetTilt =  TILT_CLAMP_MIN;

    _smoothPan  = _smoothPan  + SMOOTHING * (_shortestArc(_smoothPan, targetPan));
    _smoothTilt = _smoothTilt + SMOOTHING * (targetTilt - _smoothTilt);

    pano.setPanTiltFov(_smoothPan, _smoothTilt, pano.getFov());
  }

  // We use shortest-arc interpolation so pan smoothing never spins the long way
  // around when the angle crosses the 0/360 boundary.
  function _shortestArc(from, to) {
    return ((to - from) % 360 + 540) % 360 - 180;
  }

  function _updateToggleButton(on) {
    var btn = document.getElementById('nav-gyro-btn');
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.title = on ? 'Gyroscope on (tap to disable)' : 'Use gyroscope to look around';
  }

  Nav.Gyroscope = new Gyroscope();

})(window.Nav = window.Nav || {});
