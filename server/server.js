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
const geoService = require("./services/geoService");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

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
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// ---------- bootstrap storage ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const { readClaims, writeClaims, getDb } = require("./services/db");
const conflictService = require("./services/conflictService");
const { seedDemo } = require("../scripts/seed-atlas-demo");

// ---------- optional demo seeding for hosted demos ----------
function checkAndSeedDemo() {
  if (process.env.SEED_DEMO === "true") {
    try {
      const db = getDb();
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM claims;").get();
      if (!countRow || countRow.count === 0) {
        seedDemo(DATA_DIR, { force: false, allowRealData: true });
        // Import seeded claims into SQLite claims table
        const claimsJsonPath = path.join(DATA_DIR, "claims.json");
        if (fs.existsSync(claimsJsonPath)) {
          const raw = fs.readFileSync(claimsJsonPath, "utf-8");
          const seeded = JSON.parse(raw);
          writeClaims(seeded);
          const migratedPath = claimsJsonPath + ".migrated";
          fs.renameSync(claimsJsonPath, migratedPath);
        }
        console.log(`[seed-demo] Seeded demo claims into ${DATA_DIR} (SEED_DEMO=true on empty database)`);
      }
    } catch (err) {
      console.error("[seed-demo] Demo seeding failed:", err.message);
    }
  }
}
checkAndSeedDemo();

// A1. Claim ownership migration
function migrateLegacyClaims() {
  const claims = readClaims();
  let changed = false;
  claims.forEach(c => {
    if (c.ownerId === undefined) {
      c.ownerId = null;
      c.legacy = true;
      changed = true;
    }
  });
  if (changed) writeClaims(claims);
}
migrateLegacyClaims();

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
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
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
app.use(express.static(path.join(__dirname, "public")));

// ---------- health check ----------
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

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

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Login required." });
  }
  next();
}

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

function stripClaimForApplicant(claim, user) {
  if (user.role !== "applicant") return claim;
  const stripped = { ...claim };
  if (stripped.documents) {
    stripped.documents = stripped.documents.map(d => {
      const dStripped = { ...d };
      delete dStripped.review;
      return dStripped;
    });
  }
  if (stripped.auditTrail) {
    stripped.auditTrail = stripped.auditTrail.map(a => {
      const roleStr = a.stage; 
      return { ...a, actor: (a.actor === "Applicant / FRC" || a.actor === "System" || a.actor === "Applicant") ? a.actor : `${roleStr} Officer` };
    });
  }
  if (stripped.priorRejection) {
    stripped.priorRejection = { ...stripped.priorRejection, officerName: `${stripped.priorRejection.stage} Officer` };
  }
  const hasOpenConflict = Array.isArray(stripped.conflicts) && stripped.conflicts.some(c => c.status === "open");
  delete stripped.conflicts;
  stripped.conflictNotice = Boolean(hasOpenConflict);
  return stripped;
}

function enrichConflictsForOfficer(conflicts, allClaims, user) {
  if (!Array.isArray(conflicts)) return [];
  return conflicts.map(c => {
    const other = allClaims.find(o => o.claimId === c.otherClaimId);
    const canReadOther = other ? canReadClaim(other, user) : false;
    return {
      ...c,
      otherClaimStage: other ? other.currentStage : null,
      otherApplicantName: canReadOther ? other.applicantName : null,
      otherVillage: canReadOther ? other.village : null
    };
  });
}

function canReadClaim(claim, user) {
  if (user.role === "applicant") {
    return claim.ownerId === user.username && !claim.legacy;
  }
  const allowedStage = Object.keys(authService.STAGE_ROLE).find(key => authService.STAGE_ROLE[key] === user.role);
  if (!allowedStage) return false;
  if (claim.legacy) {
    return claim.currentStage === allowedStage;
  }
  if (claim.currentStage === allowedStage) return true;
  return false;
}

/**
 * Atlas permission check:
 * - User must be an officer (gram_sabha, sdlc, dlc)
 * - Claim must have coordinates/geometry (legacy without coords cannot be mapped)
 * - Jurisdiction match: if officer has state or district set, claim must match
 */
