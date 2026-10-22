const { test, before } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const fs = require("fs");
const path = require("path");

// Use an isolated temporary data directory for conflict tests
const TEMP_DATA_DIR = path.join(__dirname, "temp_conflict_data_" + Date.now());
process.env.DATA_DIR = TEMP_DATA_DIR;
process.env.DB_PATH = path.join(TEMP_DATA_DIR, "tribalearth.db");

// Import the app directly
const app = require("../server");

function makePolygon(offset) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [81.40 + offset, 20.20 + offset],
        [81.50 + offset, 20.20 + offset],
        [81.50 + offset, 20.30 + offset],
        [81.40 + offset, 20.30 + offset],
        [81.40 + offset, 20.20 + offset],
      ],
    ],
  };
}

function makeOverlappingPolygon(offset) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [81.45 + offset, 20.25 + offset],
        [81.55 + offset, 20.25 + offset],
        [81.55 + offset, 20.35 + offset],
        [81.45 + offset, 20.35 + offset],
        [81.45 + offset, 20.25 + offset],
      ],
    ],
  };
}

const SELF_INTERSECTING_BOWTIE = {
  type: "Polygon",
  coordinates: [
    [
      [81.40, 20.20],
      [81.50, 20.30],
      [81.50, 20.20],
      [81.40, 20.30],
      [81.40, 20.20],
    ],
  ],
};

let applicant1Token, applicant2Token, applicant3Token, gsToken, sdlcToken;

before(async () => {
  if (!fs.existsSync(TEMP_DATA_DIR)) fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const r1 = await request(app).post("/api/auth/login").send({ username: "applicant1", password: "applicant123" });
  applicant1Token = r1.body.token;

  const r2 = await request(app).post("/api/auth/login").send({ username: "applicant2", password: "applicant2123" });
  applicant2Token = r2.body.token;

  const r3 = await request(app).post("/api/auth/login").send({ username: "applicant3", password: "applicant3123" });
  applicant3Token = r3.body.token;

  const rGS = await request(app).post("/api/auth/login").send({ username: "gramsabha1", password: "gramsabha123" });
  gsToken = rGS.body.token;

  const rSDLC = await request(app).post("/api/auth/login").send({ username: "sdlc1", password: "sdlc123" });
  sdlcToken = rSDLC.body.token;
});

test("1. Anonymous call to /advance returns 401 or route is gone (404)", async () => {
  const res = await request(app).patch("/api/claims/FRA-2026-TEST-9999/advance").send({ actor: "Test" });
  assert.notStrictEqual(res.status, 200, "Unauthenticated /advance must not succeed with 200");
  assert.ok(res.status === 401 || res.status === 404, "Must return 401 or 404");
});

test("2. map-check returns 200 for the correct officer and 403 for the wrong one", async () => {
  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Map Check User")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("latitude", "20.27")
    .field("longitude", "81.49");
  assert.strictEqual(fileRes.status, 201);
  const id = fileRes.body.claim.claimId;

  // Wrong stage (SDLC officer for Gram Sabha claim) -> 403
  const wrongRes = await request(app)
    .post(`/api/claims/${id}/map-check`)
    .set("Authorization", `Bearer ${sdlcToken}`)
    .send({ locationChecked: true, observation: "Checked by SDLC" });
  assert.strictEqual(wrongRes.status, 403);

  // Correct stage (GS officer) -> 200
  const rightRes = await request(app)
    .post(`/api/claims/${id}/map-check`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ locationChecked: true, observation: "Checked by GS" });
  assert.strictEqual(rightRes.status, 200);
});

test("3. Approve after reject returns 409", async () => {
  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Rejection Guard Test")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("latitude", "20.27")
    .field("longitude", "81.49");
  assert.strictEqual(fileRes.status, 201);
  const id = fileRes.body.claim.claimId;

  // Reject claim with valid written reason
  const rejRes = await request(app)
    .post(`/api/claims/${id}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "reject", justification: "Claim does not fulfill FRA Rule 13 evidence requirements." });
  assert.strictEqual(rejRes.status, 200);

  // Attempting to approve an already rejected claim must return 409
  const appRes = await request(app)
    .post(`/api/claims/${id}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "approve" });
  assert.strictEqual(appRes.status, 409);
});

test("4. Filing without location returns 400; self-intersecting polygon returns 400; malformed geometry JSON returns 400", async () => {
  // Missing location entirely
  const noLoc = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "No Loc")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR");
  assert.strictEqual(noLoc.status, 400);
  assert.ok(noLoc.body.error.includes("Location is mandatory"));

  // Malformed JSON geometry
  const badJson = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Bad Json")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", "{ not valid json");
  assert.strictEqual(badJson.status, 400);
  assert.strictEqual(badJson.body.error, "Invalid geometry JSON format.");

  // Self-intersecting polygon
  const selfIntersect = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Self Intersect")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(SELF_INTERSECTING_BOWTIE));
  assert.strictEqual(selfIntersect.status, 400);
  assert.ok(selfIntersect.body.error.includes("self-intersect"));
});

