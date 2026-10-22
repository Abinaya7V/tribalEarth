/**
 * TribalEarth AI — Module 4: Appeal Eligibility & Routing Configuration
 * ---------------------------------------------------------------------
 * LEGAL DISCLAIMER & HONESTY CONTRACT:
 * These rules model the appellate and petition mechanisms under the Forest Rights
 * Act, 2006 (FRA) and the Scheduled Tribes and Other Traditional Forest Dwellers
 * (Recognition of Forest Rights) Rules, 2008 (specifically Rule 11 & 12).
 *
 * NOTE FOR DEPLOYMENT:
 * This software configuration does not constitute legal advice. Before deploying
 * in any specific state or district, verify these rules against state-specific
 * amendments, circulars, or appellate timelines issued by the Ministry of Tribal
 * Affairs (MoTA) or State Tribal Welfare Departments.
 *
 * Configured principles:
 * 1. Gram Sabha rejection:
 *    Under FRA Rule 11(1), any person aggrieved by the resolution of the Gram Sabha
 *    may file a petition to the Sub-Divisional Level Committee (SDLC) within 60 days.
 * 2. SDLC rejection:
 *    Under our pipeline model, SDLC rejections are automatically escalated to DLC.
 *    The applicant may submit an appeal statement/evidence directly to the DLC review.
 * 3. DLC rejection:
 *    Under FRA Section 6(6) / Rule 12(3), the decision of the District Level Committee
 *    (DLC) is considered final and binding at the administrative level.
 *    Any further review or petition handling must be explicitly enabled here if
 *    permitted by high-court writ or state-level revision guidelines.
 */

const APPEAL_CONFIG = {
  // Appeal window in days from rejection timestamp (FRA Rule 11 specifies 60 days)
  appealWindowDays: 60,

  // Minimum length of written grounds statement required from the applicant
  minGroundsLength: 30,

  // Maximum number of supporting documents that can be attached to an appeal
  maxSupportingDocuments: 5,

  // Maximum file size per document (8MB, matching Module 1)
  maxFileSizePerDocBytes: 8 * 1024 * 1024,

  // Allowed MIME types for appeal supporting documents
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ],

  // Stage routing rules based on where the claim was rejected
  routing: {
    "Gram Sabha": {
      canAppeal: true,
      targetStage: "SDLC",
      label: "Appeal to Sub-Divisional Level Committee (SDLC)",
      description: "Under FRA Rule 11(1), petitions against Gram Sabha resolutions are reviewed by SDLC.",
    },
    SDLC: {
      canAppeal: true,
      targetStage: "DLC",
      label: "Appeal statement to District Level Committee (DLC)",
      description: "Submit written grounds and additional proof to DLC for the escalated review.",
    },
    DLC: {
      // Per FRA Rule 12(3), DLC determination is final at the administrative tier.
      // Set to true only if state-specific revision or court-remanded petition workflow applies.
      canAppeal: false,
      targetStage: null,
      label: "DLC Decision Final",
      description: "The District Level Committee is the final administrative authority under Section 6(6) of the FRA.",
    },
  },
};

/**
 * Checks whether a claim is eligible for appeal under the configured rules.
 *
 * @param {Object} claim - The claim record from storage
 * @returns {Object} { eligible: boolean, reason?: string, targetStage?: string, deadline?: string }
 */
function evaluateAppealEligibility(claim) {
  if (!claim) {
    return { eligible: false, reason: "Claim does not exist." };
  }

  // Claim must be in a rejected or escalated-rejection status
  const isRejected = claim.status === "Rejected" || claim.status === "Escalated to DLC";
  if (!isRejected) {
    return {
      eligible: false,
      reason: "Claim is not in a rejected state.",
    };
  }

  // Determine stage where rejection occurred
  const rejectionStage = claim.rejection?.rejectedAtStage || claim.priorRejection?.stage || claim.currentStage;
  const stageRule = APPEAL_CONFIG.routing[rejectionStage];

  if (!stageRule || !stageRule.canAppeal) {
    return {
      eligible: false,
      reason: `Rejections at ${rejectionStage} cannot be appealed through this administrative portal.`,
    };
  }

  // Check if an appeal is already active/pending
  const activeAppeal = (claim.appeals || []).find((a) => a.status === "pending");
  if (activeAppeal || (claim.appeal && claim.appeal.status === "pending")) {
    return {
      eligible: false,
      reason: "An appeal is already pending review for this claim.",
    };
  }

  // Calculate 60-day deadline from rejection timestamp
  const rejectionTimeStr = claim.rejection?.timestamp || claim.priorRejection?.timestamp || claim.updatedAt;
  const rejectionTime = new Date(rejectionTimeStr).getTime();
  if (isNaN(rejectionTime)) {
    return {
      eligible: false,
      reason: "Invalid rejection timestamp on record.",
    };
  }

  const windowMs = APPEAL_CONFIG.appealWindowDays * 24 * 60 * 60 * 1000;
  const deadlineDate = new Date(rejectionTime + windowMs);
  const now = new Date();

  if (now > deadlineDate) {
    return {
      eligible: false,
      reason: `Appeal window of ${APPEAL_CONFIG.appealWindowDays} days expired on ${deadlineDate.toISOString().slice(0, 10)}.`,
      deadline: deadlineDate.toISOString(),
    };
  }

  return {
    eligible: true,
    targetStage: stageRule.targetStage,
    deadline: deadlineDate.toISOString(),
    rejectionStage,
    label: stageRule.label,
  };
}

module.exports = {
  APPEAL_CONFIG,
  evaluateAppealEligibility,
};
