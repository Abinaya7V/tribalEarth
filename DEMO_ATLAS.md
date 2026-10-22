# TribalEarth AI — Atlas Map & Verification Demo

This document outlines the step-by-step procedure to demonstrate the read-only **Atlas** map for officers, near-live 20-second viewport polling, polygon and point styling by status, conflict overlays, access logs, and applicant privacy.

---

## 1. Quick Start & Demo Seeding

### Step 1: Seed Demo Data
Seed 13 realistic claims across two villages (`Gondgaon` and `Salguda` in Ranchi, Jharkhand) with 11 boundary polygons and 2 location points into an isolated demo folder:

```bash
# From repository root
node scripts/seed-atlas-demo.js ./demo_atlas_data --force
```

### Step 2: Start the Server with Demo Data
Run the server targeting the seeded demo directory:

**Windows PowerShell:**
```powershell
$env:DATA_DIR = "$PWD/demo_atlas_data"
cd server
npm start
```

**macOS / Linux:**
```bash
DATA_DIR="$PWD/demo_atlas_data" npm --prefix server start
```

The server will start on `http://localhost:4000`.

---

## 2. Step-by-Step Walkthrough

### Part A: Applicant Access Check (Atlas Tab is Officer-Only)
1. Open a browser window at `http://localhost:4000`.
2. Login as `applicant1` (password: `applicant123`).
3. Observe the top navigation bar:
   - Visible tabs: **01 File a Claim**, **03 My Claims**.
   - The **05 Atlas** tab is completely hidden and inaccessible to citizens.
   - If an applicant tries to access `GET /api/atlas/summary`, the API returns `403 Forbidden`.

---

### Part B: Officer View & Map Exploration
1. Log out and log in as `gramsabha1` (password: `gramsabha123`).
2. Notice the **05 Atlas** tab is now visible in the primary navigation.
3. Click the **05 Atlas** tab:
   - The map loads centered on Jharkhand, India.
   - Street and Satellite layer controls are available in the upper right.
   - Persistent statutory notice displayed at bottom-left:
     > *"Boundaries are claimed by applicants and not surveyed; 'verified' means an officer checked the location on the map."*
   - Status legend explains status styling:
     - **Submitted / Under Review:** Solid Amber (`#f59e0b`)
     - **Escalated to DLC:** Solid Orange (`#f97316`)
     - **Appealed:** Solid Purple (`#8b5cf6`)
     - **Approved:** Solid Green (`#22c55e`) with thicker border
     - **Rejected:** Grey dashed outline (`#9ca3af`)
     - **Open Conflict (Disputed):** Thick red dashed outline (`#dc2626`)
   - Notice the status strip: *"Last updated hh:mm:ss"*, Refresh button, and filter dropdowns.

---

### Part C: Village & Status Filtering
1. Open the **Village** dropdown in the toolbar:
   - Select `Salguda`.
   - The map automatically animates/flies directly to the bounding box of Salguda village.
2. Check the **Disputed only** toggle:
   - The map filters to show only the competing conflict pair (`FRA-2026-JH-DEMO07` and `FRA-2026-JH-DEMO08`) highlighted in red dashed borders.
3. Uncheck **Disputed only** to restore all village claims.

---

### Part D: Claim Detail Side Panel, Timeline & Proofs
1. Click on the Green Approved parcel (`FRA-2026-JH-DEMO03`, Mangra Ho):
   - The right side panel opens smoothly.
   - **Header:** Applicant name, Claim ID, Approved status badge.
   - **Boundary status:** Displays `"Verified on map by DLC Officer on <date>"`.
   - **Customary Dates:** Shows `"Occupation since: 1995"` and `"Granted on: <date>"`. No end date is shown.
   - **Recent Activity:** Displays chronological audit trail entries newest first.
   - **Proofs:** Displays uploaded proof documents with confirmed Rule 13 classifications (e.g. `Rule 13: Elders testimony / customary proof`).
   - Click the document name to download the proof file using secure authenticated token delivery.
2. Click on the Disputed parcel (`FRA-2026-JH-DEMO07`):
   - Observe the **Conflicts** banner showing competing claim ID `FRA-2026-JH-DEMO08` with `SPATIAL_OVERLAP`.
3. Press the **Esc** key:
   - The side panel closes immediately.

---

### Part E: Live 20-Second Polling & "New" Pulsing Ring (Addendum)
1. Keep the Atlas tab open in Window A as officer `gramsabha1`.
2. Open a separate Incognito or browser window (Window B) at `http://localhost:4000`.
3. Login as `applicant1` (password: `applicant123`).
4. Go to **File a Claim**:
   - Applicant Name: `Live Update Demo Claimant`
   - Village: `Gondgaon`
   - District: `Ranchi`
   - State: `Jharkhand`
   - State Code: `JH`
   - Claim Type: `IFR`
   - Occupation since: `2005`
   - Draw a polygon boundary on the map around `[23.362, 85.312]`.
   - Click **Submit Claim**.
5. Switch back to Window A (the Officer Atlas tab):
   - Within 20 seconds, the viewport background poll detects the new claim without page refresh!
   - A dismissible notification toast appears: *"1 new claim(s) added" [View]*.
   - Click **View** on the toast:
     - The map flies directly to the new claim.
     - The new parcel boundary features a **pulsing animated ring** and a `"New"` tag on its tooltip.
     - The user's zoom, pan, and active side panel remain intact.

---

### Part F: Access Audit Log Inspection
Open the generated access log file in the demo directory:
```bash
cat demo_atlas_data/atlas-access.log
```
Each Atlas detail view and proof download appends a transparent audit entry:
```json
{"ts":"2026-10-22T...","user":"gramsabha1","role":"gram_sabha","claimId":"FRA-2026-JH-DEMO03","action":"view_detail"}
{"ts":"2026-10-22T...","user":"gramsabha1","role":"gram_sabha","claimId":"FRA-2026-JH-DEMO03","action":"download_document"}
```
No passwords, tokens, or personal identifiers are leaked into the audit trail.
