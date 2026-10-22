// Bilingual Translation & Transliteration Utility for TribalEarth AI
(function() {
  const BILINGUAL_DICTIONARY = {
    // Names
    "kamala": {
      en: "Kamala",
      hi: "कमला",
      bn: "কমলা",
      or: "କମଳା",
      te: "కమల",
      sat: "ᱠᱚᱢᱚᱞᱟ"
    },
    "ramesh": {
      en: "Ramesh",
      hi: "रमेश",
      bn: "রমেশ",
      or: "ରମେଶ",
      te: "రమేష్",
      sat: "ᱨᱚᱢᱮᱥ"
    },
    "netam": {
      en: "Netam",
      hi: "नेताम",
      bn: "নেতাম",
      or: "ନେତାମ",
      te: "నేతమ్",
      sat: "ᱱᱮᱛᱟᱢ"
    },
    "sukhram": {
      en: "Sukhram",
      hi: "सुखराम",
      bn: "সুখরাম",
      or: "ସୁଖରାମ",
      te: "సుఖ్‌రామ్",
      sat: "ᱥᱩᱠᱷᱨᱟᱢ"
    },
    
    // Places
    "olliyur": {
      en: "Olliyur",
      hi: "ओलियूर",
      bn: "ওলিইয়ুর",
      or: "ଓଲିୟୁର",
      te: "ఒల్లియూర్",
      sat: "ᱚᱞᱤᱭᱩᱨ"
    },
    "tamil nadu": {
      en: "Tamil Nadu",
      hi: "तमिल नाडु",
      bn: "তামিলনাড়ু",
      or: "ତାମିଲନାଡୁ",
      te: "తమిళనాడు",
      sat: "ᱛᱟᱢᱤᱞ ᱱᱟᱰᱩ"
    },
    "chhattisgarh": {
      en: "Chhattisgarh",
      hi: "छत्तीसगढ़",
      bn: "ছত্তিশগড়",
      or: "ଛତିଶଗଡ଼",
      te: "ఛత్తీస్‌గఢ్",
      sat: "ᱪᱷᱚᱛᱤᱥᱜᱚᱲ"
    },
    "kanker": {
      en: "Kanker",
      hi: "कांकेर",
      bn: "কাঙ্কের",
      or: "କାଙ୍କେର",
      te: "కాంకేర్",
      sat: "ᱠᱟᱱᱠᱮᱨ"
    },
    "kanker gp": {
      en: "Kanker GP",
      hi: "कांकेर जीपी",
      bn: "কাঙ্কের জিপি",
      or: "କାଙ୍କେର ଜିପି",
      te: "కాంకేర్ జీపీ",
      sat: "ᱠᱟᱱᱠᱮᱨ ᱡᱤ.ᱯᱤ."
    },
    
    // General Text / Phrases
    "plot east of the river": {
      en: "Plot east of the river",
      hi: "नदी के पूर्व स्थित भूमि",
      bn: "নদীর পূর্ব দিকে অবস্থিত জমি",
      or: "ନଦୀର ପୂର୍ବ ପାର୍ଶ୍ୱରେ ଥିବା ଜମି",
      te: "నదికి తూర్పున ఉన్న భూమి",
      sat: "ᱜᱟᱰᱟ ᱥᱟᱢᱟᱝ ᱨᱮᱱᱟᱜ ᱦᱟᱥᱟ"
    },
    "plot east of kanker stream, bordered by sal forest to the north": {
      en: "Plot east of Kanker stream, bordered by sal forest to the north",
      hi: "कांकेर जलधारा के पूर्व की भूमि, उत्तर में साल वन से घिरी हुई",
      bn: "কাঙ্কের খালের পূর্ব দিকের জমি, উত্তরে শাল বন দ্বারা বেষ্টিত",
      or: "କାଙ୍କେର ନାଳର ପୂର୍ବ ପାର୍ଶ୍ୱ ଜମି, ଉତ୍ତରରେ ଶାଳ ଜଙ୍ଗଲ ଘେରା",
      te: "కాంకేర్ వాగుకు తూర్పున ఉన్న భూమి, ఉత్తరాన సాల వృక్షాల అడవి సరిహద్దుగా ఉంది",
      sat: "ᱠᱟᱱᱠᱮᱨ ᱡᱷᱟᱨᱱᱟ ᱥᱟᱢᱟᱝ ᱨᱮᱱᱟᱜ ᱦᱟᱥᱟ, ᱠᱚᱧᱮ ᱥᱮᱫ ᱥᱟᱨᱡᱚᱢ ᱵᱤᱨ ᱛᱮ ᱮᱥᱮᱫ ᱟᱠᱟᱱᱟ"
    }
  };

  // Maps values to bilingual structure
  window.getBilingualValue = function(value, currentLangCode) {
    if (!value || typeof value !== 'string') {
      return { original: value, selectedLanguage: value, english: value };
    }

    const cleanVal = value.trim();

    // Check if numeric, coord, legal abbreviation or file quantity (should never be translated)
    const isNumericOrCoord = /^[0-9\.\-\s,\+]+$/.test(cleanVal);
    const isLegalCode = /^(IFR|CR|CFR|FRA)$/i.test(cleanVal);
    const isFileCount = /^\d+\s+file\(s\)$/i.test(cleanVal);

    if (isNumericOrCoord || isLegalCode || isFileCount) {
      return { original: value, selectedLanguage: value, english: value };
    }

    const key = cleanVal.toLowerCase().replace(/\s+/g, ' ');

    // 1. Check exact mapping in dictionary
    if (BILINGUAL_DICTIONARY[key]) {
      return {
        original: value,
        selectedLanguage: BILINGUAL_DICTIONARY[key][currentLangCode] || BILINGUAL_DICTIONARY[key]["en"] || value,
        english: BILINGUAL_DICTIONARY[key]["en"] || value
      };
    }

    // 2. Check compound name/place translations by splitting words
    const words = cleanVal.split(/\s+/);
    const translatedWords = [];
    const englishWords = [];
    let allMapped = true;

    for (const w of words) {
      const wKey = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (BILINGUAL_DICTIONARY[wKey]) {
        translatedWords.push(BILINGUAL_DICTIONARY[wKey][currentLangCode] || BILINGUAL_DICTIONARY[wKey]["en"]);
        englishWords.push(BILINGUAL_DICTIONARY[wKey]["en"]);
      } else {
        allMapped = false;
        break;
      }
    }

    if (allMapped && words.length > 0) {
      return {
        original: value,
        selectedLanguage: translatedWords.join(' '),
        english: englishWords.join(' ')
      };
    }

    // 3. Fallback logic based on script type
    const isEnglishInput = /^[a-zA-Z0-9\s\-\.\,\(\)\/]+$/.test(cleanVal);
    if (isEnglishInput) {
      return {
        original: value,
        selectedLanguage: value, // Fallback
        english: value
      };
    } else {
      return {
        original: value,
        selectedLanguage: value,
        english: value // Fallback
      };
    }
  };
})();
