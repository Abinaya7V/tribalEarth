/**
 * TribalEarth AI — My Claims Tracker (Module 4)
 * -----------------------------------------------
 * Handles the "My Claims" applicant tab:
 *   - Card list of applicant's claims with ID, type badge, village, status, stage
 *   - Detail view in claim drawer with:
 *       * Gram Sabha -> SDLC -> DLC progress tracker
 *       * Plain-language status explanations
 *       * Current rejection details (with Read Aloud option)
 *       * Prior SDLC rejection notes (for escalated/appealed claims)
 *       * Appeal form (when canAppeal is true with deadline) or filed appeal status
 *       * Timeline (audit trail)
 *       * Supporting documents opened via authenticated blob fetch
 *   - Multilingual support via window.t("myclaims.*")
 */

(function () {
  const API_BASE = window.API_BASE || "/api";

  let lastLoadedClaims = [];
  let currentlyOpenClaimId = null;

  function getDateLocale() {
    return window.getCurrentLanguage?.() === "en" ? "en-IN" : undefined;
  }

  function getPlainStatus(claim) {
    const stage = claim.currentStage || "Gram Sabha";
    const status = claim.status;

    if (status === "Approved") {
      return {
        title: window.t("myclaims.statusApproved", "Approved"),
        desc: window.t("myclaims.descApproved", "Your claim has been approved and forest rights have been granted."),
        statusClass: "status-approved"
      };
    }
    if (status === "Rejected") {
      const stageName = claim.rejection?.rejectedAtStage || stage;
      return {
        title: window.t("myclaims.statusRejected", "Rejected"),
        desc: `${window.t("myclaims.descRejected", "Your claim was rejected at this stage.")} (${stageName})`,
        statusClass: "status-rejected"
      };
    }
    if (status === "Escalated to DLC") {
      return {
        title: window.t("myclaims.statusEscalated", "Escalated to DLC"),
        desc: window.t("myclaims.descEscalated", "Your claim has been forwarded to the District Level Committee (DLC) for final determination."),
        statusClass: "status-escalated-to-dlc"
      };
    }
    if (status === "Appealed") {
      return {
        title: window.t("myclaims.statusAppealed", "Appealed"),
        desc: window.t("myclaims.descAppealed", "Your appeal has been filed and is currently being considered by the SDLC."),
        statusClass: "status-appealed"
      };
    }
    if (stage === "Gram Sabha" && status === "Submitted") {
      return {
        title: window.t("myclaims.statusSubmitted", "Submitted"),
        desc: window.t("myclaims.descSubmitted", "Your claim has been submitted to the Gram Sabha and is awaiting verification."),
        statusClass: "status-submitted"
      };
    }
    return {
      title: window.t("myclaims.statusUnderReview", "Under Review"),
      desc: window.t("myclaims.descUnderReview", "Your claim is currently under review at this stage."),
      statusClass: "status-under-review"
    };
  }

  function renderProgressTracker(claim) {
    const stages = ["Gram Sabha", "SDLC", "DLC"];
    const currentStage = claim.currentStage || "Gram Sabha";
    const status = claim.status;
    const isApproved = status === "Approved";
    const isRejected = status === "Rejected";
    const currentIdx = stages.indexOf(currentStage);

    function getStepClass(stepIdx) {
      if (isApproved) return "is-completed";
      if (stepIdx < currentIdx) return "is-completed";
      if (stepIdx === currentIdx) {
        return isRejected ? "is-rejected" : "is-active";
      }
      return "";
    }

    function getLineClass(lineIdx) {
      if (isApproved) return "is-completed";
      if (lineIdx < currentIdx) return "is-completed";
      return "";
    }

    const gsClass = getStepClass(0);
    const sdlcClass = getStepClass(1);
    const dlcClass = getStepClass(2);

    const line1Class = getLineClass(0);
    const line2Class = getLineClass(1);

    return `
      <div class="progress-tracker">
        <div class="progress-step ${gsClass}">
          <div class="step-circle">${gsClass === "is-completed" ? "✓" : "1"}</div>
          <div class="step-label">${window.t("myclaims.stageGramSabha", "Gram Sabha")}</div>
        </div>
        <div class="progress-line ${line1Class}"></div>
        <div class="progress-step ${sdlcClass}">
          <div class="step-circle">${sdlcClass === "is-completed" ? "✓" : "2"}</div>
          <div class="step-label">${window.t("myclaims.stageSdlc", "SDLC")}</div>
        </div>
        <div class="progress-line ${line2Class}"></div>
        <div class="progress-step ${dlcClass}">
          <div class="step-circle">${dlcClass === "is-completed" ? "✓" : "3"}</div>
          <div class="step-label">${window.t("myclaims.stageDlc", "DLC")}</div>
        </div>
      </div>
    `;
  }

  async function loadMyClaims() {
    const myclaimsList = document.getElementById("myclaimsList");
    if (!myclaimsList) return;

    myclaimsList.innerHTML = `<div class="ledger-empty">${window.t("myclaims.loading", "Loading your claims…")}</div>`;

    try {
      const res = await window.Auth.authFetch(`${API_BASE}/my/claims`);
      const data = await res.json();

      if (!data.claims || data.claims.length === 0) {
        lastLoadedClaims = [];
        myclaimsList.innerHTML = `<div class="ledger-empty">${window.t("myclaims.empty", "No claims found.")}</div>`;
        return;
      }

      lastLoadedClaims = data.claims;

      myclaimsList.innerHTML = data.claims.map((c) => {
        const plainStatus = getPlainStatus({ currentStage: c.stage, status: c.status });
        return `
          <div class="myclaim-card" data-id="${c.id}">
            <div class="myclaim-header">
              <span class="claim-id-chip">${c.id}</span>
              <span class="type-badge type-${c.claimType}">${c.claimType}</span>
            </div>
            <div class="myclaim-body">
              <div><strong>${window.t("myclaims.village", "Village")}:</strong> ${c.village}</div>
              <div><strong>${window.t("myclaims.stage", "Current stage")}:</strong> ${c.stage}</div>
            </div>
            <div class="myclaim-footer">
              <span class="status-badge ${plainStatus.statusClass}">${plainStatus.title}</span>
            </div>
          </div>
        `;
      }).join("");

      myclaimsList.querySelectorAll(".myclaim-card").forEach((card) => {
        card.addEventListener("click", () => openMyClaimDrawer(card.dataset.id));
      });
    } catch (err) {
      console.error("[myclaims] Error loading claims:", err);
      myclaimsList.innerHTML = `<div class="ledger-empty">${window.t("myclaims.errorLoading", "Error loading claims.")}</div>`;
    }
  }

  async function openMyClaimDrawer(claimId) {
    const claimDrawer = document.getElementById("claimDrawer");
    const drawerOverlay = document.getElementById("drawerOverlay");
    const drawerContent = document.getElementById("drawerContent");

    if (!drawerContent || !claimDrawer || !drawerOverlay) return;

    currentlyOpenClaimId = claimId;
    drawerContent.innerHTML = `<p>${window.t("drawer.loading", "Loading…")}</p>`;
    claimDrawer.classList.add("is-open");
    drawerOverlay.classList.add("is-open");
    claimDrawer.setAttribute("aria-hidden", "false");

    try {
      const res = await window.Auth.authFetch(`${API_BASE}/my/claims/${claimId}`);
      const data = await res.json();

      if (!res.ok) {
        drawerContent.innerHTML = `<p class="error-msg">${data.error || window.t("myclaims.errorLoadingDetail", "Failed to load claim details.")}</p>`;
        return;
      }

      const { claim: c, canAppeal, appealDeadline } = data;
      const dateLocale = getDateLocale();
      const plainStatus = getPlainStatus(c);
      const progressTrackerHtml = renderProgressTracker(c);

      // Rejection Reason Box
      let rejectionHtml = "";
      if (c.status === "Rejected" && c.rejection) {
        rejectionHtml = `
          <div class="rejection-box">
            <h4>${window.t("myclaims.rejectedBy", "Rejected by")} ${c.rejection.rejectedAtStage}</h4>
            <p>${c.rejection.reason}</p>
            <button class="btn btn-ghost btn-sm read-aloud-btn" data-text="${c.rejection.reason}">🔊 ${window.t("myclaims.readAloud", "Read Aloud")}</button>
          </div>
        `;
      }

      // Prior SDLC Rejection Note
      let priorRejectionHtml = "";
      if (c.priorRejection && c.priorRejection.justification) {
        priorRejectionHtml = `
          <div class="rejection-box prior-rejection-box" style="border-left: 4px solid var(--ochre); background: var(--ochre-soft);">
            <h4 style="color: #8A5F1F; margin: 0 0 6px;">${window.t("myclaims.priorRejectionTitle", "Prior SDLC Rejection Note")}</h4>
            <p style="margin: 0 0 8px;">${c.priorRejection.justification}</p>
            <div style="font-size: 12px; color: var(--ink-soft);">
              ${new Date(c.priorRejection.timestamp).toLocaleDateString(dateLocale)} · ${c.priorRejection.officerName || "SDLC Officer"}
            </div>
          </div>
        `;
      }

      // Appeal Form Trigger or Filed Appeal Details
      let appealHtml = "";
      if (canAppeal) {
        appealHtml = `
          <div class="appeal-box">
            <div>
              <p><strong>${window.t("myclaims.appealEligible", "Eligible to Appeal")}:</strong> ${window.t("myclaims.appealNotice", "You have the right to appeal a Gram Sabha rejection to the SDLC within 60 days.")}</p>
              <p style="font-size: 12.5px; color: var(--ink-faint); margin-top: 4px;">
                <strong>${window.t("myclaims.appealDeadline", "Appeal Deadline")}:</strong> ${new Date(appealDeadline).toLocaleDateString(dateLocale)}
              </p>
            </div>
            <button class="btn btn-primary btn-sm" id="openAppealBtn" data-id="${c.claimId}">
              ${window.t("myclaims.fileAppealBtn", "File Appeal")}
            </button>
          </div>
        `;
      } else if (c.appeal) {
        appealHtml = `
          <div class="appeal-box filed-appeal-box" style="border-style: solid; border-color: var(--forest);">
            <div>
              <h4 style="margin: 0 0 6px; color: var(--forest);">${window.t("myclaims.appealFiledTitle", "Appeal Filed")}</h4>
              <p style="margin: 0 0 6px;"><strong>${window.t("myclaims.appealGrounds", "Grounds")}:</strong> ${c.appeal.grounds}</p>
              <p style="font-size: 12px; color: var(--ink-faint); margin: 0;">${window.t("myclaims.filedOn", "Filed on")}: ${new Date(c.appeal.filedAt).toLocaleDateString(dateLocale)}</p>
            </div>
          </div>
        `;
      }

      // Documents List (behind auth)
      const docsHtml = c.documents && c.documents.length
        ? c.documents
            .map((d) => `<li><a href="#" class="auth-doc-link" data-url="${d.url}">${d.originalName}</a></li>`)
            .join("")
        : `<li>${window.t("myclaims.noDocs", "No documents attached")}</li>`;

      // Timeline from auditTrail
      const timelineHtml = (c.auditTrail || [])
        .map((t) => `
          <li>
            <div class="tl-stage">${t.stage} — ${t.action}</div>
            <div class="tl-note">${t.note || ""}</div>
            <div class="tl-time">${new Date(t.timestamp).toLocaleString(dateLocale)} · ${t.actor || ""}</div>
          </li>
        `)
        .join("");

      // Assemble Detail HTML
      drawerContent.innerHTML = `
        <h2>${c.applicantName}</h2>
        <div class="drawer-meta"><span class="claim-id-chip">${c.claimId}</span> · ${c.village}, ${c.district}, ${c.state}</div>

        <div class="drawer-section-title">${window.t("myclaims.progressTitle", "Review Progress")}</div>
        ${progressTrackerHtml}

        <div class="plain-status-card ${plainStatus.statusClass}">
          <h4>${plainStatus.title}</h4>
          <p>${plainStatus.desc}</p>
        </div>

        ${rejectionHtml}
        ${priorRejectionHtml}
        ${appealHtml}

        <div class="drawer-section-title">${window.t("myclaims.claimDetails", "Claim Details")}</div>
        <dl class="review-list">
          <dt>${window.t("myclaims.claimType", "Type")}</dt><dd>${c.claimType}</dd>
          <dt>${window.t("myclaims.stage", "Current stage")}</dt><dd>${c.currentStage}</dd>
          <dt>${window.t("myclaims.cultivationYears", "Years of cultivation")}</dt><dd>${c.yearsOfCultivation || "—"}</dd>
          <dt>${window.t("myclaims.location", "Location")}</dt><dd>${c.location ? `${c.location.lat}, ${c.location.lng}` : window.t("myclaims.locationNotProvided", "Not provided")}</dd>
        </dl>

        <div class="drawer-section-title">${window.t("myclaims.supportingDocs", "Supporting Documents")}</div>
        <ul class="file-list" style="list-style: none; padding: 0;">${docsHtml}</ul>

        <div class="drawer-section-title">${window.t("myclaims.auditTrail", "Audit Trail")}</div>
        <ul class="timeline">${timelineHtml}</ul>
      `;

      // Wire auth document links using blob fetch
      drawerContent.querySelectorAll(".auth-doc-link").forEach((link) => {
        link.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            const docRes = await window.Auth.authFetch(link.dataset.url);
            if (!docRes.ok) return alert("Failed to fetch document");
            const blob = await docRes.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objUrl;
            a.download = link.textContent;
            a.click();
            URL.revokeObjectURL(objUrl);
          } catch (err) {
            console.error("[myclaims] Document fetch error:", err);
            alert("Error downloading document.");
          }
        });
      });

      // Wire Open Appeal Button
      const openAppealBtn = document.getElementById("openAppealBtn");
      if (openAppealBtn) {
        openAppealBtn.addEventListener("click", () => {
          const appealClaimIdInput = document.getElementById("appealClaimId");
          const appealModal = document.getElementById("appealModal");
          const appealOverlay = document.getElementById("appealOverlay");
          const appealError = document.getElementById("appealError");

          if (appealClaimIdInput) appealClaimIdInput.value = c.claimId;
          if (appealModal) {
            appealModal.classList.add("is-open");
            appealModal.setAttribute("aria-hidden", "false");
          }
          if (appealOverlay) appealOverlay.classList.add("is-open");
          if (appealError) appealError.hidden = true;
        });
      }

      // Wire Read Aloud button for free-text officer rejection note
      drawerContent.querySelectorAll(".read-aloud-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const text = btn.dataset.text;
          if (!text) return;
          const lang = window.getCurrentLanguage?.() || "en";
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang =
            lang === "en"
              ? "en-IN"
              : lang === "hi"
              ? "hi-IN"
              : lang === "bn"
              ? "bn-IN"
              : lang === "te"
              ? "te-IN"
              : lang === "or"
              ? "or-IN"
              : "en-US";
          window.speechSynthesis?.speak(utterance);
          utterance.onerror = (evt) => {
            if (evt.error === "language-unavailable") {
              alert("Voice not available for this language.");
            }
          };
        });
      });
    } catch (err) {
      console.error("[myclaims] Detail fetch error:", err);
      drawerContent.innerHTML = `<p class="error-msg">${window.t("myclaims.errorLoadingDetail", "Failed to load claim details.")}</p>`;
    }
  }

  // Setup Appeal Form submission
  function setupAppealForm() {
    const appealForm = document.getElementById("appealForm");
    const appealModal = document.getElementById("appealModal");
    const appealOverlay = document.getElementById("appealOverlay");
    const appealModalClose = document.getElementById("appealModalClose");

    function closeAppealModal() {
      if (appealModal) {
        appealModal.classList.remove("is-open");
        appealModal.setAttribute("aria-hidden", "true");
      }
      if (appealOverlay) appealOverlay.classList.remove("is-open");
    }

    if (appealModalClose) appealModalClose.addEventListener("click", closeAppealModal);
    if (appealOverlay) appealOverlay.addEventListener("click", closeAppealModal);

    if (appealForm) {
      appealForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const claimId = document.getElementById("appealClaimId")?.value;
        const groundsInput = document.getElementById("appealGrounds");
        const grounds = groundsInput ? groundsInput.value : "";
        const submitBtn = document.getElementById("appealSubmitBtn");
        const errorEl = document.getElementById("appealError");

        if (submitBtn) submitBtn.disabled = true;
        if (errorEl) errorEl.hidden = true;

        try {
          const res = await window.Auth.authFetch(`${API_BASE}/my/claims/${claimId}/appeal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ grounds }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to submit appeal.");

          closeAppealModal();
          appealForm.reset();
          openMyClaimDrawer(claimId);
          loadMyClaims();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // Language changed listener to re-render my claims
  window.addEventListener("languageChanged", () => {
    const myclaimsTab = document.getElementById("tab-myclaims");
    if (myclaimsTab && myclaimsTab.classList.contains("is-active")) {
      loadMyClaims();
    }
    const claimDrawer = document.getElementById("claimDrawer");
    if (claimDrawer && claimDrawer.classList.contains("is-open") && currentlyOpenClaimId) {
      openMyClaimDrawer(currentlyOpenClaimId);
    }
  });

  // Initialize appeal modal listeners
  setupAppealForm();

  // Expose to window for app.js and filing redirects
  window.loadMyClaims = loadMyClaims;
  window.openMyClaimDrawer = openMyClaimDrawer;
})();
