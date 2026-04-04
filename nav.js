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
  // State
  // ─────────────────────────────────────────────────────────────────────────────

  var nodes       = {};     // nodeId → NodeData
  var graph       = {};     // nodeId → Edge[]
  var activeRoute = null;   // Route | null — only set while navigating
  var stepIndex   = 0;      // index into activeRoute.path for CURRENT position
  var navActive   = false;  // master flag — canvas draws nothing when false
  var overlayCanvas = null;
  var rafId       = null;
  var autoRafId   = null;
  var idleTimer   = null;
  var autoRotateDone = false;
  var activeToast = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Boot: wait for player + configloaded, then initialise
  // ─────────────────────────────────────────────────────────────────────────────

  window.addEventListener('load', function () {
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

  function initNav() {
    fetch('pano.xml?ts=27535862')
      .then(function (r) { return r.text(); })
      .then(function (xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        nodes = parseNodes(doc);
        graph = buildGraph(nodes);
        injectStyles();
        injectUI();
        createOverlayCanvas();
        bindPlayerEvents();
        startRenderLoop();
      })
      .catch(function (err) {
        console.warn('[nav.js] Failed to load pano.xml:', err);
      });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // XML Parsing — builds NodeData objects from pano.xml
  // ─────────────────────────────────────────────────────────────────────────────

  function parseNodes(doc) {
    var result = {};
    var panos  = doc.querySelectorAll('panorama');

    panos.forEach(function (panorama) {
      var ud = panorama.querySelector('userdata');
      if (!ud) return;

      var id      = panorama.getAttribute('id');
      var rawTags = ud.getAttribute('tags') || '';
      var tags    = rawTags.split('|').map(function (t) { return t.trim(); }).filter(Boolean);

      var hotspots = [];
      panorama.querySelectorAll('hotspot').forEach(function (hs) {
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
        tags:       tags,
        isRoad:     tags.indexOf('ROAD')     !== -1,
        isLocation: tags.indexOf('Location') !== -1,
        hotspots:   hotspots
      };
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Graph — adjacency list of ROAD-only nodes
  // ─────────────────────────────────────────────────────────────────────────────

  function buildGraph(nodeMap) {
    var g = {};

    Object.keys(nodeMap).forEach(function (id) {
      var node = nodeMap[id];
      if (!node.isRoad) return;
      g[id] = [];

      node.hotspots.forEach(function (hs) {
        var neighbor = nodeMap[hs.targetId];
        if (!neighbor || !neighbor.isRoad) return;
        var dist = hs.distance > 0 ? hs.distance : haversine(
          node.lat, node.lng, neighbor.lat, neighbor.lng
        );
        g[id].push({
          neighborId: hs.targetId,
          pan:        hs.pan,
          tilt:       hs.tilt,
          hotspotId:  hs.id,
          title:      hs.title,
          distance:   dist
        });
      });
    });

    return g;
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
  // Dijkstra — finds shortest path through ROAD nodes
  // ─────────────────────────────────────────────────────────────────────────────

  function dijkstra(startId, endId) {
    // If start is not a ROAD node (e.g., library interior), find nearest ROAD ancestor
    var effectiveStart = startId;
    if (!graph[startId]) {
      var anc = findRoadAncestor(startId);
      if (!anc) return null;
      effectiveStart = anc;
    }

    // If destination is not a ROAD node, route to the ROAD neighbor that leads to it
    var effectiveEnd = endId;
    var finalHop     = null;
    if (!graph[endId]) {
      var roadNeighbor = null;
      var nodeKeys = Object.keys(nodes);
      for (var i = 0; i < nodeKeys.length; i++) {
        var n = nodes[nodeKeys[i]];
        if (!n.isRoad) continue;
        for (var j = 0; j < n.hotspots.length; j++) {
          if (n.hotspots[j].targetId === endId) { roadNeighbor = n; break; }
        }
        if (roadNeighbor) break;
      }
      if (!roadNeighbor) return null;
      finalHop     = endId;
      effectiveEnd = roadNeighbor.id;
    }

    // Standard Dijkstra with simple array queue (≤143 nodes — fast enough)
    var dist    = {};
    var prev    = {};
    var visited = {};

    Object.keys(graph).forEach(function (id) { dist[id] = Infinity; prev[id] = null; });
    dist[effectiveStart] = 0;

    var queue = [{ id: effectiveStart, d: 0 }];

    while (queue.length > 0) {
      queue.sort(function (a, b) { return a.d - b.d; });
      var curr = queue.shift();
      var u    = curr.id;

      if (visited[u]) continue;
      visited[u] = true;
      if (u === effectiveEnd) break;

      var edges = graph[u] || [];
      for (var ei = 0; ei < edges.length; ei++) {
        var edge = edges[ei];
        if (visited[edge.neighborId]) continue;
        var newDist = dist[u] + edge.distance;
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

    if (dist[effectiveEnd] === Infinity) return null;

    // Reconstruct path (array of step objects)
    var path = [];
    var cur  = effectiveEnd;
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

    var totalDist = dist[effectiveEnd];

    // Append final hop to a non-ROAD destination
    if (finalHop && nodes[finalHop]) {
      var lastNode     = nodes[effectiveEnd];
      var finalHsData  = null;
      for (var hi = 0; hi < lastNode.hotspots.length; hi++) {
        if (lastNode.hotspots[hi].targetId === finalHop) {
          finalHsData = lastNode.hotspots[hi]; break;
        }
      }
      if (finalHsData) {
        path.push({
          nodeId:       finalHop,
          title:        nodes[finalHop].title,
          pan:          finalHsData.pan,
          tilt:         finalHsData.tilt,
          hotspotId:    finalHsData.id,
          hotspotTitle: finalHsData.title
        });
        totalDist += finalHsData.distance || 10;
      }
    }

    return { path: path, totalDistance: totalDist };
  }

  function findRoadAncestor(nodeId) {
    var nodeKeys = Object.keys(nodes);
    for (var i = 0; i < nodeKeys.length; i++) {
      var n = nodes[nodeKeys[i]];
      if (!n.isRoad) continue;
      for (var j = 0; j < n.hotspots.length; j++) {
        if (n.hotspots[j].targetId === nodeId) return n.id;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Navigation Control
  // ─────────────────────────────────────────────────────────────────────────────

  function startNavigation(destId) {
    var currentId = pano.getCurrentNode();

    if (currentId === destId) {
      showToast('You are already here!', 2500, null);
      return;
    }

    var route = dijkstra(currentId, destId);
    if (!route || route.path.length < 2) {
      showToast('No path found. Try navigating closer first.', 3000, null);
      return;
    }

    activeRoute = route;
    stepIndex   = 0;
    navActive   = true;
    autoRotateDone = false;

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
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

    // Full-screen flash
    var flash = document.createElement('div');
    flash.id  = 'nav-arrival-flash';
    document.getElementById('container').appendChild(flash);

    showToast('You have arrived at ' + title + '!', 4000, null);

    setTimeout(function () {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
      cancelNavigation();
    }, 1600);
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

  function createOverlayCanvas() {
    var container = document.getElementById('container');
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'nav-overlay-canvas';
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
    container.appendChild(overlayCanvas);
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!overlayCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w   = overlayCanvas.offsetWidth;
    var h   = overlayCanvas.offsetHeight;
    overlayCanvas.width  = w * dpr;
    overlayCanvas.height = h * dpr;
  }

  function startRenderLoop() {
    function loop() {
      render();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function render() {
    var dpr = window.devicePixelRatio || 1;
    var W   = overlayCanvas.offsetWidth;
    var H   = overlayCanvas.offsetHeight;
    var ctx = overlayCanvas.getContext('2d');

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!navActive || !activeRoute) { ctx.restore(); return; }

    var path = activeRoute.path;
    var next = path[stepIndex + 1];
    if (!next) { ctx.restore(); return; }

    var cam = { pan: pano.getPan(), tilt: pano.getTilt(), fov: pano.getFov() };

    // Try to get live hotspot position from player; fall back to XML values
    var targetPan  = next.pan;
    var targetTilt = next.tilt;
    var live = getLiveHotspotAngles(next.hotspotId);
    if (live) { targetPan = live.pan; targetTilt = live.tilt; }

    var pos = projectToScreen(targetPan, targetTilt, cam, W, H);

    if (pos.inView) {
      drawGlowingRings(ctx, pos.x, pos.y);
      drawBounceArrow(ctx, pos.x, pos.y);
      drawNavLabel(ctx, pos.x, pos.y, next, stepIndex, path.length - 1);
    } else {
      drawEdgeArrow(ctx, pos.dPan, pos.dTilt, W, H);
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

  function getLiveHotspotAngles(hotspotId) {
    if (!hotspotId) return null;
    try {
      var a = pano.getPositionAngles(hotspotId);
      if (!a) return null;
      // Returns {pan, tilt} or [pan, tilt] depending on version
      if (typeof a.pan  !== 'undefined') return { pan: a.pan,  tilt: a.tilt  };
      if (Array.isArray(a) && a.length >= 2) return { pan: a[0], tilt: a[1] };
    } catch (e) { /* fallback to XML values */ }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Glowing Rings
  // ─────────────────────────────────────────────────────────────────────────────

  function drawGlowingRings(ctx, x, y) {
    var t = (performance.now() % 1800) / 1800;   // 0→1 cycle every 1.8 s

    // Three expanding rings offset by ⅓ of the cycle each
    for (var i = 0; i < 3; i++) {
      var phase  = (t + i * 0.333) % 1.0;
      var radius = 18 + phase * 60;
      var alpha  = (1 - phase) * 0.85;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,107,53,' + alpha + ')';
      ctx.lineWidth   = 3 - phase * 2;
      ctx.stroke();
    }

    // Soft glow behind the centre dot
    var grd = ctx.createRadialGradient(x, y, 0, x, y, 18);
    grd.addColorStop(0, 'rgba(255,107,53,0.7)');
    grd.addColorStop(1, 'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Solid centre dot
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle   = '#FF6B35';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 2;
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

  function drawNavLabel(ctx, x, y, step, currentIdx, totalSteps) {
    var label   = step.hotspotTitle || step.title || 'Next';
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
    ctx.fillText(truncate(label, 28), lx + 12, ly + 17);

    // Counter text
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font      = '11px Montserrat, Arial, sans-serif';
    ctx.fillText(counter, lx + 12, ly + 33);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drawing: Off-Screen Compass Arrow (edge indicator)
  // ─────────────────────────────────────────────────────────────────────────────

  function drawEdgeArrow(ctx, dPan, dTilt, W, H) {
    // Map angular offset to screen angle
    var angle  = Math.atan2(-dTilt * (H / W), dPan);
    var margin = 50;

    // Place arrow at the screen edge in the direction of the hotspot
    var cx = W / 2, cy = H / 2;
    var ex = cx + Math.cos(angle) * (W / 2 - margin);
    var ey = cy + Math.sin(angle) * (H / 2 - margin);

    // Pulsing halo glow
    var pulse = 0.45 + 0.35 * Math.sin(performance.now() / 400);
    var grd   = ctx.createRadialGradient(ex, ey, 0, ex, ey, 40);
    grd.addColorStop(0, 'rgba(255,107,53,' + pulse + ')');
    grd.addColorStop(1, 'rgba(255,107,53,0)');
    ctx.beginPath();
    ctx.arc(ex, ey, 40, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Rotated arrow pointing toward the hotspot
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(angle);
    ctx.fillStyle   = '#FF6B35';
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo( 20,  0);
    ctx.lineTo(  6, -9);
    ctx.lineTo(  6, -4);
    ctx.lineTo(-13, -4);
    ctx.lineTo(-13,  4);
    ctx.lineTo(  6,  4);
    ctx.lineTo(  6,  9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Degree label below arrow
    var deg = Math.abs(Math.round(dPan));
    ctx.font      = 'bold 12px Montserrat, Arial, sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText(deg + '\u00B0', ex, ey + 32);
    ctx.textAlign = 'left';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers: roundRect, truncate
  // ─────────────────────────────────────────────────────────────────────────────

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
    pano.addListener('changenode', function () {
      if (!navActive || !activeRoute) return;
      var newId    = pano.getCurrentNode();
      var advanced = advanceStep(newId);
      if (!advanced) showReroutePrompt(newId);
    });

    // Reset idle timer on any user interaction inside the panorama
    var container = document.getElementById('container');
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
    var newRoute = dijkstra(fromNodeId, destId);
    if (!newRoute || newRoute.path.length < 2) {
      showToast('No path from here. Navigate manually.', 3000, null);
      cancelNavigation();
      return;
    }
    activeRoute    = newRoute;
    stepIndex      = 0;
    autoRotateDone = false;
    updateHUD();
    var nextStep = newRoute.path[1];
    if (nextStep) autoRotateTo(nextStep.pan, nextStep.tilt);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Search UI
  // ─────────────────────────────────────────────────────────────────────────────

  function openSearchPanel() {
    var panel = document.getElementById('nav-search-panel');
    if (!panel) return;
    panel.classList.add('open');
    var input = document.getElementById('nav-search-input');
    if (input) { input.value = ''; input.focus(); }
    renderSearchResults('');
  }

  function closeSearchPanel() {
    var panel = document.getElementById('nav-search-panel');
    if (panel) panel.classList.remove('open');
  }

  function renderSearchResults(query) {
    var list = document.getElementById('nav-search-results');
    if (!list) return;
    var q    = query.toLowerCase().trim();

    var locs = Object.keys(nodes)
      .map(function (id) { return nodes[id]; })
      .filter(function (n) { return n.isLocation; });

    var filtered = q
      ? locs.filter(function (n) {
          return n.title.toLowerCase().indexOf(q) !== -1 ||
                 n.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
        })
      : locs;

    // Sort alphabetically
    filtered.sort(function (a, b) { return a.title.localeCompare(b.title); });

    list.innerHTML = '';

    if (filtered.length === 0) {
      var empty = document.createElement('li');
      empty.className   = 'nav-result-empty';
      empty.textContent = 'No locations found';
      list.appendChild(empty);
      return;
    }

    var CATEGORY_ICONS = { Library: '📚', Office: '🏢', Classroom: '🎓', Cafeteria: '☕' };

    filtered.slice(0, 12).forEach(function (n) {
      var cat = n.tags.find(function (t) {
        return t !== 'Location' && t !== 'ROAD' && t !== 'all' && t.indexOf('IMG_') === -1;
      });
      var icon = (cat && CATEGORY_ICONS[cat]) ? CATEGORY_ICONS[cat] : '📍';

      var li = document.createElement('li');
      li.className = 'nav-result-item';
      li.innerHTML =
        '<span class="nav-ri-icon">' + icon + '</span>' +
        '<span class="nav-ri-body">' +
          '<span class="nav-ri-title">' + escapeHtml(n.title) + '</span>' +
          (cat ? '<span class="nav-ri-cat">' + escapeHtml(cat) + '</span>' : '') +
        '</span>';

      li.addEventListener('click', function () { startNavigation(n.id); });
      list.appendChild(li);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUD — step counter strip at bottom-left
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
      var p = document.getElementById('nav-search-panel');
      if (p && p.classList.contains('open')) closeSearchPanel();
      else openSearchPanel();
    });
    container.appendChild(btn);

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
      '<ul id="nav-search-results"></ul>';
    container.appendChild(panel);

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
    container.appendChild(hud);

    // ── Event bindings ────────────────────────────────────────────────────────
    document.getElementById('nav-search-input').addEventListener('input', function () {
      renderSearchResults(this.value);
    });
    document.getElementById('nav-search-close').addEventListener('click', closeSearchPanel);
    document.getElementById('nav-hud-cancel').addEventListener('click',   cancelNavigation);

    // Close search panel on click outside
    document.addEventListener('click', function (e) {
      var p   = document.getElementById('nav-search-panel');
      var btn = document.getElementById('nav-open-btn');
      if (p && p.classList.contains('open') &&
          !p.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeSearchPanel();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Inject CSS
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
      '  position: absolute;',
      '  bottom: 84px;',
      '  right: 16px;',
      '  z-index: 500;',
      '  width: 290px;',
      '  background: rgba(10,10,10,0.92);',
      '  border-radius: 14px;',
      '  box-shadow: 0 4px 24px rgba(0,0,0,0.6);',
      '  overflow: hidden;',
      '  transform: translateY(10px) scale(0.97);',
      '  opacity: 0;',
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

      /* ── Arrival flash ───────────────────────────────────────────────────── */
      '#nav-arrival-flash {',
      '  position: absolute;',
      '  inset: 0;',
      '  pointer-events: none;',
      '  z-index: 400;',
      '  background: radial-gradient(circle at center, rgba(79,181,194,0.45) 0%, transparent 65%);',
      '  animation: navFlash 1.4s ease-out forwards;',
      '}',
      '@keyframes navFlash {',
      '  0%   { opacity: 0; }',
      '  20%  { opacity: 1; }',
      '  100% { opacity: 0; }',
      '}'

    ].join('\n');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

}());
