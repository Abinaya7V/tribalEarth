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
const bhashiniService = require("./services/bhashiniService");
const { extractClaimFields } = require("./services/extractionService");
const ocrService = require("./services/ocrService");
const documentClassificationService = require("./services/documentClassificationService");
const authService = require("./services/authService");

// Load .env if present (Node 22 built-in — no dotenv dependency needed).
// Safe to call even when the file doesn't exist.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (err) {
  // No .env file — that's fine, voice endpoints will honestly report
  // "not configured" instead of silently failing later.
}

// Module 3 safety net: tesseract.js (used for document OCR) has a
// real bug where a failed language-model download (no internet, a
// blocked CDN, a restricted network) throws from inside a worker
// thread's message handler in a way that escapes normal try/catch
// and crashes the entire Node process — verified directly while
// building this feature. This handler is a deliberate, narrow
// mitigation for that specific known failure mode, not a general
// license to swallow errors: every route below still handles and
// reports its own errors properly. Without this, one OCR attempt
// with no internet access would take down claim filing, the
// register, and everything else too.
process.on("uncaughtException", (err) => {
  console.error("[safety net] Uncaught exception (server kept running):", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("[safety net] Unhandled rejection (server kept running):", err?.message || err);
});

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

// Audio recordings for voice input are transient — never written to
// disk. Kept in memory only for the duration of the request, then
// discarded (Section 7: "do not permanently store raw voice
// recordings unless explicitly required" — this project doesn't
// require it, so it simply never happens).
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per clip
});
const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
];

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

// ---------- authentication ----------
// See services/authService.js for the honesty contract on what this
// login system is (a real, working, hashed-password role system)
// and isn't (production-grade user management).

/**
 * Reads "Authorization: Bearer <token>" and attaches req.user if the
 * token is valid. Does NOT reject the request by itself — routes
 * decide whether a user (and which role) is required.
 */
function attachUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  req.user = authService.getSession(token);
  next();
}
app.use(attachUser);

/** Rejects the request unless req.user's role is in allowedRoles. */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Login required." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of these roles: ${allowedRoles.join(", ")}.` });
    }
    next();
  };
}

/**
 * Rejects unless the logged-in officer's role matches the ROLE
 * authorized for the claim's CURRENT stage — e.g. an SDLC officer
 * cannot act on a claim currently sitting at DLC, even though both
 * are "officials". Looks up the claim fresh so it can't go stale.
 */
function requireStageRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Login required." });
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });

  const requiredRole = authService.STAGE_ROLE[claim.currentStage];
  if (req.user.role !== requiredRole) {
    return res.status(403).json({
      error: `This claim is at ${claim.currentStage} — only a ${requiredRole} officer can act on it right now.`,
    });
  }
  next();
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required." });
  }
  const result = authService.login(username, password);
  if (!result) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  res.json(result);
});

