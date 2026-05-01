#!/bin/bash
# Run this every time you export a new pano.xml from Pano2VR.
# Usage: ./patch-nav.sh

set -e

DIR="$(dirname "$0")"
HTML="$DIR/index.html"

# Read the timestamp Pano2VR wrote into index.html
TS=$(grep -o 'ts=[0-9]*' "$HTML" | head -1 | cut -d= -f2)

if [ -z "$TS" ]; then
  echo "ERROR: could not find a Pano2VR timestamp in index.html"
  exit 1
fi

echo "Timestamp: ts=$TS"

python3 - "$HTML" "$TS" <<'PYEOF'
import sys, re

html_path = sys.argv[1]
ts        = sys.argv[2]

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove every script tag that belongs to us (env.js, supabase CDN, modules/, nav.js)
# Pano2VR's own scripts (pano2vr_player.js, skin.js) are left untouched.
content = re.sub(
    r'\s*<script src="(?:env\.js|https://cdn\.jsdelivr\.net[^"]*|modules/[^"]*|nav\.js[^"]*)"></script>',
    '',
    content
)

# Also remove any comment lines we added
content = re.sub(r'\s*<!-- (?:Environment variables|Supabase|Navigation.*?modules) -->', '', content)

scripts = (
    '\n'
    '\t\t<!-- Environment variables -->\n'
    '\t\t<script src="env.js"></script>\n'
    '\t\t<!-- Supabase -->\n'
    '\t\t<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>\n'
    '\t\t<!-- Navigation & reporting modules -->\n'
    '\t\t<script src="modules/core/EventBus.js"></script>\n'
    '\t\t<script src="modules/core/AppState.js"></script>\n'
    '\t\t<script src="modules/utils/Utils.js"></script>\n'
    '\t\t<script src="modules/data/XmlLoader.js"></script>\n'
    '\t\t<script src="modules/data/NodeParser.js"></script>\n'
    '\t\t<script src="modules/data/GraphBuilder.js"></script>\n'
    '\t\t<script src="modules/data/Preloader.js"></script>\n'
    '\t\t<script src="modules/data/IssueTypes.js"></script>\n'
    '\t\t<script src="modules/data/SupabaseClient.js"></script>\n'
    '\t\t<script src="modules/data/IssueService.js"></script>\n'
    '\t\t<script src="modules/pathfinding/Pathfinder.js"></script>\n'
    '\t\t<script src="modules/navigation/AutoRotator.js"></script>\n'
    '\t\t<script src="modules/navigation/Navigator.js"></script>\n'
    '\t\t<script src="modules/rendering/Projector.js"></script>\n'
    '\t\t<script src="modules/rendering/Renderer.js"></script>\n'
    '\t\t<script src="modules/sensors/Gyroscope.js"></script>\n'
    '\t\t<script src="modules/ui/StyleInjector.js"></script>\n'
    '\t\t<script src="modules/ui/Toast.js"></script>\n'
    '\t\t<script src="modules/ui/LoadingOverlay.js"></script>\n'
    '\t\t<script src="modules/ui/HUD.js"></script>\n'
    '\t\t<script src="modules/ui/SearchPanel.js"></script>\n'
    '\t\t<script src="modules/ui/ModeChooser.js"></script>\n'
    '\t\t<script src="modules/ui/ReportTool.js"></script>\n'
    '\t\t<script src="modules/ui/UIBuilder.js"></script>\n'
    '\t\t<script src="modules/live-location.js"></script>\n'
    '\t\t<script src="modules/live/LiveController.js"></script>\n'
    '\t\t<script src="modules/App.js"></script>\n'
    f'\t\t<script src="nav.js?ts={ts}"></script>\n'
)

content = content.replace('</body>', scripts + '\t</body>')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")
PYEOF

echo "Patched index.html with ts=$TS — serve with: npx serve ."
