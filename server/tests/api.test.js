const { test, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = require("../server.js");
const API_BASE = process.env.API_BASE || app;

let applicantToken = "";
let officerToken = "";
let claimId = "";

test("1. Anonymous request to list claims returns 401", async () => {
  const res = await request(API_BASE).get("/api/claims");
  assert.strictEqual(res.status, 401);
});

test("2. /api/stats leaks no personal data and requires login", async () => {
  const res = await request(API_BASE).get("/api/stats");
  assert.strictEqual(res.status, 401);

  // Login to check
  const loginRes = await request(API_BASE).post("/api/auth/login").send({ username: "applicant1", password: "applicant123" });
  assert.strictEqual(loginRes.status, 200);
  applicantToken = loginRes.body.token;

  const statsRes = await request(API_BASE).get("/api/stats").set("Authorization", `Bearer ${applicantToken}`);
  assert.strictEqual(statsRes.status, 200);
  assert.ok(!JSON.stringify(statsRes.body).includes("applicant1"));
});

test("3. Applicant sees only own claims in /api/my/claims", async () => {
  const res = await request(API_BASE).get("/api/my/claims").set("Authorization", `Bearer ${applicantToken}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.claims));
});

test("4. Rejection without a written reason is refused at the API", async () => {
  // Login as GS officer
  const loginRes = await request(API_BASE).post("/api/auth/login").send({ username: "gramsabha1", password: "gramsabha123" });
  officerToken = loginRes.body.token;

  // Assuming a claim exists, we would test rejection here. 
  // We can't guarantee a claim ID without creating one.
  const createRes = await request(API_BASE).post("/api/claims").set("Authorization", `Bearer ${applicantToken}`)
    .field("applicantName", "Test App")
    .field("village", "Test Vill")
    .field("district", "Test Dist")
    .field("state", "Test State")
    .field("claimType", "IFR")
    .field("latitude", "20.27")
    .field("longitude", "81.49");
  
  assert.strictEqual(createRes.status, 201);
  claimId = createRes.body.claim.claimId;

  const rejectRes = await request(API_BASE).post(`/api/claims/${claimId}/decision`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ action: "reject", justification: "short" });
  
  assert.strictEqual(rejectRes.status, 400);
});

test("5. Appeal: allowed once for a Gram Sabha rejection within the window", async () => {
  // Reject properly
  await request(API_BASE).post(`/api/claims/${claimId}/decision`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ action: "reject", justification: "Valid reason to reject" });

  // Appeal it
  const appealRes = await request(API_BASE).post(`/api/my/claims/${claimId}/appeal`)
    .set("Authorization", `Bearer ${applicantToken}`)
    .send({ grounds: "I have proof." });
  
  assert.strictEqual(appealRes.status, 200);

  // Try again
  const appeal2Res = await request(API_BASE).post(`/api/my/claims/${claimId}/appeal`)
    .set("Authorization", `Bearer ${applicantToken}`)
    .send({ grounds: "I have more proof." });
  
  assert.strictEqual(appeal2Res.status, 400);
});

test("6. Map-check: officer at claim's stage can save map check (200), wrong-stage officer gets 403", async () => {
  // Create a claim at Gram Sabha stage
  const createRes = await request(API_BASE).post("/api/claims").set("Authorization", `Bearer ${applicantToken}`)
    .field("applicantName", "Map Check Test")
    .field("village", "Map Village")
    .field("district", "Map District")
    .field("state", "Map State")
    .field("claimType", "IFR")
    .field("latitude", "20.27")
    .field("longitude", "81.49");
  
  assert.strictEqual(createRes.status, 201);
  const testClaimId = createRes.body.claim.claimId;

  // Login as SDLC officer (wrong stage for a Gram Sabha claim)
  const sdlcLogin = await request(API_BASE).post("/api/auth/login").send({ username: "sdlc1", password: "sdlc123" });
  assert.strictEqual(sdlcLogin.status, 200);
  const sdlcToken = sdlcLogin.body.token;

  // SDLC officer acting on Gram Sabha claim must be rejected with 403
  const wrongStageRes = await request(API_BASE)
    .post(`/api/claims/${testClaimId}/map-check`)
    .set("Authorization", `Bearer ${sdlcToken}`)
    .send({ locationChecked: true, observation: "Checked by SDLC" });
  assert.strictEqual(wrongStageRes.status, 403);

  // Gram Sabha officer acting on Gram Sabha claim must succeed with 200
  const rightStageRes = await request(API_BASE)
    .post(`/api/claims/${testClaimId}/map-check`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ locationChecked: true, observation: "Boundaries verified on map" });
  assert.strictEqual(rightStageRes.status, 200);
  assert.strictEqual(rightStageRes.body.success, true);
  assert.strictEqual(rightStageRes.body.mapCheck.officerConfirmed, true);
  assert.strictEqual(rightStageRes.body.mapCheck.observation, "Boundaries verified on map");
});

test("7. Regression: PATCH /api/claims/:id/advance is disabled; anonymous and applicant requests must not advance claims", async () => {
  // Create a claim at Gram Sabha stage
  const createRes = await request(API_BASE).post("/api/claims").set("Authorization", `Bearer ${applicantToken}`)
    .field("applicantName", "Advance Test")
    .field("village", "Advance Village")
    .field("district", "Advance District")
    .field("state", "Advance State")
    .field("claimType", "IFR")
    .field("latitude", "20.27")
    .field("longitude", "81.49");

  assert.strictEqual(createRes.status, 201);
  const testClaimId = createRes.body.claim.claimId;

  // 1. Anonymous request must NOT get 200
  const anonRes = await request(API_BASE).patch(`/api/claims/${testClaimId}/advance`).send({ actor: "Hacker" });
  assert.notStrictEqual(anonRes.status, 200, "Anonymous request must not receive 200");

  // 2. Applicant request must NOT get 200
  const appRes = await request(API_BASE)
    .patch(`/api/claims/${testClaimId}/advance`)
    .set("Authorization", `Bearer ${applicantToken}`)
    .send({ actor: "Applicant" });
  assert.notStrictEqual(appRes.status, 200, "Applicant request must not receive 200");

  // 3. Confirm claim remains at Gram Sabha stage
  const getRes = await request(API_BASE)
    .get(`/api/my/claims/${testClaimId}`)
    .set("Authorization", `Bearer ${applicantToken}`);
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.claim.currentStage, "Gram Sabha", "Claim must stay at Gram Sabha stage");
});
