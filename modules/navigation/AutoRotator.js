/**
 * AutoRotator — animates the camera to face the next hotspot.
 *
 * When we advance a navigation step, we call rotateTo(pan, tilt) and it
 * smoothly swings the view there over ~1.3 s using an ease-in-out curve.
 * After the animation finishes, if the user looks away, an idle timer kicks
 * in after 4 s and aims them back at the target.
 */
(function (Nav) {
  'use strict';

  var DURATION   = 1300;  // ms
  var IDLE_DELAY = 4000;  // ms before re-aim after user looks away

  function AutoRotator() {
    this._rafId     = null;
    this._idleTimer = null;
  }

  // Cancels any in-flight animation before starting a new one — avoids fighting itself.
  AutoRotator.prototype.rotateTo = function (targetPan, targetTilt) {
    var self = this;
    this.cancel();
    Nav.AppState.autoRotateDone = false;

    var startPan  = pano.getPan();
    var startTilt = pano.getTilt();
    var startFov  = pano.getFov();
    var startTime = null;

    // Shortest arc — avoid spinning the long way round
    var dPan  = targetPan - startPan;
    dPan      = ((dPan + 180) % 360 + 360) % 360 - 180;

    // Clamp tilt to avoid flipping overhead
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
