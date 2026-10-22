/**
 * TribalEarth AI — role-based authentication (Module 3 follow-up)
 * ------------------------------------------------------------
 * HONESTY CONTRACT: this is a real, working login system with
 * properly hashed passwords (scrypt, per-user random salt, never
 * plaintext) and server-verified session tokens — it is NOT a
 * cosmetic role picker. Every officials/gram-sabha action in
 * server.js is authorized against the session this file issues,
 * not against whatever a client claims to be.
 *
 * WHAT THIS IS NOT: a production identity system. There is no
 * account registration, no password reset, no persistence of
 * sessions across a server restart (they're held in memory), and
 * the four demo accounts below are exactly that — demo accounts,
 * documented in README.md, meant to demonstrate that Applicant /
 * Gram Sabha / SDLC / DLC are genuinely separate, access-controlled
 * roles. A real deployment would replace this file with proper
 * user management (a database, registration flow, password reset,
 * persistent sessions) without changing the shape of the
 * middleware that consumes it.
 *
 * Demo credentials (also in README.md):
 *   applicant1 / applicant123   (role: applicant)
 *   gramsabha1 / gramsabha123   (role: gram_sabha)
 *   sdlc1      / sdlc123        (role: sdlc)
 *   dlc1       / dlc123         (role: dlc)
 */

const crypto = require("crypto");

const ROLES = ["applicant", "gram_sabha", "sdlc", "dlc"];

// Maps each pipeline stage to the role authorized to act on it.
const STAGE_ROLE = {
  "Gram Sabha": "gram_sabha",
  SDLC: "sdlc",
  DLC: "dlc",
};

// Password hashes generated once via: crypto.scryptSync(password, salt, 64)
// Format: "<salt-hex>:<hash-hex>". Never store plaintext, even for demo
// accounts — there's no reason to build the sloppy habit into the code.
const DEMO_USERS = [
  {
    username: "applicant1",
    role: "applicant",
    displayName: "Demo Applicant",
    passwordHash:
      "2b49c528e93278ecff0360bdc3053142:76bea95e372542dc7633f5a8bdf12f827e44e7c8a63a5530e60d5572fa0b69797df5a6f1e29d3da45df31e7e0ccebd3f791c3804138a312cb08e9062011508de",
  },
  {
    username: "applicant2",
    role: "applicant",
    displayName: "Demo Applicant 2",
    passwordHash:
      "4546e40465b022870ef1a827f5f71c8d:9bd30ac6a636e0338e00a9ffe61ebd4f8efda11c11e7ae4c9e67391e5d0fd5f5ba8291a719c964dbc03d4388d0d76c94d8eafc454a1b00f8f9f1ab2d14042673",
  },
  {
    username: "applicant3",
    role: "applicant",
    displayName: "Demo Applicant 3",
    passwordHash:
      "e937ed5f77c593c7a2859a9246d844f4:7333ac64d1e46a56bce9a07282e63477315023141deca2261346752f2b4d59183a93d9ebde88fdc2ad9445982cd60f2a147b5ecd38ee5129a85b811d36cafc88",
  },
  {
    username: "gramsabha1",
    role: "gram_sabha",
    displayName: "Gram Sabha Officer",
    // Demo simplification: null means all jurisdictions. In production this would be set to a specific state/district.
    jurisdiction: { state: null, district: null },
    passwordHash:
      "e15fc53618bde3b38158d2e81abd6044:25f31bc786ed12108facb263897e3fde717f78fba169795147e6a021752538c3d1d3d3a8f9b00e454ce943e32b67ac2125ab553ae4a455b84b641a99f6e6ccd5",
  },
  {
    username: "sdlc1",
    role: "sdlc",
    displayName: "SDLC Officer",
    // Demo simplification: null means all jurisdictions.
    jurisdiction: { state: null, district: null },
    passwordHash:
      "56f78a1b6ffdc02b2c80beddf964f8d4:fd5d6923508896cea221adcd78875cddaae124db7d5ba3e39ee9978e29374e7a55794e14ba1bae0cb46bd3d2b65ce714c4d34cc11b7d67025e3791533196bbd2",
  },
  {
    username: "dlc1",
    role: "dlc",
    displayName: "DLC Officer",
    // Demo simplification: null means all jurisdictions.
    jurisdiction: { state: null, district: null },
    passwordHash:
      "8575acb9eb3c4f54ae21f0597489dce7:af2d18206daf0fe5c92a8577dfdb2d15a5d0cf7272a99c85cc056894e4c6bf76d3a6507a4ff987c523b877248b34e68bc276998c67c65e60b3115cd19c6c90d7",
  },
];

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  // Constant-time comparison — avoids leaking hash-match timing info.
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(derived, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** In-memory session store. Cleared on server restart — sessions are
 * meant to last a working session, not survive a redeploy. */
const sessions = new Map(); // token -> { username, role, displayName, createdAt }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function login(username, password) {
  const user = DEMO_USERS.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    jurisdiction: user.jurisdiction || null,
    createdAt: Date.now(),
  });
  return { token, role: user.role, displayName: user.displayName, jurisdiction: user.jurisdiction || null };
}

function logout(token) {
  sessions.delete(token);
}

/** Returns the session for a token, or null if missing/expired. */
function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

module.exports = { ROLES, STAGE_ROLE, login, logout, getSession };
