#!/bin/bash
# patch-nav.sh — run this every time you export from Pano2VR
# Usage: ./patch-nav.sh

set -e

HTML="$(dirname "$0")/index.html"

# ── 1. Read the timestamp Pano2VR just wrote into index.html ──────────────────
TS=$(grep -o 'ts=[0-9]*' "$HTML" | head -1 | cut -d= -f2)

if [ -z "$TS" ]; then
  echo "ERROR: could not find timestamp in index.html"
  exit 1
fi

echo "Detected Pano2VR timestamp: ts=$TS"

# ── 2. Inject nav script tags into index.html (if not already there) ─────────
if grep -q 'modules/core/EventBus.js' "$HTML"; then
  # Already present — update nav.js timestamp only
  sed -i '' "s/nav\.js?ts=[0-9]*/nav.js?ts=$TS/" "$HTML"
  echo "Updated nav.js timestamp in index.html"
else
  # Insert all module script tags before </noscript>
  SCRIPTS='<!-- In-panorama navigation — re-add after every Pano2VR re-export -->\n\t\t<!-- core -->\n\t\t<script src="modules\/core\/EventBus.js"><\/script>\n\t\t<script src="modules\/core\/AppState.js"><\/script>\n\t\t<!-- utils -->\n\t\t<script src="modules\/utils\/Utils.js"><\/script>\n\t\t<!-- data -->\n\t\t<script src="modules\/data\/XmlLoader.js"><\/script>\n\t\t<script src="modules\/data\/NodeParser.js"><\/script>\n\t\t<script src="modules\/data\/GraphBuilder.js"><\/script>\n\t\t<script src="modules\/data\/Preloader.js"><\/script>\n\t\t<!-- pathfinding -->\n\t\t<script src="modules\/pathfinding\/Pathfinder.js"><\/script>\n\t\t<!-- navigation -->\n\t\t<script src="modules\/navigation\/AutoRotator.js"><\/script>\n\t\t<script src="modules\/navigation\/Navigator.js"><\/script>\n\t\t<!-- rendering -->\n\t\t<script src="modules\/rendering\/Projector.js"><\/script>\n\t\t<script src="modules\/rendering\/Renderer.js"><\/script>\n\t\t<!-- sensors -->\n\t\t<script src="modules\/sensors\/Gyroscope.js"><\/script>\n\t\t<!-- ui -->\n\t\t<script src="modules\/ui\/StyleInjector.js"><\/script>\n\t\t<script src="modules\/ui\/Toast.js"><\/script>\n\t\t<script src="modules\/ui\/LoadingOverlay.js"><\/script>\n\t\t<script src="modules\/ui\/HUD.js"><\/script>\n\t\t<script src="modules\/ui\/SearchPanel.js"><\/script>\n\t\t<script src="modules\/ui\/ModeChooser.js"><\/script>\n\t\t<script src="modules\/ui\/UIBuilder.js"><\/script>\n\t\t<!-- live location -->\n\t\t<script src="modules\/live-location.js"><\/script>\n\t\t<script src="modules\/live\/LiveController.js"><\/script>\n\t\t<!-- app bootstrap -->\n\t\t<script src="modules\/App.js"><\/script>\n\t\t<!-- entry point -->\n\t\t<script src="nav.js?ts='"$TS"'"><\/script>'
  sed -i '' "s|</noscript>|</noscript>\n\t\t$SCRIPTS|" "$HTML"
  echo "Injected nav module script tags into index.html"
fi

echo ""
echo "Done. Ready to run with ts=$TS"
