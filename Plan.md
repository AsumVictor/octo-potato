# In-Panorama Navigation System — Implementation Plan

## What We're Actually Building

> The navigation lives **inside the 360° panorama itself** — not on a separate 2D map.
> When you're routing from node X to node Y via road nodes [A, B, C], the hotspot
> for A glows and pulses in the actual panoramic view. The camera auto-rotates to
> face it. When you click it, you arrive at A, the camera auto-rotates to face B's
> hotspot. And so on until you arrive.

The experience should feel like having a glowing breadcrumb trail on the ground
in front of you — you can see exactly where to walk next, inside the panorama.

---

## Core User Journey

```
User opens search panel
  → Types "Ashesi Shop"
  → Hits "Navigate"

Dijkstra runs silently
  → Finds: node9 → node37 → node36 → node35 → node33

Panorama at node9:
  → Camera smoothly auto-rotates to face node37's hotspot
  → That specific hotspot pulses with glowing rings + bouncing arrow
  → All OTHER hotspots are dimmed (de-emphasized)
  → A small HUD shows: "Step 1 of 4 → Ashesi Shop"

User clicks the glowing hotspot
  → Transitions to node37
  → Camera auto-rotates to face node36's hotspot
  → Process repeats

User arrives at node33 (Ashesi Shop)
  → Arrival animation plays
  → "You've arrived at Ashesi Shop!" 
```

---

## Architecture: Two New Files Only

```
output/
  nav.js       ← NEW: all navigation logic (pathfinding + in-panorama overlay)
  index.html   ← ONE LINE ADDED: <script src="nav.js"> before </body>
```

Do NOT modify `skin.js`, `pano.xml`, or `pano2vr_player.js`. They are generated.

---

## Phase 1 — Parse XML + Build Graph

*(Same as before — this foundation is required for everything)*

### 1.1 Data Model

Fetch and parse `pano.xml` at startup (hits browser cache — same file player already fetched):

```javascript
// Each node becomes this object:
{
  id: "node9",
  title: "Todd Library",
  lat: 5.75972222, lng: -0.21972222,
  isRoad: true,      // has "ROAD" in tags
  isLocation: true,  // has "Location" in tags
  hotspots: [
    { targetId: "node10", pan: 86.48, tilt: -2.3, distance: 29.09, title: "Road-small-green-gate" },
    { targetId: "node37", pan: -128.9, tilt: -7.6, distance: 13.8, title: "IMG_..." },
    // ...
  ]
}
```

Key: each hotspot knows its `pan` and `tilt` **in the current node's view coordinate system**.
This tells us exactly which direction to look (and rotate) to see that hotspot.

### 1.2 Graph = ROAD nodes only

```javascript
// Adjacency list — only ROAD↔ROAD connections
{
  "node9":  [{ neighborId: "node10", distance: 29.0, pan: 86.48, tilt: -2.3 }, ...],
  "node10": [{ neighborId: "node9",  distance: 29.0, pan: -133.8, tilt: -3.4 }, ...],
  // ...
}
```

### 1.3 Dijkstra with GPS-weighted edges

Use the `distance` attribute from each hotspot (already in meters) as edge weight.
Fallback to Haversine if distance is 0.

Result: `path = [{nodeId, title, pan, tilt}, ...]` — ordered steps including which
direction (pan/tilt) to face in the *previous* node to reach each step.

---

## Phase 2 — The In-Panorama Overlay (THE MAIN FEATURE)

### 2.1 Overlay Canvas

We create a transparent `<canvas>` that sits exactly on top of the panorama viewer,
the same size, updated every frame via `requestAnimationFrame`. It draws nothing by
default but becomes the rendering surface for all navigation visuals.

```javascript
const canvas = document.createElement('canvas');
canvas.style.cssText = `
  position: absolute; top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;   /* clicks pass through to panorama */
  z-index: 100;
`;
document.getElementById('container').appendChild(canvas);
```

### 2.2 Spherical-to-Screen Projection

This is the math that converts a hotspot's spherical angles (pan/tilt) into pixel
coordinates on screen, given the camera's current pan/tilt/fov.

