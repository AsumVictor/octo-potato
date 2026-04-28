
(function (Nav) {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────────
  var _canvas   = null;
  var _ctx      = null;
  var _drawing  = false;
  var _startX   = 0;
  var _startY   = 0;
  var _rect     = null;   // { x, y, w, h } in px
  var _location = null;   // captured pano location

  // ── Public API ────────────────────────────────────────────────────────────────

  function ReportTool() {}

  /** Called by UIBuilder after DOM is ready. */
  ReportTool.prototype.init = function () {
    _canvas = document.getElementById('report-draw-canvas');
    _ctx    = _canvas && _canvas.getContext('2d');
    if (!_canvas) return;

    _canvas.addEventListener('mousedown',  _onDown);
    _canvas.addEventListener('mousemove',  _onMove);
    _canvas.addEventListener('mouseup',    _onUp);
    _canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    _canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    _canvas.addEventListener('touchend',   _onTouchEnd,   { passive: false });
  };

  /** Activate drawing mode. */
  ReportTool.prototype.startDraw = function () {
    if (!_canvas) return;
    _sizeCanvas();
    _canvas.style.display = 'block';
    _canvas.style.cursor  = 'crosshair';
    _drawing  = false;
    _rect     = null;
    _location = null;
    Nav.Toast && Nav.Toast.show('Draw a region to report, then release.', null, 6000);
  };

  /** Open the report dialog (can be called without drawing too). */
  ReportTool.prototype.openDialog = function () {
    var dlg = document.getElementById('report-dialog-overlay');
    if (dlg) dlg.classList.add('active');
  };

  /** Close the report dialog and reset. */
  ReportTool.prototype.closeDialog = function () {
    var dlg = document.getElementById('report-dialog-overlay');
    if (dlg) dlg.classList.remove('active');
    _resetForm();
    _rect     = null;
    _location = null;
  };

  // ── Canvas drawing ────────────────────────────────────────────────────────────

  function _sizeCanvas() {
    var container = document.getElementById('container');
    if (!container || !_canvas) return;
    _canvas.width  = container.offsetWidth;
    _canvas.height = container.offsetHeight;
  }

  function _clientXY(e) {
    var r = _canvas.getBoundingClientRect();
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function _onDown(e) {
    e.preventDefault();
    var pt  = _clientXY(e);
    _startX = pt.x;
    _startY = pt.y;
    _drawing = true;
  }

  function _onMove(e) {
    if (!_drawing) return;
    e.preventDefault();
    var pt = _clientXY(e);
    _drawRect(_startX, _startY, pt.x - _startX, pt.y - _startY);
  }

  function _onUp(e) {
    if (!_drawing) return;
    e.preventDefault();
    _drawing = false;
    var pt = _clientXY(e);
    var w  = pt.x - _startX;
    var h  = pt.y - _startY;

    // Require a minimum drag of 10 px
    if (Math.abs(w) < 10 || Math.abs(h) < 10) {
      _clearCanvas();
      _canvas.style.display = 'none';
      return;
    }

    _rect = {
      x: Math.min(_startX, pt.x),
      y: Math.min(_startY, pt.y),
      w: Math.abs(w),
      h: Math.abs(h)
    };

    // Capture pano view angles
    _location = _capturePanoLocation();

    // Hide canvas and open form
    _clearCanvas();
    _canvas.style.display = 'none';
    Nav.ReportTool.openDialog();
  }

  // Touch aliases
  function _onTouchStart(e) { _onDown(e); }
  function _onTouchMove(e)  { _onMove(e); }
  function _onTouchEnd(e)   { _onUp(e);   }

  function _drawRect(x, y, w, h) {
    if (!_ctx) return;
    _clearCanvas();
    _ctx.strokeStyle = '#FF6B35';
    _ctx.lineWidth   = 2;
    _ctx.setLineDash([5, 4]);
    _ctx.fillStyle   = 'rgba(255,107,53,0.12)';
    _ctx.fillRect(x, y, w, h);
    _ctx.strokeRect(x, y, w, h);
  }

  function _clearCanvas() {
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  }

  // ── Pano location capture ─────────────────────────────────────────────────────

  function _capturePanoLocation() {
    var info = {};
    try {
      if (window.pano) {
        info.nodeId = pano.getCurrentNode();
        if (typeof pano.getPan  === 'function') info.pan  = +pano.getPan().toFixed(2);
        if (typeof pano.getTilt === 'function') info.tilt = +pano.getTilt().toFixed(2);
        if (typeof pano.getFov  === 'function') info.fov  = +pano.getFov().toFixed(2);
      }
    } catch (ex) { /* pano API not ready */ }

    // Also record normalised viewport rect
    if (_rect && _canvas) {
      info.viewportRect = {
        x: +(_rect.x / _canvas.width).toFixed(4),
        y: +(_rect.y / _canvas.height).toFixed(4),
        w: +(_rect.w / _canvas.width).toFixed(4),
        h: +(_rect.h / _canvas.height).toFixed(4)
      };
      info.pixelRect = { x: Math.round(_rect.x), y: Math.round(_rect.y), w: Math.round(_rect.w), h: Math.round(_rect.h) };
    }

    // Node metadata from AppState if available
    try {
      var node = Nav.AppState && Nav.AppState.nodes && Nav.AppState.nodes[info.nodeId];
      if (node) {
        info.nodeTitle = node.title || '';
        if (node.lat != null) { info.lat = node.lat; info.lng = node.lng; }
      }
    } catch (ex) { /* ok */ }

    return info;
  }

  // ── Form submission ───────────────────────────────────────────────────────────

  ReportTool.prototype.submitReport = function () {
    var name      = (document.getElementById('report-name')        || {}).value || '';
    var email     = (document.getElementById('report-email')       || {}).value || '';
    var issueType = (document.getElementById('report-issue-type')  || {}).value || '';
    var desc      = (document.getElementById('report-description') || {}).value || '';
    var fileInput = document.getElementById('report-pictures');
    var files     = fileInput && fileInput.files ? Array.from(fileInput.files) : [];

    // Basic validation
    if (!name.trim())   { _shake('report-name');        return; }
    if (!email.trim())  { _shake('report-email');       return; }
    if (!issueType)     { _shake('report-issue-type');  return; }
    if (!desc.trim())   { _shake('report-description'); return; }

    // Resolve full issue type metadata from schema
    var issueSchema = (Nav.IssueTypes || []).filter(function (t) { return t.id === issueType; })[0] || { id: issueType, label: issueType, icon: '', severity: 'low' };

    // Build report object — pass File objects so IssueService can upload them
    var report = {
      timestamp: new Date().toISOString(),
      reporter: {
        name:  name.trim(),
        email: email.trim()
      },
      issue: {
        id:          issueSchema.id,
        label:       issueSchema.label,
        severity:    issueSchema.severity,
        description: desc.trim()
      },
      location: _location || {},
      pictures: files
    };

    // Loading state
    var sendBtn = document.getElementById('report-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }

    Nav.IssueService.submit(report, function () {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Report'; }
      Nav.ReportTool.closeDialog();
      _playSuccessChime();
      _showSuccessPopup(6000);
    }, function (err) {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Report'; }
      Nav.Toast && Nav.Toast.show('Failed to submit — please try again.', null, 5000);
      console.error('[ReportTool] submit error:', err);
    });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function _resetForm() {
    ['report-name','report-email','report-description'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var sel = document.getElementById('report-issue-type');
    if (sel) sel.selectedIndex = 0;
    var fi = document.getElementById('report-pictures');
    if (fi) fi.value = '';
    var preview = document.getElementById('report-pic-preview');
    if (preview) preview.innerHTML = '';
  }

  function _shake(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('report-shake');
    void el.offsetWidth; // reflow
    el.classList.add('report-shake');
    el.focus();
  }

  // ── Success popup (auto-dismisses after `ms` milliseconds) ───────────────────

  var _successTimer    = null;
  var _successRafTimer = null;

  function _showSuccessPopup(ms) {
    var pop  = document.getElementById('report-success-popup');
    var fill = document.getElementById('report-success-bar-fill');
    if (!pop || !fill) return;

    // Reset bar width then animate it shrinking over `ms`
    fill.style.transition = 'none';
    fill.style.width = '100%';

    pop.classList.add('active');

    // Start shrink on next frame so transition picks it up
    requestAnimationFrame(function () {
      fill.style.transition = 'width ' + ms + 'ms linear';
      fill.style.width = '0%';
    });

    clearTimeout(_successTimer);
    _successTimer = setTimeout(function () {
      pop.classList.remove('active');
    }, ms);

    // Allow clicking the popup to dismiss early
    pop.onclick = function () {
      clearTimeout(_successTimer);
      pop.classList.remove('active');
    };
  }

  // ── Success chime via Web Audio API (no external file needed) ────────────────

  function _playSuccessChime() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();

      // Three ascending notes: C5 → E5 → G5
      var notes = [523.25, 659.25, 783.99];
      notes.forEach(function (freq, i) {
        var osc   = ctx.createOscillator();
        var gain  = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type      = 'sine';
        osc.frequency.value = freq;

        var start = ctx.currentTime + i * 0.13;
        var end   = start + 0.22;

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, end);

        osc.start(start);
        osc.stop(end);
      });
    } catch (ex) { /* audio unavailable — silent */ }
  }

  Nav.ReportTool = new ReportTool();

})(window.Nav = window.Nav || {});
