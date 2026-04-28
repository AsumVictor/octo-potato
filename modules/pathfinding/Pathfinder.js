/**
 * Pathfinder — Dijkstra shortest path between two node IDs.
 *
 * Runs weighted Dijkstra first (ROAD edges cost 10× less, so the path strongly
 * prefers walkways). If that finds nothing it retries with raw geographic
 * distances as a fallback so the user always gets some route rather than a dead
 * end. find() returns null only if the nodes are genuinely disconnected.
 */
(function (Nav) {
  'use strict';

  var MAX_ITER = 1000;

  // ── Strategy base ────────────────────────────────────────────────────────────

  function DijkstraStrategy(useWeights) {
    this.useWeights = useWeights;
  }

  DijkstraStrategy.prototype.run = function (startId, endId, graph, nodes) {
    var dist    = {};
    var prev    = {};
    var visited = {};

    Object.keys(graph).forEach(function (id) { dist[id] = Infinity; prev[id] = null; });

    if (dist[startId] === undefined || dist[endId] === undefined) return null;

    dist[startId] = 0;
    var queue = [{ id: startId, d: 0 }];
    var iters = 0;
    var useWeights = this.useWeights;

    while (queue.length && iters < MAX_ITER) {
      iters++;
      queue.sort(function (a, b) { return a.d - b.d; });
      var curr = queue.shift();
      var u    = curr.id;

      if (visited[u]) continue;
      visited[u] = true;
      if (u === endId) break;

      var edges = graph[u] || [];
      for (var i = 0; i < edges.length; i++) {
        var edge    = edges[i];
        var edgeCost = useWeights ? edge.distance : edge.rawDistance;
        var nd      = dist[u] + edgeCost;
        if (nd < dist[edge.neighborId]) {
          dist[edge.neighborId] = nd;
          prev[edge.neighborId] = {
            fromId:       u,
            pan:          edge.pan,
            tilt:         edge.tilt,
            hotspotId:    edge.hotspotId,
            hotspotTitle: edge.title
          };
          queue.push({ id: edge.neighborId, d: nd });
        }
      }
    }

    if (dist[endId] === Infinity) return null;

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

    return { path: path, totalDistance: dist[endId] };
  };

  // ── Pathfinder Singleton ─────────────────────────────────────────────────────

  function Pathfinder() {
    this._weighted   = new DijkstraStrategy(true);
    this._unweighted = new DijkstraStrategy(false);
  }

  Pathfinder.prototype.find = function (startId, endId) {
    var state = Nav.AppState;
    var graph = state.graph;
    var nodes = state.nodes;

    var route = this._weighted.run(startId, endId, graph, nodes);
    if (!route || route.path.length < 2) {
      route = this._unweighted.run(startId, endId, graph, nodes);
    }
    return (route && route.path.length >= 2) ? route : null;
  };

  Nav.Pathfinder = new Pathfinder();

})(window.Nav = window.Nav || {});
