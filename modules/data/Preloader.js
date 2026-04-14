/**
 * Preloader — kicks off parallel image tile downloads before the user starts
 * navigating so panoramas load instantly when they arrive at a node.
 *
 * Reads the tile URL templates from pano.xml, expands them across all faces/
 * levels/tiles, and fires up to CONCURRENCY (12) downloads at once. Calls
 * onProgress(loaded, total) on each completion so the loading overlay can
 * show a progress count.
 */
(function (Nav) {
  'use strict';

  var CONCURRENCY = 12;

  function Preloader() {}

  Preloader.prototype.preload = function (doc, onProgress) {
    var urls = collectUrls(doc);
    if (!urls.length) return Promise.resolve();

    var loaded = 0;
    var total  = urls.length;
    if (onProgress) onProgress(0, total);

    return new Promise(function (resolve) {
      var index  = 0;
      var active = 0;

      function next() {
        if (index >= total && active === 0) { resolve(); return; }
        while (active < CONCURRENCY && index < total) {
          var url = urls[index++];
          active++;
          loadImg(url)
            .then(function () { loaded++; if (onProgress) onProgress(loaded, total); })
            .catch(function () { loaded++; if (onProgress) onProgress(loaded, total); })
            .then(function () { active--; next(); });
        }
      }

      next();
    });
  };

  // ── Private ──────────────────────────────────────────────────────────────────

  function collectUrls(doc) {
    var urls  = [];
    var panos = doc.querySelectorAll('panorama');

    eachNode(panos, function (panorama) {
      var input    = panorama.querySelector('input');
      if (!input) return;
      var template = input.getAttribute('leveltileurl');
      if (!template) return;
      var tileSize = parseInt(input.getAttribute('leveltilesize'), 10) || 512;
      var levels   = panorama.querySelectorAll('level');

      eachNode(levels, function (level, levelIndex) {
        if (level.getAttribute('preload') !== '1') return;
        var width     = parseInt(level.getAttribute('width'), 10) || 0;
        var tileCount = Math.max(1, Math.ceil(width / tileSize));
        for (var c = 0; c < 6; c++) {
          for (var x = 0; x < tileCount; x++) {
            for (var y = 0; y < tileCount; y++) {
              urls.push(template
                .replace(/%c/g, c)
                .replace(/%l/g, levelIndex)
                .replace(/%x/g, x)
                .replace(/%y/g, y));
            }
          }
        }
      });
    });

    // Deduplicate
    return urls.filter(function (v, i) { return urls.indexOf(v) === i; });
  }

  function loadImg(url) {
    return new Promise(function (resolve, reject) {
      var img    = new Image();
      img.onload  = function () { resolve(url); };
      img.onerror = function (e) { reject(e); };
      img.src     = url;
    });
  }

  function eachNode(list, fn) {
    if (!list) return;
    if (typeof list.forEach === 'function') { list.forEach(fn); return; }
    for (var i = 0; i < list.length; i++) fn(list[i], i, list);
  }

  Nav.Preloader = new Preloader();

})(window.Nav = window.Nav || {});
