// We built the HUD to show the destination name, remaining distance, and step
// dots at the bottom-left while a route is active — it's the only persistent
// navigation UI that stays visible while the user is walking between nodes.
(function (Nav) {
  'use strict';

  function HUD() {}

  HUD.prototype.update = function () {
    var state = Nav.AppState;
    var hud   = document.getElementById('nav-hud');
    if (!hud || !state.activeRoute) return;

    hud.classList.add('active');

    var path  = state.activeRoute.path;
    var total = path.length - 1;
    var dest  = path[path.length - 1];

    // We sum haversine over the remaining steps rather than using the Dijkstra
    // total distance so the displayed distance shrinks accurately as the user
    // walks — the weighted Dijkstra cost doesn't map linearly to real metres.
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

    // We cap the step dots at 8 to prevent the HUD growing too wide on long
    // routes — any extra steps are shown as "+N" after the last dot.
    var dotsEl  = document.getElementById('nav-hud-dots');
    dotsEl.innerHTML = '';
    var maxDots = Math.min(total, 8);
    for (var d = 0; d < maxDots; d++) {
      var dot = document.createElement('span');
      dot.className = 'nav-dot';
      if (d < state.stepIndex)        dot.classList.add('done');
      else if (d === state.stepIndex) dot.classList.add('active');
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

  function formatDist(m) {
    if (isNaN(m) || m < 0) return '';
    if (m < 1000) return Math.round(m) + 'm';
    return (m / 1000).toFixed(1) + 'km';
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  Nav.HUD = new HUD();

})(window.Nav = window.Nav || {});
