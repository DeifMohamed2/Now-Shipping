const Order = require('../../models/order');
const Pickup = require('../../models/pickup');
const LedgerEntry = require('../../models/ledgerEntry');
const User = require('../../models/user');
const { AssistantConversation } = require('../../models/assistant');
const {
  normalizeFieldsFromBody,
  validateOrderFieldsStructural,
  applyPickupDefaults,
  validatePickupForOrderCreation,
  validateReturnOrderAsync,
  generateUniqueOrderNumber,
  buildOrderDocumentFromFields,
} = require('../../utils/orderCreationHelper');
const { extractAssistantResponse, transcribeAndExtract, isConfigured } = require('../gemini/geminiClient');
const {
  applyRegionResolution,
  resolveZoneQuery,
  splitAddressAndZoneFromText,
} = require('./regionResolver');
const {
  mergeDraft,
  enforcePostStructuralOrder,
  getMissingRequiredFields,
  isDraftComplete,
  buildOrderPreview,
  buildCollectedChips,
  draftToSubmitBody,
  getDraftProgress,
  getClarificationQueue,
} = require('./orderDraftService');
const {
  buildClarifyingMessage,
  buildQuickReplies,
  buildSuggestionsForField,
  extractFromUserReply,
  scrubPhoneFromNotes,
  buildAcknowledgment,
  mergeClarifyingText,
  splitAckFromGeminiReply,
  looksLikeAddressReply,
} = require('./clarificationEngine');
const { normalizeDraftFields } = require('./textNormalizer');
const { shouldRefuse, buildScopeRefusal } = require('./scopeGuard');
const {
  isHelpQuestion,
  detectPlatformHelp,
  buildPlatformHelpResponse,
  buildHelpTopicSuggestion,
} = require('./platformHelpEngine');
const { getPickupDateTooEarlyMessage } = require('../../utils/pickupDatePolicy');
const {
  validatePickupDraftReady,
  validateOrderDraftReady,
  isConfirmPickupPhrase,
  isConfirmOrderPhrase,
  isCancelDraftPhrase,
  getSettingsActions,
} = require('../../utils/ainowDraftValidation');
const {
  mergePickupDraft,
  isPickupDraftComplete,
  getPickupClarificationQueue,
  getPickupDraftProgress,
  buildPickupPreview,
  buildPickupChips,
  applyPickupDraftDefaults,
  validatePickupDate,
  formatPickupStatus,
  formatPickupDate,
  createPickupFromDraft,
  validatePickupOrderCount,
  PICKUP_ORDER_COUNT_MAX,
  PICKUP_PRIORITY,
} = require('./pickupDraftService');
const {
  buildPickupClarifyingMessage,
  buildPickupQuickReplies,
  buildPickupSuggestionsForField,
  buildPickupStructuredField,
  extractPickupFieldsFromMessage,
  buildPickupAcknowledgment,
  extractPickupFieldsFromGemini,
} = require('./pickupClarificationEngine');