```javascript
function projectToScreen(hsPan, hsTilt, cam, screenW, screenH) {
  // Angular difference from camera center
  let dPan  = hsPan  - cam.pan;
  let dTilt = hsTilt - cam.tilt;

  // Normalize horizontal to [-180, 180] — handles wrap-around at ±180°
  dPan = ((dPan + 180) % 360 + 360) % 360 - 180;

  // Pixels per degree depends on current FOV and screen width
  const ppd = screenW / cam.fov;

  const x = screenW / 2 + dPan  * ppd;
  const y = screenH / 2 - dTilt * ppd;   // tilt up = y decreases

  // Is it currently visible on screen?
  const halfW = screenW / 2 + 40;   // 40px tolerance past edges
  const halfH = screenH / 2 + 40;
  const inView = Math.abs(x - screenW/2) < halfW && Math.abs(y - screenH/2) < halfH;

  return { x, y, dPan, dTilt, inView };
}
```

This runs inside the render loop every frame, so as the user drags the camera, all
indicators track the hotspot perfectly in real-time.

### 2.3 Render Loop

```javascript
function renderLoop() {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (!activeRoute || currentStepIndex >= activeRoute.path.length) {
    requestAnimationFrame(renderLoop);
    return;
  }

  const cam = { pan: pano.getPan(), tilt: pano.getTilt(), fov: pano.getFov() };
  const step = activeRoute.path[currentStepIndex + 1];   // next step
  if (!step) { requestAnimationFrame(renderLoop); return; }

  const pos = projectToScreen(step.pan, step.tilt, cam, W, H);

  if (pos.inView) {
    drawGlowingRings(ctx, pos.x, pos.y);    // pulsing rings on the hotspot
    drawBounceArrow(ctx, pos.x, pos.y);     // arrow pointing down to it
    drawNavLabel(ctx, pos.x, pos.y, step);  // "→ Road II (3 of 5)"
  } else {
    drawEdgeCompassArrow(ctx, pos.dPan, pos.dTilt, W, H);  // off-screen pointer
  }

  requestAnimationFrame(renderLoop);
}
```

---

## Phase 3 — Visual Elements (Creative Details)

### 3.1 Glowing Pulsing Rings (on-screen hotspot highlight)

Three rings expanding outward like a sonar ping. Uses `performance.now()` for
smooth time-based animation independent of frame rate.

