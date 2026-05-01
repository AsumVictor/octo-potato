// We built Renderer as the canvas overlay that draws all navigation indicators
// on top of the Pano2VR panorama viewer every animation frame.
// We use a transparent canvas positioned over the panorama with pointer-events
// set to none so all mouse and touch events still reach the Pano2VR player
// underneath — the Pano2VR player is generated code we do not modify.
(function (Nav) {
  'use strict';

  function Renderer() {
    this._canvas = null;
    this._rafId  = null;
  }

  Renderer.prototype.init = function () {
    this._canvas = document.createElement('canvas');
    this._canvas.id = 'nav-overlay-canvas';
    this._canvas.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:100vw',    'height:100vh',
      'pointer-events:none',
      'z-index:9999'
    ].join(';');
    document.body.appendChild(this._canvas);
    this._resize();
    window.addEventListener('resize', this._resize.bind(this));
    this._startLoop();
  };

  Renderer.prototype._resize = function () {
    if (!this._canvas) return;
    // We multiply by devicePixelRatio so the canvas stays sharp on retina
    // screens — without this all drawing looks blurry on high-DPI devices.
    var dpr = window.devicePixelRatio || 1;
    this._canvas.width  = Math.round(window.innerWidth  * dpr);
    this._canvas.height = Math.round(window.innerHeight * dpr);
  };

  Renderer.prototype._startLoop = function () {
    var self = this;
    function loop() {
      self._render();
      self._rafId = requestAnimationFrame(loop);
    }
    this._rafId = requestAnimationFrame(loop);
  };

  Renderer.prototype._render = function () {
    var state  = Nav.AppState;
    var dpr    = window.devicePixelRatio || 1;
    var W      = window.innerWidth;
    var H      = window.innerHeight;
    var ctx    = this._canvas.getContext('2d');

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (!state.navActive || !state.activeRoute) { ctx.restore(); return; }

    var path   = state.activeRoute.path;
    var next   = path[state.stepIndex + 1];
    if (!next) { ctx.restore(); return; }

    var camPan  = pano.getPan();
    var camTilt = pano.getTilt();
    var camFov  = pano.getFov();

    // We compare the pan delta between the current frame and the last frame to
    // detect when the user is actively looking away from the target hotspot —
    // we only show the "wrong direction" warning after autoRotateDone is true
    // so we don't trigger it during the initial auto-rotate animation.
    var isWrong = false;
    if (state.lastCamPan !== null && state.autoRotateDone) {
      var prevDiff = Math.abs(Nav.Projector.normAngle(next.pan - state.lastCamPan));
      var currDiff = Math.abs(Nav.Projector.normAngle(next.pan - camPan));
      isWrong = (currDiff - prevDiff) > 1;
    }
    state.lastCamPan = camPan;

    var pos = Nav.Projector.project(next.pan, next.tilt,
                                    { pan: camPan, tilt: camTilt, fov: camFov }, W, H);

    if (pos.inView) {
      isWrong = false;
      drawGroundTrail(ctx, pos.x, pos.y, W, H);
      drawGlowingRings(ctx, pos.x, pos.y);
      drawBounceArrow(ctx, pos.x, pos.y);
      drawNavLabel(ctx, pos.x, pos.y, state.stepIndex, path.length - 1);
    } else {
      drawEdgeArrow(ctx, pos.dPan, pos.dTilt, W, H, isWrong);
    }

    ctx.restore();
  };

  // We draw the ground trail as an animated series of chevron arrows from the
  // bottom-centre of the screen up to the hotspot position to suggest "walk
  // towards this point on the floor in front of you".
  function drawGroundTrail(ctx, hx, hy, W, H) {
    var ox = W / 2;
    var oy = H * 0.82;
    if (hy > oy - 20) oy = hy - 20;

    var dx  = hx - ox;
    var dy  = hy - oy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 30) return;

    var angle = Math.atan2(dy, dx);

    var grad = ctx.createLinearGradient(ox, oy, hx, hy);
    grad.addColorStop(0,    'rgba(255,107,53,0.0)');
    grad.addColorStop(0.15, 'rgba(255,107,53,0.25)');
    grad.addColorStop(0.7,  'rgba(255,107,53,0.55)');
    grad.addColorStop(1.0,  'rgba(255,107,53,0.0)');

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    var SPACING = 28;
    var SIZE    = 9;
    var count   = Math.floor(len / SPACING) || 1;
    var tOff    = (performance.now() % (SPACING * 1000 / 420)) / (SPACING * 1000 / 420);

    ctx.translate(ox, oy);
    ctx.rotate(angle);

    for (var i = 0; i < count; i++) {
      var t  = (i + tOff) / count;
      var cx = (i + tOff) * SPACING;
      if (cx > len * 0.92) continue;

      var fade;
      if (t < 0.15)      fade = t / 0.15;
      else if (t > 0.80) fade = (1 - t) / 0.20;
      else               fade = 1.0;

      var scale = 0.7 + t * 0.5;
      var cs    = SIZE * scale;

      ctx.save();
      ctx.translate(cx, 0);
      ctx.strokeStyle = 'rgba(255,107,53,' + (fade * 0.9) + ')';
      ctx.lineWidth   = 2.2 * scale;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(-cs * 0.6, -cs);
      ctx.lineTo( cs * 0.4,  0);
      ctx.lineTo(-cs * 0.6,  cs);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (fade * 0.9 * 0.35) + ')';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(-cs * 0.5, -cs * 0.7);
      ctx.lineTo( cs * 0.25, 0);
      ctx.lineTo(-cs * 0.5,  cs * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // We draw three rings expanding outward in a sonar-ping pattern to draw the
  // user's eye to the target hotspot without covering it completely.
  function drawGlowingRings(ctx, x, y) {
    var t = (performance.now() % 1800) / 1800;

    var halo = ctx.createRadialGradient(x, y, 0, x, y, 90);
    halo.addColorStop(0,   'rgba(255,107,53,0.22)');
    halo.addColorStop(0.5, 'rgba(255,107,53,0.10)');
    halo.addColorStop(1,   'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    for (var i = 0; i < 3; i++) {
      var phase  = (t + i * 0.333) % 1.0;
      var radius = 22 + phase * 80;
      var alpha  = (1 - phase) * 0.9;
      var lw     = 3.5 - phase * 2.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,107,53,' + alpha + ')';
      ctx.lineWidth   = lw;
      ctx.stroke();
    }

    var grd = ctx.createRadialGradient(x, y, 0, x, y, 22);
    grd.addColorStop(0,   'rgba(255,180,120,0.9)');
    grd.addColorStop(0.4, 'rgba(255,107,53,0.7)');
    grd.addColorStop(1,   'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle   = '#FF6B35';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 2.5;
    ctx.stroke();
  }

  // We animate the arrow with Math.sin so it bounces at a constant rate
  // regardless of the device frame rate.
  function drawBounceArrow(ctx, x, y) {
    var bounce = Math.sin(performance.now() / 300) * 7;
    var ay     = y - 52 + bounce;

    ctx.save();
    ctx.translate(x, ay);
    ctx.fillStyle   = '#FF6B35';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0,  12);
    ctx.lineTo(-9,  0);
    ctx.lineTo(-4,  0);
    ctx.lineTo(-4, -11);
    ctx.lineTo( 4, -11);
    ctx.lineTo( 4,  0);
    ctx.lineTo( 9,  0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawNavLabel(ctx, x, y, currentIdx, totalSteps) {
    var label   = 'Move here';
    var counter = 'Step ' + (currentIdx + 1) + ' of ' + totalSteps;

    ctx.font = 'bold 13px Montserrat, Arial, sans-serif';
    var tw1  = ctx.measureText(label).width;
    ctx.font = '11px Montserrat, Arial, sans-serif';
    var tw2  = ctx.measureText(counter).width;

    var lw = Math.max(tw1, tw2) + 24;
    var lh = 44;
    var lx = x - lw / 2;
    var ly = y - 108;

    ctx.shadowColor   = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    roundRect(ctx, lx, ly, lw, lh, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    ctx.beginPath();
    roundRect(ctx, lx, ly, 4, lh, [10, 0, 0, 10]);
    ctx.fillStyle = '#FF6B35';
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font      = 'bold 13px Montserrat, Arial, sans-serif';
    ctx.fillText(label, lx + 12, ly + 17);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font      = '11px Montserrat, Arial, sans-serif';
    ctx.fillText(counter, lx + 12, ly + 33);
  }

  // We draw the edge arrow when the target hotspot is off-screen so the user
  // always knows which direction to turn even when they can't see the hotspot.
  // We also change the colour to red and add "Wrong direction!" text when we
  // detect the user is actively moving away from the target.
  function drawEdgeArrow(ctx, dPan, dTilt, W, H, isWrong) {
    var angle  = Math.atan2(-dTilt * (H / W), dPan);
    var margin = 56;
    var cx = W / 2, cy = H / 2;
    var ex = cx + Math.cos(angle) * (W / 2 - margin);
    var ey = cy + Math.sin(angle) * (H / 2 - margin);

    var baseColor = isWrong ? '220,50,50' : '255,107,53';
    var pulse     = 0.5 + 0.35 * Math.sin(performance.now() / 350);

    var grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, 48);
    grd.addColorStop(0, 'rgba(' + baseColor + ',' + pulse + ')');
    grd.addColorStop(1, 'rgba(' + baseColor + ',0)');
    ctx.beginPath();
    ctx.arc(ex, ey, 48, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(angle);
    ctx.fillStyle   = 'rgb(' + baseColor + ')';
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo( 22,  0);
    ctx.lineTo(  7, -10);
    ctx.lineTo(  7,  -5);
    ctx.lineTo(-14,  -5);
    ctx.lineTo(-14,   5);
    ctx.lineTo(  7,   5);
    ctx.lineTo(  7,  10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    if (isWrong) {
      var msg = 'Wrong direction!';
      ctx.font    = 'bold 13px Montserrat, Arial, sans-serif';
      var tw      = ctx.measureText(msg).width;
      var pw = tw + 20, ph = 26;
      var lx = ex - pw / 2, ly = ey - 56;
      ctx.beginPath();
      roundRect(ctx, lx, ly, pw, ph, 8);
      ctx.fillStyle = 'rgba(180,30,30,0.88)';
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.fillText(msg, ex, ly + 17);
      ctx.font      = '11px Montserrat, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,200,200,0.85)';
      ctx.fillText(Math.abs(Math.round(dPan)) + '° away', ex, ey + 36);
    } else {
      ctx.font      = 'bold 12px Montserrat, Arial, sans-serif';
      ctx.fillStyle = 'white';
      ctx.fillText(Math.abs(Math.round(dPan)) + '°', ex, ey + 36);
    }
    ctx.textAlign = 'left';
  }

  // We implemented roundRect manually because ctx.roundRect() is not available
  // in all browsers the campus devices run.
  function roundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') r = [r, r, r, r];
    ctx.moveTo(x + r[0], y);
    ctx.lineTo(x + w - r[1], y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r[1]);
    ctx.lineTo(x + w, y + h - r[2]);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
    ctx.lineTo(x + r[3], y + h);
    ctx.quadraticCurveTo(x,     y + h, x, y + h - r[3]);
    ctx.lineTo(x, y + r[0]);
    ctx.quadraticCurveTo(x,     y,     x + r[0], y);
  }

  Nav.Renderer = new Renderer();

})(window.Nav = window.Nav || {});
