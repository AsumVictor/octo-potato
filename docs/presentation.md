# Campus Navigator — Project Presentation

---

## Slide 1 — Title

**Campus Navigator**
*In-Panorama Wayfinding System*

Team | Ashesi University | 2026

---

## Slide 2 — The Problem

**Navigating a new campus is harder than it looks.**

- First-year students and visitors constantly get lost trying to find buildings, offices, and services
- Static 2D maps on noticeboards are easy to misread — they give no sense of what things look like in real life
- Google Maps works at the city level, not at the "which path do I take through campus" level
- There was no tool that could say: *stand here, look that way, walk forward* — from inside the actual campus environment

**Our solution:** A navigation system that lives directly inside a 360° photographic tour of the campus. No separate map. No app to download. You see the campus, and the system shows you exactly where to walk next — right there on the panorama in front of you.

> *Speaker note: Set the scene. Ask the audience if they remember their first week on a new campus. That confusion is the problem we solved.*

---

## Slide 3 — Sample Meetings

**We ran structured Scrum meetings throughout the project.**

**Monday — Sprint Kickoff**
- Reviewed the backlog together and agreed on what to build that week
- Broke features into small, assignable tasks
- Each task was moved onto the Kanban board before the meeting ended

**Daily Standup (10 minutes max)**
- Three questions only: What did I do yesterday? What am I doing today? Do I have any blockers?
- Kept the team aligned without eating into work time
- Blockers were flagged early so nobody sat stuck for days

**Friday — Sprint Retrospective**
- Reviewed what was completed vs. what was planned
- Discussed what went well and what slowed us down
- Improvements were carried into the next sprint, not just talked about

**Random Scrum Master**
- The Scrum Master role rotated each sprint, chosen randomly
- This meant everyone experienced facilitation, not just one person
- It kept meetings fair and gave each team member ownership of the process

> *Speaker note: Emphasise that the standups were strict — 10 minutes. When someone ran long, the Scrum Master cut it. That discipline made them actually useful.*

---

## Slide 4 — Workflow

**How we organised work from idea to merged code.**

**Backlog & Kanban**
- Every piece of work started as a card in the backlog — if it wasn't on the board, it didn't exist
- Cards moved through three columns: *Backlog → In Progress → Done*
- At any moment the whole team could see exactly what was being worked on and what was waiting
- We used GitHub Projects as our Kanban board, so it lived right next to the code

**Sprint Structure**
- 1-week sprints gave us a regular rhythm
- At the start of each sprint we pulled cards from the Backlog into In Progress
- At the end we reviewed what was done and reprioritised the Backlog for next week

**Branch Strategy**
- `main` was always stable — no one pushed directly to it
- Every feature or fix got its own branch (e.g. `feature/dijkstra`, `fix/gps-node-match`)
- When done, the branch was submitted as a Pull Request and reviewed before merging

> *Speaker note: Show the GitHub Projects board if possible. Seeing the actual Kanban makes this tangible.*

---

## Slide 5 — UML Diagram

*(Image)*

> *Speaker note: Walk through the diagram. Highlight that each module has one job. Point to AppState and EventBus as the connective tissue between modules — nothing talks to anything else directly.*

---

## Slide 6 — Database Schema

*(Image)*

> *Speaker note: Explain that the "database" is the pano.xml file — parsed at startup into JavaScript objects. Point out the hotspots array as the key field: it's what connects nodes to each other and forms the graph edges.*

---

## Slide 7 — Use Case Diagram

*(Image)*

> *Speaker note: Keep this brief. Two actors — the user and the GPS sensor. Core use cases are: search for a destination, follow navigation steps, get rerouted if lost.*

---

## Slide 8 — Sequence Diagram

*(Image)*

> *Speaker note: Walk through the sequence: user types a destination → Dijkstra runs → path is returned → camera auto-rotates → glowing marker appears on the panorama → user clicks → system advances to next step → repeat until arrival.*

---

## Slide 9 — Tools

**The tools we used and why we chose them.**

**JavaScript (Vanilla)**
We wrote the entire navigation system in plain JavaScript — no React, no frameworks. This was a deliberate choice because the system runs inside an existing Pano2VR panorama player page. Adding a framework would have created conflicts and unnecessary complexity. Keeping it vanilla meant it worked anywhere the panorama loaded.

