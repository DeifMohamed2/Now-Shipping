/* Translation wrapper preferring enterprise providers automatically.
   Priority: Azure → Google → DeepL → '@vitalets/google-translate-api' → null
   All deps are optional. Install only what you use.
*/

const path = require('path');

// Fast local overrides for common Egyptian governorates/places
const LOCAL_KNOWN = new Map([
  ['القاهرة', 'Cairo'],
  ['القاهره', 'Cairo'],
  ['الجيزة', 'Giza'],
  ['الاسكندريه', 'Alexandria'],
  ['الإسكندرية', 'Alexandria'],
  ['الأقصر', 'Luxor'],
  ['الاقصر', 'Luxor'],
  ['اسوان', 'Aswan'],
  ['أسوان', 'Aswan'],
  ['قنا', 'Qena'],
  ['سوهاج', 'Sohag'],
  ['أسيوط', 'Assiut'],
  ['اسيوط', 'Assiut'],
  ['المنيا', 'Minya'],
  ['بني سويف', 'Beni Suef'],
  ['الفيوم', 'Faiyum'],
  ['البحيرة', 'Beheira'],
  ['الغربية', 'Gharbia'],
  ['الدقهلية', 'Dakahlia'],
  ['الشرقية', 'Sharqia'],
  ['القليوبية', 'Qalyubia'],
  ['كفر الشيخ', 'Kafr El Sheikh'],
  ['دمياط', 'Damietta'],
  ['بورسعيد', 'Port Said'],
  ['السويس', 'Suez'],
  ['البحر الأحمر', 'Red Sea'],
  ['البحر الاحمر', 'Red Sea'],
  ['الوادي الجديد', 'New Valley'],
  ['مطروح', 'Matrouh'],
  ['شمال سيناء', 'North Sinai'],
  ['جنوب سيناء', 'South Sinai'],
  // Frequent areas
  ['ابو سمبل', 'Abu Simbel'],
  ['ادفو', 'Edfu'],
  ['كوم امبو', 'Kom Ombo'],
  ['دراو', 'Daraw'],
  ['راس التين', 'Ras El Tin'],
]);

// Azure
let azureClient = null;
try {
  // npm i @azure/ai-translation-text
  const { TextTranslationClient, AzureKeyCredential } = require('@azure/ai-translation-text');
  const AZURE_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT;
  const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY;
  if (AZURE_ENDPOINT && AZURE_KEY) {
    azureClient = new TextTranslationClient(AZURE_ENDPOINT, new AzureKeyCredential(AZURE_KEY));
  }
} catch (_) {
  azureClient = null;
}

// Google Cloud
let gcpClient = null;
try {
  // npm i @google-cloud/translate
  const { v2: { Translate } } = require('@google-cloud/translate');
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.resolve(__dirname, '..', 'serviceAccountKey.json');
  gcpClient = new Translate({ keyFilename: credsPath });
} catch (_) {
  gcpClient = null;
}

// DeepL
let deepl = null;
try {
  // npm i deepl-node
  const { Translator } = require('deepl-node');
  const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
  if (DEEPL_API_KEY) {
    deepl = new Translator(DEEPL_API_KEY);
  }
} catch (_) {
  deepl = null;
}

// Vitalets (no API key)
let vitalets = null;
try {
  // npm i @vitalets/google-translate-api
  vitalets = require('@vitalets/google-translate-api');
} catch (_) {
  vitalets = null;
}

async function translateText(text, from = 'ar', to = 'en') {
  if (!text || typeof text !== 'string') return null;

  // Local quick hits
  if (LOCAL_KNOWN.has(text)) return LOCAL_KNOWN.get(text);

  // Azure
  if (azureClient) {
    try {
      const res = await azureClient.translate([{ text }], to, { from });
      const out = res?.[0]?.translations?.[0]?.text;
      if (out) return out.trim();
    } catch (_) {}
  }

  // Google Cloud
  if (gcpClient) {
    try {
      const [translation] = await gcpClient.translate(text, { from, to });
      const out = Array.isArray(translation) ? translation[0] : translation;
      if (out && typeof out === 'string') return out.trim();
    } catch (_) {}
  }

  // DeepL (Arabic support is improving; keep as optional)
  if (deepl) {
    try {
      const res = await deepl.translateText(text, from?.toUpperCase?.() || 'AR', to?.toUpperCase?.() || 'EN');
      const out = Array.isArray(res) ? res[0]?.text : res?.text;
      if (out) return out.trim();
    } catch (_) {}
  }

  // Vitalets (no API key)
  if (vitalets) {
    try {
      const res = await vitalets(text, { from, to });
      const out = (res && res.text) ? String(res.text).trim() : null;
      if (out) return out;
    } catch (_) {}
  }

  return null;
}

module.exports = { translateText };


