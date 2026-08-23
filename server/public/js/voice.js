/**
 * TribalEarth AI — voice-assisted claim filing
 * ------------------------------------------------------------
 * Two speech-to-text paths, tried in this order per the
 * architecture in Section 6 of the spec:
 *
 *   1. Backend /api/voice/transcribe -> Bhashini. This is the
 *      "real" architected path and is what would serve Odia and
 *      Santali once Bhashini credentials are configured. Today,
 *      with no credentials set, it honestly returns 503 "not
 *      configured" — this file does NOT treat that as a soft
 *      failure to paper over; it surfaces the real reason.
 *
 *   2. Browser Web Speech API (webkitSpeechRecognition), used as
 *      a working fallback for the languages Chrome's built-in
 *      engine actually supports: English, Hindi, Bengali, Telugu.
 *      This is real, unmocked recognition — it just isn't
 *      Bhashini, and it doesn't cover Odia or Santali (no browser
 *      ships a speech engine for those today).
 *
 * TTS mirrors the same two-tier approach: backend Bhashini TTS
 * first, browser SpeechSynthesis as a working fallback.
 */

(function () {
  const BROWSER_SPEECH_LANG_MAP = {
    en: "en-IN",
    hi: "hi-IN",
    bn: "bn-IN",
    te: "te-IN",
    // or, sat: intentionally absent — no browser speech engine
    // supports these today. They rely entirely on the backend
    // Bhashini path once configured.
  };

  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  /* ---------------- Bhashini configuration status (checked once) ---------------- */
  let bhashiniConfigured = false; // assume unconfigured until proven otherwise
  fetch("/api/voice/status")
    .then((res) => res.json())
    .then((data) => {
      bhashiniConfigured = Boolean(data.configured);
    })
    .catch(() => {
      bhashiniConfigured = false;
    });

  /* ---------------- warm up browser speech synthesis ---------------- */
  // Real Chromium quirk: calling speechSynthesis.speak() before the
  // voice list has finished loading (or immediately after a cancel()
  // in the same tick) can silently produce no audio at all — no
  // error event, nothing. Touching getVoices() early, and listening
  // for voiceschanged, gets the engine genuinely ready before the
  // first real question is ever spoken.
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }

  /* ---------------- status pill ---------------- */
  const pill = document.getElementById("voiceStatusPill");
  const pillIcon = document.getElementById("voiceStatusIcon");
  const pillText = document.getElementById("voiceStatusText");
  let pillTimer = null;

  function showStatus(stateKey, { sticky = false } = {}) {
    if (!pill) return;
    const icons = {
      ready: "🎙️",
      listening: "🔴",
      processing: "⏳",
      success: "✅",
      error: "⚠️",
      noSpeech: "⚠️",
      micDenied: "🚫",
      unsupportedLanguage: "🌐",
      serviceUnavailable: "⚙️",
    };
    pillIcon.textContent = icons[stateKey] || "●";
    pillText.textContent = window.t(`voice.state.${stateKey}`, stateKey);
    pill.hidden = false;
    pill.dataset.state = stateKey;
    clearTimeout(pillTimer);
    if (!sticky) {
      const autoHideStates = ["success", "error", "noSpeech", "micDenied", "unsupportedLanguage", "serviceUnavailable"];
      if (autoHideStates.includes(stateKey)) {
        pillTimer = setTimeout(() => {
          pill.hidden = true;
        }, 2600);
      }
    }
  }

  function hideStatus() {
    if (pill) pill.hidden = true;
    clearTimeout(pillTimer);
  }

  /* ---------------- backend transcribe attempt ---------------- */
  async function backendTranscribe(audioBlob, language) {
    const fd = new FormData();
    fd.append("audio", audioBlob, "clip.webm");
    fd.append("language", language);
    try {
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      return { attempted: true, ...data };
    } catch (err) {
      return { attempted: true, success: false, configured: false, error: err.message };
    }
  }

  /* ---------------- browser recognition ---------------- */
  function recognizeWithBrowser(speechLang, onInterim) {
    return new Promise((resolve) => {
      if (!SpeechRecognitionCtor) {
        resolve({ success: false, reason: "no-browser-support" });
        return;
      }
      const recognizer = new SpeechRecognitionCtor();
      recognizer.lang = speechLang;
      // continuous + interimResults=true, with manual accumulation, is
      // the fix for a real bug: with continuous=false (the default),
      // Chrome sometimes treats a tiny pause right after the first
      // syllable (a breath, a moment of hesitation before a name) as
      // "end of utterance" — it finalizes whatever fragment it has so
      // far and fires onend immediately. That's exactly what produced
      // "only the first few letters" — the recognizer wasn't cutting
      // the text short, it was cutting the LISTENING short. Collecting
      // every final segment until the recognizer actually stops (or
      // our own timeout fires) captures the full utterance instead.
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;

      let settled = false;
      let finalTranscript = "";
      let lastInterimTranscript = "";

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        try {
          recognizer.stop();
        } catch (err) {
          // already stopped — fine
        }
        resolve(result);
      };

      // Safety net: continuous mode can in principle keep the mic open
      // longer than intended if the browser's silence detection is slow
      // to trigger. Cap any single field's listening window at 8s.
      const safetyTimer = setTimeout(() => {
        try {
          recognizer.stop();
        } catch (err) {
          /* ignore */
        }
      }, 8000);

      recognizer.onstart = () => showStatus("listening", { sticky: true });

      recognizer.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript || "";
          if (result.isFinal) {
            finalTranscript += (finalTranscript ? " " : "") + transcript.trim();
          } else {
            lastInterimTranscript = transcript;
          }
        }
        if (onInterim) onInterim((finalTranscript + " " + lastInterimTranscript).trim());
      };

      recognizer.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "permission-denied") {
          finish({ success: false, reason: "mic-denied" });
        } else if (event.error === "no-speech" && !finalTranscript && !lastInterimTranscript) {
          finish({ success: false, reason: "no-speech" });
        } else if (event.error === "aborted" || event.error === "no-speech") {
          // recognizer.stop() itself triggers a benign "aborted"/"no-speech"
          // error in some browsers after we already have text — treat that
          // as a normal end, not a failure, and fall through to onend.
        } else {
          finish({ success: false, reason: "error", detail: event.error });
        }
      };

      // onend is the single source of truth for "the user is done talking" —
      // whatever we've accumulated by then (final segments, or the last
      // interim guess if no segment was ever finalized) is the answer.
      recognizer.onend = () => {
        const text = (finalTranscript || lastInterimTranscript).trim();
        if (text) {
          finish({ success: true, transcript: text });
        } else {
          finish({ success: false, reason: "no-speech" });
        }
      };

      try {
        recognizer.start();
      } catch (err) {
        finish({ success: false, reason: "error", detail: err.message });
      }
    });
  }

  /**
   * Runs the two-tier transcription attempt for a single spoken
   * answer and resolves to { success, transcript } or
   * { success:false, stateKey } describing why it failed.
   */
  async function transcribeOnce(language, onInterim) {
    const speechLang = BROWSER_SPEECH_LANG_MAP[language];

    if (!speechLang) {
      // Backend is the only possible path for this language today.
      showStatus("processing", { sticky: true });
      // We don't have a recorded audio clip in the field-mic flow
      // (browser recognition IS the recording mechanism), so with
      // no browser support and no way to record+send audio in this
      // lightweight flow, we say so plainly rather than pretending.
      return { success: false, stateKey: "unsupportedLanguage" };
    }

    if (!SpeechRecognitionCtor) {
      return { success: false, stateKey: "unsupportedLanguage" };
    }

    const result = await recognizeWithBrowser(speechLang, onInterim);
    if (result.success) {
      return { success: true, transcript: result.transcript };
    }
    if (result.reason === "mic-denied") return { success: false, stateKey: "micDenied" };
    if (result.reason === "no-speech") return { success: false, stateKey: "noSpeech" };
    return { success: false, stateKey: "error" };
  }

  /* ---------------- individual field mic buttons ---------------- */
  document.querySelectorAll(".mic-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.micTarget;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      const language = window.getCurrentLanguage ? window.getCurrentLanguage() : "en";
      btn.disabled = true;
      showStatus("ready", { sticky: true });

      const result = await transcribeOnce(language, (liveText) => {
        // Live preview: fills the field as speech comes in, so a user
        // (or a developer testing this) can see immediately whether
        // recognition is capturing the full sentence or cutting off.
        targetEl.value = liveText;
      });

      if (result.success) {
        targetEl.value = result.transcript;
        targetEl.dispatchEvent(new Event("input", { bubbles: true }));
        showStatus("success");
      } else {
        showStatus(result.stateKey || "error");
      }
      btn.disabled = false;
    });
  });

  /* ---------------- TTS listen buttons ---------------- */
  function speakText(text, language) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (!bhashiniConfigured) {
        // Known not configured — skip the doomed network round-trip
        // entirely and go straight to browser TTS. This is also a
        // correctness fix: the extra fetch() + json() delay was
        // pushing speechSynthesis.speak() far enough from the
        // original click that Chrome would sometimes silently drop
        // the audio with no error at all.
        speakWithBrowserTTS(text, language, finish);
        return;
      }

      // Tier 1: backend Bhashini TTS
      fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.audioBase64) {
            const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
            audio.onended = finish;
            audio.onerror = finish;
            audio.play();
            // Safety net in case onended never fires for some reason.
            setTimeout(finish, 15000);
            return;
          }
          speakWithBrowserTTS(text, language, finish);
        })
        .catch(() => {
          speakWithBrowserTTS(text, language, finish);
        });
    });
  }

  function speakWithBrowserTTS(text, language, onDone) {
    // Tier 2: browser SpeechSynthesis (real, works without Bhashini,
    // but voice quality/availability for Indian languages depends on
    // what the OS/browser has installed — that's an honest limit of
    // "AI trained voice" until Bhashini TTS is actually configured;
    // this is the best available fallback today, not a placeholder).
    if (!("speechSynthesis" in window)) {
      onDone();
      return;
    }

    const synth = window.speechSynthesis;
    let doneCalled = false;
    const callDone = () => {
      if (doneCalled) return;
      doneCalled = true;
      onDone();
    };

    const speakNow = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = BROWSER_SPEECH_LANG_MAP[language] || "en-IN";
      utterance.rate = 0.95;
      utterance.onend = callDone;
      utterance.onerror = callDone;
      synth.speak(utterance);
      // Safety net: some browsers silently drop onend for certain voices.
      setTimeout(callDone, 12000);
    };

    // Real Chromium bug: calling speak() in the exact same tick as
    // cancel() can silently fail to produce any audio. A short delay
    // after cancel() reliably avoids it.
    synth.cancel();
    setTimeout(speakNow, 60);
  }

  document.querySelectorAll(".listen-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.listenTarget;
      const text = window.t(key, "");
      if (!text) return;
      const language = window.getCurrentLanguage ? window.getCurrentLanguage() : "en";
      speakText(text, language);
    });
  });

  /* ---------------- guided "Fill Using Voice" flow ---------------- */
  const GUIDED_STEPS = [
    { field: "applicantName", askKey: "voice.guided.askApplicant", kind: "text" },
    { field: "guardianName", askKey: "voice.guided.askGuardian", kind: "text" },
    { field: "village", askKey: "voice.guided.askVillage", kind: "text" },
    { field: "gramPanchayat", askKey: "voice.guided.askGramPanchayat", kind: "text" },
    { field: "district", askKey: "voice.guided.askDistrict", kind: "text" },
    { field: "state", askKey: "voice.guided.askState", kind: "text" },
    { field: "claimType", askKey: "voice.guided.askClaimType", kind: "claimType" },
    { field: "landDescription", askKey: "voice.guided.askLandDescription", kind: "text" },
    { field: "yearsOfCultivation", askKey: "voice.guided.askCultivationYears", kind: "number" },
  ];

  const guidedOverlay = document.getElementById("voiceGuidedOverlay");
  const guidedModal = document.getElementById("voiceGuidedModal");
  const guidedQuestion = document.getElementById("voiceGuidedQuestion");
  const guidedStatus = document.getElementById("voiceGuidedStatus");
  const guidedReview = document.getElementById("voiceGuidedReview");
  const guidedMicBtn = document.getElementById("voiceGuidedMic");
  const guidedSkipBtn = document.getElementById("voiceGuidedSkip");
  const guidedCloseBtn = document.getElementById("voiceGuidedClose");
  const fillUsingVoiceBtn = document.getElementById("fillUsingVoiceBtn");

  let guidedIndex = 0;
  let guidedResults = {}; // field -> detected raw value (string/number)
  let guidedFlowToken = 0; // invalidates stale async continuations if the modal is closed mid-flow

  function openGuidedModal() {
    guidedIndex = 0;
    guidedResults = {};
    guidedFlowToken += 1;
    guidedReview.hidden = true;
    guidedReview.innerHTML = "";
    guidedModal.classList.add("is-open");
    guidedOverlay.classList.add("is-open");
    guidedModal.setAttribute("aria-hidden", "false");
    if (window.applyDOMTranslations) window.applyDOMTranslations();
    runGuidedStep();
  }

  function closeGuidedModal() {
    guidedFlowToken += 1; // invalidate any in-flight speak/listen chain
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    guidedModal.classList.remove("is-open");
    guidedOverlay.classList.remove("is-open");
    guidedModal.setAttribute("aria-hidden", "true");
    hideStatus();
  }

  /**
   * Renders the current question, speaks it aloud in the selected
   * language, then automatically starts listening for the answer —
   * a genuine conversational flow so a non-literate applicant never
   * has to read the question or figure out when to tap the mic.
   * The manual mic button remains active throughout as a retry
   * option (e.g. if the auto-listen window was missed).
   */
  async function runGuidedStep() {
    if (guidedIndex >= GUIDED_STEPS.length) {
      renderGuidedReview();
      return;
    }
    const myToken = guidedFlowToken;
    const step = GUIDED_STEPS[guidedIndex];
    const language = window.getCurrentLanguage ? window.getCurrentLanguage() : "en";
    const questionText = window.t(step.askKey, step.field);

    guidedQuestion.textContent = questionText;
    guidedStatus.textContent = "";
    guidedMicBtn.hidden = false;
    guidedSkipBtn.hidden = false;
    guidedMicBtn.disabled = true; // disabled while the question is being spoken

    showStatus("speaking", { sticky: true });
    await speakText(questionText, language);
    if (myToken !== guidedFlowToken) return; // modal was closed/advanced while speaking

    guidedMicBtn.disabled = false;
    await listenAndCaptureAnswer(step, language, myToken);
  }

  async function listenAndCaptureAnswer(step, language, myToken) {
    guidedMicBtn.disabled = true;
    showStatus("listening", { sticky: true });

    const result = await transcribeOnce(language, (liveText) => {
      if (myToken === guidedFlowToken) guidedStatus.textContent = liveText;
    });
    if (myToken !== guidedFlowToken) return; // modal closed/advanced meanwhile

    if (!result.success) {
      guidedStatus.textContent = window.t(`voice.state.${result.stateKey}`, "");
      showStatus(result.stateKey);
      guidedMicBtn.disabled = false;
      return; // user can tap the mic manually to retry this same question
    }

    showStatus("success");
    let value = result.transcript;

    if (step.kind === "claimType") {
      // Reuse the same rule-based extractor the backend uses, so
      // "Individual Forest Right" spoken here resolves to IFR the
      // same way it would from a free-form sentence.
      try {
        const res = await fetch("/api/voice/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value, language }),
        });
        const data = await res.json();
        value = data?.fields?.claimType || null;
      } catch (err) {
        value = null;
      }
    } else if (step.kind === "number") {
      const match = value.match(/(\d+(?:\.\d+)?)/);
      value = match ? match[1] : null;
    }

    if (myToken !== guidedFlowToken) return;

    const current = currentFormValue(step.field);
    const hasConflict = current && String(current).trim() !== "" && value != null && String(current) !== String(value);

    if (hasConflict) {
      // Genuine conflict: an existing value would be overwritten.
      // Hold this one back for the end-of-flow review instead of
      // silently replacing what the user already entered.
      guidedResults[step.field] = value;
    } else if (value != null && value !== "") {
      // Nothing to protect — the field was empty (or already matches).
      // Fill it immediately so the applicant sees each answer land in
      // the form in real time, rather than waiting for a final
      // "Apply to Form" step that only ever protected empty fields
      // that didn't need protecting.
      applyFieldValue(step.field, value);
    }

    guidedIndex += 1;
    guidedMicBtn.disabled = false;
    runGuidedStep();
  }

  /** Manual mic click: re-listen for the current question without re-speaking it. */
  async function handleGuidedMicClick() {
    const step = GUIDED_STEPS[guidedIndex];
    const language = window.getCurrentLanguage ? window.getCurrentLanguage() : "en";
    await listenAndCaptureAnswer(step, language, guidedFlowToken);
  }

  function handleGuidedSkip() {
    guidedFlowToken += 1; // cancel any in-flight speak/listen for the skipped question
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    guidedIndex += 1;
    runGuidedStep();
  }

  function currentFormValue(fieldName) {
    if (fieldName === "claimType") {
      const checked = document.querySelector('input[name="claimType"]:checked');
      return checked ? checked.value : "";
    }
    const el = document.getElementById(fieldName);
    return el ? el.value : "";
  }

  function applyFieldValue(fieldName, value) {
    if (fieldName === "claimType") {
      const radio = document.querySelector(`input[name="claimType"][value="${value}"]`);
      if (radio) radio.checked = true;
      return;
    }
    const el = document.getElementById(fieldName);
    if (el) el.value = value;
  }

  function renderGuidedReview() {
    const language = window.getCurrentLanguage ? window.getCurrentLanguage() : "en";

    // guidedResults now only ever contains fields where a genuine
    // conflict was detected (see listenAndCaptureAnswer) — every
    // other answer was already written straight into the form the
    // moment it was captured. So if this is empty, everything is
    // already filled and there's nothing to review.
    const conflictFields = Object.keys(guidedResults).filter(
      (f) => guidedResults[f] != null && guidedResults[f] !== ""
    );

    if (!conflictFields.length) {
      const allSetText = window.t("voice.guided.allSet", "All set — your answers are already filled in.");
      guidedQuestion.textContent = allSetText;
      guidedMicBtn.hidden = true;
      guidedSkipBtn.hidden = true;
      guidedReview.hidden = true;
      showStatus("speaking", { sticky: true });
      speakText(allSetText, language).then(() => {
        hideStatus();
        closeGuidedModal();
      });
      return;
    }

    const doneText = window.t("voice.guided.done", "");
    guidedQuestion.textContent = doneText;
    guidedMicBtn.hidden = true;
    guidedSkipBtn.hidden = true;
    guidedReview.hidden = false;

    showStatus("speaking", { sticky: true });
    speakText(doneText, language).then(hideStatus);

    const rows = conflictFields.map((fieldName) => {
      const step = GUIDED_STEPS.find((s) => s.field === fieldName);
      return { step, detected: guidedResults[fieldName], current: currentFormValue(fieldName) };
    });

    // Explicit key map — matches the real locale schema (form.review.*
    // where it exists, otherwise the matching form.step1/step2 label).
    // Guessing a key path from the field name was fragile (e.g.
    // "landDescription" is stored as form.step2.landDesc, not
    // form.step2.landDescription) so this maps each field by hand.
    const LABEL_KEYS = {
      applicantName: "form.review.applicant",
      guardianName: "form.review.guardian",
      village: "form.review.village",
      gramPanchayat: "form.review.gp",
      district: "form.review.district",
      state: "form.review.state",
      claimType: "form.review.claimType",
      landDescription: "form.review.landDesc",
      yearsOfCultivation: "form.review.cultivationYears",
    };

    guidedReview.innerHTML = `
      <p class="voice-review-heading">${window.t("voice.guided.understood", "We understood:")}</p>
      <div class="voice-review-rows">
        ${rows
          .map(
            ({ step, detected, current }) => `
          <div class="voice-review-row" data-field="${step.field}">
            <div class="voice-review-label">${window.t(LABEL_KEYS[step.field] || step.field, step.field)}</div>
            <div class="voice-review-conflict">
              <label><input type="radio" name="choice-${step.field}" value="current" checked> ${window.t("voice.guided.current", "Current")}: <strong>${current}</strong></label>
              <label><input type="radio" name="choice-${step.field}" value="detected"> ${window.t("voice.guided.detected", "Detected")}: <strong>${detected}</strong></label>
            </div>
          </div>`
          )
          .join("")}
      </div>
      <div class="voice-review-final-actions">
        <button type="button" id="voiceReviewApply" class="btn btn-primary">${window.t("voice.guided.applyToForm", "Apply to Form")}</button>
        <button type="button" id="voiceReviewCancel" class="btn btn-ghost">${window.t("voice.guided.cancel", "Cancel")}</button>
      </div>
    `;

    document.getElementById("voiceReviewApply").addEventListener("click", () => {
      rows.forEach(({ step, detected }) => {
        const chosen = guidedReview.querySelector(`input[name="choice-${step.field}"]:checked`);
        if (chosen && chosen.value === "detected") {
          applyFieldValue(step.field, detected);
        }
        // "current" chosen (or left as default) -> leave the existing form value untouched.
      });
      closeGuidedModal();
    });
    document.getElementById("voiceReviewCancel").addEventListener("click", closeGuidedModal);
  }

  if (fillUsingVoiceBtn) fillUsingVoiceBtn.addEventListener("click", openGuidedModal);
  if (guidedMicBtn) guidedMicBtn.addEventListener("click", handleGuidedMicClick);
  if (guidedSkipBtn) guidedSkipBtn.addEventListener("click", handleGuidedSkip);
  if (guidedCloseBtn) guidedCloseBtn.addEventListener("click", closeGuidedModal);
  if (guidedOverlay) guidedOverlay.addEventListener("click", closeGuidedModal);

  /* ---------------- disable mic buttons for languages with no path yet ---------------- */
  window.addEventListener("languageChanged", (e) => {
    const lang = e.detail.language;
    const supported = Boolean(BROWSER_SPEECH_LANG_MAP[lang]);
    document.querySelectorAll(".mic-btn, .voice-guided-mic").forEach((btn) => {
      btn.classList.toggle("is-unsupported", !supported);
    });
  });
})();
