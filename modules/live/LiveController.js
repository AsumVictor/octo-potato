// We added LiveController to bridge between live-location.js (which uses plain
// callbacks) and the rest of Nav (which communicates through EventBus).
// We also thought about putting these listeners directly in App.js but separating
// them here keeps App.js focused on boot sequencing rather than event wiring.
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

  LiveController.prototype.bindEvents = function () {
    // We listen for GPS node changes and jump the panorama to the new node only
    // when in live mode — in manual mode the user controls which node is shown.
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

    // We do NOT call Navigator.handleNodeChange() here — pano.openNext() fires
    // the Pano2VR 'changenode' event which App.js already routes to Navigator,
    // so calling it again here would double-advance the step counter.
    Nav.EventBus.on('live:route-advance', function (data) {
      if (!Nav.AppState.activeRoute) return;
      if (!data || !data.nodeId) return;
      if (pano.getCurrentNode() === data.nodeId) return;

      var node = data.node;
      pano.openNext('{' + data.nodeId + '}', {
        pan:  node.startPan  != null ? node.startPan  : 0,
        tilt: node.startTilt != null ? node.startTilt : 0,
        fov:  node.startFov  || 100
      });
    });

    Nav.EventBus.on('live:status', function (status) {
      var statusEl = document.getElementById('nav-mode-status');
      if (statusEl) {
        var labels = {
          watching:        'Tracking',
          searching:       'Searching GPS',
          tracking:        'Live tracking active',
          out_of_coverage: 'Out of coverage',
          denied:          'GPS denied',
          unavailable:     'GPS unavailable',
          unsupported:     'GPS unsupported',
          error:           'GPS error',
          stopped:         'Live GPS off'
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

    Nav.EventBus.on('live:error', function (err) {
      if (!err) return;
      Nav.Toast.show('GPS error: ' + (err.message || 'Unable to get location'), 3200);
    });

    Nav.EventBus.on('mode:change', function (mode) {
      if (mode === 'live') {
        if (window.LiveLocation && LiveLocation.setRoute && Nav.AppState.activeRoute) {
          LiveLocation.setRoute(Nav.AppState.activeRoute, Nav.AppState.stepIndex);
        }
      }
    });

    // We keep LiveLocation's internal route state in sync with Navigator's so
    // the GPS auto-advance always knows which step we are on.
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
