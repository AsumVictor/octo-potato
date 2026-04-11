/**
 * EventBus — Observer / pub-sub for cross-module communication.
 * Pattern: Observer
 * All inter-module events flow through Nav.EventBus so modules never
 * hold direct references to each other.
 *
 * Key events:
 *   player:ready          – pano player + XML fully loaded
 *   nav:start(destId)     – user picked a destination
 *   nav:step(nodeId)      – panorama changed while navigating
 *   nav:arrive(title)     – reached destination
 *   nav:cancel            – navigation cancelled
 *   nav:reroute(nodeId)   – off-route, rerouting from nodeId
 *   mode:change(mode)     – 'manual' | 'live'
 *   live:node-change      – GPS found a new closest node
 *   live:status(status)   – GPS tracking status update
 *   live:route-advance    – GPS auto-advanced a route step
 *   live:error(err)       – GPS error
 *   ui:search-open        – search panel opened
 *   ui:search-close       – search panel closed
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
