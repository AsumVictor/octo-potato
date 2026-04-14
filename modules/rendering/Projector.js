/**
 * Projector — given a hotspot's pan/tilt and the current camera state, works
 * out where on screen (x, y) the hotspot lands, and whether it's actually in
 * the viewport. The Renderer uses this every frame to place arrows and labels.
 */
(function (Nav) {
  'use strict';

  function Projector() {}

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

  // Normalise any angle to [-180, 180] — used when comparing pan deltas.
  Projector.prototype.normAngle = function (a) {
    return ((a + 180) % 360 + 360) % 360 - 180;
  };

  Nav.Projector = new Projector();

})(window.Nav = window.Nav || {});
