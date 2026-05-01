// We created AppState as the single shared state container so every module reads
// and writes from one place instead of passing data through function arguments.
// We also wired set() to fire an EventBus event so any module can react to a
// state change without polling or holding a direct reference to another module.
(function (Nav) {
  'use strict';

  function AppState() {
    this.nodes  = {};
    this.graph  = {};

    this.activeRoute    = null;
    this.stepIndex      = 0;
    this.navActive      = false;
    this.navMode        = 'manual';
    this.navReady       = false;

    this.autoRotateDone = false;
    this.lastCamPan     = null;

    this.liveStatus = 'off';

    // We chose 50 m and 40 m after testing on the Ashesi campus — wider nets
    // caused false node switches on slow GPS hardware.
    this.NODE_SELECT_RADIUS      = 50;
    this.MAX_ACCEPTABLE_ACCURACY = 40;
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
