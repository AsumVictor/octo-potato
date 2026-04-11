/**
 * Projector — Converts spherical pan/tilt angles to screen pixel coordinates.
 * Pure math, no side-effects. Exposed as Nav.Projector.
 */
(function (Nav) {
  'use strict';

  function Projector() {}

  /**
   * Project a hotspot at (hsPan, hsTilt) onto the screen given the current camera.
   * @param {number} hsPan   - hotspot pan angle (degrees)
   * @param {number} hsTilt  - hotspot tilt angle (degrees)
   * @param {{ pan, tilt, fov }} cam - current camera state
   * @param {number} W - viewport width  (CSS pixels)
   * @param {number} H - viewport height (CSS pixels)
   * @returns {{ x, y, dPan, dTilt, inView }}
   */
  Projector.prototype.project = function (hsPan, hsTilt, cam, W, H) {
    var dPan  = hsPan  - cam.pan;
    var dTilt = hsTilt - cam.tilt;

    // Normalise horizontal to [-180, 180] to avoid wrap-around glitches
    dPan = ((dPan + 180) % 360 + 360) % 360 - 180;

    var ppd = W / cam.fov;            // pixels per degree
    var x   = W / 2 + dPan  * ppd;
    var y   = H / 2 - dTilt * ppd;

    var vFov   = cam.fov * (H / W);
    var inView = Math.abs(dPan)  < cam.fov / 2 + 8 &&
                 Math.abs(dTilt) < vFov    / 2 + 8;

    return { x: x, y: y, dPan: dPan, dTilt: dTilt, inView: inView };
  };

  /**
   * Normalise angle to [-180, 180].
   */
  Projector.prototype.normAngle = function (a) {
    return ((a + 180) % 360 + 360) % 360 - 180;
  };

  Nav.Projector = new Projector();

})(window.Nav = window.Nav || {});