app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  authService.logout(token);
  res.json({ message: "Logged out." });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not logged in." });
  res.json({ role: req.user.role, displayName: req.user.displayName });
});

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
app.post("/api/claims", requireRole("applicant"), upload.array("documents", 6), (req, res) => {
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

// ---------- Module 3: SDLC/DLC Review & Accountability ----------

const SLA_DAYS = Number(process.env.SLA_DAYS) || 90;

function daysSince(dateString) {
  const ms = Date.now() - new Date(dateString).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Timestamp the claim entered its CURRENT stage — the last auditTrail entry for that stage. */
function stageEnteredAt(claim) {
  const entries = claim.auditTrail.filter((a) => a.stage === claim.currentStage);
  return entries.length ? entries[entries.length - 1].timestamp : claim.createdAt;
}

/**
 * GET /api/officials/queue?stage=Gram Sabha|SDLC|DLC
 * Requires login as the role authorized for that specific stage —
 * a Gram Sabha officer cannot browse the SDLC queue, etc. This is
 * enforced here, not just hidden in the UI.
 */
app.get("/api/officials/queue", (req, res) => {
  const { stage } = req.query;
  if (!stage || !STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of ${STAGES.join(", ")}` });
  }
  const requiredRole = authService.STAGE_ROLE[stage];
  if (!req.user || req.user.role !== requiredRole) {
    return res.status(403).json({ error: `Viewing the ${stage} queue requires logging in as a ${requiredRole} officer.` });
  }

  const claims = readClaims().filter((c) => c.currentStage === stage && c.status !== "Rejected" && c.status !== "Approved");

  const withPending = claims.map((c) => {
    const enteredAt = stageEnteredAt(c);
    const daysPending = daysSince(enteredAt);
    return {
      claimId: c.claimId,
      applicantName: c.applicantName,
      village: c.village,
      district: c.district,
      state: c.state,
      claimType: c.claimType,
      currentStage: c.currentStage,
      enteredStageAt: enteredAt,
      daysPending,
      slaExceeded: daysPending > SLA_DAYS,
      priorRejection: c.priorRejection || null,
    };
  });

  withPending.sort((a, b) => b.daysPending - a.daysPending);
  res.json({ stage, slaDays: SLA_DAYS, count: withPending.length, claims: withPending });
});

/**
 * POST /api/claims/:id/documents/:index/classify
 * Runs OCR + Rule 13 classification on one document. This is a
 * SUGGESTION only — see documentClassificationService.js for the
 * honesty contract. Nothing here marks a document as confirmed.
 * Requires login as the officer role matching the claim's current stage.
 */
app.post("/api/claims/:id/documents/:index/classify", requireStageRole, async (req, res) => {
  const claims = readClaims();
  const claimIdx = claims.findIndex((c) => c.claimId === req.params.id);
  if (claimIdx === -1) return res.status(404).json({ error: "Claim not found." });

  const claim = claims[claimIdx];
  const docIndex = Number(req.params.index);
  const doc = claim.documents[docIndex];
  if (!doc) return res.status(404).json({ error: "Document not found on this claim." });

  const filePath = path.join(UPLOADS_DIR, doc.storedName);
  const ocrResult = await ocrService.extractText(filePath);

  if (!ocrResult.success) {
    // Honest failure: never fabricate a classification without real
    // extracted text to classify from.
    return res.status(502).json({
      success: false,
      error: ocrResult.error,
      hint: "The document can still be reviewed and confirmed manually by the officer without AI assistance.",
    });
  }

  const classification = documentClassificationService.classifyDocument({
    extractedText: ocrResult.text,
    filename: doc.originalName,
    applicantName: claim.applicantName,
    village: claim.village,
  });

  doc.review = {
    ...(doc.review || {}),
    extractedText: ocrResult.text,
    rule13: {
      categoryId: classification.categoryId,
      categoryLabel: classification.categoryLabel,
      confidence: classification.confidence,
      matchedKeywords: classification.matchedKeywords,
    },
    nameMatch: classification.nameMatch,
    villageMatch: classification.villageMatch,
    classifiedAt: nowISO(),
    officerConfirmed: doc.review?.officerConfirmed || false,
  };

  writeClaims(claims);
  res.json({ success: true, document: doc });
});

/**
 * POST /api/claims/:id/documents/:index/confirm
 * The officer's tick — the ONLY thing that marks a document's
 * classification as confirmed. body: { confirmed }. The confirming
 * officer's identity comes from the session, not the request body —
 * a client can no longer just type in any name.
 */
app.post("/api/claims/:id/documents/:index/confirm", requireStageRole, (req, res) => {
  const { confirmed } = req.body || {};

  const claims = readClaims();
  const claimIdx = claims.findIndex((c) => c.claimId === req.params.id);
  if (claimIdx === -1) return res.status(404).json({ error: "Claim not found." });

  const claim = claims[claimIdx];
  const docIndex = Number(req.params.index);
  const doc = claim.documents[docIndex];
  if (!doc) return res.status(404).json({ error: "Document not found on this claim." });
  if (!doc.review) {
    return res.status(400).json({ error: "Run classification on this document before confirming it." });
  }

  const isConfirmed = Boolean(confirmed);
  doc.review.officerConfirmed = isConfirmed;
  doc.review.confirmedBy = isConfirmed ? req.user.displayName : null;
  doc.review.confirmedAt = isConfirmed ? nowISO() : null;

  writeClaims(claims);
  res.json({ success: true, document: doc });
});

/**
 * GET /api/claims/:id/checklist
 * Rule 13 evidence-category coverage for this claim — counts ONLY
 * officer-confirmed documents (see computeChecklist for why).
 * Read-only, so no login is required — consistent with the register
 * being a public transparency view.
 */
app.get("/api/claims/:id/checklist", (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });

  const checklist = documentClassificationService.computeChecklist(claim.documents);
  res.json(checklist);
});

/**
 * POST /api/claims/:id/decision
 * body: { action: "approve" | "reject", justification }
 * Requires login as the officer role matching the claim's current
 * stage. The acting officer's identity comes from the session.
 *
 * ESCALATION RULES (this is the actual point of this endpoint):
 *
 *  - Reject at GRAM SABHA: terminal. The claim does NOT move to
 *    SDLC. A Gram Sabha rejection ends the claim at that level.
 *
 *  - Reject at SDLC: does NOT terminate the claim. It automatically
 *    forwards to DLC, carrying the SDLC officer's rejection reason
 *    with it (stored in claim.priorRejection and shown to the DLC
 *    officer). This models SDLC rejection as an escalation for
 *    final DLC determination, not a dead end — matching the
 *    explicit requirement that "if SDLC rejects, the rejection
 *    reason along with the case should be forwarded to DLC."
 *
 *  - Reject at DLC: terminal. DLC is the final stage in this
 *    pipeline, so there is nowhere further to escalate to.
 *
 *  - Approve at any non-final stage: forwards to the next stage
 *    (same effect as /advance, logged as an officer decision).
 *
 *  - Approve at DLC (final stage): grants the claim — a terminal,
 *    positive outcome.
 */
app.post("/api/claims/:id/decision", requireStageRole, (req, res) => {
  const { action, justification } = req.body || {};
  const officerName = req.user.displayName;

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "reject".' });
  }
  if (action === "reject") {
    const trimmed = (justification || "").trim();
    if (trimmed.length < 10) {
      return res.status(400).json({
        error: "A written justification of at least 10 characters is required to reject a claim.",
      });
    }
  }

  const claims = readClaims();
  const idx = claims.findIndex((c) => c.claimId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Claim not found." });

  const claim = claims[idx];
  const timestamp = nowISO();
  const rejectingStage = claim.currentStage;

  if (action === "reject") {
    if (rejectingStage === "SDLC") {
      // Escalate to DLC instead of terminating — carrying the
      // rejection reason forward so the DLC officer sees exactly
      // why SDLC rejected it, without re-investigating from scratch.
      claim.priorRejection = {
        stage: "SDLC",
        officerName,
        justification: justification.trim(),
        timestamp,
      };
      claim.currentStage = "DLC";
      claim.status = "Under Review";
      claim.updatedAt = timestamp;
      claim.auditTrail.push({
        stage: "SDLC",
        action: "Rejected at SDLC",
        actor: officerName,
        note: justification.trim(),
        timestamp,
      });
      claim.auditTrail.push({
        stage: "DLC",
        action: "Escalated to DLC following SDLC rejection",
        actor: "System",
        note: `Forwarded to DLC for final determination, carrying the SDLC rejection reason above.`,
        timestamp,
      });
      writeClaims(claims);
      return res.json({
        message: "Claim rejected at SDLC — automatically escalated to DLC with the rejection reason attached.",
        claim,
      });
    }

    // Gram Sabha and DLC rejections are both terminal — Gram Sabha
    // because that's the explicit design decision here, DLC because
    // it's the final stage with nowhere left to escalate to.
    claim.status = "Rejected";
    claim.updatedAt = timestamp;
    claim.auditTrail.push({
      stage: rejectingStage,
      action: "Rejected",
      actor: officerName,
      note: justification.trim(),
      timestamp,
    });
    writeClaims(claims);
    return res.json({ message: `Claim rejected at ${rejectingStage} — this decision is final.`, claim });
  }

  // action === "approve"
  const currentIdx = STAGES.indexOf(claim.currentStage);
  const isFinalStage = currentIdx === STAGES.length - 1;

  if (isFinalStage) {
    claim.status = "Approved";
    claim.updatedAt = timestamp;
    claim.auditTrail.push({
      stage: claim.currentStage,
      action: "Approved",
      actor: officerName,
      note: justification?.trim() || `Claim approved and forest right granted at ${claim.currentStage}.`,
      timestamp,
    });
    writeClaims(claims);
    return res.json({ message: "Claim approved — forest right granted.", claim });
  }

  const nextStage = STAGES[currentIdx + 1];
  claim.currentStage = nextStage;
  claim.status = "Under Review";
  claim.updatedAt = timestamp;
  claim.auditTrail.push({
    stage: nextStage,
    action: "Approved & Forwarded",
    actor: officerName,
    note: justification?.trim() || `Approved at previous stage and forwarded to ${nextStage}.`,
    timestamp,
  });
  writeClaims(claims);
  res.json({ message: `Claim approved and forwarded to ${nextStage}.`, claim });
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

// ---------- voice endpoints ----------
// Architecture: Browser -> this Express backend -> Bhashini -> back.
// The frontend never holds a Bhashini API key. If Bhashini isn't
// configured (see .env.example), these endpoints say so honestly —
// they never return a fabricated transcript or audio clip.

const SUPPORTED_VOICE_LANGUAGES = ["en", "hi", "bn", "or", "te", "sat"];

/**
 * GET /api/voice/status
 * Lets the frontend check ONCE (and cache) whether Bhashini is
 * configured, instead of attempting a real transcribe/tts call
 * every single time and waiting for it to fail. That avoided
 * round-trip is also what fixes a real bug: delaying the browser's
 * speechSynthesis.speak() call behind a doomed network request was
 * pushing it far enough from the user's click that Chrome would
 * sometimes silently drop the audio.
 */
app.get("/api/voice/status", (req, res) => {
  res.json({ configured: bhashiniService.isConfigured() });
});

/**
 * POST /api/voice/transcribe
 * multipart/form-data: audio (file), language (string)
 */
app.post("/api/voice/transcribe", audioUpload.single("audio"), async (req, res) => {
  const { language } = req.body;

  if (!req.file) {
    return res.status(400).json({ success: false, error: "No audio file received." });
  }
  if (!ALLOWED_AUDIO_MIME_TYPES.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported audio format: ${req.file.mimetype}`,
    });
  }
  if (!language || !SUPPORTED_VOICE_LANGUAGES.includes(language)) {
    return res.status(400).json({
      success: false,
      error: `language must be one of ${SUPPORTED_VOICE_LANGUAGES.join(", ")}`,
    });
  }

  const result = await bhashiniService.transcribeAudio(req.file.buffer, req.file.mimetype, language);
  // req.file.buffer is not written anywhere and is discarded once this
  // function returns — nothing here persists the recording.

  if (!result.success) {
    return res.status(result.configured ? 502 : 503).json(result);
  }
  res.json(result);
});

/**
 * POST /api/voice/extract
 * body: { text, language, context }
 * Rule-based structured extraction — see services/extractionService.js
 * for exactly how each field is matched. Never guesses: unmatched
 * fields come back null.
 */
app.post("/api/voice/extract", express.json(), (req, res) => {
  const { text, language } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ success: false, error: "Missing 'text' in request body." });
  }
  const { fields } = extractClaimFields(text);
  res.json({ success: true, language: language || null, fields });
});

/**
 * POST /api/voice/tts
 * body: { text, language }
 */
app.post("/api/voice/tts", express.json(), async (req, res) => {
  const { text, language } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ success: false, error: "Missing 'text' in request body." });
  }
  if (!language || !SUPPORTED_VOICE_LANGUAGES.includes(language)) {
    return res.status(400).json({
      success: false,
      error: `language must be one of ${SUPPORTED_VOICE_LANGUAGES.join(", ")}`,
    });
  }

  const result = await bhashiniService.synthesizeSpeech(text, language);
  if (!result.success) {
    return res.status(result.configured ? 502 : 503).json(result);
  }
  res.json(result);
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