test("5. Two applicants file overlapping polygons: both claims get a symmetric competing conflict; approving either returns 409 CONFLICT_UNRESOLVED", async () => {
  const pA = makePolygon(0.5);
  const pB = makeOverlappingPolygon(0.5);

  // Applicant 2 files polygon A
  const resA = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Applicant Two")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  assert.strictEqual(resA.status, 201);
  const claimIdA = resA.body.claim.claimId;

  // Applicant 3 files polygon B (overlapping polygon A)
  const resB = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Applicant Three")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB));
  assert.strictEqual(resB.status, 201);
  const claimIdB = resB.body.claim.claimId;

  // Officer inspects conflicts on Claim A
  const confResA = await request(app)
    .get(`/api/claims/${claimIdA}/conflicts`)
    .set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(confResA.status, 200);
  const cA = confResA.body.conflicts.find((c) => c.otherClaimId === claimIdB);
  assert.ok(cA, "Claim A must have conflict link to Claim B");
  assert.strictEqual(cA.kind, "competing");
  assert.ok(cA.reasons.includes("SPATIAL_OVERLAP"));
  assert.strictEqual(cA.status, "open");

  // Officer inspects conflicts on Claim B (symmetric)
  const confResB = await request(app)
    .get(`/api/claims/${claimIdB}/conflicts`)
    .set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(confResB.status, 200);
  const cB = confResB.body.conflicts.find((c) => c.otherClaimId === claimIdA);
  assert.ok(cB, "Claim B must have symmetric conflict link to Claim A");
  assert.strictEqual(cB.kind, "competing");
  assert.ok(cB.reasons.includes("SPATIAL_OVERLAP"));

  // Officer attempts to approve Claim A -> 409 CONFLICT_UNRESOLVED
  const approveRes = await request(app)
    .post(`/api/claims/${claimIdA}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "approve" });
  assert.strictEqual(approveRes.status, 409);
  assert.strictEqual(approveRes.body.code, "CONFLICT_UNRESOLVED");
  assert.ok(approveRes.body.count >= 1);
});

test("6. Same proof file hashed identically across two claims raises DUPLICATE_PROOF", async () => {
  const dummyProofBuf = Buffer.from("FRA Rule 13 Land Occupation Certificate 2005");
  const pA = makePolygon(1.5);
  const pB = makePolygon(2.5); // non-overlapping

  // Claim 1 with proof file
  const res1 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Proof User 1")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA))
    .attach("documents", dummyProofBuf, "proof.pdf");
  assert.strictEqual(res1.status, 201);
  const id1 = res1.body.claim.claimId;

  // Claim 2 with IDENTICAL proof file, different applicant and non-overlapping coords
  const res2 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Proof User 2")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB))
    .attach("documents", dummyProofBuf, "proof.pdf");
  assert.strictEqual(res2.status, 201);
  const id2 = res2.body.claim.claimId;

  // Officer checks conflicts on claim 2
  const confRes = await request(app)
    .get(`/api/claims/${id2}/conflicts`)
    .set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(confRes.status, 200);
  const conflict = confRes.body.conflicts.find((c) => c.otherClaimId === id1);
  assert.ok(conflict, "Conflict must be detected between claims with identical proof");
  assert.ok(conflict.reasons.includes("DUPLICATE_PROOF"));
});

test("7. Resolving with a reason under 10 characters returns 400; a valid resolution unlocks approval; rejection works while a conflict is open", async () => {
  const pA = makePolygon(3.5);
  const pB = makeOverlappingPolygon(3.5);

  // File two competing claims
  const res1 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Resolve Test 1")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  const id1 = res1.body.claim.claimId;

  const res2 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Resolve Test 2")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB));
  const id2 = res2.body.claim.claimId;

  const confRes = await request(app).get(`/api/claims/${id1}/conflicts`).set("Authorization", `Bearer ${gsToken}`);
  const conflict = confRes.body.conflicts.find((c) => c.otherClaimId === id2);

  // Resolution with reason under 10 characters returns 400
  const shortRes = await request(app)
    .post(`/api/claims/${id1}/conflicts/${conflict.conflictId}/resolve`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ finding: "boundaries_do_not_conflict", reason: "short" });
  assert.strictEqual(shortRes.status, 400);

  // Rejection works while a conflict is open
  const rejRes = await request(app)
    .post(`/api/claims/${id2}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "reject", justification: "Claimant failed to provide valid proof of 3 generations." });
  assert.strictEqual(rejRes.status, 200);

  // Now resolve conflict on claim 1
  const validResolve = await request(app)
    .post(`/api/claims/${id1}/conflicts/${conflict.conflictId}/resolve`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({
      finding: "this_claim_has_stronger_evidence",
      reason: "Claimant produced primary evidence dating back to 2005 verified by village elders.",
    });
  assert.strictEqual(validResolve.status, 200);
  assert.strictEqual(validResolve.body.success, true);

  // Approval is now unlocked!
  const approveRes = await request(app)
    .post(`/api/claims/${id1}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "approve" });
  assert.strictEqual(approveRes.status, 200);
  assert.strictEqual(approveRes.body.claim.currentStage, "SDLC");
});

test("8. An applicant never sees conflicts, other claim IDs, or the overlap flag; they see only conflictNotice", async () => {
  const pA = makePolygon(4.5);
  const pB = makeOverlappingPolygon(4.5);

  // File two competing claims
  const resA = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Privacy Test A")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  const idA = resA.body.claim.claimId;

  const resB = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Privacy Test B")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB));
  const idB = resB.body.claim.claimId;

  // Applicant 2 fetches their own claim
  const getClaim = await request(app)
    .get(`/api/claims/${idA}`)
    .set("Authorization", `Bearer ${applicant2Token}`);
  assert.strictEqual(getClaim.status, 200);
  assert.strictEqual(getClaim.body.claim.conflicts, undefined);
  assert.strictEqual(getClaim.body.claim.conflictNotice, true);
  assert.ok(!JSON.stringify(getClaim.body).includes(idB), "Must not leak the other claim ID");

  // Applicant 2 fetches /geo: OVERLAPS_OTHER_CLAIM flag must be stripped
  const getGeo = await request(app)
    .get(`/api/claims/${idA}/geo`)
    .set("Authorization", `Bearer ${applicant2Token}`);
  assert.strictEqual(getGeo.status, 200);
  const overlapFlag = (getGeo.body.flags || []).find((f) => f.code === "OVERLAPS_OTHER_CLAIM");
  assert.strictEqual(overlapFlag, undefined, "OVERLAPS_OTHER_CLAIM flag must not be returned to applicant");
});

test("9. Same-applicant overlap is labelled duplicate and does not block", async () => {
  const pA = makePolygon(5.5);
  const pB = makeOverlappingPolygon(5.5);

  // Applicant 2 files two claims on overlapping land
  const res1 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Same App 1")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  const id1 = res1.body.claim.claimId;

  const res2 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Same App 2")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "CR")
    .field("geometry", JSON.stringify(pB));
  const id2 = res2.body.claim.claimId;

  const confRes = await request(app).get(`/api/claims/${id1}/conflicts`).set("Authorization", `Bearer ${gsToken}`);
  const duplicateConflict = confRes.body.conflicts.find((c) => c.otherClaimId === id2);
  assert.ok(duplicateConflict);
  assert.strictEqual(duplicateConflict.kind, "duplicate");

  // Duplicate conflict is advisory and does NOT block approval
  const approveRes = await request(app)
    .post(`/api/claims/${id1}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "approve" });
  assert.strictEqual(approveRes.status, 200);
});

