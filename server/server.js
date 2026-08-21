/**
 * TribalEarth AI — Module 1: Claim Digitization & Submission
 * ------------------------------------------------------------
 * This service is the entry point of the FRA claim pipeline.
 * It does NOT decide claims — it only:
 *   1. Creates an immutable, timestamped record the moment a
 *      claim is filed at Gram Sabha / FRC level.
 *   2. Attaches supporting documents.
 *   3. Keeps a stage-by-stage audit trail (Gram Sabha -> SDLC -> DLC)
 *      so a claim can never silently disappear between stages.
 *
 * Storage: a local JSON file (data/claims.json) so the whole
 * module runs with zero external database setup — swap this
 * for PostgreSQL/PostGIS later without touching the API surface.
 */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { customAlphabet } = require("nanoid");

const app = express();
const PORT = process.env.PORT || 4000;

const DATA_DIR = path.join(__dirname, "data");
const CLAIMS_FILE = path.join(DATA_DIR, "claims.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// ---------- bootstrap storage ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CLAIMS_FILE)) fs.writeFileSync(CLAIMS_FILE, "[]", "utf-8");

function readClaims() {
  return JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf-8"));
}
function writeClaims(claims) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2), "utf-8");
}

// ---------- claim ID generator ----------
// Format: FRA-<year>-<state code>-<4 char code>  e.g. FRA-2026-CG-9F3K
const genShortCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
function generateClaimId(stateCode) {
  const year = new Date().getFullYear();
  const code = (stateCode || "XX").toUpperCase().slice(0, 2);
  return `FRA-${year}-${code}-${genShortCode()}`;
}

// ---------- file upload handling ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB per file
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

// ---------- helpers ----------
const VALID_CLAIM_TYPES = ["IFR", "CR", "CFR"];
const STAGES = ["Gram Sabha", "SDLC", "DLC"];

function nowISO() {
  return new Date().toISOString();
}

// ---------- routes ----------

/**
 * POST /api/claims
 * Creates a new claim at Gram Sabha stage.
 * multipart/form-data fields:
 *   applicantName, guardianName, village, gramPanchayat, district, state,
 *   stateCode, claimType (IFR|CR|CFR), landDescription, yearsOfCultivation,
 *   latitude, longitude, language
 * files: documents (multiple)
 */
app.post("/api/claims", upload.array("documents", 6), (req, res) => {
  const {
    applicantName,
    guardianName,
    village,
    gramPanchayat,
    district,
    state,
    stateCode,
    claimType,
    landDescription,
    yearsOfCultivation,
    latitude,
    longitude,
    language,
    bilingualData,
  } = req.body;

  if (!applicantName || !village || !district || !state || !claimType) {
    return res.status(400).json({
      error:
        "Missing required fields: applicantName, village, district, state, claimType.",
    });
  }
  if (!VALID_CLAIM_TYPES.includes(claimType)) {
    return res.status(400).json({
      error: `claimType must be one of ${VALID_CLAIM_TYPES.join(", ")}`,
    });
  }

  const claims = readClaims();
  const claimId = generateClaimId(stateCode);
  const timestamp = nowISO();

  const documents = (req.files || []).map((f) => ({
    originalName: f.originalname,
    storedName: f.filename,
    url: `/uploads/${f.filename}`,
    sizeBytes: f.size,
  }));

  const claim = {
    claimId,
    applicantName,
    guardianName: guardianName || "",
    village,
    gramPanchayat: gramPanchayat || "",
    district,
    state,
    stateCode: (stateCode || "").toUpperCase(),
    claimType,
    landDescription: landDescription || "",
    yearsOfCultivation: yearsOfCultivation || "",
    location:
      latitude && longitude
        ? { lat: parseFloat(latitude), lng: parseFloat(longitude) }
        : null,
    language: language || "en",
    bilingualData: bilingualData ? JSON.parse(bilingualData) : null,
    documents,
    currentStage: "Gram Sabha",
    status: "Submitted",
    createdAt: timestamp,
    updatedAt: timestamp,
    auditTrail: [
      {
        stage: "Gram Sabha",
        action: "Claim submitted",
        actor: "Applicant / FRC",
        note: "Claim filed and recorded at Gram Sabha level.",
        timestamp,
      },
    ],
  };

  claims.push(claim);
  writeClaims(claims);

  res.status(201).json({ message: "Claim submitted successfully.", claim });
});