function canViewInAtlas(claim, user) {
  if (!user || !["gram_sabha", "sdlc", "dlc"].includes(user.role)) {
    return false;
  }
  if (!claim) return false;
  const hasCoords = Boolean(
    (claim.location && claim.location.latitude != null && claim.location.longitude != null) ||
    claim.geometry
  );
  if (!hasCoords) return false;

  const jur = user.jurisdiction;
  if (jur) {
    if (jur.state && jur.state.trim()) {
      if (!claim.state || claim.state.trim().toLowerCase() !== jur.state.trim().toLowerCase()) {
        return false;
      }
    }
    if (jur.district && jur.district.trim()) {
      if (!claim.district || claim.district.trim().toLowerCase() !== jur.district.trim().toLowerCase()) {
        return false;
      }
    }
  }
  return true;
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login attempts, please try again later." }
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
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
    occupationSinceYear,
    latitude,
    longitude,
    language,
    bilingualData,
  } = req.body;

  const cleanupFiles = () => {
    if (req.files && Array.isArray(req.files)) {
      for (const f of req.files) {
        try {
          fs.unlinkSync(f.path);
        } catch (_) {}
      }
    }
  };

  let parsedOccYear = null;
  if (occupationSinceYear !== undefined && occupationSinceYear !== null && String(occupationSinceYear).trim() !== "") {
    const yNum = Number(occupationSinceYear);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(yNum) || yNum < 1900 || yNum > currentYear) {
      cleanupFiles();
      return res.status(400).json({
        error: `occupationSinceYear must be an integer between 1900 and ${currentYear}.`,
      });
    }
    parsedOccYear = yNum;
  }

  if (!applicantName || !village || !district || !state || !claimType) {
    cleanupFiles();
    return res.status(400).json({
      error:
        "Missing required fields: applicantName, village, district, state, claimType.",
    });
  }
  if (!VALID_CLAIM_TYPES.includes(claimType)) {
    cleanupFiles();
    return res.status(400).json({
      error: `claimType must be one of ${VALID_CLAIM_TYPES.join(", ")}`,
    });
  }

  // Location is mandatory: require coordinates or geometry
  const hasPin =
    latitude !== undefined &&
    latitude !== "" &&
    longitude !== undefined &&
    longitude !== "";
  const hasGeom = Boolean(req.body.geometry && req.body.geometry.trim());

  if (!hasPin && !hasGeom) {
    cleanupFiles();
    return res.status(400).json({
      error: "Location is mandatory: please provide coordinates or draw a boundary.",
    });
  }

  let parsedGeometry = null;
  if (hasGeom) {
    try {
      parsedGeometry = JSON.parse(req.body.geometry);
    } catch (e) {
      cleanupFiles();
      return res.status(400).json({ error: "Invalid geometry JSON format." });
    }
    const geomValidation = geoService.validatePolygon(parsedGeometry);
    if (!geomValidation.valid) {
      cleanupFiles();
      return res.status(400).json({ error: geomValidation.error });
    }
  }

  let location = null;
  if (hasPin) {
    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (
      isNaN(latNum) ||
      isNaN(lngNum) ||
      !geoService.isPointInIndia(latNum, lngNum)
    ) {
      cleanupFiles();
      return res.status(400).json({ error: "Coordinates must be inside India." });
    }
    location = { lat: latNum, lng: lngNum };
  }

  const computedAreaHa = parsedGeometry
    ? geoService.computeAreaHa(parsedGeometry)
    : null;

  const claims = readClaims();
  const claimId = generateClaimId(stateCode);
  const timestamp = nowISO();

  const documents = (req.files || []).map((f) => {
    let sha256 = null;
    try {
      const buf = fs.readFileSync(f.path);
      sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    } catch (_) {}

    return {
      originalName: f.originalname,
      storedName: f.filename,
      url: `/api/claims/${claimId}/documents/${f.filename}`,
      sizeBytes: f.size,
      sha256,
    };
  });

  let parsedBilingual = null;
  if (bilingualData) {
    try {
      parsedBilingual = JSON.parse(bilingualData);
    } catch (_) {}
  }

  const claim = {
    claimId,
    ownerId: req.user.username,
    legacy: false,
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
    occupationSinceYear: parsedOccYear,
    location,
    geometry: parsedGeometry,
    locationSource: req.body.locationSource || null,
    accuracyMeters: req.body.accuracyMeters
      ? parseFloat(req.body.accuracyMeters)
      : null,
    computedAreaHa,
    language: language || "en",
    bilingualData: parsedBilingual,
    documents,
    currentStage: "Gram Sabha",
    status: "Submitted",
    createdAt: timestamp,
    updatedAt: timestamp,
    conflicts: [],
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

  // Run conflict detection across all claims
  conflictService.detectConflicts(claim, claims);

  writeClaims(claims);

  res.status(201).json({
    message: "Claim submitted successfully.",
    claim: stripClaimForApplicant(claim, req.user),
  });
});

/**
 * GET /api/claims
 * Lists claims. Optional query filters: village, district, state, claimType, stage, status
 */
app.get("/api/claims", requireAuth, (req, res) => {
  let claims = readClaims();
  claims = claims.filter(c => canReadClaim(c, req.user));
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
  res.json({ count: claims.length, claims: claims.map(c => stripClaimForApplicant(c, req.user)) });
});

