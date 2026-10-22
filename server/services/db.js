/**
 * TribalEarth AI — SQLite Storage Service
 * -----------------------------------------
 * Replaces the flat data/claims.json file with Node.js built-in node:sqlite
 * (DatabaseSync) using a "document + indexed columns" pattern.
 *
 * Why per-claim diffed writes matter:
 * In the legacy JSON approach, every route performed a full read-all -> modify ->
 * write-all. In operations like POST /api/claims/:id/documents/:index/classify,
 * the route reads all claims, awaits OCR for up to 20 seconds, and then writes
 * the entire JSON file back. Any decision or claim update made by an officer
 * during those 20 seconds was silently overwritten.
 * Per-claim diffed writes ensure only newly created or modified claims are
 * upserted into SQLite, preventing concurrent modifications on unrelated
 * claims from clobbering each other.
 */

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");

let dbInstance = null;
let currentDbPath = null;

// WeakMap holding snapshots of claims keyed by the array returned by readClaims()
// Key: claims array reference -> Value: Map<claimId, jsonString>
const snapshots = new WeakMap();

/**
 * Initializes the SQLite database, creates schema and indexes,
 * and performs one-time migration from claims.json if needed.
 */
function initDb(customDbPath = null) {
  const effectiveDataDir = process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const defaultDbPath = path.join(effectiveDataDir, "tribalearth.db");
  const dbPath = customDbPath || process.env.DB_PATH || defaultDbPath;
  const dataDir = path.dirname(dbPath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (dbInstance && currentDbPath === dbPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Document + indexed columns table
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      claim_id      TEXT PRIMARY KEY,
      owner_id      TEXT,
      current_stage TEXT NOT NULL,
      status        TEXT NOT NULL,
      district      TEXT,
      state         TEXT,
      claim_type    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT,
      doc           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_claims_stage    ON claims(current_stage, status);
    CREATE INDEX IF NOT EXISTS idx_claims_owner    ON claims(owner_id);
    CREATE INDEX IF NOT EXISTS idx_claims_district ON claims(district);
  `);

  // One-time idempotent migration from data/claims.json
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM claims;").get();
  const claimsTableEmpty = !countRow || countRow.count === 0;

  const claimsJsonPath = path.join(dataDir, "claims.json");
  if (claimsTableEmpty && fs.existsSync(claimsJsonPath)) {
    try {
      const rawContent = fs.readFileSync(claimsJsonPath, "utf-8").trim();
      if (rawContent && rawContent !== "[]") {
        const claimsData = JSON.parse(rawContent);
        if (Array.isArray(claimsData) && claimsData.length > 0) {
          db.exec("BEGIN IMMEDIATE;");
          try {
            const insertStmt = db.prepare(`
              INSERT INTO claims (
                claim_id, owner_id, current_stage, status, district, state, claim_type, created_at, updated_at, doc
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `);

            for (const c of claimsData) {
              const docStr = JSON.stringify(c);
              insertStmt.run(
                c.claimId,
                c.ownerId !== undefined ? c.ownerId : null,
                c.currentStage || "Gram Sabha",
                c.status || "Submitted",
                c.district || null,
                c.state || null,
                c.claimType || null,
                c.createdAt || new Date().toISOString(),
                c.updatedAt || null,
                docStr
              );
            }
            db.exec("COMMIT;");

            const migratedPath = claimsJsonPath + ".migrated";
            fs.renameSync(claimsJsonPath, migratedPath);
            console.log(`[db] Migrated ${claimsData.length} claims from claims.json to SQLite database.`);
          } catch (migrationErr) {
            db.exec("ROLLBACK;");
            console.error("[db] Migration failed; rolled back:", migrationErr);
            throw migrationErr;
          }
        }
      }
    } catch (readErr) {
      console.error("[db] Could not read claims.json for migration:", readErr);
    }
  }

  dbInstance = db;
  currentDbPath = dbPath;
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    initDb();
  }
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * Returns an array of parsed claim doc objects in stable insertion order.
 * Takes a JSON snapshot of each claim returned, keyed by the returned array in a WeakMap.
 */
function readClaims() {
  const db = getDb();
  const rows = db.prepare("SELECT doc FROM claims ORDER BY rowid ASC;").all();
  const claims = [];
  const snapshotMap = new Map();

  for (const row of rows) {
    const claim = JSON.parse(row.doc);
    claims.push(claim);
    // Baseline snapshot string of the parsed claim
    snapshotMap.set(claim.claimId, JSON.stringify(claim));
  }

  snapshots.set(claims, snapshotMap);
  return claims;
}

/**
 * Writes claims back to SQLite in ONE transaction.
 * Only upserts claims whose JSON differs from the read-time snapshot or any new claims.
 * Synchronizes indexed columns with doc on every upsert.
 */
function writeClaims(claims) {
  if (!Array.isArray(claims)) return;
  const db = getDb();
  const snapshotMap = snapshots.get(claims);

  const toUpsert = [];
  for (const c of claims) {
    if (!c || !c.claimId) continue;
    const currentJson = JSON.stringify(c);
    const previousJson = snapshotMap ? snapshotMap.get(c.claimId) : undefined;

    // Only update if changed or newly added
    if (previousJson === undefined || previousJson !== currentJson) {
      toUpsert.push({ claim: c, json: currentJson });
    }
  }

  if (toUpsert.length === 0) {
    return;
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const upsertStmt = db.prepare(`
      INSERT INTO claims (
        claim_id, owner_id, current_stage, status, district, state, claim_type, created_at, updated_at, doc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(claim_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        current_stage = excluded.current_stage,
        status = excluded.status,
        district = excluded.district,
        state = excluded.state,
        claim_type = excluded.claim_type,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        doc = excluded.doc;
    `);

    for (const item of toUpsert) {
      const c = item.claim;
      upsertStmt.run(
        c.claimId,
        c.ownerId !== undefined ? c.ownerId : null,
        c.currentStage || "Gram Sabha",
        c.status || "Submitted",
        c.district || null,
        c.state || null,
        c.claimType || null,
        c.createdAt || new Date().toISOString(),
        c.updatedAt || null,
        item.json
      );
      if (snapshotMap) {
        snapshotMap.set(c.claimId, item.json);
      }
    }

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

// Initialize on module load
initDb();

module.exports = {
  readClaims,
  writeClaims,
  initDb,
  getDb,
  closeDb,
};
