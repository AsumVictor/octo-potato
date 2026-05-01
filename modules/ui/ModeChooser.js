// We built ModeChooser to handle two things: the modal that lets the user pick
// between Manual and Live GPS navigation, and the GPS detection flow that
// collects multiple position samples and places the user on the nearest node.
// We collect up to 15 s of samples and compute a weighted centroid rather than
// taking the first fix — this cancels out GPS jitter much better than picking
// the single best reading.
(function (Nav) {
  'use strict';

  var MAX_COLLECT_MS        = 15000;
  var EXCELLENT_ACCURACY_M  = 8;
  var MIN_GOOD_SAMPLES      = 3;
  var MAX_SAMPLE_ACCURACY_M = 50;
  var OUT_OF_AREA_M         = 200;

  function ModeChooser() {
    this._gpsWatchId = null;
    this._gpsTimeout = null;
    this._gpsSamples = [];
  }

  ModeChooser.prototype.open = function () {
    var el = document.getElementById('nav-mode-chooser');
    if (el) el.classList.add('active');
  };

  ModeChooser.prototype.close = function () {
    var el = document.getElementById('nav-mode-chooser');
    if (el) el.classList.remove('active');
  };

  ModeChooser.prototype.openDetection = function () {
    this._resetDetection();
    var modal = document.getElementById('nav-detection-modal');
    var card  = document.querySelector('.nav-detection-card');
    if (!modal || !card) return;

    // We rebuild the card HTML each time the modal opens in case a previous
    // detection left error state or a node picker in the card.
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

  ModeChooser.prototype._startGpsCollection = function () {
    var self = this;
    this._gpsSamples = [];

    if (!navigator.geolocation) {
      this._showDetectionError('Geolocation is not supported by your browser.');
      return;
    }

    this._setStatus('Acquiring GPS signal...');

    this._gpsWatchId = navigator.geolocation.watchPosition(
      function (pos) { self._onSample(pos); },
      function (err) { self._onGpsError(err); },
      {
        enableHighAccuracy: true,
        timeout:     10000,
        maximumAge:  0
      }
    );

    // We set a hard deadline so the user never waits forever — at 15 s we
    // finalise with whatever samples we have collected so far.
    this._gpsTimeout = setTimeout(function () {
      self._finalize();
    }, MAX_COLLECT_MS);
  };

  ModeChooser.prototype._onSample = function (pos) {
    var accuracy = pos.coords.accuracy > 0 ? pos.coords.accuracy : 999;

    if (accuracy <= MAX_SAMPLE_ACCURACY_M) {
      this._gpsSamples.push({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: accuracy
      });
    }

    var goodCount = this._gpsSamples.length;
    this._setStatus(
      'Acquiring GPS… (±' + Math.round(accuracy) + ' m' +
      (goodCount > 0 ? ', ' + goodCount + ' reading' + (goodCount !== 1 ? 's' : '') : '') + ')'
    );

    // We stop early when accuracy is excellent and we have enough samples so
    // the user doesn't have to wait the full 15 s when GPS is working well.
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
    var samples = this._gpsSamples.slice();
    this._resetDetection();

    if (samples.length === 0) {
      this._showDetectionError('No GPS reading received. Move to an open area and try again.');
      return;
    }

    this._setStatus('Locating you on the map…');

    // We weight each sample by 1/accuracy² so precise readings pull the result
    // much harder than noisy ones — this is much more robust than a simple mean.
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

  ModeChooser.prototype._resolvePosition = function (lat, lng, accuracy) {
    var all = findAllNodesSorted(lat, lng, Nav.AppState.nodes);

    if (all.length === 0) {
      this._showDetectionError('No mapped locations found. Check that nodes have GPS coordinates set in Pano2VR.');
      return;
    }

    var nearest = all[0];

    if (nearest.distance > OUT_OF_AREA_M) {
      this._showDetectionError(
        'You are not near any mapped location on campus. ' +
        '(nearest: ' + Math.round(nearest.distance) + ' m away)'
      );
      return;
    }

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

    // We seed LiveLocation before starting GPS tracking so the hysteresis
    // logic has a starting node and does not immediately switch away on the
    // first watchPosition reading due to GPS jitter.
    if (window.LiveLocation && LiveLocation.setCurrentNode) {
      LiveLocation.setCurrentNode(nodeId);
    }

    this.setMode('live');
    this.closeDetection();
    Nav.Toast.show('Live: placed at ' + node.title + ' (±' + Math.round(candidate.distance) + ' m)', 3000);
    setTimeout(function () { Nav.SearchPanel.open(); }, 400);
  };

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

  // We search all nodes with no radius cap so the nearest node is always
  // returned — the caller decides whether that distance is acceptable.
  function findAllNodesSorted(lat, lng, nodes) {
    var results = [];
    Object.keys(nodes).forEach(function (id) {
      var node = nodes[id];
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
