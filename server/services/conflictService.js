/**
 * TribalEarth AI — Overclaim & Competing Claim Detection Service
 * -------------------------------------------------------------
 * Detects spatial overlaps and duplicate proof across claims.
 *
 * HONESTY CONTRACT:
 * - The system NEVER automatically decides or approves/rejects a claim.
 * - All detected flags are advisory ("possible overlap", "competing claim").
 * - Only a human officer's written resolution unlocks approval.
 * - Exact-byte SHA-256 hashing is used for documents; re-scanned or re-photographed
 *   files will produce different hashes and will not match.
 */

const crypto = require("crypto");
const { claimsOverlap } = require("./geoService");

/**
 * Computes SHA-256 hex string of a buffer or string.
 */
function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Computes reasons for conflict between claimA and claimB.
 * Returns array of reasons: ["SPATIAL_OVERLAP", "DUPLICATE_PROOF"]
 */
function evaluateConflictReasons(claimA, claimB) {
  const reasons = [];

  // 1. Spatial Overlap
  if (claimsOverlap(claimA, claimB)) {
    reasons.push("SPATIAL_OVERLAP");
  }

  // 2. Duplicate Proof (matching sha256 on any document)
  const docsA = Array.isArray(claimA.documents) ? claimA.documents : [];
  const docsB = Array.isArray(claimB.documents) ? claimB.documents : [];
  const hashesA = new Set(docsA.map((d) => d.sha256).filter(Boolean));

  for (const docB of docsB) {
    if (docB.sha256 && hashesA.has(docB.sha256)) {
      reasons.push("DUPLICATE_PROOF");
      break;
    }
  }

  return reasons;
}

/**
 * Detects conflicts for a given claim against all other claims.
 * Maintains symmetric links between claims.
 *
 * @param {object} claim - Target claim to detect conflicts for.
 * @param {Array<object>} allClaims - Complete list of claims.
 * @returns {Array<object>} - Updated conflicts array on the target claim.
 */
function detectConflicts(claim, allClaims) {
  if (!claim) return [];
  if (!Array.isArray(claim.conflicts)) {
    claim.conflicts = [];
  }

  const nowISO = new Date().toISOString();

  for (const other of allClaims) {
    if (other.claimId === claim.claimId) continue;
    // Default rule: Rejected claims do not count as active conflicts
    if (other.status === "Rejected") continue;

    if (!Array.isArray(other.conflicts)) {
      other.conflicts = [];
    }

    const reasons = evaluateConflictReasons(claim, other);

    // Determine conflict kind: "duplicate" if same applicant / ownerId, else "competing"
    const isSameOwner =
      Boolean(claim.ownerId) &&
      Boolean(other.ownerId) &&
      claim.ownerId === other.ownerId;
    const kind = isSameOwner ? "duplicate" : "competing";

    const existingOnClaim = claim.conflicts.find(
      (c) => c.otherClaimId === other.claimId
    );
    const existingOnOther = other.conflicts.find(
      (c) => c.otherClaimId === claim.claimId
    );

    if (reasons.length > 0) {
      // Conflict exists or updated
      if (existingOnClaim) {
        existingOnClaim.reasons = reasons;
        existingOnClaim.kind = kind;
        if (existingOnClaim.status === "moot") {
          existingOnClaim.status = "open";
        }
      } else {
        claim.conflicts.push({
          conflictId: `cfl_${crypto.randomUUID().slice(0, 8)}`,
          otherClaimId: other.claimId,
          reasons,
          kind,
          status: "open",
          detectedAt: nowISO,
          resolution: null,
        });
      }

      // Symmetric entry on other claim
      if (existingOnOther) {
        existingOnOther.reasons = reasons;
        existingOnOther.kind = kind;
        if (existingOnOther.status === "moot") {
          existingOnOther.status = "open";
        }
      } else {
        other.conflicts.push({
          conflictId: `cfl_${crypto.randomUUID().slice(0, 8)}`,
          otherClaimId: claim.claimId,
          reasons,
          kind,
          status: "open",
          detectedAt: nowISO,
          resolution: null,
        });
      }
    } else {
      // No conflict detected now. If there was an open conflict previously, remove or moot it
      if (existingOnClaim && existingOnClaim.status === "open") {
        claim.conflicts = claim.conflicts.filter(
          (c) => c.otherClaimId !== other.claimId
        );
      }
      if (existingOnOther && existingOnOther.status === "open") {
        other.conflicts = other.conflicts.filter(
          (c) => c.otherClaimId !== claim.claimId
        );
      }
    }
  }

  return claim.conflicts;
}

/**
 * Marks counterpart conflict entries "moot" when a claim is terminally rejected.
 *
 * @param {object} rejectedClaim - The claim that was terminally rejected.
 * @param {Array<object>} allClaims - All claims in the system.
 */
function mootConflictsForClaim(rejectedClaim, allClaims) {
  if (!rejectedClaim) return;
  const nowISO = new Date().toISOString();

  // Mark all conflicts on the rejected claim as moot
  if (Array.isArray(rejectedClaim.conflicts)) {
    for (const c of rejectedClaim.conflicts) {
      if (c.status === "open") {
        c.status = "moot";
      }
    }
  }

  // Find linked entries on other claims and mark them moot with an audit note
  for (const other of allClaims) {
    if (other.claimId === rejectedClaim.claimId) continue;
    if (!Array.isArray(other.conflicts)) continue;

    for (const c of other.conflicts) {
      if (c.otherClaimId === rejectedClaim.claimId && c.status !== "moot") {
        c.status = "moot";
        if (Array.isArray(other.auditTrail)) {
          other.auditTrail.push({
            stage: other.currentStage || "Gram Sabha",
            action: "Conflict mooted",
            actor: "System",
            note: `Conflict with ${rejectedClaim.claimId} mooted due to terminal rejection.`,
            timestamp: nowISO,
          });
        }
      }
    }
  }
}

/**
 * Checks if a claim has open competing conflicts that block approval.
 */
function hasOpenCompetingConflicts(claim) {
  if (!claim || !Array.isArray(claim.conflicts)) return false;
  return claim.conflicts.some(
    (c) => c.kind === "competing" && c.status === "open"
  );
}

/**
 * Counts open competing conflicts on a claim.
 */
function countOpenCompetingConflicts(claim) {
  if (!claim || !Array.isArray(claim.conflicts)) return 0;
  return claim.conflicts.filter(
    (c) => c.kind === "competing" && c.status === "open"
  ).length;
}

module.exports = {
  hashBuffer,
  evaluateConflictReasons,
  detectConflicts,
  mootConflictsForClaim,
  hasOpenCompetingConflicts,
  countOpenCompetingConflicts,
};
