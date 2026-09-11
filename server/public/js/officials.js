/**
 * TribalEarth AI — Officials Review (Module 3 + role-based auth)
 * ------------------------------------------------------------
 * Every AI suggestion rendered here (document classification,
 * name/village match flags) is exactly that — a suggestion. The
 * officer's tick is the only thing that ever counts toward the
 * Rule 13 checklist or a claim decision. The server enforces all
 * of this independently (see server.js) — this file just presents
 * it and won't let you submit something the server would reject
 * anyway (e.g. a rejection under 10 characters), purely for UX.
 *
 * A logged-in officer only ever sees ONE stage — their own — no
 * dropdown to pick a different one. That mirrors the real-world
 * separation the login system enforces server-side.
 */

(function () {
  const API_BASE = "/api";

  const STAGE_FOR_ROLE = {
    gram_sabha: "Gram Sabha",
    sdlc: "SDLC",
    dlc: "DLC",
  };

  const loginPrompt = document.getElementById("officialsLoginPrompt");
  const panel = document.getElementById("officialsPanel");
  const stageSelect = document.getElementById("officialsStageSelect");
  const refreshBtn = document.getElementById("officialsRefreshBtn");
  const statsStrip = document.getElementById("officialsStatsStrip");
  const ledgerBody = document.getElementById("officialsLedgerBody");

  const drawerOverlay = document.getElementById("officialsDrawerOverlay");
  const drawer = document.getElementById("officialsDrawer");
  const drawerContent = document.getElementById("officialsDrawerContent");
  const drawerClose = document.getElementById("officialsDrawerClose");

  function currentOfficialStage() {
    const role = window.Auth.getRole();
    return STAGE_FOR_ROLE[role] || null;
  }

  /* ---------------- tab activation & auth gating ---------------- */
  function refreshOfficialsTabView() {
    const stage = currentOfficialStage();
    if (!stage) {
      loginPrompt.hidden = false;
      panel.hidden = true;
      const p = loginPrompt.querySelector("p");
      if (window.Auth.isLoggedIn()) {
        p.textContent = `You're logged in as ${window.Auth.getDisplayName()}, which isn't a Gram Sabha/SDLC/DLC role. Log out and log in with an officer account to review claims.`;
      } else {
        p.textContent = "Log in as a Gram Sabha, SDLC, or DLC officer to review claims.";
      }
      return;
    }
    loginPrompt.hidden = true;
    panel.hidden = false;
    stageSelect.innerHTML = `<option value="${stage}">${stage} queue</option>`;
    loadQueue();
  }

  document.querySelector('.tab-btn[data-tab="officials"]')?.addEventListener("click", refreshOfficialsTabView);
  window.Auth.onChange(() => {
    // If the officials tab happens to be the active one when login
    // state changes, refresh it immediately rather than showing
    // stale content until the next click.
    const officialsTab = document.getElementById("tab-officials");
    if (officialsTab && officialsTab.classList.contains("is-active")) {
      refreshOfficialsTabView();
    }
  });

  if (refreshBtn) refreshBtn.addEventListener("click", loadQueue);

  /* ---------------- queue ---------------- */
  async function loadQueue() {
    const stage = currentOfficialStage();
    if (!stage) return;

    ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">Loading queue…</td></tr>`;

    try {
      const res = await window.Auth.authFetch(`${API_BASE}/officials/queue?stage=${encodeURIComponent(stage)}`);
      const data = await res.json();
      if (!res.ok) {
        ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">${data.error}</td></tr>`;
        return;
      }
      renderStats(data);
      renderQueue(data.claims || []);
    } catch (err) {
      ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">Could not load the queue — is the server running?</td></tr>`;
    }
  }

  function renderStats(data) {
    const overdue = (data.claims || []).filter((c) => c.slaExceeded).length;
    const escalated = (data.claims || []).filter((c) => c.priorRejection).length;
    statsStrip.innerHTML = `
      <div class="stat-chip"><span class="stat-num">${data.count || 0}</span><span class="stat-label">In ${data.stage} queue</span></div>
      <div class="stat-chip"><span class="stat-num">${overdue}</span><span class="stat-label">Over ${data.slaDays}-day SLA</span></div>
      ${escalated ? `<div class="stat-chip"><span class="stat-num">${escalated}</span><span class="stat-label">Escalated from SDLC</span></div>` : ""}
    `;
  }

  function renderQueue(claims) {
    if (!claims.length) {
      ledgerBody.innerHTML = `<tr class="ledger-empty"><td colspan="6">No claims currently in this queue.</td></tr>`;
      return;
    }
    ledgerBody.innerHTML = claims
      .map(
        (c) => `
      <tr data-claim-id="${c.claimId}">
        <td><span class="claim-id-chip">${c.claimId}</span>${c.priorRejection ? '<span class="escalated-badge">Escalated</span>' : ""}</td>
        <td>${c.applicantName}</td>
        <td>${c.village}</td>
        <td><span class="type-badge type-${c.claimType}">${c.claimType}</span></td>
        <td>${c.daysPending}</td>
        <td>${c.slaExceeded ? '<span class="sla-badge sla-overdue">Overdue</span>' : '<span class="sla-badge">On track</span>'}</td>
      </tr>`
      )
      .join("");

    ledgerBody.querySelectorAll("tr[data-claim-id]").forEach((row) => {
      row.addEventListener("click", () => openOfficialsDrawer(row.dataset.claimId));
    });
  }

  /* ---------------- drawer ---------------- */
  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawerOverlay.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  }
  drawerClose.addEventListener("click", closeDrawer);
  drawerOverlay.addEventListener("click", closeDrawer);

  async function openOfficialsDrawer(claimId) {
    drawerContent.innerHTML = `<p>Loading…</p>`;
    drawer.classList.add("is-open");
    drawerOverlay.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    await renderClaimReview(claimId);
  }

  async function renderClaimReview(claimId) {
    const [claimRes, checklistRes] = await Promise.all([
      window.Auth.authFetch(`${API_BASE}/claims/${claimId}`),
      fetch(`${API_BASE}/claims/${claimId}/checklist`),
    ]);
    const claimData = await claimRes.json();
    const checklist = await checklistRes.json();

    if (!claimRes.ok) {
      drawerContent.innerHTML = `<p>${claimData.error}</p>`;
      return;
    }
    const claim = claimData.claim;

    const priorRejectionHtml = claim.priorRejection
      ? `
      <div class="prior-rejection-banner">
        <strong>Escalated from ${claim.priorRejection.stage}</strong> — rejected by ${claim.priorRejection.officerName}
        on ${new Date(claim.priorRejection.timestamp).toLocaleDateString("en-IN")}:
        <p>&ldquo;${claim.priorRejection.justification}&rdquo;</p>
      </div>`
      : "";

    const docsHtml = claim.documents.length
      ? claim.documents.map((doc, idx) => renderDocumentCard(doc, idx)).join("")
      : "<p>No documents attached to this claim.</p>";

    const checklistHtml = `
      <ul class="rule13-checklist">
        ${checklist.covered.map((c) => `<li class="rule13-covered">✓ ${c.label}</li>`).join("")}
        ${checklist.missing.map((c) => `<li class="rule13-missing">— ${c.label}</li>`).join("")}
      </ul>
      <p class="rule13-summary">${checklist.coveredCount} of ${checklist.totalCategories} Rule 13 evidence categories covered by officer-confirmed documents.</p>
    `;

    drawerContent.innerHTML = `
      <h2>${claim.applicantName}</h2>
      <div class="drawer-meta"><span class="claim-id-chip">${claim.claimId}</span> · ${claim.village}, ${claim.district}, ${claim.state} · <span class="type-badge type-${claim.claimType}">${claim.claimType}</span></div>

      ${priorRejectionHtml}

      <div class="drawer-section-title">Documents &amp; AI-assisted classification</div>
      <p class="officials-drawer-note">Suggestions only — tick "Confirm" to have a document count toward the Rule 13 checklist.</p>
      <div id="docsContainer">${docsHtml}</div>

      <div class="drawer-section-title">Rule 13 evidence checklist</div>
      ${checklistHtml}

      <div class="drawer-section-title">Decision — acting as ${window.Auth.getDisplayName()}</div>
      <div class="decision-actions">
        <button type="button" id="approveBtn" class="btn btn-primary">Approve &amp; Forward</button>
        <button type="button" id="rejectToggleBtn" class="btn btn-ghost decision-reject-btn">Reject…</button>
      </div>
      <div id="rejectPanel" class="reject-panel" hidden>
        <label for="justificationInput">Written justification (required, min 10 characters)</label>
        <textarea id="justificationInput" rows="3" placeholder="Explain specifically what is missing or incorrect…"></textarea>
        ${
          claim.currentStage === "SDLC"
            ? '<p class="reject-panel-hint">Rejecting at SDLC does not end the claim — it will automatically forward to DLC with this reason attached for final determination.</p>'
            : '<p class="reject-panel-hint">This is a final decision — the claim will not proceed further.</p>'
        }
        <div class="reject-panel-actions">
          <button type="button" id="confirmRejectBtn" class="btn btn-primary" disabled>Confirm Rejection</button>
          <button type="button" id="cancelRejectBtn" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
      <div id="decisionMsg" class="decision-msg"></div>
    `;

    wireDocumentActions(claim.claimId);
    wireDecisionActions(claim.claimId);
  }

  function renderDocumentCard(doc, idx) {
    const review = doc.review;
    let statusHtml;

    if (!review) {
      statusHtml = `<button type="button" class="btn btn-ghost btn-sm classify-btn" data-doc-idx="${idx}">Classify with AI</button>`;
    } else {
      const category = review.rule13?.categoryLabel || "No matching Rule 13 category found";
      const confidencePct = Math.round((review.rule13?.confidence || 0) * 100);
      const nameFlag =
        review.nameMatch === true ? '<span class="match-ok">✓ name matches</span>' :
        review.nameMatch === false ? '<span class="match-bad">⚠ name not found in document</span>' : "";
      const villageFlag =
        review.villageMatch === true ? '<span class="match-ok">✓ village matches</span>' :
        review.villageMatch === false ? '<span class="match-bad">⚠ village not found in document</span>' : "";

      statusHtml = `
        <div class="doc-classification">
          <div class="doc-category">${category}${review.rule13?.categoryId ? ` <span class="confidence-tag">${confidencePct}% keyword match</span>` : ""}</div>
          <div class="doc-flags">${nameFlag} ${villageFlag}</div>
          <label class="doc-confirm-toggle">
            <input type="checkbox" class="confirm-checkbox" data-doc-idx="${idx}" ${review.officerConfirmed ? "checked" : ""}>
            Confirm this classification
            ${review.officerConfirmed ? `<span class="confirmed-by">— confirmed by ${review.confirmedBy}</span>` : ""}
          </label>
          <button type="button" class="btn btn-ghost btn-sm classify-btn" data-doc-idx="${idx}">Re-classify</button>
        </div>
      `;
    }

    return `
      <div class="doc-review-card" data-doc-idx="${idx}">
        <div class="doc-review-header">
          <a href="${doc.url}" target="_blank" rel="noopener">${doc.originalName}</a>
        </div>
        ${statusHtml}
      </div>
    `;
  }

  function wireDocumentActions(claimId) {
    drawerContent.querySelectorAll(".classify-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = btn.dataset.docIdx;
        btn.disabled = true;
        btn.textContent = "Classifying…";
        try {
          const res = await window.Auth.authFetch(`${API_BASE}/claims/${claimId}/documents/${idx}/classify`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            // Honest failure surfaced directly — never pretend a
            // classification happened when OCR genuinely failed
            // (e.g. no internet access to fetch the language model).
            const card = drawerContent.querySelector(`.doc-review-card[data-doc-idx="${idx}"]`);
            card.querySelector(".doc-review-header").insertAdjacentHTML(
              "afterend",
              `<p class="classify-error">${data.error} ${data.hint || ""}</p>`
            );
            btn.disabled = false;
            btn.textContent = "Retry classification";
            return;
          }
          await renderClaimReview(claimId);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Retry classification";
        }
      });
    });

    drawerContent.querySelectorAll(".confirm-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const idx = checkbox.dataset.docIdx;
        const res = await window.Auth.authFetch(`${API_BASE}/claims/${claimId}/documents/${idx}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: checkbox.checked }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error);
          checkbox.checked = !checkbox.checked;
          return;
        }
        await renderClaimReview(claimId);
      });
    });
  }

  function wireDecisionActions(claimId) {
    const approveBtn = document.getElementById("approveBtn");
    const rejectToggleBtn = document.getElementById("rejectToggleBtn");
    const rejectPanel = document.getElementById("rejectPanel");
    const justificationInput = document.getElementById("justificationInput");
    const confirmRejectBtn = document.getElementById("confirmRejectBtn");
    const cancelRejectBtn = document.getElementById("cancelRejectBtn");
    const decisionMsg = document.getElementById("decisionMsg");

    async function submitDecision(payload, busyBtn) {
      busyBtn.disabled = true;
      const res = await window.Auth.authFetch(`${API_BASE}/claims/${claimId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      decisionMsg.textContent = res.ok ? data.message : data.error;
      decisionMsg.className = res.ok ? "decision-msg is-success" : "decision-msg is-error";
      if (res.ok) {
        setTimeout(() => {
          closeDrawer();
          loadQueue();
        }, 1400);
      } else {
        busyBtn.disabled = false;
      }
    }

    approveBtn.addEventListener("click", () => submitDecision({ action: "approve" }, approveBtn));

    rejectToggleBtn.addEventListener("click", () => {
      rejectPanel.hidden = !rejectPanel.hidden;
    });
    cancelRejectBtn.addEventListener("click", () => {
      rejectPanel.hidden = true;
      justificationInput.value = "";
      confirmRejectBtn.disabled = true;
    });
    justificationInput.addEventListener("input", () => {
      // Mirrors the server's own rule (>=10 chars) — purely for UX;
      // the server enforces this independently regardless of what
      // the client does.
      confirmRejectBtn.disabled = justificationInput.value.trim().length < 10;
    });
    confirmRejectBtn.addEventListener("click", () =>
      submitDecision({ action: "reject", justification: justificationInput.value.trim() }, confirmRejectBtn)
    );
  }
})();
