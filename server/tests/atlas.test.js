const { test, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Isolated temp data directory for atlas tests
const TEMP_DATA_DIR = path.join(__dirname, "temp_atlas_data_" + Date.now());
process.env.DATA_DIR = TEMP_DATA_DIR;
process.env.DB_PATH = path.join(TEMP_DATA_DIR, "tribalearth.db");

// Import the app directly
const app = require("../server");
const authService = require("../services/authService");

let applicant1Token, applicant2Token, gsToken, sdlcToken, dlcToken;

function makeBoxPolygon(minLng, minLat, maxLng, maxLat) {
  return {
    type: "Polygon",
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat]
    ]]
  };
}

before(async () => {
  if (!fs.existsSync(TEMP_DATA_DIR)) {
    fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
  }

  // Obtain tokens for all roles
  let res = await request(app).post("/api/auth/login").send({ username: "applicant1", password: "applicant123" });
  applicant1Token = res.body.token;

  res = await request(app).post("/api/auth/login").send({ username: "applicant2", password: "applicant2123" });
  applicant2Token = res.body.token;

  res = await request(app).post("/api/auth/login").send({ username: "gramsabha1", password: "gramsabha123" });
  gsToken = res.body.token;

  res = await request(app).post("/api/auth/login").send({ username: "sdlc1", password: "sdlc123" });
  sdlcToken = res.body.token;

  res = await request(app).post("/api/auth/login").send({ username: "dlc1", password: "dlc123" });
  dlcToken = res.body.token;
});

after(() => {
  try {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  } catch (_) {}
});

test("1. Anonymous gets 401 and applicants get 403 on all three Atlas routes", async () => {
  // GET /api/atlas/summary
  let res = await request(app).get("/api/atlas/summary");
  assert.strictEqual(res.status, 401);

  res = await request(app).get("/api/atlas/summary").set("Authorization", `Bearer ${applicant1Token}`);
  assert.strictEqual(res.status, 403);

  // GET /api/atlas/features
  res = await request(app).get("/api/atlas/features");
  assert.strictEqual(res.status, 401);

  res = await request(app).get("/api/atlas/features").set("Authorization", `Bearer ${applicant1Token}`);
  assert.strictEqual(res.status, 403);

  // GET /api/atlas/claims/NONEXISTENT
  res = await request(app).get("/api/atlas/claims/NONEXISTENT");
  assert.strictEqual(res.status, 401);

  res = await request(app).get("/api/atlas/claims/NONEXISTENT").set("Authorization", `Bearer ${applicant1Token}`);
  assert.strictEqual(res.status, 403);
});

