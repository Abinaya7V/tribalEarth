/**
 * TribalEarth AI — Module 1 frontend
 * Talks to the local Express API (same origin, no build step required).
 */

const API_BASE = "/api";

/* ---------------- tabs ---------------- */
const tabBtns = document.querySelectorAll(".tab-btn");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    if (typeof window.switchTab === "function") {
      window.switchTab(target);
    }
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
        const fieldLabel = el.previousElementSibling?.querySelector('[data-i18n]')?.textContent 
          || el.previousElementSibling?.textContent 
          || name;
        const cleanLabel = fieldLabel.replace(/\s*\*$/, '').trim();
        formMsg.textContent = window.t("form.validation.required", "Please fill in \"{field}\".").replace("{field}", cleanLabel);
        el.focus();
        return false;
      }
    }
  }
  if (step === 2) {
    const claimType = claimForm.querySelector('input[name="claimType"]:checked');
    if (!claimType) {
      formMsg.textContent = window.t("form.validation.type", "Please select a claim type — IFR, CR, or CFR.");
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

if (dropzone) {
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
}
if (documentsInput) {
  documentsInput.addEventListener("change", (e) => addFiles(e.target.files));
}

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

/* ---------------- bilingual formatter helper ---------------- */
function formatBilingualValue(bilingualObj, originalFallback, isDescriptiveText = false, inline = false) {
  if (!bilingualObj) {
    if (!originalFallback) return "—";
    bilingualObj = window.getBilingualValue(originalFallback, window.getCurrentLanguage());
  }
  if (bilingualObj.selectedLanguage === bilingualObj.english) {
    return bilingualObj.original;
  }
  if (inline) {
    return `${bilingualObj.selectedLanguage} (${bilingualObj.english})`;
  }
  if (isDescriptiveText) {
    return `<div class="bilingual-val-lang">${bilingualObj.selectedLanguage}</div><div class="bilingual-val-eng" style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;">English: ${bilingualObj.english}</div>`;
  }
  return `<div class="bilingual-val-lang">${bilingualObj.selectedLanguage}</div><div class="bilingual-val-eng" style="font-size:12.5px;color:var(--ink-soft);margin-top:2px;">${bilingualObj.english}</div>`;
}

/* ---------------- review step ---------------- */
function buildReview() {
  const fd = new FormData(claimForm);
  const claimType = fd.get("claimType") || "—";
  
  // Format claim type bilingually using original abbreviation + dynamic title explanation
  const formattedClaimType = fd.get("claimType") 
    ? `${fd.get("claimType")}<br><span style="font-size:12px;color:var(--ink-soft);">${window.t("form.step2." + fd.get("claimType").toLowerCase() + "Title")}</span>` 
    : "—";

  const rows = [
    [window.t("form.review.applicant", "Applicant"), formatBilingualValue(null, fd.get("applicantName"))],
    [window.t("form.review.guardian", "Father's / Husband's name"), formatBilingualValue(null, fd.get("guardianName"))],
    [window.t("form.review.village", "Village"), formatBilingualValue(null, fd.get("village"))],
    [window.t("form.review.gp", "Gram Panchayat"), formatBilingualValue(null, fd.get("gramPanchayat"))],
    [window.t("form.review.district", "District"), formatBilingualValue(null, fd.get("district"))],
    [window.t("form.review.state", "State"), formatBilingualValue(null, `${fd.get("state")} ${fd.get("stateCode") ? "(" + fd.get("stateCode").toUpperCase() + ")" : ""}`)],
    [window.t("form.review.claimType", "Claim type"), formattedClaimType],
    [window.t("form.review.cultivationYears", "Years of cultivation"), fd.get("yearsOfCultivation") || "—"],
    [window.t("atlas.occupationSince", "Occupation since"), fd.get("occupationSinceYear") || "—"],
    [window.t("form.review.location", "Location"), fd.get("latitude") && fd.get("longitude") ? `${fd.get("latitude")}, ${fd.get("longitude")}` : window.t("form.review.locationNotProvided", "Not provided")],
    [window.t("form.review.docsAttached", "Documents attached"), `${selectedFiles.length} file(s)`],
  ];

  const reviewList = document.getElementById("reviewList");
  reviewList.innerHTML = rows
    .map(([label, val]) => `<dt>${label}</dt><dd>${val}</dd>`)
    .join("");

  if (fd.get("landDescription")) {
    reviewList.innerHTML += `<dt class="rl-full">${window.t("form.review.landDesc", "Land description")}</dt><dd class="rl-full">${formatBilingualValue(null, fd.get("landDescription"), true)}</dd>`;
  }
}

/* ---------------- submit ---------------- */
claimForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!window.Auth || !window.Auth.hasRole("applicant")) {
    formMsg.className = "form-msg";
    formMsg.textContent = window.t("form.status.loginRequired", "Please log in as an applicant to file a claim.");
    if (window.Auth) window.Auth.openLoginModal();
    return;
  }

  // Mandatory location validation: require coordinates or boundary polygon
  const lat = (document.getElementById("latitude")?.value || "").trim();
  const lng = (document.getElementById("longitude")?.value || "").trim();
  const geom = (document.getElementById("geometry")?.value || "").trim();

  if ((!lat || !lng) && !geom) {
    formMsg.className = "form-msg";
    formMsg.textContent = window.t(
      "filing.locationRequired",
      "Location is mandatory: please drop a pin or draw a boundary on the map."
    );
    currentStep = 2;
    renderStep();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = window.t("form.status.filing", "Filing…");
  formMsg.className = "form-msg";
  formMsg.textContent = "";

  const fd = new FormData(claimForm);
  fd.set("language", window.getCurrentLanguage());

  // Package bilingualData JSON
  const currentLang = window.getCurrentLanguage();
  const bilingualData = {
    applicantName: window.getBilingualValue(fd.get("applicantName"), currentLang),
    guardianName: window.getBilingualValue(fd.get("guardianName"), currentLang),
    village: window.getBilingualValue(fd.get("village"), currentLang),
    gramPanchayat: window.getBilingualValue(fd.get("gramPanchayat"), currentLang),
    district: window.getBilingualValue(fd.get("district"), currentLang),
    state: window.getBilingualValue(fd.get("state"), currentLang),
    landDescription: window.getBilingualValue(fd.get("landDescription"), currentLang)
  };
  fd.set("bilingualData", JSON.stringify(bilingualData));

  // The native file input's own FileList is already picked up by
  // `new FormData(claimForm)`. Since drag-and-drop files are tracked
  // separately in `selectedFiles`, remove whatever the raw input
  // contributed first — otherwise every file gets attached twice
  // (once natively, once manually) and silently exceeds the
  // server's 6-file limit, which multer reports as "Unexpected field".
  fd.delete("documents");
  selectedFiles.forEach((f) => fd.append("documents", f));

  try {
    const res = await window.Auth.authFetch(`${API_BASE}/claims`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed.");

    formMsg.classList.add("is-success");
    let successMsg = window.t("form.status.success", "Filed successfully — Claim ID {id}").replace("{id}", data.claim.claimId);
    if (data.claim?.conflictNotice) {
      successMsg += ` · ${window.t("conflict.applicantNotice", "Your claim is currently undergoing standard boundary and document verification by officials.")}`;
    }
    formMsg.textContent = successMsg;
    claimForm.reset();
    selectedFiles = [];
    renderFileList();
    currentStep = 1;
    renderStep();

    // jump to My Claims to show the freshly filed claim
    setTimeout(() => {
      if (typeof window.switchTab === "function") {
        window.switchTab("myclaims");
      }
    }, 900);
  } catch (err) {
    formMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = window.t("form.buttons.submit", "File Claim at Gram Sabha");
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
if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadClaims, 250);
  });
}
if (filterType) filterType.addEventListener("change", loadClaims);
if (filterStage) filterStage.addEventListener("change", loadClaims);
if (refreshBtn) refreshBtn.addEventListener("click", loadClaims);

