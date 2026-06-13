/**
 * Normalize spoken Arabizi / mixed AR-EN text into clean draft field values.
 */
const { normalizeArabicDigitsToLatin, normalizeText } = require('../../utils/bostaRegionsServer');

const LEADING_NUMBER_WORDS = {
  واحد: '1',
  واحده: '1',
  واحدة: '1',
  اتنين: '2',
  اثنين: '2',
  اتنين: '2',
  تلاته: '3',
  تلاتة: '3',
  ثلاثه: '3',
  ثلاثة: '3',
  اربعه: '4',
  اربعة: '4',
  خمسه: '5',
  خمسة: '5',
};

const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toDisplayDigit(n, lang) {
  const s = String(n);
  if (lang === 'ar') {
    return s
      .split('')
      .map((ch) => (/\d/.test(ch) ? ARABIC_INDIC_DIGITS[parseInt(ch, 10)] : ch))
      .join('');
  }
  return s;
}

function normalizeLeadingAddressNumber(text, lang) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (!parts.length) return trimmed;

  const firstNorm = normalizeText(parts[0]);
  for (const [word, digit] of Object.entries(LEADING_NUMBER_WORDS)) {
    if (firstNorm === normalizeText(word)) {
      parts[0] = toDisplayDigit(digit, lang);
      return parts.join(' ');
    }
  }

  return trimmed.replace(/\s+/g, ' ').trim();
}

const PRODUCT_PATTERNS = [
  {
    pattern: /^(?:two|2)\s*(?:t-?shirts?|shirts?|tees?)$/i,
    ar: 'تيشرتين',
    en: '2 shirts',
    count: 2,
  },
  {
    pattern: /^(?:three|3)\s*(?:t-?shirts?|shirts?|tees?)$/i,
    ar: '٣ تيشرتات',
    en: '3 shirts',
    count: 3,
  },
  {
    pattern: /^(?:one|1|a)\s*(?:t-?shirt|shirt|tee)$/i,
    ar: 'تيشرت',
    en: '1 shirt',
    count: 1,
  },
  {
    pattern: /^تو\s*شيرتس?$/i,
    ar: 'تيشرتين',
    en: '2 shirts',
    count: 2,
  },
  {
    pattern: /^توشيرتس?$/i,
    ar: 'تيشرتين',
    en: '2 shirts',
    count: 2,
  },
  {
    pattern: /^تيشرتين$/,
    ar: 'تيشرتين',
    en: '2 shirts',
    count: 2,
  },
  {
    pattern: /^تيشرت$/,
    ar: 'تيشرت',
    en: '1 shirt',
    count: 1,
  },
  {
    pattern: /^قطعتين$/,
    ar: 'قطعتين',
    en: '2 items',
    count: 2,
  },
  {
    pattern: /^قطعه$/,
    ar: 'قطعة',
    en: '1 item',
    count: 1,
  },
];

function inferItemCountFromProduct(text) {
  if (!text) return null;
  const norm = normalizeText(normalizeArabicDigitsToLatin(String(text)));

  for (const entry of PRODUCT_PATTERNS) {
    if (entry.pattern.test(String(text).trim()) || entry.pattern.test(norm)) {
      return entry.count;
    }
  }

  const arMatch = norm.match(/(?:تيشرتين|قطعتين|اتنين|اثنين)/);
  if (arMatch) return 2;
  const threeMatch = norm.match(/(?:تلاته|ثلاثه|تلاتة|ثلاثة)/);
  if (threeMatch) return 3;

  const digit = String(text).match(/(\d+)/);
  if (digit) return parseInt(digit[1], 10);

  return null;
}

function detectInputLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

function normalizeProductDescription(text, lang) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  const norm = normalizeText(trimmed);
  const inputLang = detectInputLanguage(trimmed);

  for (const entry of PRODUCT_PATTERNS) {
    if (entry.pattern.test(trimmed) || entry.pattern.test(norm)) {
      return inputLang === 'ar' ? entry.ar : entry.en;
    }
  }

  if (/تو\s*شيرت/i.test(trimmed) || /two\s*shirt/i.test(trimmed)) {
    return inputLang === 'ar' ? 'تيشرتين' : '2 shirts';
  }

  return trimmed;
}

function normalizeDraftFields(fields, lang) {
  if (!fields || typeof fields !== 'object') return fields;
  const next = { ...fields };
  const isAr = lang === 'ar';

  if (next.address) {
    next.address = normalizeLeadingAddressNumber(String(next.address), isAr ? 'ar' : 'en');
  }

  if (next.productDescription) {
    next.productDescription = normalizeProductDescription(
      next.productDescription,
      detectInputLanguage(next.productDescription)
    );
    const inferred = inferItemCountFromProduct(next.productDescription);
    if (
      inferred != null &&
      (!Number.isFinite(Number(next.numberOfItems)) || Number(next.numberOfItems) <= 0)
    ) {
      next.numberOfItems = inferred;
    }
  }

  if (next.currentPD) {
    next.currentPD = normalizeProductDescription(next.currentPD, detectInputLanguage(next.currentPD));
  }
  if (next.newPD) {
    next.newPD = normalizeProductDescription(next.newPD, detectInputLanguage(next.newPD));
  }

  return next;
}

module.exports = {
  detectInputLanguage,
  normalizeLeadingAddressNumber,
  normalizeProductDescription,
  inferItemCountFromProduct,
  normalizeDraftFields,
  toDisplayDigit,
};