/**
 * GET /api/claims
 * Lists claims. Optional query filters: village, district, state, claimType, stage, status
 */
app.get("/api/claims", (req, res) => {
  let claims = readClaims();
  const { village, district, state, claimType, stage, status, q } = req.query;

  if (village) claims = claims.filter((c) => c.village === village);
  if (district) claims = claims.filter((c) => c.district === district);
  if (state) claims = claims.filter((c) => c.state === state);
  if (claimType) claims = claims.filter((c) => c.claimType === claimType);
  if (stage) claims = claims.filter((c) => c.currentStage === stage);
  if (status) claims = claims.filter((c) => c.status === status);
  if (q) {
    const needle = q.toLowerCase();
    claims = claims.filter(
      (c) =>
        c.applicantName.toLowerCase().includes(needle) ||
        c.claimId.toLowerCase().includes(needle) ||
        c.village.toLowerCase().includes(needle)
    );
  }

  claims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ count: claims.length, claims });
});

/**
 * GET /api/claims/:id
 */
app.get("/api/claims/:id", (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  res.json({ claim });
});

/**
 * PATCH /api/claims/:id/advance
 * Moves a claim to the next stage in the pipeline and appends an
 * audit trail entry. This keeps the Gram Sabha -> SDLC -> DLC
 * sequence intact — it never skips a stage.
 * body: { note, actor }
 */
app.patch("/api/claims/:id/advance", (req, res) => {
  const claims = readClaims();
  const idx = claims.findIndex((c) => c.claimId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Claim not found." });

  const claim = claims[idx];
  const currentIdx = STAGES.indexOf(claim.currentStage);
  if (currentIdx === -1 || currentIdx === STAGES.length - 1) {
    return res.status(400).json({
      error: `Claim is already at its final stage (${claim.currentStage}).`,
    });
  }

  const nextStage = STAGES[currentIdx + 1];
  const timestamp = nowISO();
  claim.currentStage = nextStage;
  claim.status = "Under Review";
  claim.updatedAt = timestamp;
  claim.auditTrail.push({
    stage: nextStage,
    action: "Forwarded",
    actor: req.body.actor || "System",
    note: req.body.note || `Claim forwarded to ${nextStage}.`,
    timestamp,
  });

  writeClaims(claims);
  res.json({ message: `Claim forwarded to ${nextStage}.`, claim });
});

/**
 * GET /api/stats
 * Lightweight aggregate counts — feeds a future Module 5 dashboard.
 */
app.get("/api/stats", (req, res) => {
  const claims = readClaims();
  const byStage = STAGES.reduce((acc, s) => {
    acc[s] = claims.filter((c) => c.currentStage === s).length;
    return acc;
  }, {});
  const byType = VALID_CLAIM_TYPES.reduce((acc, t) => {
    acc[t] = claims.filter((c) => c.claimType === t).length;
    return acc;
  }, {});
  res.json({ total: claims.length, byStage, byType });
});

// ---------- centralized error handler ----------
// Catches Multer errors (bad uploads, too many files, oversized files)
// and anything else thrown in a route, and returns clean JSON instead
// of letting Express dump a raw stack trace to the terminal.
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    const friendly =
      err.code === "LIMIT_UNEXPECTED_FILE"
        ? "Too many documents attached, or a file was sent under an unexpected field name. Please attach at most 6 files."
        : err.code === "LIMIT_FILE_SIZE"
        ? "One of the attached files is larger than the 8MB limit."
        : `Upload error: ${err.message}`;
    console.error("Multer error:", err.code, err.message);
    return res.status(400).json({ error: friendly });
  }
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`TribalEarth AI — Module 1 server running on http://localhost:${PORT}`);
});
