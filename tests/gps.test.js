'use strict';

/**
 * Tests for GPS algorithms:
 *   - Weighted centroid (the position averaging used in ModeChooser._finalize)
 *   - findAllNodesSorted (nearest-node selection used in _resolvePosition)
 *
 * The centroid formula is reproduced directly here — it is pure maths and
 * doesn't need the DOM or the full ModeChooser loaded.
 */

// ── Weighted centroid (mirrors ModeChooser._finalize logic) ──────────────────

function weightedCentroid(samples) {
  if (!samples.length) return null;
  var totalWeight = 0, wLat = 0, wLng = 0, bestAccuracy = Infinity;
  samples.forEach(function (s) {
    var w = 1 / (s.accuracy * s.accuracy);
    totalWeight += w;
    wLat += s.lat * w;
    wLng += s.lng * w;
    if (s.accuracy < bestAccuracy) bestAccuracy = s.accuracy;
  });
  return { lat: wLat / totalWeight, lng: wLng / totalWeight, bestAccuracy: bestAccuracy };
}

describe('GPS weighted centroid', () => {
  test('single sample → exact position returned', () => {
    const r = weightedCentroid([{ lat: 5.749, lng: -0.219, accuracy: 15 }]);
    expect(r.lat).toBeCloseTo(5.749, 8);
    expect(r.lng).toBeCloseTo(-0.219, 8);
  });

  test('two equal-accuracy samples → midpoint', () => {
    const r = weightedCentroid([
      { lat: 5.748, lng: -0.219, accuracy: 20 },
      { lat: 5.750, lng: -0.219, accuracy: 20 },
    ]);
    expect(r.lat).toBeCloseTo(5.749, 6);
  });

  test('10 m reading dominates 40 m outlier (weight ratio 16:1)', () => {
    const r = weightedCentroid([
      { lat: 5.7490, lng: -0.219, accuracy: 10 }, // near true position
      { lat: 5.7800, lng: -0.219, accuracy: 40 }, // outlier 300 m away
    ]);
    // 10 m weight = 1/100 = 0.01,  40 m weight = 1/1600 ≈ 0.000625
    // result must be very close to the accurate reading
    expect(Math.abs(r.lat - 5.7490)).toBeLessThan(0.003);
  });

  test('three good readings outweigh one bad one', () => {
    const good = { lat: 5.7490, lng: -0.219, accuracy: 10 };
    const bad  = { lat: 5.9000, lng: -0.219, accuracy: 50 };
    const r = weightedCentroid([good, good, good, bad]);
    expect(Math.abs(r.lat - 5.7490)).toBeLessThan(0.005);
  });

  test('bestAccuracy tracks the lowest accuracy value seen', () => {
    const r = weightedCentroid([
      { lat: 5.749, lng: -0.219, accuracy: 30 },
      { lat: 5.749, lng: -0.219, accuracy: 8  },
      { lat: 5.749, lng: -0.219, accuracy: 22 },
    ]);
    expect(r.bestAccuracy).toBe(8);
  });

  test('returns null for empty sample list', () => {
    expect(weightedCentroid([])).toBeNull();
  });
});

// ── findAllNodesSorted (mirrors ModeChooser logic) ────────────────────────────

beforeAll(() => {
  require('../modules/data/GraphBuilder.js'); // exposes Nav.haversine
});

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

describe('findAllNodesSorted', () => {
  const nodes = {
    near:  { id: 'near',  lat: 5.7490, lng: -0.2190 },
    mid:   { id: 'mid',   lat: 5.7495, lng: -0.2190 },
    far:   { id: 'far',   lat: 5.7510, lng: -0.2190 },
    noGps: { id: 'noGps', lat: NaN,    lng: NaN      },  // should be excluded
  };

  test('returns nearest node first', () => {
    const results = findAllNodesSorted(5.7490, -0.2190, nodes);
    expect(results[0].nodeId).toBe('near');
  });

  test('sorted ascending by distance', () => {
    const results = findAllNodesSorted(5.7490, -0.2190, nodes);
    const ids = results.map(r => r.nodeId);
    expect(ids).toEqual(['near', 'mid', 'far']);
  });

  test('excludes nodes with NaN coordinates', () => {
    const results = findAllNodesSorted(5.7490, -0.2190, nodes);
    expect(results.some(r => r.nodeId === 'noGps')).toBe(false);
  });

  test('returns empty array when no nodes have coordinates', () => {
    const results = findAllNodesSorted(5.749, -0.219, {
      x: { id: 'x', lat: null, lng: null },
    });
    expect(results).toHaveLength(0);
  });

  test('nearest distance is 0 when standing exactly on a node', () => {
    const results = findAllNodesSorted(5.7490, -0.2190, nodes);
    expect(results[0].distance).toBe(0);
  });
});
