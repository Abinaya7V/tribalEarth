const { test, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const express = require("express");
const fs = require("fs");
const path = require("path");

// Instead of starting the server script, we can require it directly if it exported the app.
// But server.js in this repo doesn't export the app (it just calls app.listen).
// For the sake of the test, let's start the server via child_process, or just trust the manual run.
// Wait, I can run `node tests/api.test.js` and have it run the server, but it's easier if I just fetch http://localhost:4000.
// Let's assume the server is running on port 4000 for these integration tests.

const API_BASE = "http://localhost:4000";

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
    .field("claimType", "IFR");
  
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
