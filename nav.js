/**
 * nav.js — In-Panorama Navigation System for Pano2VR
 *
 * Adds step-by-step GPS-guided navigation directly inside the 360° panoramic view.
 * Completely inactive until the user clicks the navigation button — zero interference
 * with normal panorama behaviour.
 *
 * What it does when active:
 *  - Runs Dijkstra on ROAD-tagged nodes to find the shortest path
 *  - Auto-rotates the camera to face the next hotspot to click
 *  - Draws pulsing rings + bouncing arrow on the target hotspot (canvas overlay)
 *  - Shows an edge compass arrow when the target is off-screen
 *  - Advances step-by-step as the user clicks through the route
 *  - Detects off-route moves and offers re-routing
 *
 * Files changed: nav.js (new), index.html (one <script> tag added)
 * Files NOT changed: skin.js, pano.xml, pano2vr_player.js
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  var NODE_SELECT_RADIUS = 50;      // meters
  var MAX_ACCEPTABLE_ACCURACY = 40; // meters
  var nodes       = {};     // nodeId → NodeData
  var graph       = {};     // nodeId → Edge[] — includes all nodes, ROAD edges prioritized
  var activeRoute = null;   // Route | null — only set while navigating
  var stepIndex   = 0;      // index into activeRoute.path for CURRENT position
  var navActive   = false;  // master flag — canvas draws nothing when false
  var navMode     = 'manual'; // manual or live
  var liveStatus  = 'off';
  var overlayCanvas = null;
  var autoRafId   = null;
  var idleTimer   = null;
  var autoRotateDone = false;
  var activeToast = null;
  var lastCamPan  = null;   // previous frame camera pan — used for wrong-direction detection
  var appLoadingOverlay = null;
  var navReady = false;

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────

  window.addEventListener('load', function () {
    createLoadingOverlay();
    showLoadingOverlay('Waiting for panorama player...');
    waitForPlayer(function () {
      pano.addListener('configloaded', function () {
        initNav();
      });
    });
  });

  function waitForPlayer(cb) {
    if (window.pano) { cb(); return; }
    setTimeout(function () { waitForPlayer(cb); }, 50);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: LOADING OVERLAY
  // ─────────────────────────────────────────────────────────────────────────────

  function showLoadingOverlay(message) {
    if (!appLoadingOverlay) return;
    var status = appLoadingOverlay.querySelector('#nav-loading-status');
    if (status) status.textContent = message || 'Loading tour...';
    appLoadingOverlay.classList.add('active');
    disableNavUI(true);
  }

  function hideLoadingOverlay() {
    if (!appLoadingOverlay) return;
    appLoadingOverlay.classList.remove('active');
    disableNavUI(false);
  }

  function setLoadingOverlayMessage(message) {
    if (!appLoadingOverlay) return;
    var status = appLoadingOverlay.querySelector('#nav-loading-status');
    if (status) status.textContent = message;
  }

  function disableNavUI(disabled) {
    var btn = document.getElementById('nav-open-btn');
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.style.pointerEvents = disabled ? 'none' : 'auto';
    btn.style.opacity = disabled ? '0.3' : '1';
  }

  function createLoadingOverlay() {
    if (appLoadingOverlay) return;
    var body = document.body || document.getElementsByTagName('body')[0];
    if (!body) return;
    var overlay = document.createElement('div');
    overlay.id = 'nav-loading-overlay';
    overlay.className = 'nav-loading-overlay';
    overlay.innerHTML =
      '<div class="nav-loading-box">' +
        '<div class="nav-loading-spinner"></div>' +
        '<div class="nav-loading-title">Preparing the tour</div>' +
        '<div id="nav-loading-status" class="nav-loading-status">Loading navigation data...</div>' +
      '</div>';
    body.appendChild(overlay);
    appLoadingOverlay = overlay;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: PANORAMA READY WAITING
  // ─────────────────────────────────────────────────────────────────────────────

  function waitForPanoramaReady() {
    return new Promise(function (resolve) {
      var finished = false;
      function done() {
        if (finished) return;
        finished = true;
        resolve();
      }

      setTimeout(function () {
        console.log('[nav.js] Initial panorama ready timeout expired');
        done();
      }, 1800);

      if (pano && typeof pano.addListener === 'function') {
        pano.addListener('changenode', function () {
          console.log('[nav.js] Initial panorama ready via changenode event');
          done();
        });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: IMAGE PRELOADING
  // ─────────────────────────────────────────────────────────────────────────────

  function preloadAllNodeImages(doc) {
    var urls = collectAllNodeImageUrls(doc);
    if (!urls.length) {
      console.log('[nav.js] No image URLs found for preload');
      return Promise.resolve();
    }

    console.log('[nav.js] Preloading', urls.length, 'node images');
    var loaded = 0;
    setLoadingOverlayMessage('Preloading images 0/' + urls.length);

    return new Promise(function (resolve) {
      var concurrency = 12;
      var index = 0;
      var active = 0;

      function next() {
        if (index >= urls.length && active === 0) {
          resolve();
          return;
        }

        while (active < concurrency && index < urls.length) {
          let url = urls[index++];
          active += 1;
          loadImage(url).then(function () {
            loaded += 1;
            setLoadingOverlayMessage('Preloading images ' + loaded + '/' + urls.length);
          }).catch(function (err) {
            loaded += 1;
            setLoadingOverlayMessage('Preloading images ' + loaded + '/' + urls.length + ' (some failed)');
            console.warn('[nav.js] Image preload failed:', url, err);
          }).finally(function () {
            active -= 1;
            next();
          });
        }
      }

      next();
    });
  }

  function collectAllNodeImageUrls(doc) {
    var urls = [];
    var panos = doc.querySelectorAll('panorama');
    forEachNode(panos, function (panorama) {
      var input = panorama.querySelector('input');
      if (!input) return;

      var template = input.getAttribute('leveltileurl');
      if (!template) return;

      var tileSize = parseInt(input.getAttribute('leveltilesize'), 10) || 512;
      var levels = panorama.querySelectorAll('level');
      forEachNode(levels, function (level, levelIndex) {
        if (level.getAttribute('preload') !== '1') return;
        var width = parseInt(level.getAttribute('width'), 10) || 0;
        var tileCount = Math.max(1, Math.ceil(width / tileSize));
        for (var c = 0; c < 6; c++) {
          for (var x = 0; x < tileCount; x++) {
            for (var y = 0; y < tileCount; y++) {
              var url = template
                .replace(/%c/g, c)
                .replace(/%l/g, levelIndex)
                .replace(/%x/g, x)
                .replace(/%y/g, y);
              urls.push(url);
            }
          }
        }
      });
    });
    // Keep only unique URLs
    return urls.filter(function (value, index) {
      return urls.indexOf(value) === index;
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(url); };
      img.onerror = function (err) { reject(err || new Error('Image failed to load')); };
      img.src = url;
    });
  }

  function initNav() {
    console.log('[nav.js] initNav: Starting navigation initialization');
    showLoadingOverlay('Loading tour data...');
    loadXML(resolveNavUrl('pano.xml'))
      .then(function (doc) {
        console.log('[nav.js] initNav: pano.xml loaded successfully');
        nodes = parseNodes(doc);
        console.log('[nav.js] initNav: Parsed nodes:', Object.keys(nodes).length);
        graph = buildGraph(nodes);  // Single graph with ROAD priority built-in
        buildSearchIndex();
        console.log('[nav.js] initNav: Search index built with', searchIndex.length, 'entries');
        injectStyles();
        injectUI();
        createOverlayCanvas();
        bindPlayerEvents();
        startRenderLoop();
        initLiveLocationModule();

        setLoadingOverlayMessage('Preloading node images...');
        Promise.all([ waitForPanoramaReady(), preloadAllNodeImages(doc) ])
          .then(function () {
            navReady = true;
            hideLoadingOverlay();
            console.log('[nav.js] Navigation ready');
          });
      })
      .catch(function (err) {
        console.error('[nav.js] initNav: Failed to load pano.xml:', err);
        setLoadingOverlayMessage('Failed to load tour data. ' + (err && err.message ? err.message : 'See console.'));
      });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: XML LOADING AND PARSING
  // ─────────────────────────────────────────────────────────────────────────────

  function forEachNode(nodeList, fn) {
    if (!nodeList) return;
    if (typeof nodeList.forEach === 'function') {
      nodeList.forEach(fn);
      return;
    }
    for (var i = 0; i < nodeList.length; i++) {
      fn(nodeList[i], i, nodeList);
    }
  }

  function loadXML(url) {
    console.log('[nav.js] loadXML: Attempting to load', url);
    if (window.fetch) {
      return fetch(url)
        .then(function (response) {
          console.log('[nav.js] loadXML: fetch response status:', response.status);
          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
          }
          return response.text();
        })
        .then(function (text) {
          console.log('[nav.js] loadXML: fetch text length:', text.length);
          var doc = new DOMParser().parseFromString(text, 'application/xml');
          if (doc.querySelector('parsererror')) {
            throw new Error('XML parse error while loading ' + url);
          }
          console.log('[nav.js] loadXML: XML parsed successfully');
          return doc;
        })
        .catch(function (err) {
          console.warn('[nav.js] loadXML: fetch failed, retrying with XHR:', err);
          return loadXMLFallback(url);
        });
    }
    return loadXMLFallback(url);
  }

  function getCurrentScriptQuery() {
    if (!document || !document.getElementsByTagName) return '';
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('nav.js') !== -1) {
        var q = src.indexOf('?');
        return q !== -1 ? src.slice(q) : '';
      }
    }
    return '';
  }

  function resolveNavUrl(url) {
    var query = getCurrentScriptQuery();
    return query ? url + query : url;
  }

  function loadXMLFallback(url) {
    console.log('[nav.js] loadXMLFallback: Using XHR for', url);
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.overrideMimeType('text/xml');
      xhr.onload = function () {
        console.log('[nav.js] loadXMLFallback: XHR onload, status:', xhr.status, 'readyState:', xhr.readyState);
        if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && (xhr.responseXML || xhr.responseText))) {
          var doc = xhr.responseXML || new DOMParser().parseFromString(xhr.responseText, 'application/xml');
          if (doc.querySelector('parsererror')) {
            reject(new Error('XML parse error while loading ' + url));
            return;
          }
          console.log('[nav.js] loadXMLFallback: XML parsed successfully');
          resolve(doc);
        } else {
          reject(new Error('XHR ' + xhr.status + ': ' + xhr.statusText));
        }
      };
      xhr.onerror = function () {
        console.error('[nav.js] loadXMLFallback: XHR network error for', url);
        reject(new Error('XHR network error while loading ' + url));
      };
      xhr.send();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // XML Parsing — builds NodeData objects from pano.xml
  // ─────────────────────────────────────────────────────────────────────────────

  function parseNodes(doc) {
    console.log('[nav.js] parseNodes: Starting to parse XML document');
    var result = {};
    var panos  = doc.querySelectorAll('panorama');
    console.log('[nav.js] parseNodes: Found', panos.length, 'panorama elements');

    forEachNode(panos, function (panorama) {
      var ud = panorama.querySelector('userdata');
      if (!ud) {
        console.warn('[nav.js] parseNodes: Panorama missing userdata');
        return;
      }

      var startView = panorama.querySelector('view start');
      var startPan  = startView ? parseFloat(startView.getAttribute('pan'))  || 0 : 0;
      var startTilt = startView ? parseFloat(startView.getAttribute('tilt')) || 0 : 0;
      var startFov  = startView ? parseFloat(startView.getAttribute('fov'))  || 100 : 100;

      var id      = panorama.getAttribute('id');
      var rawTags = ud.getAttribute('tags') || '';
      var tags    = rawTags.split('|').map(function (t) { return t.trim(); }).filter(Boolean);

      var hotspots = [];
      forEachNode(panorama.querySelectorAll('hotspot'), function (hs) {
        var url      = hs.getAttribute('url') || '';
        var targetId = url.replace(/[{}]/g, '');   // "{node10}" → "node10"
        if (!targetId) return;
        hotspots.push({
          id:       hs.getAttribute('id'),
          targetId: targetId,
          pan:      parseFloat(hs.getAttribute('pan'))      || 0,
          tilt:     parseFloat(hs.getAttribute('tilt'))     || 0,
          title:    hs.getAttribute('title')                || '',
          distance: parseFloat(hs.getAttribute('distance')) || 0
        });
      });

      result[id] = {
        id:         id,
        title:      ud.getAttribute('title') || id,
        lat:        parseFloat(ud.getAttribute('latitude')),
        lng:        parseFloat(ud.getAttribute('longitude')),
        startPan:   startPan,
        startTilt:  startTilt,
        startFov:   startFov,
        tags:       tags,
        isRoad:     tags.indexOf('ROAD')     !== -1,
        isLocation: tags.indexOf('Location') !== -1,
        hotspots:   hotspots
      };
    });

    console.log('[nav.js] parseNodes: Parsed', Object.keys(result).length, 'nodes');
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Graph — includes ALL nodes and ALL edges
  // ROAD edges get priority through lower distance weights in Dijkstra
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: GRAPH BUILDING
  // ─────────────────────────────────────────────────────────────────────────────

  function buildGraph(nodeMap) {
    var g = {};
    console.log('[nav.js] Building graph with', Object.keys(nodeMap).length, 'nodes');

    Object.keys(nodeMap).forEach(function (id) {
      var node = nodeMap[id];
      g[id] = [];

      console.log('[nav.js] Building edges for node', id, '(' + node.title + '), isRoad:', node.isRoad);

      node.hotspots.forEach(function (hs) {
        var neighbor = nodeMap[hs.targetId];
        if (!neighbor) {
          console.warn('[nav.js] Hotspot', hs.id, 'references unknown node', hs.targetId);
          return;
        }

        var dist = hs.distance > 0 ? hs.distance : haversine(
          node.lat, node.lng, neighbor.lat, neighbor.lng
        );

        // ROAD edges get priority by reducing their distance weight
        // This makes Dijkstra prefer ROAD paths while still allowing non-ROAD
        var priorityWeight = neighbor.isRoad ? 0.1 : 1.0;  // ROAD edges are 90% cheaper (very strong preference)
        var weightedDist = dist * priorityWeight;

        console.log('[nav.js] Adding edge', id, '->', hs.targetId, 'distance:', dist.toFixed(1), 'weighted:', weightedDist.toFixed(1), 'isRoad:', neighbor.isRoad);

        g[id].push({
          neighborId: hs.targetId,
          pan:        hs.pan,
          tilt:       hs.tilt,
          hotspotId:  hs.id,
          title:      hs.title,
          distance:   weightedDist,  // Use weighted distance for priority
          rawDistance: dist         // Keep original for display
        });
      });

      console.log('[nav.js] Node', id, 'has', g[id].length, 'edges');
    });

    console.log('[nav.js] Graph built with', Object.keys(g).length, 'nodes');
    
    // Debug: check if key nodes are in the graph
    var keyNodes = ['node9', 'node61', 'node60', 'node59'];
    keyNodes.forEach(function (nodeId) {
      if (g[nodeId]) {
        console.log('[nav.js] Node', nodeId, 'has', g[nodeId].length, 'edges');
      } else {
        console.warn('[nav.js] Node', nodeId, 'is missing from graph!');
      }
    });
    
    // Debug: check graph connectivity
    checkGraphConnectivity(g);
    
    return g;
  }

  function checkGraphConnectivity(graph) {
    console.log('[nav.js] Checking graph connectivity...');
    
    // Find all nodes reachable from node9 (Todd Library)
    var visited = {};
    var queue = ['node9'];
    visited['node9'] = true;
    
    while (queue.length > 0) {
      var current = queue.shift();
      var edges = graph[current] || [];
      
      edges.forEach(function (edge) {
        if (!visited[edge.neighborId]) {
          visited[edge.neighborId] = true;
          queue.push(edge.neighborId);
        }
      });
    }
    
    var reachableCount = Object.keys(visited).length;
    var totalCount = Object.keys(graph).length;
    
    console.log('[nav.js] Graph connectivity: ' + reachableCount + '/' + totalCount + ' nodes reachable from node9');
    
    // Check if key nodes are reachable
    var keyNodes = ['node9', 'node61', 'node60', 'node59'];
    keyNodes.forEach(function (nodeId) {
      if (visited[nodeId]) {
        console.log('[nav.js] ✓ Node', nodeId, 'is reachable from node9');
      } else {
        console.warn('[nav.js] ✗ Node', nodeId, 'is NOT reachable from node9');
      }
    });
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var R    = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dijkstra — finds shortest path (using specified graph)
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: DIJKSTRA PATHFINDING
  // ─────────────────────────────────────────────────────────────────────────────

  function dijkstra(startId, endId) {
    console.log('[nav.js] Dijkstra: searching from', startId, 'to', endId);

    var dist    = {};
    var prev    = {};
    var visited = {};

    Object.keys(graph).forEach(function (id) { dist[id] = Infinity; prev[id] = null; });
    if (dist[startId] === undefined || dist[endId] === undefined) {
      console.warn('[nav.js] Dijkstra: start or end node not in graph');
      return null;
    }

    dist[startId] = 0;
    var queue = [{ id: startId, d: 0 }];
    var iterations = 0;

    while (queue.length > 0 && iterations < 1000) {  // Prevent infinite loops
      iterations++;
      queue.sort(function (a, b) { return a.d - b.d; });
      var curr = queue.shift();
      var u    = curr.id;

      if (visited[u]) continue;
      visited[u] = true;

      console.log('[nav.js] Dijkstra: visiting', u, 'distance:', dist[u]);

      if (u === endId) {
        console.log('[nav.js] Dijkstra: found path to destination!');
        break;
      }

      var edges = graph[u] || [];
      console.log('[nav.js] Dijkstra: node', u, 'has', edges.length, 'edges');

      for (var ei = 0; ei < edges.length; ei++) {
        var edge = edges[ei];
        var newDist = dist[u] + edge.distance;

        console.log('[nav.js] Dijkstra: considering edge', u, '->', edge.neighborId, 'newDist:', newDist, 'current:', dist[edge.neighborId]);

        if (newDist < dist[edge.neighborId]) {
          dist[edge.neighborId] = newDist;
          prev[edge.neighborId] = {
            fromId:       u,
            pan:          edge.pan,
            tilt:         edge.tilt,
            hotspotId:    edge.hotspotId,
            hotspotTitle: edge.title
          };
          queue.push({ id: edge.neighborId, d: newDist });
        }
      }
    }

    if (dist[endId] === Infinity) {
      console.warn('[nav.js] Dijkstra: no path found, final distance to end:', dist[endId]);
      return null;
    }

    console.log('[nav.js] Dijkstra: reconstructing path...');

    // Reconstruct path
    var path = [];
    var cur  = endId;
    while (cur !== null) {
      var info = prev[cur];
      path.unshift({
        nodeId:       cur,
        title:        nodes[cur] ? nodes[cur].title : cur,
        pan:          info ? info.pan          : null,
        tilt:         info ? info.tilt         : null,
        hotspotId:    info ? info.hotspotId    : null,
        hotspotTitle: info ? info.hotspotTitle : null
      });
      cur = info ? info.fromId : null;
    }

    console.log('[nav.js] Dijkstra: path reconstructed with', path.length, 'steps');
    return { path: path, totalDistance: dist[endId] };
  }

  function dijkstraUnweighted(startId, endId) {
    console.log('[nav.js] DijkstraUnweighted: searching from', startId, 'to', endId);

    var dist    = {};
    var prev    = {};
    var visited = {};

    Object.keys(graph).forEach(function (id) { dist[id] = Infinity; prev[id] = null; });
    if (dist[startId] === undefined || dist[endId] === undefined) {
      console.warn('[nav.js] DijkstraUnweighted: start or end node not in graph');
      return null;
    }

    dist[startId] = 0;
    var queue = [{ id: startId, d: 0 }];
    var iterations = 0;

    while (queue.length > 0 && iterations < 1000) {  // Prevent infinite loops
      iterations++;
      queue.sort(function (a, b) { return a.d - b.d; });
      var curr = queue.shift();
      var u    = curr.id;

      if (visited[u]) continue;
      visited[u] = true;

      console.log('[nav.js] DijkstraUnweighted: visiting', u, 'distance:', dist[u]);

      if (u === endId) {
        console.log('[nav.js] DijkstraUnweighted: found path to destination!');
        break;
      }

      var edges = graph[u] || [];
      console.log('[nav.js] DijkstraUnweighted: node', u, 'has', edges.length, 'edges');

      for (var ei = 0; ei < edges.length; ei++) {
        var edge = edges[ei];
        var newDist = dist[u] + edge.rawDistance;  // Use raw distance without weighting

        console.log('[nav.js] DijkstraUnweighted: considering edge', u, '->', edge.neighborId, 'newDist:', newDist, 'current:', dist[edge.neighborId]);

        if (newDist < dist[edge.neighborId]) {
          dist[edge.neighborId] = newDist;
          prev[edge.neighborId] = {
            fromId:       u,
            pan:          edge.pan,
            tilt:         edge.tilt,
            hotspotId:    edge.hotspotId,
            hotspotTitle: edge.title
          };
          queue.push({ id: edge.neighborId, d: newDist });
        }
      }
    }

    if (dist[endId] === Infinity) {
      console.warn('[nav.js] DijkstraUnweighted: no path found, final distance to end:', dist[endId]);
      return null;
    }

    console.log('[nav.js] DijkstraUnweighted: reconstructing path...');

    // Reconstruct path
    var path = [];
    var cur  = endId;
    while (cur !== null) {
      var info = prev[cur];
      path.unshift({
        nodeId:       cur,
        title:        nodes[cur] ? nodes[cur].title : cur,
        pan:          info ? info.pan          : null,
        tilt:         info ? info.tilt         : null,
        hotspotId:    info ? info.hotspotId    : null,
        hotspotTitle: info ? info.hotspotTitle : null
      });
      cur = info ? info.fromId : null;
    }

    console.log('[nav.js] DijkstraUnweighted: path reconstructed with', path.length, 'steps');
    return { path: path, totalDistance: dist[endId] };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Navigation Control
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: NAVIGATION CONTROL
  // ─────────────────────────────────────────────────────────────────────────────

  function startNavigation(destId) {
    if (!navReady) {
      showToast('Please wait while the panorama finishes loading.', 2500, null);
      return;
    }

    var currentId = pano.getCurrentNode();
    if (navMode === 'live' && window.LiveLocation && LiveLocation.getLiveNodeId()) {
      currentId = LiveLocation.getLiveNodeId();
      console.log('[nav.js] Live mode route origin from GPS node', currentId);
    }

    if (currentId === destId) {
      showToast('You are already here!', 2500, null);
      return;
    }

    console.log('[nav.js] Starting navigation from', currentId, 'to', destId);
    console.log('[nav.js] Current node exists in graph:', !!graph[currentId]);
    console.log('[nav.js] Destination exists in graph:', !!graph[destId]);
    console.log('[nav.js] Graph nodes:', Object.keys(graph).length);

    // Single Dijkstra run with built-in ROAD prioritization
    var route = dijkstra(currentId, destId);

    console.log('[nav.js] Route found:', !!route);
    if (route) {
      console.log('[nav.js] Route path length:', route.path.length);
      console.log('[nav.js] Route path:', route.path.map(p => p.nodeId + ' (' + p.title + ')'));
    }

    // If no path found with ROAD priority, try without any weighting
    if (!route || route.path.length < 2) {
      console.log('[nav.js] ROAD-weighted path failed, trying unweighted...');
      route = dijkstraUnweighted(currentId, destId);
      
      console.log('[nav.js] Unweighted route found:', !!route);
      if (route) {
        console.log('[nav.js] Unweighted route path length:', route.path.length);
        console.log('[nav.js] Unweighted route path:', route.path.map(p => p.nodeId + ' (' + p.title + ')'));
      }
    }

    if (!route || route.path.length < 2) {
      console.warn('[nav.js] No path found from', currentId, 'to', destId, 'even without weighting');
      showToast('No path found. Try navigating closer first.', 3000, null);
      return;
    }

    activeRoute = route;
    stepIndex   = 0;
    navActive   = true;
    autoRotateDone = false;

    if (window.LiveLocation && LiveLocation.setRoute) {
      LiveLocation.setRoute(activeRoute, stepIndex);
    }

    closeSearchPanel();
    updateHUD();
    pano.stopAutorotate();

    // Rotate to face the first hotspot after a short delay
    var firstNext = activeRoute.path[1];
    if (firstNext) {
      setTimeout(function () {
        autoRotateTo(firstNext.pan, firstNext.tilt);
      }, 300);
    }
  }

  function cancelNavigation() {
    activeRoute    = null;
    stepIndex      = 0;
    navActive      = false;
    autoRotateDone = false;
    lastCamPan     = null;

    if (window.LiveLocation && LiveLocation.clearRoute) {
      LiveLocation.clearRoute();
    }

    if (autoRafId)  { cancelAnimationFrame(autoRafId); autoRafId = null; }
    if (idleTimer)  { clearTimeout(idleTimer); idleTimer = null; }
    if (activeToast){ activeToast.remove(); activeToast = null; }

    var hud = document.getElementById('nav-hud');
    if (hud) hud.classList.remove('active');
  }

  function advanceStep(newNodeId) {
    if (!activeRoute) return false;

    var path         = activeRoute.path;
    var expectedNext = path[stepIndex + 1] ? path[stepIndex + 1].nodeId : null;

    // On-route: expected next node
    if (newNodeId === expectedNext) {
      stepIndex++;

      // Reached destination?
      if (stepIndex >= path.length - 1) {
        playArrival(path[path.length - 1].title);
        return true;
      }

      updateHUD();
      autoRotateDone = false;

      var nextStep = path[stepIndex + 1];
      if (nextStep) {
        setTimeout(function () {
          autoRotateTo(nextStep.pan, nextStep.tilt);
        }, 650);   // wait for transition animation to settle
      }
      return true;
    }

    // Jumped directly to destination somehow
    if (newNodeId === path[path.length - 1].nodeId) {
      playArrival(path[path.length - 1].title);
      return true;
    }

    // Check if the new node is somewhere later on the planned path (user skipped ahead)
    for (var i = stepIndex + 2; i < path.length; i++) {
      if (path[i].nodeId === newNodeId) {
        stepIndex = i;
        if (stepIndex >= path.length - 1) {
          playArrival(path[path.length - 1].title);
          return true;
        }
        updateHUD();
        autoRotateDone = false;
        var nextS = path[stepIndex + 1];
        if (nextS) setTimeout(function () { autoRotateTo(nextS.pan, nextS.tilt); }, 650);
        return true;
      }
    }

    return false;  // off-route
  }

  function playArrival(title) {
    navActive = false;
    if (autoRafId) { cancelAnimationFrame(autoRafId); autoRafId = null; }
    if (idleTimer)  { clearTimeout(idleTimer);         idleTimer = null; }

    // ── Centered arrival card ────────────────────────────────────────────────
    var card    = document.createElement('div');
    card.id     = 'nav-arrival-card';
    card.innerHTML =
      '<div class="nav-arrival-icon">&#10003;</div>' +
      '<div class="nav-arrival-title">You\'ve arrived!</div>' +
      '<div class="nav-arrival-dest">' + escapeHtml(title) + '</div>' +
      '<div class="nav-arrival-sub">Tap anywhere to continue</div>';
    document.body.appendChild(card);

    // Animate in
    requestAnimationFrame(function () {
      card.classList.add('nav-arrival-show');
    });

    // Auto-dismiss after 3.5 s with a fade-out
    var dismiss = function () {
      card.classList.remove('nav-arrival-show');
      card.classList.add('nav-arrival-hide');
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
      }, 400);
      cancelNavigation();
    };

    var timer = setTimeout(dismiss, 3500);

    // Tap to dismiss early
    card.addEventListener('click', function () {
      clearTimeout(timer);
      dismiss();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Auto-Rotate — smooth animated pan+tilt using setPanTiltFov in RAF
  // ─────────────────────────────────────────────────────────────────────────────

  function autoRotateTo(targetPan, targetTilt) {
    if (autoRafId) { cancelAnimationFrame(autoRafId); autoRafId = null; }
    autoRotateDone = false;

    var startPan  = pano.getPan();
    var startTilt = pano.getTilt();
    var startFov  = pano.getFov();
    var startTime = null;
    var DURATION  = 1300;  // ms

    // Take the shortest rotation arc (avoid spinning the long way)
    var dPan  = targetPan - startPan;
    dPan      = ((dPan + 180) % 360 + 360) % 360 - 180;

    // Keep tilt reasonable — don't flip overhead
    var clampTilt = Math.max(-70, Math.min(70, targetTilt));
    var dTilt     = clampTilt - startTilt;

    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function step(ts) {
      if (!startTime) startTime = ts;
      var t = Math.min((ts - startTime) / DURATION, 1.0);
      var e = easeInOut(t);

      pano.setPanTiltFov(startPan + dPan * e, startTilt + dTilt * e, startFov);

      if (t < 1.0) {
        autoRafId = requestAnimationFrame(step);
      } else {
        autoRafId      = null;
        autoRotateDone = true;
        if (navActive) resetIdleTimer(targetPan, clampTilt);
      }
    }

    autoRafId = requestAnimationFrame(step);
  }

  function resetIdleTimer(pan, tilt) {
    if (idleTimer) clearTimeout(idleTimer);
    if (!navActive) return;
    // If user looks away for 4 seconds, gently rotate back to next hotspot
    idleTimer = setTimeout(function () {
      if (navActive && !autoRafId) autoRotateTo(pan, tilt);
    }, 4000);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Canvas Overlay + Render Loop
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: RENDERING
  // ─────────────────────────────────────────────────────────────────────────────

  function createOverlayCanvas() {
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'nav-overlay-canvas';
    // Append to document.body with position:fixed so it sits above EVERY
    // stacking context the pano2vr player and skin.js create — z-index
    // battles inside #container are irrelevant when the canvas is body-level.
    overlayCanvas.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:100vw',    'height:100vh',
      'pointer-events:none',
      'z-index:9999'
    ].join(';');
    document.body.appendChild(overlayCanvas);
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!overlayCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    overlayCanvas.width  = Math.round(window.innerWidth  * dpr);
    overlayCanvas.height = Math.round(window.innerHeight * dpr);
  }

  function startRenderLoop() {
    function loop() {
      render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function render() {
    var dpr = window.devicePixelRatio || 1;
    // W/H are logical CSS pixels — consistent with all our drawing coordinates
    var W   = window.innerWidth;
    var H   = window.innerHeight;
    var ctx = overlayCanvas.getContext('2d');

    ctx.save();
    ctx.scale(dpr, dpr);                 // scale once — draw in CSS pixels
    ctx.clearRect(0, 0, W, H);

    if (!navActive || !activeRoute) { ctx.restore(); return; }

    var path = activeRoute.path;
    var next = path[stepIndex + 1];
    if (!next) { ctx.restore(); return; }

    var camPan  = pano.getPan();
    var camTilt = pano.getTilt();
    var camFov  = pano.getFov();

    // Wrong-direction detection: compare current camera pan to previous frame.
    // If the camera moved AND it moved AWAY from the target (dPan grew larger),
    // the user is actively dragging in the wrong direction.
    var targetPan  = next.pan;
    var targetTilt = next.tilt;

    var isWrongDirection = false;
    if (lastCamPan !== null && autoRotateDone) {
      // Angular distance from camera to target this frame vs last frame
      var prevDiff = Math.abs(normAngle(targetPan - lastCamPan));
      var currDiff = Math.abs(normAngle(targetPan - camPan));
      // Camera moved at least 1° and is now further from the target
      isWrongDirection = (currDiff - prevDiff) > 1;
    }
    lastCamPan = camPan;

    var pos = projectToScreen(targetPan, targetTilt,
                              { pan: camPan, tilt: camTilt, fov: camFov }, W, H);

    if (pos.inView) {
      isWrongDirection = false;   // they can see it — no warning needed
      drawGroundTrail(ctx, pos.x, pos.y, W, H);
      drawGlowingRings(ctx, pos.x, pos.y);
      drawBounceArrow(ctx, pos.x, pos.y);
      drawNavLabel(ctx, pos.x, pos.y, stepIndex, path.length - 1);
    } else {
      drawEdgeArrow(ctx, pos.dPan, pos.dTilt, W, H, isWrongDirection);
    }

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Projection: spherical angles → screen pixels
  // ─────────────────────────────────────────────────────────────────────────────

  function projectToScreen(hsPan, hsTilt, cam, W, H) {
    var dPan  = hsPan  - cam.pan;
    var dTilt = hsTilt - cam.tilt;

    // Normalise horizontal to [-180, 180] to avoid wrap-around glitches
    dPan = ((dPan + 180) % 360 + 360) % 360 - 180;

    var ppd = W / cam.fov;                       // pixels per degree
    var x   = W / 2 + dPan  * ppd;
    var y   = H / 2 - dTilt * ppd;

    // Is the hotspot inside the current viewport? (with small tolerance)
    var vFov   = cam.fov * (H / W);
    var inView = (Math.abs(dPan) < cam.fov / 2 + 8) && (Math.abs(dTilt) < vFov / 2 + 8);

    return { x: x, y: y, dPan: dPan, dTilt: dTilt, inView: inView };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Animated Ground Trail  >>>>>>>  from bottom-center up to hotspot
  //
  // Simulates a path painted on the ground flowing toward the next hotspot.
  // Origin: bottom-center of the screen (where the "floor" meets the viewer).
  // Destination: the hotspot screen position.
  // Animation: chevron segments travel along the line, fading as they approach
  // the hotspot — like runway lights guiding you forward.
  // ─────────────────────────────────────────────────────────────────────────────

  function drawGroundTrail(ctx, hx, hy, W, H) {
    // Ground origin — bottom-center, at roughly 80 % of screen height
    // (the horizon sits around 50 %, ground closer to bottom)
    var ox = W / 2;
    var oy = H * 0.82;

    // If the hotspot is below the ground origin (e.g. hotspot is very low in frame)
    // still draw the trail but cap the origin higher so it doesn't look backwards
    if (hy > oy - 20) oy = hy - 20;

    var dx  = hx - ox;
    var dy  = hy - oy;
    var len = Math.sqrt(dx * dx + dy * dy);

    // Minimum length to bother drawing
    if (len < 30) return;

    var angle = Math.atan2(dy, dx);   // direction from origin → hotspot

    // ── Glowing path line ────────────────────────────────────────────────────
    // A soft gradient line from origin (semi-transparent) to hotspot (bright)
    var grad = ctx.createLinearGradient(ox, oy, hx, hy);
    grad.addColorStop(0,    'rgba(255,107,53,0.0)');
    grad.addColorStop(0.15, 'rgba(255,107,53,0.25)');
    grad.addColorStop(0.7,  'rgba(255,107,53,0.55)');
    grad.addColorStop(1.0,  'rgba(255,107,53,0.0)');  // fade out right at the hotspot (rings take over)

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Flowing chevrons >>>>>> ───────────────────────────────────────────────
    // Each chevron is a small ">" shape drawn along the line.
    // The offset of all chevrons shifts over time so they appear to flow forward.
    var CHEVRON_SPACING = 28;   // px between chevron centres
    var CHEVRON_SIZE    = 9;    // half-width of the > arms
    var chevronCount    = Math.floor(len / CHEVRON_SPACING);
    if (chevronCount < 1) chevronCount = 1;

    // timeOffset makes all chevrons march from origin toward hotspot
    var timeOffset = (performance.now() % (CHEVRON_SPACING * 1000 / 420)) /
                     (CHEVRON_SPACING * 1000 / 420);   // 0→1 per spacing interval

    ctx.translate(ox, oy);
    ctx.rotate(angle);

    for (var i = 0; i < chevronCount; i++) {
      // Position of this chevron along the line (0 = origin, len = hotspot)
      var t        = (i + timeOffset) / chevronCount;  // 0→1 along the path
      var cx       = (i + timeOffset) * CHEVRON_SPACING;

      if (cx > len * 0.92) continue;   // don't draw inside the rings area

      // Fade: invisible near origin, bright in the middle, fade near hotspot
      var fade;
      if (t < 0.15)      fade = t / 0.15;
      else if (t > 0.80) fade = (1 - t) / 0.20;
      else               fade = 1.0;

      var alpha = fade * 0.9;

      // Size also scales up slightly near the hotspot for a "getting closer" feel
      var scale = 0.7 + t * 0.5;
      var cs    = CHEVRON_SIZE * scale;

      ctx.save();
      ctx.translate(cx, 0);

      // > shape: two lines meeting at a right-facing point
      ctx.strokeStyle = 'rgba(255,107,53,' + alpha + ')';
      ctx.lineWidth   = 2.2 * scale;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(-cs * 0.6, -cs);
      ctx.lineTo( cs * 0.4,  0);
      ctx.lineTo(-cs * 0.6,  cs);
      ctx.stroke();

      // Subtle white inner highlight on the leading edge
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha * 0.35 + ')';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(-cs * 0.5, -cs * 0.7);
      ctx.lineTo( cs * 0.25, 0);
      ctx.lineTo(-cs * 0.5,  cs * 0.7);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Glowing Rings
  // ─────────────────────────────────────────────────────────────────────────────

  function drawGlowingRings(ctx, x, y) {
    var t = (performance.now() % 1800) / 1800;   // 0→1 cycle every 1.8 s

    // ── Large background halo — always visible, gives the "there it is" cue ──
    var halo = ctx.createRadialGradient(x, y, 0, x, y, 90);
    halo.addColorStop(0,   'rgba(255,107,53,0.22)');
    halo.addColorStop(0.5, 'rgba(255,107,53,0.10)');
    halo.addColorStop(1,   'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(x, y, 90, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // ── Three expanding sonar rings ──────────────────────────────────────────
    for (var i = 0; i < 3; i++) {
      var phase  = (t + i * 0.333) % 1.0;
      var radius = 22 + phase * 80;          // expands 22 → 102 px
      var alpha  = (1 - phase) * 0.9;
      var lw     = 3.5 - phase * 2.5;        // starts thick, thins as it expands
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,107,53,' + alpha + ')';
      ctx.lineWidth   = lw;
      ctx.stroke();
    }

    // ── Inner solid glow ────────────────────────────────────────────────────
    var grd = ctx.createRadialGradient(x, y, 0, x, y, 22);
    grd.addColorStop(0,   'rgba(255,180,120,0.9)');
    grd.addColorStop(0.4, 'rgba(255,107,53,0.7)');
    grd.addColorStop(1,   'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // ── Centre dot with white ring ───────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#FF6B35';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 2.5;
    ctx.stroke();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Bouncing Arrow Above Hotspot
  // ─────────────────────────────────────────────────────────────────────────────

  function drawBounceArrow(ctx, x, y) {
    var bounce = Math.sin(performance.now() / 300) * 7;
    var ay = y - 52 + bounce;

    ctx.save();
    ctx.translate(x, ay);
    ctx.fillStyle   = '#FF6B35';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1.5;

    // Downward chevron arrow ▼
    ctx.beginPath();
    ctx.moveTo(0,  12);
    ctx.lineTo(-9,  0);
    ctx.lineTo(-4,  0);
    ctx.lineTo(-4, -11);
    ctx.lineTo( 4, -11);
    ctx.lineTo( 4,  0);
    ctx.lineTo( 9,  0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Step Label Pill Near Hotspot
  // ─────────────────────────────────────────────────────────────────────────────

  function drawNavLabel(ctx, x, y, currentIdx, totalSteps) {
    var label   = 'Move here';
    var counter = 'Step ' + (currentIdx + 1) + ' of ' + totalSteps;

    ctx.font = 'bold 13px Montserrat, Arial, sans-serif';
    var tw1 = ctx.measureText(label).width;
    ctx.font = '11px Montserrat, Arial, sans-serif';
    var tw2 = ctx.measureText(counter).width;

    var lw = Math.max(tw1, tw2) + 24;
    var lh = 44;
    var lx = x - lw / 2;
    var ly = y - 108;

    // Shadow behind pill
    ctx.shadowColor   = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetY = 2;

    // Dark pill background
    ctx.beginPath();
    navRoundRect(ctx, lx, ly, lw, lh, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    // Orange left accent bar
    ctx.beginPath();
    navRoundRect(ctx, lx, ly, 4, lh, [10, 0, 0, 10]);
    ctx.fillStyle = '#FF6B35';
    ctx.fill();

    // Main text
    ctx.fillStyle = 'white';
    ctx.font      = 'bold 13px Montserrat, Arial, sans-serif';
    ctx.fillText(label, lx + 12, ly + 17);

    // Counter text
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font      = '11px Montserrat, Arial, sans-serif';
    ctx.fillText(counter, lx + 12, ly + 33);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Off-Screen Compass Arrow (edge indicator)
  // ─────────────────────────────────────────────────────────────────────────────

  function drawEdgeArrow(ctx, dPan, dTilt, W, H, isWrong) {
    var angle  = Math.atan2(-dTilt * (H / W), dPan);
    var margin = 56;
    var cx = W / 2, cy = H / 2;
    var ex = cx + Math.cos(angle) * (W / 2 - margin);
    var ey = cy + Math.sin(angle) * (H / 2 - margin);

    // Colors: red when wrong direction, orange when simply off-screen
    var baseColor  = isWrong ? '220,50,50'   : '255,107,53';
    var pulse      = 0.5 + 0.35 * Math.sin(performance.now() / 350);

    // Halo glow
    var grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, 48);
    grd.addColorStop(0, 'rgba(' + baseColor + ',' + pulse + ')');
    grd.addColorStop(1, 'rgba(' + baseColor + ',0)');
    ctx.beginPath();
    ctx.arc(ex, ey, 48, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Rotated arrow body
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(angle);
    ctx.fillStyle   = 'rgb(' + baseColor + ')';
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo( 22,  0);
    ctx.lineTo(  7, -10);
    ctx.lineTo(  7,  -5);
    ctx.lineTo(-14,  -5);
    ctx.lineTo(-14,   5);
    ctx.lineTo(  7,   5);
    ctx.lineTo(  7,  10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';

    if (isWrong) {
      // "Wrong direction" warning label above the arrow
      var msg = 'Wrong direction!';
      ctx.font      = 'bold 13px Montserrat, Arial, sans-serif';
      var tw        = ctx.measureText(msg).width;
      var pw = tw + 20, ph = 26;
      var lx = ex - pw / 2, ly = ey - 56;

      // Red pill background
      ctx.beginPath();
      navRoundRect(ctx, lx, ly, pw, ph, 8);
      ctx.fillStyle = 'rgba(180,30,30,0.88)';
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.fillText(msg, ex, ly + 17);

      // Degree label (smaller, below)
      ctx.font      = '11px Montserrat, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,200,200,0.85)';
      ctx.fillText(Math.abs(Math.round(dPan)) + '\u00B0 away', ex, ey + 36);
    } else {
      // Normal off-screen: just show the degree
      ctx.font      = 'bold 12px Montserrat, Arial, sans-serif';
      ctx.fillStyle = 'white';
      ctx.fillText(Math.abs(Math.round(dPan)) + '\u00B0', ex, ey + 36);
    }

    ctx.textAlign = 'left';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers: roundRect, truncate
  // ─────────────────────────────────────────────────────────────────────────────

  function normAngle(a) {
    return ((a + 180) % 360 + 360) % 360 - 180;
  }

  function navRoundRect(ctx, x, y, w, h, r) {
    if (typeof r === 'number') r = [r, r, r, r];
    ctx.moveTo(x + r[0], y);
    ctx.lineTo(x + w - r[1], y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r[1]);
    ctx.lineTo(x + w, y + h - r[2]);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
    ctx.lineTo(x + r[3], y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r[3]);
    ctx.lineTo(x, y + r[0]);
    ctx.quadraticCurveTo(x, y, x + r[0], y);
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Player Events
  // ─────────────────────────────────────────────────────────────────────────────

  function bindPlayerEvents() {
    if (!pano || typeof pano.addListener !== 'function') return;
    pano.addListener('changenode', function () {
      if (!navActive || !activeRoute) return;
      var newId    = pano.getCurrentNode();
      var advanced = advanceStep(newId);
      if (!advanced) showReroutePrompt(newId);
    });

    // Reset idle timer on any user interaction inside the panorama
    var container = document.getElementById('container');
    if (!container) return;
    ['mousedown', 'touchstart', 'mousemove'].forEach(function (evt) {
      container.addEventListener(evt, function () {
        if (!navActive || !activeRoute || !autoRotateDone) return;
        var next = activeRoute.path[stepIndex + 1];
        if (next) resetIdleTimer(next.pan, next.tilt);
      }, { passive: true });
    });
  }

  function showReroutePrompt(newNodeId) {
    showToast('Off route', 0, [
      { label: 'Re-route', fn: function () { rerouteFrom(newNodeId); } },
      { label: 'Cancel',   fn: function () { cancelNavigation();     } }
    ]);
  }

  function rerouteFrom(fromNodeId) {
    if (!activeRoute) return;
    var destId   = activeRoute.path[activeRoute.path.length - 1].nodeId;
    // Single Dijkstra run with built-in ROAD prioritization
    var newRoute = dijkstra(fromNodeId, destId);
    if (!newRoute || newRoute.path.length < 2) {
      showToast('No path from here. Navigate manually.', 3000, null);
      cancelNavigation();
      return;
    }
    activeRoute    = newRoute;
    stepIndex      = 0;
    autoRotateDone = false;

    if (window.LiveLocation && LiveLocation.setRoute) {
      LiveLocation.setRoute(activeRoute, stepIndex);
    }

    updateHUD();
    var nextStep = newRoute.path[1];
    if (nextStep) autoRotateTo(nextStep.pan, nextStep.tilt);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: LIVE LOCATION
  // ─────────────────────────────────────────────────────────────────────────────

  function initLiveLocationModule() {
    if (!window.LiveLocation) return;
    LiveLocation.init({
      nodes: Object.keys(nodes).map(function (id) { return nodes[id]; }),
      onStatus: handleLiveStatusUpdate,
      onNodeChange: handleLiveNodeChange,
      onRouteAdvance: handleLiveRouteAdvance,
      onError: handleLiveLocationError
    });
  }

  function handleLiveStatusUpdate(status) {
    liveStatus = status;
    var statusEl = document.getElementById('nav-mode-status');
    if (statusEl) {
      var label = status === 'watching' ? 'Tracking' :
                  status === 'searching' ? 'Searching GPS' :
                  status === 'tracking' ? 'Live tracking active' :
                  status === 'out_of_coverage' ? 'Out of coverage' :
                  status === 'denied' ? 'GPS denied' :
                  status === 'unavailable' ? 'GPS unavailable' :
                  status === 'unsupported' ? 'GPS unsupported' :
                  status === 'error' ? 'GPS error' :
                  status === 'stopped' ? 'Live GPS off' :
                  status;
      statusEl.textContent = 'Live mode: ' + label;
    }

    if (status === 'out_of_coverage') {
      showToast('You are out of coverage areas to use live location.', 0, null);
    } else if (status === 'unsupported') {
      showToast('Live location requires a secure browser environment (HTTPS or localhost).', 0, null);
    } else if (status === 'unavailable') {
      showToast('GPS unavailable. Try moving to a location with better signal.', 0, null);
    } else if (status === 'denied') {
      showToast('GPS permission denied. Please allow location access.', 0, null);
    } else if (status === 'error') {
      showToast('Live GPS error. Check browser location settings.', 0, null);
    }
  }

  function handleLiveNodeChange(nodeId, node, distance) {
    if (!nodeId) return;
    if (navMode !== 'live') return;
    if (pano.getCurrentNode() === nodeId) return;
    pano.openNext('{' + nodeId + '}', {
      pan:  node.startPan  != null ? node.startPan  : 0,
      tilt: node.startTilt != null ? node.startTilt : 0,
      fov:  node.startFov  || 100
    });
    showToast('Live: moved to ' + node.title + ' (' + Math.round(distance) + 'm)', 2200, null);
  }

  function handleLiveRouteAdvance(nodeId, node, distance) {
    if (!activeRoute) return;
    var advanced = advanceStep(nodeId);
    if (!advanced) {
      console.log('[nav.js] Live route advance candidate not on expected next step:', nodeId);
    }
  }

  function handleLiveLocationError(err) {
    if (!err) return;
    showToast('GPS error: ' + (err.message || 'Unable to get location'), 3200, null);
  }

  function openDetectionModal() {
    var modal = document.getElementById('nav-detection-modal');
    if (!modal) return;
    var statusEl = document.getElementById('nav-detection-status');
    var closeBtn = document.getElementById('nav-detection-close');
    if (statusEl) statusEl.textContent = 'Requesting location permission...';
    if (closeBtn) closeBtn.style.display = 'none';
    modal.classList.add('active');

    // Start detection
    detectLocationForLive();
  }

  function closeDetectionModal() {
    var modal = document.getElementById('nav-detection-modal');
    if (modal) modal.classList.remove('active');
  }

  function detectLocationForLive() {
    if (!navigator.geolocation) {
      showDetectionError('Geolocation is not supported by your browser.');
      return;
    }

    var statusEl = document.getElementById('nav-detection-status');
    if (statusEl) statusEl.textContent = 'Detecting your location...';

    navigator.geolocation.getCurrentPosition(
      function (position) {
        var lat      = position.coords.latitude;
        var lng      = position.coords.longitude;
        var accuracy = position.coords.accuracy || 0;

        var closest = findClosestNodeForDetection(lat, lng);
        var inRange  = closest &&
                       closest.distance <= NODE_SELECT_RADIUS &&
                       (accuracy <= MAX_ACCEPTABLE_ACCURACY || closest.distance <= accuracy * 1.5 + 10);

        if (inRange) {
          var node   = closest.node;
          var nodeId = closest.nodeId;

          // Jump the panorama to the matched node
          if (pano && pano.openNext) {
            pano.openNext('{' + nodeId + '}', {
              pan:  node.startPan  != null ? node.startPan  : 0,
              tilt: node.startTilt != null ? node.startTilt : 0,
              fov:  node.startFov  || 100
            });
          }

          // Start continuous GPS tracking
          setNavigationMode('live');

          closeDetectionModal();
          showToast('Live: placed at ' + node.title, 2500, null);
          setTimeout(openSearchPanel, 400);
        } else {
          var msg = 'You are not near any mapped location on campus.';
          if (closest) {
            msg += ' (nearest is ' + Math.round(closest.distance) + 'm away)';
          }
          showDetectionError(msg);
        }
      },
      function (error) {
        var msg = 'Unable to get your location.';
        if (error.code === 1) msg = 'Location permission was denied. Please allow access in your browser settings.';
        else if (error.code === 2) msg = 'Location is currently unavailable. Check your GPS signal.';
        else if (error.code === 3) msg = 'Location request timed out. Move to an open area and try again.';
        showDetectionError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  function showDetectionError(message) {
    var statusEl = document.getElementById('nav-detection-status');
    var closeBtn = document.getElementById('nav-detection-close');
    if (statusEl) statusEl.textContent = message;
    if (closeBtn) closeBtn.style.display = 'block';
  }

  function findClosestNodeForDetection(lat, lng) {
    var best = null;
    var knownNodes = Object.keys(nodes).map(function (id) { return nodes[id]; }).filter(function (node) {
      return node && typeof node.lat === 'number' && typeof node.lng === 'number';
    });
    knownNodes.forEach(function (node) {
      var distance = haversine(lat, lng, node.lat, node.lng);
      if (best === null || distance < best.distance) {
        best = { nodeId: node.id, node: node, distance: distance };
      }
    });
    return best;
  }

  function setNavigationMode(mode) {
    if (mode !== 'manual' && mode !== 'live') return;
    if (navMode === mode) return;
    navMode = mode;

    var manualBtn = document.getElementById('nav-mode-manual');
    var liveBtn   = document.getElementById('nav-mode-live');
    if (manualBtn && liveBtn) {
      manualBtn.classList.toggle('active', mode === 'manual');
      liveBtn.classList.toggle('active', mode === 'live');
    }

    if (mode === 'live') {
      if (!window.LiveLocation || !LiveLocation.isSupported()) {
        handleLiveStatusUpdate('unsupported');
        showToast('Live GPS is not supported in this browser/environment.', 3200, null);
      } else {
        showToast('Requesting location permission…', 2200, null);
        LiveLocation.start();
      }
    } else {
      if (window.LiveLocation) {
        LiveLocation.stop();
      }
    }

    handleLiveStatusUpdate(window.LiveLocation ? LiveLocation.getStatus() : 'off');
    showToast('Navigation mode: ' + (mode === 'live' ? 'Live GPS' : 'Manual'), 2200, null);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: UI COMPONENTS
  // ─────────────────────────────────────────────────────────────────────────────

  function openModeChooser() {
    var chooser = document.getElementById('nav-mode-chooser');
    if (!chooser) return;
    chooser.classList.add('active');
  }

  function closeModeChooser() {
    var chooser = document.getElementById('nav-mode-chooser');
    if (!chooser) return;
    chooser.classList.remove('active');
  }

  function chooseModeAndOpen(mode) {
    closeModeChooser();
    if (mode === 'live') {
      openDetectionModal();
    } else {
      setNavigationMode(mode);
      window.requestAnimationFrame(openSearchPanel);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Search UI
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: SEARCH UI
  // ─────────────────────────────────────────────────────────────────────────────

  function openSearchPanel() {
    console.log('[nav.js] openSearchPanel');
    closeModeChooser();
    var panel = document.getElementById('nav-search-panel');
    if (!panel) {
      console.warn('[nav.js] openSearchPanel: nav-search-panel not found');
      return;
    }
    panel.style.display = 'block';
    panel.style.visibility = 'visible';
    panel.style.pointerEvents = 'auto';
    window.requestAnimationFrame(function () {
      panel.classList.add('open');
    });
    var input = document.getElementById('nav-search-input');
    if (input) { input.value = ''; input.focus(); }
    renderSearchResults('');
  }

  function closeSearchPanel() {
    var panel = document.getElementById('nav-search-panel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.style.pointerEvents = 'none';
    panel.style.visibility = 'hidden';
    panel.style.display = 'none';
  }

  // Build the flat search index once after nodes are parsed.
  // Each Location node expands into one entry per name-part (split on - and _).
  // e.g. "SLE-ODIP-Academic_Advisor" → ["SLE", "ODIP", "Academic Advisor"]
  // All entries for the same node share the same nodeId, so clicking any navigates there.
  var searchIndex = [];   // { label, nodeId, cat }

  function buildSearchIndex() {
    console.log('[nav.js] Building search index...');
    
    var SKIP = { 'location': 1, 'road': 1, 'all': 1 };

    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      if (!n || !n.title || !n.isLocation) return;

      console.log('[nav.js] Adding to search:', id, n.title, 'tags:', n.tags.join(','), 'isLocation:', n.isLocation);

      var cat = n.tags.find(function (t) {
        var tl = t.toLowerCase();
        return !SKIP[tl] && t.indexOf('IMG_') === -1;
      });

      // Split title on hyphens and underscores, clean up each part
      var rawTitle = n.title;
      var parts    = rawTitle.split(/[-_]+/).map(function (p) {
        return p.trim().replace(/_/g, ' ');
      }).filter(function (p) {
        // Drop very short parts and pure numbers (e.g. the "2" in "Career_Service-2")
        return p.length > 1 && !/^\d+$/.test(p);
      });

      // If splitting produced meaningful parts, use them; otherwise use the full title
      var labels = (parts.length > 1) ? parts : [rawTitle.replace(/[-_]/g, ' ')];

      // Also always include the full cleaned title as one entry (avoids missing it)
      var cleanFull = rawTitle.replace(/[-_]/g, ' ');
      if (labels.indexOf(cleanFull) === -1) labels.push(cleanFull);

      // Deduplicate labels for this node then push
      var seen = {};
      labels.forEach(function (label) {
        var key = label.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        searchIndex.push({ label: label, nodeId: id, cat: cat || null });
        console.log('[nav.js] Added search entry:', label, '->', id);
      });
    });

    console.log('[nav.js] Search index built with', searchIndex.length, 'entries');
    
    // Sort the whole index alphabetically once
    searchIndex.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function renderSearchResults(query) {
    var list = document.getElementById('nav-search-results');
    if (!list) return;
    var q = query.toLowerCase().trim();

    var filtered = q
      ? searchIndex.filter(function (e) { return e.label.toLowerCase().indexOf(q) !== -1; })
      : searchIndex;

    console.log('[nav.js] renderSearchResults:', filtered.length, 'results for query:', q);

    list.innerHTML = '';

    if (filtered.length === 0) {
      var empty = document.createElement('li');
      empty.className   = 'nav-result-empty';
      empty.textContent = 'No locations found';
      list.appendChild(empty);
      return;
    }

    var CATEGORY_ICONS = { Library: '📚', Office: '🏢', Classroom: '🎓', Cafeteria: '☕' };

    filtered.slice(0, 12).forEach(function (e) {
      var icon = (e.cat && CATEGORY_ICONS[e.cat]) ? CATEGORY_ICONS[e.cat] : '📍';

      var li = document.createElement('li');
      li.className = 'nav-result-item';
      li.innerHTML =
        '<span class="nav-ri-icon">' + icon + '</span>' +
        '<span class="nav-ri-body">' +
          '<span class="nav-ri-title">' + escapeHtml(e.label) + '</span>' +
          (e.cat ? '<span class="nav-ri-cat">' + escapeHtml(e.cat) + '</span>' : '') +
        '</span>';

      li.addEventListener('click', (function (nodeId) {
        return function () { startNavigation(nodeId); };
      }(e.nodeId)));
      list.appendChild(li);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUD — step counter strip at bottom-left
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: HUD (HEADS-UP DISPLAY)
  // ─────────────────────────────────────────────────────────────────────────────

  function updateHUD() {
    var hud = document.getElementById('nav-hud');
    if (!hud || !activeRoute) return;
    hud.classList.add('active');

    var path  = activeRoute.path;
    var total = path.length - 1;
    var dest  = path[path.length - 1];

    // Remaining distance
    var remaining = 0;
    for (var i = stepIndex; i < path.length - 1; i++) {
      var from = nodes[path[i].nodeId];
      var to   = nodes[path[i + 1].nodeId];
      if (from && to && from.lat && to.lat) {
        remaining += haversine(from.lat, from.lng, to.lat, to.lng);
      }
    }

    document.getElementById('nav-hud-dest').textContent = truncate(dest.title, 30);
    document.getElementById('nav-hud-dist').textContent = formatDist(remaining);

    // Step dots (max 8 shown)
    var dotsEl  = document.getElementById('nav-hud-dots');
    dotsEl.innerHTML = '';
    var maxDots = Math.min(total, 8);
    for (var d = 0; d < maxDots; d++) {
      var dot = document.createElement('span');
      dot.className = 'nav-dot';
      if (d < stepIndex)        dot.classList.add('done');
      else if (d === stepIndex) dot.classList.add('active');
      dotsEl.appendChild(dot);
    }
    if (total > 8) {
      var more       = document.createElement('span');
      more.className = 'nav-dot-more';
      more.textContent = '+' + (total - 8);
      dotsEl.appendChild(more);
    }
  }

  function formatDist(m) {
    if (m < 1000) return Math.round(m) + 'm';
    return (m / 1000).toFixed(1) + 'km';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Toast notification
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: TOAST NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  function showToast(msg, duration, actions) {
    if (activeToast) { activeToast.remove(); activeToast = null; }

    var toast = document.createElement('div');
    toast.className = 'nav-toast';

    var msgSpan       = document.createElement('span');
    msgSpan.textContent = msg;
    toast.appendChild(msgSpan);

    if (actions && actions.length) {
      var btnWrap       = document.createElement('div');
      btnWrap.className = 'nav-toast-actions';
      actions.forEach(function (a) {
        var btn       = document.createElement('button');
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          if (activeToast === toast) { toast.remove(); activeToast = null; }
          a.fn();
        });
        btnWrap.appendChild(btn);
      });
      toast.appendChild(btnWrap);
    }

    document.getElementById('container').appendChild(toast);
    activeToast = toast;

    if (duration > 0) {
      setTimeout(function () {
        if (activeToast === toast) { toast.remove(); activeToast = null; }
      }, duration);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Inject HTML — button, search panel, HUD
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: UI INJECTION
  // ─────────────────────────────────────────────────────────────────────────────

  function injectUI() {
    var container = document.getElementById('container');

    // ── Navigation trigger button ──────────────────────────────────────────────
    var btn   = document.createElement('button');
    btn.id    = 'nav-open-btn';
    btn.title = 'Navigate to a location';
    // Navigation / compass icon (paper-plane style)
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
    btn.addEventListener('click', function () {
      openModeChooser();
    });
    container.appendChild(btn);

    var overlayRoot = document.body || document.documentElement || container;

    // ── Mode chooser modal ─────────────────────────────────────────────────────
    var chooser = document.createElement('div');
    chooser.id = 'nav-mode-chooser';
    chooser.innerHTML =
      '<div class="nav-mode-chooser-card">' +
        '<div class="nav-mode-chooser-title">Choose navigation mode</div>' +
        '<div class="nav-mode-chooser-copy">Use live GPS to map your current node or choose manual mode to browse from the current panorama.</div>' +
        '<div class="nav-mode-chooser-buttons">' +
          '<button id="nav-chooser-live" type="button" class="nav-mode-chooser-btn nav-mode-live-btn">Live location</button>' +
          '<button id="nav-chooser-manual" type="button" class="nav-mode-chooser-btn nav-mode-manual-btn">Mechanical mode</button>' +
        '</div>' +
        '<button id="nav-chooser-cancel" class="nav-mode-chooser-close" type="button">Cancel</button>' +
      '</div>';
    overlayRoot.appendChild(chooser);

    // ── Detection modal for live mode ───────────────────────────────────────────
    var detection = document.createElement('div');
    detection.id = 'nav-detection-modal';
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
        '<button id="nav-mode-live" class="nav-mode-button" type="button">Live</button>' +
      '</div>' +
      '<div id="nav-mode-status" class="nav-mode-status">Live mode: off</div>' +
      '<ul id="nav-search-results"></ul>';
    overlayRoot.appendChild(panel);

    // ── Navigation HUD ────────────────────────────────────────────────────────
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
      renderSearchResults(this.value);
    });
    document.getElementById('nav-search-close').addEventListener('click', closeSearchPanel);
    document.getElementById('nav-mode-manual').addEventListener('click', function () { setNavigationMode('manual'); });
    document.getElementById('nav-mode-live').addEventListener('click', function () { setNavigationMode('live'); });
    document.getElementById('nav-chooser-live').addEventListener('click', function () { chooseModeAndOpen('live'); });
    document.getElementById('nav-chooser-manual').addEventListener('click', function () { chooseModeAndOpen('manual'); });
    document.getElementById('nav-chooser-cancel').addEventListener('click', closeModeChooser);
    document.getElementById('nav-detection-close').addEventListener('click', closeDetectionModal);
    document.getElementById('nav-hud-cancel').addEventListener('click',   cancelNavigation);

    // Close search panel on click outside
    document.addEventListener('click', function (e) {
      var p       = document.getElementById('nav-search-panel');
      var btn     = document.getElementById('nav-open-btn');
      var chooser = document.getElementById('nav-mode-chooser');
      var detection = document.getElementById('nav-detection-modal');
      var target = e.target;

      var isInSearch = p && p.contains(target);
      var isOpenButton = btn && (target === btn || btn.contains(target));
      var isInChooser = chooser && chooser.contains(target);
      var isInDetection = detection && detection.contains(target);

      if (p && p.classList.contains('open') &&
          !isInSearch && !isOpenButton && !isInChooser && !isInDetection) {
        closeSearchPanel();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Inject CSS
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: CSS INJECTION
  // ─────────────────────────────────────────────────────────────────────────────

  function injectStyles() {
    var s    = document.createElement('style');
    s.id     = 'nav-styles';
    s.textContent = [

      /* ── Nav open button ─────────────────────────────────────────────────── */
      '#nav-open-btn {',
      '  position: absolute;',
      '  bottom: 24px;',
      '  right: 24px;',
      '  z-index: 500;',
      '  width: 48px;',
      '  height: 48px;',
      '  border-radius: 50%;',
      '  border: none;',
      '  background: rgba(0,0,0,0.75);',
      '  color: #4FB5C2;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  box-shadow: 0 2px 12px rgba(0,0,0,0.5);',
      '  transition: background 0.2s, transform 0.15s;',
      '  backdrop-filter: blur(4px);',
      '}',
      '#nav-open-btn:hover {',
      '  background: rgba(79,181,194,0.25);',
      '  transform: scale(1.08);',
      '}',

      /* ── Search panel ────────────────────────────────────────────────────── */
      '#nav-search-panel {',
      '  position: fixed;',
      '  bottom: 84px;',
      '  right: 16px;',
      '  z-index: 10020;',
      '  width: 290px;',
      '  background: rgba(10,10,10,0.92);',
      '  border-radius: 14px;',
      '  box-shadow: 0 4px 24px rgba(0,0,0,0.6);',
      '  overflow: hidden;',
      '  transform: translateY(10px) scale(0.97);',
      '  opacity: 0;',
      '  visibility: hidden;',
      '  display: none;',
      '  pointer-events: none;',
      '  transition: opacity 0.18s ease, transform 0.18s ease;',
      '  backdrop-filter: blur(8px);',
      '}',
      '#nav-search-panel.open {',
      '  opacity: 1;',
      '  transform: translateY(0) scale(1);',
      '  pointer-events: all;',
      '}',
      '.nav-search-header {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 10px 12px;',
      '  border-bottom: 1px solid rgba(255,255,255,0.08);',
      '}',
      '.nav-mode-toggle {',
      '  display: flex;',
      '  gap: 6px;',
      '  padding: 10px 12px;',
      '  background: rgba(255,255,255,0.04);',
      '}',
      '.nav-mode-button {',
      '  flex: 1;',
      '  border: 1px solid rgba(255,255,255,0.14);',
      '  border-radius: 10px;',
      '  background: transparent;',
      '  color: rgba(255,255,255,0.78);',
      '  padding: 8px 10px;',
      '  cursor: pointer;',
      '  font-size: 12px;',
      '  transition: background 0.15s, border-color 0.15s, color 0.15s;',
      '}',
      '.nav-mode-button.active {',
      '  background: rgba(79,181,194,0.18);',
      '  border-color: rgba(79,181,194,0.35);',
      '  color: #fff;',
      '}',
      '.nav-mode-status {',
      '  padding: 0 12px 10px;',
      '  color: rgba(255,255,255,0.62);',
      '  font-size: 11px;',
      '  letter-spacing: 0.02em;',
      '}',
      '#nav-mode-chooser {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 10030;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  background: rgba(0,0,0,0.65);',
      '  opacity: 0;',
      '  pointer-events: none;',
      '  transition: opacity 0.22s ease;',
      '}',
      '#nav-mode-chooser.active {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',
      '.nav-mode-chooser-card {',
      '  width: min(360px, calc(100% - 40px));',
      '  padding: 24px;',
      '  border-radius: 18px;',
      '  background: rgba(12,14,18,0.98);',
      '  box-shadow: 0 20px 40px rgba(0,0,0,0.5);',
      '  text-align: center;',
      '  color: white;',
      '}',
      '.nav-mode-chooser-title {',
      '  margin-bottom: 12px;',
      '  font-size: 18px;',
      '  font-weight: 700;',
      '}',
      '.nav-mode-chooser-copy {',
      '  font-size: 13px;',
      '  color: rgba(255,255,255,0.76);',
      '  line-height: 1.5;',
      '  margin-bottom: 22px;',
      '}',
      '.nav-mode-chooser-buttons {',
      '  display: grid;',
      '  gap: 12px;',
      '  margin-bottom: 16px;',
      '}',
      '.nav-mode-chooser-btn {',
      '  width: 100%;',
      '  border: none;',
      '  border-radius: 12px;',
      '  padding: 12px 14px;',
      '  font-size: 14px;',
      '  cursor: pointer;',
      '  transition: transform 0.16s ease, background 0.16s ease;',
      '}',
      '.nav-mode-chooser-btn:hover {',
      '  transform: translateY(-1px);',
      '}',
      '.nav-mode-live-btn {',
      '  background: rgba(79,181,194,0.18);',
      '  color: white;',
      '}',
      '.nav-mode-manual-btn {',
      '  background: rgba(255,255,255,0.08);',
      '  color: white;',
      '}',
      '.nav-mode-chooser-close {',
      '  width: 100%;',
      '  border: 1px solid rgba(255,255,255,0.12);',
      '  border-radius: 12px;',
      '  background: transparent;',
      '  color: rgba(255,255,255,0.8);',
      '  padding: 10px 14px;',
      '  cursor: pointer;',
      '}',
      '#nav-detection-modal {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 1003;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  background: rgba(0,0,0,0.65);',
      '  opacity: 0;',
      '  pointer-events: none;',
      '  transition: opacity 0.22s ease;',
      '}',
      '#nav-detection-modal.active {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',
      '.nav-detection-card {',
      '  width: min(360px, calc(100% - 40px));',
      '  padding: 24px;',
      '  border-radius: 18px;',
      '  background: rgba(12,14,18,0.98);',
      '  box-shadow: 0 20px 40px rgba(0,0,0,0.5);',
      '  text-align: center;',
      '  color: white;',
      '}',
      '.nav-detection-title {',
      '  margin-bottom: 12px;',
      '  font-size: 18px;',
      '  font-weight: 700;',
      '}',
      '.nav-detection-copy {',
      '  font-size: 13px;',
      '  color: rgba(255,255,255,0.76);',
      '  line-height: 1.5;',
      '  margin-bottom: 16px;',
      '}',
      '.nav-detection-spinner {',
      '  width: 42px;',
      '  height: 42px;',
      '  border-radius: 50%;',
      '  border: 4px solid rgba(255,255,255,0.12);',
      '  border-top-color: #4FB5C2;',
      '  margin: 0 auto 16px;',
      '  animation: nav-loading-spin 1s linear infinite;',
      '}',
      '.nav-detection-close {',
      '  width: 100%;',
      '  border: 1px solid rgba(255,255,255,0.12);',
      '  border-radius: 12px;',
      '  background: transparent;',
      '  color: rgba(255,255,255,0.8);',
      '  padding: 10px 14px;',
      '  cursor: pointer;',
      '}',
      '#nav-search-input {',
      '  flex: 1;',
      '  background: transparent;',
      '  border: none;',
      '  outline: none;',
      '  color: white;',
      '  font-size: 14px;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '}',
      '#nav-search-input::placeholder { color: rgba(255,255,255,0.35); }',
      '#nav-search-close {',
      '  background: none;',
      '  border: none;',
      '  color: rgba(255,255,255,0.4);',
      '  cursor: pointer;',
      '  font-size: 14px;',
      '  padding: 2px 4px;',
      '}',
      '#nav-search-close:hover { color: white; }',

      '#nav-loading-overlay {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 10000;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  background: rgba(0,0,0,0.78);',
      '  opacity: 0;',
      '  pointer-events: none;',
      '  transition: opacity 0.25s ease;',
      '}',
      '#nav-loading-overlay.active {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',
      '.nav-loading-box {',
      '  width: min(320px, calc(100% - 40px));',
      '  padding: 24px 24px 22px;',
      '  border-radius: 18px;',
      '  background: rgba(12,14,18,0.96);',
      '  box-shadow: 0 18px 36px rgba(0,0,0,0.45);',
      '  text-align: center;',
      '  color: white;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '}',
      '.nav-loading-spinner {',
      '  width: 42px;',
      '  height: 42px;',
      '  border-radius: 50%;',
      '  border: 4px solid rgba(255,255,255,0.12);',
      '  border-top-color: #4FB5C2;',
      '  margin: 0 auto 16px;',
      '  animation: nav-loading-spin 1s linear infinite;',
      '}',
      '.nav-loading-title {',
      '  font-size: 16px;',
      '  font-weight: 700;',
      '  margin-bottom: 8px;',
      '}',
      '.nav-loading-status {',
      '  font-size: 13px;',
      '  color: rgba(255,255,255,0.78);',
      '  line-height: 1.5;',
      '}',
      '@keyframes nav-loading-spin {',
      '  0%   { transform: rotate(0deg); }',
      '  100% { transform: rotate(360deg); }',
      '}',
      '#nav-search-results {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 6px 0;',
      '  max-height: 320px;',
      '  overflow-y: auto;',
      '}',
      '#nav-search-results::-webkit-scrollbar { width: 4px; }',
      '#nav-search-results::-webkit-scrollbar-track { background: transparent; }',
      '#nav-search-results::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }',
      '.nav-result-item {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  padding: 9px 14px;',
      '  cursor: pointer;',
      '  transition: background 0.12s;',
      '}',
      '.nav-result-item:hover { background: rgba(255,255,255,0.07); }',
      '.nav-ri-icon { font-size: 16px; flex-shrink: 0; }',
      '.nav-ri-body { display: flex; flex-direction: column; min-width: 0; }',
      '.nav-ri-title {',
      '  color: white;',
      '  font-size: 13px;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '.nav-ri-cat {',
      '  color: #4FB5C2;',
      '  font-size: 10px;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.05em;',
      '  margin-top: 1px;',
      '}',
      '.nav-result-empty {',
      '  color: rgba(255,255,255,0.35);',
      '  font-size: 13px;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  padding: 12px 16px;',
      '  text-align: center;',
      '}',

      /* ── Navigation HUD ──────────────────────────────────────────────────── */
      '#nav-hud {',
      '  position: absolute;',
      '  bottom: 24px;',
      '  left: 24px;',
      '  z-index: 500;',
      '  min-width: 200px;',
      '  max-width: 260px;',
      '  background: rgba(0,0,0,0.82);',
      '  border-radius: 12px;',
      '  border-left: 3px solid #FF6B35;',
      '  padding: 10px 14px;',
      '  color: white;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  box-shadow: 0 2px 16px rgba(0,0,0,0.5);',
      '  backdrop-filter: blur(6px);',
      '  display: none;',
      '  pointer-events: auto;',
      '}',
      '#nav-hud.active { display: block; }',
      '.nav-hud-top {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  margin-bottom: 2px;',
      '}',
      '.nav-hud-label {',
      '  font-size: 9px;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.1em;',
      '  color: rgba(255,255,255,0.45);',
      '}',
      '#nav-hud-cancel {',
      '  background: none;',
      '  border: none;',
      '  color: rgba(255,255,255,0.35);',
      '  cursor: pointer;',
      '  font-size: 13px;',
      '  padding: 0 2px;',
      '  line-height: 1;',
      '}',
      '#nav-hud-cancel:hover { color: white; }',
      '#nav-hud-dest {',
      '  font-size: 14px;',
      '  font-weight: 600;',
      '  color: white;',
      '  margin-bottom: 8px;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '.nav-hud-bottom {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '}',
      '#nav-hud-dist {',
      '  font-size: 11px;',
      '  color: #4FB5C2;',
      '}',
      '#nav-hud-dots {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '}',
      '.nav-dot {',
      '  width: 6px;',
      '  height: 6px;',
      '  border-radius: 50%;',
      '  background: rgba(255,255,255,0.2);',
      '  display: inline-block;',
      '}',
      '.nav-dot.done   { background: #4FB5C2; }',
      '.nav-dot.active { background: #FF6B35; width: 8px; height: 8px; }',
      '.nav-dot-more   { font-size: 9px; color: rgba(255,255,255,0.35); margin-left: 2px; }',

      /* ── Toast ───────────────────────────────────────────────────────────── */
      '.nav-toast {',
      '  position: absolute;',
      '  top: 20px;',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  z-index: 600;',
      '  background: rgba(0,0,0,0.88);',
      '  color: white;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  font-size: 13px;',
      '  padding: 10px 18px;',
      '  border-radius: 24px;',
      '  box-shadow: 0 2px 14px rgba(0,0,0,0.5);',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '  white-space: nowrap;',
      '  pointer-events: auto;',
      '}',
      '.nav-toast-actions {',
      '  display: flex;',
      '  gap: 6px;',
      '}',
      '.nav-toast-actions button {',
      '  background: rgba(255,255,255,0.12);',
      '  border: 1px solid rgba(255,255,255,0.2);',
      '  color: white;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  font-size: 12px;',
      '  padding: 4px 12px;',
      '  border-radius: 12px;',
      '  cursor: pointer;',
      '  transition: background 0.12s;',
      '}',
      '.nav-toast-actions button:hover { background: rgba(255,255,255,0.25); }',

      /* ── Arrival card ────────────────────────────────────────────────────── */
      '#nav-arrival-card {',
      '  position: fixed;',
      '  top: 50%; left: 50%;',
      '  transform: translate(-50%, -48%) scale(0.88);',
      '  z-index: 10000;',
      '  width: 300px;',
      '  background: rgba(10,20,20,0.95);',
      '  border: 1.5px solid rgba(79,181,194,0.45);',
      '  border-radius: 20px;',
      '  padding: 32px 28px 28px;',
      '  text-align: center;',
      '  box-shadow: 0 8px 40px rgba(0,0,0,0.7), 0 0 60px rgba(79,181,194,0.15);',
      '  opacity: 0;',
      '  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);',
      '  cursor: pointer;',
      '  pointer-events: auto;',
      '  backdrop-filter: blur(12px);',
      '}',
      '#nav-arrival-card.nav-arrival-show {',
      '  opacity: 1;',
      '  transform: translate(-50%, -50%) scale(1);',
      '}',
      '#nav-arrival-card.nav-arrival-hide {',
      '  opacity: 0;',
      '  transform: translate(-50%, -52%) scale(0.92);',
      '}',
      '.nav-arrival-icon {',
      '  width: 60px; height: 60px;',
      '  border-radius: 50%;',
      '  background: linear-gradient(135deg, #4FB5C2, #2a8a96);',
      '  color: white;',
      '  font-size: 30px;',
      '  line-height: 60px;',
      '  margin: 0 auto 16px;',
      '  box-shadow: 0 0 24px rgba(79,181,194,0.5);',
      '}',
      '.nav-arrival-title {',
      '  color: #4FB5C2;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  font-size: 13px;',
      '  font-weight: 600;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.12em;',
      '  margin-bottom: 6px;',
      '}',
      '.nav-arrival-dest {',
      '  color: white;',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  font-size: 20px;',
      '  font-weight: 700;',
      '  line-height: 1.2;',
      '  margin-bottom: 14px;',
      '}',
      '.nav-arrival-sub {',
      '  color: rgba(255,255,255,0.35);',
      '  font-family: Montserrat, Arial, sans-serif;',
      '  font-size: 11px;',
      '}'

    ].join('\n');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // MODULE: UTILITIES
  // ─────────────────────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());
