# TribalEarth AI — Module 1: Claim Digitization & Submission

This is the first module of TribalEarth AI: the entry point of the FRA
claim pipeline. It **does not replace** Gram Sabha → SDLC → DLC — it
digitizes claim intake and keeps a permanent, timestamped audit trail
as a claim moves through those exact stages.

## What's included

- **Claim filing form** (Applicant & Village → Land & Claim Type → Documents → Review)
  for IFR / CR / CFR claims, with a supporting-document uploader.
- **Claims Register** — a searchable, filterable ledger view (for FRC / Gram
  Sabha use) showing every filed claim, its current stage, and claim type.
- **Audit trail drawer** — click any claim to see its full stage history and
  manually advance it to the next stage (Gram Sabha → SDLC → DLC), which is
  exactly how the real pipeline is supposed to work — nothing skips a stage.
- **Stats strip** — quick counts by stage and by claim type, which is the
  seed of the Module 5 government dashboard later.

## Tech stack

- **Backend:** Node.js + Express, file-based JSON storage (`server/data/claims.json`)
  so there's zero database setup required to run this locally. Swap this for
  PostgreSQL/PostGIS later without changing the API routes.
- **Frontend:** plain HTML/CSS/JS — no build step, no framework, so it opens
  and runs instantly in VS Code with nothing but Node installed.
- **File uploads:** handled by Multer, saved to `server/data/uploads/`.

## Running it in VS Code

