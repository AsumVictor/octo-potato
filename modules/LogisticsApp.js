// We wrote LogisticsApp as the boot sequence for the logistics page.
// It reads the issue ID from the URL, waits for the Pano2VR player, then
// navigates to the exact node and view angle where the issue was reported.
(function (Nav) {
  'use strict';

  function LogisticsApp() {}

  LogisticsApp.prototype.boot = function () {
    var id = Nav.LogisticsLoader.getIssueId();
    if (!id) {
      _showError('No issue ID in URL. Use ?id=<issue-uuid>');
      return;
    }

    _waitForPlayer(function () {
      Nav.LogisticsLoader.fetch(id)
        .then(function (issue) {
          Nav.IssueViewer.show(issue);

          var loc = issue.metadata && issue.metadata.location;
          if (!loc || !loc.nodeId) return;

          var view = {};
          if (loc.pan  != null) view.pan  = loc.pan;
          if (loc.tilt != null) view.tilt = loc.tilt;
          if (loc.fov  != null) view.fov  = loc.fov;

          pano.addListener('configloaded', function () {
            pano.openNext('{' + loc.nodeId + '}', view);
            // We draw the highlight after the node transition completes.
            pano.addListener('changenode', function () {
              setTimeout(function () {
                Nav.IssueViewer.drawHighlight();
              }, 400);
            });
          });
        })
        .catch(function (err) {
          _showError('Failed to load issue: ' + (err && err.message ? err.message : err));
          console.error('[LogisticsApp]', err);
        });
    });
  };

  function _waitForPlayer(cb) {
    if (window.pano) { cb(); return; }
    setTimeout(function () { _waitForPlayer(cb); }, 50);
  }

  function _showError(msg) {
    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:#1a1a2e;color:#ff6060;padding:24px 32px;border-radius:10px;' +
      'font-family:sans-serif;font-size:14px;z-index:9999;max-width:400px;text-align:center;';
    el.textContent = msg;
    document.body.appendChild(el);
  }

  Nav.LogisticsApp = new LogisticsApp();

})(window.Nav = window.Nav || {});
