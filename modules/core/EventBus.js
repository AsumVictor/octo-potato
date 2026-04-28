/**
 * EventBus — modules talk to each other through here instead of holding
 * direct references. Keeps everything loosely coupled: Navigator doesn't
 * need to know LiveController exists, and vice versa.
 *
 * Standard usage:
 *   Nav.EventBus.on('nav:start', fn)   — subscribe
 *   Nav.EventBus.emit('nav:start', id) — publish
 *   Nav.EventBus.once(...)             — one-shot subscribe
 *   Nav.EventBus.off(event, fn)        — unsubscribe
 */
(function (Nav) {
  'use strict';

  function EventBus() {
    this._map = {};
  }

  EventBus.prototype.on = function (event, fn) {
    if (!this._map[event]) this._map[event] = [];
    this._map[event].push(fn);
    return this;
  };

  EventBus.prototype.off = function (event, fn) {
    var fns = this._map[event];
    if (!fns) return this;
    this._map[event] = fns.filter(function (f) { return f !== fn; });
    return this;
  };

  EventBus.prototype.once = function (event, fn) {
    var self = this;
    function wrapper(data) {
      self.off(event, wrapper);
      fn(data);
    }
    return this.on(event, wrapper);
  };

  EventBus.prototype.emit = function (event, data) {
    var fns = this._map[event];
    if (!fns || !fns.length) return;
    fns.slice().forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[EventBus] Error in handler for', event, e); }
    });
  };

  Nav.EventBus = new EventBus();

})(window.Nav = window.Nav || {});
