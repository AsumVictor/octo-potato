// We added LoadingOverlay to block interaction while the panorama XML and tile
// images load at startup. We also disable the nav open button here so the user
// cannot try to navigate before the graph and search index are ready.
(function (Nav) {
  'use strict';

  function LoadingOverlay() {
    this._el = null;
  }

  LoadingOverlay.prototype.create = function () {
    if (this._el) return;
    var body = document.body || document.getElementsByTagName('body')[0];
    if (!body) return;

    var el = document.createElement('div');
    el.id        = 'nav-loading-overlay';
    el.className = 'nav-loading-overlay';
    el.innerHTML =
      '<div class="nav-loading-box">' +
        '<div class="nav-loading-spinner"></div>' +
        '<div class="nav-loading-title">Preparing the tour</div>' +
        '<div id="nav-loading-status" class="nav-loading-status">Loading navigation data...</div>' +
      '</div>';
    body.appendChild(el);
    this._el = el;
  };

  LoadingOverlay.prototype.show = function (message) {
    if (!this._el) return;
    if (message) this.setMessage(message);
    this._el.classList.add('active');
    this._disableNavBtn(true);
  };

  LoadingOverlay.prototype.hide = function () {
    if (!this._el) return;
    this._el.classList.remove('active');
    this._disableNavBtn(false);
  };

  LoadingOverlay.prototype.setMessage = function (message) {
    var el = this._el && this._el.querySelector('#nav-loading-status');
    if (el) el.textContent = message;
  };

  LoadingOverlay.prototype._disableNavBtn = function (disabled) {
    var btn = document.getElementById('nav-open-btn');
    if (!btn) return;
    btn.disabled            = !!disabled;
    btn.style.pointerEvents = disabled ? 'none' : 'auto';
    btn.style.opacity       = disabled ? '0.3'  : '1';
  };

  Nav.LoadingOverlay = new LoadingOverlay();

})(window.Nav = window.Nav || {});
