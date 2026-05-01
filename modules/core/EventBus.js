// We built EventBus so modules could talk to each other without holding direct
// references to one another. Navigator doesn't need to know LiveController
// exists — it just emits 'nav:started' and whoever cares will respond.
// We also added once() for cases where a module only needs to hear something
// the first time, like waiting for the panorama config to finish loading.
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

  // We slice the handler array before iterating so that a handler removing
  // itself during the emit doesn't skip the next handler in the list.
  EventBus.prototype.emit = function (event, data) {
    var fns = this._map[event];
    if (!fns || !fns.length) return;
    fns.slice().forEach(function (fn) {
      try { fn(data); } catch (e) { console.error('[EventBus] Error in handler for', event, e); }
    });
  };

  Nav.EventBus = new EventBus();

})(window.Nav = window.Nav || {});
