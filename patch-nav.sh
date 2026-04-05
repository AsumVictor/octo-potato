#!/bin/bash
# patch-nav.sh — run this every time you export from Pano2VR
# Usage: ./patch-nav.sh

set -e

HTML="$(dirname "$0")/index.html"
NAVJS="$(dirname "$0")/nav.js"

# ── 1. Read the timestamp Pano2VR just wrote into index.html ──────────────────
TS=$(grep -o 'ts=[0-9]*' "$HTML" | head -1 | cut -d= -f2)

if [ -z "$TS" ]; then
  echo "ERROR: could not find timestamp in index.html"
  exit 1
fi

echo "Detected Pano2VR timestamp: ts=$TS"

# ── 2. Inject nav.js script tag into index.html (if not already there) ────────
if grep -q 'nav.js' "$HTML"; then
  # Already present — just update the timestamp
  sed -i '' "s/nav\.js?ts=[0-9]*/nav.js?ts=$TS/" "$HTML"
  echo "Updated nav.js timestamp in index.html"
else
  # Insert before </body>
  sed -i '' "s|</noscript>|</noscript>\n\t\t<!-- In-panorama navigation — re-add after every Pano2VR re-export -->\n\t\t<script type=\"text/javascript\" src=\"nav.js?ts=$TS\"></script>|" "$HTML"
  echo "Injected nav.js script tag into index.html"
fi

# ── 3. Update the pano.xml fetch timestamp inside nav.js ──────────────────────
sed -i '' "s/pano\.xml?ts=[0-9]*/pano.xml?ts=$TS/" "$NAVJS"
echo "Updated pano.xml timestamp in nav.js"

echo ""
echo "Done. Ready to run with ts=$TS"
