'use strict';

beforeAll(() => {
  require('../modules/rendering/Projector.js');
});

const W = 1920, H = 1080;
const CAM = { pan: 0, tilt: 0, fov: 90 };

describe('Projector — project()', () => {
  test('hotspot directly ahead lands at canvas centre', () => {
    const r = Nav.Projector.project(0, 0, CAM, W, H);
    expect(r.x).toBeCloseTo(W / 2);
    expect(r.y).toBeCloseTo(H / 2);
  });

  test('hotspot directly ahead is inView', () => {
    expect(Nav.Projector.project(0, 0, CAM, W, H).inView).toBe(true);
  });

  test('hotspot directly behind is not inView', () => {
    expect(Nav.Projector.project(180, 0, CAM, W, H).inView).toBe(false);
  });

  test('x increases as hotspot pan moves right of camera', () => {
    const left  = Nav.Projector.project(-20, 0, CAM, W, H);
    const right = Nav.Projector.project( 20, 0, CAM, W, H);
    expect(right.x).toBeGreaterThan(left.x);
  });

  test('y decreases (moves up on screen) as hotspot tilt increases', () => {
    const low  = Nav.Projector.project(0, -10, CAM, W, H);
    const high = Nav.Projector.project(0,  10, CAM, W, H);
    expect(high.y).toBeLessThan(low.y);
  });

  test('handles pan wrap-around near the ±180° boundary', () => {
    // camera at 175°, hotspot at -175° — angular gap is 10°, not 350°
    const cam = { pan: 175, tilt: 0, fov: 90 };
    const r   = Nav.Projector.project(-175, 0, cam, W, H);
    expect(Math.abs(r.dPan)).toBeCloseTo(10, 0);
  });

  test('wider FOV produces smaller pixels-per-degree ratio', () => {
    const narrow = Nav.Projector.project(10, 0, { pan: 0, tilt: 0, fov:  60 }, W, H);
    const wide   = Nav.Projector.project(10, 0, { pan: 0, tilt: 0, fov: 120 }, W, H);
    // With wider FOV the same angle maps to fewer pixels from centre
    expect(Math.abs(wide.x - W / 2)).toBeLessThan(Math.abs(narrow.x - W / 2));
  });

  test('returns dPan and dTilt values', () => {
    const r = Nav.Projector.project(30, -10, CAM, W, H);
    expect(r.dPan).toBeCloseTo(30);
    expect(r.dTilt).toBeCloseTo(-10);
  });
});

describe('Projector — normAngle()', () => {
  test('0 → 0',    () => expect(Nav.Projector.normAngle(0)).toBe(0));
  test('360 → 0',  () => expect(Nav.Projector.normAngle(360)).toBe(0));
  test('180 → -180', () => expect(Nav.Projector.normAngle(180)).toBe(-180));
  test('270 → -90',  () => expect(Nav.Projector.normAngle(270)).toBeCloseTo(-90));
  test('-270 → 90',  () => expect(Nav.Projector.normAngle(-270)).toBeCloseTo(90));
  test('-180 → -180', () => expect(Nav.Projector.normAngle(-180)).toBe(-180));
});
