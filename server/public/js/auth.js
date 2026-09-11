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
      label.textContent = `${session.displayName} · ${ROLE_LABELS[session.role] || session.role}`;
      loginBtn.hidden = true;
      logoutBtn.hidden = false;
    } else {
      label.hidden = true;
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
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
  };
})();
