'use strict';

/**
 * Tests for Nav.Pathfinder (Dijkstra routing).
 * No DOM or GPS involved — just graph traversal.
 */

beforeAll(() => {
  require('../modules/core/EventBus.js');
  require('../modules/core/AppState.js');
  require('../modules/data/GraphBuilder.js');
  require('../modules/pathfinding/Pathfinder.js');
});

/** Load a node map into AppState and build the graph. */
function useGraph(nodeMap) {
  Nav.AppState.nodes = nodeMap;
  Nav.AppState.graph = Nav.GraphBuilder.build(nodeMap);
}

/** Shorthand to make a node with hotspot connections. */
function node(id, neighbors) {
  return {
    id,
    title: id,
    lat: 5.749, lng: -0.219,   // coordinates don't matter for routing tests
    isRoad: false,
    hotspots: neighbors.map((n, i) => ({
      id:       `hs_${id}_${i}`,
      targetId: n.to,
      pan:      n.pan  || 0,
      tilt:     n.tilt || 0,
      title:    `To ${n.to}`,
      distance: n.dist || 50,
    })),
  };
}

function roadNode(id, neighbors) {
  return { ...node(id, neighbors), isRoad: true };
}

// ── Basic connectivity ────────────────────────────────────────────────────────

describe('Pathfinder — basic connectivity', () => {
  test('returns null when nodes are not connected', () => {
    useGraph({
      A: node('A', []),
      B: node('B', []),
    });
    expect(Nav.Pathfinder.find('A', 'B')).toBeNull();
  });

  test('returns null for non-existent node IDs', () => {
    useGraph({ A: node('A', []) });
    expect(Nav.Pathfinder.find('A', 'GHOST')).toBeNull();
    expect(Nav.Pathfinder.find('GHOST', 'A')).toBeNull();
  });

  test('finds a direct one-hop path', () => {
    useGraph({
      A: node('A', [{ to: 'B', dist: 50 }]),
      B: node('B', [{ to: 'A', dist: 50 }]),
    });
    const route = Nav.Pathfinder.find('A', 'B');
    expect(route).not.toBeNull();
    expect(route.path.map(s => s.nodeId)).toEqual(['A', 'B']);
  });

  test('path includes pan/tilt from the hotspot', () => {
    useGraph({
      A: node('A', [{ to: 'B', dist: 50, pan: 90, tilt: -5 }]),
      B: node('B', [{ to: 'A', dist: 50, pan: 270 }]),
    });
    const route = Nav.Pathfinder.find('A', 'B');
    expect(route.path[1].pan).toBe(90);
    expect(route.path[1].tilt).toBe(-5);
  });
});

// ── Multi-hop routing ─────────────────────────────────────────────────────────

describe('Pathfinder — multi-hop', () => {
  test('finds path through an intermediate node', () => {
    useGraph({
      A: node('A', [{ to: 'B', dist: 10 }]),
      B: node('B', [{ to: 'A', dist: 10 }, { to: 'C', dist: 10 }]),
      C: node('C', [{ to: 'B', dist: 10 }]),
    });
    const route = Nav.Pathfinder.find('A', 'C');
    expect(route.path.map(s => s.nodeId)).toEqual(['A', 'B', 'C']);
  });

  test('picks shortest of two routes by distance', () => {
    // A→B→C (dist 10+10=20) vs A→D→C (dist 5+5=10)
    useGraph({
      A: node('A', [{ to: 'B', dist: 10 }, { to: 'D', dist: 5 }]),
      B: node('B', [{ to: 'A', dist: 10 }, { to: 'C', dist: 10 }]),
      D: node('D', [{ to: 'A', dist: 5  }, { to: 'C', dist: 5  }]),
      C: node('C', [{ to: 'B', dist: 10 }, { to: 'D', dist: 5  }]),
    });
    const route = Nav.Pathfinder.find('A', 'C');
    expect(route.path.map(s => s.nodeId)).toEqual(['A', 'D', 'C']);
  });
});

// ── ROAD node preference ──────────────────────────────────────────────────────

describe('Pathfinder — ROAD node weighting', () => {
  test('prefers path through ROAD nodes (0.1× cost) over a direct longer hop', () => {
    // Direct A→C costs 100. Via ROAD node: A→R→C costs 50*0.1 + 50*0.1 = 10
    useGraph({
      A:    node(    'A', [{ to: 'C', dist: 100 }, { to: 'R', dist: 50 }]),
      R:    roadNode('R', [{ to: 'A', dist: 50  }, { to: 'C', dist: 50 }]),
      C:    node(    'C', [{ to: 'A', dist: 100 }, { to: 'R', dist: 50 }]),
    });
    const route = Nav.Pathfinder.find('A', 'C');
    expect(route.path.map(s => s.nodeId)).toEqual(['A', 'R', 'C']);
  });
});
