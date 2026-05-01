// We built GraphBuilder to convert the flat node map from NodeParser into an
// adjacency list that Pathfinder can run Dijkstra on.
// We also decided to expose haversine as Nav.haversine so every other module
// can calculate GPS distances without keeping its own copy of the formula.
(function (Nav) {
  'use strict';

  function GraphBuilder() {}

  GraphBuilder.prototype.build = function (nodeMap) {
    var g = {};

    Object.keys(nodeMap).forEach(function (id) {
      var node = nodeMap[id];
      g[id] = [];

      node.hotspots.forEach(function (hs) {
        var neighbor = nodeMap[hs.targetId];
        if (!neighbor) return;

        // We prefer the distance Pano2VR recorded on the hotspot because it was
        // measured directly in the field. We only fall back to haversine when
        // Pano2VR left the field at zero.
        var rawDist = hs.distance > 0
          ? hs.distance
          : haversine(node.lat, node.lng, neighbor.lat, neighbor.lng);

        // We weight ROAD-tagged edges at 0.1× so Dijkstra strongly prefers
        // proper walkways over cutting through buildings — it will still use
        // non-road edges if there is genuinely no other path.
        var weight      = neighbor.isRoad ? 0.1 : 1.0;
        var weightedDist = rawDist * weight;

        g[id].push({
          neighborId:  hs.targetId,
          pan:         hs.pan,
          tilt:        hs.tilt,
          hotspotId:   hs.id,
          title:       hs.title,
          distance:    weightedDist,
          rawDistance: rawDist
        });
      });
    });

    return g;
  };

  // We added checkConnectivity to run a BFS from a seed node at startup and log
  // any isolated nodes — this caught several broken hotspot links during testing.
  GraphBuilder.prototype.checkConnectivity = function (graph, seedId) {
    seedId = seedId || Object.keys(graph)[0];
    var visited = {};
    var queue   = [seedId];
    visited[seedId] = true;

    while (queue.length) {
      var curr  = queue.shift();
      var edges = graph[curr] || [];
      edges.forEach(function (e) {
        if (!visited[e.neighborId]) {
          visited[e.neighborId] = true;
          queue.push(e.neighborId);
        }
      });
    }

    var total    = Object.keys(graph).length;
    var reachable = Object.keys(visited).length;
    var isolated  = Object.keys(graph).filter(function (id) { return !visited[id]; });

    return { reachable: reachable, total: total, isolated: isolated };
  };

  function haversine(lat1, lng1, lat2, lng2) {
    var R    = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  Nav.GraphBuilder = new GraphBuilder();
  Nav.haversine    = haversine;

})(window.Nav = window.Nav || {});
