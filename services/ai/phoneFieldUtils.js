/**
 * Egyptian mobile parsing — Arabic digits, secondary numbers, concatenation repair.
 */
const { normalizeArabicDigitsToLatin } = require('../../utils/bostaRegionsServer');
const { isValidEgyptianMobile } = require('../../utils/ainowDraftValidation');

const EG_MOBILE_RE = /01[0125]\d{8}/g;

const SECONDARY_PHONE_MARKERS = [
  /رقم\s*(?:تاني|ثاني|آخر|اخر|إضافي|اضافي)/i,
  /وعنده\s+رقم/i,
  /عنده\s+رقم\s*(?:تاني|ثاني|آخر|اخر)?/i,
  /other\s+phone/i,
  /second\s+phone/i,
  /alt(?:ernate)?\s+phone/i,
  /another\s+(?:phone|number|mobile)/i,
];

function extractEgyptianMobiles(text) {
  const normalized = normalizeArabicDigitsToLatin(String(text || ''))
    .replace(/[^\d]/g, '');
  if (!normalized) return [];

  const matches = normalized.match(new RegExp(EG_MOBILE_RE.source, 'g'));
  if (!matches) return [];

  const unique = [];
  for (const m of matches) {
    if (!unique.includes(m)) unique.push(m);
  }
  return unique;
}

function hasSecondaryPhoneMarker(text) {
  return SECONDARY_PHONE_MARKERS.some((p) => p.test(String(text || '')));
}

function normalizeSinglePhone(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = normalizeArabicDigitsToLatin(String(value)).replace(/\D/g, '');
  if (isValidEgyptianMobile(digits)) return digits;
  const extracted = extractEgyptianMobiles(digits);
  return extracted[0] || null;
}

/**
 * Parse primary / secondary phones from free text.
 */
function parsePhoneFieldsFromText(text, draft = {}, pendingField = null) {
  const raw = String(text || '').trim();
  if (!raw) return {};

  const phones = extractEgyptianMobiles(raw);
  if (!phones.length) return {};

  const hasMarker = hasSecondaryPhoneMarker(raw);
  const existingPrimary = normalizeSinglePhone(draft?.phoneNumber);
  const result = {};

  if (pendingField === 'phoneNumber' || (!existingPrimary && phones.length)) {
    if (phones.length >= 2) {
      result.phoneNumber = phones[0];
      result.otherPhoneNumber = phones[1];
    } else if (hasMarker && existingPrimary && phones[0] !== existingPrimary) {
      result.otherPhoneNumber = phones[0];
    } else if (hasMarker && !existingPrimary) {
      result.phoneNumber = phones[0];
    } else {
      result.phoneNumber = phones[0];
    }
    return result;
  }

  if (hasMarker || phones.length >= 1) {
    const other = phones.find((p) => p !== existingPrimary) || (hasMarker ? phones[0] : null);
    if (other && other !== existingPrimary) {
      result.otherPhoneNumber = other;
    }
  }

  return result;
}

/**
 * Repair concatenated or messy phone fields on a draft.
 */
function sanitizePhoneFields(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const next = { ...fields };

  if (next.phoneNumber) {
    const digits = normalizeArabicDigitsToLatin(String(next.phoneNumber)).replace(/\D/g, '');
    if (!isValidEgyptianMobile(digits)) {
      const extracted = extractEgyptianMobiles(digits);
      if (extracted.length >= 1) {
        next.phoneNumber = extracted[0];
        if (extracted.length >= 2 && !next.otherPhoneNumber) {
          next.otherPhoneNumber = extracted[1];
        }
      }
    } else {
      next.phoneNumber = digits;
    }
  }

  if (next.otherPhoneNumber) {
    const other = normalizeSinglePhone(next.otherPhoneNumber);
    if (other) next.otherPhoneNumber = other;
    else delete next.otherPhoneNumber;
  }

  if (
    next.phoneNumber &&
    next.otherPhoneNumber &&
    String(next.phoneNumber) === String(next.otherPhoneNumber)
  ) {
    delete next.otherPhoneNumber;
  }

  return next;
}

function getPhoneValidationMessage(lang, field = 'phoneNumber') {
  const isAr = lang === 'ar';
  if (field === 'otherPhoneNumber') {
    return isAr
      ? 'رقم الموبايل الإضافي لازم يكون ١١ رقم مصري صحيح (010 / 011 / 012 / 015).'
      : 'Alternate phone must be a valid 11-digit Egyptian mobile (010 / 011 / 012 / 015).';
  }
  return isAr
    ? 'رقم الموبايل لازم يكون ١١ رقم مصري صحيح ويبدأ بـ 010 أو 011 أو 012 أو 015.'
    : 'Phone must be a valid 11-digit Egyptian mobile starting with 010, 011, 012, or 015.';
}

module.exports = {
  EG_MOBILE_RE,
  SECONDARY_PHONE_MARKERS,
  extractEgyptianMobiles,
  hasSecondaryPhoneMarker,
  normalizeSinglePhone,
  parsePhoneFieldsFromText,
  sanitizePhoneFields,
  getPhoneValidationMessage,
};