/**
 * GET /api/claims/:id/geo
 * Returns geometry, location flags, and anonymized nearby claims for the map view.
 */
app.get("/api/claims/:id/geo", requireAuth, (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim || !canReadClaim(claim, req.user)) {
    return res.status(404).json({ error: "Claim not found." });
  }

  let flags = geoService.computeFlags(claim, claims);
  if (req.user.role === "applicant") {
    flags = flags.filter((f) => f.code !== "OVERLAPS_OTHER_CLAIM");
  }

  // Active/open conflicts on this claim for officer map display
  const conflictingClaimIds = new Set(
    (claim.conflicts || [])
      .filter((c) => c.status !== "moot")
      .map((c) => c.otherClaimId)
  );

  // Nearby claims (anonymous dots if they can't be read by this user)
  const nearby = [];
  if (claim.geometry || claim.location) {
    for (const other of claims) {
      if (other.claimId === claim.claimId) continue;
      if (!other.geometry && !other.location) continue;

      const canReadOther = canReadClaim(other, req.user);
      const isConflicting = conflictingClaimIds.has(other.claimId);
      const item = {
        claimId: canReadOther ? other.claimId : "anonymous",
        claimType: canReadOther ? other.claimType : "Unknown",
        location: other.location,
        geometry: other.geometry,
        anonymized: !canReadOther,
      };
      if (req.user.role !== "applicant" && isConflicting) {
        item.conflict = true;
      }
      nearby.push(item);
    }
  }

  res.json({
    location: claim.location,
    geometry: claim.geometry,
    locationSource: claim.locationSource,
    accuracyMeters: claim.accuracyMeters,
    computedAreaHa: claim.computedAreaHa,
    flags,
    nearby,
  });
});

app.patch("/api/my/claims/:id/location", requireRole("applicant"), (req, res) => {
  const { latitude, longitude, geometry, locationSource, accuracyMeters } = req.body;
  const claims = readClaims();
  const idx = claims.findIndex((c) => c.claimId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Claim not found." });

  const claim = claims[idx];
  if (claim.ownerId !== req.user.username || claim.legacy) {
    return res.status(404).json({ error: "Claim not found." });
  }

  // Must be still editable (e.g. submitted or rejected but appealing)
  if (claim.currentStage !== "Gram Sabha" && claim.status !== "Appealed") {
    return res.status(400).json({ error: "Location can no longer be edited at this stage." });
  }

  if (latitude !== undefined && longitude !== undefined) {
    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (!geoService.isPointInIndia(latNum, lngNum)) {
      return res.status(400).json({ error: "Coordinates must be inside India." });
    }
    claim.location = { lat: latNum, lng: lngNum };
  }

  if (geometry) {
    let geomObj = geometry;
    if (typeof geometry === "string") {
      try {
        geomObj = JSON.parse(geometry);
      } catch (e) {
        return res.status(400).json({ error: "Invalid geometry JSON format." });
      }
    }
    const val = geoService.validatePolygon(geomObj);
    if (!val.valid) return res.status(400).json({ error: val.error });
    claim.geometry = geomObj;
    claim.computedAreaHa = geoService.computeAreaHa(geomObj);
  }

  if (locationSource) claim.locationSource = locationSource;
  if (accuracyMeters) claim.accuracyMeters = parseFloat(accuracyMeters);

  claim.updatedAt = nowISO();
  claim.auditTrail.push({
    stage: claim.currentStage,
    action: "Location Updated",
    actor: "Applicant",
    note: "Location or boundary was updated.",
    timestamp: claim.updatedAt,
  });

  // Re-run conflict detection
  conflictService.detectConflicts(claim, claims);

  writeClaims(claims);
  res.json({ message: "Location updated successfully.", claim: stripClaimForApplicant(claim, req.user) });
});

/**
 * GET /api/claims/:id
 */
app.get("/api/claims/:id", requireAuth, (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  if (!canReadClaim(claim, req.user)) return res.status(404).json({ error: "Claim not found." });

  if (req.user.role === "applicant") {
    return res.json({ claim: stripClaimForApplicant(claim, req.user) });
  }

  const enrichedClaim = {
    ...claim,
    conflicts: enrichConflictsForOfficer(claim.conflicts, claims, req.user),
  };
  res.json({ claim: enrichedClaim });
});

/**
 * GET /api/claims/:id/conflicts
 * Returns enriched conflicts for officers.
 */
app.get("/api/claims/:id/conflicts", requireAuth, (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim || !canReadClaim(claim, req.user)) {
    return res.status(404).json({ error: "Claim not found." });
  }

  if (req.user.role === "applicant") {
    return res.status(403).json({ error: "Access denied." });
  }

  const enriched = enrichConflictsForOfficer(claim.conflicts, claims, req.user);
  res.json({ conflicts: enriched });
});

