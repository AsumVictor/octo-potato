'use strict';

beforeAll(() => {
  require('../modules/core/EventBus.js');
  require('../modules/core/AppState.js');
  require('../modules/utils/Utils.js');
  require('../modules/data/GraphBuilder.js');
  require('../modules/pathfinding/Pathfinder.js');
  require('../modules/navigation/Navigator.js');
});

beforeEach(() => {
  Nav.Toast       = { show: jest.fn() };
  Nav.HUD         = { update: jest.fn(), hide: jest.fn() };
  Nav.AutoRotator = { rotateTo: jest.fn(), cancel: jest.fn() };
  Nav.SearchPanel = { close: jest.fn() };
  Nav.EventBus._map = {};
  Nav.AppState.reset();
  Nav.AppState.navReady = true;

  pano.getCurrentNode.mockReturnValue('A');

  // _playArrival appends a card to the DOM — stub it out so tests don't touch real nodes
  jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
});

function makeRoute(ids) {
  return { path: ids.map(id => ({ nodeId: id, title: id, pan: 0, tilt: 0 })) };
}

function useGraph(nodeMap) {
  Nav.AppState.nodes = nodeMap;
  Nav.AppState.graph = Nav.GraphBuilder.build(nodeMap);
}

function node(id, neighbors) {
  return {
    id, title: id, lat: 5.749, lng: -0.219, isRoad: false,
    hotspots: (neighbors || []).map((n, i) => ({
      id: 'hs_' + i, targetId: n.to, pan: n.pan || 0,
      tilt: 0, title: '', distance: n.dist || 10
    }))
  };
}

// ── _advanceStep ──────────────────────────────────────────────────────────────

describe('Navigator — _advanceStep()', () => {
  beforeEach(() => {
    Nav.AppState.activeRoute = makeRoute(['A', 'B', 'C', 'D']);
    Nav.AppState.stepIndex   = 0;
    Nav.AppState.navActive   = true;
  });

  test('returns true and advances stepIndex when arriving at next expected node', () => {
    const ok = Nav.Navigator._advanceStep('B');
    expect(ok).toBe(true);
    expect(Nav.AppState.stepIndex).toBe(1);
  });

  test('returns false when arriving at an unexpected node', () => {
    expect(Nav.Navigator._advanceStep('X')).toBe(false);
  });

  test('stepIndex is unchanged after a false advance', () => {
    Nav.Navigator._advanceStep('X');
    expect(Nav.AppState.stepIndex).toBe(0);
  });

  test('handles skipping ahead to a node further along the path', () => {
    const ok = Nav.Navigator._advanceStep('C');
    expect(ok).toBe(true);
    expect(Nav.AppState.stepIndex).toBe(2);
  });

  test('sets navActive false when reaching the final destination', () => {
    Nav.AppState.activeRoute = makeRoute(['A', 'B']);
    Nav.Navigator._advanceStep('B');
    expect(Nav.AppState.navActive).toBe(false);
  });

  test('calls HUD.update after advancing to a mid-route node', () => {
    Nav.Navigator._advanceStep('B');
    expect(Nav.HUD.update).toHaveBeenCalled();
  });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe('Navigator — cancel()', () => {
  beforeEach(() => {
    Nav.AppState.navActive   = true;
    Nav.AppState.activeRoute = makeRoute(['A', 'B']);
  });

  test('sets navActive to false', () => {
    Nav.Navigator.cancel();
    expect(Nav.AppState.navActive).toBe(false);
  });

  test('calls AutoRotator.cancel', () => {
    Nav.Navigator.cancel();
    expect(Nav.AutoRotator.cancel).toHaveBeenCalled();
  });

  test('calls HUD.hide', () => {
    Nav.Navigator.cancel();
    expect(Nav.HUD.hide).toHaveBeenCalled();
  });

  test('emits nav:cancel on EventBus', () => {
    const fn = jest.fn();
    Nav.EventBus.on('nav:cancel', fn);
    Nav.Navigator.cancel();
    expect(fn).toHaveBeenCalled();
  });
});

// ── handleNodeChange ──────────────────────────────────────────────────────────

describe('Navigator — handleNodeChange()', () => {
  test('does nothing when nav is not active', () => {
    Nav.AppState.navActive   = false;
    Nav.AppState.activeRoute = makeRoute(['A', 'B']);
    Nav.Navigator.handleNodeChange('B');
    expect(Nav.HUD.update).not.toHaveBeenCalled();
  });

  test('advances the route when the user moves to the expected next node', () => {
    Nav.AppState.activeRoute = makeRoute(['A', 'B', 'C']);
    Nav.AppState.stepIndex   = 0;
    Nav.AppState.navActive   = true;
    Nav.Navigator.handleNodeChange('B');
    expect(Nav.AppState.stepIndex).toBe(1);
  });

  test('emits nav:off-route when user moves to an unexpected node', () => {
    Nav.AppState.activeRoute = makeRoute(['A', 'B', 'C']);
    Nav.AppState.stepIndex   = 0;
    Nav.AppState.navActive   = true;
    const fn = jest.fn();
    Nav.EventBus.on('nav:off-route', fn);
    Nav.Navigator.handleNodeChange('Z');
    expect(fn).toHaveBeenCalledWith('Z');
  });
});

// ── reroute ───────────────────────────────────────────────────────────────────

describe('Navigator — reroute()', () => {
  test('updates activeRoute to the new path', () => {
    useGraph({
      X: node('X', [{ to: 'Y' }]),
      Y: node('Y', [{ to: 'Z' }]),
      Z: node('Z', [])
    });
    Nav.AppState.activeRoute = makeRoute(['A', 'B', 'Z']);
    Nav.Navigator.reroute('X');
    expect(Nav.AppState.activeRoute.path[0].nodeId).toBe('X');
    expect(Nav.AppState.activeRoute.path[Nav.AppState.activeRoute.path.length - 1].nodeId).toBe('Z');
  });

  test('resets stepIndex to 0 after reroute', () => {
    useGraph({
      X: node('X', [{ to: 'Z' }]),
      Z: node('Z', [])
    });
    Nav.AppState.activeRoute = makeRoute(['A', 'Z']);
    Nav.AppState.stepIndex   = 1;
    Nav.Navigator.reroute('X');
    expect(Nav.AppState.stepIndex).toBe(0);
  });

  test('emits nav:reroute on EventBus', () => {
    useGraph({
      X: node('X', [{ to: 'Z' }]),
      Z: node('Z', [])
    });
    Nav.AppState.activeRoute = makeRoute(['A', 'Z']);
    const fn = jest.fn();
    Nav.EventBus.on('nav:reroute', fn);
    Nav.Navigator.reroute('X');
    expect(fn).toHaveBeenCalled();
  });

  test('cancels and shows toast when no path exists from the new position', () => {
    useGraph({
      X: node('X', []),
      Z: node('Z', [])
    });
    Nav.AppState.activeRoute = makeRoute(['A', 'Z']);
    Nav.AppState.navActive   = true;
    Nav.Navigator.reroute('X');
    expect(Nav.Toast.show).toHaveBeenCalled();
    expect(Nav.AppState.navActive).toBe(false);
  });
});
