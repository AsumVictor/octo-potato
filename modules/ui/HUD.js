/**
 * HUD — the small navigation strip at the bottom-left that shows destination,
 * remaining distance, and step dots while a route is active.
 *
 * Call update() whenever the route advances. Call hide() on cancel/arrival.
 */
(function (Nav) {
  'use strict';

  function HUD() {}

  HUD.prototype.update = function () {
    var state = Nav.AppState;
    var hud   = document.getElementById('nav-hud');
    if (!hud || !state.activeRoute) return;

    hud.classList.add('active');

    var path      = state.activeRoute.path;
    var total     = path.length - 1;
    var dest      = path[path.length - 1];

    // Remaining distance — sum haversine over remaining steps
    var remaining = 0;
    for (var i = state.stepIndex; i < path.length - 1; i++) {
      var from = state.nodes[path[i].nodeId];
      var to   = state.nodes[path[i + 1].nodeId];
      if (from && to && from.lat != null && to.lat != null) {
        remaining += Nav.haversine(from.lat, from.lng, to.lat, to.lng);
      }
    }

    document.getElementById('nav-hud-dest').textContent = truncate(dest.title, 30);
    document.getElementById('nav-hud-dist').textContent = formatDist(remaining);

    // Step dots — max 8 shown
    var dotsEl  = document.getElementById('nav-hud-dots');
    dotsEl.innerHTML = '';
    var maxDots = Math.min(total, 8);
    for (var d = 0; d < maxDots; d++) {
      var dot = document.createElement('span');
      dot.className = 'nav-dot';
      if (d < state.stepIndex)              dot.classList.add('done');
      else if (d === state.stepIndex)       dot.classList.add('active');
      dotsEl.appendChild(dot);
    }
    if (total > 8) {
      var more = document.createElement('span');
      more.className   = 'nav-dot-more';
      more.textContent = '+' + (total - 8);
      dotsEl.appendChild(more);
    }
  };

  HUD.prototype.hide = function () {
    var hud = document.getElementById('nav-hud');
    if (hud) hud.classList.remove('active');
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function formatDist(m) {
    if (isNaN(m) || m < 0) return '';
    if (m < 1000) return Math.round(m) + 'm';
    return (m / 1000).toFixed(1) + 'km';
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
  }

  Nav.HUD = new HUD();

})(window.Nav = window.Nav || {});
