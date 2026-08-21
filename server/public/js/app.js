/**
 * TribalEarth AI — Module 1 frontend
 * Talks to the local Express API (same origin, no build step required).
 */

const API_BASE = "/api";

/* ---------------- tabs ---------------- */
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");

    const target = btn.dataset.tab;
    tabPanels.forEach((p) => p.classList.remove("is-active"));
    document.getElementById(`tab-${target}`).classList.add("is-active");

    if (target === "register") loadClaims();
  });
});

/* ---------------- multi-step form ---------------- */
const TOTAL_STEPS = 4;
let currentStep = 1;
let selectedFiles = [];

const stepEls = document.querySelectorAll(".form-step");
const stepperItems = document.querySelectorAll(".step");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const submitBtn = document.getElementById("submitBtn");
const formMsg = document.getElementById("formMsg");
const claimForm = document.getElementById("claimForm");

function renderStep() {
  stepEls.forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.step) === currentStep);
  });
  stepperItems.forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.toggle("is-active", s === currentStep);
    el.classList.toggle("is-complete", s < currentStep);
  });
  prevBtn.disabled = currentStep === 1;
  nextBtn.classList.toggle("is-hidden", currentStep === TOTAL_STEPS);
  submitBtn.classList.toggle("is-hidden", currentStep !== TOTAL_STEPS);
  formMsg.textContent = "";
  if (currentStep === TOTAL_STEPS) buildReview();
}

function validateStep(step) {
  if (step === 1) {
    const required = ["applicantName", "village", "district", "state"];
    for (const name of required) {
      const el = claimForm.elements[name];
      if (!el.value.trim()) {
        formMsg.textContent = `Please fill in "${el.previousElementSibling?.textContent || name}".`;
        el.focus();
        return false;
      }
    }
  }
  if (step === 2) {
    const claimType = claimForm.querySelector('input[name="claimType"]:checked');
    if (!claimType) {
      formMsg.textContent = "Please select a claim type — IFR, CR, or CFR.";
      return false;
    }
  }
  return true;
}

nextBtn.addEventListener("click", () => {
  if (!validateStep(currentStep)) return;
  if (currentStep < TOTAL_STEPS) {
    currentStep += 1;
    renderStep();
  }
});
prevBtn.addEventListener("click", () => {
  if (currentStep > 1) {
    currentStep -= 1;
    renderStep();
  }
});

/* ---------------- file handling ---------------- */
const dropzone = document.getElementById("dropzone");
const documentsInput = document.getElementById("documents");
const fileListEl = document.getElementById("fileList");

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-drag");
  })
);
dropzone.addEventListener("drop", (e) => {
  addFiles(e.dataTransfer.files);
});
documentsInput.addEventListener("change", (e) => addFiles(e.target.files));