app.get("/api/my/claims", requireRole("applicant"), (req, res) => {
  let claims = readClaims().filter(c => c.ownerId === req.user.username && !c.legacy);
  
  const summaries = claims.map(c => {
    let canAppeal = false;
    let appealDeadline = null;
    if (c.status === "Rejected" && c.rejection?.rejectedAtStage === "Gram Sabha" && !c.appeal) {
      const deadline = new Date(new Date(c.rejection.timestamp).getTime() + 60 * 24 * 60 * 60 * 1000);
      if (deadline > new Date()) {
        canAppeal = true;
        appealDeadline = deadline.toISOString();
      }
    }
    return {
      id: c.claimId,
      village: c.village,
      claimType: c.claimType,
      status: c.status,
      stage: c.currentStage,
      updatedAt: c.updatedAt,
      isRejected: c.status === "Rejected",
      canAppeal,
      appealDeadline
    };
  });
  summaries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ claims: summaries });
});

app.get("/api/my/claims/:id", requireRole("applicant"), (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim || claim.ownerId !== req.user.username || claim.legacy) {
    return res.status(404).json({ error: "Claim not found." });
  }

  let canAppeal = false;
  let appealDeadline = null;
  if (claim.status === "Rejected" && claim.rejection?.rejectedAtStage === "Gram Sabha" && !claim.appeal) {
    const deadline = new Date(new Date(claim.rejection.timestamp).getTime() + 60 * 24 * 60 * 60 * 1000);
    if (deadline > new Date()) {
      canAppeal = true;
      appealDeadline = deadline.toISOString();
    }
  }

  const stripped = stripClaimForApplicant(claim, req.user);
  res.json({ claim: stripped, canAppeal, appealDeadline });
});

app.post("/api/my/claims/:id/appeal", requireRole("applicant"), (req, res) => {
  const { grounds } = req.body;
  if (!grounds || !grounds.trim()) {
    return res.status(400).json({ error: "Appeal grounds are required." });
  }

  const claims = readClaims();
  const idx = claims.findIndex((c) => c.claimId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Claim not found." });
  const claim = claims[idx];

  if (claim.ownerId !== req.user.username || claim.legacy) {
    return res.status(404).json({ error: "Claim not found." });
  }
  if (claim.appeal) {
    return res.status(400).json({ error: "Appeal already filed." });
  }
  if (claim.status !== "Rejected" || claim.rejection?.rejectedAtStage !== "Gram Sabha") {
    return res.status(400).json({ error: "Only claims rejected by Gram Sabha can be appealed to SDLC." });
  }

  const deadline = new Date(new Date(claim.rejection.timestamp).getTime() + 60 * 24 * 60 * 60 * 1000);
  if (deadline < new Date()) {
    return res.status(400).json({ error: "Appeal deadline (60 days) has passed." });
  }

  const timestamp = nowISO();
  claim.appeal = {
    grounds: grounds.trim(),
    filedAt: timestamp,
    deadline: deadline.toISOString(),
    status: "filed"
  };
  
  claim.priorRejection = {
    stage: claim.rejection.rejectedAtStage,
    officerName: claim.rejection.rejectedByRole,
    justification: claim.rejection.reason,
    timestamp: claim.rejection.timestamp
  };
  
  claim.status = "Appealed";
  claim.currentStage = "SDLC";
  claim.updatedAt = timestamp;
  
  claim.auditTrail.push({
    stage: "SDLC",
    action: "Appealed",
    actor: "Applicant",
    note: `Appealed Gram Sabha rejection. Grounds: ${grounds.trim()}`,
    timestamp
  });

  // Re-run conflict detection since claim is revived
  conflictService.detectConflicts(claim, claims);

  writeClaims(claims);
  res.json({ message: "Appeal filed successfully.", claim: stripClaimForApplicant(claim, req.user) });
});

function logAtlasAccess(user, claimId, action) {
  try {
    const effectiveDataDir = process.env.DATA_DIR || DATA_DIR;
    const logPath = path.join(effectiveDataDir, "atlas-access.log");
    const entry = JSON.stringify({
      ts: nowISO(),
      user: user.username,
      role: user.role,
      claimId,
      action,
    }) + "\n";
    fs.appendFileSync(logPath, entry, "utf8");
  } catch (err) {
    console.error("[atlas-access-log] Failed to write log:", err);
  }
}

app.get("/api/claims/:id/documents/:docId", requireAuth, (req, res) => {
  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) {
    return res.status(404).json({ error: "Claim not found." });
  }

  const hasStandardAccess = canReadClaim(claim, req.user);
  const hasAtlasAccess = !hasStandardAccess && canViewInAtlas(claim, req.user);

  if (!hasStandardAccess && !hasAtlasAccess) {
    return res.status(404).json({ error: "Claim not found." });
  }

  if (hasAtlasAccess) {
    logAtlasAccess(req.user, claim.claimId, "download_document");
  }

  const doc = claim.documents.find(d => d.storedName === req.params.docId);
  if (!doc) return res.status(404).json({ error: "Document not found." });

  const filePath = path.join(UPLOADS_DIR, doc.storedName);
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(UPLOADS_DIR)) {
    return res.status(403).json({ error: "Invalid path." });
  }

  if (!fs.existsSync(normalizedPath)) {
    return res.status(404).json({ error: "File missing." });
  }

  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.originalName)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(normalizedPath);
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
      conflictCount: conflictService.countOpenCompetingConflicts(c),
      hasDuplicateProof: Boolean(
        c.conflicts &&
          c.conflicts.some(
            (conf) => conf.reasons && conf.reasons.includes("DUPLICATE_PROOF")
          )
      ),
      notCheckable: !c.geometry && !c.location,
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

  // Re-read claims fresh after the OCR await (which can take up to 20s) so any
  // decisions made on this claim or other claims during the wait are not overwritten.
  const freshClaims = readClaims();
  const freshClaim = freshClaims.find((c) => c.claimId === req.params.id);
  if (!freshClaim) return res.status(404).json({ error: "Claim not found." });
  const freshDoc = freshClaim.documents?.[docIndex];
  if (!freshDoc) return res.status(404).json({ error: "Document not found on this claim." });

  freshDoc.review = {
    ...(freshDoc.review || {}),
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
    officerConfirmed: freshDoc.review?.officerConfirmed || false,
  };

  writeClaims(freshClaims);
  res.json({ success: true, document: freshDoc });
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
 * POST /api/claims/:id/map-check
 * Officer ticks "Location checked on map"
 */
