/**
 * AppState — Singleton reactive state store.
 * Pattern: Singleton
 * Single source of truth for all shared runtime state.
 * Calling set(key, value) also emits 'state:<key>' on EventBus.
 */
(function (Nav) {
  'use strict';

  function AppState() {
    // Data layer
    this.nodes  = {};   // nodeId → NodeData
    this.graph  = {};   // nodeId → Edge[]

    // Navigation state
    this.activeRoute    = null;   // Route | null
    this.stepIndex      = 0;
    this.navActive      = false;
    this.navMode        = 'manual';
    this.navReady       = false;

    // Camera / render helpers
    this.autoRotateDone = false;
    this.lastCamPan     = null;

    // Live location
    this.liveStatus = 'off';

    // Config constants
    this.NODE_SELECT_RADIUS      = 50;   // metres
    this.MAX_ACCEPTABLE_ACCURACY = 40;  // metres
  }

  AppState.prototype.set = function (key, value) {
    this[key] = value;
    Nav.EventBus.emit('state:' + key, value);
  };

  AppState.prototype.reset = function () {
    this.activeRoute    = null;
    this.stepIndex      = 0;
    this.navActive      = false;
    this.autoRotateDone = false;
    this.lastCamPan     = null;
  };

  Nav.AppState = new AppState();

})(window.Nav = window.Nav || {});