```javascript
function drawGlowingRings(ctx, x, y) {
  const t = (performance.now() % 1800) / 1800;  // 0→1 cycle every 1.8 seconds

  // Draw 3 rings offset by 0.33 each
  for (let i = 0; i < 3; i++) {
    const phase = (t + i * 0.33) % 1.0;
    const radius = 20 + phase * 60;            // expands 20px → 80px
    const alpha  = (1 - phase) * 0.8;         // fades out as it expands

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 107, 53, ${alpha})`;   // orange
    ctx.lineWidth = 3 - phase * 2;
    ctx.stroke();
  }

  // Solid center dot
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 107, 53, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
}
```

### 3.2 Bouncing Arrow Above Hotspot

An animated downward arrow that bounces up and down to say "click here":

```javascript
function drawBounceArrow(ctx, x, y) {
  const bounce = Math.sin(performance.now() / 300) * 8;  // oscillates ±8px
  const arrowY = y - 55 + bounce;

  ctx.save();
  ctx.translate(x, arrowY);
  ctx.fillStyle = 'rgba(255, 107, 53, 0.95)';
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.5;

  // Chevron arrow pointing down (▼)
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-5, -12);
  ctx.lineTo(5, -12);
  ctx.lineTo(5, 0);
  ctx.lineTo(10, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
```

### 3.3 Step Label Near Hotspot

A floating pill-shaped label showing the destination name and step number:

```javascript
function drawNavLabel(ctx, x, y, step, totalSteps, stepIndex) {
  const label = `${step.title}  (${stepIndex + 1} / ${totalSteps})`;
  ctx.font = '600 13px Montserrat, sans-serif';
  const tw = ctx.measureText(label).width;
  const pw = tw + 20, ph = 28;
  const lx = x - pw/2, ly = y - 100;

  // Background pill
  ctx.beginPath();
  ctx.roundRect(lx, ly, pw, ph, 14);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fill();

  // Left accent bar in theme color
  ctx.beginPath();
  ctx.roundRect(lx, ly, 4, ph, [14, 0, 0, 14]);
  ctx.fillStyle = '#FF6B35';
  ctx.fill();

  ctx.fillStyle = 'white';
  ctx.fillText(label, lx + 14, ly + 18);
}
```

### 3.4 Off-Screen Compass Arrow (CRITICAL — when hotspot not in view)

When the user is looking the wrong way, draw an arrow at the screen edge
pointing toward where they need to look. Also shows the angle in degrees.

```javascript
function drawEdgeCompassArrow(ctx, dPan, dTilt, W, H) {
  // Find the point on the screen edge in the direction of the hotspot
  const angle = Math.atan2(-dTilt * (H/W), dPan);   // screen angle
  const margin = 50;

  // Clamp to edge
  const ex = W/2 + Math.cos(angle) * (W/2 - margin);
  const ey = H/2 + Math.sin(angle) * (H/2 - margin);

  // Pulsing glow background
  const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, 35);
  glow.addColorStop(0, 'rgba(255,107,53,0.4)');
  glow.addColorStop(1, 'rgba(255,107,53,0)');
  ctx.beginPath();
  ctx.arc(ex, ey, 35, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Rotated arrow pointing toward hotspot
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = '#FF6B35';
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(4, -9); ctx.lineTo(4, -4);
  ctx.lineTo(-14, -4); ctx.lineTo(-14, 4); ctx.lineTo(4, 4);
  ctx.lineTo(4, 9); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // Degree label: "← 45°"
  const deg = Math.abs(Math.round(dPan));
  ctx.font = 'bold 12px Montserrat, sans-serif';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.fillText(`${deg}°`, ex, ey + 28);
  ctx.textAlign = 'left';
}
```

### 3.5 Dimming Other Hotspots

During active navigation, all hotspots that are NOT the next step should be
visually dimmed. We inject a CSS rule that reduces their opacity, except the
one we're targeting.

```javascript
function setHotspotDimming(activeHotspotId) {
  let styleEl = document.getElementById('nav-dimming-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'nav-dimming-style';
    document.head.appendChild(styleEl);
  }

  if (activeHotspotId) {
    // Dim all hotspots, un-dim the active one
    styleEl.textContent = `
      .ggskin [data-hsid] { opacity: 0.25 !important; transition: opacity 0.3s; }
      .ggskin [data-hsid="${activeHotspotId}"] { opacity: 1 !important; }
    `;
  } else {
    styleEl.textContent = '';  // clear — restore all hotspots
  }
}
```

Note: We need to identify which DOM element corresponds to the target hotspot.
Pano2VR's skin renders hotspots with an `id` or `data` attribute we can find by
inspecting the DOM at runtime. If they don't have `data-hsid`, we find the hotspot
element by its pan/tilt proximity and add the class ourselves.

---

## Phase 4 — Auto-Rotate to Next Hotspot

When a new navigation step begins, smoothly rotate the camera to face the
hotspot. This is the "GPS recalculating" moment — the panorama turns to show
you exactly where to go.

```javascript
function autoRotateTo(targetPan, targetTilt, durationMs = 1400) {
  if (autoRotateRAF) cancelAnimationFrame(autoRotateRAF);

  const startPan  = pano.getPan();
  const startTilt = pano.getTilt();
  const startTime = performance.now();

  // Shortest rotation path — go through -180° if needed
  let dPan = targetPan - startPan;
  dPan = ((dPan + 180) % 360 + 360) % 360 - 180;

  const dTilt = Math.max(-60, Math.min(60, targetTilt)) - startTilt;  // clamp tilt

  function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }

  function step(now) {
    const raw = (now - startTime) / durationMs;
    const t   = Math.min(raw, 1.0);
    const e   = easeInOutQuad(t);

    pano.setPan(startPan + dPan * e);
    pano.setTilt(startTilt + dTilt * e);

    if (t < 1.0) autoRotateRAF = requestAnimationFrame(step);
  }

  autoRotateRAF = requestAnimationFrame(step);
}
```

**When auto-rotate fires:**
- Immediately when `startNavigation(destinationId)` is called
- Immediately when `changenode` fires and we advance to next step
- After 4 seconds of inactivity if user has looked away (reset timer on mouse/touch)

---

## Phase 5 — Navigation HUD (Step Counter)

A minimal persistent UI overlay showing route progress. Stays on screen at all times
during navigation, doesn't interfere with the panorama interaction.

```html
<!-- Injected by nav.js -->
<div id="nav-hud">
  <div id="nav-hud-dest">→ Ashesi Shop</div>
  <div id="nav-hud-steps">
    <span class="step done">●</span>  <!-- completed -->
    <span class="step active">●</span> <!-- current -->
    <span class="step">●</span>        <!-- remaining -->
    <span class="step">●</span>
  </div>
  <div id="nav-hud-dist">~85m remaining</div>
  <button id="nav-hud-cancel">✕ Cancel</button>
