# Overclaim & Competing Claim Resolution Workflow Demo

This document outlines the step-by-step verification and demonstration procedure for the Overclaim / Competing Claim workflow in TribalEarth AI.

---

## 1. Demo Prerequisites

Start the server locally from the `server` directory:
```bash
cd server
npm start
```
The server will run on `http://localhost:3000`.

### Demo User Accounts
All demo credentials use modern scrypt password hashes:

| Role | Username | Password | Notes |
|---|---|---|---|
| Applicant 1 | `applicant1` | `applicant123` | Existing applicant account |
| Applicant 2 | `applicant2` | `applicant2123` | Added demo account |
| Applicant 3 | `applicant3` | `applicant3123` | Added demo account |
| Gram Sabha Officer | `gramsabha1` | `gram123` | Gram Sabha review officer |
| Sub-Divisional Officer | `sdlc1` | `sdlc123` | SDLC stage officer |
| District Officer | `dlc1` | `dlc123` | DLC stage officer |

---

## 2. Step-by-Step Scenario Walkthrough

### Scenario Overview
Two distinct applicants (`applicant2` and `applicant3`) file claims over the identical parcel of land in the same village and upload identical evidence files. The Gram Sabha officer reviews both claims, identifies the conflict, observes the blocked approval, resolves the conflict with written justification, and proceeds with review.

---

### Step 1: Applicant 2 Files a Claim
1. Open a browser (or incognito window) at `http://localhost:3000`.
2. Login as `applicant2` (password: `applicant2123`).
3. Click **File Claim** in the navigation bar.
4. Fill in the details:
   - **Claimant Name:** Ramesh Munda
   - **Village:** Barwadih
   - **Panchayat:** Barwadih
   - **District:** Ranchi
   - **Claim Type:** Individual (IFR)
5. **Location Pin / Geometry (Mandatory):**
   - Click on the map to set a location pin around `[23.344, 85.309]`, or draw a parcel polygon.
6. **Upload Proof Document:**
   - Attach any sample document (e.g., `sample_proof.pdf` or an image).
7. Submit the claim. Note the generated Claim ID (e.g., `CLM-xxxxxx-01`).
8. Notice that under My Claims, the applicant sees only their claim details. No other claimants or internal conflict tags are shown.

---

### Step 2: Applicant 3 Files an Overlapping Claim with Identical Proof
1. Log out or open a separate private browsing session at `http://localhost:3000`.
2. Login as `applicant3` (password: `applicant3123`).
3. Click **File Claim**.
4. Fill in details:
   - **Claimant Name:** Suresh Oraon
   - **Village:** Barwadih
   - **Panchayat:** Barwadih
   - **District:** Ranchi
   - **Claim Type:** Individual (IFR)
5. **Location:**
   - Click the map within 50 meters of Applicant 2's location, or draw an overlapping polygon.
6. **Proof Document:**
   - Upload the **exact same proof file** uploaded in Step 1.
7. Click **Submit**.
8. Notice the filing confirmation screen displays a neutral advisory notice:
   > *"Notice: An advisory review flag has been recorded for this area. A Gram Sabha officer will review boundary details during verification."*
   - Crucially, no information about Applicant 2, their name, or their claim ID is revealed.

---

### Step 3: Gram Sabha Officer Queue View
1. Log out and log in as `gramsabha1` (password: `gram123`).
2. The **Officer Dashboard & Queue** displays both pending claims.
3. Observe the queue badges:
   - Both claims show a bold red **"1 Competing"** badge indicating an open competing conflict.
   - Both claims show a **"Duplicate Proof"** badge highlighting that identical evidence hashes were detected.

---

### Step 4: Review Drawer & Approval Blocking
1. Click on Applicant 2's claim row to open the Review Drawer.
2. At the top of the drawer, a prominent **Competing Claim Banner** is displayed:
   - **Header:** "Competing Claim / Overclaim Detected"
   - **Details:** Identifies competing Claim ID, Current Stage (`Gram Sabha`), and reasons:
     - `Spatial boundary overlap detected`
     - `Duplicate proof document (matching SHA-256 hash)`
3. Check the **Map View**:
   - The competing claim polygon/pin is highlighted in a **thick red dashed outline** (`#dc2626`).
4. Inspect the decision buttons at the bottom:
   - The **Approve** button is disabled with an explanatory tooltip:
     > *"Approval is blocked: this claim has 1 unresolved competing conflict(s). Resolve all competing conflicts before approving."*
   - The **Reject** button remains active and accessible.

---

### Step 5: Conflict Resolution by Human Officer
1. Within the Competing Claim banner, locate the **Resolution Form**:
   - **Finding:** Select one of the three statutory findings:
     - `Boundaries do not conflict / field verification clarified overlap`
     - `Shared customary use accepted by both parties`
     - `This claim has stronger historical / customary evidence`
   - **Officer Justification (Reason):** Enter a detailed written explanation (minimum 10 characters):
     > *"Field verification completed with village elders; boundaries demarcated and mutually accepted."*
2. Click **Submit Resolution**.
3. The conflict updates immediately to **Resolved**.
4. The banner transitions to show the resolution summary (finding, officer username, timestamp).
5. The **Approve** button is now unlocked and enabled.
6. Click **Approve Claim** with remarks. The claim advances to the `SDLC` stage.

---

### Step 6: Terminal Rejection Moots Counterpart (Optional Verification)
1. Open Applicant 3's claim as `gramsabha1`.
2. Reject the claim with a written reason: *"Evidence insufficient after joint hearing."*
3. Because Applicant 3's claim is now rejected, any linked open conflict entries referencing it are automatically marked `moot`.
