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

  function renderHeader() {
    const label = document.getElementById("sessionLabel");
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    if (!label || !loginBtn || !logoutBtn) return;

    const session = getSession();

    if (session) {
      label.hidden = false;
      const roleLabel = ROLE_LABELS[session.role] || session.role;
      // Show role label only once:
      label.textContent = roleLabel;
      loginBtn.hidden = true;
      logoutBtn.hidden = false;

      applyAuthView(session);
      renderTabsForRole(session.role);
    } else {
      label.hidden = true;
      loginBtn.hidden = false;
      logoutBtn.hidden = true;

      applyAuthView(null);
      renderTabsForRole(null);
    }
  }

  function applyAuthView(session) {
    const appContainer = document.getElementById("appContainer");
    const landingContainer = document.getElementById("landingContainer");

    if (session) {
      if (appContainer) {
        appContainer.hidden = false;
        appContainer.style.display = "";
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
        landingContainer.style.display = "";
      }
    }
  }

  /* ---------------- role-based tabs config & single source of truth ---------------- */
  const ROLE_TABS = {
    applicant:  ["file", "myclaims"],
    gram_sabha: ["officials", "atlas"],
    sdlc:       ["officials", "atlas"],
    dlc:        ["officials", "atlas"],
  };

  const DEFAULT_TAB = {
    applicant:  "file",
    gram_sabha: "officials",
    sdlc:       "officials",
    dlc:        "officials",
  };

  let currentActiveTabId = null;

  function renderTabsForRole(role) {
    const effectiveRole = role || "applicant";
    const allowedTabs = ROLE_TABS[effectiveRole] || ROLE_TABS.applicant;
    const allTabBtns = Array.from(document.querySelectorAll(".tab-nav .tab-btn"));
    const allPanels = Array.from(document.querySelectorAll(".tab-panel"));

    // 1. Show only allowed tabs, hide all others
    allTabBtns.forEach((btn) => {
      const tabId = btn.dataset.tab;
      const isAllowed = allowedTabs.includes(tabId);
      btn.hidden = !isAllowed;
      btn.style.display = isAllowed ? "" : "none";
    });

    // 2. Compute 01, 02, 03 numbers strictly for visible tabs in DOM order
    let counter = 1;
    allTabBtns.forEach((btn) => {
      if (!btn.hidden && btn.style.display !== "none") {
        const indexSpan = btn.querySelector(".tab-index");
        if (indexSpan) {
          indexSpan.textContent = String(counter).padStart(2, "0");
        }
        counter++;
      }
    });

    // 3. Hide all panels completely first (both attribute and active class)
    allPanels.forEach((p) => {
      p.classList.remove("is-active");
      p.hidden = true;
    });

    // 4. Determine default or valid active tab
    const defaultTab = DEFAULT_TAB[effectiveRole] || "file";
    const targetTab = allowedTabs.includes(currentActiveTabId) ? currentActiveTabId : defaultTab;

    switchTab(targetTab);
  }

  function switchTab(tabId) {
    const session = getSession();
    const effectiveRole = session?.role || "applicant";
    const allowedTabs = ROLE_TABS[effectiveRole] || ROLE_TABS.applicant;

    // Refuse tabs not allowed for the current role; fall back to default
    if (!allowedTabs.includes(tabId)) {
      tabId = DEFAULT_TAB[effectiveRole] || "file";
    }

    const previousTabId = currentActiveTabId;
    currentActiveTabId = tabId;

    // If leaving Atlas tab, stop Atlas polling
    if (previousTabId === "atlas" && tabId !== "atlas") {
      if (window.Atlas && typeof window.Atlas.onTabInactive === "function") {
        window.Atlas.onTabInactive();
      }
    }

    // Update tab button states
    const allTabBtns = document.querySelectorAll(".tab-nav .tab-btn");
    allTabBtns.forEach((b) => {
      const isCurrent = b.dataset.tab === tabId;
      b.classList.toggle("is-active", isCurrent);
      b.setAttribute("aria-selected", isCurrent ? "true" : "false");
    });

    // Update panel states strictly by ID
    const allPanels = document.querySelectorAll(".tab-panel");
    allPanels.forEach((p) => {
      const isCurrent = p.id === `tab-${tabId}`;
      p.classList.toggle("is-active", isCurrent);
      p.hidden = !isCurrent;
    });

    // Lazy initialization & guards based on role and tab
    const isOfficer = ["gram_sabha", "sdlc", "dlc"].includes(effectiveRole);

    if (tabId === "myclaims" && !isOfficer && typeof window.loadMyClaims === "function") {
      window.loadMyClaims();
    }
    if (tabId === "officials" && isOfficer) {
      if (window.officials && typeof window.officials.refreshOfficialsTabView === "function") {
        window.officials.refreshOfficialsTabView();
      }
    }
    if (tabId === "atlas" && isOfficer) {
      if (window.Atlas && typeof window.Atlas.onTabActive === "function") {
        window.Atlas.onTabActive();
      }
    }
  }

  // Expose tab functions globally
  window.renderTabsForRole = renderTabsForRole;
  window.switchTab = switchTab;


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
    } catch (err) {
      loginError.textContent = "Could not reach the server. Please try again.";
      loginError.hidden = false;
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    currentActiveTabId = null;
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