const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(userId) {
  const key = String(userId);
  const now = Date.now();
  let entry = rateLimitMap.get(key);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    entry = { start: now, count: 0 };
    rateLimitMap.set(key, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

async function getUserContext(userId, preferredLang = 'en') {
  try {
    const user = await User.findById(userId).select('name email brandInfo pickUpAddresses');
    const totalOrders = await Order.countDocuments({ business: userId });
    const completedOrders = await Order.countDocuments({ business: userId, orderStatus: 'completed' });
    const pendingOrders = await Order.countDocuments({
      business: userId,
      orderStatus: { $in: ['new', 'processing', 'headingToCustomer'] },
    });
    const recentOrders = await Order.find({ business: userId })
      .sort({ orderDate: -1 })
      .limit(5)
      .select('orderNumber orderStatus orderShipping.orderType orderCustomer.fullName');
    const balanceResult = await LedgerEntry.aggregate([
      { $match: { business: userId, payoutId: null } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalBalance = balanceResult.length > 0 ? balanceResult[0].total : 0;

    const pickupAddresses = (user?.pickUpAddresses || []).map((p) => ({
      addressId: p.addressId,
      label: p.addressName || p.label || p.adressDetails || p.area || 'Pickup',
      isDefault: !!p.isDefault,
      city: p.city,
      pickupPhone: p.pickupPhone,
    }));

    return {
      preferredLang: preferredLang === 'ar' ? 'ar' : 'en',
      user: {
        name: user?.name || 'User',
        businessName: user?.brandInfo?.brandName || user?.name || 'Your Business',
      },
      pickupAddresses,
      statistics: {
        totalOrders,
        completedOrders,
        pendingOrders,
        completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
      },
      recentActivity: { orders: recentOrders },
      financials: { balance: totalBalance },
    };
  } catch (error) {
    console.error('getUserContext error:', error);
    return {
      preferredLang: preferredLang === 'ar' ? 'ar' : 'en',
      user: { name: 'User' },
      pickupAddresses: [],
      statistics: {},
      recentActivity: {},
      financials: {},
    };
  }
}

async function getOrCreateConversation(userId) {
  let conversation = await AssistantConversation.findOne({ user: userId, isActive: true }).sort({
    updatedAt: -1,
  });
  if (!conversation) {
    conversation = new AssistantConversation({
      user: userId,
      messages: [],
      activeDraft: { type: null, fields: {}, missingFields: [] },
    });
    await conversation.save();
  }
  return conversation;
}

function buildFallbackResponse(lang) {
  const isAr = lang === 'ar';
  return {
    text: isAr
      ? 'عذراً، خدمة AINOW غير متاحة حالياً. يمكنك إنشاء أوردر يدوياً من صفحة إنشاء الأوردر.'
      : 'Sorry, AINOW is temporarily unavailable. You can create an order manually.',
    suggestions: isAr
      ? ['إنشاء أوردر يدوي', 'عرض الطلبات', 'المحفظة']
      : ['Create order manually', 'View orders', 'Wallet'],
    actions: [{ text: isAr ? 'إنشاء أوردر' : 'Create Order', url: '/business/create-order' }],
  };
}

function buildGeminiErrorResponse(lang) {
  const isAr = lang === 'ar';
  return {
    text: isAr
      ? 'حصل خطأ مؤقت في المعالجة. حاول مرة أخرى أو أكمل الأوردر يدوياً.'
      : 'A temporary processing error occurred. Please try again or create the order manually.',
    suggestions: isAr ? ['حاول مرة أخرى', 'إنشاء أوردر يدوي'] : ['Try again', 'Create order manually'],
    actions: [{ text: isAr ? 'إنشاء أوردر' : 'Create Order', url: '/business/create-order' }],
  };
}

function shouldUseDraftFallback(conversation) {
  const draft = conversation.activeDraft;
  if (!draft) return false;
  if (draft.type === 'order' || draft.type === 'pickup') return true;
  if (draft.pendingField) return true;
  const fields = draft.fields || {};
  return Object.keys(fields).some((k) => {
    const v = fields[k];
    return v !== null && v !== undefined && v !== '' && v !== false;
  });
}

function buildDraftMeta(conversation) {
  return {
    draftType: conversation.activeDraft?.type || '',
    pendingField: conversation.activeDraft?.pendingField || '',
    missingFields: conversation.activeDraft?.missingFields || [],
  };
}

async function handleOrderStatusIntent(userId, orderNumberQuery, lang) {
  const isAr = lang === 'ar';
  if (!orderNumberQuery) {
    return {
      text: isAr ? 'ما رقم الأوردر اللي عايز تتابعه؟' : 'Which order number would you like to track?',
      suggestions: isAr ? ['آخر الأوردرات'] : ['Recent orders'],
      intent: 'order_status',
    };
  }

  const num = String(orderNumberQuery).replace(/\D/g, '');
  const order = await Order.findOne({ orderNumber: num, business: userId }).select(
    'orderNumber orderStatus orderShipping orderDate orderCustomer.fullName'
  );

  if (!order) {
    return {
      text: isAr ? `لم أجد أوردر برقم ${num}.` : `Order #${num} was not found.`,
      suggestions: isAr ? ['عرض كل الطلبات'] : ['View all orders'],
      actions: [{ text: isAr ? 'الطلبات' : 'Orders', url: '/business/orders' }],
      intent: 'order_status',
    };
  }

  const name = order.orderCustomer?.fullName || '';
  const status = order.orderStatus;
  const type = order.orderShipping?.orderType || 'Deliver';

  return {
    text: isAr
      ? `أوردر #${order.orderNumber} — ${name}\nالحالة: ${status}\nالنوع: ${type}`
      : `Order #${order.orderNumber} — ${name}\nStatus: ${status}\nType: ${type}`,
    data: [{ orderNumber: order.orderNumber, status, type, customer: name }],
    suggestions: isAr ? ['تفاصيل الأوردر', 'أوردر جديد'] : ['Order details', 'New order'],
    actions: [
      { text: isAr ? 'التفاصيل' : 'Details', url: `/business/order-details/${order.orderNumber}` },
    ],
    intent: 'order_status',
  };
}

async function handleWalletIntent(userId, lang) {
  const isAr = lang === 'ar';
  const balanceResult = await LedgerEntry.aggregate([
    { $match: { business: userId, payoutId: null } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const balance = balanceResult.length > 0 ? balanceResult[0].total : 0;

  return {
    text: isAr
      ? `رصيدك الحالي المتاح: ${balance.toFixed(2)} ج.م`
      : `Your current available balance: ${balance.toFixed(2)} EGP`,
    suggestions: isAr ? ['عرض المحفظة', 'الطلبات'] : ['View wallet', 'Orders'],
    actions: [{ text: isAr ? 'المحفظة' : 'Wallet', url: '/business/wallet' }],
    intent: 'wallet',
  };
}

function shouldStartPickupDraft(message, geminiResult, conversation) {
  if (conversation.activeDraft?.type === 'pickup') return false;
  if (geminiResult?.intent === 'create_pickup' || geminiResult?.intent === 'clarify_pickup') {
    return true;
  }
  const m = String(message || '').trim();
  if (/(حالة|status|فين|where).*(استلام|pickup)/i.test(m) && /\d{5,}/.test(m)) {
    return false;
  }
  return (
    /(جدول|جدولة|اعمل|عايز|محتاج|create|schedule|new|book).*(استلام|pickup)/i.test(m)
    || /^(جدولة استلام|جدول استلام|schedule pickup|new pickup|اعمل استلام)$/i.test(m)
  );
}

function isPickupStatusQuery(message, geminiResult) {
  if (geminiResult?.intent === 'pickup_status') return true;
  if (geminiResult?.pickupNumberQuery) return true;
  const m = String(message || '');
  return /\d{5,}/.test(m) && /(حالة|status|فين|where|استلام|pickup)/i.test(m);
}

async function handlePickupListIntent(userId, lang) {
  const isAr = lang === 'ar';
  const recentPickups = await Pickup.find({ business: userId })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('pickupNumber picikupStatus pickupDate numberOfOrders');

  let text = isAr
    ? 'أقدر أساعدك في جدولة استلام جديد أو متابعة استلاماتك.'
    : 'I can help you schedule a new pickup or check your recent pickups.';

  if (recentPickups.length) {
    const lines = recentPickups.map((p) => {
      const status = formatPickupStatus(p.picikupStatus, lang);
      const date = p.pickupDate ? formatPickupDate(p.pickupDate, lang) : '';
      const orders = p.numberOfOrders ? (isAr ? `${p.numberOfOrders} أوردر` : `${p.numberOfOrders} orders`) : '';
      return `#${p.pickupNumber} — ${status}${date ? ` · ${date}` : ''}${orders ? ` · ${orders}` : ''}`;
    });
    text += isAr ? `\n\nآخر الاستلامات:\n${lines.join('\n')}` : `\n\nRecent pickups:\n${lines.join('\n')}`;
  } else {
    text += isAr
      ? '\n\nمفيش استلامات مسجلة لسه. تحب نجدول أول استلام؟'
      : '\n\nNo pickups yet. Would you like to schedule your first one?';
  }

  return {
    text,
    data: recentPickups.map((p) => ({
      pickupNumber: p.pickupNumber,
      status: p.picikupStatus,
    })),
    suggestions: isAr ? ['جدولة استلام', 'حالة استلام'] : ['Schedule pickup', 'Pickup status'],
    quickReplies: isAr
      ? [{ label: 'جدولة استلام جديد', value: 'عايز أجدول استلام' }]
      : [{ label: 'Schedule new pickup', value: 'Schedule a new pickup' }],
    actions: [{ text: isAr ? 'كل الاستلامات' : 'All pickups', url: '/business/pickups' }],
    intent: 'pickup',
  };
}

async function handlePickupStatusIntent(userId, pickupNumberQuery, lang) {
  const isAr = lang === 'ar';
  const num = String(pickupNumberQuery || '').replace(/\D/g, '');
  if (!num) {
    return {
      text: isAr ? 'ما رقم الاستلام اللي عايز تتابعه؟' : 'Which pickup number would you like to track?',
      suggestions: isAr ? ['جدولة استلام'] : ['Schedule pickup'],
      intent: 'pickup_status',
    };
  }

  const pickup = await Pickup.findOne({ pickupNumber: num, business: userId }).select(
    'pickupNumber picikupStatus pickupDate numberOfOrders pickupFees phoneNumber'
  );

  if (!pickup) {
    return {
      text: isAr ? `لم أجد استلام برقم ${num}.` : `Pickup #${num} was not found.`,
      suggestions: isAr ? ['جدولة استلام', 'كل الاستلامات'] : ['Schedule pickup', 'All pickups'],
      actions: [{ text: isAr ? 'الاستلامات' : 'Pickups', url: '/business/pickups' }],
      intent: 'pickup_status',
    };
  }

  const status = formatPickupStatus(pickup.picikupStatus, lang);
  const date = pickup.pickupDate ? formatPickupDate(pickup.pickupDate, lang) : '—';

  return {
    text: isAr
      ? `استلام #${pickup.pickupNumber}\nالحالة: ${status}\nالتاريخ: ${date}\nعدد الأوردرات: ${pickup.numberOfOrders}\nالرسوم: ${pickup.pickupFees} ج.م`
      : `Pickup #${pickup.pickupNumber}\nStatus: ${status}\nDate: ${date}\nOrders: ${pickup.numberOfOrders}\nFee: ${pickup.pickupFees} EGP`,
    data: [{
      pickupNumber: pickup.pickupNumber,
      status: pickup.picikupStatus,
      pickupDate: pickup.pickupDate,
      numberOfOrders: pickup.numberOfOrders,
    }],
    suggestions: isAr ? ['تفاصيل الاستلام', 'جدولة استلام'] : ['Pickup details', 'Schedule pickup'],
    actions: [
      { text: isAr ? 'التفاصيل' : 'Details', url: `/business/pickup-details/${pickup.pickupNumber}` },
    ],
    intent: 'pickup_status',
  };
}

function applyDefaultPickupIfSingle(fields, userData) {
  const pickups = userData?.pickUpAddresses || [];
  if (pickups.length === 1 && !fields.selectedPickupAddressId) {
    fields.selectedPickupAddressId = pickups[0].addressId;
  }
  return fields;
}

function buildZoneQuickReplies(suggestions, lang) {
  const isAr = lang === 'ar';
  return suggestions.slice(0, 6).map((o) => ({
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
      ? `منطقة «${q}» مش موجودة بالظبط في قائمتنا. دي أقرب المناطق:`
      : `"${q}" is not an exact catalog match. Here are the closest areas:`;
  }
  return isAr
    ? `في أكثر من منطقة قريبة من «${q}». اختر الأنسب:`
    : `Several areas are close to "${q}". Pick the best match:`;
}

function buildZonePickResponse({
  suggestions,
  query,
  lang,
  reason,
  draftFields,
  userData,
  conversation,
  geminiResult,
  serverOnly,
  prevPendingField,
}) {
  const isAr = lang === 'ar';
  const zoneClarifying = buildZonePickQuestion({ query, lang, reason });
  const quickReplies = buildZoneQuickReplies(suggestions, lang);
  const pickReason = reason || 'ambiguous';

  conversation.activeDraft = {
    type: 'order',
    fields: draftFields,
    missingFields: ['zone'],
    pendingField: 'zone',
    regionOptions: suggestions,
    updatedAt: new Date(),
  };

  const ack =
    serverOnly && prevPendingField
      ? buildAcknowledgment(prevPendingField, lang)
      : splitAckFromGeminiReply(geminiResult?.replyText, zoneClarifying);

  return {
    text: ack,
    suggestions: [],
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields: ['zone'], complete: false },
    progress: getDraftProgress(draftFields, userData),
    pendingField: 'zone',
    regionOptions: suggestions,
    zonePickReason: pickReason,
    chips: buildCollectedChips(draftFields, ['zone'], lang),
    clarifyingQuestion: zoneClarifying,
    quickReplies,
  };
}

function formatConfirmApiResult(result) {
  if (!result.success) {
    return {
      text: result.error || 'Could not complete request.',
      suggestions: [],
      intent: 'error',
      draft: { complete: false },
    };
  }
  return {
    text: result.text,
    actions: result.actions || [],
    suggestions: [],
    intent: result.pickupNumber ? 'pickup_created' : 'order_created',
    draft: { complete: false },
  };
}

function buildPickupReadyFailureResponse(ready, draftFields, userData, userContext, conversation, lang) {
  const blocking = ready.blockingField && PICKUP_PRIORITY.includes(ready.blockingField)
    ? ready.blockingField
    : 'pickupAddressId';
  const missingFields = [blocking];
  conversation.activeDraft = {
    type: 'pickup',
    fields: draftFields,
    missingFields,
    pendingField: blocking,
    regionOptions: null,
    updatedAt: new Date(),
  };
  const clarifying = buildPickupClarifyingMessage(blocking, draftFields, userContext, lang);
  const response = {
    text: ready.errors[0] || clarifying,
    intent: 'clarify_pickup',
    draft: { fields: draftFields, missingFields, complete: false },
    progress: getPickupDraftProgress(draftFields, userData),
    pendingField: blocking,
    chips: buildPickupChips(draftFields, missingFields, lang),
    clarifyingQuestion: clarifying,
    quickReplies: buildPickupQuickReplies(blocking, lang),
    structuredField: buildPickupStructuredField(blocking, lang, userContext, draftFields, userData),
    suggestions: [],
  };
  if (ready.needsSettings) {
    response.actions = getSettingsActions(lang);
    response.structuredField = null;
    response.helpTopic = 'add_pickup_address';
    response.suggestions = [
      buildHelpTopicSuggestion(lang, 'add_pickup_address'),
      lang === 'ar' ? 'كمّل جدولة الاستلام' : 'Continue pickup scheduling',
    ];
  }
  return response;
}

function buildOrderReadyFailureResponse(ready, draftFields, userData, userContext, conversation, lang) {
  const blocking = ready.blockingField || 'fullName';
  const missingFields = getClarificationQueue(draftFields, userData);
  const queue = missingFields.length ? missingFields : [blocking];
  const nextField = queue[0];
  conversation.activeDraft = {
    type: 'order',
    fields: draftFields,
    missingFields: queue,
    pendingField: nextField,
    regionOptions: null,
    updatedAt: new Date(),
  };
  const clarifying = buildClarifyingMessage(nextField, draftFields, userContext, lang);
  const response = {
    text: ready.errors[0] || clarifying,
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields: queue, complete: false },
    progress: getDraftProgress(draftFields, userData),
    pendingField: nextField,
    chips: buildCollectedChips(draftFields, queue, lang),
    clarifyingQuestion: clarifying,
    quickReplies: buildQuickReplies(nextField, lang),
    suggestions: [],
  };
  if (ready.needsSettings) {
    response.actions = getSettingsActions(lang);
  }
  return response;
}

async function tryInterceptDraftCommand(userId, message, conversation, userData, lang) {
  if (!conversation.activeDraft?.type || !conversation.activeDraft?.fields) {
    return null;
  }

  if (isCancelDraftPhrase(message)) {
    await cancelDraft(conversation);
    return {
      text: lang === 'ar' ? 'تم إلغاء المسودة.' : 'Draft cancelled.',
      suggestions: [],
      draft: { complete: false },
    };
  }

  const draft = conversation.activeDraft;
  if (draft.type === 'pickup' && isPickupDraftComplete(draft.fields, userData)) {
    if (isConfirmPickupPhrase(message)) {
      const ready = validatePickupDraftReady(draft.fields, userData, lang);
      if (!ready.ok) {
        return buildPickupReadyFailureResponse(
          ready,
          applyPickupDraftDefaults(draft.fields, userData),
          userData,
          await getUserContext(userId, lang),
          conversation,
          lang
        );
      }
      const result = await confirmPickup(userId, conversation, lang);
      return formatConfirmApiResult(result);
    }
  }

  if (draft.type === 'order' && isDraftComplete(draft.fields, userData)) {
    if (isConfirmOrderPhrase(message)) {
      const ready = await validateOrderDraftReady(draft.fields, userData, lang, userId);
      if (!ready.ok) {
        return buildOrderReadyFailureResponse(
          ready,
          draft.fields,
          userData,
          await getUserContext(userId, lang),
          conversation,
          lang
        );
      }
      const result = await confirmOrder(userId, conversation);
      return formatConfirmApiResult(result);
    }
  }

  return null;
}

async function processOrderDraftFlow({
  userId,
  userData,
  userContext,
  conversation,
  geminiResult,
  regionHints,
  serverOnly = false,
  prevPendingField = null,
}) {
  const lang =
    geminiResult?.language === 'ar'
      ? 'ar'
      : userContext.preferredLang === 'ar'
        ? 'ar'
        : 'en';

  let draftFields = mergeDraft(
    conversation.activeDraft?.fields || {},
    geminiResult?.extractedFields || {},
    lang,
    { userData }
  );
  draftFields = scrubPhoneFromNotes(draftFields);

  const { fields: resolvedFields, regionHints: newHints } = applyRegionResolution(draftFields, {
    splitAddress: true,
  });
  draftFields = normalizeDraftFields(resolvedFields, lang);
  draftFields = enforcePostStructuralOrder(draftFields, userData);
  const mergedHints = { ...regionHints, ...newHints };

  draftFields = applyDefaultPickupIfSingle(draftFields, userData);

  const zoneSuggestions = mergedHints.zoneSuggestions || mergedHints.ambiguousOptions;
  if (zoneSuggestions && zoneSuggestions.length && !draftFields.zone) {
    const zoneQuery =
      draftFields.zoneQuery ||
      mergedHints.invalidZone ||
      mergedHints.resolved?.queryNorm ||
      '';
    let pickReason = mergedHints.zonePickReason || 'ambiguous';
    if (pickReason === 'ambiguous' && mergedHints.invalidZone) {
      pickReason = 'invalid';
    }
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
      geminiResult,
      serverOnly,
      prevPendingField,
    });
  }

  const missingFields = getClarificationQueue(draftFields, userData);
  const complete = missingFields.length === 0;
  const nextField = complete ? null : missingFields[0];
  const clarifying = nextField
    ? buildClarifyingMessage(nextField, draftFields, userContext, lang)
    : '';
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
      return buildOrderReadyFailureResponse(
        ready,
        draftFields,
        userData,
        userContext,
        conversation,
        lang
      );
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

  const quickReplies = buildQuickReplies(nextField, lang);
  const fieldSuggestions = buildSuggestionsForField(nextField, lang, userContext);
  const question = quickReplies.length > 0
    ? clarifying
    : (clarifying || geminiResult?.clarifyingQuestion);
  const ack = serverOnly && prevPendingField
    ? buildAcknowledgment(prevPendingField, lang)
    : splitAckFromGeminiReply(geminiResult?.replyText, question);

  const suggestions =
    quickReplies.length > 0
      ? []
      : geminiResult?.suggestions && geminiResult.suggestions.length
        ? geminiResult.suggestions
        : fieldSuggestions;

  return {
    text: ack,
    intent: 'clarify_order',
    draft: { fields: draftFields, missingFields, complete: false },
    progress,
    pendingField: nextField,
    chips: buildCollectedChips(draftFields, missingFields, lang),
    clarifyingQuestion: question,
    quickReplies,
    suggestions,
  };
}

async function processPickupDraftFlow({
  userData,
  userContext,
  conversation,
  geminiResult,
  serverOnly = false,
  prevPendingField = null,
}) {
  const lang =
    geminiResult?.language === 'ar'
      ? 'ar'
      : userContext.preferredLang === 'ar'
        ? 'ar'
        : 'en';

  const wasComplete = conversation.activeDraft?.type === 'pickup'
    && isPickupDraftComplete(conversation.activeDraft.fields || {}, userData);

  const geminiPickup = extractPickupFieldsFromGemini(geminiResult?.extractedFields || {});
  let draftFields = mergePickupDraft(
    conversation.activeDraft?.type === 'pickup' ? conversation.activeDraft.fields || {} : {},
    geminiPickup,
    lang,
    { userData }
  );

  draftFields = applyPickupDraftDefaults(draftFields, userData);

  if (
    draftFields.numberOfOrders != null
    && !validatePickupOrderCount(draftFields.numberOfOrders)
  ) {
    delete draftFields.numberOfOrders;
  }

  if (draftFields.pickupDate != null && !validatePickupDate(draftFields.pickupDate)) {
    delete draftFields.pickupDate;
  }

  const missingFields = getPickupClarificationQueue(draftFields, userData);
  const complete = missingFields.length === 0;
  const nextField = complete ? null : missingFields[0];
  const clarifying = nextField
    ? buildPickupClarifyingMessage(nextField, draftFields, userContext, lang)
    : '';
  const progress = getPickupDraftProgress(draftFields, userData);

  conversation.activeDraft = {
    type: 'pickup',
    fields: draftFields,
    missingFields,
    pendingField: nextField,
    regionOptions: null,
    updatedAt: new Date(),
  };

  if (complete) {
    const ready = validatePickupDraftReady(draftFields, userData, lang);
    if (!ready.ok) {
      return buildPickupReadyFailureResponse(
        ready,
        draftFields,
        userData,
        userContext,
        conversation,
        lang
      );
    }

    const preview = buildPickupPreview(draftFields, userData, lang);
    const previewText = wasComplete
      ? (lang === 'ar'
        ? 'تم تحديث المعاينة. راجع التفاصيل واضغط تأكيد الاستلام.'
        : 'Preview updated. Review details and tap Confirm Pickup.')
      : (lang === 'ar'
        ? 'راجع التفاصيل واضغط تأكيد الاستلام'
        : 'Review details and tap Confirm Pickup');
    return {
      text: previewText,
      intent: 'create_pickup',
      draft: { fields: draftFields, missingFields: [], complete: true },
      progress: { collected: progress.total, total: progress.total, missingFields: [] },
      preview,
      suggestions: [],
    };
  }

  if (
    serverOnly
    && prevPendingField === 'numberOfOrders'
    && draftFields.numberOfOrders == null
    && missingFields.includes('numberOfOrders')
  ) {
    const invalidCountMsg = lang === 'ar'
      ? `عدد الأوردرات لازم يكون بين 1 و ${PICKUP_ORDER_COUNT_MAX}.`
      : `Order count must be between 1 and ${PICKUP_ORDER_COUNT_MAX}.`;
    return {
      text: invalidCountMsg,
      intent: 'clarify_pickup',
      draft: { fields: draftFields, missingFields, complete: false },
      progress,
      pendingField: 'numberOfOrders',
      chips: buildPickupChips(draftFields, missingFields, lang),
      clarifyingQuestion: clarifying || invalidCountMsg,
      quickReplies: buildPickupQuickReplies('numberOfOrders', lang),
      structuredField: buildPickupStructuredField(
        'numberOfOrders', lang, userContext, draftFields, userData
      ),
    };
  }

  const quickReplies = buildPickupQuickReplies(nextField, lang);
  const fieldSuggestions = buildPickupSuggestionsForField(nextField, lang, userContext);
  const structuredField = buildPickupStructuredField(
    nextField, lang, userContext, draftFields, userData
  );
  const question = quickReplies.length > 0
    ? clarifying
    : (clarifying || geminiResult?.clarifyingQuestion);
  const ack = serverOnly && prevPendingField
    ? buildPickupAcknowledgment(prevPendingField, lang)
    : splitAckFromGeminiReply(geminiResult?.replyText, question);

  return {
    text: ack,
    intent: 'clarify_pickup',
    draft: { fields: draftFields, missingFields, complete: false },
    progress,
    pendingField: nextField,
    chips: buildPickupChips(draftFields, missingFields, lang),
    clarifyingQuestion: question,
    quickReplies,
    structuredField,
    suggestions: quickReplies.length > 0 ? [] : (geminiResult?.suggestions?.length ? geminiResult.suggestions : fieldSuggestions),
  };
}

async function processPickupDraftWithoutGemini({
  userData,
  userContext,
  conversation,
  message,
  lang,
}) {
  const pendingField = conversation.activeDraft?.pendingField;
  let draftFields = conversation.activeDraft?.type === 'pickup'
    ? conversation.activeDraft.fields || {}
    : {};

  const extracted = extractPickupFieldsFromMessage(
    message,
    pendingField,
    draftFields,
    userContext
  );
  draftFields = mergePickupDraft(draftFields, extracted, lang, { userData });

  const geminiStub = {
    language: lang,
    extractedFields: {},
    replyText: null,
    clarifyingQuestion: null,
    suggestions: [],
    intent: 'clarify_pickup',
  };

  return processPickupDraftFlow({
    userData,
    userContext,
    conversation,
    geminiResult: geminiStub,
    serverOnly: true,
    prevPendingField: pendingField,
  });
}

async function processDraftWithoutGemini({
  userData,
  userContext,
  conversation,
  message,
  regionHints,
  lang,
}) {
  if (conversation.activeDraft?.type === 'pickup') {
    return processPickupDraftWithoutGemini({
      userData,
      userContext,
      conversation,
      message,
      lang,
    });
  }

  const pendingField = conversation.activeDraft?.pendingField;
  let draftFields = conversation.activeDraft?.fields || {};

  const extracted = extractFromUserReply(message, pendingField, draftFields, userContext);

  if (pendingField === 'address' || looksLikeAddressReply(message, draftFields)) {
    const split = splitAddressAndZoneFromText(message);
    if (split.address) extracted.address = split.address;
    if (split.zoneQuery) extracted.zoneQuery = split.zoneQuery;
    if (!split.address && !split.zoneQuery && message.trim()) {
      extracted.address = message.trim();
    }
  }

  draftFields = mergeDraft(draftFields, extracted, lang, {
    allowPostStructuralFromExtract: true,
    userData,
  });
  draftFields = scrubPhoneFromNotes(draftFields);
  draftFields = normalizeDraftFields(draftFields, lang);
  draftFields = enforcePostStructuralOrder(draftFields, userData);

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

  const geminiStub = {
    language: lang,
    extractedFields: {},
    replyText: null,
    clarifyingQuestion: null,
    suggestions: [],
    intent: 'clarify_order',
  };

  return processOrderDraftFlow({
    userData,
    userContext,
    conversation,
    geminiResult: geminiStub,
    regionHints,
    serverOnly: true,
    prevPendingField: pendingField,
  });
}

async function resolveZoneFromUserReply(message, conversation, lang) {
  const options = conversation.activeDraft?.regionOptions;
  if (!options || !options.length) return null;

  const trimmed = String(message).trim();
  const num = parseInt(trimmed, 10);
  if (Number.isFinite(num) && num >= 1 && num <= options.length) {
    return options[num - 1];
  }

  const resolved = resolveZoneQuery(trimmed);
  if (resolved.match) return resolved.match;

  const trimmedLower = trimmed.toLowerCase();
  for (const opt of options) {
    const labelAr = opt.labelAr || '';
    const labelEn = opt.labelEn || '';
    if (
      (labelAr && labelAr.toLowerCase() === trimmedLower) ||
      (labelEn && labelEn.toLowerCase() === trimmedLower) ||
      (labelAr && labelAr.toLowerCase().includes(trimmedLower)) ||
      (labelEn && labelEn.toLowerCase().includes(trimmedLower)) ||
      (opt.zone && opt.zone.toLowerCase() === trimmedLower)
    ) {
      return opt;
    }
  }
  return null;
}

/**
 * Process a text message through AINOW.
 */
async function processTextMessage(userId, message, conversation, options = {}) {
  const preferredLang = options.preferredLang === 'ar' ? 'ar' : 'en';
  if (!checkRateLimit(userId)) {
    const lang = /[\u0600-\u06FF]/.test(message) ? 'ar' : preferredLang;
    return {
      text:
        lang === 'ar'
          ? 'تم تجاوز الحد المسموح من الرسائل. حاول مرة أخرى بعد قليل.'
          : 'Rate limit exceeded. Please try again in a few minutes.',
      suggestions: [],
    };
  }

  if (!isConfigured()) {
    return buildFallbackResponse(/[\u0600-\u06FF]/.test(message) ? 'ar' : 'en');
  }

  const userData = await User.findById(userId);
  const userContext = await getUserContext(userId, preferredLang);
  const history = conversation.messages || [];

  const msgLang = /[\u0600-\u06FF]/.test(message) ? 'ar' : preferredLang;

  const intercepted = await tryInterceptDraftCommand(userId, message, conversation, userData, msgLang);
  if (intercepted) {
    return intercepted;
  }

  const helpDetected = detectPlatformHelp(message, conversation, userData);
  if (helpDetected) {
    return buildPlatformHelpResponse(helpDetected.topicId, msgLang, { conversation, userData });
  }

  const zonePick = await resolveZoneFromUserReply(message, conversation, msgLang);
  let draftFields = conversation.activeDraft?.fields || {};
  if (zonePick) {
    draftFields = mergeDraft(
      draftFields,
      {
        government: zonePick.government,
        zone: zonePick.zone,
      },
      msgLang,
      { userData }
    );
    conversation.activeDraft = {
      ...conversation.activeDraft,
      fields: draftFields,
      regionOptions: null,
    };
  }

  const { fields: preResolved, regionHints } = applyRegionResolution(draftFields, { splitAddress: true });

  let geminiResult;
  try {
    geminiResult = await extractAssistantResponse({
      userMessage: message,
      history,
      userContext,
      draftFields: preResolved,
      regionHints,
      draftMeta: buildDraftMeta(conversation),
    });
  } catch (error) {
    console.error('Gemini extract error:', error.message);
    if (shouldUseDraftFallback(conversation)) {
      return processDraftWithoutGemini({
        userData,
        userContext,
        conversation,
        message,
        regionHints,
        lang: msgLang,
      });
    }
    if (!isConfigured()) {
      return buildFallbackResponse(msgLang);
    }
    return buildGeminiErrorResponse(msgLang);
  }

  const lang = geminiResult.language === 'ar' ? 'ar' : preferredLang;

  if (geminiResult.intent === 'platform_help' || geminiResult.helpTopic) {
    const topicId = geminiResult.helpTopic || detectPlatformHelp(message, conversation, userData)?.topicId;
    return buildPlatformHelpResponse(topicId, lang, { conversation, userData });
  }

  if (isHelpQuestion(message)) {
    const helpFromGemini = detectPlatformHelp(message, conversation, userData);
    if (helpFromGemini) {
      return buildPlatformHelpResponse(helpFromGemini.topicId, lang, { conversation, userData });
    }
  }

  if (shouldRefuse(message, geminiResult)) {
    return buildScopeRefusal(lang);
  }

  if (geminiResult.intent === 'order_status') {
    return handleOrderStatusIntent(userId, geminiResult.orderNumberQuery, lang);
  }
  if (geminiResult.intent === 'wallet') {
    return handleWalletIntent(userId, lang);
  }

  if (isPickupStatusQuery(message, geminiResult)) {
    const query = geminiResult.pickupNumberQuery || String(message).match(/\d{5,}/)?.[0];
    return handlePickupStatusIntent(userId, query, lang);
  }

  if (
    !isHelpQuestion(message) &&
    (
      geminiResult.intent === 'create_pickup' ||
      geminiResult.intent === 'clarify_pickup' ||
      conversation.activeDraft?.type === 'pickup' ||
      shouldStartPickupDraft(message, geminiResult, conversation)
    )
  ) {
    return processPickupDraftFlow({
      userId,
      userData,
      userContext,
      conversation,
      geminiResult,
    });
  }

  if (geminiResult.intent === 'pickup') {
    return handlePickupListIntent(userId, lang);
  }

  if (
    !isHelpQuestion(message) &&
    (
      geminiResult.intent === 'create_order' ||
      geminiResult.intent === 'clarify_order' ||
      conversation.activeDraft?.type === 'order'
    )
  ) {
    return processOrderDraftFlow({
      userId,
      userData,
      userContext,
      conversation,
      geminiResult,
      regionHints,
    });
  }

  return {
    text: geminiResult.replyText,
    suggestions: geminiResult.suggestions || [],
    intent: geminiResult.intent || 'general_chat',
  };
}

/**
 * Process voice audio through AINOW.
 */
async function processVoiceMessage(userId, audioBuffer, mimeType, conversation, options = {}) {
  const preferredLang = options.preferredLang === 'ar' ? 'ar' : 'en';
  if (!checkRateLimit(userId)) {
    const rlLang = preferredLang === 'ar' ? 'ar' : 'en';
    return {
      text:
        rlLang === 'ar'
          ? 'تم تجاوز الحد المسموح من الرسائل. حاول مرة أخرى بعد قليل.'
          : 'Rate limit exceeded. Please try again in a few minutes.',
      suggestions: [],
    };
  }

  if (!isConfigured()) {
    return buildFallbackResponse('ar');
  }

  const userData = await User.findById(userId);
  const userContext = await getUserContext(userId, preferredLang);
  const draftFields = conversation.activeDraft?.fields || {};
  const { fields: preResolved, regionHints } = applyRegionResolution(draftFields, { splitAddress: true });
  const voiceLang = preferredLang === 'ar' ? 'ar' : 'en';

  let geminiResult;
  try {
    geminiResult = await transcribeAndExtract({
      audioBuffer,
      mimeType,
      history: conversation.messages || [],
      userContext,
      draftFields: preResolved,
      regionHints,
      draftMeta: buildDraftMeta(conversation),
    });
  } catch (error) {
    console.error('Gemini voice error:', error.message);
    if (shouldUseDraftFallback(conversation)) {
      const result = await processDraftWithoutGemini({
        userData,
        userContext,
        conversation,
        message: '',
        regionHints,
        lang: voiceLang,
      });
      result.transcript = '';
      return result;
    }
    return buildFallbackResponse(voiceLang);
  }

  const transcript = geminiResult.transcript || '';
  const lang = geminiResult.language === 'ar' ? 'ar' : preferredLang;

  const intercepted = await tryInterceptDraftCommand(
    userId,
    transcript,
    conversation,
    userData,
    lang
  );
  if (intercepted) {
    intercepted.transcript = transcript;
    return intercepted;
  }

  const helpDetected = detectPlatformHelp(transcript, conversation, userData);
  if (helpDetected) {
    const helpRes = buildPlatformHelpResponse(helpDetected.topicId, lang, { conversation, userData });
    helpRes.transcript = transcript;
    return helpRes;
  }

  if (geminiResult.intent === 'platform_help' || geminiResult.helpTopic) {
    const topicId = geminiResult.helpTopic || detectPlatformHelp(transcript, conversation, userData)?.topicId;
    const helpRes = buildPlatformHelpResponse(topicId, lang, { conversation, userData });
    helpRes.transcript = transcript;
    return helpRes;
  }

  if (isHelpQuestion(transcript)) {
    const helpFromVoice = detectPlatformHelp(transcript, conversation, userData);
    if (helpFromVoice) {
      const helpRes = buildPlatformHelpResponse(helpFromVoice.topicId, lang, { conversation, userData });
      helpRes.transcript = transcript;
      return helpRes;
    }
  }

  if (shouldRefuse(transcript, geminiResult)) {
    const refusal = buildScopeRefusal(lang);
    refusal.transcript = transcript;
    return refusal;
  }

  if (geminiResult.intent === 'order_status') {
    const result = await handleOrderStatusIntent(userId, geminiResult.orderNumberQuery, lang);
    result.transcript = transcript;
    return result;
  }
  if (geminiResult.intent === 'wallet') {
    const result = await handleWalletIntent(userId, lang);
    result.transcript = transcript;
    return result;
  }

  if (isPickupStatusQuery(transcript, geminiResult)) {
    const query = geminiResult.pickupNumberQuery || String(transcript).match(/\d{5,}/)?.[0];
    const result = await handlePickupStatusIntent(userId, query, lang);
    result.transcript = transcript;
    return result;
  }

  if (
    !isHelpQuestion(transcript) &&
    (
      geminiResult.intent === 'create_pickup' ||
      geminiResult.intent === 'clarify_pickup' ||
      conversation.activeDraft?.type === 'pickup' ||
      shouldStartPickupDraft(transcript, geminiResult, conversation)
    )
  ) {
    const result = await processPickupDraftFlow({
      userId,
      userData,
      userContext,
      conversation,
      geminiResult,
    });
    result.transcript = transcript;
    return result;
  }

  if (geminiResult.intent === 'pickup') {
    const result = await handlePickupListIntent(userId, lang);
    result.transcript = transcript;
    return result;
  }

  if (
    !isHelpQuestion(transcript) &&
    (
      geminiResult.intent === 'create_order' ||
      geminiResult.intent === 'clarify_order' ||
      conversation.activeDraft?.type === 'order'
    )
  ) {
    const result = await processOrderDraftFlow({
      userId,
      userData,
      userContext,
      conversation,
      geminiResult,
      regionHints,
    });
    result.transcript = transcript;
    return result;
  }

  const fallback = {
    text: geminiResult.replyText,
    suggestions: geminiResult.suggestions || [],
    intent: geminiResult.intent || 'general_chat',
    transcript,
  };
  return fallback;
}

async function confirmOrder(userId, conversation) {
  const userData = await User.findById(userId);
  if (!userData) {
    return { success: false, error: 'User not found' };
  }

  const draft = conversation.activeDraft;
  if (!draft || draft.type !== 'order' || !draft.fields) {
    return { success: false, error: 'No order draft to confirm' };
  }

  const fields = applyDefaultPickupIfSingle({ ...draft.fields }, userData);
  if (!isDraftComplete(fields, userData)) {
    const missing = getMissingRequiredFields(fields, userData);
    return { success: false, error: `Missing fields: ${missing.join(', ')}` };
  }

  const isAr = /[\u0600-\u06FF]/.test(fields.fullName || '');
  const ready = await validateOrderDraftReady(fields, userData, isAr ? 'ar' : 'en', userId);
  if (!ready.ok) {
    return { success: false, error: ready.errors[0] };
  }
  const normalized = ready.normalized;

  const orderNumber = await generateUniqueOrderNumber();
  const newOrder = buildOrderDocumentFromFields(userData, normalized, orderNumber);
  const savedOrder = await newOrder.save();

  conversation.activeDraft = {
    type: null,
    fields: {},
    missingFields: [],
    pendingField: null,
    updatedAt: new Date(),
  };
  await conversation.save();

  return {
    success: true,
    orderNumber: savedOrder.orderNumber,
    text: isAr
      ? `تم إنشاء الأوردر #${savedOrder.orderNumber} بنجاح!`
      : `Order #${savedOrder.orderNumber} created successfully!`,
    actions: [
      {
        text: isAr ? 'عرض الأوردر' : 'View order',
        url: `/business/order-details/${savedOrder.orderNumber}`,
      },
      { text: isAr ? 'كل الطلبات' : 'All orders', url: '/business/orders' },
    ],
  };
}

async function confirmPickup(userId, conversation, lang = 'en') {
  const userData = await User.findById(userId);
  if (!userData) {
    return { success: false, error: 'User not found' };
  }

  const draft = conversation.activeDraft;
  if (!draft || draft.type !== 'pickup' || !draft.fields) {
    return { success: false, error: 'No pickup draft to confirm' };
  }

  const fields = applyPickupDraftDefaults({ ...draft.fields }, userData);
  if (!isPickupDraftComplete(fields, userData)) {
    const missing = getPickupClarificationQueue(fields, userData);
    return { success: false, error: `Missing fields: ${missing.join(', ')}` };
  }
  const ready = validatePickupDraftReady(fields, userData, lang);
  if (!ready.ok) {
    return { success: false, error: ready.errors[0] || getPickupDateTooEarlyMessage(lang) };
  }

  try {
    const savedPickup = await createPickupFromDraft(userId, userData, fields);

    conversation.activeDraft = {
      type: null,
      fields: {},
      missingFields: [],
      pendingField: null,
      updatedAt: new Date(),
    };
    await conversation.save();

    const isAr = lang === 'ar';
    return {
      success: true,
      pickupNumber: savedPickup.pickupNumber,
      text: isAr
        ? `تم جدولة الاستلام #${savedPickup.pickupNumber} بنجاح!`
        : `Pickup #${savedPickup.pickupNumber} scheduled successfully!`,
      actions: [
        {
          text: isAr ? 'عرض الاستلام' : 'View pickup',
          url: `/business/pickup-details/${savedPickup.pickupNumber}`,
        },
        { text: isAr ? 'كل الاستلامات' : 'All pickups', url: '/business/pickups' },
      ],
    };
  } catch (err) {
    return { success: false, error: err.message || 'Could not create pickup' };
  }
}

async function cancelDraft(conversation) {
  conversation.activeDraft = {
    type: null,
    fields: {},
    missingFields: [],
    pendingField: null,
    updatedAt: new Date(),
  };
  await conversation.save();
  return {
    text: 'Draft cancelled.',
    draft: null,
  };
}

function getGreeting(lang) {
  const isAr = lang === 'ar';
  return {
    text: isAr
      ? 'أهلاً! أنا AINOW — مساعدك الذكي. يمكنك إنشاء أوردر، جدولة استلام، متابعة الطلبات، أو الاستفسار عن رصيدك.'
      : "Hello! I'm AINOW — your AI assistant. Create orders, schedule pickups, track shipments, or check your balance.",
    suggestions: isAr
      ? ['إنشاء أوردر', 'حالة آخر أوردر', 'رصيدي', 'جدولة استلام']
      : ['Create an order', 'Order status', 'My balance', 'Schedule pickup'],
  };
}

module.exports = {
  getUserContext,
  getOrCreateConversation,
  processTextMessage,
  processVoiceMessage,
  confirmOrder,
  confirmPickup,
  cancelDraft,
  getGreeting,
  checkRateLimit,
  shouldStartPickupDraft,
  isPickupStatusQuery,
};
