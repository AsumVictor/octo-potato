/**
 * SearchPanel — Destination search UI.
 * Pattern: Singleton
 * Maintains its own search index built from Location-tagged nodes.
 * Emits 'nav:start' via EventBus when the user picks a result.
 */
(function (Nav) {
  'use strict';

  var CATEGORY_ICONS = {
    Library:   '📚',
    Office:    '🏢',
    Classroom: '🎓',
    Cafeteria: '☕'
  };

  var SKIP_TAGS = { location: 1, road: 1, all: 1 };

  function SearchPanel() {
    this._index = [];
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  SearchPanel.prototype.buildIndex = function () {
    this._index = [];
    var nodes   = Nav.AppState.nodes;

    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      if (!n || !n.title || !n.isLocation) return;

      var cat = n.tags.find(function (t) {
        return !SKIP_TAGS[t.toLowerCase()] && t.indexOf('IMG_') === -1;
      });

      var parts = n.title.split(/[-_]+/).map(function (p) {
        return p.trim().replace(/_/g, ' ');
      }).filter(function (p) {
        return p.length > 1 && !/^\d+$/.test(p);
      });

      var labels    = parts.length > 1 ? parts : [n.title.replace(/[-_]/g, ' ')];
      var cleanFull = n.title.replace(/[-_]/g, ' ');
      if (labels.indexOf(cleanFull) === -1) labels.push(cleanFull);

      var seen = {};
      labels.forEach(function (label) {
        var key = label.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        this._index.push({ label: label, nodeId: id, cat: cat || null });
      }, this);
    }, this);

    this._index.sort(function (a, b) { return a.label.localeCompare(b.label); });
  };

  SearchPanel.prototype.open = function () {
    var panel = document.getElementById('nav-search-panel');
    if (!panel) return;
    Nav.ModeChooser.close();
    panel.style.display      = 'block';
    panel.style.visibility   = 'visible';
    panel.style.pointerEvents = 'auto';
    requestAnimationFrame(function () { panel.classList.add('open'); });
    var input = document.getElementById('nav-search-input');
    if (input) { input.value = ''; input.focus(); }
    this._render('');
    Nav.EventBus.emit('ui:search-open');
  };

  SearchPanel.prototype.close = function () {
    var panel = document.getElementById('nav-search-panel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.style.pointerEvents = 'none';
    panel.style.visibility    = 'hidden';
    panel.style.display       = 'none';
    Nav.EventBus.emit('ui:search-close');
  };

  // ── Private ──────────────────────────────────────────────────────────────────

  SearchPanel.prototype._render = function (query) {
    var list = document.getElementById('nav-search-results');
    if (!list) return;

    var q        = query.toLowerCase().trim();
    var filtered = q
      ? this._index.filter(function (e) { return e.label.toLowerCase().indexOf(q) !== -1; })
      : this._index;

    list.innerHTML = '';

    if (!filtered.length) {
      var empty = document.createElement('li');
      empty.className   = 'nav-result-empty';
      empty.textContent = 'No locations found';
      list.appendChild(empty);
      return;
    }

    filtered.slice(0, 12).forEach(function (e) {
      var icon = (e.cat && CATEGORY_ICONS[e.cat]) ? CATEGORY_ICONS[e.cat] : '📍';
      var li   = document.createElement('li');
      li.className = 'nav-result-item';
      li.innerHTML =
        '<span class="nav-ri-icon">' + icon + '</span>' +
        '<span class="nav-ri-body">' +
          '<span class="nav-ri-title">' + Nav.Utils.escapeHtml(e.label) + '</span>' +
          (e.cat ? '<span class="nav-ri-cat">' + Nav.Utils.escapeHtml(e.cat) + '</span>' : '') +
        '</span>';
      li.addEventListener('click', (function (nodeId) {
        return function () { Nav.EventBus.emit('nav:start', nodeId); };
      }(e.nodeId)));
      list.appendChild(li);
    });
  };

  SearchPanel.prototype.onInput = function (query) {
    this._render(query);
  };

  Nav.SearchPanel = new SearchPanel();

})(window.Nav = window.Nav || {});
