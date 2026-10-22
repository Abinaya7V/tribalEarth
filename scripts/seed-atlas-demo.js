#!/usr/bin/env node
/**
 * scripts/seed-atlas-demo.js
 *
 * Seeds a demo directory with claims.json (13 claims across 2 villages,
 * 11 polygons + 2 points, covering all statuses, conflict pair, proof documents).
 *
 * Refuses to run if argument missing or targets real server/data.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Helper to build rectangular polygon
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

// Create 2 small placeholder proof files
const sampleDoc1Content = "Sample Village Verification Record - TribalEarth AI Demo Proof Document A\n";
const sampleDoc1Name = "demo_proof_doc_1.txt";
const sampleDoc1Hash = crypto.createHash("sha256").update(sampleDoc1Content).digest("hex");

const sampleDoc2Content = "Sample Gram Sabha Resolution & Field Inspection Proof Document B\n";
const sampleDoc2Name = "demo_proof_doc_2.txt";
const sampleDoc2Hash = crypto.createHash("sha256").update(sampleDoc2Content).digest("hex");

function getDemoClaims(isoNow) {
  return [
  // 1. Submitted (Polygon) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO01",
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Birsa Munda (Demo)",
    guardianName: "Budhu Munda",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "North-west slope near sal grove",
    yearsOfCultivation: "15",
    occupationSinceYear: 2011,
    location: { lat: 23.350, lng: 85.310 },
    geometry: makeBoxPolygon(85.308, 23.348, 85.312, 23.352),
    computedAreaHa: 1.85,
    status: "Submitted",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [{
      originalName: "munda_residence_proof.txt",
      storedName: sampleDoc1Name,
      url: `/api/claims/FRA-2026-JH-DEMO01/documents/${sampleDoc1Name}`,
      sizeBytes: Buffer.byteLength(sampleDoc1Content),
      sha256: sampleDoc1Hash,
      confirmedCategory: null
    }],
    auditTrail: [{
      stage: "Gram Sabha",
      action: "Submitted",
      actor: "applicant1",
      note: "Claim filed online at Gram Sabha level.",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    }]
  },

  // 2. Under Review (Polygon, Map checked) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO02",
    ownerId: "applicant2",
    legacy: false,
    applicantName: "Somra Oraon (Demo)",
    guardianName: "Karma Oraon",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "East of central water pond",
    yearsOfCultivation: "22",
    occupationSinceYear: 2004,
    location: { lat: 23.355, lng: 85.315 },
    geometry: makeBoxPolygon(85.313, 23.353, 85.317, 23.357),
    computedAreaHa: 1.92,
    status: "Under Review",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    mapCheck: {
      officerConfirmed: true,
      confirmedBy: "Gram Sabha Officer",
      confirmedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      observation: "Boundary verified on satellite map during joint field visit."
    },
    conflicts: [],
    documents: [{
      originalName: "oraon_patta_receipt.txt",
      storedName: sampleDoc2Name,
      url: `/api/claims/FRA-2026-JH-DEMO02/documents/${sampleDoc2Name}`,
      sizeBytes: Buffer.byteLength(sampleDoc2Content),
      sha256: sampleDoc2Hash,
      confirmedCategory: "Government records / survey documents"
    }],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant2", note: "Initial filing.", timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
      { stage: "Gram Sabha", action: "Map Checked", actor: "Gram Sabha Officer", note: "Boundary verified.", timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 3. Approved (Polygon, Granted) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO03",
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Mangra Ho (Demo)",
    guardianName: "Jura Ho",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "CR",
    landDescription: "Community grazing parcel south of stream",
    yearsOfCultivation: "30",
    occupationSinceYear: 1995,
    location: { lat: 23.342, lng: 85.305 },
    geometry: makeBoxPolygon(85.303, 23.340, 85.307, 23.344),
    computedAreaHa: 2.10,
    status: "Approved",
    currentStage: "DLC",
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    mapCheck: { officerConfirmed: true, confirmedBy: "DLC Officer", confirmedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), observation: "Verified." },
    conflicts: [],
    documents: [{
      originalName: "ho_customary_record.txt",
      storedName: sampleDoc1Name,
      url: `/api/claims/FRA-2026-JH-DEMO03/documents/${sampleDoc1Name}`,
      sizeBytes: Buffer.byteLength(sampleDoc1Content),
      sha256: sampleDoc1Hash,
      confirmedCategory: "Elders testimony / customary proof"
    }],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant1", note: "Filing", timestamp: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "SDLC", action: "Approved & Forwarded", actor: "SDLC Officer", note: "Recommended", timestamp: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "DLC", action: "Approved", actor: "DLC Officer", note: "Title deed granted by District Level Committee.", timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 4. Escalated to DLC (Polygon) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO04",
    ownerId: "applicant3",
    legacy: false,
    applicantName: "Etwa Munda (Demo)",
    guardianName: "Lalu Munda",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Far western ridge bordering reserve forest",
    yearsOfCultivation: "18",
    occupationSinceYear: 2008,
    location: { lat: 23.345, lng: 85.295 },
    geometry: makeBoxPolygon(85.293, 23.343, 85.297, 23.347),
    computedAreaHa: 1.60,
    status: "Escalated to DLC",
    currentStage: "DLC",
    priorRejection: { stage: "SDLC", reason: "Contested forest department claim boundary; forwarded to DLC for final determination.", rejectedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant3", note: "Filing", timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "SDLC", action: "Rejected", actor: "SDLC Officer", note: "Contested forest boundary; escalated to DLC.", timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 5. Rejected (Polygon) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO05",
    ownerId: "applicant2",
    legacy: false,
    applicantName: "Dasrath Santhal (Demo)",
    guardianName: "Ganesh Santhal",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Southern parcel near highway embankment",
    yearsOfCultivation: "5",
    occupationSinceYear: 2021,
    location: { lat: 23.335, lng: 85.310 },
    geometry: makeBoxPolygon(85.308, 23.333, 85.312, 23.337),
    computedAreaHa: 1.45,
    status: "Rejected",
    currentStage: "Gram Sabha",
    rejection: { justification: "Occupation started after statutory cut-off date December 13, 2005.", rejectedAtStage: "Gram Sabha", timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant2", note: "Filing", timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "Gram Sabha", action: "Rejected", actor: "Gram Sabha Officer", note: "Occupation started after statutory cut-off date December 13, 2005.", timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 6. Appealed (Polygon) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO06",
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Budhram Kharia (Demo)",
    guardianName: "Jetha Kharia",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Hillock plot near old Mahua tree",
    yearsOfCultivation: "25",
    occupationSinceYear: 2001,
    location: { lat: 23.360, lng: 85.305 },
    geometry: makeBoxPolygon(85.303, 23.358, 85.307, 23.362),
    computedAreaHa: 1.75,
    status: "Appealed",
    currentStage: "SDLC",
    appeal: { grounds: "Historical cultivation proof from village elders was omitted during first meeting.", filedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), appellant: "applicant1" },
    createdAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant1", note: "Filing", timestamp: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "Gram Sabha", action: "Rejected", actor: "Gram Sabha Officer", note: "Initial rejection", timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "SDLC", action: "Appealed", actor: "applicant1", note: "Appeal filed to SDLC", timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 7 & 8: Deliberate Overlapping Pair (Disputed / Competing Conflict) - Salguda
  {
    claimId: "FRA-2026-JH-DEMO07",
    ownerId: "applicant2",
    legacy: false,
    applicantName: "Ramdas Bedia (Demo)",
    guardianName: "Shibu Bedia",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Plot adjoining north riverbank of Salguda stream",
    yearsOfCultivation: "20",
    occupationSinceYear: 2006,
    location: { lat: 23.380, lng: 85.340 },
    // Box 1: [85.338, 23.378, 85.343, 23.382]
    geometry: makeBoxPolygon(85.338, 23.378, 85.343, 23.382),
    computedAreaHa: 2.15,
    status: "Under Review",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [{
      conflictId: "CONF-DEMO-01",
      otherClaimId: "FRA-2026-JH-DEMO08",
      kind: "competing",
      reasons: ["SPATIAL_OVERLAP"],
      status: "open",
      detectedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      resolution: null
    }],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant2", note: "Filing", timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },
  {
    claimId: "FRA-2026-JH-DEMO08",
    ownerId: "applicant3",
    legacy: false,
    applicantName: "Sukhram Bedia (Demo)",
    guardianName: "Jadu Bedia",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Overlapping customary plot along north riverbank",
    yearsOfCultivation: "21",
    occupationSinceYear: 2005,
    location: { lat: 23.381, lng: 85.341 },
    // Box 2 overlaps Box 1: [85.340, 23.380, 85.345, 23.384]
    geometry: makeBoxPolygon(85.340, 23.380, 85.345, 23.384),
    computedAreaHa: 2.15,
    status: "Under Review",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [{
      conflictId: "CONF-DEMO-02",
      otherClaimId: "FRA-2026-JH-DEMO07",
      kind: "competing",
      reasons: ["SPATIAL_OVERLAP"],
      status: "open",
      detectedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      resolution: null
    }],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant3", note: "Filing", timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 9. Community Forest Resource (CFR Polygon) - Salguda
  {
    claimId: "FRA-2026-JH-DEMO09",
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Salguda Gram Sabha FRC",
    guardianName: "Gram Sabha Elders Committee",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "CFR",
    landDescription: "Community forest resource boundary encompassing sacred Sarna grove",
    yearsOfCultivation: "50",
    occupationSinceYear: 1974,
    location: { lat: 23.390, lng: 85.350 },
    geometry: makeBoxPolygon(85.346, 23.386, 85.354, 23.394),
    computedAreaHa: 7.50,
    status: "Approved",
    currentStage: "DLC",
    createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    mapCheck: { officerConfirmed: true, confirmedBy: "SDLC Officer", confirmedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), observation: "Sarna grove boundaries demarcated." },
    conflicts: [],
    documents: [{
      originalName: "sarna_cfr_management_plan.txt",
      storedName: sampleDoc2Name,
      url: `/api/claims/FRA-2026-JH-DEMO09/documents/${sampleDoc2Name}`,
      sizeBytes: Buffer.byteLength(sampleDoc2Content),
      sha256: sampleDoc2Hash,
      confirmedCategory: "Community Forest Resource management plan"
    }],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant1", note: "CFR filing.", timestamp: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "SDLC", action: "Approved & Forwarded", actor: "SDLC Officer", note: "Approved.", timestamp: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "DLC", action: "Approved", actor: "DLC Officer", note: "CFR title issued to Gram Sabha.", timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 10. Under Review (Polygon) - Salguda
  {
    claimId: "FRA-2026-JH-DEMO10",
    ownerId: "applicant2",
    legacy: false,
    applicantName: "Mani Asur (Demo)",
    guardianName: "Joga Asur",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Terraced upland plot east of Salguda school",
    yearsOfCultivation: "17",
    occupationSinceYear: 2009,
    location: { lat: 23.375, lng: 85.330 },
    geometry: makeBoxPolygon(85.328, 23.373, 85.332, 23.377),
    computedAreaHa: 1.55,
    status: "Under Review",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant2", note: "Filing.", timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 11. Newly created in last 5 minutes (Polygon, pulses with 'New' badge) - Salguda
  {
    claimId: "FRA-2026-JH-DEMO11",
    ownerId: "applicant3",
    legacy: false,
    applicantName: "Fulmani Birhor (Demo)",
    guardianName: "Bhim Birhor",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Newly submitted homestead plot near bamboo thicket",
    yearsOfCultivation: "12",
    occupationSinceYear: 2014,
    location: { lat: 23.385, lng: 85.335 },
    geometry: makeBoxPolygon(85.333, 23.383, 85.337, 23.387),
    computedAreaHa: 1.20,
    status: "Submitted",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), // 4 minutes ago
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant3", note: "Just filed.", timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString() }
    ]
  },

  // 12. Point feature (No polygon, pin only) - Salguda
  {
    claimId: "FRA-2026-JH-DEMO12",
    ownerId: "applicant1",
    legacy: false,
    applicantName: "Chaitu Mahli (Demo)",
    guardianName: "Bande Mahli",
    village: "Salguda",
    gramPanchayat: "Salguda GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Craft workshop and bamboo processing pin",
    yearsOfCultivation: "10",
    occupationSinceYear: 2016,
    location: { lat: 23.372, lng: 85.348 },
    geometry: null,
    computedAreaHa: null,
    status: "Under Review",
    currentStage: "Gram Sabha",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant1", note: "Filing.", timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  },

  // 13. Point feature (No polygon, pin only) - Gondgaon
  {
    claimId: "FRA-2026-JH-DEMO13",
    ownerId: "applicant2",
    legacy: false,
    applicantName: "Jagan Munda (Demo)",
    guardianName: "Sana Munda",
    village: "Gondgaon",
    gramPanchayat: "Gondgaon GP",
    district: "Ranchi",
    state: "Jharkhand",
    stateCode: "JH",
    claimType: "IFR",
    landDescription: "Upland orchard grove point location",
    yearsOfCultivation: "14",
    occupationSinceYear: 2012,
    location: { lat: 23.365, lng: 85.320 },
    geometry: null,
    computedAreaHa: null,
    status: "Approved",
    currentStage: "DLC",
    createdAt: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: isoNow,
    conflicts: [],
    documents: [],
    auditTrail: [
      { stage: "Gram Sabha", action: "Submitted", actor: "applicant2", note: "Filing", timestamp: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString() },
      { stage: "DLC", action: "Approved", actor: "DLC Officer", note: "Approved", timestamp: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString() }
    ]
  }
  ];
}

function seedDemo(dataDir, options = {}) {
  const { force = false, allowRealData = false } = options;
  if (!dataDir) {
    throw new Error("dataDir is required for seedDemo.");
  }

  const resolvedTarget = path.resolve(dataDir);
  const realDataDir = path.resolve(__dirname, "..", "server", "data");

  if (!allowRealData && resolvedTarget === realDataDir) {
    throw new Error("Refusing to run: target directory cannot be the real server/data directory!");
  }

  const targetClaimsFile = path.join(resolvedTarget, "claims.json");
  const targetUploadsDir = path.join(resolvedTarget, "uploads");

  if (fs.existsSync(targetClaimsFile) && !force) {
    const stat = fs.statSync(targetClaimsFile);
    if (stat.size > 0) {
      throw new Error(`Refusing to overwrite existing non-empty file: ${targetClaimsFile}. Use force to overwrite.`);
    }
  }

  fs.mkdirSync(resolvedTarget, { recursive: true });
  fs.mkdirSync(targetUploadsDir, { recursive: true });

  // Create 2 small placeholder proof files
  const sampleDoc1Content = "Sample Village Verification Record - TribalEarth AI Demo Proof Document A\n";
  const sampleDoc1Name = "demo_proof_doc_1.txt";
  const sampleDoc1Path = path.join(targetUploadsDir, sampleDoc1Name);
  fs.writeFileSync(sampleDoc1Path, sampleDoc1Content, "utf8");

  const sampleDoc2Content = "Sample Gram Sabha Resolution & Field Inspection Proof Document B\n";
  const sampleDoc2Name = "demo_proof_doc_2.txt";
  const sampleDoc2Path = path.join(targetUploadsDir, sampleDoc2Name);
  fs.writeFileSync(sampleDoc2Path, sampleDoc2Content, "utf8");

  const isoNow = new Date().toISOString();
  const demoClaims = getDemoClaims(isoNow);

  fs.writeFileSync(targetClaimsFile, JSON.stringify(demoClaims, null, 2), "utf8");

  return {
    claimsCount: demoClaims.length,
    claimsFile: targetClaimsFile,
    uploadsDir: targetUploadsDir,
  };
}

module.exports = { seedDemo };

if (require.main === module) {
  const targetDir = process.argv[2];
  const force = process.argv.includes("--force");

  if (!targetDir) {
    console.error("Error: target directory argument is required.");
    console.error("Usage: node scripts/seed-atlas-demo.js <target_dir> [--force]");
    process.exit(1);
  }

  try {
    const res = seedDemo(targetDir, { force });
    const resolvedTarget = path.resolve(targetDir);
    console.log(`[seed-atlas-demo] Successfully seeded ${res.claimsCount} demo claims to: ${res.claimsFile}`);
    console.log(`[seed-atlas-demo] Created sample proof uploads in: ${res.uploadsDir}`);
    console.log("\nTo start the server using this demo dataset, run:");
    console.log(`  $env:DATA_DIR="${resolvedTarget}"; node server.js`);
    console.log("or in bash / macOS / Linux:");
    console.log(`  DATA_DIR="${resolvedTarget}" node server.js\n`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
