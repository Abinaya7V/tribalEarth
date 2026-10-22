/**
 * TribalEarth AI — OCR service (Module 3)
 * ------------------------------------------------------------
 * Wraps tesseract.js to extract text from uploaded claim
 * documents, so they can be classified against FRA Rule 13
 * evidence categories.
 *
 * IMPORTANT — a real bug in tesseract.js this file works around:
 * On first use, tesseract.js downloads its English language model
 * from a public CDN (jsdelivr). If that fetch fails — no internet,
 * a restricted network, a CDN outage — the resulting error is
 * thrown from inside a worker-thread message handler in a way that
 * ESCAPES a normal try/catch and crashes the entire Node process,
 * not just the one OCR request. This was verified directly while
 * building this service. The fix is two-fold:
 *   1. A process-level safety net in server.js (see the comment
 *      there) so a language-data fetch failure can never take the
 *      whole server down.
 *   2. A timeout wrapped around every OCR call here, so a slow or
 *      stuck fetch fails an individual request within a few
 *      seconds instead of hanging it indefinitely.
 *
 * HONESTY CONTRACT: on any failure — no internet, corrupt image,
 * unsupported format, timeout — this returns { success: false },
 * never a fabricated or partial "best guess" text.
 *
 * Requires internet access on first run per language (to download
 * the language model, then it's cached in server/data/tesseract-cache
 * for offline reuse afterward). See README for offline setup.
 */

const path = require("path");
const fs = require("fs");

function getCacheDir() {
  const effectiveDataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  const cacheDir = path.join(effectiveDataDir, "tesseract-cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

const OCR_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Extracts text from an image file on disk.
 * @param {string} filePath - absolute path to the image
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExts = [".jpg", ".jpeg", ".png", ".bmp", ".webp"];
  if (!supportedExts.includes(ext)) {
    // Honest scope limit: PDF text extraction needs a different
    // pipeline (pdf-to-image rasterization first) that isn't wired
    // up here. Rather than guess or fail silently, this says so.
    return {
      success: false,
      error: `OCR currently supports image files (${supportedExts.join(", ")}) — PDF text extraction is not yet implemented.`,
    };
  }

  let worker;
  try {
    const { createWorker } = require("tesseract.js");

    worker = await withTimeout(
      createWorker("eng", 1, { cachePath: getCacheDir(), logger: () => {} }),
      OCR_TIMEOUT_MS,
      "OCR engine failed to initialize in time (likely no internet access to fetch the language model on first use)."
    );

    const { data } = await withTimeout(
      worker.recognize(filePath),
      OCR_TIMEOUT_MS,
      "OCR timed out while reading the document."
    );

    return { success: true, text: data.text || "" };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (worker) {
      try {
        await withTimeout(worker.terminate(), 5000, "worker cleanup timeout");
      } catch (err) {
        // Best-effort cleanup — a failed terminate() shouldn't fail the request.
      }
    }
  }
}

module.exports = { extractText };
