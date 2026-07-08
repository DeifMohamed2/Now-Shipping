/**
 * Sticky conversation language — keeps Arabic sessions when replies are digits or English UI tokens.
 */

function draftHasArabicContent(conversation) {
  const fields = conversation?.activeDraft?.fields || {};
  const fieldBlob = [
    fields.fullName,
    fields.address,
    fields.productDescription,
    fields.zoneQuery,
    fields.zone,
    fields.Notes,
  ]
    .filter(Boolean)
    .join(' ');
  return /[\u0600-\u06FF]/.test(fieldBlob);
}

function historyIndicatesArabic(conversation, lookback = 12) {
  const messages = conversation?.messages || [];
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - lookback; i--) {
    const m = messages[i];
    if (m.sender === 'user' && /[\u0600-\u06FF]/.test(String(m.content || ''))) {
      return true;
    }
    if (m.sender === 'assistant') {
      try {
        const parsed = JSON.parse(m.content);
        if (parsed.text && /[\u0600-\u06FF]/.test(parsed.text)) return true;
        if (parsed.clarifyingQuestion && /[\u0600-\u06FF]/.test(parsed.clarifyingQuestion)) {
          return true;
        }
      } catch {
        if (/[\u0600-\u06FF]/.test(String(m.content || ''))) return true;
      }
    }
  }
  return false;
}

/**
 * Infer conversation language from draft content and recent messages (not UI pref alone).
 * @param {object} [conversation]
 * @param {'ar'|'en'} [preferredLang]
 * @param {string} [textHint] current user message
 * @returns {'ar'|'en'}
 */
function resolveConversationLang(conversation, preferredLang = 'en', textHint) {
  if (textHint && /[\u0600-\u06FF]/.test(textHint)) return 'ar';

  if (conversation?.activeDraft?.type === 'order' || conversation?.activeDraft?.type === 'pickup') {
    if (draftHasArabicContent(conversation)) return 'ar';
    if (historyIndicatesArabic(conversation)) return 'ar';
  } else {
    if (draftHasArabicContent(conversation)) return 'ar';
    if (historyIndicatesArabic(conversation)) return 'ar';
  }

  if (textHint && /[a-zA-Z]/.test(textHint) && !/[\u0600-\u06FF]/.test(textHint)) {
    return preferredLang === 'ar' ? 'ar' : 'en';
  }

  return preferredLang === 'ar' ? 'ar' : 'en';
}

module.exports = {
  resolveConversationLang,
  draftHasArabicContent,
  historyIndicatesArabic,
};
