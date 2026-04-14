/**
 * NodeParser — reads the pano.xml DOM and turns it into a plain JS object map
 * (nodeId → NodeData) that the rest of the app can work with.
 *
 * The XML has a lot of attributes we don't care about; this extracts only what
 * navigation actually needs: id, title, GPS coords, tags, hotspot targets.
 */
(function (Nav) {
  'use strict';

  function NodeParser() {}

  NodeParser.prototype.parse = function (doc) {
    var result  = {};
    var panos   = doc.querySelectorAll('panorama');
    eachNode(panos, function (panorama) {
      var ud = panorama.querySelector('userdata');
      if (!ud) return;

      var node = createNode(panorama, ud);
      if (node) result[node.id] = node;
    });
    return result;
  };

  function createNode(panorama, ud) {
    var id = panorama.getAttribute('id');
    if (!id) return null;

    var startView = panorama.querySelector('view start');
    var startPan  = startView ? (parseFloat(startView.getAttribute('pan'))  || 0) : 0;
    var startTilt = startView ? (parseFloat(startView.getAttribute('tilt')) || 0) : 0;
    var startFov  = startView ? (parseFloat(startView.getAttribute('fov'))  || 100) : 100;

    var rawTags = ud.getAttribute('tags') || '';
    var tags    = rawTags.split('|').map(function (t) { return t.trim(); }).filter(Boolean);

    var hotspots = [];
    eachNode(panorama.querySelectorAll('hotspot'), function (hs) {
      var url      = hs.getAttribute('url') || '';
      var targetId = url.replace(/[{}]/g, '');
      if (!targetId) return;
      hotspots.push({
        id:       hs.getAttribute('id'),
        targetId: targetId,
        pan:      parseFloat(hs.getAttribute('pan'))      || 0,
        tilt:     parseFloat(hs.getAttribute('tilt'))     || 0,
        title:    hs.getAttribute('title')                || '',
        distance: parseFloat(hs.getAttribute('distance')) || 0
      });
    });

    return {
      id:         id,
      title:      ud.getAttribute('title') || id,
      lat:        parseFloat(ud.getAttribute('latitude')),
      lng:        parseFloat(ud.getAttribute('longitude')),
      startPan:   startPan,
      startTilt:  startTilt,
      startFov:   startFov,
      tags:       tags,
      isRoad:     tags.indexOf('ROAD')     !== -1,
      isLocation: tags.indexOf('Location') !== -1,
      hotspots:   hotspots
    };
  }

  // NodeList.forEach polyfill for older WebKit
  function eachNode(list, fn) {
    if (!list) return;
    if (typeof list.forEach === 'function') { list.forEach(fn); return; }
    for (var i = 0; i < list.length; i++) fn(list[i], i, list);
  }

  Nav.NodeParser = new NodeParser();

})(window.Nav = window.Nav || {});
