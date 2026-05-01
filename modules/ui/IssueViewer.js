// We created IssueViewer to build the logistics side panel and draw the
// selection rectangle on the panorama at the exact spot the issue was reported.
(function (Nav) {
  'use strict';

  var _issue = null;

  function IssueViewer() {}

  IssueViewer.prototype.show = function (issue) {
    _issue = issue;
    _injectStyles();
    _buildPanel(issue);
  };

  // We call this after navigating the pano to the stored pan/tilt/fov so the
  // rectangle lines up with what was on screen when the report was submitted.
  IssueViewer.prototype.drawHighlight = function () {
    var loc = _issue && _issue.metadata && _issue.metadata.location;
    if (!loc || !loc.viewportRect) return;
    _drawRect(loc.viewportRect);
  };

  IssueViewer.prototype.navigateToLocation = function () {
    var loc = _issue && _issue.metadata && _issue.metadata.location;
    if (!loc || !loc.nodeId || !window.pano) return;

    var view = {};
    if (loc.pan  != null) view.pan  = loc.pan;
    if (loc.tilt != null) view.tilt = loc.tilt;
    if (loc.fov  != null) view.fov  = loc.fov;

    pano.openNext('{' + loc.nodeId + '}', view);
  };

  function _buildPanel(issue) {
    var loc      = (issue.metadata && issue.metadata.location) || {};
    var meta     = issue.metadata || {};
    var typeInfo = issue.issue_types || {};

    var localType = (Nav.IssueTypes || []).filter(function (t) {
      return t.id === typeInfo.name;
    })[0] || {};

    var label    = localType.label || typeInfo.name || 'Unknown';
    var severity = meta.severity || 'low';
    var date     = '';
    try { date = new Date(issue.created_at).toLocaleString(); } catch (e) {}

    var panel = document.createElement('div');
    panel.id  = 'logistics-panel';
    panel.innerHTML =
      '<div class="lp-header">' +
        '<div class="lp-title">Issue Report</div>' +
        '<button id="lp-recenter" type="button">Go to Location</button>' +
      '</div>' +
      '<div class="lp-body">' +
        _row('Type',        _esc(label)) +
        _row('Severity',    '<span class="lp-badge lp-sev-' + severity + '">' + severity + '</span>') +
        _row('Description', _esc(meta.description || '—')) +
        _row('Reporter',    _esc(meta.reporter_name || '—')) +
        _row('Email',       _esc(issue.reporter_email || '—')) +
        _row('Location',    _esc(loc.nodeTitle || loc.nodeId || '—')) +
        _row('Reported',    _esc(date)) +
        _imagesHtml(issue.images) +
      '</div>';

    document.body.appendChild(panel);

    document.getElementById('lp-recenter').addEventListener('click', function () {
      Nav.IssueViewer.navigateToLocation();
      // We wait 800 ms for the pano transition to finish before drawing the rect.
      setTimeout(function () { Nav.IssueViewer.drawHighlight(); }, 800);
    });
  }

  function _row(label, valueHtml) {
    return (
      '<div class="lp-row">' +
        '<span class="lp-label">' + label + '</span>' +
        '<span class="lp-value">' + valueHtml + '</span>' +
      '</div>'
    );
  }

  function _drawRect(vp) {
    var container = document.getElementById('container');
    if (!container) return;

    var canvas = document.getElementById('logistics-highlight');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'logistics-highlight';
      canvas.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:400;';
      container.appendChild(canvas);
    }

    canvas.width  = container.offsetWidth;
    canvas.height = container.offsetHeight;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var x = vp.x * canvas.width;
    var y = vp.y * canvas.height;
    var w = vp.w * canvas.width;
    var h = vp.h * canvas.height;

    ctx.fillStyle   = 'rgba(169,60,64,0.15)';
    ctx.strokeStyle = '#a93c40';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Corner dots to make the selection obvious
    ctx.setLineDash([]);
    ctx.fillStyle = '#a93c40';
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (pt) {
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function _imagesHtml(images) {
    if (!images || !images.length) return '';
    var html = '<div class="lp-row"><span class="lp-label">Photos</span></div>' +
               '<div class="lp-images">';
    images.forEach(function (url) {
      html += '<a href="' + _esc(url) + '" target="_blank">' +
                '<img src="' + _esc(url) + '" class="lp-img-thumb" />' +
              '</a>';
    });
    return html + '</div>';
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _injectStyles() {
    if (document.getElementById('logistics-styles')) return;
    var s = document.createElement('style');
    s.id = 'logistics-styles';
    s.textContent =
      '#container { width: calc(100% - 320px) !important; }' +

      '#logistics-panel {' +
        'position:fixed;top:0;right:0;width:320px;height:100%;' +
        'background:white;color:#a93c40;font-family:system-ui,sans-serif;' +
        'font-size:13px;overflow-y:auto;z-index:900;' +
        'box-shadow:-4px 0 24px rgba(169,60,64,0.2);display:flex;flex-direction:column;' +
      '}' +

      '.lp-header {' +
        'position:sticky;top:0;padding:14px 16px;background:#a93c40;' +
        'display:flex;align-items:center;justify-content:space-between;' +
        'border-bottom:1px solid rgba(255,255,255,0.15);z-index:1;' +
      '}' +
      '.lp-title { font-size:15px;font-weight:600;color:white; }' +

      '#lp-recenter {' +
        'background:white;color:#a93c40;border:none;border-radius:6px;' +
        'padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap;font-weight:600;' +
      '}' +
      '#lp-recenter:hover { background:rgba(255,255,255,0.85); }' +

      '.lp-body { padding:16px;display:flex;flex-direction:column;gap:14px; }' +
      '.lp-row { display:flex;flex-direction:column;gap:3px; }' +
      '.lp-label { font-size:10px;text-transform:uppercase;letter-spacing:0.7px;color:rgba(169,60,64,0.5); }' +
      '.lp-value { color:#a93c40;word-break:break-word;line-height:1.4; }' +

      '.lp-badge {' +
        'display:inline-block;padding:2px 8px;border-radius:10px;' +
        'font-size:11px;font-weight:600;text-transform:capitalize;' +
      '}' +
      '.lp-sev-high   { background:#a93c40; color:white; }' +
      '.lp-sev-medium { background:rgba(169,60,64,0.15); color:#a93c40; }' +
      '.lp-sev-low    { background:rgba(169,60,64,0.07); color:rgba(169,60,64,0.65); }' +

      '.lp-images { display:flex;flex-wrap:wrap;gap:6px; }' +
      '.lp-img-thumb {' +
        'width:88px;height:88px;object-fit:cover;border-radius:6px;' +
        'display:block;transition:opacity 0.15s;border:1px solid rgba(169,60,64,0.2);' +
      '}' +
      '.lp-img-thumb:hover { opacity:0.8; }';

    document.head.appendChild(s);
  }

  Nav.IssueViewer = new IssueViewer();

})(window.Nav = window.Nav || {});
