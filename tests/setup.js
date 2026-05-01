'use strict';

// ── Nav namespace ─────────────────────────────────────────────────────────────
global.Nav = {};

// ── Pano2VR player stub ───────────────────────────────────────────────────────
global.pano = {
  getCurrentNode:  jest.fn(() => null),
  openNext:        jest.fn(),
  getPan:          jest.fn(() => 0),
  getTilt:         jest.fn(() => 0),
  getFov:          jest.fn(() => 100),
  setPanTiltFov:   jest.fn(),
  stopAutorotate:  jest.fn(),
  addListener:     jest.fn(),
};

// ── Geolocation stub ─────────────────────────────────────────────────────────
// jsdom omits geolocation; add a writable mock so modules don't crash.
Object.defineProperty(global.navigator, 'geolocation', {
  value: {
    watchPosition:      jest.fn(),
    clearWatch:         jest.fn(),
    getCurrentPosition: jest.fn(),
  },
  writable: true,
  configurable: true,
});

// ── DOM stubs ─────────────────────────────────────────────────────────────────
// Modules that access DOM during load (StyleInjector, UIBuilder) need minimal stubs.
// Tests that care about DOM behaviour should set up a real jsdom fixture themselves.
const mockEl = () => ({
  classList:        { add: jest.fn(), remove: jest.fn(), toggle: jest.fn(), contains: jest.fn() },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  appendChild:      jest.fn(),
  style:            {},
  textContent:      '',
  innerHTML:        '',
});

jest.spyOn(document, 'getElementById').mockReturnValue(null);
jest.spyOn(document, 'querySelector').mockReturnValue(null);
jest.spyOn(document, 'createElement').mockImplementation(() => mockEl());
