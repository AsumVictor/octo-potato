// We wrote LiveLocation as a self-contained GPS tracker that has no dependency
// on the Nav namespace so it can be tested and used independently.
// We also thought about putting this logic inside LiveController but decided
// to keep it standalone so it is easier to unit test without a full app context.
(function (window) {
  'use strict';

  var NODE_SELECT_RADIUS      = 120;
  var ROUTE_ADVANCE_RADIUS    = 20;
  var MAX_ACCEPTABLE_ACCURACY = 40;
  var NODE_CHANGE_MARGIN      = 8;
  var CONFIRM_COUNT           = 2;

  var watchId            = null;
  var liveNodeId         = null;
  var liveNodeDistance   = Infinity;
  var liveStatus         = 'stopped';
  var routeState         = null;
  var outOfCoverageTimer = null;

  // We added hysteresis (candidateNodeId + candidateCount) to prevent the
  // active node from flickering between two adjacent nodes when the user is
  // standing near the boundary — the new node must be consistently closest
  // for CONFIRM_COUNT consecutive readings before we commit to it.
  var candidateNodeId = null;
  var candidateCount  = 0;

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

    // We start an out-of-coverage timer so the user gets feedback if GPS
    // acquires a fix but no campus nodes are within range after 12 s.
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
        maximumAge:  0,
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

  function handlePosition(position) {
    if (!position || !position.coords) return;

    var lat      = position.coords.latitude;
    var lng      = position.coords.longitude;
    var accuracy = position.coords.accuracy > 0 ? position.coords.accuracy : 0;

    options.callbacks.onPosition({
      lat:       lat,
      lng:       lng,
      accuracy:  accuracy,
      timestamp: position.timestamp || Date.now(),
      nodeId:    liveNodeId,
      distance:  liveNodeDistance
    });

    if (options.nodes.length === 0) { setStatus('no_nodes'); return; }

    // We reject readings worse than MAX_ACCEPTABLE_ACCURACY because a 40 m+
    // accuracy circle covers multiple nodes and makes selection unreliable.
    if (accuracy > MAX_ACCEPTABLE_ACCURACY) {
      setStatus('searching');
      return;
    }

    var candidates = sortedCandidates(lat, lng, NODE_SELECT_RADIUS);

    if (candidates.length === 0) {
      setStatus('searching');
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

    var shouldSwitch = false;

    if (liveNodeId === null) {
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

    // We auto-advance the route step when the user's GPS position comes within
    // ROUTE_ADVANCE_RADIUS of the next node — this is the live-mode equivalent
    // of the Pano2VR 'changenode' event in manual mode.
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

  // We added setCurrentNode so the detection modal can seed the initial node
  // from the GPS placement result before starting live tracking — this prevents
  // the first watchPosition reading from immediately jumping to a different node
  // due to GPS jitter before the hysteresis logic kicks in.
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