**Pano2VR**
This is the 360° panorama player that renders the campus tour. It exposes a JavaScript API — `getPan()`, `setTilt()`, `getCurrentNode()` — which we hooked into to control the camera and detect when the user moves between locations.

**Jest**
Our unit testing framework. We used it to test the Dijkstra pathfinding logic, the GPS haversine distance formula, and the live location matching. Jest runs entirely in Node — no browser required — which made it fast and easy to plug into CI.

**GitHub**
Version control and collaboration. All code lived on GitHub. Every feature was a branch, every merge went through a Pull Request.

**GitHub Actions**
Automated testing on every Pull Request. The moment code was pushed, GitHub Actions installed dependencies and ran the full Jest test suite. If tests failed, the PR was blocked from merging.

**Jenkins**
Our CI/CD server for deeper pipeline work. Jenkins ran on every merge to `main`, published a JUnit test results dashboard, and generated an HTML code coverage report so we could see exactly which lines of code were tested and which weren't.

> *Speaker note: The key story here is the chain — developer pushes → Actions runs tests → if green, PR can merge → Jenkins confirms on main and reports coverage. Nothing ships without passing tests.*

---

## Slide 10 — GitHub & Pull Requests

**Every line of code was reviewed before it touched main.**

**How it worked:**
- A developer finished a feature on their branch and opened a Pull Request
- At least one teammate reviewed the diff — checking logic, naming, and whether it broke anything
- Reviewer left comments or approved
- Only after approval could the branch be merged

**What Pull Requests gave us:**
- **Caught bugs early** — reviewers spotted logic errors that the author had looked past
- **Shared knowledge** — everyone on the team saw every change, so no one was siloed
- **Clean history** — the git log tells the full story of what was built and why
- **Protected main** — main was always in a working state because nothing untested or unreviewed got in

**Branch naming convention:**
- `feature/` for new functionality
- `fix/` for bug fixes
- `refactor/` for code improvements

> *Speaker note: Pull up a real PR from the repo if you can. Show an actual review comment. It makes the process concrete.*

---

## Slide 11 — GitHub Actions & Jenkins (CI/CD)

**We automated the safety net so humans didn't have to be it.**

**The problem CI solves:**
Without automation, you rely on people remembering to run tests before pushing. People forget. CI doesn't.

**GitHub Actions — runs on every Pull Request:**
1. Checks out the branch
2. Runs `npm ci` to install dependencies cleanly
3. Runs the full Jest test suite
4. Reports pass or fail directly on the PR — green checkmark or red X
5. A red result blocks the merge button

**Jenkins Pipeline — runs on every merge to main:**
- Stage 1 — `Install`: `npm ci`
- Stage 2 — `Test`: `npm run test:ci` with JUnit output
- After both stages: publishes the JUnit XML so Jenkins shows a per-test pass/fail table
- Publishes the HTML coverage report so the team can see coverage trends over time

**The result:**
If you broke something, you knew within 2 minutes of pushing. You fixed it before it became anyone else's problem.

> *Speaker note: Explain the difference between Actions and Jenkins — Actions is lightweight and fast, lives on GitHub, great for PR gates. Jenkins is the heavier pipeline that gives us richer reporting and coverage history.*

---

## Slide 12 — Code Principles

**We followed two core principles that kept the codebase manageable.**

**1. Separation of Concerns**

Every module does exactly one thing. If you open any file in the project, you know immediately what it is responsible for:

- `Pathfinder.js` — finds the shortest route between two nodes. Nothing else.
- `Renderer.js` — draws on the canvas overlay. Nothing else.
- `AppState.js` — holds shared data (nodes, graph, current route). Nothing else.
- `EventBus.js` — lets modules communicate without knowing about each other. Nothing else.
- `XmlLoader.js` — fetches and parses the XML file. Nothing else.

This meant when something broke, we knew exactly which file to open. It also meant we could work on different modules in parallel without stepping on each other.

**2. Prototype Pattern**

All modules are built using JavaScript's prototype pattern — a constructor function defines the object, and methods are attached to `.prototype`. For example, `Pathfinder` is constructed with `new Nav.Pathfinder()` and its `find()` method lives on `Pathfinder.prototype.find`.

