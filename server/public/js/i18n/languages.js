// Supported and Configured Languages List for TribalEarth AI
const LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", supported: true },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", supported: true },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", supported: true },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", supported: true },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", supported: true },
  { code: "sat", name: "Santali", nativeName: "ᱥᱟᱱᱛᱟᱲᱤ", supported: true },
  
  // Configured/Scheduled Languages for Future Support
  { code: "trp", name: "Kokborok", nativeName: "ককবরক (Kokborok)", supported: false },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া (Assamese)", supported: false },
  { code: "brx", name: "Bodo", nativeName: "बर' (Bodo)", supported: false },
  { code: "doi", name: "Dogri", nativeName: "डोगरी (Dogri)", supported: false },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી (Gujarati)", supported: false },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ (Kannada)", supported: false },
  { code: "ks", name: "Kashmiri", nativeName: "کٲشُر (Kashmiri)", supported: false, rtl: true },
  { code: "kok", name: "Konkani", nativeName: "कोंकणी (Konkani)", supported: false },
  { code: "mai", name: "Maithili", nativeName: "मैथिली (Maithili)", supported: false },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം (Malayalam)", supported: false },
  { code: "mni", name: "Manipuri", nativeName: "মৈতৈলোন / ꯃꯤꯇꯩꯂꯣꯟ", supported: false },
  { code: "mr", name: "Marathi", nativeName: "मराठी (Marathi)", supported: false },
  { code: "ne", name: "Nepali", nativeName: "नेपाली (Nepali)", supported: false },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ (Punjabi)", supported: false },
  { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम् (Sanskrit)", supported: false },
  { code: "sd", name: "Sindhi", nativeName: "سنڌي / सिंधी (Sindhi)", supported: false, rtl: true },
  { code: "ta", name: "Tamil", nativeName: "தமிழ் (Tamil)", supported: false },
  { code: "ur", name: "Urdu", nativeName: "اردو (Urdu)", supported: false, rtl: true }
];

// Export to global scope for vanilla JS usage
window.LANGUAGES = LANGUAGES;