async function loadClaims() {
  const params = new URLSearchParams();
  if (searchInput && searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (filterType && filterType.value) params.set("claimType", filterType.value);
  if (filterStage && filterStage.value) params.set("stage", filterStage.value);

  if (ledgerBody) {
    ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">${window.t("register.loading", "Loading claims…")}</td></tr>`;
  }

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
    if (ledgerBody) {
      ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">${window.t("register.loadError", "Could not load claims — is the server running?")}</td></tr>`;
    }
  }
}

function renderStats(stats) {
  if (!statsStrip) return;
  const chips = [
    { label: window.t("register.stats.total", "Total claims"), value: stats.total },
    { label: window.t("register.stats.gramSabha", "At Gram Sabha"), value: stats.byStage["Gram Sabha"] || 0 },
    { label: window.t("register.stats.sdlc", "At SDLC"), value: stats.byStage["SDLC"] || 0 },
    { label: window.t("register.stats.dlc", "At DLC"), value: stats.byStage["DLC"] || 0 },
    { label: window.t("register.stats.cfr", "CFR claims"), value: stats.byType["CFR"] || 0 },
  ];
  statsStrip.innerHTML = chips
    .map(
      (c) => `<div class="stat-chip"><span class="stat-num">${c.value}</span><span class="stat-label">${c.label}</span></div>`
    )
    .join("");
}