Why this matters:
- Each instance is independent and testable in isolation
- The global namespace stays clean — everything lives under one `Nav` object
- It mirrors how the existing Pano2VR codebase was structured, so our code fits naturally alongside it

> *Speaker note: If the audience is technical, contrast this with just dumping everything in one big nav.js file — which is what the first version looked like. The refactor into modules made testing possible and bugs much easier to trace.*

---

## Slide 13 — Jest Unit Tests

**We wrote automated tests for every critical algorithm.**

**What we tested:**

`pathfinder.test.js`
Tests the Dijkstra algorithm directly. Verifies that given a known graph, the shortest path returned is correct. Also tests edge cases — what happens if the start and end are the same node, what happens if no path exists (disconnected graph), what happens with a single-node graph.

`haversine.test.js`
Tests the GPS distance formula. Haversine calculates the real-world distance in metres between two GPS coordinates. We tested it against known distances to make sure our routing weights were accurate.

`gps.test.js`
Tests the live location logic — given a GPS coordinate, does the system correctly identify the nearest campus node? This is the bridge between the device's location sensor and the navigation graph.

**Why Jest specifically:**
- Runs in Node — no need to open a browser to test logic
- `jsdom` simulates the browser DOM so we could test modules that touch the page
- Produces JUnit XML output, which Jenkins consumes natively to display test results in its dashboard
- Built-in code coverage via Istanbul — after every test run we could see which lines were hit and which weren't

**Result:** Tests run in under 2 seconds. Every Pull Request had to pass them before it could be merged.

> *Speaker note: Stress the confidence this gives. When someone refactors Dijkstra and the tests still pass, you know the routing still works. Without tests, every change is a gamble.*

---

## Slide 14 — Jenkins in Detail

**Jenkins was our pipeline engine for the main branch.**

**The Jenkinsfile (lives in the repo root):**

The pipeline is defined as code — it lives in the repository alongside the application. That means the pipeline itself goes through version control and Pull Request review, just like everything else.

**Two stages:**

`Install` — runs `npm ci`, which installs dependencies exactly as locked in `package-lock.json`. Clean, reproducible, no surprises.

`Test` — runs `npm run test:ci`, which runs Jest in CI mode and outputs results in JUnit XML format to `junit.xml`.

**Post-build actions (always run, even on failure):**
- Publishes `junit.xml` → Jenkins shows a per-test table with pass/fail/duration for every test
- Publishes the `coverage/lcov-report` folder → HTML coverage report viewable directly in Jenkins
- On failure: prints "Tests failed — check the Test Results tab" so the team knows where to look

**Why this matters:**
Coverage reports let us see over time whether we were testing more or less of the codebase as we added features. It's a metric, not a target — but a dropping coverage number is a signal worth investigating.

> *Speaker note: If you have access to the Jenkins dashboard, show the test results table and coverage report. Seeing real numbers is more convincing than describing them.*

---

## Slide 15 — DEMO

**What you are about to see:**

**3D Rendered 360° Panorama**
The campus is photographed as a series of 360° images stitched together in Pano2VR. You can look in any direction, zoom in, and click hotspots to move between locations — like walking through the campus virtually.

**Live GPS Location**
Open the app on a phone with GPS enabled. The system reads the device's coordinates, calculates the distance to every campus node using the Haversine formula, and locks onto the nearest one as your starting position. Your location updates in real time as you move.

**Dijkstra Routing**
Type a destination — for example, "Hallmark". The Pathfinder module runs Dijkstra's algorithm across the campus graph, weighing edges by real walking distances. In milliseconds it returns the ordered list of nodes from your location to the destination.

**Route to Hallmark**
Watch what happens next:
- The panorama camera auto-rotates to face the first waypoint
- A glowing pulsing ring appears on that hotspot in the panorama
- A bouncing arrow points directly at it
- A HUD at the bottom shows your step count and distance remaining
- Click the hotspot — the panorama moves to the next node, the camera rotates to the next waypoint, and the process repeats
- When you arrive: a full-screen flash and an arrival message

> *Speaker note: Do the demo live. If anything goes wrong with GPS indoors, explain that GPS signal indoors is weak and switch to manually selecting a starting node to show the routing.*

---

## Slide 16 — Thank You

**Campus Navigator**

*Shortest path from anywhere to everywhere — inside the panorama.*

Questions?