app.post("/api/claims/:id/map-check", requireStageRole, (req, res) => {
  const { observation, locationChecked } = req.body || {};
  
  const claims = readClaims();
  const claimIdx = claims.findIndex((c) => c.claimId === req.params.id);
  if (claimIdx === -1) return res.status(404).json({ error: "Claim not found." });
  
  const claim = claims[claimIdx];
  const isChecked = Boolean(locationChecked);
  
  claim.mapCheck = {
    officerConfirmed: isChecked,
    confirmedBy: isChecked ? req.user.displayName : null,
    confirmedAt: isChecked ? nowISO() : null,
    observation: observation ? String(observation).trim() : ""
  };
  
  if (observation && observation.trim()) {
    claim.auditTrail.push({
      stage: claim.currentStage,
      action: "Map Observation Added",
      actor: req.user.displayName,
      note: String(observation).trim(),
      timestamp: nowISO()
    });
  }
  
  writeClaims(claims);
  res.json({ success: true, mapCheck: claim.mapCheck });
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

  // Refuse any action on a claim whose status is Rejected or Approved
  if (claim.status === "Rejected" || claim.status === "Approved") {
    return res.status(409).json({
      error: `Cannot make a decision on a claim that is already ${claim.status}.`,
    });
  }

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
      claim.rejection = {
        reason: justification.trim(),
        rejectedAtStage: "SDLC",
        rejectedByRole: req.user.role,
        timestamp
      };
      claim.currentStage = "DLC";
      claim.status = "Escalated to DLC";
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
    claim.rejection = {
      reason: justification.trim(),
      rejectedAtStage: rejectingStage,
      rejectedByRole: req.user.role,
      timestamp
    };
    claim.updatedAt = timestamp;
    claim.auditTrail.push({
      stage: rejectingStage,
      action: "Rejected",
      actor: officerName,
      note: justification.trim(),
      timestamp,
    });

    // Terminal rejection: mark counterpart conflict entries "moot"
    conflictService.mootConflictsForClaim(claim, claims);

    writeClaims(claims);
    return res.json({ message: `Claim rejected at ${rejectingStage} — this decision is final.`, claim });
  }

  // action === "approve"
  // Block approval if any open competing conflict exists
  if (conflictService.hasOpenCompetingConflicts(claim)) {
    const count = conflictService.countOpenCompetingConflicts(claim);
    return res.status(409).json({
      error: "Cannot approve claim: open competing claim conflicts must be resolved first.",
      code: "CONFLICT_UNRESOLVED",
      count,
    });
  }

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
 * POST /api/claims/:id/conflicts/:conflictId/resolve
 * Resolves an open conflict on a claim. Guarded by requireStageRole.
 * body: { finding, reason }
 */
app.post("/api/claims/:id/conflicts/:conflictId/resolve", requireStageRole, (req, res) => {
  const { finding, reason } = req.body || {};
  const validFindings = [
    "boundaries_do_not_conflict",
    "shared_use_accepted",
    "this_claim_has_stronger_evidence",
  ];

  if (!finding || !validFindings.includes(finding)) {
    return res.status(400).json({
      error: `finding must be one of: ${validFindings.join(", ")}`,
    });
  }

  const trimmedReason = (reason || "").trim();
  if (trimmedReason.length < 10) {
    return res.status(400).json({
      error: "A written reason of at least 10 characters is required to resolve a conflict.",
    });
  }

  const claims = readClaims();
  const claim = claims.find((c) => c.claimId === req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });

  if (!Array.isArray(claim.conflicts)) {
    claim.conflicts = [];
  }

  const conflict = claim.conflicts.find((c) => c.conflictId === req.params.conflictId);
  if (!conflict) {
    return res.status(404).json({ error: "Conflict not found on this claim." });
  }

  const timestamp = nowISO();
  conflict.status = "resolved";
  conflict.resolution = {
    finding,
    reason: trimmedReason,
    resolvedBy: req.user.displayName,
    resolvedAt: timestamp,
    stage: claim.currentStage,
  };

  claim.updatedAt = timestamp;
  if (!Array.isArray(claim.auditTrail)) claim.auditTrail = [];
  claim.auditTrail.push({
    stage: claim.currentStage,
    action: "Conflict resolved",
    actor: req.user.displayName,
    note: `Resolved conflict with ${conflict.otherClaimId}: ${finding}. Reason: ${trimmedReason}`,
    timestamp,
  });

  writeClaims(claims);

  const enrichedConflicts = enrichConflictsForOfficer(claim.conflicts, claims, req.user);
  res.json({
    success: true,
    message: "Conflict resolved successfully.",
    conflicts: enrichedConflicts,
  });
});

