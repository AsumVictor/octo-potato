// We added ReportTool to let users draw a rectangle on the panorama to mark
// exactly where an issue is, then fill in a form and submit it to Supabase.
// We capture the pano pan/tilt/fov at the moment drawing ends so the location
// metadata in the report is as specific as possible.
(function (Nav) {
  'use strict';

  var _canvas   = null;
  var _ctx      = null;
  var _drawing  = false;
  var _startX   = 0;
  var _startY   = 0;
  var _rect     = null;
  var _location = null;

  function ReportTool() {}

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

  ReportTool.prototype.openDialog = function () {
    var dlg = document.getElementById('report-dialog-overlay');
    if (dlg) dlg.classList.add('active');
  };

  ReportTool.prototype.closeDialog = function () {
    var dlg = document.getElementById('report-dialog-overlay');
    if (dlg) dlg.classList.remove('active');
    _resetForm();
    _rect     = null;
    _location = null;
  };

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

    // We require at least a 10 px drag to avoid accidental submissions from
    // single taps that land on the canvas.
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

    _location = _capturePanoLocation();

    _clearCanvas();
    _canvas.style.display = 'none';
    Nav.ReportTool.openDialog();
  }

  function _onTouchStart(e) { _onDown(e); }
  function _onTouchMove(e)  { _onMove(e); }
  function _onTouchEnd(e)   { _onUp(e);   }

  function _drawRect(x, y, w, h) {
    if (!_ctx) return;
    _clearCanvas();
    _ctx.strokeStyle = '#a93c40';
    _ctx.lineWidth   = 2;
    _ctx.setLineDash([5, 4]);
    _ctx.fillStyle   = 'rgba(169,60,64,0.12)';
    _ctx.fillRect(x, y, w, h);
    _ctx.strokeRect(x, y, w, h);
  }

  function _clearCanvas() {
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  }

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

    // We store both a normalised viewport rect (0–1 fractions) and the raw
    // pixel rect so the backend can reconstruct the selection at any resolution.
    if (_rect && _canvas) {
      info.viewportRect = {
        x: +(_rect.x / _canvas.width).toFixed(4),
        y: +(_rect.y / _canvas.height).toFixed(4),
        w: +(_rect.w / _canvas.width).toFixed(4),
        h: +(_rect.h / _canvas.height).toFixed(4)
      };
      info.pixelRect = { x: Math.round(_rect.x), y: Math.round(_rect.y), w: Math.round(_rect.w), h: Math.round(_rect.h) };
    }

    try {
      var node = Nav.AppState && Nav.AppState.nodes && Nav.AppState.nodes[info.nodeId];
      if (node) {
        info.nodeTitle = node.title || '';
        if (node.lat != null) { info.lat = node.lat; info.lng = node.lng; }
      }
    } catch (ex) { /* ok */ }

    return info;
  }

  ReportTool.prototype.submitReport = function () {
    var name      = (document.getElementById('report-name')        || {}).value || '';
    var email     = (document.getElementById('report-email')       || {}).value || '';
    var issueType = (document.getElementById('report-issue-type')  || {}).value || '';
    var desc      = (document.getElementById('report-description') || {}).value || '';
    var fileInput = document.getElementById('report-pictures');
    var files     = fileInput && fileInput.files ? Array.from(fileInput.files) : [];

    if (!name.trim())   { _shake('report-name');        return; }
    if (!email.trim())  { _shake('report-email');       return; }
    if (!issueType)     { _shake('report-issue-type');  return; }
    if (!desc.trim())   { _shake('report-description'); return; }

    // We match against Nav.AppState.issueTypes (DB-fetched, has uuid field) and
    // fall back to Nav.IssueTypes (local, has id field) if the fetch never ran.
    var types = Nav.AppState.issueTypes || Nav.IssueTypes || [];
    var issueSchema = types.filter(function (t) {
      return (t.uuid || t.id) === issueType;
    })[0] || { uuid: issueType, id: issueType, label: issueType, severity: 'low' };

    // We pass the actual File objects here so IssueService can upload them to
    // Supabase Storage — the previous version only passed metadata objects.
    var report = {
      timestamp: new Date().toISOString(),
      reporter: {
        name:  name.trim(),
        email: email.trim()
      },
      issue: {
        id:          issueSchema.uuid || issueSchema.id,
        label:       issueSchema.label,
        severity:    issueSchema.severity,
        description: desc.trim()
      },
      location: _location || {},
      pictures: files
    };

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
    void el.offsetWidth;
    el.classList.add('report-shake');
    el.focus();
  }

  var _successTimer = null;

  function _showSuccessPopup(ms) {
    var pop  = document.getElementById('report-success-popup');
    var fill = document.getElementById('report-success-bar-fill');
    if (!pop || !fill) return;

    fill.style.transition = 'none';
    fill.style.width = '100%';

    pop.classList.add('active');

    // We start the shrink on the next frame so the CSS transition has a chance
    // to pick it up after the width was reset to 100% above.
    requestAnimationFrame(function () {
      fill.style.transition = 'width ' + ms + 'ms linear';
      fill.style.width = '0%';
    });

    clearTimeout(_successTimer);
    _successTimer = setTimeout(function () {
      pop.classList.remove('active');
    }, ms);

    pop.onclick = function () {
      clearTimeout(_successTimer);
      pop.classList.remove('active');
    };
  }

  // We synthesise the success chime with the Web Audio API so there is no
  // external audio file to load or cache — three ascending notes (C5, E5, G5).
  function _playSuccessChime() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();

      var notes = [523.25, 659.25, 783.99];
      notes.forEach(function (freq, i) {
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type            = 'sine';
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
