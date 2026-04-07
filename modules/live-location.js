(function (window) {
  'use strict';

  var NODE_SELECT_RADIUS = 50;      // meters
  var ROUTE_ADVANCE_RADIUS = 15;    // meters
  var MAX_ACCEPTABLE_ACCURACY = 40; // meters
  var watchId = null;
  var liveNodeId = null;
  var liveNodeDistance = Infinity;
  var liveStatus = 'stopped';
  var routeState = null; // { path, stepIndex }
  var outOfCoverageTimer = null;
  var options = {
    nodes: [],
    allNodes: [],
    callbacks: {
      onStatus: function () {},
      onNodeChange: function () {},
      onRouteAdvance: function () {},
      onPosition: function () {},
      onError: function () {}
    }
  };

  function setStatus(text) {
    if (liveStatus === text) return;
    liveStatus = text;
    options.callbacks.onStatus(text);
  }

  function init(opts) {
    opts = opts || {};
    options.allNodes = opts.nodes || [];
    options.nodes = options.allNodes.filter(function (node) {
      return typeof node.lat === 'number' && typeof node.lng === 'number';
    });

    options.callbacks.onStatus   = opts.onStatus   || options.callbacks.onStatus;
    options.callbacks.onNodeChange = opts.onNodeChange || options.callbacks.onNodeChange;
    options.callbacks.onRouteAdvance = opts.onRouteAdvance || options.callbacks.onRouteAdvance;
    options.callbacks.onPosition = opts.onPosition || options.callbacks.onPosition;
    options.callbacks.onError    = opts.onError    || options.callbacks.onError;

    liveNodeId = null;
    liveNodeDistance = Infinity;
    routeState = null;
    setStatus('stopped');
  }

  function isSupported() {
    return typeof navigator !== 'undefined' && typeof navigator.geolocation !== 'undefined';
  }

  function start() {
    if (!isSupported()) {
      setStatus('unsupported');
      options.callbacks.onError(new Error('Geolocation not supported'));
      return;
    }
    if (watchId !== null) return;

    liveNodeId = null;
    liveNodeDistance = Infinity;
    setStatus('watching');

    // Set a timer to check for coverage after 10 seconds
    outOfCoverageTimer = setTimeout(function () {
      if (liveStatus === 'watching' || liveStatus === 'searching') {
        setStatus('out_of_coverage');
      }
    }, 10000);

    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 5000
    });
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
    liveNodeId = null;
    liveNodeDistance = Infinity;
    setStatus('stopped');
  }

  function handlePosition(position) {
    if (!position || !position.coords) return;
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    var accuracy = position.coords.accuracy || 0;
    var timestamp = position.timestamp || Date.now();

    options.callbacks.onPosition({
      lat: lat,
      lng: lng,
      accuracy: accuracy,
      timestamp: timestamp,
      nodeId: liveNodeId,
      distance: liveNodeDistance
    });

    if (options.nodes.length === 0) {
      setStatus('no nodes');
      return;
    }

    var closest = findClosestNode(lat, lng);
    if (!closest) {
      setStatus('searching');
      return;
    }

    var distance = closest.distance;
    var valid = distance <= NODE_SELECT_RADIUS && (accuracy <= MAX_ACCEPTABLE_ACCURACY || distance <= accuracy * 1.5 + 10);
    if (!valid) {
      setStatus('searching');
      return;
    }

    setStatus('tracking');

    if (liveNodeId !== closest.nodeId) {
      liveNodeId = closest.nodeId;
      liveNodeDistance = distance;
      options.callbacks.onNodeChange(liveNodeId, closest.node, distance);
      // Clear the out of coverage timer since we found a node
      if (outOfCoverageTimer !== null) {
        clearTimeout(outOfCoverageTimer);
        outOfCoverageTimer = null;
      }
    } else {
      liveNodeDistance = distance;
    }

    if (routeState && routeState.path && routeState.stepIndex < routeState.path.length - 1) {
      var nextStep = routeState.path[routeState.stepIndex + 1];
      if (nextStep && nextStep.nodeId) {
        var nextNode = getNodeById(nextStep.nodeId);
        if (nextNode) {
          var nextDistance = haversine(lat, lng, nextNode.lat, nextNode.lng);
          if (nextDistance <= ROUTE_ADVANCE_RADIUS) {
            routeState.stepIndex += 1;
            options.callbacks.onRouteAdvance(nextStep.nodeId, nextNode, nextDistance);
          }
        }
      }
    }
  }

  function handleError(err) {
    options.callbacks.onError(err);
    if (err && err.code === 1) {
      setStatus('denied');
    } else if (err && err.code === 2) {
      setStatus('unavailable');
    } else {
      setStatus('error');
    }
  }

  function findClosestNode(lat, lng) {
    var best = null;
    options.nodes.forEach(function (node) {
      if (node.lat == null || node.lng == null) return;
      var distance = haversine(lat, lng, node.lat, node.lng);
      if (best === null || distance < best.distance) {
        best = { nodeId: node.id, node: node, distance: distance };
      }
    });
    return best;
  }

  function getNodeById(nodeId) {
    return options.allNodes.find(function (node) {
      return node.id === nodeId;
    });
  }

  function setRoute(route, stepIndex) {
    if (!route || !route.path) {
      routeState = null;
      return;
    }
    routeState = {
      path: route.path.slice(),
      stepIndex: typeof stepIndex === 'number' ? stepIndex : 0
    };
  }

  function clearRoute() {
    routeState = null;
  }

  function getLiveNodeId() {
    return liveNodeId;
  }

  function isActive() {
    return watchId !== null;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return 6371000 * c;
  }

  window.LiveLocation = {
    init: init,
    start: start,
    stop: stop,
    setRoute: setRoute,
    clearRoute: clearRoute,
    getLiveNodeId: getLiveNodeId,
    isActive: isActive,
    getStatus: function () { return liveStatus; }
  };
})(window);
