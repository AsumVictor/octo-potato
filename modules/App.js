/**
 * App — Bootstrap Facade (Singleton).
 * Pattern: Facade
 * Single entry point that initialises every module in the correct order.
 * All inter-module wiring happens here so individual modules stay decoupled.
 *
 * Boot sequence:
 *   1. DOM ready → create loading overlay
 *   2. Wait for pano2vr player
 *   3. Player fires 'configloaded' → start init
 *   4. Load pano.xml
 *   5. Parse nodes + build graph + build search index
 *   6. Inject styles + HTML + canvas overlay
 *   7. Bind player events
 *   8. Init LiveLocation module
 *   9. Parallel: wait for panorama ready + preload images
 *  10. Show nav button → ready
 */
(function (Nav) {
  'use strict';

  function App() {}

  App.prototype.boot = function () {
    Nav.LoadingOverlay.create();
    Nav.LoadingOverlay.show('Waiting for panorama player...');
    waitForPlayer(function () {
      pano.addListener('configloaded', function () {
        Nav.App._init();
      });
    });
  };

  App.prototype._init = function () {
    Nav.LoadingOverlay.show('Loading tour data...');

    Nav.XmlLoader.load('pano.xml')
      .then(function (doc) {
        // Parse data
        var nodes = Nav.NodeParser.parse(doc);
        Nav.AppState.nodes = nodes;
        Nav.AppState.graph = Nav.GraphBuilder.build(nodes);

        var conn = Nav.GraphBuilder.checkConnectivity(Nav.AppState.graph);
        if (conn.isolated.length) {
          console.warn('[App] ' + conn.isolated.length + ' isolated nodes:', conn.isolated);
        }

        // Build search index
        Nav.SearchPanel.buildIndex();

        // Inject UI
        Nav.StyleInjector.inject();
        Nav.UIBuilder.build();
        Nav.LoadingOverlay.create();   // ensure overlay el exists after UIBuilder
        Nav.Renderer.init();

        // Bind player events
        Nav.App._bindPlayerEvents();

        // Wire EventBus → modules
        Nav.App._wireEvents();

        // Init live location
        Nav.LiveController.init();
        Nav.LiveController.bindEvents();

        // Wait for panorama + preload images in parallel
        Nav.LoadingOverlay.setMessage('Preloading images...');
        Promise.all([
          waitForPanoReady(),
          Nav.Preloader.preload(doc, function (loaded, total) {
            Nav.LoadingOverlay.setMessage('Preloading images ' + loaded + '/' + total);
          })
        ]).then(function () {
          Nav.AppState.navReady = true;
          Nav.LoadingOverlay.hide();
        });
      })
      .catch(function (err) {
        console.error('[App] Failed to load pano.xml:', err);
        Nav.LoadingOverlay.setMessage('Failed to load tour data. ' + (err && err.message ? err.message : ''));
      });
  };

  // ── Player event binding ─────────────────────────────────────────────────────

  App.prototype._bindPlayerEvents = function () {
    if (!pano || typeof pano.addListener !== 'function') return;

    pano.addListener('changenode', function () {
      if (!Nav.AppState.navActive || !Nav.AppState.activeRoute) return;
      var newId = pano.getCurrentNode();
      // In live mode the GPS drives navigation — suppress off-route prompts
      // unless the user manually clicked a hotspot (handled by reroute toast).
      Nav.Navigator.handleNodeChange(newId);
    });

    // Reset idle timer on user interaction
    var container = document.getElementById('container');
    if (!container) return;
    ['mousedown', 'touchstart', 'mousemove'].forEach(function (evt) {
      container.addEventListener(evt, function () {
        var state = Nav.AppState;
        if (!state.navActive || !state.activeRoute || !state.autoRotateDone) return;
        var next = state.activeRoute.path[state.stepIndex + 1];
        if (next) Nav.AutoRotator.resetIdleTimer(next.pan, next.tilt);
      }, { passive: true });
    });
  };

  // ── EventBus wiring ──────────────────────────────────────────────────────────

  App.prototype._wireEvents = function () {
    // Search result clicked → start navigation
    Nav.EventBus.on('nav:start', function (destId) {
      Nav.Navigator.start(destId);
    });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function waitForPlayer(cb) {
    if (window.pano) { cb(); return; }
    setTimeout(function () { waitForPlayer(cb); }, 50);
  }

  function waitForPanoReady() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      setTimeout(finish, 1800);
      if (pano && typeof pano.addListener === 'function') {
        pano.addListener('changenode', finish);
      }
    });
  }

  Nav.App = new App();

})(window.Nav = window.Nav || {});
