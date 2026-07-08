/**
 * Stage 6 — Build widget-compatible response from order draft state.
 */
const {
  getClarificationQueue,
  getDraftProgress,
  buildOrderPreview,
  buildCollectedChips,
  isDraftComplete,
} = require('../orderDraftService');
const {
  buildClarifyingMessage,
  buildQuickReplies,
  buildSuggestionsForField,
  buildAcknowledgment,
  buildZoneCorrectionAck,
} = require('../clarificationEngine');
const { validateOrderDraftReady } = require('../../../utils/ainowDraftValidation');

function buildZoneQuickReplies(suggestions, lang) {
  const isAr = lang === 'ar';
  return (suggestions || []).slice(0, 6).map((o) => ({
    label: isAr ? o.labelAr : o.labelEn,
    value: isAr ? o.labelAr : o.labelEn,
  }));
}

function buildZonePickQuestion({ query, lang, reason }) {
  const isAr = lang === 'ar';
  const q = String(query || '').trim() || (isAr ? 'المنطقة' : 'the area');

  if (reason === 'invalid') {
    return isAr
      ? `المنطقة اللي اتحددت مش في القائمة. اختر من الأقرب لـ «${q}»:`
      : `That area is not in our catalog. Pick the closest match for "${q}":`;
  }
  if (reason === 'no_match') {
    return isAr
      ? `مش لاقي منطقة مطابقة لـ «${q}». اختر من الأقرب:`
      : `No exact match for "${q}". Pick the closest area:`;
  }
  return isAr
    ? `في أكتر من منطقة قريبة من «${q}». اختر المنطقة الصحيحة:`
    : `More than one area matches "${q}". Pick the correct one:`;
}

function buildZonePickResponse({
  suggestions,
  query,
  lang,
  reason,
  draftFields,
  userData,
  conversation,
  regionHints,
}) {
  const zoneClarifying = buildZonePickQuestion({ query, lang, reason });
  const quickReplies = buildZoneQuickReplies(suggestions, lang);
  const pickReason = reason || 'ambiguous';
  const missingFields = getClarificationQueue(draftFields, userData);
  let text = zoneClarifying;
  const zoneCorrection = buildZoneCorrectionAck(regionHints, draftFields, lang);
  if (zoneCorrection) {
    text = `${zoneCorrection} ${text}`.trim();
  }

  conversation.activeDraft = {
    type: 'order',
    fields: draftFields,
    missingFields,
    pendingField: 'zone',
    regionOptions: suggestions,
    updatedAt: new Date(),
  };

  return {
    text,
    suggestions: [],
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields, complete: false },
    progress: getDraftProgress(draftFields, userData),
    pendingField: 'zone',
    regionOptions: suggestions,
    zonePickReason: pickReason,
    chips: buildCollectedChips(draftFields, ['zone'], lang),
    quickReplies,
  };
}

async function buildOrderReadyFailureResponse(ready, draftFields, userData, userContext, conversation, lang) {
  const blocking = ready.blockingField || 'fullName';
  const missingFields = [blocking];
  conversation.activeDraft = {
    type: 'order',
    fields: draftFields,
    missingFields,
    pendingField: blocking,
    regionOptions: null,
    updatedAt: new Date(),
  };
  const clarifying = buildClarifyingMessage(blocking, draftFields, userContext, lang);
  return {
    text: ready.errors[0] || clarifying,
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields, complete: false },
    progress: getDraftProgress(draftFields, userData),
    pendingField: blocking,
    chips: buildCollectedChips(draftFields, missingFields, lang),
    clarifyingQuestion: clarifying,
    quickReplies: buildQuickReplies(blocking, lang),
    suggestions: [],
    actions: ready.needsSettings ? require('../../../utils/ainowDraftValidation').getSettingsActions(lang) : undefined,
  };
}

/**
 * Build clarify or complete response.
 */
async function buildOrderResponse({
  draftFields,
  userData,
  userContext,
  conversation,
  lang,
  userId,
  regionHints = {},
  extractionReply = '',
  prevPendingField = null,
  serverOnly = false,
  lowConfidenceFields = [],
}) {
  const missingFields = getClarificationQueue(draftFields, userData);
  const complete = missingFields.length === 0;
  const nextField = complete ? null : missingFields[0];
  const progress = getDraftProgress(draftFields, userData);

  conversation.activeDraft = {
    type: 'order',
    fields: draftFields,
    missingFields,
    pendingField: nextField,
    regionOptions: null,
    updatedAt: new Date(),
  };

  if (complete) {
    const ready = await validateOrderDraftReady(draftFields, userData, lang, userId);
    if (!ready.ok) {
      return buildOrderReadyFailureResponse(ready, draftFields, userData, userContext, conversation, lang);
    }
    const preview = buildOrderPreview(draftFields, userData, lang);
    return {
      text: lang === 'ar'
        ? 'راجع التفاصيل واضغط تأكيد الأوردر'
        : 'Review details and tap Confirm Order',
      intent: 'create_order',
      draft: { fields: draftFields, missingFields: [], complete: true },
      progress: { collected: progress.total, total: progress.total, missingFields: [] },
      preview,
      suggestions: [],
    };
  }

  const clarifying = buildClarifyingMessage(nextField, draftFields, userContext, lang);
  const quickReplies = buildQuickReplies(nextField, lang);
  const fieldSuggestions = buildSuggestionsForField(nextField, lang, userContext);

  let text = clarifying;
  const fieldAdvanced = prevPendingField && nextField !== prevPendingField;
  if (serverOnly && prevPendingField && fieldAdvanced) {
    const ack = buildAcknowledgment(prevPendingField, lang);
    text = `${ack} ${clarifying}`.trim();
  } else if (extractionReply && extractionReply.length < 120 && fieldAdvanced) {
    text = `${extractionReply} ${clarifying}`.trim();
  }

  if (lowConfidenceFields.length) {
    const isAr = lang === 'ar';
    const clarifyNote = isAr
      ? 'محتاج تأكيد على بعض التفاصيل.'
      : 'I need to confirm a few details.';
    text = `${clarifyNote} ${clarifying}`.trim();
  }

  const zoneCorrection =
    nextField === 'zone' ? buildZoneCorrectionAck(regionHints, draftFields, lang) : '';
  if (zoneCorrection) {
    text = `${zoneCorrection} ${text}`.trim();
  }

  return {
    text,
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields, complete: false },
    progress,
    pendingField: nextField,
    chips: buildCollectedChips(draftFields, missingFields, lang),
    clarifyingQuestion: text === clarifying ? undefined : clarifying,
    quickReplies,
    suggestions: quickReplies.length > 0 ? [] : fieldSuggestions,
  };
}

module.exports = {
  buildOrderResponse,
  buildZonePickResponse,
  buildZoneQuickReplies,
  buildZonePickQuestion,
  isDraftComplete,
};
