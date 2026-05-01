// We added Projector to translate a hotspot's spherical pan/tilt angles into
// 2D pixel coordinates on screen given the camera's current state.
// We use this every frame inside the Renderer render loop so navigation
// indicators track hotspots accurately as the user drags the camera around.
(function (Nav) {
  'use strict';

  function Projector() {}

  Projector.prototype.project = function (hsPan, hsTilt, cam, W, H) {
    var dPan  = hsPan  - cam.pan;
    var dTilt = hsTilt - cam.tilt;

    // We normalise dPan to [-180, 180] to prevent wrap-around glitches when
    // a hotspot is near the ±180° boundary and the camera is on the other side.
    dPan = ((dPan + 180) % 360 + 360) % 360 - 180;

    var ppd = W / cam.fov;
    var x   = W / 2 + dPan  * ppd;
    var y   = H / 2 - dTilt * ppd;

    var vFov   = cam.fov * (H / W);
    var inView = Math.abs(dPan)  < cam.fov / 2 + 8 &&
                 Math.abs(dTilt) < vFov    / 2 + 8;

    return { x: x, y: y, dPan: dPan, dTilt: dTilt, inView: inView };
  };

  // We expose normAngle separately so the Renderer can compare pan deltas
  // between frames without importing a duplicate normalisation formula.
  Projector.prototype.normAngle = function (a) {
    return ((a + 180) % 360 + 360) % 360 - 180;
  };

  Nav.Projector = new Projector();

})(window.Nav = window.Nav || {});
