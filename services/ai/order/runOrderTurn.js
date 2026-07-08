/**
 * Order pipeline orchestrator — Stages 1–6.
 */
const { classifyOrderIntent } = require('./intentClassifier');
const { extractEntitiesFromMessage, extractPostStructuralFallback } = require('./entityExtractor');
const { validateEntities } = require('./entityValidators');
const { resolveConflicts } = require('./conflictResolver');
const { applyEntities } = require('./orderState');
const { buildOrderResponse, buildZonePickResponse } = require('./responseBuilder');
const { applyRegionResolution, resolveZonePickFromMessage, isValidGovernmentAndZone } = require('../regionResolver');
const { resolveConversationLang } = require('../conversationLang');
const { scrubPhoneFromNotes } = require('../clarificationEngine');
const { sanitizePhoneFields, getPhoneValidationMessage } = require('../phoneFieldUtils');
const { isValidEgyptianMobile } = require('../../../utils/ainowDraftValidation');
const { normalizeDraftFields } = require('../textNormalizer');
const {
  enforcePostStructuralOrder,
  getClarificationQueue,
} = require('../orderDraftService');

function applyDefaultPickupIfSingle(fields, userData) {
  const pickups = userData?.pickUpAddresses || [];
  if (pickups.length === 1 && !fields.selectedPickupAddressId) {
    fields.selectedPickupAddressId = pickups[0].addressId;
  }
  return fields;
}

function isOrderPipelineEnabled() {
  const flag = process.env.AINOW_ORDER_PIPELINE;
  if (flag === 'false' || flag === '0') return false;
  return true;
}

function draftHasValidZone(fields) {
  if (!fields?.government || !fields?.zone) return false;
  return isValidGovernmentAndZone(fields.government, fields.zone).ok;
}

function applyZonePickToDraft(draftFields, zonePick, lang, userData) {
  let next = {
    ...draftFields,
    government: zonePick.government,
    zone: zonePick.zone,
  };
  delete next.zoneQuery;
  const { fields: resolvedFields, regionHints: newHints } = applyRegionResolution(next, {
    splitAddress: true,
    lang,
    trustUserZone: true,
  });
  next = normalizeDraftFields(resolvedFields, lang);
  next = enforcePostStructuralOrder(next, userData);
  next = applyDefaultPickupIfSingle(next, userData);
  return { draftFields: next, regionHints: newHints };
}

const POST_STRUCTURAL_PENDING = new Set([
  'codConfirmation',
  'amountCOD',
  'shippingSpeed',
  'selectedPickupAddressId',
]);

function isPostStructuralPending(pendingField) {
  return POST_STRUCTURAL_PENDING.has(pendingField);
}

/**
 * @param {object} params
 */
