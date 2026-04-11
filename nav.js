/**
 * nav.js — Entry point for the in-panorama navigation system.
 *
 * This file is intentionally minimal. All logic lives in modules/
 * which are loaded before this file via <script> tags in index.html.
 *
 * Load order (index.html):
 *   core/EventBus → core/AppState → utils/Utils
 *   data/XmlLoader → data/NodeParser → data/GraphBuilder → data/Preloader
 *   pathfinding/Pathfinder
 *   navigation/AutoRotator → navigation/Navigator
 *   rendering/Projector → rendering/Renderer
 *   ui/StyleInjector → ui/Toast → ui/LoadingOverlay → ui/HUD
 *   ui/SearchPanel → ui/ModeChooser → ui/UIBuilder
 *   live-location (existing) → live/LiveController
 *   App
 *   nav.js  ← you are here
 */
(function () {
  'use strict';
  window.addEventListener('load', function () {
    Nav.App.boot();
  });
}());