/**
 * GET /api/stats
 * Lightweight aggregate counts — feeds a future Module 5 dashboard.
 */
app.get("/api/stats", requireAuth, (req, res) => {
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

// ==========================================
// Phase 2: Atlas API (Read-only for Officers)
// ==========================================

function getClaimGrantedAt(claim) {
  if (claim.status !== "Approved" || !Array.isArray(claim.auditTrail)) return null;
  const approvedEntry = [...claim.auditTrail].reverse().find(a => a.action === "Approved");
  return approvedEntry ? approvedEntry.timestamp : null;
}

function computeFeatureBbox(geom, loc) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const update = (lng, lat) => {
    if (typeof lng === "number" && typeof lat === "number" && !isNaN(lng) && !isNaN(lat)) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geom && geom.coordinates) {
    const coords = geom.coordinates;
    if (geom.type === "Polygon") {
      for (const ring of coords) {
        if (Array.isArray(ring)) {
          for (const pt of ring) {
            if (Array.isArray(pt) && pt.length >= 2) update(pt[0], pt[1]);
          }
        }
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of coords) {
        if (Array.isArray(poly)) {
          for (const ring of poly) {
            if (Array.isArray(ring)) {
              for (const pt of ring) {
                if (Array.isArray(pt) && pt.length >= 2) update(pt[0], pt[1]);
              }
            }
          }
        }
      }
    } else if (geom.type === "Point") {
      if (Array.isArray(coords) && coords.length >= 2) update(coords[0], coords[1]);
    }
  } else if (loc && typeof loc.lng === "number" && typeof loc.lat === "number") {
    update(loc.lng, loc.lat);
  }

  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function bboxesIntersect(b1, b2) {
  return !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);
}

/**
 * GET /api/atlas/summary
 * Returns aggregated stats and village bounding boxes for viewable mapped claims.
 */
app.get("/api/atlas/summary", requireAuth, (req, res) => {
  if (!["gram_sabha", "sdlc", "dlc"].includes(req.user.role)) {
    return res.status(403).json({ error: "Atlas requires an officer role." });
  }

  const allClaims = readClaims();
  let notMapped = 0;
  const viewableMapped = [];

  const jur = req.user.jurisdiction;
  for (const c of allClaims) {
    if (jur) {
      if (jur.state && jur.state.trim()) {
        if (!c.state || c.state.trim().toLowerCase() !== jur.state.trim().toLowerCase()) continue;
      }
      if (jur.district && jur.district.trim()) {
        if (!c.district || c.district.trim().toLowerCase() !== jur.district.trim().toLowerCase()) continue;
      }
    }

    const hasCoords = Boolean(
      (c.location && c.location.latitude != null && c.location.longitude != null) ||
      (c.location && c.location.lat != null && c.location.lng != null) ||
      c.geometry
    );

    if (!hasCoords) {
      notMapped++;
    } else {
      viewableMapped.push(c);
    }
  }

  const byStatus = {};
  const byClaimType = {};
  let totalAreaHa = 0;
  let approvedAreaHa = 0;
  const villageMap = new Map(); // key: state|district|village

  for (const c of viewableMapped) {
    const status = c.status || "Submitted";
    byStatus[status] = (byStatus[status] || 0) + 1;

    const type = c.claimType || "IFR";
    byClaimType[type] = (byClaimType[type] || 0) + 1;

    const area = Number(c.computedAreaHa) || 0;
    totalAreaHa += area;
    if (status === "Approved") {
      approvedAreaHa += area;
    }

    const vKey = `${c.state || ""}|||${c.district || ""}|||${c.village || ""}`;
    if (!villageMap.has(vKey)) {
      villageMap.set(vKey, {
        state: c.state || "",
        district: c.district || "",
        village: c.village || "",
        count: 0,
        bbox: null,
      });
    }
    const vObj = villageMap.get(vKey);
    vObj.count++;
    const cBbox = computeFeatureBbox(c.geometry, c.location);
    if (cBbox) {
      if (!vObj.bbox) {
        vObj.bbox = [...cBbox];
      } else {
        if (cBbox[0] < vObj.bbox[0]) vObj.bbox[0] = cBbox[0];
        if (cBbox[1] < vObj.bbox[1]) vObj.bbox[1] = cBbox[1];
        if (cBbox[2] > vObj.bbox[2]) vObj.bbox[2] = cBbox[2];
        if (cBbox[3] > vObj.bbox[3]) vObj.bbox[3] = cBbox[3];
      }
    }
  }

  const villages = Array.from(villageMap.values()).map(v => ({
    state: v.state,
    district: v.district,
    village: v.village,
    count: v.count,
    bbox: v.bbox || [0, 0, 0, 0],
  }));

  villages.sort((a, b) => b.count - a.count);

  res.json({
    totalMapped: viewableMapped.length,
    notMapped,
    byStatus,
    byClaimType,
    totalAreaHa: Number(totalAreaHa.toFixed(2)),
    approvedAreaHa: Number(approvedAreaHa.toFixed(2)),
    villages,
  });
});

/**
 * GET /api/atlas/features
 * GeoJSON FeatureCollection query with viewport bbox and filters.
 */
app.get("/api/atlas/features", requireAuth, (req, res) => {
  if (!["gram_sabha", "sdlc", "dlc"].includes(req.user.role)) {
    return res.status(403).json({ error: "Atlas requires an officer role." });
  }

  const {
    bbox,
    state,
    district,
    village,
    status,
    claimType,
    conflict,
    limit: queryLimit,
  } = req.query;

  let filterBbox = null;
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some(n => isNaN(n) || !isFinite(n))) {
      return res.status(400).json({ error: "bbox must be 4 comma-separated finite numbers: minLng,minLat,maxLng,maxLat" });
    }
    filterBbox = parts; // [minLng, minLat, maxLng, maxLat]
  }

  const maxLimit = 1000;
  let parsedLimit = queryLimit ? parseInt(queryLimit, 10) : 500;
  if (isNaN(parsedLimit) || parsedLimit <= 0) parsedLimit = 500;
  if (parsedLimit > maxLimit) parsedLimit = maxLimit;

  const allClaims = readClaims();
  const features = [];
  let totalMatching = 0;

  for (const c of allClaims) {
    if (!canViewInAtlas(c, req.user)) continue;

    // Attribute filters
    if (state && c.state && c.state.trim().toLowerCase() !== state.trim().toLowerCase()) continue;
    if (district && c.district && c.district.trim().toLowerCase() !== district.trim().toLowerCase()) continue;
    if (village && c.village && c.village.trim().toLowerCase() !== village.trim().toLowerCase()) continue;
    if (status && c.status !== status) continue;
    if (claimType && c.claimType !== claimType) continue;

    const hasOpenConflict = conflictService.hasOpenCompetingConflicts(c);
    if (conflict === "true" && !hasOpenConflict) continue;

    // Determine geometry
    let featureGeom = null;
    let boundaryKind = null;

    if (c.geometry && c.geometry.type) {
      featureGeom = c.geometry;
      boundaryKind = "polygon";
    } else if (c.location) {
      const lng = typeof c.location.lng === "number" ? c.location.lng : (typeof c.location.longitude === "number" ? c.location.longitude : null);
      const lat = typeof c.location.lat === "number" ? c.location.lat : (typeof c.location.latitude === "number" ? c.location.latitude : null);
      if (lng != null && lat != null && !isNaN(lng) && !isNaN(lat)) {
        featureGeom = { type: "Point", coordinates: [lng, lat] };
        boundaryKind = "point";
      }
    }

    if (!featureGeom) continue;

    // Viewport intersection
    const cBbox = computeFeatureBbox(featureGeom, c.location);
    if (!cBbox) continue;

    if (filterBbox && !bboxesIntersect(filterBbox, cBbox)) {
      continue;
    }

    totalMatching++;
    if (features.length < parsedLimit) {
      const verifiedOnMap = Boolean(c.mapCheck && c.mapCheck.officerConfirmed);
      features.push({
        type: "Feature",
        geometry: featureGeom,
        properties: {
          claimId: c.claimId,
          applicantName: c.applicantName || "",
          village: c.village || "",
          district: c.district || "",
          claimType: c.claimType || "IFR",
          status: c.status || "Submitted",
          stage: c.currentStage || "Gram Sabha",
          areaHa: c.computedAreaHa != null ? Number(c.computedAreaHa) : null,
          boundaryKind,
          verifiedOnMap,
          hasOpenConflict,
          occupationSinceYear: c.occupationSinceYear != null ? c.occupationSinceYear : null,
          grantedAt: getClaimGrantedAt(c),
          createdAt: c.createdAt || null,
        },
      });
    }
  }

  res.json({
    type: "FeatureCollection",
    features,
    total: totalMatching,
    truncated: totalMatching > parsedLimit,
  });
});