test("10. A terminal rejection of claim B marks claim A's link 'moot'", async () => {
  const pA = makePolygon(6.5);
  const pB = makeOverlappingPolygon(6.5);

  const resA = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Moot Test A")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  const idA = resA.body.claim.claimId;

  const resB = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Moot Test B")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB));
  const idB = resB.body.claim.claimId;

  // Terminally reject Claim B at Gram Sabha
  await request(app)
    .post(`/api/claims/${idB}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "reject", justification: "Claimant not resident of scheduled area." });

  // Check Claim A's conflict list: link to B should now be "moot"
  const confResA = await request(app).get(`/api/claims/${idA}/conflicts`).set("Authorization", `Bearer ${gsToken}`);
  const linkToB = confResA.body.conflicts.find((c) => c.otherClaimId === idB);
  assert.ok(linkToB);
  assert.strictEqual(linkToB.status, "moot");

  // Claim A can now be approved without manual resolution because the competing claim is moot!
  const approveA = await request(app)
    .post(`/api/claims/${idA}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "approve" });
  assert.strictEqual(approveA.status, 200);
});

test("11. Appeal revives a claim and re-runs detection", async () => {
  const pA = makePolygon(7.5);
  const pB = makeOverlappingPolygon(7.5);

  // Claim X and Claim Y compete
  const resX = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Appeal Revive X")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pA));
  const idX = resX.body.claim.claimId;

  const resY = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant3Token}`)
    .field("applicantName", "Appeal Revive Y")
    .field("village", "Kanker")
    .field("district", "Kanker")
    .field("state", "Chhattisgarh")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(pB));
  const idY = resY.body.claim.claimId;

  // Reject Claim Y at Gram Sabha
  await request(app)
    .post(`/api/claims/${idY}/decision`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ action: "reject", justification: "Insufficient initial documentation at Gram Sabha." });

  // Applicant 3 appeals Claim Y to SDLC
  const appealRes = await request(app)
    .post(`/api/my/claims/${idY}/appeal`)
    .set("Authorization", `Bearer ${applicant3Token}`)
    .send({ grounds: "Producing verified historical revenue maps and elder affidavits." });
  assert.strictEqual(appealRes.status, 200);
  assert.strictEqual(appealRes.body.claim.status, "Appealed");

  // Conflict detection re-ran on appeal: Claim X and Claim Y conflict is open again
  const confRes = await request(app).get(`/api/claims/${idX}/conflicts`).set("Authorization", `Bearer ${gsToken}`);
  const conflict = confRes.body.conflicts.find((c) => c.otherClaimId === idY);
  assert.ok(conflict);
  assert.strictEqual(conflict.status, "open", "Revived claim must restore open conflict");
});
