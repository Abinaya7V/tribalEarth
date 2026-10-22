/**
 * TribalEarth AI — document classification against FRA Rule 13 (Module 3)
 * ------------------------------------------------------------
 * HONEST SCOPE — read this before extending this file:
 *
 * This does NOT verify that a document is genuine, and it does NOT
 * detect fraud. Neither of those is something a keyword-matching
 * script (or, honestly, most ML approaches without a large labeled
 * dataset of confirmed-genuine vs confirmed-fraudulent FRA claims —
 * which doesn't exist publicly) can do responsibly. Claiming either
 * would be overclaiming exactly the kind of thing this project
 * should not overclaim.
 *
 * What this DOES do, honestly:
 *   1. Classifies which Rule 13 evidence category an uploaded
 *      document most likely belongs to, from its OCR'd text and
 *      filename — a solved, boring, reliable text-classification
 *      task, not a judgment call.
 *   2. Flags basic consistency: does the extracted text contain the
 *      applicant's name / village, so obvious mismatches (wrong
 *      person's ration card uploaded, misspelled village) surface
 *      immediately instead of being caught three review stages later.
 *   3. Reports Rule 13 category coverage across a claim's documents,
 *      so an officer instantly sees "this claim has no elder
 *      testimony on file" instead of discovering it manually.
 *
 * Every suggestion here is exactly that — a suggestion. Nothing in
 * this file writes officerConfirmed=true. That decision belongs to
 * the officer alone (see the /confirm endpoint in server.js).
 *
 * RULE_13_CATEGORIES below is a direct digitization of the Forest
 * Rights Rules, 2007 (as amended 2012), Rule 13(1) — the actual
 * legal list of acceptable evidence for a forest rights claim. It
 * is not an invented or ML-inferred taxonomy.
 */

const RULE_13_CATEGORIES = [
  {
    id: "government_records",
    label: "Government records (Forest Settlement Reports, Survey & Settlement records)",
    keywords: ["survey", "settlement report", "forest settlement", "khasra", "khatauni", "revenue record", "land record", "patta"],
  },
  {
    id: "physical_attributes",
    label: "Physical attributes (old structures, wells, permanent improvements, cultivation evidence)",
    keywords: ["well", "house", "structure", "cultivation", "crop", "field boundary", "improvement", "orchard", "plantation"],
  },
  {
    id: "community_testimony",
    label: "Statements of Gram Sabha / community members / Village Elders",
    keywords: ["gram sabha", "elder", "testimony", "statement", "witness", "village committee", "affidavit"],
  },
  {
    id: "maps_and_imagery",
    label: "Maps and satellite imagery of the traditional habitat",
    keywords: ["map", "satellite", "imagery", "survey of india", "toposheet", "gis", "boundary map"],
  },
  {
    id: "genealogy",
    label: "Genealogical tree traceable to the claimant",
    keywords: ["genealog", "family tree", "lineage", "ancestor", "descendant"],
  },
  {
    id: "identity_residence",
    label: "Pre-2005 identity/residence documents (voter ID, ration card, etc.)",
    keywords: ["ration card", "voter id", "electoral", "epic", "aadhaar", "identity card", "residence certificate", "domicile"],
  },
];

/**
 * Classifies free text (typically OCR output) plus the original
 * filename against the Rule 13 categories using keyword matching.
 * Deliberately simple and inspectable — every match is traceable to
 * an actual keyword hit, not a black-box score.
 *
 * @returns {{categoryId: string|null, categoryLabel: string|null, confidence: number, matchedKeywords: string[]}}
 */
function classifyAgainstRule13(text, filename) {
  const haystack = `${text || ""} ${filename || ""}`.toLowerCase();

  let best = { categoryId: null, categoryLabel: null, confidence: 0, matchedKeywords: [] };

  for (const category of RULE_13_CATEGORIES) {
    const matched = category.keywords.filter((kw) => haystack.includes(kw));
    if (matched.length === 0) continue;

    // Confidence is deliberately just "how many distinct keywords
    // hit, capped at a sane ceiling" — transparent and auditable,
    // not a fabricated probability from an uncalibrated model.
    const confidence = Math.min(0.95, 0.4 + matched.length * 0.2);

    if (confidence > best.confidence) {
      best = {
        categoryId: category.id,
        categoryLabel: category.label,
        confidence,
        matchedKeywords: matched,
      };
    }
  }

  return best;
}

/**
 * Checks whether the extracted text plausibly contains the given
 * name/village — simple case-insensitive substring/token check.
 * Returns null (not false) when there's nothing to check against
 * (e.g. OCR produced no text), since "no evidence either way" is a
 * different, more honest answer than "doesn't match".
 */
function checkTextContains(extractedText, value) {
  if (!extractedText || !value) return null;
  const haystack = extractedText.toLowerCase();
  const needle = String(value).toLowerCase().trim();
  if (!needle) return null;
  return haystack.includes(needle);
}

/**
 * Full classification result for one document.
 */
function classifyDocument({ extractedText, filename, applicantName, village }) {
  const rule13 = classifyAgainstRule13(extractedText, filename);
  return {
    ...rule13,
    nameMatch: checkTextContains(extractedText, applicantName),
    villageMatch: checkTextContains(extractedText, village),
  };
}

/**
 * Given a claim's documents (each with an optional `.review.rule13`
 * classification and `.review.officerConfirmed` flag), returns
 * which Rule 13 categories are covered and which are missing.
 *
 * Deliberately counts ONLY officer-confirmed documents — an
 * AI-suggested-but-unconfirmed classification does not satisfy the
 * checklist. This is the architectural enforcement of "AI assists,
 * officer decides", not just a UI convention.
 */
function computeChecklist(documents) {
  const confirmedCategoryIds = new Set(
    (documents || [])
      .filter((doc) => doc.review?.officerConfirmed && doc.review?.rule13?.categoryId)
      .map((doc) => doc.review.rule13.categoryId)
  );

  const covered = RULE_13_CATEGORIES.filter((c) => confirmedCategoryIds.has(c.id));
  const missing = RULE_13_CATEGORIES.filter((c) => !confirmedCategoryIds.has(c.id));

  return {
    covered: covered.map((c) => ({ id: c.id, label: c.label })),
    missing: missing.map((c) => ({ id: c.id, label: c.label })),
    totalCategories: RULE_13_CATEGORIES.length,
    coveredCount: covered.length,
  };
}

module.exports = { RULE_13_CATEGORIES, classifyDocument, computeChecklist };
