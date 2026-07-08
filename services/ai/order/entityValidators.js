/**
 * Stage 3 — Deterministic entity validation.
 */
const { normalizeArabicDigitsToLatin } = require('../../../utils/bostaRegionsServer');
const { isValidEgyptianMobile } = require('../../../utils/ainowDraftValidation');
const { sanitizeAddressText } = require('../draftContextEngine');
const { detectCodConfirmation } = require('../clarificationEngine');
const {
  extractEgyptianMobiles,
  normalizeSinglePhone,
  getPhoneValidationMessage,
} = require('../phoneFieldUtils');
const { normalizeProductDescription } = require('../textNormalizer');

const CONFIDENCE_THRESHOLD = 0.8;

/** Explicit quantity patterns — digits here are quantity, not model numbers. */
const EXPLICIT_QTY_PATTERNS = [
  /(?:quantity|qty|item\s*count|عدد|الكمية|كمية|itme)\s*(?:is\s*)?:?\s*(\d+)/i,
  /(?:need|want)\s+(\d+)\s+\w+/i,
  /(\d+)\s*(?:pieces|items|قطع|قطعة|piece|pcs|pc|bags?)\b/i,
  /\bx\s*(\d+)\b/i,
  /^(\d+)\s+(?=[\w\u0600-\u06FF])/i,
];

const MODEL_NUMBER_PRODUCTS =
  /(?:iphone|samsung|galaxy|rtx|playstation|ps\d|ipad|macbook|note\s*\d|s\d{2}|pro\s*max|ultra)/i;

function normalizeMessage(text) {
  return normalizeArabicDigitsToLatin(String(text || '').trim());
}

/**
 * Returns explicit quantity from message if user stated it, else null.
 */
function extractExplicitQuantity(message) {
  const norm = normalizeMessage(message);
  if (!norm) return null;

  for (const pattern of EXPLICIT_QTY_PATTERNS) {
    const m = norm.match(pattern);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n <= 999) return n;
    }
  }

  const arWords = { واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3 };
  for (const [word, val] of Object.entries(arWords)) {
    if (norm.includes(word) && /(?:عدد|كمية|قطع)/i.test(norm)) return val;
  }

  return null;
}

/**
 * True when numberOfItems can be accepted from this message + entity value.
 */
function isQuantityExplicitlyStated(message, value, pendingField = '') {
  if (pendingField === 'numberOfItems') return true;

  const explicit = extractExplicitQuantity(message);
  if (explicit != null) return explicit === Number(value);

  const norm = normalizeMessage(message);
  if (/^(yes|no|نعم|لا|\d{11})$/.test(norm)) return false;

  if (/^\d{1,3}$/.test(norm)) {
    const n = parseInt(norm, 10);
    return Number.isFinite(n) && n > 0 && n <= 999 && !MODEL_NUMBER_PRODUCTS.test(norm);
  }

  return false;
}

