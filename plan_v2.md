# Plan V2 — Live Location + GPS-Driven Node Navigation

## Goal

Add a live-location mode to the in-panorama navigation system.
When the user chooses `Live Location`, the app reads their GPS position and automatically keeps them aligned to the closest panorama node. Search and route instructions will use the current live node as the starting point. The experience should feel like the app is tracking where the user is in the real world and then mapping that directly into the closest pano node with the correct heading, pitch, and tilt.

## Key User Stories

1. User opens the app and chooses `Live Location` or `Mechanical` mode.
2. In `Live Location` mode, the app asks permission for geolocation.
3. The app continuously monitors the user's GPS coordinates.
4. When the user's GPS position enters a node radius, the app sets that node as the current live node.
5. The user can still search for any destination.
6. Search routing is calculated from the live node, not from the last clicked node.
7. When the user moves, the app updates the current node in real time.
8. If the user enters the radius of the next route node, the app advances them automatically.
9. When the app selects a node, it aligns the panorama to the exact stored node pan/tilt.

## Implementation Overview

### 1. New Mode Selection UI

- Add a small toggle or button group to choose between:
  - `Live Location`
  - `Mechanical` (manual search + click navigation)
- This should be visible in the navigation UI and default to `Mechanical`.
- Mode selection state should be stored in JavaScript as `navMode = 'mechanical' | 'live'`.

### 2. GPS Positioning Service

#### 2.1 Enable Geolocation

- When `Live Location` is selected, call `navigator.geolocation.watchPosition(...)`.
- Use options for accuracy and battery tradeoff:
  - `enableHighAccuracy: true`
  - `maximumAge: 1000`
  - `timeout: 5000`

#### 2.2 Live Position State

- Maintain an object:

```js
var livePosition = {
  lat: null,
  lng: null,
  accuracy: null,
  timestamp: null,
  nodeId: null,
  nodeDistance: null
};
```

- Update this object on each `position` callback.
- Show a small status HUD indicator: `Live: active`, `Live: waiting for GPS`, `Live: no fix`.

### 3. Node Proximity Matching

#### 3.1 Build Node Location Index

- After parsing `pano.xml`, create a lightweight location index for all nodes with valid coordinates.
- Each node entry should include:
  - `nodeId`
  - `lat`
  - `lng`
  - `isLocation`
  - `isRoad`
  - `title`
  - `hotspots`

#### 3.2 Distance Calculation

- Use Haversine distance to compute meters between GPS position and each node.
- Example:

```js
function haversine(lat1, lon1, lat2, lon2) { ... }
```

- Use it to find the closest node and the nearest route node.

#### 3.3 Radius Thresholds

- Define two radii:
  - `NODE_SELECT_RADIUS = 8` meters
  - `ROUTE_ADVANCE_RADIUS = 4` meters

- Behavior:
  - If current GPS is within `NODE_SELECT_RADIUS` of a node, mark that node as the current live node.
  - If user is on an active route and enters `ROUTE_ADVANCE_RADIUS` of the next step node, advance automatically.

### 4. Live Node State and Route Integration

#### 4.1 Current Node Tracking

- Introduce `liveNodeId` and `currentNodeId`.
- `currentNodeId` is always the node used to run route calculations.
- In `Mechanical` mode, `currentNodeId` is set by user clicks/travel updates.
- In `Live Location` mode, `currentNodeId` is derived from `liveNodeId`.

#### 4.2 Search Routing from Live Node

- When the user searches for a destination in `Live Location` mode:
  - route from `liveNodeId` to `destNodeId`
  - if `liveNodeId` is undefined, fall back to the current pano node
- This ensures the path reflects the user’s real-world position, not just the last pano.

#### 4.3 Auto-Advance Along Route

- While a route is active, compare updated GPS position to the next route node.
- If within `ROUTE_ADVANCE_RADIUS` of the next node:
  - update the active route by removing the completed step
  - set the new current node to that next node
  - auto-rotate and display the next hotspot as usual

### 5. Exact Pan/Tilt Alignment

#### 5.1 Use Node’s Stored View Direction

- When a live node becomes active, set the panorama camera to: 
  - the node's stored default `pan`, `tilt`, and `fov` from `pano.xml` or from the player state for that node
- This is important for `Live Location` because the user must see the exact environment orientation.

#### 5.2 Align to North / Heading

- If GPS heading is available, optionally adjust the pano orientation so the user’s real-world facing direction matches the panorama view direction.
- This means:
  - if device heading is `0°` (north), rotate pano to a stored north-facing reference when possible
  - if user rotates in the real world, the panorama yaw should mirror the heading change

> This is a stretch goal. If initial version only fixes the node and view alignment, it still achieves the requested effect.

### 6. UX Behavior for Live vs Mechanical

#### 6.1 Live Location Mode

- GPS icon appears in the UI.
- The app displays:
  - `Live location: finding fix...`
  - `Live location: node @ 7m`
  - `Live location: ready`
- Navigation is still allowed, but the route origin is the live node if available.
- If the user searches while moving, the route updates to the current node.

#### 6.2 Mechanical Mode

- The current behavior remains unchanged.
- The user can search and click route hotspots manually.
- Live GPS updates are disabled to avoid interfering.

### 7. Safety and Fallbacks

#### 7.1 Permission Denied or Unsupported

- If geolocation is denied or unavailable:
  - show a clear message: `Live location unavailable. Using manual mode.`
  - switch gracefully to `Mechanical`.

#### 7.2 Low Accuracy

- If GPS accuracy is worse than a threshold (e.g. `> 20m`):
  - show `GPS accuracy low`
  - do not automatically jump nodes until accuracy improves

#### 7.3 Node Ambiguity

- If the user is between nodes and multiple nodes are within radius, choose the one with the smallest Haversine distance.
- If two nodes are nearly equal, prefer the one with `isRoad === true` and/or the node that is already active.

## File / Code Changes

### `output/nav.js`

Add the following main pieces:

1. `navMode` state: `'mechanical' | 'live'`
2. live location UI toggle
3. `navigator.geolocation.watchPosition(...)`
4. `livePosition` state object
5. `collectAllNodeLocations()` helper
6. `findClosestNode(lat, lng)` helper
7. `updateLiveNodeFromPosition()` loop
8. `autoAdvanceLiveRoute()` while on route
9. `alignNodeViewExact(nodeId)` to force the pano to the correct stored node heading

### `output/index.html`

- Add no more than one line if necessary to include `nav.js`.
- Prefer keeping the existing `<script src=