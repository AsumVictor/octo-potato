// We built Toast as a lightweight notification banner that appears inside the
// panorama container so it overlays the scene without disrupting the layout.
// We also thought about using browser alert() or a fixed-position element but
// keeping it inside the container means it moves naturally if the container
// is repositioned on different screen sizes.
(function (Nav) {
  'use strict';

  function Toast() {
    this._active = null;
  }

  // We dismiss any existing toast before showing a new one — two toasts
  // stacked on top of each other would be confusing and overlap badly.
  Toast.prototype.show = function (msg, duration, actions) {
    if (this._active) { this._active.remove(); this._active = null; }

    var toast = document.createElement('div');
    toast.className = 'nav-toast';

    var span = document.createElement('span');
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
