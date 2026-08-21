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

This is **Module 1** of five. It hands off to:

- **Module 2** (WebGIS Verification Support) — will read the `location`
  field on each claim to overlay it on satellite imagery for the Gram Sabha.
- **Module 3** (SDLC/DLC Review & Accountability Dashboard) — will build on
  the `advance` endpoint, adding the mandatory-justification rule for
  rejections.
- **Module 4** (Applicant Status & Appeal Portal) — will read a claim's
  `auditTrail` to show applicants exactly where their claim is and why.
- **Module 5** (Government Analytics Dashboard) — will consume `/api/stats`
  and expand it into district/state-level analytics.
