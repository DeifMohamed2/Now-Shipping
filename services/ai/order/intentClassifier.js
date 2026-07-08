/**
 * Stage 1 — Order intent classification (deterministic guards + LLM hint).
 */
const { isConfirmOrderPhrase, isCancelDraftPhrase } = require('../../../utils/ainowDraftValidation');

const CORRECTION_PATTERNS = [
  /\b(change|replace|update|edit|modify|correct|actually|instead|wrong|not this|use this)\b/i,
  /(غير|بدل|مش|غلط|اصلا|عايز اغير|خليه|عدل|مش ده|مش دي)/i,
];

const DELETE_PATTERNS = [
  /\b(delete|remove|clear)\s+(the\s+)?(\w+)/i,
  /(امسح|احذف|شيل)/i,
];

const CREATE_PATTERNS = [
  /\b(create|new|make)\s+(an?\s+)?order/i,
  /(اعمل|انشئ|أنشئ|عايز)\s*(اوردر|أوردر|order)/i,
];

function detectCorrectionVerb(message) {
  return CORRECTION_PATTERNS.some((p) => p.test(String(message || '')));
}

function detectDeleteIntent(message) {
  return DELETE_PATTERNS.some((p) => p.test(String(message || '')));
}

/**
 * @returns {{ intent: string, correction: boolean }}
 */
function classifyOrderIntent({ message, pendingField, extractionResult, hasDraft }) {
  const text = String(message || '').trim();

  if (isCancelDraftPhrase(text)) {
    return { intent: 'cancel', correction: false };
  }
  if (isConfirmOrderPhrase(text)) {
    return { intent: 'confirm', correction: false };
  }

  const llmIntent = extractionResult?.orderIntent;
  const correction =
    extractionResult?.correction === true || detectCorrectionVerb(text);

  if (llmIntent === 'cancel' || llmIntent === 'unrelated') {
    return { intent: llmIntent, correction: false };
  }
  if (llmIntent === 'confirm') {
    return { intent: 'confirm', correction: false };
  }
  if (llmIntent === 'delete_field' || detectDeleteIntent(text)) {
    return { intent: 'delete_field', correction: true };
  }
  if (correction || llmIntent === 'update') {
    return { intent: 'update', correction: true };
  }
  if (pendingField && text) {
    return { intent: 'answer_question', correction: false };
  }
  if (llmIntent === 'create' || CREATE_PATTERNS.some((p) => p.test(text))) {
    return { intent: 'create', correction: false };
  }
  if (hasDraft) {
    return { intent: 'answer_question', correction: false };
  }
  return { intent: 'create', correction: false };
}

module.exports = {
  classifyOrderIntent,
  detectCorrectionVerb,
  detectDeleteIntent,
};