</div>
```

CSS — compact, bottom-left, semi-transparent:
```css
#nav-hud {
  position: absolute;
  bottom: 24px; left: 24px;
  background: rgba(0, 0, 0, 0.80);
  backdrop-filter: blur(6px);
  border-radius: 12px;
  padding: 10px 14px;
  color: white;
  font-family: Montserrat, sans-serif;
  font-size: 13px;
  z-index: 200;
  min-width: 190px;
  border-left: 3px solid #FF6B35;
  display: none;
}
#nav-hud.active { display: block; }
.step { color: #555; font-size: 8px; margin: 0 2px; }
.step.done   { color: #4FB5C2; }
.step.active { color: #FF6B35; font-size: 10px; }
```

---

## Phase 6 — Arrival Experience

When the user reaches the final destination node:

1. **Flash animation**: Green concentric rings fill the entire screen briefly
2. **Arrival card** appears in center: "You've arrived at Ashesi Shop 🎉"
3. After 2 seconds, card fades out
4. Navigation state clears — HUD hides, all hotspot dimming removed
5. Camera auto-rotates to the destination node's default `start.pan` / `start.tilt`

```javascript
function playArrivalAnimation(destinationTitle) {
  // 1. Full-screen flash
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute; inset: 0; pointer-events: none; z-index: 999;
    background: radial-gradient(circle, rgba(79,181,194,0.4) 0%, transparent 70%);
    animation: arrivalFlash 1.2s ease-out forwards;
  `;
  document.getElementById('container').appendChild(flash);

  // 2. Arrival card
  showToast(`Arrived at ${destinationTitle}`, 3000);

  // 3. Clean up
  setTimeout(() => {
    clearNavigation();
    flash.remove();
  }, 1500);
}
```

---

## Phase 7 — Off-Route Detection and Re-Routing

If the user clicks a hotspot that's NOT the next step in the path:

```javascript
pano.addListener('changenode', function() {
  const newId = pano.getCurrentNode();
  if (!activeRoute) return;

  const expectedNextId = activeRoute.path[currentStepIndex + 1]?.nodeId;

  if (newId === expectedNextId) {
    // On route — advance step
    currentStepIndex++;
    const nextStep = activeRoute.path[currentStepIndex + 1];
    if (!nextStep) {
      playArrivalAnimation(activeRoute.destination.title);
      return;
    }
    autoRotateTo(nextStep.pan, nextStep.tilt);
    updateHUD();
    return;
  }

  if (newId === activeRoute.destination.nodeId) {
    // Somehow jumped directly to destination — still counts
    playArrivalAnimation(activeRoute.destination.title);
    return;
  }

  // Off-route: user went somewhere unexpected
  showReroutePrompt(newId);
});

function showReroutePrompt(newNodeId) {
  // Small toast: "Off route — [Re-route] [Cancel]"
  showToast('Off route', 0, [
    { label: 'Re-route', action: () => rerouteFrom(newNodeId) },
    { label: 'Cancel',   action: () => clearNavigation() }
  ]);
}

function rerouteFrom(fromNodeId) {
  const destId = activeRoute.destination.nodeId;
  activeRoute = computeRoute(fromNodeId, destId);  // re-run Dijkstra
  currentStepIndex = 0;
  if (!activeRoute) {
    showToast('No path from here — navigate closer first');
    return;
  }
  const firstStep = activeRoute.path[1];
  autoRotateTo(firstStep.pan, firstStep.tilt);
  updateHUD();
}
```

---

## Phase 8 — Search UI (minimal, clean)

A search button in the corner opens a search panel. Only searches Location-tagged nodes.

```html
<button id="nav-search-btn" title="Navigate to...">
  <!-- SVG navigation icon -->
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <circle cx="11" cy="11" r="8"/>
    <path d="m21 21-4.35-4.35"/>
    <path d="M11 8v6M8 11h6"/>
  </svg>
</button>

<div id="nav-search-panel">
  <input id="nav-search-input" placeholder="Where do you want to go?" />
  <ul id="nav-search-results"></ul>
</div>
```

Search filters to Location nodes only. Displays title + category tag (Office, Classroom, etc).
Clicking a result immediately calls `startNavigation(destinationNodeId)`.

---

## Phase 9 — Complete nav.js Structure

```
nav.js
├── parseNodes(xmlDoc)             → builds 143 node objects
├── buildGraph(nodes)              → ROAD-only adjacency list
├── haversine(lat1,lng1,lat2,lng2) → distance in meters
├── dijkstra(graph, nodes, from, to) → path array
├── startNavigation(destId)        → initializes route + auto-rotate + HUD
├── clearNavigation()              → clears route + HUD + canvas + dimming
├── rerouteFrom(nodeId)            → re-runs Dijkstra from new position
│
├── renderLoop()                   → RAF loop, runs every frame
│   ├── projectToScreen(hsPan, hsTilt, cam, W, H)
│   ├── drawGlowingRings(ctx, x, y)
│   ├── drawBounceArrow(ctx, x, y)
│   ├── drawNavLabel(ctx, x, y, step, total, index)
│   └── drawEdgeCompassArrow(ctx, dPan, dTilt, W, H)
│
├── autoRotateTo(pan, tilt, ms)    → smooth camera animation
├── setHotspotDimming(hotspotId)   → CSS injection for dimming
├── playArrivalAnimation(title)    → full-screen flash + card
│
├── initSearchUI(nodes)            → search panel DOM + events
├── updateHUD(route, stepIndex)    → updates step dots + distance
└── showToast(msg, duration, btns) → temporary notification
```

---

## Integration with index.html

Add one line before `</body>`:

```html
<script src="nav.js?ts=27535862"></script>
```

`nav.js` self-initializes using:
```javascript
window.addEventListener('load', async () => {
  // Wait for pano2vr player to exist
  while (!window.pano) await new Promise(r => setTimeout(r, 50));

  // Wait for panorama config to finish loading
  await new Promise(resolve => pano.addListener('configloaded', resolve));

  // Boot the nav system
  const navSystem = new PanoNavSystem(pano, 'pano.xml?ts=27535862');
  await navSystem.init();
});
```

---

## Key Pitfalls

**P1 — Pan angle wrap-around**
A hotspot at pan=179° and camera at pan=-179° has a dPan of 358°, but visually it's just 2° to the right. Always normalize:
```javascript
dPan = ((dPan + 180) % 360 + 360) % 360 - 180;
```

**P2 — Player API availability**
`pano.getPan()`, `pano.setTilt()` etc. must be verified against the actual Pano2VR player API. The minified `pano2vr_player.js` exposes these — confirm by searching it for `getPan` and `setPan` before implementing.

**P3 — Canvas resize**
When browser is resized, canvas `width`/`height` must match actual pixel dimensions (not CSS size), otherwise projections are off:
```javascript
window.addEventListener('resize', () => {
  canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
});
```

**P4 — Non-ROAD current node**
If user is inside the library (node1-8, no ROAD tag), find their nearest ROAD ancestor before running Dijkstra.

**P5 — pano.xml regeneration**
Every Pano2VR export overwrites `index.html`. Re-add the `<script src="nav.js">` tag after each export. Consider a simple post-export shell script.

**P6 — pano2vrPlayer API confirmation**
Before coding Phase 4 (auto-rotate), search `pano2vr_player.js` for:
- `setPan` — confirm it exists and its signature
- `setTilt` — same
- `getCurrentNode` — same
- If missing, use `pano.openNext(nodeId, {pan:x, tilt:y})` instead, which also centers view

---

## Build Order

1. **Phase 1** — Parse XML, build graph, `console.log` the node map to verify
2. **Phase 3** — Render loop + glowing rings (hardcode a test hotspot pan/tilt to see it work)
3. **Phase 4** — Auto-rotate (test by calling `autoRotateTo(90, 0)` from console)
4. **Phase 2** — Wire Dijkstra + search UI → `startNavigation()` calls auto-rotate
5. **Phase 5** — HUD
6. **Phase 7** — Off-route re-routing
7. **Phase 6** — Arrival animation
8. Polish: dimming, edge arrows, resize handling