1. Open the `tribalearth-module1` folder in VS Code (`File → Open Folder…`).
2. Open a terminal in VS Code (`` Ctrl+` ``) and run:

   ```bash
   cd server
   npm install
   npm start
   ```

3. Open **http://localhost:4000** in your browser. That's it — one server
   serves both the API and the frontend, so there's nothing else to run.

   If you'd rather auto-restart on file changes while developing, install
   nodemon once (`npm install -D nodemon`) and run `npx nodemon server.js`
   instead of `npm start`.

## Project structure

```
tribalearth-module1/
└── server/
    ├── server.js              # Express app + all API routes
    ├── package.json
    ├── data/
    │   ├── claims.json        # claim records (auto-created, gitignored)
    │   └── uploads/           # uploaded documents (gitignored)
    └── public/
        ├── index.html
        ├── css/styles.css     # design tokens + all styling
        └── js/app.js          # stepper, uploads, register, drawer logic
```

## API reference

| Method | Route                       | Purpose                                             |
|--------|------------------------------|------------------------------------------------------|
| POST   | `/api/claims`                | File a new claim (multipart form, at Gram Sabha stage) |
| GET    | `/api/claims`                | List claims — filters: `village`, `district`, `state`, `claimType`, `stage`, `status`, `q` |
| GET    | `/api/claims/:id`            | Get one claim, including its full audit trail        |
| PATCH  | `/api/claims/:id/advance`    | Move a claim to the next stage, appends an audit entry |
| GET    | `/api/stats`                 | Aggregate counts by stage and claim type              |

## Design notes

The interface uses a warm paper background (`#F6F3EA`), forest green
(`#2F5233`) and ochre (`#C1873A`) as the core palette — deliberately earthy
rather than a generic SaaS blue, since the subject is forest land and
community rights. Headings use **Fraunces** (a serif with real character,
evoking an official land record rather than a tech-startup feel); body text
uses **Work Sans**; claim IDs, coordinates, and stage codes use **IBM Plex
Mono** to read like stamped register entries. The faint contour-line
background pattern is a deliberate nod to the GIS/terrain side of the
project.

## Where this fits in the bigger picture

This is **Module 1 + Module 3 + Module 4** of five (Module 3 built directly on
Module 1's pipeline, and Module 4 added applicant privacy and tracking). Remaining modules:

- **Module 2** (WebGIS Verification Support) — Included. Reads the `location` and `geometry`
  fields on each claim to overlay it on satellite imagery. Validates area, distance, and overlap.
- **Module 5** (Government Analytics Dashboard) — will consume `/api/stats`
  and expand it into district/state-level analytics.

## Module 3 — Role-based login, AI-assisted document review & escalation

### Separate logins per role

Applicant, Gram Sabha, SDLC, and DLC are genuinely separate, access-controlled
roles — not a cosmetic dropdown. Demo accounts (properly hashed passwords,
never plaintext — see `server/services/authService.js`):

| Username     | Password        | Role         |
|--------------|-----------------|--------------|
| `applicant1` | `applicant123`  | Applicant    |
| `gramsabha1` | `gramsabha123`  | Gram Sabha   |
| `sdlc1`      | `sdlc123`       | SDLC         |
| `dlc1`       | `dlc123`        | DLC          |

**Honest scope:** this is a real, working login system (server-verified
session tokens, scrypt-hashed passwords), but it is *not* production user
management — no registration, no password reset, sessions live in memory
and clear on server restart. A real deployment would replace
`authService.js` with proper identity management without changing the
shape of the middleware (`requireRole`, `requireStageRole`) that consumes
it. Filing a claim requires logging in as an applicant; every officials
action (queue view, document classification, confirmation, decisions)
requires logging in with the role matching that specific claim's *current*
stage — an SDLC officer genuinely cannot touch a claim sitting at DLC,
enforced server-side, not just hidden in the UI.

### Escalation rules (the actual point of this module)

- **Reject at Gram Sabha → terminal.** The claim does not move to SDLC.
- **Reject at SDLC → does NOT terminate.** It automatically forwards to
  DLC, carrying the SDLC officer's rejection reason with it
  (`claim.priorRejection`), shown prominently to the DLC officer reviewing
  it. This models an SDLC rejection as an escalation for final DLC
  determination, not a dead end.
- **Reject at DLC → terminal.** DLC is the final stage — nowhere left to
  escalate to.
- **Approve** at any non-final stage forwards to the next stage; approve
  at DLC grants the claim.

All of this is enforced in `POST /api/claims/:id/decision` in `server.js`,
independent of anything the frontend does.

### AI-assisted document classification

**What the AI does, honestly:** classifies which FRA Rule 13 (2007, as
amended 2012) evidence category an uploaded document likely belongs to,
using OCR (`tesseract.js`) plus keyword matching, and flags whether the
applicant's name/village appear in the extracted text. That's it.

**What it explicitly does NOT do:** verify that a document is genuine, or
detect fraud. Neither is something a keyword-matching approach — or,
honestly, most ML approaches without a large labeled dataset of confirmed
genuine vs. fraudulent FRA claims, which doesn't exist publicly — can do
responsibly. See `server/services/documentClassificationService.js` for
the full reasoning.

**The officer's tick is the only thing that counts.** No document is
counted toward the Rule 13 checklist without an explicit officer
confirmation, enforced at the API layer (`/confirm`), not just in the UI.
The confirming officer's identity comes from their login session — a
client can no longer just type in any name.

**Rejecting a claim requires a written justification (≥10 characters),
enforced server-side.** This targets the real, documented failure mode in
FRA implementation: claims rejected with no stated reason and no path to
appeal.

**A real bug found and worked around while building this:** `tesseract.js`
downloads its language model from a public CDN on first use. If that fetch
fails (no internet, a restricted network, a CDN outage), the resulting
error bypasses normal `try/catch` and crashes the entire Node process —
verified directly during development. `server.js` has a narrow, documented
`process.on("uncaughtException")` safety net specifically for this one
failure mode. If OCR fails for any reason, `/classify` returns a clear
error and the document can still be reviewed and confirmed manually — it
never fabricates a classification.

**Requires internet access on first use per machine** (to download the
English language model, then it's cached in `server/data/tesseract-cache`
for offline reuse after that). PDF documents are not yet OCR'd — only
image files (jpg/png/etc.) — a stated scope limit, not a silent gap.

### New API routes

| Method | Route                                        | Auth required                          |
|--------|-----------------------------------------------|-----------------------------------------|
| POST   | `/api/auth/login`                             | none (this *is* the login)              |
| POST   | `/api/auth/logout`                            | any logged-in session                   |
| GET    | `/api/auth/me`                                | any logged-in session                   |
| GET    | `/api/officials/queue?stage=`                 | officer role matching that stage        |
| POST   | `/api/claims/:id/documents/:index/classify`   | officer role matching claim's stage     |
| POST   | `/api/claims/:id/documents/:index/confirm`    | officer role matching claim's stage     |
| POST   | `/api/claims/:id/decision`                    | officer role matching claim's stage     |

## Module 4 & Privacy Fix — Applicant Tracker and Appeals

### Privacy Fix
The platform now enforces strict privacy:
- **No anonymous access**: All claim endpoints (listing, details, stats, document downloads) now require a valid authenticated session.
- **Data segmentation**: Applicants (`ownerId`) can only see their own claims (`GET /api/my/claims`). Officers can view claims in their queue, but applicants never see internal officer notes or other applicants' data.
- **Secure File Delivery**: Files are served through `GET /api/claims/:id/documents/:docId`, stripping the public `/uploads` directory and ensuring only authorized users can read attachments.

### Applicant "My Claims" Tracker
- A localized, accessible applicant dashboard showing claim stage, status (Submitted, Under Review, Approved, Rejected), and timeline.
- **Clear Rejection Reasons**: If a claim is rejected, the applicant sees exactly *why* and by *whom*, addressing opaque rejections. A native "Read Aloud" button helps low-literacy users.
- **Appeals**: Applicants have exactly one chance to appeal a Gram Sabha rejection to the SDLC within 60 days. Ground for appeal must be provided, and the appeal resets the claim stage and escalates it directly to SDLC.

### New API routes for Applicants
| Method | Route                                        | Auth required                          |
|--------|-----------------------------------------------|-----------------------------------------|
| GET    | `/api/my/claims`                              | Applicant role                          |
| GET    | `/api/my/claims/:id`                          | Applicant role (must own claim)         |
| POST   | `/api/my/claims/:id/appeal`                   | Applicant role (must own claim, GS rejection, within 60d) |
| GET    | `/api/claims/:id/documents/:docId`            | Applicant (owner) or assigned Officer   |

## Module 2 — WebGIS Map Verification Support

### Geo-Endpoints and Privacy
- **Applicant Mapping**: The filing form now includes an interactive Leaflet map, letting applicants drop a pin using device GPS or trace a boundary polygon.
- **Verification Support**: Officers see a satellite map overlay of the claim boundary and any nearby anonymized claims.
- **Automated Geometry Checking**: Turf.js runs offline on the server to catch polygon kinks (self-intersections), compute area (hectares), and flag potential overlapping boundaries.
- **Privacy First**: Nearby claims shown on the map are strictly governed by role-based access. Claims belonging to other individuals are visible only as generic "Anonymized Claim" dots or polygons, stripping personal metadata.
- **Tiles Configuration**: Managed in `server/public/js/mapConfig.js`, enabling easy swapping of Esri/OpenStreetMap tile endpoints.

| Method | Route                                        | Auth required                          |
|--------|-----------------------------------------------|-----------------------------------------|
| PATCH  | `/api/my/claims/:id/location`                 | Applicant role                          |
| GET    | `/api/claims/:id/geo`                         | Applicant (owner) or assigned Officer   |
| POST   | `/api/claims/:id/map-check`                   | Officer role matching claim's stage     |
