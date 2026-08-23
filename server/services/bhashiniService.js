/**
 * TribalEarth AI — Bhashini service abstraction
 * ------------------------------------------------------------
 * This is the ONLY module that should ever call India's Bhashini
 * (Digital India Bhashini / NLTM) speech APIs. Nothing outside
 * this file should hold an API key, and the frontend never sees
 * one — routes call these functions, not the Bhashini API directly.
 *
 * HONESTY CONTRACT:
 *   - If BHASHINI_API_KEY / BHASHINI_USER_ID / BHASHINI_SERVICE_ID
 *     are not set, every function below returns a clearly-labelled
 *     "not configured" result. It NEVER fabricates a transcript,
 *     translation, or audio clip.
 *   - Until real credentials are supplied, this module is an
 *     honest placeholder — the routes that call it are real and
 *     wired correctly, but the underlying provider call is stubbed.
 *   - When credentials ARE supplied, the pipeline call in
 *     `bhashiniPipelineRequest` below performs a genuine HTTP
 *     request to Bhashini's endpoints (ASR / Translation / TTS
 *     pipeline, per the official Bhashini API contract). No part
 *     of that request/response handling is mocked.
 */

const isConfigured = () =>
  Boolean(
    process.env.BHASHINI_API_KEY &&
      process.env.BHASHINI_USER_ID &&
      process.env.BHASHINI_SERVICE_ID &&
      process.env.BHASHINI_BASE_URL
  );

/**
 * Low-level call to Bhashini's pipeline compute endpoint.
 * Only invoked when isConfigured() is true.
 */
async function bhashiniPipelineRequest(pipelineTasks, inputData) {
  const baseUrl = process.env.BHASHINI_BASE_URL;
  const res = await fetch(`${baseUrl}/pipeline/compute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.BHASHINI_API_KEY,
      userID: process.env.BHASHINI_USER_ID,
      ulcaApiKey: process.env.BHASHINI_API_KEY,
    },
    body: JSON.stringify({
      pipelineTasks,
      inputData,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bhashini API returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Speech-to-text.
 * @param {Buffer} audioBuffer - raw audio bytes
 * @param {string} mimeType - e.g. "audio/webm", "audio/wav"
 * @param {string} languageCode - BCP-47-ish code, e.g. "hi", "or", "sat"
 * @returns {Promise<{ success: boolean, transcript?: string, error?: string, configured: boolean }>}
 */
async function transcribeAudio(audioBuffer, mimeType, languageCode) {
  if (!isConfigured()) {
    return {
      success: false,
      configured: false,
      error: "Voice service is not configured.",
    };
  }

  try {
    const base64Audio = audioBuffer.toString("base64");
    const result = await bhashiniPipelineRequest(
      [
        {
          taskType: "asr",
          config: {
            language: { sourceLanguage: languageCode },
            serviceId: process.env.BHASHINI_SERVICE_ID,
            audioFormat: mimeType.includes("wav") ? "wav" : "webm",
          },
        },
      ],
      { audio: [{ audioContent: base64Audio }] }
    );

    const transcript =
      result?.pipelineResponse?.[0]?.output?.[0]?.source || null;

    if (!transcript) {
      return { success: false, configured: true, error: "No speech detected." };
    }
    return { success: true, configured: true, transcript, language: languageCode };
  } catch (err) {
    return { success: false, configured: true, error: err.message };
  }
}

/**
 * Text-to-speech.
 * @param {string} text
 * @param {string} languageCode
 * @returns {Promise<{ success: boolean, audioBase64?: string, error?: string, configured: boolean }>}
 */
async function synthesizeSpeech(text, languageCode) {
  if (!isConfigured()) {
    return {
      success: false,
      configured: false,
      error: "Voice service is not configured.",
    };
  }

  try {
    const result = await bhashiniPipelineRequest(
      [
        {
          taskType: "tts",
          config: {
            language: { sourceLanguage: languageCode },
            serviceId: process.env.BHASHINI_SERVICE_ID,
          },
        },
      ],
      { input: [{ source: text }] }
    );

    const audioBase64 =
      result?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || null;

    if (!audioBase64) {
      return { success: false, configured: true, error: "No audio returned." };
    }
    return { success: true, configured: true, audioBase64 };
  } catch (err) {
    return { success: false, configured: true, error: err.message };
  }
}

module.exports = { isConfigured, transcribeAudio, synthesizeSpeech };
