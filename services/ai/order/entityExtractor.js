/**
 * Stage 2 — Entity extraction via LLM (structured JSON + per-field confidence).
 */
const { extractOrderEntities, isConfigured } = require('../../gemini/geminiClient');
const { detectCodConfirmation, detectCODAmount, detectShippingSpeed } = require('../clarificationEngine');
const { parsePhoneFieldsFromText } = require('../phoneFieldUtils');
const { coerceValue } = require('./entityValidators');

const ALLOWED_FIELDS = new Set([
  'orderType',
  'fullName',
  'phoneNumber',
  'otherPhoneNumber',
  'address',
  'zoneQuery',
  'replaceZone',
  'productDescription',
  'numberOfItems',
  'COD',
  'codConfirmed',
  'amountCOD',
  'isExpressShipping',
  'shippingSpeedConfirmed',
  'Notes',
  'originalOrderNumber',
  'returnReason',
  'currentPD',
  'newPD',
  'numberOfItemsCurrentPD',
  'numberOfItemsNewPD',
  'selectedPickupAddressId',
]);

function normalizeEntityList(rawEntities) {
  const out = [];
  for (const e of rawEntities || []) {
    if (!e || !e.field || !ALLOWED_FIELDS.has(e.field)) continue;
    const value = e.value;
    if (value === null || value === undefined || String(value).trim() === '') continue;
    out.push({
      field: e.field,
      value: coerceValue(e.field, value) ?? String(value).trim(),
      confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : 0.5,
    });
  }
  return out;
}

/**
 * Deterministic post-structural extraction for scalar pending fields (no product regex).
 */
function extractPostStructuralFallback(message, pendingField) {
  const text = String(message || '').trim();
  if (!text || !pendingField) return [];

  const entities = [];

  if (pendingField === 'codConfirmation') {
    const cod = detectCodConfirmation(text);
    if (cod) {
      entities.push({
        field: 'codConfirmed',
        value: true,
        confidence: 0.95,
        COD: cod.COD,
      });
    }
  } else if (pendingField === 'amountCOD') {
    const amt = detectCODAmount(text);
    if (amt?.amountCOD) {
      entities.push({ field: 'amountCOD', value: amt.amountCOD, confidence: 0.95 });
    }
  } else if (pendingField === 'shippingSpeed') {
    const speed = detectShippingSpeed(text);
    if (speed) {
      entities.push({
        field: 'isExpressShipping',
        value: speed.isExpressShipping,
        confidence: 0.95,
      });
    }
  } else if (pendingField === 'numberOfItems') {
    const n = parseInt(text.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > 0 && n <= 999) {
      entities.push({ field: 'numberOfItems', value: n, confidence: 0.95 });
    }
  } else if (pendingField === 'fullName') {
    entities.push({ field: 'fullName', value: text, confidence: 0.9 });
  } else if (pendingField === 'phoneNumber') {
    const parsed = parsePhoneFieldsFromText(text, {}, 'phoneNumber');
    if (parsed.phoneNumber) {
      entities.push({ field: 'phoneNumber', value: parsed.phoneNumber, confidence: 0.9 });
    }
    if (parsed.otherPhoneNumber) {
      entities.push({ field: 'otherPhoneNumber', value: parsed.otherPhoneNumber, confidence: 0.9 });
    }
  } else if (pendingField === 'address') {
    entities.push({ field: 'address', value: text, confidence: 0.85 });
  } else if (pendingField === 'productDescription') {
    entities.push({ field: 'productDescription', value: text, confidence: 0.9 });
  } else if (pendingField === 'zone') {
    entities.push({ field: 'zoneQuery', value: text, confidence: 0.85 });
  }

  return entities.map((e) => ({
    field: e.field,
    value: e.value,
    confidence: e.confidence,
  }));
}

/**
 * Call LLM for entity extraction.
 */
async function extractEntitiesFromMessage({
  message,
  history,
  userContext,
  draftFields,
  draftMeta,
  pendingField,
  skipLlm = false,
}) {
  if (skipLlm || !isConfigured()) {
    const fallback = extractPostStructuralFallback(message, pendingField);
    return {
      orderIntent: fallback.length ? 'answer_question' : 'create',
      correction: false,
      deleteFields: [],
      entities: fallback,
      language: /[\u0600-\u06FF]/.test(message) ? 'ar' : 'en',
      replyText: '',
    };
  }

  try {
    const result = await extractOrderEntities({
      userMessage: message,
      history,
      userContext,
      draftFields,
      draftMeta,
    });

    return {
      orderIntent: result.orderIntent || 'answer_question',
      correction: result.correction === true,
      deleteFields: result.deleteFields || [],
      entities: normalizeEntityList(result.entities),
      language: result.language === 'ar' ? 'ar' : 'en',
      replyText: result.replyText || '',
    };
  } catch (err) {
    console.error('Order entity extraction failed:', err.message);
    const fallback = extractPostStructuralFallback(message, pendingField);
    return {
      orderIntent: 'answer_question',
      correction: false,
      deleteFields: [],
      entities: fallback,
      language: /[\u0600-\u06FF]/.test(message) ? 'ar' : 'en',
      replyText: '',
    };
  }
}

/**
 * Convert legacy Gemini assistant response orderEntities to normalized list.
 */
function entitiesFromLegacyGemini(geminiResult) {
  if (geminiResult?.entities?.length) {
    return normalizeEntityList(geminiResult.entities);
  }
  if (geminiResult?.orderEntities?.length) {
    return normalizeEntityList(geminiResult.orderEntities);
  }
  return [];
}

module.exports = {
  extractEntitiesFromMessage,
  extractPostStructuralFallback,
  normalizeEntityList,
  entitiesFromLegacyGemini,
  ALLOWED_FIELDS,
};
