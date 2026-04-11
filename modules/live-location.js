(function (window) {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────────
  var NODE_SELECT_RADIUS    = 120;  // metres — cast wide net; hysteresis prevents false switches
  var ROUTE_ADVANCE_RADIUS  = 20;   // metres — auto-advance route step
  var MAX_ACCEPTABLE_ACCURACY = 40; // metres — ignore readings worse than this
  var NODE_CHANGE_MARGIN    = 8;    // metres — new node must be this much closer to trigger change
  var CONFIRM_COUNT         = 2;    // consecutive readings confirming new node before switching

  // ── State ────────────────────────────────────────────────────────────────────
  var watchId           = null;
  var liveNodeId        = null;
  var liveNodeDistance  = Infinity;
  var liveStatus        = 'stopped';
  var routeState        = null;
  var outOfCoverageTimer = null;

  // Hysteresis: track a candidate node before committing to it
  var candidateNodeId   = null;
  var candidateCount    = 0;

  var options = {
    nodes:    [],
    allNodes: [],
    callbacks: {
      onStatus:       function () {},
      onNodeChange:   function () {},
      onRouteAdvance: function () {},
      onPosition:     function () {},
      onError:        function () {}
    }
  };

  // ── Public API ───────────────────────────────────────────────────────────────

  function init(opts) {
    opts = opts || {};
    options.allNodes = opts.nodes || [];
    options.nodes    = options.allNodes.filter(function (n) {
      return typeof n.lat === 'number' && typeof n.lng === 'number';
    });

    options.callbacks.onStatus       = opts.onStatus       || options.callbacks.onStatus;
    options.callbacks.onNodeChange   = opts.onNodeChange   || options.callbacks.onNodeChange;
    options.callbacks.onRouteAdvance = opts.onRouteAdvance || options.callbacks.onRouteAdvance;
    options.callbacks.onPosition     = opts.onPosition     || options.callbacks.onPosition;
    options.callbacks.onError        = opts.onError        || options.callbacks.onError;

    liveNodeId       = null;
    liveNodeDistance = Infinity;
    candidateNodeId  = null;
    candidateCount   = 0;
    routeState       = null;
    setStatus('stopped');
  }

  function isSupported() {
    return typeof navigator !== 'undefined' &&
           typeof navigator.geolocation !== 'undefined';
  }

  function start() {
    if (!isSupported()) {
      setStatus('unsupported');
      options.callbacks.onError(new Error('Geolocation not supported'));
      return;
    }
    if (watchId !== null) return;

    liveNodeId       = null;
    liveNodeDistance = Infinity;
    candidateNodeId  = null;
    candidateCount   = 0;
    setStatus('watching');

    outOfCoverageTimer = setTimeout(function () {
      if (liveStatus === 'watching' || liveStatus === 'searching') {
        setStatus('out_of_coverage');
      }
    }, 12000);

    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        maximumAge:  0,       // never accept cached readings
        timeout:     10000
      }
    );
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (outOfCoverageTimer !== null) {
      clearTimeout(outOfCoverageTimer);
      outOfCoverageTimer = null;
    }
    liveNodeId       = null;
    liveNodeDistance = Infinity;
    candidateNodeId  = null;
    candidateCount   = 0;
    setStatus('stopped');
  }

  // ── Position handling ────────────────────────────────────────────────────────

  function handlePosition(position) {
    if (!position || !position.coords) return;

    var lat      = position.coords.latitude;
    var lng      = position.coords.longitude;
    var accuracy = position.coords.accuracy > 0 ? position.coords.accuracy : 0;

    options.callbacks.onPosition({
      lat:      lat,
      lng:      lng,
      accuracy: accuracy,
      timestamp: position.timestamp || Date.now(),
      nodeId:   liveNodeId,
      distance: liveNodeDistance
    });

    if (options.nodes.length === 0) { setStatus('no_nodes'); return; }

    // Reject readings that are too inaccurate to be useful
    if (accuracy > MAX_ACCEPTABLE_ACCURACY) {
      setStatus('searching');
      return;
    }

    // Find all nodes within search radius, sorted nearest-first
    var candidates = sortedCandidates(lat, lng, NODE_SELECT_RADIUS);

    if (candidates.length === 0) {
      setStatus('searching');
      // Reset candidate state
      candidateNodeId = null;
      candidateCount  = 0;
      return;
    }

    setStatus('tracking');
    if (outOfCoverageTimer !== null) {
      clearTimeout(outOfCoverageTimer);
      outOfCoverageTimer = null;
    }

    var best = candidates[0];

    // ── Hysteresis: avoid jitter between adjacent nodes ───────────────────────
    // Only switch the active node when:
    //   a) we have no current node, OR
    //   b) the new best is >= NODE_CHANGE_MARGIN closer than the current node
    //      AND it has appeared as the best candidate for >= CONFIRM_COUNT readings

    var shouldSwitch = false;

    if (liveNodeId === null) {
      // No current node — accept immediately
      shouldSwitch = true;
    } else if (best.nodeId !== liveNodeId) {
      var currentDist = haversine(lat, lng,
        getNodeById(liveNodeId) ? getNodeById(liveNodeId).lat : Infinity,
        getNodeById(liveNodeId) ? getNodeById(liveNodeId).lng : Infinity
      );
      var isClearlyCloer = (currentDist - best.distance) >= NODE_CHANGE_MARGIN;

      if (best.nodeId === candidateNodeId) {
        candidateCount++;
      } else {
        candidateNodeId = best.nodeId;
        candidateCount  = 1;
      }

      shouldSwitch = isClearlyCloer && (candidateCount >= CONFIRM_COUNT);
    } else {
      // Still on the same node — update distance, reset candidate
      liveNodeDistance = best.distance;
      candidateNodeId  = null;
      candidateCount   = 0;
    }

    if (shouldSwitch) {
      liveNodeId       = best.nodeId;
      liveNodeDistance = best.distance;
      candidateNodeId  = null;
      candidateCount   = 0;
      options.callbacks.onNodeChange(liveNodeId, best.node, best.distance);
    }

    // ── Route auto-advance ───────────────────────────────────────────────────
    if (routeState && routeState.path &&
        routeState.stepIndex < routeState.path.length - 1) {
      var nextStep = routeState.path[routeState.stepIndex + 1];
      if (nextStep && nextStep.nodeId) {
        var nextNode = getNodeById(nextStep.nodeId);
        if (nextNode) {
          var nextDist = haversine(lat, lng, nextNode.lat, nextNode.lng);
          if (nextDist <= ROUTE_ADVANCE_RADIUS) {
            routeState.stepIndex++;
            options.callbacks.onRouteAdvance(nextStep.nodeId, nextNode, nextDist);
          }
        }
      }
    }
  }

  function handleError(err) {
    options.callbacks.onError(err);
    if (err && err.code === 1)      setStatus('denied');
    else if (err && err.code === 2) setStatus('unavailable');
    else                            setStatus('error');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Returns all nodes within maxRadius sorted nearest-first.
   */
  function sortedCandidates(lat, lng, maxRadius) {
    var results = [];
    options.nodes.forEach(function (node) {
      if (node.lat == null || node.lng == null) return;
      var d = haversine(lat, lng, node.lat, node.lng);
      if (d <= maxRadius) results.push({ nodeId: node.id, node: node, distance: d });
    });
    results.sort(function (a, b) { return a.distance - b.distance; });
    return results;
  }

  function getNodeById(nodeId) {
    for (var i = 0; i < options.allNodes.length; i++) {
      if (options.allNodes[i].id === nodeId) return options.allNodes[i];
    }
    return null;
  }

  function setStatus(text) {
    if (liveStatus === text) return;
    liveStatus = text;
    options.callbacks.onStatus(text);
  }

  function setRoute(route, stepIndex) {
    if (!route || !route.path) { routeState = null; return; }
    routeState = {
      path:      route.path.slice(),
      stepIndex: typeof stepIndex === 'number' ? stepIndex : 0
    };
  }

  function clearRoute() { routeState = null; }

  function getLiveNodeId() { return liveNodeId; }

  /**
   * Seed the current node from external placement (e.g. GPS detection modal).
   * Prevents the first watchPosition reading from immediately jumping to a
   * different node due to GPS jitter — hysteresis will apply from the start.
   */
  function setCurrentNode(nodeId) {
    liveNodeId       = nodeId;
    liveNodeDistance = 0;
    candidateNodeId  = null;
    candidateCount   = 0;
  }

  function isActive() { return watchId !== null; }

  function haversine(lat1, lon1, lat2, lon2) {
    var rad  = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
               Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  window.LiveLocation = {
    init:           init,
    start:          start,
    stop:           stop,
    setRoute:       setRoute,
    clearRoute:     clearRoute,
    setCurrentNode: setCurrentNode,
    getLiveNodeId:  getLiveNodeId,
    isActive:       isActive,
    isSupported:    isSupported,
    getStatus:      function () { return liveStatus; }
  };

})(window);
