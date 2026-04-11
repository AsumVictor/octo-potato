/**
 * Toast — Singleton notification banner.
 * Pattern: Singleton
 * Appends a toast to #container. duration=0 means persistent until dismissed.
 * Actions are [ { label, fn } ] objects for action buttons.
 */
(function (Nav) {
  'use strict';

  function Toast() {
    this._active = null;
  }

  Toast.prototype.show = function (msg, duration, actions) {
    if (this._active) { this._active.remove(); this._active = null; }

    var toast    = document.createElement('div');
    toast.className = 'nav-toast';

    var span     = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);

    if (actions && actions.length) {
      var wrap = document.createElement('div');
      wrap.className = 'nav-toast-actions';
      var self = this;
      actions.forEach(function (a) {
        var btn = document.createElement('button');
        btn.textContent = a.label;
        btn.addEventListener('click', function () {
          if (self._active === toast) { toast.remove(); self._active = null; }
          a.fn();
        });
        wrap.appendChild(btn);
      });
      toast.appendChild(wrap);
    }

    var container = document.getElementById('container');
    if (container) container.appendChild(toast);
    this._active = toast;

    if (duration > 0) {
      var self = this;
      setTimeout(function () {
        if (self._active === toast) { toast.remove(); self._active = null; }
      }, duration);
    }
  };

  Toast.prototype.dismiss = function () {
    if (this._active) { this._active.remove(); this._active = null; }
  };

  Nav.Toast = new Toast();

})(window.Nav = window.Nav || {});
