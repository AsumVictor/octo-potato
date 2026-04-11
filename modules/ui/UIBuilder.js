/**
 * UIBuilder — Injects all navigation HTML into the DOM and binds events.
 * Pattern: Builder (constructs UI declaratively, wires all event handlers)
 * Called once during App.init(). After this, each module owns its own DOM.
 */
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
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4FB5C2" stroke-width="2.5">' +
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
