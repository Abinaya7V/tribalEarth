/**
 * TribalEarth AI — Claim Data Access Layer
 * ----------------------------------------
 * Encapsulates file-based JSON storage operations behind a consistent
 * interface. This separates storage I/O from route logic and business rules,
 * enabling smooth transition to PostgreSQL / PostGIS in future modules
 * without modifying route handlers.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CLAIMS_FILE = path.join(DATA_DIR, "claims.json");

// Ensure data folder and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CLAIMS_FILE)) {
  fs.writeFileSync(CLAIMS_FILE, "[]", "utf-8");
}

function readAllClaims() {
  try {
    const raw = fs.readFileSync(CLAIMS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[claimStore] Error reading claims file:", err);
    return [];
  }
}

function writeAllClaims(claims) {
  const tmp = CLAIMS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(claims, null, 2), "utf-8");
  fs.renameSync(tmp, CLAIMS_FILE);
}

function migrateLegacyClaims() {
  const claims = readAllClaims();
  let changed = false;
  claims.forEach((c) => {
    if (c.ownerId === undefined) {
      c.ownerId = null;
      c.legacy = true;
      changed = true;
    }
    if (!Array.isArray(c.appeals)) {
      c.appeals = c.appeal ? [c.appeal] : [];
      changed = true;
    }
  });
  if (changed) {
    writeAllClaims(claims);
  }
}

// Run migration on load
migrateLegacyClaims();

function getClaims() {
  return readAllClaims();
}

function findClaimById(claimId) {
  if (!claimId) return null;
  const claims = readAllClaims();
  return claims.find((c) => c.claimId === claimId) || null;
}

function findClaimsByOwner(username) {
  if (!username) return [];
  const claims = readAllClaims();
  return claims.filter((c) => c.ownerId === username && !c.legacy);
}

function insertClaim(claim) {
  const claims = readAllClaims();
  claims.push(claim);
  writeAllClaims(claims);
  return claim;
}

function updateClaim(claimId, updaterFn) {
  const claims = readAllClaims();
  const idx = claims.findIndex((c) => c.claimId === claimId);
  if (idx === -1) return null;

  const current = claims[idx];
  const updated = updaterFn(current);
  claims[idx] = updated || current;
  writeAllClaims(claims);
  return claims[idx];
}

module.exports = {
  getClaims,
  findClaimById,
  findClaimsByOwner,
  insertClaim,
  updateClaim,
  writeAllClaims,
  migrateLegacyClaims,
};
