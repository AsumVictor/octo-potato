// We wrote NodeParser to read the panorama XML that Pano2VR generates and turn
// each <panorama> element into a plain JS object the rest of the app can use.
// Pano2VR stores node metadata (title, GPS, tags) inside a <userdata> child
// element and hotspot connections as <hotspot> children — we extract only the
// fields navigation actually needs and ignore the rest.
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

    // We read the start view so we can restore the camera angle when the user
    // arrives at a node — Pano2VR stores this in <view start>.
    var startView = panorama.querySelector('view start');
    var startPan  = startView ? (parseFloat(startView.getAttribute('pan'))  || 0) : 0;
    var startTilt = startView ? (parseFloat(startView.getAttribute('tilt')) || 0) : 0;
    var startFov  = startView ? (parseFloat(startView.getAttribute('fov'))  || 100) : 100;

    var rawTags = ud.getAttribute('tags') || '';
    var tags    = rawTags.split('|').map(function (t) { return t.trim(); }).filter(Boolean);

    var hotspots = [];
    eachNode(panorama.querySelectorAll('hotspot'), function (hs) {
      // We strip curly braces from the url attribute — Pano2VR wraps node IDs
      // in {braces} as its internal reference format.
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

  // We added this polyfill because NodeList.forEach is not available in older
  // WebKit versions that some campus devices still run.
  function eachNode(list, fn) {
    if (!list) return;
    if (typeof list.forEach === 'function') { list.forEach(fn); return; }
    for (var i = 0; i < list.length; i++) fn(list[i], i, list);
  }

  Nav.NodeParser = new NodeParser();

})(window.Nav = window.Nav || {});
