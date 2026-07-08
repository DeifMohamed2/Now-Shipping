/**
 * Centralized deterministic message routing for AINOW.
 * Decides high-level handler before brittle keyword heuristics conflict.
 */
const { isCancelDraftPhrase } = require('../../../utils/ainowDraftValidation');
const { isHelpQuestion } = require('../platformHelpEngine');

const ORDER_CREATE_RE =
  /(اعمل|عايز|عاوز|كنت\s+عايز|محتاج|انشاء|انشئ|create|make|new).*(اوردر|أوردر|طلب|order)/i;
const ORDER_CREATE_SHORT =
  /^(إنشاء أوردر|انشاء اوردر|إنشاء طلب|create order|new order|make order)$/i;

const PICKUP_CREATE_RE =
  /(جدول|جدولة|اعمل|عايز|عاوز|محتاج|create|schedule|new|book).*(استلام|pickup)/i;
const PICKUP_CREATE_SHORT =
  /^(جدولة استلام|جدول استلام|schedule pickup|new pickup|اعمل استلام)$/i;

const COD_PHRASE_RE =
  /(?:الدفع\s+عند\s+الاستلام|عند\s+الاستلام|كاش\s+عند\s+الاستلام|دفع\s+عند\s+الاستلام|cash\s+on\s+delivery|\bCOD\b)/i;

const PICKUP_STATUS_VERB_RE = /(حالة|status|فين|where|track|tracking|متابعة)/i;
const PICKUP_NOUN_RE = /(استلام|pickup)/i;
const ORDER_STATUS_RE = /(حالة|status|فين|where).*(اوردر|أوردر|طلب|order)/i;

const EGYPTIAN_MOBILE_RE = /^01[0125]\d{8}$/;

/**
 * True when message refers to cash-on-delivery (NOT pickup scheduling).
 */
function isCodPhrase(message) {
  return COD_PHRASE_RE.test(String(message || ''));
}

function isOrderCreateMessage(message, geminiResult) {
  if (geminiResult?.intent === 'create_order' || geminiResult?.intent === 'clarify_order') {
    return true;
  }
  const m = String(message || '').trim();
  if (!m) return false;
  if (ORDER_STATUS_RE.test(m) && /\d{5,}/.test(m)) return false;
  return ORDER_CREATE_RE.test(m) || ORDER_CREATE_SHORT.test(m);
}

function isPickupCreateMessage(message, geminiResult, conversation) {
  if (conversation?.activeDraft?.type === 'pickup') return true;
  if (geminiResult?.intent === 'create_pickup' || geminiResult?.intent === 'clarify_pickup') {
    return true;
  }
  const m = String(message || '').trim();
  if (!m) return false;
  if (PICKUP_STATUS_VERB_RE.test(m) && PICKUP_NOUN_RE.test(m) && /\d{5,}/.test(m)) {
    return false;
  }
  return PICKUP_CREATE_RE.test(m) || PICKUP_CREATE_SHORT.test(m);
}

/**
 * Extract standalone pickup number (exclude Egyptian mobile phones).
 */
function extractPickupNumber(message, geminiResult) {
  if (geminiResult?.pickupNumberQuery) {
    const q = String(geminiResult.pickupNumberQuery).replace(/\D/g, '');
    if (q && !EGYPTIAN_MOBILE_RE.test(q)) return q;
  }
  const nums = String(message || '').match(/\d{5,}/g) || [];
  for (const raw of nums) {
    const d = raw.replace(/\D/g, '');
    if (EGYPTIAN_MOBILE_RE.test(d)) continue;
    if (d.length >= 5 && d.length <= 10) return d;
  }
  return null;
}

/**
 * Strict pickup-status detection — excludes COD phrases and order-create messages.
 */
function isPickupStatusMessage(message, geminiResult) {
  if (isOrderCreateMessage(message, geminiResult)) return false;

  const m = String(message || '');
  const hasPickupNoun = PICKUP_NOUN_RE.test(m);
  const hasStatusVerb = PICKUP_STATUS_VERB_RE.test(m);

  if (isCodPhrase(m) && !hasStatusVerb) return false;

  if (geminiResult?.intent === 'pickup_status') {
    if (hasStatusVerb && hasPickupNoun) return true;
    if (geminiResult.pickupNumberQuery && hasPickupNoun) return true;
    return hasStatusVerb && !!extractPickupNumber(m, geminiResult);
  }

  if (geminiResult?.pickupNumberQuery && hasStatusVerb && hasPickupNoun) {
    return true;
  }

  if (!hasPickupNoun || !hasStatusVerb) return false;

  const pickupNum = extractPickupNumber(m, geminiResult);
  return !!pickupNum || /(حالة|status|فين|where).*(استلام|pickup)/i.test(m);
}

/**
 * @returns {{ route: string, orderNumberQuery?: string, pickupNumberQuery?: string }}
 */
function routeMessage({ message, conversation, geminiResult }) {
  const m = String(message || '').trim();
  const draft = conversation?.activeDraft;

  if (draft?.type === 'order' && !isCancelDraftPhrase(m) && !isHelpQuestion(m)) {
    return { route: 'order_continue' };
  }

  if (draft?.type === 'pickup' && !isCancelDraftPhrase(m) && !isHelpQuestion(m)) {
    return { route: 'pickup_continue' };
  }

  if (isOrderCreateMessage(m, geminiResult)) {
    return { route: 'order_create' };
  }

  if (isPickupStatusMessage(m, geminiResult)) {
    return {
      route: 'pickup_status',
      pickupNumberQuery: extractPickupNumber(m, geminiResult),
    };
  }

  if (geminiResult?.intent === 'order_status') {
    return {
      route: 'order_status',
      orderNumberQuery: geminiResult.orderNumberQuery,
    };
  }

  if (geminiResult?.intent === 'wallet') {
    return { route: 'wallet' };
  }

  if (isPickupCreateMessage(m, geminiResult, conversation)) {
    return { route: 'pickup_create' };
  }

  if (geminiResult?.intent === 'pickup') {
    return { route: 'pickup_list' };
  }

  if (
    geminiResult?.intent === 'create_order' ||
    geminiResult?.intent === 'clarify_order'
  ) {
    return { route: 'order_create' };
  }

  return { route: 'general' };
}

module.exports = {
  routeMessage,
  isCodPhrase,
  isOrderCreateMessage,
  isPickupCreateMessage,
  isPickupStatusMessage,
  extractPickupNumber,
};
