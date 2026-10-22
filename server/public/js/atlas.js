/**
 * TribalEarth AI — Atlas Module (Read-only for Officers)
 * Displays all mapped forest-rights claims as labelled boundaries/points,
 * coloured by status, with viewport loading, polling, and detailed review side panel.
 */

(function () {
  const API_BASE = "/api";

  // Shared escape helper: ensures all user-typed strings are HTML-safe
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Color styles corresponding to status
  const STATUS_STYLES = {
    "Submitted": { color: "#d97706", fillColor: "#f59e0b", dashArray: null, weight: 2 },
    "Under Review": { color: "#d97706", fillColor: "#f59e0b", dashArray: null, weight: 2 },
    "Escalated to DLC": { color: "#ea580c", fillColor: "#f97316", dashArray: null, weight: 2 },
    "Appealed": { color: "#7c3aed", fillColor: "#8b5cf6", dashArray: null, weight: 2 },
    "Approved": { color: "#15803d", fillColor: "#22c55e", dashArray: null, weight: 3 },
    "Rejected": { color: "#6b7280", fillColor: "#9ca3af", dashArray: "5, 5", weight: 2 },
  };

  let map = null;
  let featuresLayer = null;
  let streetsTileLayer = null;
  let satelliteTileLayer = null;
  let activeClaimId = null;

  let currentAbortController = null;
  let pollIntervalId = null;
  let lastSeenClaimIds = new Set();
  let isFirstLoad = true;
  let hasInitialFit = false;
  let debounceTimer = null;

  // Cached raw GeoJSON data for zoom threshold switching
  let currentRawData = null;
  let lastRenderedZoom = null;

  // New claims toast state
  let latestNewClaim = null;

  function initMap() {
    if (map) return;
    const mapEl = document.getElementById("atlasMap");
    if (!mapEl) return;

    // Use mapConfig tile layers if present
    const streetUrl = window.MapConfig?.streetTiles?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const streetAttribution = window.MapConfig?.streetTiles?.attribution || "&copy; OpenStreetMap contributors";
    const satUrl = window.MapConfig?.satelliteTiles?.url || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    const satAttribution = window.MapConfig?.satelliteTiles?.attribution || "Tiles &copy; Esri";

    streetsTileLayer = L.tileLayer(streetUrl, { attribution: streetAttribution, maxZoom: 19 });
    satelliteTileLayer = L.tileLayer(satUrl, { attribution: satAttribution, maxZoom: 19 });

    // Initialize map centered on central India
    map = L.map(mapEl, {
      center: [22.5, 82.5],
      zoom: 6,
      layers: [streetsTileLayer],
    });

    const baseMaps = {
      "Streets": streetsTileLayer,
      "Satellite": satelliteTileLayer,
    };
    L.control.layers(baseMaps, null, { position: "topright" }).addTo(map);

    featuresLayer = L.geoJSON(null, {
      style: featureStyle,
      pointToLayer: pointToLayer,
      onEachFeature: onEachFeature,
    }).addTo(map);

    map.on("moveend", () => {
      debouncedFetchFeatures();
      updatePermanentTooltips();
    });

    map.on("zoomend", () => {
      const currentZoom = map.getZoom();
      // If we crossed the zoom 13 threshold, re-render layer from memory
      if (currentRawData && lastRenderedZoom != null) {
        const wasLowZoom = lastRenderedZoom < 13;
        const isLowZoom = currentZoom < 13;
        if (wasLowZoom !== isLowZoom) {
          applyFeaturesToLayer(currentRawData);
        }
      }
      updatePermanentTooltips();
    });
  }

  function featureStyle(feature) {
    const props = feature.properties || {};
    const base = STATUS_STYLES[props.status] || STATUS_STYLES["Submitted"];
    const style = {
      color: base.color,
      fillColor: base.fillColor,
      fillOpacity: props.boundaryKind === "polygon" ? 0.35 : 0.6,
      weight: base.weight,
      dashArray: base.dashArray,
      className: getFeatureClassNames(props),
    };

    if (props.hasOpenConflict) {
      style.color = "#dc2626";
      style.dashArray = "6, 4";
      style.weight = 4;
    }
    return style;
  }

  function pointToLayer(feature, latlng) {
    const props = feature.properties || {};
    const base = STATUS_STYLES[props.status] || STATUS_STYLES["Submitted"];
    const marker = L.circleMarker(latlng, {
      radius: 8,
      color: props.hasOpenConflict ? "#dc2626" : "#ffffff",
      fillColor: base.color,
      fillOpacity: 0.9,
      weight: props.hasOpenConflict ? 3 : 2,
      dashArray: props.hasOpenConflict ? "3, 3" : null,
      className: getFeatureClassNames(props),
    });
    return marker;
  }

  function getFeatureClassNames(props) {
    let classes = "atlas-feature-layer";
    if (isNewClaim(props.createdAt)) {
      classes += " is-new-pulsing";
    }
    return classes;
  }

  function isNewClaim(createdAt) {
    if (!createdAt) return false;
    const t = new Date(createdAt).getTime();
    if (isNaN(t)) return false;
    // Created in the last 10 minutes
    return Date.now() - t < 10 * 60 * 1000;
  }

  function onEachFeature(feature, layer) {
    const props = feature.properties || {};
    const isNew = isNewClaim(props.createdAt);
    const newTag = isNew ? ` <span class="atlas-tooltip-new">${window.t("atlas.newBadge", "New")}</span>` : "";
    const tooltipContent = `<strong>${escapeHtml(props.applicantName || props.claimId)}</strong> (${escapeHtml(props.claimType || "IFR")})${newTag}`;

    layer.bindTooltip(tooltipContent, {
      direction: "top",
      sticky: false,
    });

    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      openClaimDetail(props.claimId);
    });
  }

  function updatePermanentTooltips() {
    if (!map || !featuresLayer) return;
    const zoom = map.getZoom();
    const shouldBePermanent = zoom >= 15;

    featuresLayer.eachLayer((layer) => {
      const tooltip = layer.getTooltip();
      if (tooltip) {
        if (shouldBePermanent && !tooltip.options.permanent) {
          layer.unbindTooltip();
          layer.bindTooltip(tooltip.getContent(), {
            permanent: true,
            direction: "top",
          });
        } else if (!shouldBePermanent && tooltip.options.permanent) {
          layer.unbindTooltip();
          layer.bindTooltip(tooltip.getContent(), {
            permanent: false,
            direction: "top",
          });
        }
      }
    });
  }

  function debouncedFetchFeatures() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchViewportFeatures();
    }, 300);
  }

  async function fetchSummary() {
    try {
      const res = await window.Auth.authFetch(`${API_BASE}/atlas/summary`);
      if (!res.ok) return;
      const data = await res.json();
      populateVillages(data.villages || []);
      renderSummaryChips(data);
    } catch (err) {
      console.error("[Atlas] fetchSummary error:", err);
    }
  }

  function populateVillages(villages) {
    const select = document.getElementById("atlasVillageSelect");
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = `<option value="">${window.t("atlas.filterVillage", "All villages")}</option>`;

    villages.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.village;
      opt.textContent = `${v.village} (${v.count})`;
      opt.dataset.bbox = (v.bbox || []).join(",");
      select.appendChild(opt);
    });

    select.value = currentVal;
  }

  function renderSummaryChips(data) {
    const notMappedEl = document.getElementById("atlasNotMappedMsg");
    if (notMappedEl) {
      if (data.notMapped > 0) {
        notMappedEl.hidden = false;
        notMappedEl.textContent = window.t("atlas.notMappedCount", "{count} claims not mapped (no coordinates)").replace("{count}", data.notMapped);
      } else {
        notMappedEl.hidden = true;
      }
    }
  }

  async function fetchViewportFeatures(isBackgroundPoll = false) {
    if (!map) return;
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    const bounds = map.getBounds();
    const minLng = bounds.getWest();
    const minLat = bounds.getSouth();
    const maxLng = bounds.getEast();
    const maxLat = bounds.getNorth();
    const bboxParam = `${minLng},${minLat},${maxLng},${maxLat}`;

    const villageSelect = document.getElementById("atlasVillageSelect");
    const statusSelect = document.getElementById("atlasStatusSelect");
    const claimTypeSelect = document.getElementById("atlasClaimTypeSelect");
    const disputedToggle = document.getElementById("atlasDisputedToggle");

    const params = new URLSearchParams({
      bbox: bboxParam,
      limit: "500",
    });

    if (villageSelect && villageSelect.value) params.set("village", villageSelect.value);
    if (statusSelect && statusSelect.value) params.set("status", statusSelect.value);
    if (claimTypeSelect && claimTypeSelect.value) params.set("claimType", claimTypeSelect.value);
    if (disputedToggle && disputedToggle.checked) params.set("conflict", "true");

    try {
      const res = await window.Auth.authFetch(`${API_BASE}/atlas/features?${params.toString()}`, {
        signal: currentAbortController.signal,
      });

      if (!res.ok) return;
      const data = await res.json();
      renderFeatures(data, isBackgroundPoll);
      updateLastUpdatedTimestamp();
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[Atlas] fetchFeatures error:", err);
      }
    }
  }

  function applyFeaturesToLayer(data) {
    if (!featuresLayer || !map) return;

    const currentZoom = map.getZoom();
    lastRenderedZoom = currentZoom;
    featuresLayer.clearLayers();

    const features = data?.features || [];
    features.forEach((f) => {
      const claimId = f.properties?.claimId || "unknown";
      try {
        let featureToRender = f;
        // Below zoom 13: represent as circleMarker at centroid / point
        if (currentZoom < 13 && (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon")) {
          // Compute centroid from coordinates
          let sumLng = 0, sumLat = 0, count = 0;
          const coords = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
          if (Array.isArray(coords)) {
            coords.forEach(([lng, lat]) => {
              if (typeof lng === "number" && typeof lat === "number") {
                sumLng += lng;
                sumLat += lat;
                count++;
              }
            });
          }
          if (count > 0) {
            featureToRender = {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [sumLng / count, sumLat / count],
              },
              properties: f.properties,
            };
          }
        }
        featuresLayer.addData(featureToRender);
      } catch (err) {
        console.warn(`[Atlas] Cannot draw geometry for claim ${claimId}`, err);
      }
    });

    updatePermanentTooltips();
  }

  function renderFeatures(data, isBackgroundPoll) {
    if (!featuresLayer) return;

    currentRawData = data;

    // Detect newly added claims
    const currentBatchIds = new Set();
    const newlyDiscovered = [];

    (data.features || []).forEach((f) => {
      const id = f.properties?.claimId;
      if (id) {
        currentBatchIds.add(id);
        if (!isFirstLoad && !lastSeenClaimIds.has(id)) {
          newlyDiscovered.push(f);
        }
      }
    });

    // Update lastSeenClaimIds
    currentBatchIds.forEach((id) => lastSeenClaimIds.add(id));

    // Toast: never empty, only on subsequent background polls, only when newly discovered IDs exist
    if (newlyDiscovered.length > 0 && isBackgroundPoll && !isFirstLoad) {
      latestNewClaim = newlyDiscovered[0];
      showNewToast(newlyDiscovered.length);
    }

    applyFeaturesToLayer(data);

    // Initial fit to all loaded features if no village filter selected
    const villageSelect = document.getElementById("atlasVillageSelect");
    if (!hasInitialFit && (!villageSelect || !villageSelect.value)) {
      if (featuresLayer.getLayers().length > 0) {
        try {
          const bounds = featuresLayer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { maxZoom: 16, padding: [30, 30] });
            hasInitialFit = true;
          }
        } catch (e) {}
      }
    }

    if (isFirstLoad) {
      isFirstLoad = false;
    }

    // Truncated chip
    const truncatedEl = document.getElementById("atlasTruncatedMsg");
    if (truncatedEl) {
      if (data.truncated) {
        truncatedEl.hidden = false;
        truncatedEl.textContent = window.t(
          "atlas.truncated",
          "Showing first {count} of {total}, zoom in to see more"
        )
          .replace("{count}", data.features.length)
          .replace("{total}", data.total);
      } else {
        truncatedEl.hidden = true;
      }
    }
  }

  function showNewToast(count) {
    if (!count || count <= 0) return;
    const toast = document.getElementById("atlasNewToast");
    const textEl = document.getElementById("atlasToastText");
    if (!toast || !textEl) return;

    textEl.textContent = window.t("atlas.newToast", "{count} new claim(s) added").replace("{count}", count);
    toast.hidden = false;
  }

  function updateLastUpdatedTimestamp() {
    const el = document.getElementById("atlasLastUpdated");
    if (!el) return;
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0]; // hh:mm:ss
    el.textContent = `${window.t("atlas.lastUpdated", "Last updated")} ${timeStr}`;
  }

  async function openClaimDetail(claimId) {
    activeClaimId = claimId;
    const panel = document.getElementById("atlasSidePanel");
    if (!panel) return;

    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");

    // Loading skeleton
    const nameEl = document.getElementById("atlasPanelApplicantName");
    const claimIdEl = document.getElementById("atlasPanelClaimId");
    const statusEl = document.getElementById("atlasPanelStatusBadge");
    const typeEl = document.getElementById("atlasPanelTypeBadge");
    const boundaryEl = document.getElementById("atlasPanelBoundaryStatus");
    const metaRowsEl = document.getElementById("atlasPanelMetaRows");
    const conflictsEl = document.getElementById("atlasPanelConflicts");
    const rejectionAppealEl = document.getElementById("atlasPanelRejectionAppeal");
    const timelineEl = document.getElementById("atlasPanelTimeline");
    const proofsEl = document.getElementById("atlasPanelProofs");
    const checklistEl = document.getElementById("atlasPanelChecklist");
    const actionAreaEl = document.getElementById("atlasPanelActionArea");

    nameEl.textContent = window.t("atlas.loadingDetail", "Loading claim details…");
    claimIdEl.textContent = claimId;
    statusEl.textContent = "";
    typeEl.textContent = "";
    boundaryEl.innerHTML = "";
    metaRowsEl.innerHTML = "";
    conflictsEl.hidden = true;
    rejectionAppealEl.hidden = true;
    timelineEl.innerHTML = "";
    proofsEl.innerHTML = "";
    checklistEl.innerHTML = "";
    actionAreaEl.hidden = true;

    try {
      const res = await window.Auth.authFetch(`${API_BASE}/atlas/claims/${claimId}`);
      if (!res.ok) {
        nameEl.textContent = window.t("atlas.loadDetailError", "Could not load claim details.");
        return;
      }

      const data = await res.json();
      const claim = data.claim;

      nameEl.textContent = claim.applicantName || "—";
      claimIdEl.textContent = claim.claimId;
      statusEl.className = `status-badge status-${(claim.status || "").toLowerCase().replace(/\s+/g, "-")}`;
      statusEl.textContent = claim.status || "Submitted";
      typeEl.className = `type-badge type-${claim.claimType}`;
      typeEl.textContent = claim.claimType;

      // Claimed boundary vs verified on map
      if (claim.verifiedOnMap && claim.mapCheck) {
        const vDate = claim.mapCheck.confirmedAt ? new Date(claim.mapCheck.confirmedAt).toLocaleDateString() : "";
        boundaryEl.innerHTML = `<span class="atlas-badge-verified">✓ ${escapeHtml(
          window.t("atlas.verifiedOnMap", "Verified on map by {officer} on {date}")
            .replace("{officer}", claim.mapCheck.confirmedBy || "Officer")
            .replace("{date}", vDate)
        )}</span>`;
      } else {
        boundaryEl.innerHTML = `<span class="atlas-badge-unverified">${escapeHtml(
          window.t("atlas.claimedBoundary", "Claimed boundary (unverified)")
        )}</span>`;
      }

      // Meta rows (Area, Occupation since, Granted on)
      const rows = [];
      if (claim.areaHa != null) {
        rows.push(`<div class="atlas-meta-item"><span class="meta-label">Claimed Area:</span> <span class="meta-val">${claim.areaHa} ha</span></div>`);
      }
      if (claim.occupationSinceYear != null) {
        rows.push(`<div class="atlas-meta-item"><span class="meta-label">${escapeHtml(window.t("atlas.occupationSince", "Occupation since"))}:</span> <span class="meta-val">${claim.occupationSinceYear}</span></div>`);
      }
      if (claim.grantedAt) {
        const gDate = new Date(claim.grantedAt).toLocaleDateString();
        rows.push(`<div class="atlas-meta-item"><span class="meta-label">${escapeHtml(window.t("atlas.grantedOn", "Granted on"))}:</span> <span class="meta-val">${gDate}</span></div>`);
      }
      rows.push(`<div class="atlas-meta-item"><span class="meta-label">Location:</span> <span class="meta-val">${escapeHtml(claim.village)}, ${escapeHtml(claim.district)}</span></div>`);

      metaRowsEl.innerHTML = rows.join("");

      // Conflicts
      if (claim.conflicts && claim.conflicts.length > 0) {
        conflictsEl.hidden = false;
        const confRows = claim.conflicts.map((c) => {
          const kindLabel = c.kind === "duplicate" ? "Duplicate (Same Applicant)" : "Competing Claim";
          return `<div class="conflict-item alert alert-warning" style="margin-bottom:6px; font-size:13px;">
            <strong>${escapeHtml(kindLabel)}:</strong> Other claim ${escapeHtml(c.otherClaimId)} (${escapeHtml((c.reasons || []).join(", "))}) - <em>${escapeHtml(c.status)}</em>
          </div>`;
        }).join("");
        conflictsEl.innerHTML = `<h4>Conflicts</h4>${confRows}`;
      } else {
        conflictsEl.hidden = true;
      }

      // Rejection or Appeal
      if (claim.rejectionReason || claim.priorRejection || claim.appeal) {
        rejectionAppealEl.hidden = false;
        let content = "";
        if (claim.rejectionReason) {
          content += `<div class="alert alert-error" style="margin-bottom:6px;"><strong>Rejection Reason:</strong> ${escapeHtml(claim.rejectionReason)}</div>`;
        }
        if (claim.priorRejection) {
          content += `<div class="alert alert-warning" style="margin-bottom:6px;"><strong>Prior Stage Rejection:</strong> ${escapeHtml(claim.priorRejection.reason)} (${escapeHtml(claim.priorRejection.stage)})</div>`;
        }
        if (claim.appeal) {
          content += `<div class="alert alert-info" style="margin-bottom:6px;"><strong>Appeal Grounds:</strong> ${escapeHtml(claim.appeal.grounds)}</div>`;
        }
        rejectionAppealEl.innerHTML = content;
      } else {
        rejectionAppealEl.hidden = true;
      }

      // Timeline (Last 15)
      if (claim.timeline && claim.timeline.length > 0) {
        timelineEl.innerHTML = claim.timeline.map((item) => {
          const tDate = item.timestamp ? new Date(item.timestamp).toLocaleString() : "";
          return `<li class="audit-trail-item">
            <div class="audit-trail-action"><strong>${escapeHtml(item.action)}</strong> (${escapeHtml(item.stage)})</div>
            <div class="audit-trail-actor" style="font-size:12px; color:var(--ink-soft);">${escapeHtml(item.actor)} &middot; ${tDate}</div>
            ${item.note ? `<div class="audit-trail-note" style="margin-top:2px;">${escapeHtml(item.note)}</div>` : ""}
          </li>`;
        }).join("");
      } else {
        timelineEl.innerHTML = `<li>No timeline records.</li>`;
      }

      // Proofs with confirmed categories
      if (claim.documents && claim.documents.length > 0) {
        proofsEl.innerHTML = claim.documents.map((d) => {
          const catLabel = d.confirmedCategory ? `<span class="doc-confirmed-tag">Rule 13: ${escapeHtml(d.confirmedCategory)}</span>` : `<span class="doc-unclassified-tag">${window.t("atlas.unclassified", "Unclassified")}</span>`;
          return `<li class="atlas-proof-item">
            <button type="button" class="btn btn-ghost btn-sm proof-download-btn" data-url="${escapeHtml(d.url)}" data-filename="${escapeHtml(d.originalName)}">
              📄 ${escapeHtml(d.originalName)}
            </button>
            <div class="doc-tag-wrap">${catLabel}</div>
          </li>`;
        }).join("");

        // Proof download handlers with Bearer token
        proofsEl.querySelectorAll(".proof-download-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const url = btn.dataset.url;
            const originalName = btn.dataset.filename;
            try {
              const fileRes = await window.Auth.authFetch(url);
              if (!fileRes.ok) {
                alert(window.t("atlas.loadDetailError", "Could not load document."));
                return;
              }
              const blob = await fileRes.blob();
              const objectUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = objectUrl;
              a.download = originalName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            } catch (err) {
              console.error("[Atlas] Document download failed:", err);
              alert(window.t("atlas.loadDetailError", "Could not load document."));
            }
          });
        });
      } else {
        proofsEl.innerHTML = `<li>${window.t("atlas.noProofAvailable", "No proof documents attached.")}</li>`;
      }

      // Rule 13 Checklist
      if (claim.checklist) {
        const covered = claim.checklist.coveredCategories || [];
        const required = 2;
        checklistEl.innerHTML = `<p style="margin-bottom:6px;"><strong>${covered.length}</strong> / ${required} recommended categories confirmed.</p>
          <ul class="checklist-items">
            ${covered.map((c) => `<li>✓ ${escapeHtml(c)}</li>`).join("")}
          </ul>`;
      }

      // Check if logged-in officer is authorized for claim's current stage
      const userRole = window.Auth?.getRole();
      const currentStage = claim.stage;
      const stageRoleMap = {
        "Gram Sabha": "gram_sabha",
        "SDLC": "sdlc",
        "DLC": "dlc",
      };

      if (userRole && stageRoleMap[currentStage] === userRole) {
        actionAreaEl.hidden = false;
        const reviewBtn = document.getElementById("atlasOpenFullReviewBtn");
        reviewBtn.onclick = () => {
          // Open the officials review drawer
          closePanel();
          if (window.officials && typeof window.officials.openReviewDrawer === "function") {
            window.officials.openReviewDrawer(claim.claimId);
          } else {
            if (typeof window.switchTab === "function") {
              window.switchTab("officials");
            }
          }
        };
      } else {
        actionAreaEl.hidden = true;
      }
    } catch (err) {
      console.error("[Atlas] openClaimDetail error:", err);
      nameEl.textContent = window.t("atlas.loadDetailError", "Could not load claim details.");
    }
  }

  function closePanel() {
    const panel = document.getElementById("atlasSidePanel");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
    const nameEl = document.getElementById("atlasPanelApplicantName");
    if (nameEl) nameEl.textContent = "";
    const claimIdEl = document.getElementById("atlasPanelClaimId");
    if (claimIdEl) claimIdEl.textContent = "";
    activeClaimId = null;
  }

  function setupPolling() {
    if (pollIntervalId) clearInterval(pollIntervalId);

    pollIntervalId = setInterval(() => {
      // Re-fetch only when tab is active and document is visible
      const tabAtlas = document.getElementById("tab-atlas");
      if (tabAtlas && tabAtlas.classList.contains("is-active") && document.visibilityState === "visible") {
        fetchViewportFeatures(true);
      }
    }, 20000); // 20s live update

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        const tabAtlas = document.getElementById("tab-atlas");
        if (tabAtlas && tabAtlas.classList.contains("is-active")) {
          fetchViewportFeatures(true);
        }
      }
    });
  }

  function resetFilters() {
    const villageSelect = document.getElementById("atlasVillageSelect");
    const statusSelect = document.getElementById("atlasStatusSelect");
    const claimTypeSelect = document.getElementById("atlasClaimTypeSelect");
    const disputedToggle = document.getElementById("atlasDisputedToggle");

    if (villageSelect) villageSelect.value = "";
    if (statusSelect) statusSelect.value = "";
    if (claimTypeSelect) claimTypeSelect.value = "";
    if (disputedToggle) disputedToggle.checked = false;
  }

  function onFilterChange() {
    closePanel();
    fetchViewportFeatures();
  }

  function setupEventListeners() {
    // Village filter
    const villageSelect = document.getElementById("atlasVillageSelect");
    if (villageSelect) {
      villageSelect.addEventListener("change", () => {
        closePanel();
        const selected = villageSelect.options[villageSelect.selectedIndex];
        const bboxStr = selected?.dataset?.bbox;
        if (bboxStr && map) {
          const parts = bboxStr.split(",").map(Number);
          if (parts.length === 4 && parts.every((n) => !isNaN(n) && isFinite(n))) {
            const isSinglePointOrTiny = Math.abs(parts[2] - parts[0]) < 0.0001 && Math.abs(parts[3] - parts[1]) < 0.0001;
            if (isSinglePointOrTiny) {
              map.setView([(parts[1] + parts[3]) / 2, (parts[0] + parts[2]) / 2], 16);
            } else {
              const bounds = L.latLngBounds([parts[1], parts[0]], [parts[3], parts[2]]);
              map.fitBounds(bounds, { maxZoom: 17, padding: [20, 20] });
            }
          }
        }
        fetchViewportFeatures();
      });
    }

    // Status filter
    const statusSelect = document.getElementById("atlasStatusSelect");
    if (statusSelect) {
      statusSelect.addEventListener("change", onFilterChange);
    }

    // ClaimType filter
    const typeSelect = document.getElementById("atlasClaimTypeSelect");
    if (typeSelect) {
      typeSelect.addEventListener("change", onFilterChange);
    }

    // Disputed toggle
    const disputedToggle = document.getElementById("atlasDisputedToggle");
    if (disputedToggle) {
      disputedToggle.addEventListener("change", onFilterChange);
    }

    // Refresh button
    const refreshBtn = document.getElementById("atlasRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        fetchSummary();
        fetchViewportFeatures();
      });
    }

    // Close side panel
    const closeBtn = document.getElementById("atlasPanelCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", closePanel);
    }

    // Keyboard Esc closes side panel
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePanel();
      }
    });

    // Toast fly to new claim
    const flyBtn = document.getElementById("atlasToastFlyBtn");
    if (flyBtn) {
      flyBtn.addEventListener("click", () => {
        if (latestNewClaim && map) {
          const geom = latestNewClaim.geometry;
          if (geom.type === "Point") {
            map.flyTo([geom.coordinates[1], geom.coordinates[0]], 16);
          } else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
            const layer = L.geoJSON(latestNewClaim);
            map.fitBounds(layer.getBounds(), { maxZoom: 17 });
          }
          openClaimDetail(latestNewClaim.properties.claimId);
        }
        const toast = document.getElementById("atlasNewToast");
        if (toast) toast.hidden = true;
      });
    }

    const dismissToastBtn = document.getElementById("atlasToastDismissBtn");
    if (dismissToastBtn) {
      dismissToastBtn.addEventListener("click", () => {
        const toast = document.getElementById("atlasNewToast");
        if (toast) toast.hidden = true;
      });
    }
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  // Public module API
  window.Atlas = {
    onTabActive: function () {
      initMap();
      resetFilters();
      closePanel();
      if (map) {
        setTimeout(() => {
          map.invalidateSize();
        }, 150);
      }
      fetchSummary();
      fetchViewportFeatures();
      setupPolling();
    },
    onTabInactive: function () {
      stopPolling();
    },
    stopPolling: stopPolling,
    openClaimDetail: openClaimDetail,
  };

  document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
  });
})();