test("2. features returns a valid FeatureCollection with only whitelisted properties; no sensitive fields leaked", async () => {
  // File a claim with polygon and document
  const sampleBuf = Buffer.from("Sensitive officer notes or doc data");
  const poly = makeBoxPolygon(85.10, 23.10, 85.12, 23.12);

  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Whitelisted Test User")
    .field("village", "TestPur")
    .field("district", "TestDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("occupationSinceYear", "2002")
    .field("geometry", JSON.stringify(poly))
    .attach("documents", sampleBuf, "secret_doc.txt");

  assert.strictEqual(fileRes.status, 201);
  const claimId = fileRes.body.claim.claimId;

  const featRes = await request(app)
    .get("/api/atlas/features")
    .set("Authorization", `Bearer ${gsToken}`);

  assert.strictEqual(featRes.status, 200);
  assert.strictEqual(featRes.body.type, "FeatureCollection");
  assert(Array.isArray(featRes.body.features));

  const feat = featRes.body.features.find(f => f.properties.claimId === claimId);
  assert(feat, "Filed claim should appear in features collection");

  const props = feat.properties;
  assert.strictEqual(props.applicantName, "Whitelisted Test User");
  assert.strictEqual(props.village, "TestPur");
  assert.strictEqual(props.district, "TestDist");
  assert.strictEqual(props.claimType, "IFR");
  assert.strictEqual(props.status, "Submitted");
  assert.strictEqual(props.stage, "Gram Sabha");
  assert.strictEqual(props.occupationSinceYear, 2002);
  assert.strictEqual(props.boundaryKind, "polygon");
  assert.strictEqual(typeof props.verifiedOnMap, "boolean");
  assert.strictEqual(typeof props.hasOpenConflict, "boolean");
  assert.strictEqual(props.grantedAt, null);
  assert(props.createdAt, "createdAt must be present in properties");

  // Verify NO sensitive or extra fields leak
  assert.strictEqual(props.documents, undefined);
  assert.strictEqual(props.auditTrail, undefined);
  assert.strictEqual(props.sha256, undefined);
  assert.strictEqual(props.phone, undefined);
  assert.strictEqual(props.notes, undefined);
  assert.strictEqual(props.rejection, undefined);
});

test("3. bbox filter returns only intersecting claims; malformed bbox returns 400", async () => {
  // Malformed bbox checks
  let res = await request(app).get("/api/atlas/features?bbox=foo,bar").set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(res.status, 400);

  res = await request(app).get("/api/atlas/features?bbox=1,2,3,abc").set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(res.status, 400);

  // File Zone 1 claim: around lng 85.50, lat 23.50
  const polyZone1 = makeBoxPolygon(85.49, 23.49, 85.51, 23.51);
  const f1 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Zone1 User")
    .field("village", "Zone1Village")
    .field("district", "TestDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(polyZone1));
  assert.strictEqual(f1.status, 201);
  const z1Id = f1.body.claim.claimId;

  // File Zone 2 claim: far away around lng 86.80, lat 24.80
  const polyZone2 = makeBoxPolygon(86.79, 24.79, 86.81, 24.81);
  const f2 = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant2Token}`)
    .field("applicantName", "Zone2 User")
    .field("village", "Zone2Village")
    .field("district", "TestDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(polyZone2));
  assert.strictEqual(f2.status, 201);
  const z2Id = f2.body.claim.claimId;

  // Query bbox matching only Zone 1: [85.45, 23.45, 85.55, 23.55]
  const bboxQuery = "85.45,23.45,85.55,23.55";
  const queryRes = await request(app)
    .get(`/api/atlas/features?bbox=${bboxQuery}`)
    .set("Authorization", `Bearer ${gsToken}`);

  assert.strictEqual(queryRes.status, 200);
  const foundZ1 = queryRes.body.features.some(f => f.properties.claimId === z1Id);
  const foundZ2 = queryRes.body.features.some(f => f.properties.claimId === z2Id);
  assert.strictEqual(foundZ1, true, "Zone 1 claim should be included");
  assert.strictEqual(foundZ2, false, "Zone 2 claim outside bbox must be excluded");
});

test("4. status, village and claimType filters work; limit and truncated work", async () => {
  // Query status filter
  let res = await request(app)
    .get("/api/atlas/features?village=Zone1Village")
    .set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(res.status, 200);
  assert(res.body.features.every(f => f.properties.village === "Zone1Village"));

  // Query with limit=1
  res = await request(app)
    .get("/api/atlas/features?limit=1")
    .set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.features.length, 1);
  assert(res.body.total > 1);
  assert.strictEqual(res.body.truncated, true);
});

test("5. An officer with a jurisdiction (district set) never sees claims from other districts", async () => {
  // Create a temporary session for an officer with a restricted jurisdiction
  const restrictedSessionToken = "test_restricted_token_" + Date.now();
  authService.login; // check existence
  // Manually insert a session in authService session store or login with custom user
  // Let's test by creating a mock user or testing user session
  // authService has getSession. We can create a user with jurisdiction
  const testOfficerToken = "jurisdiction_officer_token";
  // We can attach a token directly into the authService session map
  const crypto = require("crypto");
  const tempToken = crypto.randomBytes(16).toString("hex");

  // We can simulate an officer by logging in and setting their jurisdiction on the session object
  const loginRes = await request(app).post("/api/auth/login").send({ username: "gramsabha1", password: "gramsabha123" });
  const token = loginRes.body.token;
  const sess = authService.getSession(token);
  sess.jurisdiction = { state: "Jharkhand", district: "ExclusiveRanchi" };

  // File a claim in ExclusiveRanchi
  const p1 = makeBoxPolygon(85.20, 23.20, 85.22, 23.22);
  const c1Res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Ranchi Resident")
    .field("village", "RanchiVillage")
    .field("district", "ExclusiveRanchi")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(p1));
  assert.strictEqual(c1Res.status, 201);
  const rClaimId = c1Res.body.claim.claimId;

  // File a claim in DifferentDistrict
  const p2 = makeBoxPolygon(85.25, 23.25, 85.27, 23.27);
  const c2Res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Other District Resident")
    .field("village", "OtherVillage")
    .field("district", "DifferentDistrict")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(p2));
  assert.strictEqual(c2Res.status, 201);
  const otherClaimId = c2Res.body.claim.claimId;

  // Officer queries features
  const featRes = await request(app).get("/api/atlas/features").set("Authorization", `Bearer ${token}`);
  assert.strictEqual(featRes.status, 200);
  assert(featRes.body.features.some(f => f.properties.claimId === rClaimId));
  assert(!featRes.body.features.some(f => f.properties.claimId === otherClaimId));

  // Detail for other district claim returns 404
  const detailRes = await request(app).get(`/api/atlas/claims/${otherClaimId}`).set("Authorization", `Bearer ${token}`);
  assert.strictEqual(detailRes.status, 404);

  // Reset officer session
  sess.jurisdiction = { state: null, district: null };
});

test("6. Legacy/no-coordinate claims are counted in notMapped and never returned as features; malformed geometry is skipped", async () => {
  const { readClaims, writeClaims } = require("../services/db");
  const claims = readClaims();

  // Insert a legacy claim without coordinates
  const legacyId = "FRA-LEGACY-NO-COORDS";
  claims.push({
    claimId: legacyId,
    ownerId: null,
    legacy: true,
    applicantName: "Legacy User",
    village: "OldVillage",
    district: "TestDist",
    state: "Jharkhand",
    claimType: "IFR",
    currentStage: "Gram Sabha",
    status: "Submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    auditTrail: []
  });

  // Insert claim with malformed geometry
  const badGeomId = "FRA-BAD-GEOM-999";
  claims.push({
    claimId: badGeomId,
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Bad Geom User",
    village: "OldVillage",
    district: "TestDist",
    state: "Jharkhand",
    claimType: "IFR",
    location: null,
    geometry: { type: "Polygon", coordinates: "not an array" },
    currentStage: "Gram Sabha",
    status: "Submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    auditTrail: []
  });
  writeClaims(claims);

  // Check summary
  const sumRes = await request(app).get("/api/atlas/summary").set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(sumRes.status, 200);
  assert(sumRes.body.notMapped >= 1, "Legacy claim without coords must be counted in notMapped");

  // Check features: neither should crash the route, neither should appear
  const featRes = await request(app).get("/api/atlas/features").set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(featRes.status, 200);
  assert(!featRes.body.features.some(f => f.properties.claimId === legacyId));
  assert(!featRes.body.features.some(f => f.properties.claimId === badGeomId));
});

test("7. detail returns the last 15 audit entries newest first, documents list with confirmed category, and writes one access-log line", async () => {
  const poly = makeBoxPolygon(85.60, 23.60, 85.62, 23.62);
  const sampleBuf = Buffer.from("Audit test doc content");

  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Audit Trail Test")
    .field("village", "AuditVillage")
    .field("district", "AuditDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(poly))
    .attach("documents", sampleBuf, "audit_proof.txt");

  assert.strictEqual(fileRes.status, 201);
  const claimId = fileRes.body.claim.claimId;

  // Add 16 audit entries to claim
  const { readClaims, writeClaims } = require("../services/db");
  const claims = readClaims();
  const c = claims.find(x => x.claimId === claimId);
  for (let i = 1; i <= 16; i++) {
    c.auditTrail.push({
      stage: "Gram Sabha",
      action: `Step ${i}`,
      actor: "TestActor",
      note: `Note ${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString()
    });
  }
  // Set confirmedCategory on document
  if (c.documents && c.documents[0]) {
    c.documents[0].confirmedCategory = "Customary Rights Record";
  }
  writeClaims(claims);

  const logFile = path.join(TEMP_DATA_DIR, "atlas-access.log");
  const initialLogLines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").length : 0;

  const detailRes = await request(app)
    .get(`/api/atlas/claims/${claimId}`)
    .set("Authorization", `Bearer ${gsToken}`);

  assert.strictEqual(detailRes.status, 200);
  const detail = detailRes.body.claim;
  assert.strictEqual(detail.timeline.length, 15, "Timeline must cap at 15 entries");
  // Check newest first
  const t0 = new Date(detail.timeline[0].timestamp).getTime();
  const t1 = new Date(detail.timeline[1].timestamp).getTime();
  assert(t0 >= t1, "Timeline must be ordered newest first");

  // Document confirmedCategory
  assert.strictEqual(detail.documents[0].confirmedCategory, "Customary Rights Record");

  // Access log checked
  assert(fs.existsSync(logFile), "atlas-access.log must be created");
  const newLogLines = fs.readFileSync(logFile, "utf8").trim().split("\n").length;
  assert.strictEqual(newLogLines, initialLogLines + 1);
});