function coerceValue(field, raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (field === 'numberOfItems' || field === 'amountCOD') {
    const n = parseInt(normalizeMessage(s), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (field === 'COD' || field === 'codConfirmed' || field === 'replaceZone') {
    if (s === 'true' || /^yes$/i.test(s) || s === 'نعم' || s === 'كاش') return true;
    if (s === 'false' || /^no$/i.test(s) || s === 'لا') return false;
    return null;
  }
  if (field === 'isExpressShipping' || field === 'shippingSpeedConfirmed') {
    if (/express|سريع/i.test(s)) return true;
    if (/standard|عادي/i.test(s)) return false;
    return s === 'true';
  }
  return s;
}

/**
 * @param {{ field: string, value: *, confidence: number }} entity
 * @param {{ message: string, pendingField?: string, draft?: object, lang?: string }} ctx
 */
function validateEntity(entity, ctx = {}) {
  const { message = '', pendingField = '', draft = {}, lang = 'en' } = ctx;
  const field = entity.field;
  const confidence = Number(entity.confidence);
  const value = coerceValue(field, entity.value);

  if (!field || value === null || value === undefined || value === '') {
    return { ok: false, field, value: null, confidence, error: 'empty' };
  }

  if (!Number.isFinite(confidence) || confidence < CONFIDENCE_THRESHOLD) {
    return { ok: false, field, value, confidence, error: 'low_confidence', needsClarification: true };
  }

  switch (field) {
    case 'phoneNumber':
    case 'otherPhoneNumber': {
      let digits = normalizeSinglePhone(value);
      if (!digits && field === 'phoneNumber') {
        const extracted = extractEgyptianMobiles(String(value));
        if (extracted.length >= 1) digits = extracted[0];
      }
      if (!digits || !isValidEgyptianMobile(digits)) {
        return {
          ok: false,
          field,
          value: digits || String(value).replace(/\D/g, ''),
          confidence,
          error: 'invalid_phone',
          message: getPhoneValidationMessage(lang, field),
        };
      }
      if (field === 'phoneNumber' && pendingField === 'phoneNumber') {
        const all = extractEgyptianMobiles(message || String(value));
        if (all.length >= 2) {
          return {
            ok: true,
            field,
            value: all[0],
            confidence,
            companionPhone: all[1],
          };
        }
      }
      return { ok: true, field, value: digits, confidence };
    }

    case 'numberOfItems': {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 999) {
        return { ok: false, field, value: n, confidence, error: 'invalid_count' };
      }
      const explicit =
        pendingField === 'numberOfItems' ||
        isQuantityExplicitlyStated(message, n, pendingField);
      if (!explicit) {
        return { ok: false, field, value: n, confidence, error: 'implicit_quantity', needsClarification: true };
      }
      return { ok: true, field, value: n, confidence };
    }

    case 'productDescription':
    case 'currentPD':
    case 'newPD': {
      const product = normalizeProductDescription(String(value), lang);
      if (!product || product.length < 1) {
        return { ok: false, field, value, confidence, error: 'empty_product' };
      }
      return { ok: true, field, value: product, confidence };
    }

    case 'address': {
      const addr = sanitizeAddressText(String(value), lang === 'ar' ? 'ar' : 'en');
      if (!addr || addr.length < 3) {
        return { ok: false, field, value, confidence, error: 'invalid_address' };
      }
      const zoneHint = draft.zoneQuery || draft.zone || '';
      if (zoneHint && addr.toLowerCase() === String(zoneHint).toLowerCase()) {
        return { ok: false, field, value: addr, confidence, error: 'address_equals_zone' };
      }
      return { ok: true, field, value: addr, confidence };
    }

    case 'zoneQuery': {
      const zq = String(value).trim();
      if (!zq || zq.length < 2) {
        return { ok: false, field, value, confidence, error: 'invalid_zone' };
      }
      return { ok: true, field, value: zq, confidence };
    }

    case 'COD':
    case 'codConfirmed': {
      if (pendingField === 'codConfirmation') {
        const cod = detectCodConfirmation(message);
        if (cod) {
          return { ok: true, field: 'codConfirmed', value: true, confidence, COD: cod.COD };
        }
      }
      if (pendingField === 'codConfirmation' || /\b(cod|cash|كاش)\b/i.test(message)) {
        const boolVal = typeof value === 'boolean' ? value : /yes|نعم|كاش|cod/i.test(String(value));
        return { ok: true, field: 'codConfirmed', value: true, confidence, COD: boolVal };
      }
      if (typeof value === 'boolean') {
        return { ok: true, field: 'codConfirmed', value: true, confidence, COD: value };
      }
      return { ok: false, field, value, confidence, error: 'ambiguous_cod' };
    }

    case 'amountCOD': {
      const amt = Number(value);
      if (!Number.isFinite(amt) || amt <= 0) {
        return { ok: false, field, value: amt, confidence, error: 'invalid_amount' };
      }
      return { ok: true, field, value: amt, confidence, COD: true, codConfirmed: true };
    }

    case 'fullName':
    case 'Notes':
    case 'originalOrderNumber':
    case 'returnReason':
    case 'orderType':
      return { ok: true, field, value: String(value).trim(), confidence };

    case 'replaceZone':
      return { ok: true, field, value: value === true, confidence };

    default:
      return { ok: true, field, value, confidence };
  }
}

function validateEntities(entities, ctx = {}) {
  const validated = [];
  const rejected = [];

  for (const entity of entities || []) {
    const result = validateEntity(entity, ctx);
    if (result.ok) {
      validated.push(result);
    } else {
      rejected.push(result);
    }
  }

  return { validated, rejected };
}

module.exports = {
  CONFIDENCE_THRESHOLD,
  extractExplicitQuantity,
  isQuantityExplicitlyStated,
  validateEntity,
  validateEntities,
  coerceValue,
};
