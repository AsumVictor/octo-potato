# Ashesi Campus 360° Navigation & Issue Reporting System

An interactive panorama-based wayfinding and facility issue reporting system for Ashesi University, built on top of a Pano2VR 360° campus tour.

---

## What It Does

| Feature | Description |
|---|---|
| **Panorama navigation** | Search for any campus location by name and follow shortest-path turn-by-turn guidance through the 360° tour |
| **Live GPS mode** | Detects your physical position and snaps the panorama to your nearest node automatically |
| **Gyroscope look-around** | On supported mobile devices, physically turning rotates the panorama view |
| **Issue reporting** | Draw a rectangle directly on the panorama to mark a fault, attach photos, and submit a structured report |
| **Logistics view** | Open any submitted report at `/logistics.html?id=<uuid>` — the panorama navigates to the exact node and camera angle, with the original selection rectangle re-drawn |

---

## Prerequisites

- A [Pano2VR](https://ggnome.com/pano2vr) export folder (provides `pano2vr_player.js`, `skin.js`, `pano.xml`, and tile images)
- A [Supabase](https://supabase.com) project (free tier is sufficient)
- A static file server (any — `npx serve`, Nginx, GitHub Pages, etc.)

---

## Setup

### 1. Database

Run the full `database/SCHEMA.sql` in the **Supabase SQL Editor** of a fresh project.  
This creates all tables, seeds issue categories and workflow statuses, and sets up Row Level Security policies.

If the `issues` table already exists, run only the targeted migration:

```sql
-- Allow all Ashesi emails to submit issues
DROP POLICY IF EXISTS "Users can create issues with ashesi email" ON issues;
CREATE POLICY "Ashesi members can submit issues" ON issues
    FOR INSERT WITH CHECK (
        reporter_email LIKE '%@ashesi.edu.gh' OR
        reporter_email LIKE '%@ug.ashesi.edu.gh'
    );

-- Public read for lookup tables
ALTER TABLE issue_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read" ON issue_types    FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read" ON issue_statuses FOR SELECT USING (true);

-- DB-level default so the client never queries issue_statuses
CREATE OR REPLACE FUNCTION open_status_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM issue_statuses WHERE name = 'open' LIMIT 1;
$$;
ALTER TABLE issues ALTER COLUMN status_id SET DEFAULT open_status_id();
```

### 2. Supabase Storage

Create a public storage bucket named **`issue-images`** in your Supabase project  
(Storage → New bucket → name: `issue-images` → Public: on).

### 3. Environment Variables

Copy the template and fill in your project credentials:

```bash
cp env.example.js env.js
```

Edit `env.js`:

```js
window.ENV = {
  SUPABASE_URL:  'https://your-project-id.supabase.co',
  SUPABASE_ANON: 'your-anon-public-key'
};
```

> `env.js` is gitignored — never commit real credentials.

### 4. Drop Into a Pano2VR Export

Copy the following into your Pano2VR output folder (same level as `index.html`):

```
env.js
env.example.js
modules/
database/
nav.js
```

Add the script tags from `index.html` to your export's `index.html` (after the Pano2VR scripts).  
See `index.html` for the full loading order.

### 5. Serve

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080`.

---

## Project Structure

```
output/
├── index.html                  # Main panorama page
├── logistics.html              # Issue logistics viewer (?id=<uuid>)
├── env.js                      # Credentials (gitignored)
├── env.example.js              # Credentials template (committed)
├── nav.js                      # Entry point — calls Nav.App.boot()
├── pano2vr_player.js           # Pano2VR generated — do not edit
├── skin.js                     # Pano2VR generated — do not edit
├── pano.xml                    # Pano2VR generated — do not edit
├── tiles/                      # Panorama image tiles (2 GB+)
│
├── modules/
│   ├── core/
│   │   ├── EventBus.js         # Pub/sub message bus
│   │   └── AppState.js         # Shared runtime state
│   ├── data/
│   │   ├── XmlLoader.js        # Fetches pano.xml
│   │   ├── NodeParser.js       # Parses nodes and hotlinks
│   │   ├── GraphBuilder.js     # Builds weighted adjacency graph
│   │   ├── Preloader.js        # Pre-fetches tile images
│   │   ├── IssueTypes.js       # Local fallback issue category list
│   │   ├── SupabaseClient.js   # Initialises Supabase client
│   │   ├── IssueService.js     # Submit reports, fetch issue types
│   │   └── LogisticsLoader.js  # Fetch single issue by ID for logistics page
│   ├── pathfinding/
│   │   └── Pathfinder.js       # Dijkstra shortest-path algorithm
│   ├── navigation/
│   │   ├── Navigator.js        # Walks the path node by node
│   │   └── AutoRotator.js      # Aims camera at next waypoint
│   ├── rendering/
│   │   ├── Renderer.js         # Draws directional arrow + glow ring
│   │   └── Projector.js        # Equirectangular → screen projection
│   ├── sensors/
│   │   └── Gyroscope.js        # DeviceOrientation API handler
│   ├── ui/
│   │   ├── StyleInjector.js    # All custom CSS (injected at runtime)
│   │   ├── UIBuilder.js        # Builds all DOM elements once at init
│   │   ├── SearchPanel.js      # Search input and results
│   │   ├── ModeChooser.js      # Manual / Live mode selector
│   │   ├── ReportTool.js       # Canvas drawing + report dialog
│   │   ├── IssueViewer.js      # Logistics side panel + highlight rect
│   │   ├── HUD.js              # Navigation heads-up display
│   │   ├── Toast.js            # Ephemeral notification toasts
│   │   └── LoadingOverlay.js   # Boot loading screen
│   ├── live/
│   │   └── LiveController.js   # GPS watch + nearest-node logic
│   ├── App.js                  # Boot sequence (main page)
│   └── LogisticsApp.js         # Boot sequence (logistics page)
│
└── database/
    └── SCHEMA.sql              # Full DB schema, seeds, RLS policies
```

---

## Logistics URL

To view a submitted issue in context:

```
http://localhost:8080/logistics.html?id=<issue-uuid>
```

Replace `<issue-uuid>` with the `id` column value from the `issues` table in Supabase.

---

## After a New Pano2VR Export

When you re-export the panorama from Pano2VR:

1. Replace `pano2vr_player.js`, `skin.js`, `pano.xml`, and the `tiles/` folder.
2. Update the `ts=` query parameter in the script tags in `index.html` and `logistics.html` to match the new timestamp.
3. The navigation graph rebuilds automatically from the new `pano.xml` on next load.

---

## Running Tests

```bash
npm install
npm test          # Jest unit tests
npm run test:ci   # With JUnit XML output (for Jenkins)
```

Test coverage is reported to `coverage/lcov-report/index.html`.

---

## Research Report

A full academic report on the design, implementation, and evaluation of the system is at:

```
docs/report.html
```

Open it in a browser and use **File → Print → Save as PDF** to export the formatted PDF.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Panorama rendering | Pano2VR (equirectangular, HTML5 Canvas) |
| Frontend | Vanilla JavaScript (ES5 IIFE modules), no framework |
| Backend / DB | Supabase (PostgreSQL + Row Level Security) |
| Image storage | Supabase Storage |
| CI | Jenkins (declarative pipeline, NodeJS plugin) |
| Tests | Jest |

---

## License

Academic project — Ashesi University, 2025.
