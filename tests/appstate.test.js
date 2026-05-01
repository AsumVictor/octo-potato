'use strict';

beforeAll(() => {
  require('../modules/core/EventBus.js');
  require('../modules/core/AppState.js');
});

beforeEach(() => {
  Nav.EventBus._map = {};
  Nav.AppState.reset();
});

describe('AppState — initial values', () => {
  test('nodes and graph start empty', () => {
    expect(Nav.AppState.nodes).toEqual({});
    expect(Nav.AppState.graph).toEqual({});
  });

  test('navActive starts false', () => {
    expect(Nav.AppState.navActive).toBe(false);
  });

  test('navMode starts as manual', () => {
    expect(Nav.AppState.navMode).toBe('manual');
  });

  test('stepIndex starts at 0', () => {
    expect(Nav.AppState.stepIndex).toBe(0);
  });

  test('NODE_SELECT_RADIUS is 50', () => {
    expect(Nav.AppState.NODE_SELECT_RADIUS).toBe(50);
  });
});

describe('AppState — set()', () => {
  test('updates the stored value', () => {
    Nav.AppState.set('navMode', 'live');
    expect(Nav.AppState.navMode).toBe('live');
  });

  test('emits state:<key> event on EventBus', () => {
    const fn = jest.fn();
    Nav.EventBus.on('state:navActive', fn);
    Nav.AppState.set('navActive', true);
    expect(fn).toHaveBeenCalledWith(true);
  });

  test('emits with the new value, not the old one', () => {
    const received = [];
    Nav.EventBus.on('state:stepIndex', v => received.push(v));
    Nav.AppState.set('stepIndex', 3);
    Nav.AppState.set('stepIndex', 7);
    expect(received).toEqual([3, 7]);
  });
});

describe('AppState — reset()', () => {
  test('clears activeRoute to null', () => {
    Nav.AppState.activeRoute = { path: [] };
    Nav.AppState.reset();
    expect(Nav.AppState.activeRoute).toBeNull();
  });

  test('resets stepIndex to 0', () => {
    Nav.AppState.stepIndex = 5;
    Nav.AppState.reset();
    expect(Nav.AppState.stepIndex).toBe(0);
  });

  test('sets navActive to false', () => {
    Nav.AppState.navActive = true;
    Nav.AppState.reset();
    expect(Nav.AppState.navActive).toBe(false);
  });

  test('sets autoRotateDone to false', () => {
    Nav.AppState.autoRotateDone = true;
    Nav.AppState.reset();
    expect(Nav.AppState.autoRotateDone).toBe(false);
  });
});