function renderLedger(claims) {
  if (!ledgerBody) return;
  if (!claims.length) {
    ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">${window.t("register.empty", "No claims filed yet — file one from the 'File a Claim' tab.")}</td></tr>`;
    return;
  }
  ledgerBody.innerHTML = claims
    .map((c) => {
      const date = new Date(c.createdAt).toLocaleDateString(window.getCurrentLanguage() === "en" ? "en-IN" : undefined, {
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

if (drawerClose) drawerClose.addEventListener("click", closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);

function closeDrawer() {
  if (claimDrawer) {
    claimDrawer.classList.remove("is-open");
    claimDrawer.setAttribute("aria-hidden", "true");
  }
  if (drawerOverlay) drawerOverlay.classList.remove("is-open");
}

async function openDrawer(claimId) {
  if (!drawerContent || !claimDrawer || !drawerOverlay) return;
  drawerContent.innerHTML = `<p>${window.t("drawer.loading", "Loading…")}</p>`;
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
        .map((d) => `<li><a href="#" class="auth-doc-link" data-url="${d.url}">${d.originalName}</a></li>`)
        .join("")
    : `<li>${window.t("drawer.noDocs", "No documents attached")}</li>`;

  const timelineHtml = c.auditTrail
    .map(
      (t) => {
        let actionText = t.action;
        let noteText = t.note;
        
        if (t.action === "Claim submitted") {
          actionText = window.t("drawer.timeline.submitted", "Claim submitted");
          noteText = window.t("drawer.timeline.submittedNote", "Claim filed and recorded at Gram Sabha level.");
        } else if (t.action === "Forwarded") {
          actionText = window.t("drawer.timeline.forwarded", "Forwarded");
          noteText = window.t("drawer.timeline.forwardedNote", "Claim forwarded to {stage}.").replace("{stage}", t.stage);
        }
        
        return `
        <li>
          <div class="tl-stage">${t.stage} — ${actionText}</div>
          <div class="tl-note">${noteText}</div>
          <div class="tl-time">${new Date(t.timestamp).toLocaleString(window.getCurrentLanguage() === "en" ? "en-IN" : undefined)} · ${t.actor}</div>
        </li>`;
      }
    )
    .join("");

  // Resolve bilingual values for drawer display
  const bData = c.bilingualData || {};
  const applicantNameBilingual = formatBilingualValue(bData.applicantName, c.applicantName, false, true);
  const villageBilingual = formatBilingualValue(bData.village, c.village, false, true);
  const districtBilingual = formatBilingualValue(bData.district, c.district, false, true);
  const stateBilingual = formatBilingualValue(bData.state, c.state, false, true);
  
  const formattedClaimType = `${c.claimType} — ${window.t("form.step2." + c.claimType.toLowerCase() + "Title")}`;

  drawerContent.innerHTML = `
    <h2>${applicantNameBilingual}</h2>
    <div class="drawer-meta"><span class="claim-id-chip">${c.claimId}</span> · ${villageBilingual}, ${districtBilingual}, ${stateBilingual}</div>

    <div class="drawer-section-title">${window.t("drawer.titleDetails", "Claim details")}</div>
    <dl class="review-list">
      <dt>${window.t("drawer.labelType", "Type")}</dt><dd>${formattedClaimType}</dd>
      <dt>${window.t("drawer.labelStage", "Current stage")}</dt><dd>${c.currentStage}</dd>
      <dt>${window.t("drawer.labelYears", "Cultivation years")}</dt><dd>${c.yearsOfCultivation || "—"}</dd>
      <dt>${window.t("drawer.labelLocation", "Location")}</dt><dd>${c.location ? `${c.location.lat}, ${c.location.lng}` : window.t("drawer.locationNotProvided", "Not provided")}</dd>
    </dl>

    <div class="drawer-section-title">${window.t("drawer.titleDocs", "Supporting documents")}</div>
    <ul class="file-list" style="list-style:none;padding:0;">${docsHtml}</ul>

    <div class="drawer-section-title">${window.t("drawer.titleAudit", "Audit trail")}</div>
    <ul class="timeline">${timelineHtml}</ul>
  `;

  drawerContent.querySelectorAll(".auth-doc-link").forEach(link => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const r = await window.Auth.authFetch(link.dataset.url);
      if (!r.ok) return alert("Failed to fetch document");
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = link.textContent;
      a.click();
      URL.revokeObjectURL(objUrl);
    });
  });
}



/* ---------------- i18n Event Listeners ---------------- */
window.addEventListener("languageChanged", () => {
  // Update static/dynamic text values across components
  if (currentStep === TOTAL_STEPS) buildReview();
  
  // Re-translate navigation buttons
  prevBtn.textContent = window.t("form.buttons.back", "Back");
  if (currentStep < TOTAL_STEPS) {
    nextBtn.textContent = window.t("form.buttons.continue", "Continue");
  }
  submitBtn.textContent = window.t("form.buttons.submit", "File Claim at Gram Sabha");
  
  // Reload ledger list with newly localized formatting if table is loaded
  loadClaims();
});

/* ---------------- init ---------------- */
renderStep();
loadClaims();
