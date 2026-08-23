/**
 * TribalEarth AI — structured extraction from free-form speech text
 * ------------------------------------------------------------
 * This is intentionally NOT a call to an LLM or an external NLU
 * service — it is a small, transparent, rule-based matcher. That's
 * a deliberate honesty choice: a rule-based extractor either finds
 * a clear pattern or returns null, and never invents a plausible-
 * sounding value the way a generative model could.
 *
 * HONEST SCOPE: pattern coverage is currently English- and
 * Hindi-phrasing oriented (the two languages the sample sentences
 * in the spec were written in). For Bengali / Odia / Telugu /
 * Santali speech, the guided one-field-at-a-time voice flow (which
 * doesn't need extraction — it just takes the whole answer as the
 * field value) is the reliable path today. Extending this matcher
 * with equivalent phrase patterns for those languages is future
 * work, not something to fake here.
 */

const CLAIM_TYPE_PATTERNS = [
  { type: "CFR", regex: /\b(community forest resources?|cfr|सामुदायिक वन संसाधन)\b/i },
  { type: "CR", regex: /\b(community rights?|\bcr\b|सामुदायिक अधिकार)\b/i },
  { type: "IFR", regex: /\b(individual forest rights?|ifr|व्यक्तिगत वन अधिकार)\b/i },
];

const NUMBER_WORD_RE = /(\d+(?:\.\d+)?)/;

function extractClaimType(text) {
  for (const { type, regex } of CLAIM_TYPE_PATTERNS) {
    if (regex.test(text)) return type;
  }
  return null;
}

function extractLandArea(text) {
  const acreMatch = text.match(/(\d+(?:\.\d+)?)\s*(acres?|hectares?|एकड़)/i);
  if (acreMatch) return parseFloat(acreMatch[1]);
  return null;
}

function extractCultivationYears(text) {
  // Deliberately requires an explicit "years" (or साल/वर्ष) keyword next
  // to the number. A bare-number fallback was tried here initially and
  // removed: it wrongly matched the land-area figure too (e.g. "4 acres"
  // was misread as "4 years") — exactly the kind of confident-looking
  // wrong guess Section 8 says to avoid. No keyword match, no value.
  const yearsMatch = text.match(/(\d+(?:\.\d+)?)\s*(years?|साल|वर्ष)/i);
  return yearsMatch ? parseFloat(yearsMatch[1]) : null;
}

/** Extracts "X" from patterns like "my name is X", "I am X", "नाम है X". */
function extractAfterPhrase(text, phrases) {
  for (const phrase of phrases) {
    const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx !== -1) {
      let rest = text.slice(idx + phrase.length).trim();
      // stop at the next clause boundary (., comma, "and", "my", "I")
      rest = rest.split(/[.,]| and | my | I /i)[0].trim();
      if (rest) return rest.replace(/^is\s+/i, "").trim();
    }
  }
  return null;
}

function extractApplicantName(text) {
  return extractAfterPhrase(text, [
    "my name is",
    "applicant's name is",
    "आवेदक का नाम है",
    "मेरा नाम है",
  ]);
}

function extractGuardianName(text) {
  return extractAfterPhrase(text, [
    "father's name is",
    "father name is",
    "husband's name is",
    "husband name is",
    "father is",
    "husband is",
    "पिता का नाम है",
    "पति का नाम है",
  ]);
}

function extractVillage(text) {
  const match = text.match(/(?:live in|village is|village of)\s+([a-zA-Z\u0900-\u097F]+)/i);
  if (match) return match[1];
  return extractAfterPhrase(text, ["गांव है", "गांव"]);
}

function extractDistrict(text) {
  return extractAfterPhrase(text, ["district is", "जिला है"]);
}

function extractState(text) {
  return extractAfterPhrase(text, ["state is", "राज्य है"]);
}

function extractGramPanchayat(text) {
  return extractAfterPhrase(text, ["gram panchayat is", "ग्राम पंचायत है"]);
}

/**
 * Main entry point.
 * @param {string} text - transcribed speech
 * @returns {{fields: object}} - each field is either a value or null.
 *   NEVER guesses: an unmatched field is null, not a best-effort value.
 */
function extractClaimFields(text) {
  if (!text || typeof text !== "string") {
    return {
      fields: {
        applicantName: null,
        fatherSpouseName: null,
        village: null,
        gramPanchayat: null,
        district: null,
        state: null,
        claimType: null,
        landDescription: null,
        landArea: null,
        cultivationYears: null,
        latitude: null,
        longitude: null,
      },
    };
  }

  return {
    fields: {
      applicantName: extractApplicantName(text),
      fatherSpouseName: extractGuardianName(text),
      village: extractVillage(text),
      gramPanchayat: extractGramPanchayat(text),
      district: extractDistrict(text),
      state: extractState(text),
      claimType: extractClaimType(text),
      landDescription: null, // free descriptive text is taken verbatim by the guided flow instead of pattern-matched here
      landArea: extractLandArea(text),
      cultivationYears: extractCultivationYears(text),
      latitude: null, // coordinates are never inferred from speech — GPS/manual entry only
      longitude: null,
    },
  };
}

module.exports = { extractClaimFields };