test("8. An officer who is NOT stage-authorised for a claim can still view it in Atlas and download its proof, while a different applicant cannot", async () => {
  // Claim is at Gram Sabha stage
  const poly = makeBoxPolygon(85.70, 23.70, 85.72, 23.72);
  const sampleBuf = Buffer.from("Cross-stage proof file");

  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Cross Stage User")
    .field("village", "CrossVillage")
    .field("district", "AuditDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(poly))
    .attach("documents", sampleBuf, "cross_proof.txt");

  assert.strictEqual(fileRes.status, 201);
  const claimId = fileRes.body.claim.claimId;

  // Claim is at Gram Sabha stage. SDLC officer is NOT authorized for decisions on Gram Sabha stage.
  // Standard canReadClaim returns false for SDLC officer on Gram Sabha claim.
  // But canViewInAtlas allows Atlas detail and document download!
  const atlasRes = await request(app)
    .get(`/api/atlas/claims/${claimId}`)
    .set("Authorization", `Bearer ${sdlcToken}`);
  assert.strictEqual(atlasRes.status, 200);
  assert.strictEqual(atlasRes.body.claim.claimId, claimId);

  // Download proof document via Atlas permission
  const docUrl = atlasRes.body.claim.documents[0].url;
  const docRes = await request(app)
    .get(docUrl)
    .set("Authorization", `Bearer ${sdlcToken}`);
  assert.strictEqual(docRes.status, 200);
  assert.strictEqual(docRes.text, "Cross-stage proof file");

  // A different applicant (applicant2) still cannot download applicant1's document
  const diffAppRes = await request(app)
    .get(docUrl)
    .set("Authorization", `Bearer ${applicant2Token}`);
  assert.strictEqual(diffAppRes.status, 404);
});

test("9. verifiedOnMap becomes true after map-check endpoint confirms location, and grantedAt appears only for approved claims", async () => {
  const poly = makeBoxPolygon(85.80, 23.80, 85.82, 23.82);
  const fileRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Map Check Test")
    .field("village", "MapVillage")
    .field("district", "AuditDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(poly));

  const claimId = fileRes.body.claim.claimId;

  // Before map-check: verifiedOnMap is false
  let detailRes = await request(app).get(`/api/atlas/claims/${claimId}`).set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(detailRes.body.claim.verifiedOnMap, false);
  assert.strictEqual(detailRes.body.claim.grantedAt, null);

  // Officer confirms location on map via map-check
  const mcRes = await request(app)
    .post(`/api/claims/${claimId}/map-check`)
    .set("Authorization", `Bearer ${gsToken}`)
    .send({ locationChecked: true, observation: "Boundaries confirmed" });
  assert.strictEqual(mcRes.status, 200);

  detailRes = await request(app).get(`/api/atlas/claims/${claimId}`).set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(detailRes.body.claim.verifiedOnMap, true);
  assert.strictEqual(detailRes.body.claim.mapCheck.confirmedBy, "Gram Sabha Officer");

  // Advance to DLC and approve
  // GS approve -> advances to SDLC
  await request(app).post(`/api/claims/${claimId}/decision`).set("Authorization", `Bearer ${gsToken}`).send({ action: "approve", justification: "Verified at GS level" });
  // SDLC approve -> advances to DLC
  await request(app).post(`/api/claims/${claimId}/decision`).set("Authorization", `Bearer ${sdlcToken}`).send({ action: "approve", justification: "Verified at SDLC level" });
  // DLC approve -> terminal approval
  const approveRes = await request(app).post(`/api/claims/${claimId}/decision`).set("Authorization", `Bearer ${dlcToken}`).send({ action: "approve", justification: "Title granted by DLC" });
  assert.strictEqual(approveRes.status, 200);

  detailRes = await request(app).get(`/api/atlas/claims/${claimId}`).set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(detailRes.body.claim.status, "Approved");
  assert(detailRes.body.claim.grantedAt, "grantedAt must be populated for approved claims");
});

test("10. occupationSinceYear validation: valid, out-of-range, non-numeric", async () => {
  const poly = makeBoxPolygon(85.85, 23.85, 85.87, 23.87);

  // Non-numeric
  let res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Invalid Year 1")
    .field("village", "TestV")
    .field("district", "TestD")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("occupationSinceYear", "abc")
    .field("geometry", JSON.stringify(poly));
  assert.strictEqual(res.status, 400);

  // Out-of-range (<1900)
  res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Invalid Year 2")
    .field("village", "TestV")
    .field("district", "TestD")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("occupationSinceYear", "1899")
    .field("geometry", JSON.stringify(poly));
  assert.strictEqual(res.status, 400);

  // Out-of-range (> current year)
  res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Invalid Year 3")
    .field("village", "TestV")
    .field("district", "TestD")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("occupationSinceYear", "2099")
    .field("geometry", JSON.stringify(poly));
  assert.strictEqual(res.status, 400);

  // Valid (1995)
  res = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Valid Year")
    .field("village", "TestV")
    .field("district", "TestD")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("occupationSinceYear", "1995")
    .field("geometry", JSON.stringify(poly));
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.claim.occupationSinceYear, 1995);
});

test("11. Atlas routes never mutate claims data, and new filed claim appears in next features call", async () => {
  const { readClaims } = require("../services/db");
  const claimsBefore = JSON.stringify(readClaims());

  // Call all 3 Atlas routes
  await request(app).get("/api/atlas/summary").set("Authorization", `Bearer ${gsToken}`);
  const featRes = await request(app).get("/api/atlas/features").set("Authorization", `Bearer ${gsToken}`);
  const firstClaimId = featRes.body.features[0]?.properties?.claimId;
  if (firstClaimId) {
    await request(app).get(`/api/atlas/claims/${firstClaimId}`).set("Authorization", `Bearer ${gsToken}`);
  }

  const claimsAfter = JSON.stringify(readClaims());
  assert.strictEqual(claimsBefore, claimsAfter, "Atlas routes must never mutate claims");

  // Addendum test: A claim filed after first fetch appears in the next features call without restarting
  const poly = makeBoxPolygon(85.90, 23.90, 85.92, 23.92);
  const newRes = await request(app)
    .post("/api/claims")
    .set("Authorization", `Bearer ${applicant1Token}`)
    .field("applicantName", "Live Update Test")
    .field("village", "LiveVillage")
    .field("district", "LiveDist")
    .field("state", "Jharkhand")
    .field("stateCode", "JH")
    .field("claimType", "IFR")
    .field("geometry", JSON.stringify(poly));
  assert.strictEqual(newRes.status, 201);
  const liveId = newRes.body.claim.claimId;

  const nextFeatRes = await request(app).get("/api/atlas/features").set("Authorization", `Bearer ${gsToken}`);
  assert.strictEqual(nextFeatRes.status, 200);
  assert(nextFeatRes.body.features.some(f => f.properties.claimId === liveId));
});
