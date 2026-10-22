/**
 * TribalEarth AI — shared authentication (role-based login)
 * ------------------------------------------------------------
 * See services/authService.js on the backend for the honesty
 * contract on what this login system is (real, hashed-password,
 * server-verified sessions) and isn't (production user management).
 *
 * Exposes window.Auth for app.js and officials.js to use:
 *   Auth.getToken() / Auth.getRole() / Auth.getDisplayName()
 *   Auth.isLoggedIn() / Auth.hasRole(...roles)
 *   Auth.authFetch(url, options) — fetch with Authorization attached
 *   Auth.openLoginModal() / Auth.logout()
 *   Auth.onChange(callback) — fires after login/logout
 */

(function () {
  const STORAGE_KEY = "te_session"; // { token, role, displayName }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function setSession(session) {
    if (session) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    renderHeader();
    changeListeners.forEach((cb) => cb());
  }

  const changeListeners = [];

  function getToken() {
    return getSession()?.token || null;
  }
  function getRole() {
    return getSession()?.role || null;
  }
  function getDisplayName() {
    return getSession()?.displayName || null;
  }
  function isLoggedIn() {
    return Boolean(getToken());
  }
  function hasRole(...roles) {
    const role = getRole();
    return role != null && roles.includes(role);
  }

  async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }

  const ROLE_LABELS = {
    applicant: "Applicant",
    gram_sabha: "Gram Sabha Officer",
    sdlc: "SDLC Officer",
    dlc: "DLC Officer",
  };

  function updateTabNumbers() {
    const allTabBtns = Array.from(document.querySelectorAll(".tab-nav .tab-btn"));
    let counter = 1;
    allTabBtns.forEach((btn) => {
      const isVisible = btn.style.display !== "none" && !btn.hidden;
      const indexSpan = btn.querySelector(".tab-index");
      if (isVisible) {
        if (indexSpan) {
          indexSpan.textContent = String(counter).padStart(2, "0");
        }
        counter++;
      } else {
        if (indexSpan) {
          indexSpan.textContent = "";
        }
      }
    });
  }

  function renderHeader() {
    const label = document.getElementById("sessionLabel");
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    if (!label || !loginBtn || !logoutBtn) return;

    const session = getSession();
    const appContainer = document.getElementById("appContainer");
    const landingContainer = document.getElementById("landingContainer");

    if (session) {
      label.hidden = false;
      const roleLabel = ROLE_LABELS[session.role] || session.role;
      // Show role label and display name only when they differ; otherwise show once
      if (session.displayName && session.displayName.trim().toLowerCase() !== roleLabel.trim().toLowerCase()) {
        label.textContent = `${session.displayName} · ${roleLabel}`;
      } else {
        label.textContent = roleLabel;
      }
      loginBtn.hidden = true;
      logoutBtn.hidden = false;
      
      applyAuthView(session);
      applyRoleVisibility(session ? session.role : null);
    } else {
      label.hidden = true;
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
      
      applyAuthView(session);
      applyRoleVisibility(session ? session.role : null);
    }
  }

  function applyAuthView(session) {
    const appContainer = document.getElementById("appContainer");
    const landingContainer = document.getElementById("landingContainer");

    if (session) {
      if (appContainer) {
        appContainer.hidden = false;
        appContainer.style.display = ""; // Let CSS take over
      }
      if (landingContainer) {
        landingContainer.hidden = true;
        landingContainer.style.display = "none";
      }
    } else {
      if (appContainer) {
        appContainer.hidden = true;
        appContainer.style.display = "none";
      }
      if (landingContainer) {
        landingContainer.hidden = false;
        landingContainer.style.display = ""; // Let CSS take over
      }
    }
  }

  function applyRoleVisibility(role) {
    const tabFile = document.querySelector('.tab-btn[data-tab="file"]');
    const tabRegister = document.querySelector('.tab-btn[data-tab="register"]');
    const tabOfficials = document.querySelector('.tab-btn[data-tab="officials"]');
    const tabMyClaims = document.querySelector('.tab-btn[data-tab="myclaims"]');
    const tabAtlas = document.querySelector('.tab-btn[data-tab="atlas"]');

    const panelFile = document.getElementById("tab-file");
    const panelRegister = document.getElementById("tab-register");
    const panelOfficials = document.getElementById("tab-officials");
    const panelMyClaims = document.getElementById("tab-myclaims");
    const panelAtlas = document.getElementById("tab-atlas");
    
    if (!tabFile || !tabRegister || !tabOfficials) return;

    if (!role || role === 'applicant') {
      // Applicant sees: File a Claim, Claims Register, My Claims
      tabFile.style.display = '';
      tabFile.hidden = false;
      tabRegister.style.display = '';
      tabRegister.hidden = false;
      if (tabMyClaims) {
        tabMyClaims.style.display = '';
        tabMyClaims.hidden = false;
      }
      tabOfficials.style.display = 'none';
      tabOfficials.hidden = true;
      if (tabAtlas) {
        tabAtlas.style.display = 'none';
        tabAtlas.hidden = true;
      }

      // Hide officer panels completely
      if (panelOfficials) panelOfficials.hidden = true;
      if (panelAtlas) panelAtlas.hidden = true;
      if (panelFile) panelFile.hidden = false;
      if (panelRegister) panelRegister.hidden = false;
      if (panelMyClaims) panelMyClaims.hidden = false;
    } else {
      // Officer roles (gram_sabha, sdlc, dlc): Officials Review, Atlas ONLY
      // Claims Register, File a Claim, and My Claims must NOT be visible to officers
      tabFile.style.display = 'none';
      tabFile.hidden = true;
      tabRegister.style.display = 'none';
      tabRegister.hidden = true;
      if (tabMyClaims) {
        tabMyClaims.style.display = 'none';
        tabMyClaims.hidden = true;
      }
      tabOfficials.style.display = '';
      tabOfficials.hidden = false;
      if (tabAtlas) {
        tabAtlas.style.display = '';
        tabAtlas.hidden = false;
      }

      // Hide applicant panels completely
      if (panelFile) panelFile.hidden = true;
      if (panelRegister) panelRegister.hidden = true;
      if (panelMyClaims) panelMyClaims.hidden = true;
      if (panelOfficials) panelOfficials.hidden = false;
      if (panelAtlas) panelAtlas.hidden = false;
    }

    // Dynamic numbering of visible tabs (01, 02, ...)
    updateTabNumbers();

    // Default tab selection per role:
    // Officers -> Officials Review
    // Applicants -> File a Claim (first visible tab)
    const activeTabBtn = document.querySelector('.tab-btn.is-active');
    const isOfficer = role && ['gram_sabha', 'sdlc', 'dlc'].includes(role);
    const targetDefaultTab = isOfficer ? tabOfficials : tabFile;

    const isCurrentActiveForbidden = !activeTabBtn || activeTabBtn.style.display === 'none' || activeTabBtn.hidden;
    if (isCurrentActiveForbidden || (isOfficer && activeTabBtn.dataset.tab !== 'officials' && activeTabBtn.dataset.tab !== 'atlas')) {
      if (targetDefaultTab) {
        targetDefaultTab.click();
      }
    }
  }

  /* ---------------- login modal ---------------- */
  const loginOverlay = document.getElementById("loginOverlay");
  const loginModal = document.getElementById("loginModal");
  const loginModalClose = document.getElementById("loginModalClose");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");

  function openLoginModal() {
    loginError.hidden = true;
    loginForm.reset();
    loginModal.classList.add("is-open");
    loginOverlay.classList.add("is-open");
    loginModal.setAttribute("aria-hidden", "false");
    document.getElementById("loginUsername").focus();
  }

  function closeLoginModal() {
    loginModal.classList.remove("is-open");
    loginOverlay.classList.remove("is-open");
    loginModal.setAttribute("aria-hidden", "true");
  }

  document.getElementById("loginBtn")?.addEventListener("click", openLoginModal);
  document.getElementById("officialsLoginBtn")?.addEventListener("click", openLoginModal);
  loginModalClose.addEventListener("click", closeLoginModal);
  loginOverlay.addEventListener("click", closeLoginModal);

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    loginSubmitBtn.disabled = true;
    loginError.hidden = true;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || "Login failed.";
        loginError.hidden = false;
        return;
      }
      setSession({ token: data.token, role: data.role, displayName: data.displayName });
      closeLoginModal();
      
      if (data.role === 'applicant') {
        document.querySelector('.tab-btn[data-tab="myclaims"]')?.click();
      } else {
        document.querySelector('.tab-btn[data-tab="officials"]')?.click();
      }
    } catch (err) {
      loginError.textContent = "Could not reach the server. Please try again.";
      loginError.hidden = false;
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
  });

  renderHeader();

  window.Auth = {
    getToken,
    getRole,
    getDisplayName,
    isLoggedIn,
    hasRole,
    authFetch,
    openLoginModal,
    onChange: (cb) => changeListeners.push(cb),
    syncSession: () => setSession(getSession()),
  };
})();
