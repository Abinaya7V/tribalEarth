const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { initDb, readClaims, writeClaims, closeDb } = require("../services/db");

test("Task 1.1: Migration from sample claims.json is idempotent", () => {
  const testDir = path.join(__dirname, "temp_migration_test");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const sampleClaims = [
    {
      claimId: "FRA-2026-TEST-0001",
      applicantName: "Tester One",
      village: "Test Village",
      claimType: "IFR",
      currentStage: "Gram Sabha",
      status: "Submitted",
      createdAt: new Date().toISOString(),
      documents: []
    },
    {
      claimId: "FRA-2026-TEST-0002",
      applicantName: "Tester Two",
      village: "Test Village 2",
      claimType: "CFR",
      currentStage: "SDLC",
      status: "Under Review",
      createdAt: new Date().toISOString(),
      documents: []
    }
  ];

  const claimsJsonPath = path.join(testDir, "claims.json");
  const testDbPath = path.join(testDir, "tribalearth.db");
  fs.writeFileSync(claimsJsonPath, JSON.stringify(sampleClaims, null, 2), "utf-8");

  // First initialization: should migrate claims.json -> SQLite
  initDb(testDbPath);
  const claimsAfterFirstInit = readClaims();
  assert.strictEqual(claimsAfterFirstInit.length, 2);
  assert.strictEqual(claimsAfterFirstInit[0].claimId, "FRA-2026-TEST-0001");
  assert.strictEqual(claimsAfterFirstInit[1].claimId, "FRA-2026-TEST-0002");

  // Verify claims.json was renamed to claims.json.migrated
  assert.strictEqual(fs.existsSync(claimsJsonPath), false, "claims.json should be renamed");
  assert.strictEqual(fs.existsSync(claimsJsonPath + ".migrated"), true, "claims.json.migrated should exist");

  // Second initialization (server restart): must be idempotent
  closeDb();
  initDb(testDbPath);
  const claimsAfterSecondInit = readClaims();
  assert.strictEqual(claimsAfterSecondInit.length, 2, "Second start should keep exact same count");
  assert.strictEqual(claimsAfterSecondInit[0].claimId, "FRA-2026-TEST-0001");

  closeDb();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test("Task 1.2: Per-claim diffed writes do not clobber concurrent independent modifications", () => {
  const testDir = path.join(__dirname, "temp_diff_test");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const testDbPath = path.join(testDir, "tribalearth.db");
  initDb(testDbPath);

  const initialClaims = [
    {
      claimId: "CLAIM-DIFF-A",
      applicantName: "Claim A Original",
      village: "Village A",
      currentStage: "Gram Sabha",
      status: "Submitted",
      createdAt: new Date().toISOString()
    },
    {
      claimId: "CLAIM-DIFF-B",
      applicantName: "Claim B Original",
      village: "Village B",
      currentStage: "Gram Sabha",
      status: "Submitted",
      createdAt: new Date().toISOString()
    }
  ];

  writeClaims(initialClaims);

  // Two independent operations read claims simultaneously
  const op1Claims = readClaims();
  const op2Claims = readClaims();

  // Op 1 modifies Claim A only
  const claimA = op1Claims.find(c => c.claimId === "CLAIM-DIFF-A");
  claimA.applicantName = "Claim A Updated by Op 1";
  claimA.status = "Approved";
  writeClaims(op1Claims);

  // Op 2 modifies Claim B only (meanwhile its in-memory Claim A has the old data)
  const claimB = op2Claims.find(c => c.claimId === "CLAIM-DIFF-B");
  claimB.applicantName = "Claim B Updated by Op 2";
  claimB.village = "Village B Updated";
  writeClaims(op2Claims);

  // Fresh read to verify neither write clobbered the other
  const freshClaims = readClaims();
  const freshA = freshClaims.find(c => c.claimId === "CLAIM-DIFF-A");
  const freshB = freshClaims.find(c => c.claimId === "CLAIM-DIFF-B");

  assert.strictEqual(freshA.applicantName, "Claim A Updated by Op 1", "Claim A update from Op 1 should be preserved");
  assert.strictEqual(freshA.status, "Approved", "Claim A status from Op 1 should be preserved");
  assert.strictEqual(freshB.applicantName, "Claim B Updated by Op 2", "Claim B update from Op 2 should be preserved");
  assert.strictEqual(freshB.village, "Village B Updated", "Claim B village from Op 2 should be preserved");

  closeDb();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test("Task 1.3: Classify re-read behaviour preserves changes made during OCR wait", async () => {
  const testDir = path.join(__dirname, "temp_ocr_test");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const testDbPath = path.join(testDir, "tribalearth.db");
  initDb(testDbPath);

  const initialClaims = [
    {
      claimId: "CLAIM-OCR-1",
      applicantName: "Karan",
      village: "Sal Forest Village",
      currentStage: "Gram Sabha",
      status: "Submitted",
      createdAt: new Date().toISOString(),
      documents: [
        {
          originalName: "ration_card.png",
          storedName: "stored_ration_card.png",
          url: "/uploads/stored_ration_card.png"
        }
      ],
      auditTrail: []
    }
  ];
  writeClaims(initialClaims);

  // Step 1: Classify starts and reads claim before OCR
  const preOcrClaims = readClaims();
  const claimToClassify = preOcrClaims.find(c => c.claimId === "CLAIM-OCR-1");
  assert.ok(claimToClassify);

  // Step 2: During the OCR wait, an officer makes a decision on this claim
  const officerClaims = readClaims();
  const officerClaim = officerClaims.find(c => c.claimId === "CLAIM-OCR-1");
  officerClaim.status = "Under Review";
  officerClaim.currentStage = "SDLC";
  officerClaim.auditTrail.push({
    stage: "SDLC",
    action: "Approved & Forwarded",
    actor: "Gram Sabha Officer",
    timestamp: new Date().toISOString()
  });
  writeClaims(officerClaims);

  // Step 3: OCR finishes. Simulating the fix in classify route:
  // Route re-reads claims fresh, finds the fresh claim, applies review, and writes back
  const mockOcrText = "Government of India Ration Card Name: Karan Village: Sal Forest Village";
  const freshClaims = readClaims();
  const freshClaim = freshClaims.find(c => c.claimId === "CLAIM-OCR-1");
  freshClaim.documents[0].review = {
    extractedText: mockOcrText,
    officerConfirmed: false,
    rule13: { categoryId: "government_id", categoryLabel: "Government ID", confidence: 0.95 }
  };
  writeClaims(freshClaims);

  // Step 4: Verify the final claim has BOTH the officer's stage advance AND the OCR review
  const verifiedClaims = readClaims();
  const verifiedClaim = verifiedClaims.find(c => c.claimId === "CLAIM-OCR-1");

  assert.strictEqual(verifiedClaim.status, "Under Review", "Officer decision must not be clobbered");
  assert.strictEqual(verifiedClaim.currentStage, "SDLC", "Officer stage advance must not be clobbered");
  assert.strictEqual(verifiedClaim.auditTrail.length, 1, "Audit trail must not be lost");
  assert.strictEqual(verifiedClaim.documents[0].review.extractedText, mockOcrText, "OCR review must be saved");

  closeDb();
  fs.rmSync(testDir, { recursive: true, force: true });
});