function addFiles(fileList) {
  Array.from(fileList).forEach((f) => {
    if (selectedFiles.length >= 6) return;
    selectedFiles.push(f);
  });
  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  selectedFiles.forEach((f, idx) => {
    const li = document.createElement("li");
    const sizeKb = Math.round(f.size / 1024);
    li.innerHTML = `<span>${f.name} <span style="color:var(--ink-faint)">(${sizeKb} KB)</span></span>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "file-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      selectedFiles.splice(idx, 1);
      renderFileList();
    });
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });
}

/* ---------------- review step ---------------- */
function buildReview() {
  const fd = new FormData(claimForm);
  const claimType = fd.get("claimType") || "—";
  const rows = [
    ["Applicant", fd.get("applicantName")],
    ["Father's / Husband's name", fd.get("guardianName") || "—"],
    ["Village", fd.get("village")],
    ["Gram Panchayat", fd.get("gramPanchayat") || "—"],
    ["District", fd.get("district")],
    ["State", `${fd.get("state")} ${fd.get("stateCode") ? "(" + fd.get("stateCode").toUpperCase() + ")" : ""}`],
    ["Claim type", claimType],
    ["Years of cultivation", fd.get("yearsOfCultivation") || "—"],
    ["Location", fd.get("latitude") && fd.get("longitude") ? `${fd.get("latitude")}, ${fd.get("longitude")}` : "Not provided"],
    ["Documents attached", `${selectedFiles.length} file(s)`],
  ];

  const reviewList = document.getElementById("reviewList");
  reviewList.innerHTML = rows
    .map(([label, val]) => `<dt>${label}</dt><dd>${val || "—"}</dd>`)
    .join("");

  if (fd.get("landDescription")) {
    reviewList.innerHTML += `<dt class="rl-full">Land description</dt><dd class="rl-full">${fd.get("landDescription")}</dd>`;
  }
}

/* ---------------- submit ---------------- */
claimForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = "Filing…";
  formMsg.className = "form-msg";
  formMsg.textContent = "";

  const fd = new FormData(claimForm);
  fd.set("language", document.getElementById("langSelect").value);

  // The native file input's own FileList is already picked up by
  // `new FormData(claimForm)`. Since drag-and-drop files are tracked
  // separately in `selectedFiles`, remove whatever the raw input
  // contributed first — otherwise every file gets attached twice
  // (once natively, once manually) and silently exceeds the
  // server's 6-file limit, which multer reports as "Unexpected field".
  fd.delete("documents");
  selectedFiles.forEach((f) => fd.append("documents", f));

  try {
    const res = await fetch(`${API_BASE}/claims`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed.");

    formMsg.classList.add("is-success");
    formMsg.textContent = `Filed successfully — Claim ID ${data.claim.claimId}`;
    claimForm.reset();
    selectedFiles = [];
    renderFileList();
    currentStep = 1;
    renderStep();

    // jump to register to show the freshly filed claim
    setTimeout(() => {
      document.querySelector('.tab-btn[data-tab="register"]').click();
    }, 900);
  } catch (err) {
    formMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "File Claim at Gram Sabha";
  }
});

/* ---------------- register / ledger ---------------- */
const ledgerBody = document.getElementById("ledgerBody");
const statsStrip = document.getElementById("statsStrip");
const searchInput = document.getElementById("searchInput");
const filterType = document.getElementById("filterType");
const filterStage = document.getElementById("filterStage");
const refreshBtn = document.getElementById("refreshBtn");

let debounceTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadClaims, 250);
});
filterType.addEventListener("change", loadClaims);
filterStage.addEventListener("change", loadClaims);
refreshBtn.addEventListener("click", loadClaims);

async function loadClaims() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (filterType.value) params.set("claimType", filterType.value);
  if (filterStage.value) params.set("stage", filterStage.value);

  ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">Loading claims…</td></tr>`;

  try {
    const [claimsRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/claims?${params.toString()}`),
      fetch(`${API_BASE}/stats`),
    ]);
    const claimsData = await claimsRes.json();
    const statsData = await statsRes.json();
    renderStats(statsData);
    renderLedger(claimsData.claims);
  } catch (err) {
    ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">Could not load claims — is the server running?</td></tr>`;
  }
}

function renderStats(stats) {
  const chips = [
    { label: "Total claims", value: stats.total },
    { label: "At Gram Sabha", value: stats.byStage["Gram Sabha"] || 0 },
    { label: "At SDLC", value: stats.byStage["SDLC"] || 0 },
    { label: "At DLC", value: stats.byStage["DLC"] || 0 },
    { label: "CFR claims", value: stats.byType["CFR"] || 0 },
  ];
  statsStrip.innerHTML = chips
    .map(
      (c) => `<div class="stat-chip"><span class="stat-num">${c.value}</span><span class="stat-label">${c.label}</span></div>`
    )
    .join("");
}

function renderLedger(claims) {
  if (!claims.length) {
    ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">No claims filed yet — file one from the "File a Claim" tab.</td></tr>`;
    return;
  }
  ledgerBody.innerHTML = claims
    .map((c) => {
      const date = new Date(c.createdAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const stageClass = c.currentStage.replace(/\s+/g, "-");
      return `
        <tr data-claim-id="${c.claimId}">
          <td><span class="claim-id-chip">${c.claimId}</span></td>
          <td>${c.applicantName}</td>
          <td>${c.village}</td>
          <td><span class="type-badge type-${c.claimType}">${c.claimType}</span></td>
          <td><span class="stage-pill stage-${stageClass}">${c.currentStage}</span></td>
          <td>${date}</td>
        </tr>`;
    })
    .join("");

  ledgerBody.querySelectorAll("tr[data-claim-id]").forEach((row) => {
    row.addEventListener("click", () => openDrawer(row.dataset.claimId));
  });
}

/* ---------------- drawer ---------------- */
const drawerOverlay = document.getElementById("drawerOverlay");
const claimDrawer = document.getElementById("claimDrawer");
const drawerContent = document.getElementById("drawerContent");
const drawerClose = document.getElementById("drawerClose");

drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

function closeDrawer() {
  claimDrawer.classList.remove("is-open");
  drawerOverlay.classList.remove("is-open");
  claimDrawer.setAttribute("aria-hidden", "true");
}

async function openDrawer(claimId) {
  drawerContent.innerHTML = `<p>Loading…</p>`;
  claimDrawer.classList.add("is-open");
  drawerOverlay.classList.add("is-open");
  claimDrawer.setAttribute("aria-hidden", "false");

  const res = await fetch(`${API_BASE}/claims/${claimId}`);
  const data = await res.json();
  if (!res.ok) {
    drawerContent.innerHTML = `<p>${data.error}</p>`;
    return;
  }
  const c = data.claim;

  const docsHtml = c.documents.length
    ? c.documents
        .map((d) => `<li><a href="${d.url}" target="_blank" rel="noopener">${d.originalName}</a></li>`)
        .join("")
    : "<li>No documents attached</li>";

  const timelineHtml = c.auditTrail
    .map(
      (t) => `
      <li>
        <div class="tl-stage">${t.stage} — ${t.action}</div>
        <div class="tl-note">${t.note}</div>
        <div class="tl-time">${new Date(t.timestamp).toLocaleString("en-IN")} · ${t.actor}</div>
      </li>`
    )
    .join("");

  const nextStageMap = { "Gram Sabha": "SDLC", SDLC: "DLC" };
  const nextStage = nextStageMap[c.currentStage];

  drawerContent.innerHTML = `
    <h2>${c.applicantName}</h2>
    <div class="drawer-meta"><span class="claim-id-chip">${c.claimId}</span> · ${c.village}, ${c.district}, ${c.state}</div>

    <div class="drawer-section-title">Claim details</div>
    <dl class="review-list">
      <dt>Type</dt><dd><span class="type-badge type-${c.claimType}">${c.claimType}</span></dd>
      <dt>Current stage</dt><dd>${c.currentStage}</dd>
      <dt>Cultivation years</dt><dd>${c.yearsOfCultivation || "—"}</dd>
      <dt>Location</dt><dd>${c.location ? `${c.location.lat}, ${c.location.lng}` : "Not provided"}</dd>
    </dl>

    <div class="drawer-section-title">Supporting documents</div>
    <ul class="file-list" style="list-style:none;padding:0;">${docsHtml}</ul>

    <div class="drawer-section-title">Audit trail</div>
    <ul class="timeline">${timelineHtml}</ul>

    ${
      nextStage
        ? `<button class="btn btn-primary drawer-advance-btn" id="advanceBtn" data-next="${nextStage}">Forward to ${nextStage}</button>`
        : `<p style="font-size:12.5px;color:var(--ink-faint);margin-top:10px;">This claim has reached its final stage (DLC).</p>`
    }
  `;

  const advanceBtn = document.getElementById("advanceBtn");
  if (advanceBtn) {
    advanceBtn.addEventListener("click", async () => {
      advanceBtn.disabled = true;
      advanceBtn.textContent = "Forwarding…";
      const r = await fetch(`${API_BASE}/claims/${claimId}/advance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "Gram Sabha / FRC", note: `Forwarded to ${advanceBtn.dataset.next}.` }),
      });
      if (r.ok) {
        openDrawer(claimId);
        loadClaims();
      } else {
        advanceBtn.disabled = false;
        advanceBtn.textContent = `Forward to ${advanceBtn.dataset.next}`;
      }
    });
  }
}

/* ---------------- init ---------------- */
renderStep();
loadClaims();