async function runOrderTurn({
  userId,
  userData,
  userContext,
  conversation,
  message,
  regionHints = {},
  lang: langHint,
  skipLlm = false,
  prevPendingField = null,
  history = [],
}) {
  const pendingField =
    prevPendingField || conversation.activeDraft?.pendingField || null;
  const existingDraft = conversation.activeDraft?.fields || {};
  const hasDraft = conversation.activeDraft?.type === 'order' || Object.keys(existingDraft).length > 0;

  const preferredLang =
    userContext?.preferredLang === 'ar' || langHint === 'ar' ? 'ar' : 'en';
  const langResolved = resolveConversationLang(conversation, preferredLang, message);
  const langEarly = langResolved;
  const regionOptions = conversation.activeDraft?.regionOptions;
  const msgTrimmed = String(message || '').trim();
  if (msgTrimmed && (regionOptions?.length || pendingField === 'zone')) {
    const zonePick = resolveZonePickFromMessage(message, regionOptions);
    if (zonePick) {
      const { draftFields, regionHints: newHints } = applyZonePickToDraft(
        existingDraft,
        zonePick,
        langEarly,
        userData
      );
      conversation.activeDraft = {
        ...conversation.activeDraft,
        type: 'order',
        fields: draftFields,
        regionOptions: null,
        pendingField: null,
      };
      return buildOrderResponse({
        draftFields,
        userData,
        userContext,
        conversation,
        lang: langEarly,
        userId,
        regionHints: newHints,
        prevPendingField: 'zone',
        serverOnly: true,
      });
    }
  }

  const draftMeta = {
    draftType: 'order',
    pendingField,
    missingFields: conversation.activeDraft?.missingFields || [],
  };

  let extraction;
  if (skipLlm || isPostStructuralPending(pendingField)) {
    const deterministic = extractPostStructuralFallback(message, pendingField);
    if (deterministic.length) {
      extraction = {
        orderIntent: 'answer_question',
        correction: false,
        deleteFields: [],
        entities: deterministic,
        language: /[\u0600-\u06FF]/.test(message) ? 'ar' : 'en',
        replyText: '',
      };
    }
  }
  if (!extraction) {
    extraction = await extractEntitiesFromMessage({
      message,
      history,
      userContext,
      draftFields: existingDraft,
      draftMeta,
      pendingField,
      skipLlm,
    });
  }

  const lang = langResolved;

  const { intent, correction } = classifyOrderIntent({
    message,
    pendingField,
    extractionResult: extraction,
    hasDraft,
  });

  if (intent === 'cancel' || intent === 'unrelated') {
    return {
      text: lang === 'ar'
        ? 'تمام. لو محتاج حاجة تانية قولي.'
        : 'OK. Let me know if you need anything else.',
      intent: 'general_chat',
      suggestions: [],
    };
  }

  const { validated, rejected } = validateEntities(extraction.entities, {
    message,
    pendingField,
    draft: existingDraft,
    lang,
  });

  const validatedEntities = [...validated];
  for (const v of validated) {
    if (v.companionPhone && v.field === 'phoneNumber' && isValidEgyptianMobile(v.companionPhone)) {
      validatedEntities.push({
        field: 'otherPhoneNumber',
        value: v.companionPhone,
        confidence: v.confidence,
      });
    }
  }

  const lowConfidenceFields = rejected
    .filter((r) => r.needsClarification || r.error === 'low_confidence' || r.error === 'implicit_quantity')
    .map((r) => r.field);

  const decisions = resolveConflicts({
    existingDraft,
    validatedEntities: validatedEntities,
    intent,
    correction,
    deleteFields: extraction.deleteFields,
    pendingField,
  });

  const zoneEntityTouched = validated.some(
    (v) => v.field === 'zoneQuery' || v.field === 'replaceZone'
  );
  const replaceZone =
    !isPostStructuralPending(pendingField) &&
    zoneEntityTouched &&
    (extraction.entities.some((e) => e.field === 'replaceZone' && String(e.value) === 'true') ||
      correction);

  const skipZoneResolution = isPostStructuralPending(pendingField);
  let draftFields = applyEntities(existingDraft, decisions);
  draftFields = scrubPhoneFromNotes(draftFields);
  draftFields = sanitizePhoneFields(draftFields);

  let mergedHints = { ...regionHints };
  if (!skipZoneResolution) {
    const { fields: resolvedFields, regionHints: newHints } = applyRegionResolution(draftFields, {
      splitAddress: true,
      lang,
      replaceZone,
      trustUserZone: draftHasValidZone(existingDraft) || draftHasValidZone(draftFields),
    });
    draftFields = normalizeDraftFields(resolvedFields, lang);
    mergedHints = { ...mergedHints, ...newHints };
  } else {
    draftFields = normalizeDraftFields(draftFields, lang);
  }
  draftFields = enforcePostStructuralOrder(draftFields, userData);
  draftFields = applyDefaultPickupIfSingle(draftFields, userData);

  const clarificationQueue = getClarificationQueue(draftFields, userData);
  const activeField = clarificationQueue[0] || null;

  const zoneSuggestions = mergedHints.zoneSuggestions || mergedHints.ambiguousOptions;
  if (zoneSuggestions && zoneSuggestions.length && !draftFields.zone && activeField === 'zone') {
    const zoneQuery =
      draftFields.zoneQuery ||
      mergedHints.invalidZone ||
      mergedHints.resolved?.queryNorm ||
      '';
    let pickReason = mergedHints.zonePickReason || 'ambiguous';
    if (pickReason === 'ambiguous' && mergedHints.invalidZone) pickReason = 'invalid';
    if (pickReason === 'ambiguous' && mergedHints.resolved?.queryNorm && !mergedHints.resolved?.match) {
      const topScore = zoneSuggestions[0]?.score || 0;
      if (topScore < 70) pickReason = 'no_match';
    }

    return buildZonePickResponse({
      suggestions: zoneSuggestions,
      query: zoneQuery,
      lang,
      reason: pickReason,
      draftFields,
      userData,
      conversation,
      regionHints: mergedHints,
    });
  }

  if (!conversation.activeDraft || conversation.activeDraft.type !== 'order') {
    conversation.activeDraft = {
      type: 'order',
      fields: draftFields,
      missingFields: [],
      pendingField: null,
    };
  } else {
    conversation.activeDraft.fields = draftFields;
  }

  const phoneRejected = rejected.find((r) => r.error === 'invalid_phone');
  if (phoneRejected && pendingField === 'phoneNumber') {
    return {
      text: phoneRejected.message || getPhoneValidationMessage(lang, 'phoneNumber'),
      intent: 'clarify_order',
      suggestions: [],
      pendingField: 'phoneNumber',
    };
  }

  return buildOrderResponse({
    draftFields,
    userData,
    userContext,
    conversation,
    lang,
    userId,
    regionHints: mergedHints,
    extractionReply: extraction.replyText,
    prevPendingField: skipLlm ? pendingField : null,
    serverOnly: skipLlm,
    lowConfidenceFields,
  });
}

module.exports = {
  runOrderTurn,
  isOrderPipelineEnabled,
};
