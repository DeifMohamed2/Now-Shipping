/*
  Converts bosta_regions.json entries from:
    [{ "governorate": "اسوان", "area": "ابو سمبل" }, ...]
  to:
    [{
      governorate: { AR: "اسوان", ENG: "Aswan", Value: "Aswan" },
      area:        { AR: "ابو سمبل", ENG: "Abu Simbel", Value: "Abu Simbel" }
    }, ...]

  - Uses hard-coded governorate English mappings
  - Uses Arabic→Latin transliteration for areas (and for governorate fallback)
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'bosta_regions.json');
const DEST = SOURCE; // overwrite in-place as requested
const OVERRIDES_PATH = path.join(__dirname, 'area-overrides.json');
const CACHE_PATH = path.join(__dirname, 'translation-cache.json');
const ONLINE = process.env.ONLINE_TRANSLATION === '1' || process.argv.includes('--online');

const { translateText } = require('./translator');

/** Known Arabic governorate → official English */
const governorateEnMap = new Map(
  [
    ['القاهرة', 'Cairo'],
    ['الجيزة', 'Giza'],
    ['الاسكندريه', 'Alexandria'],
    ['الإسكندرية', 'Alexandria'],
    ['الإسماعيلية', 'Ismailia'],
    ['السويس', 'Suez'],
    ['بورسعيد', 'Port Said'],
    ['دمياط', 'Damietta'],
    ['الدقهلية', 'Dakahlia'],
    ['الشرقية', 'Sharqia'],
    ['القليوبية', 'Qalyubia'],
    ['كفر الشيخ', 'Kafr El Sheikh'],
    ['الغربية', 'Gharbia'],
    ['المنوفية', 'Monufia'],
    ['البحيرة', 'Beheira'],
    ['الفيوم', 'Faiyum'],
    ['بني سويف', 'Beni Suef'],
    ['المنيا', 'Minya'],
    ['أسيوط', 'Assiut'],
    ['اسيوط', 'Assiut'],
    ['سوهاج', 'Sohag'],
    ['قنا', 'Qena'],
    ['الأقصر', 'Luxor'],
    ['الاقصر', 'Luxor'],
    ['أسوان', 'Aswan'],
    ['اسوان', 'Aswan'],
    ['البحر الأحمر', 'Red Sea'],
    ['البحر الاحمر', 'Red Sea'],
    ['الوادي الجديد', 'New Valley'],
    ['مطروح', 'Matrouh'],
    ['شمال سيناء', 'North Sinai'],
    ['جنوب سيناء', 'South Sinai'],
  ]
);

