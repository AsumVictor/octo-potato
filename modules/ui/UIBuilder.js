// We put all DOM construction in UIBuilder so HTML is created exactly once at
// init time and every module can assume its elements exist after build() returns.
// We also thought about using innerHTML on a template string but building
// elements programmatically avoids any XSS risk from node titles or categories.
(function (Nav) {
  'use strict';

  function UIBuilder() {}

  UIBuilder.prototype.build = function () {
    var container   = document.getElementById('container');
    var overlayRoot = document.body || document.documentElement || container;

    // ── Nav trigger button ────────────────────────────────────────────────────
    var btn   = document.createElement('button');
    btn.id    = 'nav-open-btn';
    btn.title = 'Navigate to a location';
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
    btn.addEventListener('click', function () { Nav.ModeChooser.open(); });
    container.appendChild(btn);

    // ── Report button ─────────────────────────────────────────────────────────
    var reportBtn   = document.createElement('button');
    reportBtn.id    = 'nav-report-btn';
    reportBtn.title = 'Report an issue';
    reportBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>' +
      '<line x1="4" y1="22" x2="4" y2="15"/>' +
      '</svg>';
    reportBtn.addEventListener('click', function () { Nav.ReportTool.startDraw(); });
    container.appendChild(reportBtn);

    // ── Drawing canvas (hidden until report mode active) ──────────────────────
    var drawCanvas    = document.createElement('canvas');
    drawCanvas.id     = 'report-draw-canvas';
    drawCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;z-index:450;touch-action:none;';
    container.appendChild(drawCanvas);

    // ── Report dialog ─────────────────────────────────────────────────────────
    // We use Nav.AppState.issueTypes (fetched from DB at boot) so the dropdown
    // reflects whatever is in Supabase. Nav.IssueTypes is the offline fallback.
    var issueOpts = '<option value="">-- Select a type --</option>';
    (Nav.AppState.issueTypes || Nav.IssueTypes || []).forEach(function (t) {
      issueOpts += '<option value="' + (t.uuid || t.id) + '">' + (t.label || t.name) + '</option>';
    });

    var reportDlg = document.createElement('div');
    reportDlg.id  = 'report-dialog-overlay';
    reportDlg.innerHTML =
      '<div class="report-dialog-card">' +
        '<div class="report-dialog-header">' +
          '<span class="report-dialog-title">Report an Issue</span>' +
          '<button id="report-dialog-close" class="report-dialog-close" type="button">&#x2715;</button>' +
        '</div>' +
        '<div class="report-dialog-body">' +
          '<label class="report-label" for="report-name">Name <span class="report-required">*</span></label>' +
          '<input  class="report-input" id="report-name"  type="text"  placeholder="Your name" autocomplete="name"/>' +

          '<label class="report-label" for="report-email">Email <span class="report-required">*</span></label>' +
          '<input  class="report-input" id="report-email" type="email" placeholder="your@email.com" autocomplete="email"/>' +

          '<label class="report-label" for="report-issue-type">Type of Issue <span class="report-required">*</span></label>' +
          '<select class="report-input report-select" id="report-issue-type">' + issueOpts + '</select>' +

          '<label class="report-label" for="report-description">Description <span class="report-required">*</span></label>' +
          '<textarea class="report-input report-textarea" id="report-description" placeholder="Describe the issue…" rows="3"></textarea>' +

          '<label class="report-label" for="report-pictures">Pictures <span class="report-optional">(optional)</span></label>' +
          '<input  class="report-input report-file" id="report-pictures" type="file" accept="image/*" multiple/>' +
          '<div id="report-pic-preview" class="report-pic-preview"></div>' +
        '</div>' +
        '<div class="report-dialog-footer">' +
          '<button id="report-cancel-btn" class="report-btn report-btn-cancel" type="button">Cancel</button>' +
          '<button id="report-send-btn"   class="report-btn report-btn-send"   type="button">Send Report</button>' +
        '</div>' +
      '</div>';
    overlayRoot.appendChild(reportDlg);

    // ── Report success popup ──────────────────────────────────────────────────
    var successPop = document.createElement('div');
    successPop.id  = 'report-success-popup';
    successPop.innerHTML =
      '<div class="report-success-icon">✓</div>' +
      '<div class="report-success-title">Report Submitted</div>' +
      '<div class="report-success-sub">Thank you! Your report has been received.</div>' +
      '<div class="report-success-bar"><div id="report-success-bar-fill"></div></div>';
    overlayRoot.appendChild(successPop);

    // ── Gyroscope toggle button ───────────────────────────────────────────────
    if (Nav.Gyroscope && Nav.Gyroscope.isSupported()) {
      var gyroBtn   = document.createElement('button');
      gyroBtn.id    = 'nav-gyro-btn';
      gyroBtn.title = 'Use gyroscope to look around';
      // Simple compass/rotation icon
      gyroBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<polyline points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>' +
        '</svg>';
      gyroBtn.addEventListener('click', function () {
        if (Nav.Gyroscope) Nav.Gyroscope.toggle();
      });
      container.appendChild(gyroBtn);
    }

    // ── Mode chooser ──────────────────────────────────────────────────────────
    var chooser = document.createElement('div');
    chooser.id  = 'nav-mode-chooser';
    chooser.innerHTML =
      '<div class="nav-mode-chooser-card">' +
        '<div class="nav-mode-chooser-title">Choose navigation mode</div>' +
        '<div class="nav-mode-chooser-copy">Use live GPS to map your current location or browse manually from the current panorama.</div>' +
        '<div class="nav-mode-chooser-buttons">' +
          '<button id="nav-chooser-live"   type="button" class="nav-mode-chooser-btn nav-mode-live-btn">Live location</button>' +
          '<button id="nav-chooser-manual" type="button" class="nav-mode-chooser-btn nav-mode-manual-btn">Manual mode</button>' +
        '</div>' +
        '<button id="nav-chooser-cancel" class="nav-mode-chooser-close" type="button">Cancel</button>' +
      '</div>';
    overlayRoot.appendChild(chooser);

    // ── Detection modal ───────────────────────────────────────────────────────
    var detection = document.createElement('div');
    detection.id  = 'nav-detection-modal';
    detection.innerHTML =
      '<div class="nav-detection-card">' +
        '<div class="nav-detection-title">Detecting Location</div>' +
        '<div class="nav-detection-copy" id="nav-detection-status">Requesting location permission...</div>' +
        '<div class="nav-detection-spinner"></div>' +
        '<button id="nav-detection-close" class="nav-detection-close" type="button" style="display:none;">Close</button>' +
      '</div>';
    overlayRoot.appendChild(detection);

    // ── Search panel ──────────────────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id  = 'nav-search-panel';
    panel.innerHTML =
      '<div class="nav-search-header">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a93c40" stroke-width="2.5">' +
          '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>' +
        '</svg>' +
        '<input id="nav-search-input" type="text" placeholder="Where do you want to go?" autocomplete="off"/>' +
        '<button id="nav-search-close" title="Close">&#x2715;</button>' +
      '</div>' +
      '<div class="nav-mode-toggle">' +
        '<button id="nav-mode-manual" class="nav-mode-button active" type="button">Manual</button>' +
        '<button id="nav-mode-live"   class="nav-mode-button"        type="button">Live</button>' +
      '</div>' +
      '<div id="nav-mode-status" class="nav-mode-status">Live mode: off</div>' +
      '<ul id="nav-search-results"></ul>';
    overlayRoot.appendChild(panel);

    // ── HUD ───────────────────────────────────────────────────────────────────
    var hud = document.createElement('div');
    hud.id  = 'nav-hud';
    hud.innerHTML =
      '<div class="nav-hud-top">' +
        '<div class="nav-hud-label">Navigating to</div>' +
        '<button id="nav-hud-cancel" title="Cancel navigation">&#x2715;</button>' +
      '</div>' +
      '<div id="nav-hud-dest"></div>' +
      '<div class="nav-hud-bottom">' +
        '<span id="nav-hud-dist"></span>' +
        '<span id="nav-hud-dots"></span>' +
      '</div>';
    overlayRoot.appendChild(hud);

    // ── Event bindings ────────────────────────────────────────────────────────
    document.getElementById('nav-search-input').addEventListener('input', function () {
      Nav.SearchPanel.onInput(this.value);
    });
    document.getElementById('nav-search-close').addEventListener('click', function () {
      Nav.SearchPanel.close();
    });
    document.getElementById('nav-mode-manual').addEventListener('click', function () {
      Nav.ModeChooser.setMode('manual');
    });
    document.getElementById('nav-mode-live').addEventListener('click', function () {
      Nav.ModeChooser.openDetection();
    });
    document.getElementById('nav-chooser-live').addEventListener('click', function () {
      Nav.ModeChooser.close();
      Nav.ModeChooser.openDetection();
    });
    document.getElementById('nav-chooser-manual').addEventListener('click', function () {
      Nav.ModeChooser.close();
      Nav.ModeChooser.setMode('manual');
      requestAnimationFrame(function () { Nav.SearchPanel.open(); });
    });
    document.getElementById('nav-chooser-cancel').addEventListener('click', function () {
      Nav.ModeChooser.close();
    });
    document.getElementById('nav-detection-close').addEventListener('click', function () {
      Nav.ModeChooser.closeDetection();
    });
    document.getElementById('nav-hud-cancel').addEventListener('click', function () {
      Nav.Navigator.cancel();
    });

    // ── Report dialog events ──────────────────────────────────────────────────
    document.getElementById('report-dialog-close').addEventListener('click', function () {
      Nav.ReportTool.closeDialog();
    });
    document.getElementById('report-cancel-btn').addEventListener('click', function () {
      Nav.ReportTool.closeDialog();
    });
    document.getElementById('report-send-btn').addEventListener('click', function () {
      Nav.ReportTool.submitReport();
    });
    document.getElementById('report-pictures').addEventListener('change', function () {
      var preview = document.getElementById('report-pic-preview');
      if (!preview) return;
      preview.innerHTML = '';
      Array.from(this.files).slice(0, 5).forEach(function (f) {
        var reader = new FileReader();
        reader.onload = function (ev) {
          var img = document.createElement('img');
          img.src = ev.target.result;
          img.className = 'report-pic-thumb';
          preview.appendChild(img);
        };
        reader.readAsDataURL(f);
      });
    });
    // Close dialog on backdrop click
    document.getElementById('report-dialog-overlay').addEventListener('click', function (e) {
      if (e.target === this) Nav.ReportTool.closeDialog();
    });

    // Initialise ReportTool (binds canvas events)
    Nav.ReportTool.init();

    // Close search panel on outside click
    document.addEventListener('click', function (e) {
      var p         = document.getElementById('nav-search-panel');
      var openBtn   = document.getElementById('nav-open-btn');
      var chooserEl = document.getElementById('nav-mode-chooser');
      var detEl     = document.getElementById('nav-detection-modal');
      if (p && p.classList.contains('open') &&
          !(p.contains(e.target))         &&
          !(openBtn   && openBtn.contains(e.target))   &&
          !(chooserEl && chooserEl.contains(e.target)) &&
          !(detEl     && detEl.contains(e.target))) {
        Nav.SearchPanel.close();
      }
    });
  };

  Nav.UIBuilder = new UIBuilder();

})(window.Nav = window.Nav || {});
