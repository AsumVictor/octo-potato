// We built Navigator to own the full navigation lifecycle: starting a route,
// advancing through steps, rerouting when the user goes off-path, and playing
// the arrival animation at the destination.
// We also thought about putting this logic in App.js, but separated it so the
// lifecycle stays testable without needing the full app to be initialised.
(function (Nav) {
  'use strict';

  function Navigator() {}

  Navigator.prototype.start = function (destId) {
    var state = Nav.AppState;

    if (!state.navReady) {
      Nav.Toast.show('Please wait while the panorama finishes loading.', 2500);
      return;
    }

    var currentId = pano.getCurrentNode();
    if (state.navMode === 'live' && window.LiveLocation && LiveLocation.getLiveNodeId()) {
      currentId = LiveLocation.getLiveNodeId();
    }

    if (currentId === destId) {
      Nav.Toast.show('You are already here!', 2500);
      return;
    }

    var route = Nav.Pathfinder.find(currentId, destId);
    if (!route) {
      Nav.Toast.show('No path found. Try navigating closer first.', 3000);
      return;
    }

    state.activeRoute    = route;
    state.stepIndex      = 0;
    state.navActive      = true;
    state.autoRotateDone = false;

    if (window.LiveLocation && LiveLocation.setRoute) {
      LiveLocation.setRoute(route, 0);
    }

    Nav.SearchPanel.close();
    Nav.HUD.update();
    pano.stopAutorotate();

    // We delay the first auto-rotate by 300 ms to let the search panel finish
    // closing before the camera starts moving — avoids a jarring visual.
    var firstNext = route.path[1];
    if (firstNext) {
      setTimeout(function () {
        Nav.AutoRotator.rotateTo(firstNext.pan, firstNext.tilt);
      }, 300);
    }

    Nav.EventBus.emit('nav:started', route);
  };

  Navigator.prototype.cancel = function () {
    var state = Nav.AppState;
    state.reset();

    Nav.AutoRotator.cancel();
    Nav.HUD.hide();

    if (window.LiveLocation && LiveLocation.clearRoute) LiveLocation.clearRoute();

    Nav.EventBus.emit('nav:cancel');
  };

  // We call this from App.js every time the Pano2VR player fires 'changenode'
  // so Navigator can decide if the user is on-route or needs rerouting.
  Navigator.prototype.handleNodeChange = function (newNodeId) {
    var state = Nav.AppState;
    if (!state.navActive || !state.activeRoute) return;

    var advanced = this._advanceStep(newNodeId);
    if (!advanced) {
      Nav.EventBus.emit('nav:off-route', newNodeId);
      this._showReroutePrompt(newNodeId);
    }
  };

  Navigator.prototype.reroute = function (fromNodeId) {
    var state   = Nav.AppState;
    if (!state.activeRoute) return;

    var destId   = state.activeRoute.path[state.activeRoute.path.length - 1].nodeId;
    var newRoute = Nav.Pathfinder.find(fromNodeId, destId);

    if (!newRoute) {
      Nav.Toast.show('No path from here. Navigate manually.', 3000);
      this.cancel();
      return;
    }

    state.activeRoute    = newRoute;
    state.stepIndex      = 0;
    state.autoRotateDone = false;

    if (window.LiveLocation && LiveLocation.setRoute) {
      LiveLocation.setRoute(newRoute, 0);
    }

    Nav.HUD.update();
    var nextStep = newRoute.path[1];
    if (nextStep) Nav.AutoRotator.rotateTo(nextStep.pan, nextStep.tilt);

    Nav.EventBus.emit('nav:reroute', newRoute);
  };

  Navigator.prototype._advanceStep = function (newNodeId) {
    var state = Nav.AppState;
    var path  = state.activeRoute.path;
    var expectedNext = path[state.stepIndex + 1] ? path[state.stepIndex + 1].nodeId : null;

    if (newNodeId === expectedNext) {
      state.stepIndex++;
      if (state.stepIndex >= path.length - 1) {
        this._playArrival(path[path.length - 1].title);
        return true;
      }
      state.autoRotateDone = false;
      Nav.HUD.update();
      var nextStep = path[state.stepIndex + 1];
      if (nextStep) {
        // We delay the rotate by 650 ms here — the Pano2VR transition animation
        // takes about 600 ms, so starting earlier fights with the transition.
        setTimeout(function () {
          Nav.AutoRotator.rotateTo(nextStep.pan, nextStep.tilt);
        }, 650);
      }
      return true;
    }

    if (newNodeId === path[path.length - 1].nodeId) {
      this._playArrival(path[path.length - 1].title);
      return true;
    }

    // We also handle the case where the user skipped ahead on the planned path —
    // rather than declaring them off-route we fast-forward the step index.
    for (var i = state.stepIndex + 2; i < path.length; i++) {
      if (path[i].nodeId === newNodeId) {
        state.stepIndex = i;
        if (state.stepIndex >= path.length - 1) {
          this._playArrival(path[path.length - 1].title);
          return true;
        }
        state.autoRotateDone = false;
        Nav.HUD.update();
        var ns = path[state.stepIndex + 1];
        if (ns) setTimeout(function () { Nav.AutoRotator.rotateTo(ns.pan, ns.tilt); }, 650);
        return true;
      }
    }

    return false;
  };

  Navigator.prototype._playArrival = function (title) {
    var state = Nav.AppState;
    state.navActive = false;
    Nav.AutoRotator.cancel();

    var card = document.createElement('div');
    card.id  = 'nav-arrival-card';
    card.innerHTML =
      '<div class="nav-arrival-icon">&#10003;</div>' +
      '<div class="nav-arrival-title">You\'ve arrived!</div>' +
      '<div class="nav-arrival-dest">' + Nav.Utils.escapeHtml(title) + '</div>' +
      '<div class="nav-arrival-sub">Tap anywhere to continue</div>';
    document.body.appendChild(card);

    requestAnimationFrame(function () { card.classList.add('nav-arrival-show'); });

    var self    = this;
    var dismiss = function () {
      card.classList.remove('nav-arrival-show');
      card.classList.add('nav-arrival-hide');
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 400);
      self.cancel();
    };

    var timer = setTimeout(dismiss, 3500);
    card.addEventListener('click', function () { clearTimeout(timer); dismiss(); });

    Nav.HUD.hide();
    Nav.EventBus.emit('nav:arrive', title);
  };

  Navigator.prototype._showReroutePrompt = function (nodeId) {
    var self = this;
    Nav.Toast.show('Off route', 0, [
      { label: 'Re-route', fn: function () { self.reroute(nodeId); } },
      { label: 'Cancel',   fn: function () { self.cancel(); } }
    ]);
  };

  Nav.Navigator = new Navigator();

})(window.Nav = window.Nav || {});