/**
 * GET /api/atlas/claims/:id
 * Detailed side panel data. Whitelists fields and logs access to atlas-access.log.
 */
app.get("/api/atlas/claims/:id", requireAuth, (req, res) => {
  if (!["gram_sabha", "sdlc", "dlc"].includes(req.user.role)) {
    return res.status(403).json({ error: "Atlas requires an officer role." });
  }

  const claims = readClaims();
  const claim = claims.find(c => c.claimId === req.params.id);
  if (!claim || !canViewInAtlas(claim, req.user)) {
    return res.status(404).json({ error: "Claim not found." });
  }

  logAtlasAccess(req.user, claim.claimId, "view_detail");

  const timelineEntries = Array.isArray(claim.auditTrail) ? [...claim.auditTrail] : [];
  timelineEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const timeline = timelineEntries.slice(0, 15).map(e => ({
    stage: e.stage || "",
    action: e.action || "",
    actor: e.actor || "",
    note: e.note || "",
    timestamp: e.timestamp || "",
  }));

  const documents = (claim.documents || []).map((d, index) => ({
    index,
    originalName: d.originalName,
    sizeBytes: d.sizeBytes,
    url: `/api/claims/${claim.claimId}/documents/${d.storedName}`,
    confirmedCategory: d.confirmedCategory || null,
  }));

  const checklist = documentClassificationService.computeChecklist(claim.documents || []);

  const conflicts = (claim.conflicts || []).map(conf => ({
    otherClaimId: conf.otherClaimId,
    kind: conf.kind,
    reasons: conf.reasons || [],
    status: conf.status,
  }));

  const verifiedOnMap = Boolean(claim.mapCheck && claim.mapCheck.officerConfirmed);

  const detail = {
    claimId: claim.claimId,
    applicantName: claim.applicantName || "",
    village: claim.village || "",
    district: claim.district || "",
    state: claim.state || "",
    claimType: claim.claimType || "IFR",
    status: claim.status || "Submitted",
    stage: claim.currentStage || "Gram Sabha",
    areaHa: claim.computedAreaHa != null ? Number(claim.computedAreaHa) : null,
    boundaryKind: claim.geometry ? "polygon" : "point",
    verifiedOnMap,
    hasOpenConflict: conflictService.hasOpenCompetingConflicts(claim),
    occupationSinceYear: claim.occupationSinceYear != null ? claim.occupationSinceYear : null,
    grantedAt: getClaimGrantedAt(claim),
    createdAt: claim.createdAt || null,
    landDescription: claim.landDescription || "",
    claimedAreaHa: claim.computedAreaHa != null ? Number(claim.computedAreaHa) : null,
    locationSource: claim.locationSource || null,
    accuracyMeters: claim.accuracyMeters != null ? Number(claim.accuracyMeters) : null,
    mapCheck: claim.mapCheck ? {
      confirmedBy: claim.mapCheck.confirmedBy || null,
      confirmedAt: claim.mapCheck.confirmedAt || null,
      observation: claim.mapCheck.observation || "",
    } : null,
    timeline,
    documents,
    checklist,
    conflicts,
    rejectionReason: claim.rejection ? claim.rejection.justification : null,
    priorRejection: claim.priorRejection || null,
    appeal: claim.appeal ? {
      grounds: claim.appeal.grounds,
      filedAt: claim.appeal.filedAt,
      appellant: claim.appeal.appellant,
    } : null,
  };

  res.json({ claim: detail });
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

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`TribalEarth AI — Module 1 server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
module.exports.server = server;
