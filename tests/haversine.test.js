'use strict';

/**
 * Tests for Nav.haversine (exposed by GraphBuilder.js).
 * Pure maths — no DOM, no GPS, no mocks needed.
 */

beforeAll(() => {
  require('../modules/data/GraphBuilder.js');
});

describe('Nav.haversine', () => {
  test('returns 0 for identical coordinates', () => {
    expect(Nav.haversine(5.749, -0.219, 5.749, -0.219)).toBe(0);
  });

  test('is symmetric — A→B equals B→A', () => {
    const d1 = Nav.haversine(5.749, -0.219, 5.751, -0.220);
    const d2 = Nav.haversine(5.751, -0.220, 5.749, -0.219);
    expect(d1).toBeCloseTo(d2, 6);
  });

  test('0.001° latitude ≈ 111 m', () => {
    // One thousandth of a degree of latitude is ~111 m everywhere on Earth
    const dist = Nav.haversine(5.749, -0.219, 5.750, -0.219);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(120);
  });

  test('calculates a known real-world distance (Accra → Kumasi ≈ 200 km straight line)', () => {
    // Accra: 5.6037°N, 0.1870°W  |  Kumasi: 6.6884°N, 1.6244°W
    // Straight-line (great-circle) distance ≈ 200 km
    const km = Nav.haversine(5.6037, -0.1870, 6.6884, -1.6244) / 1000;
    expect(km).toBeGreaterThan(190);
    expect(km).toBeLessThan(210);
  });

  test('returns metres, not kilometres', () => {
    // Two points ~1 m apart should not return a sub-1 value
    const dist = Nav.haversine(5.7490000, -0.2190000, 5.7490001, -0.2190000);
    expect(dist).toBeGreaterThan(0.001);
    expect(dist).toBeLessThan(1);
  });
});
