/**
 * LiveController — Adapts window.LiveLocation to the Nav EventBus.
 * Pattern: Adapter (Singleton)
 * Bridges the existing LiveLocation module (live-location.js) into the
 * Nav architecture. All GPS events flow out as EventBus emissions so the
 * rest of the app doesn't hold a direct reference to window.LiveLocation.
 *
 * Events emitted:
 *   live:status(status)          – tracking status changed
 *   live:node-change(nodeId, node, distance)
 *   live:route-advance(nodeId, node, distance)
 *   live:error(err)
 */
(function (Nav) {
  'use strict';

  function LiveController() {}

  LiveController.prototype.init = function () {
    if (!window.LiveLocation) return;

    LiveLocation.init({
      nodes: Object.keys(Nav.AppState.nodes).map(function (id) {
        return Nav.AppState.nodes[id];
      }),
      onStatus: function (status) {
        Nav.AppState.liveStatus = status;
        Nav.EventBus.emit('live:status', status);
      },
      onNodeChange: function (nodeId, node, distance) {
        Nav.EventBus.emit('live:node-change', { nodeId: nodeId, node: node, distance: distance });
      },
      onRouteAdvance: function (nodeId, node, distance) {
        Nav.EventBus.emit('live:route-advance', { nodeId: nodeId, node: node, distance: distance });
      },
      onError: function (err) {
        Nav.EventBus.emit('live:error', err);
      }
    });
  };

  // ── Wire EventBus → LiveLocation responses ───────────────────────────────────

  LiveController.prototype.bindEvents = function () {
    // GPS found a new node while in live mode → teleport panorama
    Nav.EventBus.on('live:node-change', function (data) {
      if (Nav.AppState.navMode !== 'live') return;
      if (!data || !data.nodeId) return;
      if (pano.getCurrentNode() === data.nodeId) return;

      var node = data.node;
      pano.openNext('{' + data.nodeId + '}', {
        pan:  node.startPan  != null ? node.startPan  : 0,
        tilt: node.startTilt != null ? node.startTilt : 0,
        fov:  node.startFov  || 100
      });
      Nav.Toast.show('Live: moved to ' + node.title + ' (' + Math.round(data.distance) + 'm)', 2200);
    });

    // GPS auto-advanced a route step
    Nav.EventBus.on('live:route-advance', function (data) {
      if (!Nav.AppState.activeRoute) return;
      Nav.Navigator.handleNodeChange(data.nodeId);
    });

    // GPS status changed → update status label + show toasts
    Nav.EventBus.on('live:status', function (status) {
      var statusEl = document.getElementById('nav-mode-status');
      if (statusEl) {
        var labels = {
          watching:      'Tracking',
          searching:     'Searching GPS',
          tracking:      'Live tracking active',
          out_of_coverage: 'Out of coverage',
          denied:        'GPS denied',
          unavailable:   'GPS unavailable',
          unsupported:   'GPS unsupported',
          error:         'GPS error',
          stopped:       'Live GPS off'
        };
        statusEl.textContent = 'Live mode: ' + (labels[status] || status);
      }

      if (status === 'out_of_coverage') {
        Nav.Toast.show('You are out of coverage areas for live location.', 0);
      } else if (status === 'unsupported') {
        Nav.Toast.show('Live location requires HTTPS or localhost.', 0);
      } else if (status === 'unavailable') {
        Nav.Toast.show('GPS unavailable. Try moving to an open area.', 0);
      } else if (status === 'denied') {
        Nav.Toast.show('GPS permission denied. Please allow location access.', 0);
      } else if (status === 'error') {
        Nav.Toast.show('Live GPS error. Check browser location settings.', 0);
      }
    });

    // GPS error toast
    Nav.EventBus.on('live:error', function (err) {
      if (!err) return;
      Nav.Toast.show('GPS error: ' + (err.message || 'Unable to get location'), 3200);
    });

    // When navigation mode changes, sync LiveLocation
    Nav.EventBus.on('mode:change', function (mode) {
      if (mode === 'live') {
        if (window.LiveLocation && LiveLocation.setRoute && Nav.AppState.activeRoute) {
          LiveLocation.setRoute(Nav.AppState.activeRoute, Nav.AppState.stepIndex);
        }
      }
    });

    // Keep LiveLocation route in sync when navigation starts or reroutes
    Nav.EventBus.on('nav:started', function (route) {
      if (window.LiveLocation && LiveLocation.setRoute) {
        LiveLocation.setRoute(route, Nav.AppState.stepIndex);
      }
    });

    Nav.EventBus.on('nav:reroute', function (route) {
      if (window.LiveLocation && LiveLocation.setRoute) {
        LiveLocation.setRoute(route, Nav.AppState.stepIndex);
      }
    });

    Nav.EventBus.on('nav:cancel', function () {
      if (window.LiveLocation && LiveLocation.clearRoute) LiveLocation.clearRoute();
    });
  };

  Nav.LiveController = new LiveController();

})(window.Nav = window.Nav || {});
