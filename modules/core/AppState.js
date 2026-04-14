/**
 * AppState — everything the app needs to share between modules lives here.
 *
 * Nodes, the current route, step index, nav mode — all of it. If two modules
 * both need to know something, it goes in here rather than one module calling
 * into the other. set(key, value) also fires a 'state:<key>' event on EventBus
 * so any module can react to changes without polling.
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
