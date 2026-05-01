// We wrote XmlLoader to fetch the pano.xml file that Pano2VR generates on every
// tour export. We try fetch() first and fall back to XHR because fetch() fails
// on local file:// URLs in some browsers.
// We also read the cache-buster query string (?ts=...) that Pano2VR appends to
// nav.js and attach it to the pano.xml request so both files stay in sync when
// the tour is re-exported — without this, the browser can serve a stale XML
// while running fresh JS.
(function (Nav) {
  'use strict';

  function XmlLoader() {}

  XmlLoader.prototype.load = function (url) {
    var resolved = resolveUrl(url);
    if (window.fetch) {
      return window.fetch(resolved)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
          return res.text();
        })
        .then(parseXml)
        .catch(function () { return xhrLoad(resolved); });
    }
    return xhrLoad(resolved);
  };

  function resolveUrl(url) {
    var q = getNavScriptQuery();
    return q ? url + q : url;
  }

  // We find the nav.js script tag to steal its query string rather than
  // hardcoding a timestamp, so this works after every Pano2VR re-export.
  function getNavScriptQuery() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('nav.js') !== -1) {
        var q = src.indexOf('?');
        return q !== -1 ? src.slice(q) : '';
      }
    }
    return '';
  }

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML parse error');
    return doc;
  }

  function xhrLoad(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.overrideMimeType('text/xml');
      xhr.onload = function () {
        if ((xhr.status >= 200 && xhr.status < 300) ||
            (xhr.status === 0 && (xhr.responseXML || xhr.responseText))) {
          try {
            var doc = xhr.responseXML ||
                      new DOMParser().parseFromString(xhr.responseText, 'application/xml');
            if (doc.querySelector('parsererror')) {
              reject(new Error('XML parse error'));
            } else {
              resolve(doc);
            }
          } catch (e) { reject(e); }
        } else {
          reject(new Error('XHR ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('XHR network error')); };
      xhr.send();
    });
  }

  Nav.XmlLoader = new XmlLoader();

})(window.Nav = window.Nav || {});
