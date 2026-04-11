/**
 * ModeChooser — Mode chooser modal + live-location detection modal.
 * Pattern: Singleton
 * Handles the chooser overlay, detection flow (one-shot GPS), and nav mode toggle.
 */
(function (Nav) {
  'use strict';

  function ModeChooser() {}

  // ── Chooser modal ────────────────────────────────────────────────────────────

  ModeChooser.prototype.open = function () {
    var el = document.getElementById('nav-mode-chooser');
    if (el) el.classList.add('active');
  };

  ModeChooser.prototype.close = function () {
    var el = document.getElementById('nav-mode-chooser');
    if (el) el.classList.remove('active');
  };

  // ── Detection modal ──────────────────────────────────────────────────────────

  ModeChooser.prototype.openDetection = function () {
    var modal    = document.getElementById('nav-detection-modal');
    var statusEl = document.getElementById('nav-detection-status');
    var closeBtn = document.getElementById('nav-detection-close');
    if (!modal) return;
    if (statusEl) statusEl.textContent = 'Requesting location permission...';
    if (closeBtn) closeBtn.style.display = 'none';
    modal.classList.add('active');
    this._detectLocation();
  };

  ModeChooser.prototype.closeDetection = function () {
    var modal = document.getElementById('nav-detection-modal');
    if (modal) modal.classList.remove('active');
  };

  // ── Navigation mode toggle ───────────────────────────────────────────────────

  ModeChooser.prototype.setMode = function (mode) {
    if (mode !== 'manual' && mode !== 'live') return;
    var state = Nav.AppState;
    if (state.navMode === mode) return;
    state.navMode = mode;

    var manualBtn = document.getElementById('nav-mode-manual');
    var liveBtn   = document.getElementById('nav-mode-live');
    if (manualBtn) manualBtn.classList.toggle('active', mode === 'manual');
    if (liveBtn)   liveBtn.classList.toggle('active',   mode === 'live');

    if (mode === 'live') {
      if (!window.LiveLocation || !LiveLocation.isSupported()) {
        Nav.EventBus.emit('live:status', 'unsupported');
        Nav.Toast.show('Live GPS is not supported in this browser/environment.', 3200);
      } else {
        LiveLocation.start();
      }
    } else {
      if (window.LiveLocation) LiveLocation.stop();
    }

    Nav.EventBus.emit('mode:change', mode);
    Nav.Toast.show('Navigation mode: ' + (mode === 'live' ? 'Live GPS' : 'Manual'), 2200);
  };

  // ── Private: one-shot GPS detection ─────────────────────────────────────────

  ModeChooser.prototype._detectLocation = function () {
    var self = this;

    if (!navigator.geolocation) {
      this._showDetectionError('Geolocation is not supported by your browser.');
      return;
    }

    var statusEl = document.getElementById('nav-detection-status');
    if (statusEl) statusEl.textContent = 'Detecting your location...';

    navigator.geolocation.getCurrentPosition(
      function (position) {
        var lat      = position.coords.latitude;
        var lng      = position.coords.longitude;
        var accuracy = (position.coords.accuracy > 0) ? position.coords.accuracy : 0;
        var state    = Nav.AppState;

        var closest = findClosestNode(lat, lng, state.nodes);
        var inRange = closest &&
                      closest.distance <= state.NODE_SELECT_RADIUS &&
                      (accuracy === 0 ||
                       accuracy <= state.MAX_ACCEPTABLE_ACCURACY ||
                       closest.distance <= accuracy * 1.5 + 10);

        if (inRange) {
          var node   = closest.node;
          var nodeId = closest.nodeId;

          if (pano && pano.openNext) {
            pano.openNext('{' + nodeId + '}', {
              pan:  node.startPan  != null ? node.startPan  : 0,
              tilt: node.startTilt != null ? node.startTilt : 0,
              fov:  node.startFov  || 100
            });
          }

          self.setMode('live');
          self.closeDetection();
          Nav.Toast.show('Live: placed at ' + node.title, 2500);
          setTimeout(function () { Nav.SearchPanel.open(); }, 400);
        } else {
          var msg = 'You are not near any mapped location on campus.';
          if (closest) msg += ' (nearest is ' + Math.round(closest.distance) + 'm away)';
          self._showDetectionError(msg);
        }
      },
      function (error) {
        var msg = 'Unable to get your location.';
        if (error.code === 1) msg = 'Location permission was denied. Please allow access in your browser settings.';
        else if (error.code === 2) msg = 'Location is currently unavailable. Check your GPS signal.';
        else if (error.code === 3) msg = 'Location request timed out. Move to an open area and try again.';
        self._showDetectionError(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  ModeChooser.prototype._showDetectionError = function (message) {
    var statusEl = document.getElementById('nav-detection-status');
    var closeBtn = document.getElementById('nav-detection-close');
    if (statusEl) statusEl.textContent = message;
    if (closeBtn) closeBtn.style.display = 'block';
  };

  // ── Utility ──────────────────────────────────────────────────────────────────

  function findClosestNode(lat, lng, nodes) {
    var best = null;
    Object.keys(nodes).forEach(function (id) {
      var node = nodes[id];
      if (node.lat == null || node.lng == null) return;
      var d = Nav.haversine(lat, lng, node.lat, node.lng);
      if (!best || d < best.distance) best = { nodeId: id, node: node, distance: d };
    });
    return best;
  }

  Nav.ModeChooser = new ModeChooser();

})(window.Nav = window.Nav || {});
