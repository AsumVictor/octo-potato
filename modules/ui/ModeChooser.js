/**
 * ModeChooser — handles the "choose navigation mode" popup and the GPS
 * detection flow that places the user on the map automatically.
 *
 * How GPS placement works (so you know why the numbers are what they are):
 *   1. watchPosition starts immediately — maximumAge:0 forces fresh readings.
 *   2. We collect up to 15 s of samples, but stop early if accuracy hits ≤8 m
 *      AND we have at least 3 good readings to average.
 *   3. Readings worse than 50 m are thrown away before averaging.
 *   4. We compute a weighted centroid: each reading's weight = 1/accuracy².
 *      Accurate readings pull the result much harder than noisy ones. This
 *      cancels out GPS jitter far better than just picking the single best fix.
 *   5. All nodes are searched (no radius cap) — we pick the nearest one.
 *   6. If the nearest node is >200 m away we tell the user they're out of range.
 *   7. The nearest node is always auto-selected — the user never sees a picker.
 */
(function (Nav) {
  'use strict';

  var MAX_COLLECT_MS        = 15000;  // max collection window (ms)
  var EXCELLENT_ACCURACY_M  = 8;      // stop early if this accurate AND enough samples
  var MIN_GOOD_SAMPLES      = 3;      // minimum samples needed to stop early
  var MAX_SAMPLE_ACCURACY_M = 50;     // discard readings worse than this before averaging
  var OUT_OF_AREA_M         = 200;    // nearest node must be within this

  function ModeChooser() {
    this._gpsWatchId  = null;
    this._gpsTimeout  = null;
    this._gpsSamples  = [];
  }

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
    this._resetDetection();
    var modal    = document.getElementById('nav-detection-modal');
    var card     = document.querySelector('.nav-detection-card');
    if (!modal || !card) return;

    // Restore default card layout (in case a picker was rendered before)
    card.innerHTML =
      '<div class="nav-detection-title">Detecting Location</div>' +
      '<div class="nav-detection-copy" id="nav-detection-status">Requesting location permission...</div>' +
      '<div class="nav-detection-spinner" id="nav-detection-spinner"></div>' +
      '<button id="nav-detection-close" class="nav-detection-close" type="button" style="display:none;">Close</button>';

    document.getElementById('nav-detection-close').addEventListener('click',
      this.closeDetection.bind(this));

    modal.classList.add('active');
    this._startGpsCollection();
  };

  ModeChooser.prototype.closeDetection = function () {
    this._resetDetection();
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

  // ── GPS collection ───────────────────────────────────────────────────────────

  ModeChooser.prototype._startGpsCollection = function () {
    var self = this;
    this._gpsSamples = [];

    if (!navigator.geolocation) {
      this._showDetectionError('Geolocation is not supported by your browser.');
      return;
    }

    this._setStatus('Acquiring GPS signal...');

    // Start watching immediately — first reading can come from cache but
    // subsequent ones will be from live satellite data
    this._gpsWatchId = navigator.geolocation.watchPosition(
      function (pos) { self._onSample(pos); },
      function (err) { self._onGpsError(err); },
      {
        enableHighAccuracy: true,
        timeout:     10000,
        maximumAge:  0       
      }
    );

    // Hard deadline — use best sample collected so far
    this._gpsTimeout = setTimeout(function () {
      self._finalize();
    }, MAX_COLLECT_MS);
  };

  ModeChooser.prototype._onSample = function (pos) {
    var accuracy = pos.coords.accuracy > 0 ? pos.coords.accuracy : 999;

    // Only keep readings good enough to be useful for averaging
    if (accuracy <= MAX_SAMPLE_ACCURACY_M) {
      this._gpsSamples.push({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: accuracy
      });
    }

    var goodCount = this._gpsSamples.length;
    this._setStatus(
      'Acquiring GPS\u2026 (\u00B1' + Math.round(accuracy) + '\u202fm' +
      (goodCount > 0 ? ', ' + goodCount + ' reading' + (goodCount !== 1 ? 's' : '') : '') + ')'
    );

    // Stop early only when accuracy is excellent AND we have enough samples to average
    if (accuracy <= EXCELLENT_ACCURACY_M && goodCount >= MIN_GOOD_SAMPLES) {
      this._finalize();
    }
  };

  ModeChooser.prototype._onGpsError = function (err) {
    this._resetDetection();
    var msg = 'Unable to get your location.';
    if (err.code === 1) msg = 'Location permission was denied. Please allow access in your browser settings.';
    else if (err.code === 2) msg = 'Location is currently unavailable. Check your GPS signal.';
    else if (err.code === 3) msg = 'Location request timed out. Move to an open area and try again.';
    this._showDetectionError(msg);
  };

  ModeChooser.prototype._finalize = function () {
    // Save samples BEFORE _resetDetection wipes them
    var samples = this._gpsSamples.slice();
    this._resetDetection();

    if (samples.length === 0) {
      this._showDetectionError('No GPS reading received. Move to an open area and try again.');
      return;
    }

    this._setStatus('Locating you on the map\u2026');

    // Weighted centroid: weight each sample by 1/accuracy²
    // Better readings (smaller accuracy circle) pull the result harder.
    // This cancels out GPS jitter far better than picking a single reading.
    var totalWeight = 0;
    var weightedLat = 0;
    var weightedLng = 0;
    var bestAccuracy = Infinity;

    samples.forEach(function (s) {
      var w = 1 / (s.accuracy * s.accuracy);
      totalWeight += w;
      weightedLat += s.lat * w;
      weightedLng += s.lng * w;
      if (s.accuracy < bestAccuracy) bestAccuracy = s.accuracy;
    });

    var lat = weightedLat / totalWeight;
    var lng = weightedLng / totalWeight;

    this._resolvePosition(lat, lng, bestAccuracy);
  };

  // ── Node resolution ──────────────────────────────────────────────────────────

  ModeChooser.prototype._resolvePosition = function (lat, lng, accuracy) {
    // Search ALL nodes — no radius cap — pick the single nearest one.
    var all = findAllNodesSorted(lat, lng, Nav.AppState.nodes);

    if (all.length === 0) {
      this._showDetectionError('No mapped locations found. Check that nodes have GPS coordinates set in Pano2VR.');
      return;
    }

    var nearest = all[0];

    if (nearest.distance > OUT_OF_AREA_M) {
      this._showDetectionError(
        'You are not near any mapped location on campus. ' +
        '(nearest: ' + Math.round(nearest.distance) + '\u202fm away)'
      );
      return;
    }

    // Always auto-select the nearest node — user never needs to choose their location.
    this._selectNode(nearest);
  };

  ModeChooser.prototype._selectNode = function (candidate) {
    var node   = candidate.node;
    var nodeId = candidate.nodeId;

    if (pano && pano.openNext) {
      pano.openNext('{' + nodeId + '}', {
        pan:  node.startPan  != null ? node.startPan  : 0,
        tilt: node.startTilt != null ? node.startTilt : 0,
        fov:  node.startFov  || 100
      });
    }

    // Seed LiveLocation with this node BEFORE starting GPS tracking so the
    // first watchPosition reading can't immediately jump to a different node.
    if (window.LiveLocation && LiveLocation.setCurrentNode) {
      LiveLocation.setCurrentNode(nodeId);
    }

    this.setMode('live');
    this.closeDetection();
    Nav.Toast.show('Live: placed at ' + node.title + ' (\u00B1' + Math.round(candidate.distance) + '\u202fm)', 3000);
    setTimeout(function () { Nav.SearchPanel.open(); }, 400);
  };

  // ── Private helpers ───────────────────────────────────────────────────────────

  ModeChooser.prototype._resetDetection = function () {
    if (this._gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this._gpsWatchId);
      this._gpsWatchId = null;
    }
    if (this._gpsTimeout !== null) {
      clearTimeout(this._gpsTimeout);
      this._gpsTimeout = null;
    }
    this._gpsSamples = [];
  };

  ModeChooser.prototype._setStatus = function (msg) {
    var el = document.getElementById('nav-detection-status');
    if (el) el.textContent = msg;
  };

  ModeChooser.prototype._showDetectionError = function (message) {
    var spinner  = document.getElementById('nav-detection-spinner');
    var closeBtn = document.getElementById('nav-detection-close');
    if (spinner)  spinner.style.display  = 'none';
    if (closeBtn) closeBtn.style.display = 'block';
    this._setStatus(message);
  };

  // ── Node search ───────────────────────────────────────────────────────────────

  /**
   * Returns ALL nodes with valid GPS coordinates, sorted nearest-first.
   * No radius cap — the caller decides what distance is acceptable.
   */
  function findAllNodesSorted(lat, lng, nodes) {
    var results = [];
    Object.keys(nodes).forEach(function (id) {
      var node = nodes[id];
      // Must have real numeric lat/lng (not null, undefined, or NaN)
      if (typeof node.lat !== 'number' || typeof node.lng !== 'number') return;
      if (isNaN(node.lat) || isNaN(node.lng)) return;
      var d = Nav.haversine(lat, lng, node.lat, node.lng);
      if (!isNaN(d)) results.push({ nodeId: id, node: node, distance: d });
    });
    results.sort(function (a, b) { return a.distance - b.distance; });
    return results;
  }

  Nav.ModeChooser = new ModeChooser();

})(window.Nav = window.Nav || {});
