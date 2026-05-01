'use strict';

beforeAll(() => {
  require('../modules/core/EventBus.js');
  require('../modules/core/AppState.js');
  require('../modules/data/GraphBuilder.js');
});

function node(id, neighbors, opts) {
  opts = opts || {};
  return {
    id, title: id,
    lat: opts.lat !== undefined ? opts.lat : 5.749,
    lng: opts.lng !== undefined ? opts.lng : -0.219,
    isRoad: !!opts.isRoad,
    hotspots: (neighbors || []).map(function (n, i) {
      return { id: 'hs_' + i, targetId: n.to, pan: 0, tilt: 0, title: '', distance: n.dist || 0 };
    })
  };
}

describe('GraphBuilder — build()', () => {
  test('creates an adjacency entry for every node', () => {
    const nm = { A: node('A', [{ to: 'B', dist: 10 }]), B: node('B', []) };
    const g  = Nav.GraphBuilder.build(nm);
    expect(g).toHaveProperty('A');
    expect(g).toHaveProperty('B');
  });

  test('uses the hotspot distance when it is > 0', () => {
    const nm = { A: node('A', [{ to: 'B', dist: 50 }]), B: node('B', []) };
    const g  = Nav.GraphBuilder.build(nm);
    expect(g['A'][0].rawDistance).toBe(50);
  });

  test('falls back to haversine distance when hotspot distance is 0', () => {
    const nm = {
      A: node('A', [{ to: 'B', dist: 0 }], { lat: 5.749, lng: -0.219 }),
      B: node('B', [],                       { lat: 5.750, lng: -0.219 })
    };
    const g = Nav.GraphBuilder.build(nm);
    expect(g['A'][0].rawDistance).toBeGreaterThan(0);
  });

  test('applies 0.1× weight multiplier when neighbour is a ROAD node', () => {
    const nm = {
      A: node('A', [{ to: 'R', dist: 100 }]),
      R: node('R', [], { isRoad: true })
    };
    const g = Nav.GraphBuilder.build(nm);
    expect(g['A'][0].distance).toBeCloseTo(10);
  });

  test('uses weight 1.0 for non-ROAD neighbour', () => {
    const nm = {
      A: node('A', [{ to: 'B', dist: 100 }]),
      B: node('B', [])
    };
    const g = Nav.GraphBuilder.build(nm);
    expect(g['A'][0].distance).toBe(100);
  });

  test('skips hotspots pointing to unknown nodes', () => {
    const nm = { A: node('A', [{ to: 'GHOST', dist: 10 }]) };
    const g  = Nav.GraphBuilder.build(nm);
    expect(g['A']).toHaveLength(0);
  });

  test('stores pan and tilt from the hotspot on each edge', () => {
    const nm = {
      A: { id: 'A', title: 'A', lat: 5.749, lng: -0.219, isRoad: false,
           hotspots: [{ id: 'h1', targetId: 'B', pan: 90, tilt: -5, title: '', distance: 50 }] },
      B: node('B', [])
    };
    const g = Nav.GraphBuilder.build(nm);
    expect(g['A'][0].pan).toBe(90);
    expect(g['A'][0].tilt).toBe(-5);
  });
});

describe('GraphBuilder — checkConnectivity()', () => {
  test('reports all nodes reachable in a fully connected graph', () => {
    const nm = {
      A: node('A', [{ to: 'B' }]),
      B: node('B', [{ to: 'C' }]),
      C: node('C', [])
    };
    const g   = Nav.GraphBuilder.build(nm);
    const res = Nav.GraphBuilder.checkConnectivity(g, 'A');
    expect(res.reachable).toBe(3);
    expect(res.isolated).toHaveLength(0);
  });

  test('detects an isolated node', () => {
    const nm = {
      A: node('A', [{ to: 'B' }]),
      B: node('B', []),
      X: node('X', [])
    };
    const g   = Nav.GraphBuilder.build(nm);
    const res = Nav.GraphBuilder.checkConnectivity(g, 'A');
    expect(res.isolated).toContain('X');
    expect(res.reachable).toBe(2);
  });

  test('uses the first node as seed when none specified', () => {
    const nm = { A: node('A', [{ to: 'B' }]), B: node('B', []) };
    const g   = Nav.GraphBuilder.build(nm);
    const res = Nav.GraphBuilder.checkConnectivity(g);
    expect(res.reachable).toBeGreaterThanOrEqual(1);
  });
});