/** Basic Arabic → English transliteration */
function transliterate(arabic) {
  if (!arabic || typeof arabic !== 'string') return '';
  const map = {
    'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h', 'خ': 'kh',
    'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z',
    'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w',
    'ي': 'y', 'ى': 'a', 'ة': 'a', 'ئ': 'e', 'ؤ': 'o', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', 'ٔ': '', 'ٰ': '', 'ً': '', 'ٌ': '', 'ٍ': '', 'َ': '',
    'ُ': '', 'ِ': '', 'ّ': '', 'ْ': '', 'ـ': '', 'ﻻ': 'la', 'لا': 'la', 'ٱ': 'a', 'ﻷ': 'la', 'ﻹ': 'li', 'ﻵ': 'la'
  };
  // Preserve separators and punctuation
  const keepChars = new Set([' ', '-', '_', '/', ',', '.', '(', ')', '[', ']', '&', "'", '’', ':']);
  let out = '';
  for (const ch of arabic) {
    if (keepChars.has(ch)) {
      out += ch;
    } else if (map[ch] !== undefined) {
      out += map[ch];
    } else {
      out += ch; // fallback keep as-is
    }
  }
  // Title Case words sensibly
  out = out
    .split(/(\s+|\-|\/)/)
    .map(token => {
      if (/^(\s+|\-|\/)$/.test(token)) return token;
      if (!token) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('');
  // Normalize multiple spaces
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function mapGovernorateEng(ar) {
  if (!ar) return '';
  // exact match first
  if (governorateEnMap.has(ar)) return governorateEnMap.get(ar);
  // try normalized forms (remove tatweel, extra spaces)
  const normalized = ar.replace(/ـ/g, '').replace(/\s+/g, ' ').trim();
  if (governorateEnMap.has(normalized)) return governorateEnMap.get(normalized);
  // fallback: transliterate
  const t = transliterate(ar);
  // Final title fix for common variants
  return t
    .replace(/^Al\s+/i, 'Al ')
    .replace(/^El\s+/i, 'El ');
}

function applyOverrides(arText, overridesObj) {
  if (!arText || typeof arText !== 'string') return null;
  if (!overridesObj) return null;
  if (overridesObj[arText]) return overridesObj[arText];
  const parts = arText.split(/(\s+-\s+|\s*[-/]\s*)/);
  if (parts.length > 1) {
    const rebuilt = parts
      .map(p => (overridesObj[p] ? overridesObj[p] : p))
      .join('');
    if (rebuilt !== arText) return rebuilt;
  }
  return null;
}

async function transformEntry(entry, overridesObj, cacheObj) {
  if (!entry || typeof entry !== 'object') {
    return {
      governorate: { AR: '', ENG: '', Value: '' },
      area: { AR: '', ENG: '', Value: '' },
    };
  }

  // If already in target shape, just sync Value to ENG and return
  const isGovObject = entry.governorate && typeof entry.governorate === 'object' && 'AR' in entry.governorate;
  const isAreaObject = entry.area && typeof entry.area === 'object' && 'AR' in entry.area;
  if (isGovObject && isAreaObject) {
    const govAR = entry.governorate.AR || '';
    const govENG = entry.governorate.ENG || mapGovernorateEng(govAR) || '';
    const areaAR = entry.area.AR || '';
    let areaENG = entry.area.ENG || '';
    if (!areaENG) {
      areaENG = applyOverrides(areaAR, overridesObj) || cacheObj[areaAR] || null;
      if (!areaENG && ONLINE) {
        areaENG = await translateWithTimeout(areaAR, 'ar', 'en', 2500);
        if (areaENG) cacheObj[areaAR] = areaENG;
      }
      if (!areaENG) areaENG = transliterate(areaAR) || '';
    }
    return {
      governorate: { AR: govAR, ENG: govENG, Value: govENG },
      area: { AR: areaAR, ENG: areaENG, Value: areaENG },
    };
  }

  // Legacy shape
  const govAr = typeof entry.governorate === 'string' ? entry.governorate : '';
  const areaAr = typeof entry.area === 'string' ? entry.area : '';

  const govEng = mapGovernorateEng(govAr);
  let areaEng = applyOverrides(areaAr, overridesObj) || cacheObj[areaAr] || null;
  if (!areaEng && ONLINE) {
    areaEng = await translateWithTimeout(areaAr, 'ar', 'en', 2500);
    if (areaEng) cacheObj[areaAr] = areaEng;
  }
  if (!areaEng) areaEng = transliterate(areaAr);

  return {
    governorate: { AR: govAr, ENG: govEng, Value: govEng },
    area: { AR: areaAr, ENG: areaEng, Value: areaEng },
  };
}

async function translateWithTimeout(text, from, to, ms) {
  try {
    return await Promise.race([
      translateText(text, from, to),
      new Promise(resolve => setTimeout(() => resolve(null), ms)),
    ]);
  } catch (_) {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source file not found:', SOURCE);
    process.exit(1);
  }
  const raw = fs.readFileSync(SOURCE, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Failed parsing JSON. Ensure the file is valid JSON array.');
    throw e;
  }
  if (!Array.isArray(data)) {
    console.error('Expected an array in bosta_regions.json');
    process.exit(1);
  }

  let overridesObj = {};
  try {
    if (fs.existsSync(OVERRIDES_PATH)) {
      overridesObj = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) || {};
    }
  } catch (_) {
    overridesObj = {};
  }

  let cacheObj = {};
  try {
    if (fs.existsSync(CACHE_PATH)) {
      cacheObj = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) || {};
    }
  } catch (_) {
    cacheObj = {};
  }

  console.log(`Converting ${data.length} records (online translation: ${ONLINE ? 'on' : 'off'})...`);
  const transformed = [];
  let idx = 0;
  for (const entry of data) {
    // eslint-disable-next-line no-await-in-loop
    const t = await transformEntry(entry, overridesObj, cacheObj);
    transformed.push(t);
    idx += 1;
    if (idx % 500 === 0) {
      console.log(`  processed ${idx}/${data.length}...`);
    }
  }
  const output = JSON.stringify(transformed, null, 2) + '\n';
  fs.writeFileSync(DEST, output, 'utf8');
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheObj, null, 2) + '\n', 'utf8');
  } catch (_) {}
  console.log(`Converted ${data.length} records →`, DEST);
}

main();


