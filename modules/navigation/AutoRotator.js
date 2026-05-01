// We added AutoRotator to smoothly swing the camera to face the next hotspot
// whenever a navigation step starts — this is the "GPS recalculating" moment
// where the panorama turns to show you exactly where to walk next.
// We also added an idle timer that re-aims the camera after 4 s of inactivity
// in case the user looked away before clicking the highlighted hotspot.
(function (Nav) {
  'use strict';

  var DURATION   = 1300;
  var IDLE_DELAY = 4000;

  function AutoRotator() {
    this._rafId     = null;
    this._idleTimer = null;
  }

  // We cancel any in-flight animation before starting a new one to avoid two
  // RAF loops fighting over the camera position simultaneously.
  AutoRotator.prototype.rotateTo = function (targetPan, targetTilt) {
    var self = this;
    this.cancel();
    Nav.AppState.autoRotateDone = false;

    var startPan  = pano.getPan();
    var startTilt = pano.getTilt();
    var startFov  = pano.getFov();
    var startTime = null;

    // We normalise the pan delta to [-180, 180] so the camera always takes
    // the shortest arc instead of spinning the long way around the sphere.
    var dPan  = targetPan - startPan;
    dPan      = ((dPan + 180) % 360 + 360) % 360 - 180;

    var clampedTilt = Math.max(-70, Math.min(70, targetTilt));
    var dTilt       = clampedTilt - startTilt;

    function step(ts) {
      if (!startTime) startTime = ts;
      var t = Math.min((ts - startTime) / DURATION, 1.0);
      var e = easeInOut(t);

      pano.setPanTiltFov(startPan + dPan * e, startTilt + dTilt * e, startFov);

      if (t < 1.0) {
        self._rafId = requestAnimationFrame(step);
      } else {
        self._rafId = null;
        Nav.AppState.autoRotateDone = true;
        if (Nav.AppState.navActive) {
          self._startIdleTimer(targetPan, clampedTilt);
        }
      }
    }

    this._rafId = requestAnimationFrame(step);
  };

  AutoRotator.prototype.cancel = function () {
    if (this._rafId)     { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  };

  AutoRotator.prototype._startIdleTimer = function (pan, tilt) {
    var self = this;
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(function () {
      if (Nav.AppState.navActive && !self._rafId) {
        self.rotateTo(pan, tilt);
      }
    }, IDLE_DELAY);
  };

  AutoRotator.prototype.resetIdleTimer = function (pan, tilt) {
    if (!Nav.AppState.navActive) return;
    this._startIdleTimer(pan, tilt);
  };

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  Nav.AutoRotator = new AutoRotator();

})(window.Nav = window.Nav || {});
