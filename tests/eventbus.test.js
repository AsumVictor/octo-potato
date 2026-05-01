'use strict';

beforeAll(() => {
  require('../modules/core/EventBus.js');
});

beforeEach(() => {
  Nav.EventBus._map = {};
});

describe('EventBus — on / emit', () => {
  test('handler is called with the emitted data', () => {
    const fn = jest.fn();
    Nav.EventBus.on('test', fn);
    Nav.EventBus.emit('test', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  test('multiple handlers all fire on the same event', () => {
    const a = jest.fn(), b = jest.fn();
    Nav.EventBus.on('multi', a);
    Nav.EventBus.on('multi', b);
    Nav.EventBus.emit('multi', 'x');
    expect(a).toHaveBeenCalledWith('x');
    expect(b).toHaveBeenCalledWith('x');
  });

  test('emit with no listeners does not throw', () => {
    expect(() => Nav.EventBus.emit('nobody:listening')).not.toThrow();
  });

  test('a throwing handler does not prevent other handlers from running', () => {
    const bad  = jest.fn(() => { throw new Error('boom'); });
    const good = jest.fn();
    Nav.EventBus.on('err', bad);
    Nav.EventBus.on('err', good);
    expect(() => Nav.EventBus.emit('err')).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  test('handler removing itself during emit does not skip the next handler', () => {
    const order = [];
    const self = jest.fn(() => {
      Nav.EventBus.off('chain', self);
      order.push('self');
    });
    const next = jest.fn(() => order.push('next'));
    Nav.EventBus.on('chain', self);
    Nav.EventBus.on('chain', next);
    Nav.EventBus.emit('chain');
    expect(order).toEqual(['self', 'next']);
  });
});

describe('EventBus — off', () => {
  test('removed handler is not called', () => {
    const fn = jest.fn();
    Nav.EventBus.on('off:test', fn);
    Nav.EventBus.off('off:test', fn);
    Nav.EventBus.emit('off:test');
    expect(fn).not.toHaveBeenCalled();
  });

  test('off on an unknown event does not throw', () => {
    expect(() => Nav.EventBus.off('ghost', jest.fn())).not.toThrow();
  });

  test('only the specified handler is removed — others still fire', () => {
    const a = jest.fn(), b = jest.fn();
    Nav.EventBus.on('partial', a);
    Nav.EventBus.on('partial', b);
    Nav.EventBus.off('partial', a);
    Nav.EventBus.emit('partial');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});

describe('EventBus — once', () => {
  test('once handler fires on first emit only', () => {
    const fn = jest.fn();
    Nav.EventBus.once('one', fn);
    Nav.EventBus.emit('one', 1);
    Nav.EventBus.emit('one', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  test('once handler receives the correct payload', () => {
    const fn = jest.fn();
    Nav.EventBus.once('payload', fn);
    Nav.EventBus.emit('payload', { key: 'value' });
    expect(fn).toHaveBeenCalledWith({ key: 'value' });
  });
});
