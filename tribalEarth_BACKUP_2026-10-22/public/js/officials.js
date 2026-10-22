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
        (c) => {
          let badges = '';
          if (c.priorRejection) badges += '<span class="escalated-badge">Escalated</span>';
          if (c.appeal) badges += '<span class="escalated-badge">Appealed</span>';
          if (c.conflictCount > 0) {
            badges += `<span class="conflict-badge conflict-competing">${c.conflictCount} ${c.conflictCount === 1 ? 'conflict' : 'conflicts'}</span>`;
          }
          if (c.hasDuplicateProof) {
            badges += '<span class="conflict-badge conflict-duplicate">Duplicate proof</span>';
          }
          if (c.notCheckable) {
            badges += '<span class="conflict-badge conflict-not-checkable">Not checkable</span>';
          }

          return `
      <tr data-claim-id="${c.claimId}">
        <td><span class="claim-id-chip">${c.claimId}</span>${badges}</td>
        <td>${c.applicantName}</td>
        <td>${c.village}</td>
        <td><span class="type-badge type-${c.claimType}">${c.claimType}</span></td>
        <td>${c.daysPending}</td>
        <td>${c.slaExceeded ? '<span class="sla-badge sla-overdue">Overdue</span>' : '<span class="sla-badge">On track</span>'}</td>
      </tr>`;
        }
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
    const [claimRes, checklistRes, geoRes] = await Promise.all([
      window.Auth.authFetch(`${API_BASE}/claims/${claimId}`),
      fetch(`${API_BASE}/claims/${claimId}/checklist`),
      window.Auth.authFetch(`${API_BASE}/claims/${claimId}/geo`)
    ]);
    const claimData = await claimRes.json();
    const checklist = await checklistRes.json();
    const geoData = geoRes.ok ? await geoRes.json() : null;

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

    const appealHtml = claim.appeal
      ? `
      <div class="prior-rejection-banner">
        <strong>Appealed by applicant</strong> on ${new Date(claim.appeal.timestamp).toLocaleDateString("en-IN")}:
        <p>&ldquo;${claim.appeal.grounds}&rdquo;</p>
      </div>`
      : "";

    const conflicts = Array.isArray(claim.conflicts) ? claim.conflicts : [];
    const openCompeting = conflicts.filter((c) => c.kind === "competing" && c.status === "open");
    const duplicateConflicts = conflicts.filter((c) => c.kind === "duplicate");
    const resolvedConflicts = conflicts.filter((c) => c.status === "resolved");
    const notCheckable = !claim.geometry && !claim.location;

    let conflictBannerHtml = "";
    if (openCompeting.length > 0) {
      conflictBannerHtml += `
        <div class="conflict-banner conflict-banner-competing">
          <div class="conflict-banner-header">
            <span class="conflict-banner-icon">⚠️</span>
            <div>
              <h4 class="conflict-banner-title">${window.t("conflict.banner.title", "Competing Claim(s) Detected")}</h4>
              <p class="conflict-banner-desc">${window.t("conflict.banner.competing", "This claim has open competing conflicts. Approval is locked until all conflicts are resolved.")}</p>
            </div>
          </div>
          <div class="conflict-items-list">
            ${openCompeting
              .map(
                (c) => `
              <div class="conflict-item-card" data-conflict-id="${c.conflictId}">
                <div class="conflict-item-meta">
                  <span class="claim-id-chip">${c.otherClaimId}</span>
                  <span class="type-badge">${c.otherClaimStage || "Active"}</span>
                  ${
                    c.otherApplicantName
                      ? `<span class="conflict-claimant-info">${c.otherApplicantName} (${c.otherVillage || ""})</span>`
                      : '<span class="conflict-claimant-info"><em>Anonymized claimant</em></span>'
                  }
                  <div class="conflict-reasons-wrap">
                    ${(c.reasons || [])
                      .map((r) =>
                        r === "SPATIAL_OVERLAP"
                          ? `<span class="reason-pill">${window.t("conflict.reasons.overlap", "Spatial Overlap")}</span>`
                          : `<span class="reason-pill">${window.t("conflict.reasons.duplicateProof", "Duplicate Proof")}</span>`
                      )
                      .join(" ")}
                  </div>
                </div>
                <form class="conflict-resolve-form" data-conflict-id="${c.conflictId}">
                  <div class="field" style="margin-bottom:8px;">
                    <label style="font-size:12px; font-weight:600; color:var(--ink-soft);">${window.t("conflict.resolve.finding.title", "Determination finding")}</label>
                    <select class="conflict-finding-select" style="width:100%; padding:6px; font-size:13px; border-radius:4px; border:1px solid #d1d5db;" required>
                      <option value="boundaries_do_not_conflict">${window.t("conflict.resolve.finding.boundaries_do_not_conflict", "Boundaries do not conflict")}</option>
                      <option value="shared_use_accepted">${window.t("conflict.resolve.finding.shared_use_accepted", "Shared use accepted")}</option>
                      <option value="this_claim_has_stronger_evidence">${window.t("conflict.resolve.finding.this_claim_has_stronger_evidence", "This claim has stronger evidence")}</option>
                    </select>
                  </div>
                  <div class="field" style="margin-bottom:8px;">
                    <label style="font-size:12px; font-weight:600; color:var(--ink-soft);">${window.t("conflict.resolve.reason", "Written reason (min 10 characters)")}</label>
                    <textarea class="conflict-reason-input" rows="2" placeholder="${window.t("conflict.resolve.reasonPlaceholder", "Enter justification for this resolution...")}" style="width:100%; padding:6px; font-size:13px; border-radius:4px; border:1px solid #d1d5db;" required></textarea>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <button type="submit" class="btn btn-primary btn-sm conflict-resolve-btn" disabled>${window.t("conflict.resolve.submit", "Resolve Conflict")}</button>
                    <span class="conflict-status-msg" style="font-size:12px;"></span>
                  </div>
                </form>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    if (duplicateConflicts.length > 0) {
      conflictBannerHtml += `
        <div class="conflict-banner conflict-banner-duplicate">
          <div class="conflict-banner-header">
            <span class="conflict-banner-icon">ℹ️</span>
            <div>
              <h4 class="conflict-banner-title">${window.t("conflict.banner.duplicate", "Possible Duplicate Claim (Same Applicant)")}</h4>
              <p class="conflict-banner-desc">${window.t("conflict.duplicate.desc", "Another claim by this applicant shares boundaries or proof documents. Advisory only — does not block approval.")}</p>
            </div>
          </div>
        </div>
      `;
    }

    if (resolvedConflicts.length > 0) {
      conflictBannerHtml += `
        <div class="conflict-resolved-box">
          <h5 style="margin:0 0 6px; font-size:13px; color:var(--forest);">${window.t("conflict.resolve.resolvedHeader", "Resolved Conflicts")}</h5>
          <ul style="margin:0; padding-left:18px; font-size:12.5px; color:var(--ink-soft);">
            ${resolvedConflicts
              .map(
                (c) =>
                  `<li><strong>${c.otherClaimId}</strong>: ${c.resolution?.finding || "resolved"} — &ldquo;${c.resolution?.reason || ""}&rdquo; (${c.resolution?.resolvedBy || "Officer"})</li>`
              )
              .join("")}
          </ul>
        </div>
      `;
    }

    if (notCheckable) {
      conflictBannerHtml += `
        <div class="conflict-banner conflict-banner-not-checkable" style="margin-bottom:16px; padding:10px 14px; background:#f3f4f6; border-left:4px solid #9ca3af; border-radius:4px; font-size:13px; color:#4b5563;">
          ℹ️ <strong>${window.t("conflict.notCheckable", "Not checkable (no coordinates)")}</strong> — Legacy claim has no coordinates. Spatial overlap cannot be determined.
        </div>
      `;
    }

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
      ${appealHtml}
      ${conflictBannerHtml}

      <div class="drawer-section-title">Documents &amp; AI-assisted classification</div>
      <p class="officials-drawer-note">Suggestions only — tick "Confirm" to have a document count toward the Rule 13 checklist.</p>
      <div id="docsContainer">${docsHtml}</div>

      <div class="drawer-section-title">Map Verification Support</div>
      <p class="officials-drawer-note">Map is verification support. Check against satellite imagery and nearby claims.</p>
      <div id="officialsMapContainer" style="height: 350px; width: 100%; border: 1px solid var(--border-color); border-radius: 4px; background: #eee; margin-bottom: 8px;"></div>
      <div id="officialsMapFlags" class="map-flags-container"></div>
      <div class="map-check-panel" style="margin-bottom: 24px; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
        <label style="display:flex; align-items:center; gap:8px; font-weight:600; cursor:pointer;">
          <input type="checkbox" id="mapCheckToggle"> Location checked on map
        </label>
        <div id="mapCheckObservationPanel" hidden style="margin-top: 12px;">
          <textarea id="mapCheckObservation" rows="2" placeholder="Add observation (optional)..." style="width:100%; border:1px solid #d1d5db; border-radius:4px; padding:8px;"></textarea>
          <button type="button" id="mapCheckConfirmBtn" class="btn btn-primary btn-sm" style="margin-top:8px;">Save Observation</button>
        </div>
        <div id="mapCheckStatus" style="margin-top:8px; font-size:12.5px; color:var(--ink-soft);"></div>
      </div>

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

    wireDocumentActions(claim.claimId);
    wireDecisionActions(claim.claimId, openCompeting.length > 0);
    wireConflictActions(claim.claimId);

    if (geoData && (geoData.location || geoData.geometry)) {
      wireOfficialsMap(claim.claimId, geoData, claim.mapCheck);
    } else {
      document.getElementById('officialsMapContainer').innerHTML = "<p style='padding:20px; text-align:center;'>No map data provided for this claim.</p>";
      document.getElementById('officialsMapFlags').innerHTML = "";
    }
  }

  function wireOfficialsMap(claimId, geo, mapCheck) {
    const mapEl = document.getElementById('officialsMapContainer');
    if (!mapEl) return;
    
    // Check if we need to clean up old map
    if (mapEl._leaflet_id) {
      mapEl._leaflet_id = null;
      mapEl.innerHTML = '';
    }

    const map = L.map('officialsMapContainer', {
      center: geo.location ? [geo.location.lat, geo.location.lng] : [20.5937, 78.9629],
      zoom: 15
    });

    L.tileLayer(window.MapConfig.satelliteTiles.url, {
      attribution: window.MapConfig.satelliteTiles.attribution,
      maxZoom: 19
    }).addTo(map);
    
    const streetLayer = L.tileLayer(window.MapConfig.streetTiles.url, { maxZoom: 19 });
    L.control.layers({ "Satellite": map._layers[Object.keys(map._layers)[0]], "Streets": streetLayer }).addTo(map);

    let claimLayer = null;
    if (geo.geometry) {
      claimLayer = L.geoJSON(geo.geometry, { style: { color: '#0055ff', weight: 2, fillOpacity: 0.2 } }).addTo(map);
      map.fitBounds(claimLayer.getBounds());
    } else if (geo.location) {
      claimLayer = L.marker([geo.location.lat, geo.location.lng]).addTo(map);
      map.setView([geo.location.lat, geo.location.lng], 16);
    }

    // Nearby claims
    if (geo.nearby && geo.nearby.length > 0) {
      const markers = L.featureGroup().addTo(map);
      geo.nearby.forEach(other => {
        let color = other.anonymized ? '#888' : '#e11d48';
        let weight = 1;
        let dashArray = null;
        if (other.conflict) {
          color = '#dc2626';
          weight = 4;
          dashArray = '6, 6';
        }
        const label = other.conflict
          ? `⚠️ Conflicting Claim: ${other.claimId}`
          : other.anonymized
          ? 'Nearby Claim (Anonymized)'
          : `Claim: ${other.claimId}`;
        
        if (other.geometry) {
          L.geoJSON(other.geometry, { style: { color, weight, dashArray, fillOpacity: other.conflict ? 0.3 : 0.1 } }).bindPopup(label).addTo(markers);
        } else if (other.location) {
          L.circleMarker([other.location.lat, other.location.lng], { radius: other.conflict ? 8 : 6, color, weight, dashArray, fillOpacity: 0.6 }).bindPopup(label).addTo(markers);
        }
      });
      if (!claimLayer) map.fitBounds(markers.getBounds());
    }

    setTimeout(() => map.invalidateSize(), 200);

    // Flags
    const flagsEl = document.getElementById('officialsMapFlags');
    if (geo.flags && geo.flags.length > 0) {
      flagsEl.innerHTML = geo.flags.map(f => `<div class="map-flag alert alert-warning" style="margin-bottom:8px;"><strong>${f.label}:</strong> ${f.description}</div>`).join('');
    }

    // Checkbox logic
    const toggle = document.getElementById('mapCheckToggle');
    const obsPanel = document.getElementById('mapCheckObservationPanel');
    const obsInput = document.getElementById('mapCheckObservation');
    const saveBtn = document.getElementById('mapCheckConfirmBtn');
    const statusEl = document.getElementById('mapCheckStatus');

    if (mapCheck && mapCheck.officerConfirmed) {
      toggle.checked = true;
      obsPanel.hidden = false;
      obsInput.value = mapCheck.observation || "";
      statusEl.textContent = `Confirmed by ${mapCheck.confirmedBy} on ${new Date(mapCheck.confirmedAt).toLocaleDateString()}`;
    }

    toggle.addEventListener('change', () => {
      obsPanel.hidden = !toggle.checked;
      if (!toggle.checked) {
        // Send uncheck immediately
        saveMapCheck(false, "");
      }
    });

    saveBtn.addEventListener('click', () => {
      saveMapCheck(true, obsInput.value);
    });

    async function saveMapCheck(checked, observation) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const res = await window.Auth.authFetch(`${API_BASE}/claims/${claimId}/map-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationChecked: checked, observation })
        });
        const data = await res.json();
        if (res.ok) {
          if (checked) {
            statusEl.textContent = `Saved observation.`;
          } else {
            statusEl.textContent = `Unchecked map verification.`;
            obsInput.value = "";
          }
        } else {
          alert(data.error);
          toggle.checked = !checked;
        }
      } catch(e) {
        alert("Failed to save map check.");
      }
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Observation";
    }
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
          <a href="#" class="auth-doc-link" data-url="${doc.url}">${doc.originalName}</a>
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

  function wireDecisionActions(claimId, hasOpenCompetingConflict = false) {
    const approveBtn = document.getElementById("approveBtn");
    const rejectToggleBtn = document.getElementById("rejectToggleBtn");
    const rejectPanel = document.getElementById("rejectPanel");
    const justificationInput = document.getElementById("justificationInput");
    const confirmRejectBtn = document.getElementById("confirmRejectBtn");
    const cancelRejectBtn = document.getElementById("cancelRejectBtn");
    const decisionMsg = document.getElementById("decisionMsg");

    if (hasOpenCompetingConflict && approveBtn) {
      approveBtn.disabled = true;
      approveBtn.title = window.t(
        "conflict.approve.blocked",
        "All competing claim conflicts must be resolved before this claim can be approved."
      );
      approveBtn.style.opacity = "0.5";
      approveBtn.style.cursor = "not-allowed";
    }

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

    if (approveBtn && !hasOpenCompetingConflict) {
      approveBtn.addEventListener("click", () => submitDecision({ action: "approve" }, approveBtn));
    }

    rejectToggleBtn.addEventListener("click", () => {
      rejectPanel.hidden = !rejectPanel.hidden;
    });
    cancelRejectBtn.addEventListener("click", () => {
      rejectPanel.hidden = true;
      justificationInput.value = "";
      confirmRejectBtn.disabled = true;
    });
    justificationInput.addEventListener("input", () => {
      confirmRejectBtn.disabled = justificationInput.value.trim().length < 10;
    });
    confirmRejectBtn.addEventListener("click", () =>
      submitDecision({ action: "reject", justification: justificationInput.value.trim() }, confirmRejectBtn)
    );
  }

  function wireConflictActions(claimId) {
    drawerContent.querySelectorAll(".conflict-resolve-form").forEach((form) => {
      const conflictId = form.dataset.conflictId;
      const select = form.querySelector(".conflict-finding-select");
      const textarea = form.querySelector(".conflict-reason-input");
      const submitBtn = form.querySelector(".conflict-resolve-btn");
      const statusMsg = form.querySelector(".conflict-status-msg");

      if (!textarea || !submitBtn) return;

      textarea.addEventListener("input", () => {
        submitBtn.disabled = textarea.value.trim().length < 10;
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const finding = select.value;
        const reason = textarea.value.trim();
        if (reason.length < 10) return;

        submitBtn.disabled = true;
        statusMsg.textContent = "Resolving...";
        statusMsg.style.color = "var(--ink-soft)";

        try {
          const res = await window.Auth.authFetch(`${API_BASE}/claims/${claimId}/conflicts/${conflictId}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ finding, reason }),
          });
          const data = await res.json();
          if (!res.ok) {
            statusMsg.textContent = data.error || "Failed to resolve conflict.";
            statusMsg.style.color = "var(--clay)";
            submitBtn.disabled = false;
            return;
          }

          statusMsg.textContent = "Resolved!";
          statusMsg.style.color = "var(--forest)";
          setTimeout(async () => {
            await renderClaimReview(claimId);
            loadQueue();
          }, 700);
        } catch (err) {
          statusMsg.textContent = "Network error";
          statusMsg.style.color = "var(--clay)";
          submitBtn.disabled = false;
        }
      });
    });
  }

  // Export for external callers (such as Atlas)
  window.officials = {
    openReviewDrawer: openOfficialsDrawer,
    refreshOfficialsTabView: refreshOfficialsTabView,
  };
})();

