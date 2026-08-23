// i18n Configuration and Engine for TribalEarth AI
(function() {
  const DEFAULT_LANG = "en";
  const STORAGE_KEY = "tribalearth_lang";
  let currentLanguage = DEFAULT_LANG;
  let translations = {};

  // Resolve dot notation for objects (e.g., 'common.submit')
  function getNestedTranslation(obj, key) {
    if (!obj || !key) return null;
    return key.split('.').reduce((acc, k) => (acc && acc[k] !== undefined) ? acc[k] : null, obj);
  }

  // Translate a key
  window.t = function(key, fallback = "") {
    const value = getNestedTranslation(translations, key);
    return value !== null ? value : fallback || key;
  };

  // Future BHASHINI integration wrapper for dynamic content
  window.translateDynamicText = async function(text, sourceLanguage = "en", targetLanguage = "hi") {
    console.log(`[BHASHINI Prep] Request to translate: "${text}" from ${sourceLanguage} to ${targetLanguage}`);
    // When backend API is implemented, this will call e.g. POST /api/translate
    // For now, return a promise resolving to the text itself (no-op fallback)
    return text;
  };

  // Set the language and update document direction
  window.setLanguage = async function(langCode) {
    const lang = window.LANGUAGES.find(l => l.code === langCode);
    if (!lang) return;

    currentLanguage = langCode;
    localStorage.setItem(STORAGE_KEY, langCode);

    // Set layout direction (RTL or LTR)
    document.documentElement.dir = lang.rtl ? "rtl" : "ltr";
    document.documentElement.lang = langCode;

    // Load translation dictionary
    try {
      const response = await fetch(`/locales/${langCode}.json`);
      if (response.ok) {
        translations = await response.json();
      } else {
        throw new Error(`Failed to load ${langCode}.json`);
      }
    } catch (err) {
      console.warn(`Translation file for ${langCode} not found or failed to load. Falling back to English.`, err);
      // Fallback to English
      if (langCode !== DEFAULT_LANG) {
        try {
          const fallbackRes = await fetch(`/locales/${DEFAULT_LANG}.json`);
          translations = await fallbackRes.json();
        } catch (fbErr) {
          console.error("Critical: Default translation load failed.", fbErr);
          translations = {};
        }
      } else {
        translations = {};
      }
    }

    // Apply translations across all elements in the DOM
    applyDOMTranslations();

    // Sync header selector if it exists
    const langSelect = document.getElementById("langSelect");
    if (langSelect && langSelect.value !== langCode) {
      langSelect.value = langCode;
    }

    // Dispatch custom event for app.js or other code to react
    const event = new CustomEvent("languageChanged", { detail: { language: langCode } });
    window.dispatchEvent(event);
  };

  // Function to apply translations to data-i18n and data-i18n-placeholder elements
  function applyDOMTranslations() {
    // 1. Text Content
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const trans = window.t(key);
      if (trans !== key) {
        el.textContent = trans;
      }
    });

    // 2. Input/Textarea Placeholders
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      const trans = window.t(key);
      if (trans !== key) {
        el.placeholder = trans;
      }
    });

    // 3. title attributes (tooltips)
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      const key = el.getAttribute("data-i18n-title");
      const trans = window.t(key);
      if (trans !== key) {
        el.title = trans;
      }
    });

    // 4. aria-label attributes (screen readers / accessible names)
    document.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
      const key = el.getAttribute("data-i18n-aria-label");
      const trans = window.t(key);
      if (trans !== key) {
        el.setAttribute("aria-label", trans);
      }
    });
  }

  // Exposed so other modules (e.g. voice.js) can re-run localization
  // after they dynamically insert new elements with data-i18n* attributes.
  window.applyDOMTranslations = applyDOMTranslations;

  // Get current language code
  window.getCurrentLanguage = function() {
    return currentLanguage;
  };

  // Populate langSelect dropdown dynamically
  function populateLanguageDropdown() {
    const langSelect = document.getElementById("langSelect");
    if (!langSelect) return;
    
    langSelect.innerHTML = "";
    window.LANGUAGES.forEach(lang => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      
      let displayName = lang.nativeName;
      if (lang.name !== lang.nativeName) {
        displayName += ` (${lang.name})`;
      }
      
      if (!lang.supported) {
        displayName += ` [Translation Pending]`;
        opt.disabled = true;
      }
      
      opt.textContent = displayName;
      langSelect.appendChild(opt);
    });
    
    langSelect.value = currentLanguage;
    
    // Clear old listener and add new one
    langSelect.onchange = (e) => {
      window.setLanguage(e.target.value);
    };
  }

  // Helper to trigger and populate Onboarding Modal
  function setupOnboardingModal() {
    const modal = document.getElementById("onboardingModal");
    const langListContainer = document.getElementById("onboardingLangList");
    const startBtn = document.getElementById("onboardingStartBtn");
    
    if (!modal || !langListContainer) return;
    
    langListContainer.innerHTML = "";
    
    // Create selectable language options inside the modal
    window.LANGUAGES.forEach(lang => {
      // Only show fully supported languages in the primary list
      if (!lang.supported) return;
      
      const card = document.createElement("button");
      card.type = "button";
      card.className = "onboarding-lang-card";
      if (lang.code === currentLanguage) {
        card.classList.add("is-selected");
      }
      
      card.innerHTML = `
        <span class="native-name">${lang.nativeName}</span>
        <span class="eng-name">${lang.name}</span>
      `;
      
      card.addEventListener("click", () => {
        document.querySelectorAll(".onboarding-lang-card").forEach(c => c.classList.remove("is-selected"));
        card.classList.add("is-selected");
        window.setLanguage(lang.code);
      });
      
      langListContainer.appendChild(card);
    });

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        modal.classList.remove("is-visible");
        modal.setAttribute("aria-hidden", "true");
      });
    }
  }

  // Initialize Language Settings on Load
  window.initi18n = async function() {
    let savedLang = localStorage.getItem(STORAGE_KEY);
    let isFirstVisit = false;
    
    // If first-time user (no saved setting)
    if (!savedLang) {
      isFirstVisit = true;
      // Detect browser language
      const browserLang = (navigator.language || navigator.userLanguage || DEFAULT_LANG).split("-")[0];
      const match = window.LANGUAGES.find(l => l.code === browserLang && l.supported);
      
      if (match) {
        savedLang = match.code;
      } else {
        savedLang = DEFAULT_LANG;
      }
    }

    await window.setLanguage(savedLang);

    if (isFirstVisit) {
      const modal = document.getElementById("onboardingModal");
      if (modal) {
        modal.classList.add("is-visible");
        modal.setAttribute("aria-hidden", "false");
      }
    }
  };

  // Run initial configuration once document is ready
  document.addEventListener("DOMContentLoaded", () => {
    window.initi18n().then(() => {
      populateLanguageDropdown();
      setupOnboardingModal();
    });
  });
})();
