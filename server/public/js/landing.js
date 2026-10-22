/**
 * TribalEarth AI — Landing Page Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const landingRoleOptions = document.querySelectorAll('input[name="landingRole"]');
  const landingUsername = document.getElementById("landingUsername");
  const landingPassword = document.getElementById("landingPassword");
  const landingSubmitBtn = document.getElementById("landingSubmitBtn");
  const landingLoginForm = document.getElementById("landingLoginForm");
  const landingLoginError = document.getElementById("landingLoginError");

  // Update form inputs when a role card is selected
  landingRoleOptions.forEach(option => {
    option.addEventListener("change", (e) => {
      const label = e.target.dataset.label;
      const demoUser = e.target.dataset.demo;
      
      landingSubmitBtn.textContent = `Log in as ${label}`;
      landingUsername.placeholder = demoUser;
      
      // Update password placeholder to match
      if (demoUser === 'applicant1') {
        landingPassword.placeholder = 'applicant123';
      } else if (demoUser === 'gramsabha1') {
        landingPassword.placeholder = 'gramsabha123';
      } else if (demoUser === 'sdlc1') {
        landingPassword.placeholder = 'sdlc123';
      } else if (demoUser === 'dlc1') {
        landingPassword.placeholder = 'dlc123';
      }
    });
  });

  // Handle landing form submission
  if (landingLoginForm) {
    landingLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = landingUsername.value.trim();
      const password = landingPassword.value;
      
      landingSubmitBtn.disabled = true;
      landingLoginError.hidden = true;

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        
        if (!res.ok) {
          landingLoginError.textContent = data.error || "Login failed.";
          landingLoginError.hidden = false;
          return;
        }
        
        // Use the existing Auth.setSession logic (exposed or we just set it)
        // Let's set it in sessionStorage and trigger the change
        sessionStorage.setItem("te_session", JSON.stringify({ 
          token: data.token, 
          role: data.role, 
          displayName: data.displayName 
        }));
        
        // Re-render header and trigger change listeners if window.Auth is ready
        if (window.Auth && typeof window.Auth.syncSession === 'function') {
          window.Auth.syncSession();
        } else {
          window.dispatchEvent(new CustomEvent('sessionChanged'));
        }
      } catch (err) {
        landingLoginError.textContent = "Could not reach the server. Please try again.";
        landingLoginError.hidden = false;
      } finally {
        landingSubmitBtn.disabled = false;
      }
    });
  }
});
