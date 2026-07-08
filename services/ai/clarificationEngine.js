/**
 * Server-driven clarification queue, templates, and reply extractors for AINOW.
 */
const { getFieldLabel } = require('../gemini/prompts');
const { normalizeArabicDigitsToLatin } = require('../../utils/bostaRegionsServer');
const { sanitizeAddressText } = require('./draftContextEngine');
const { formatZoneForDisplay } = require('./regionResolver');
const {
  extractEgyptianMobiles,
  hasSecondaryPhoneMarker,
  parsePhoneFieldsFromText,
  SECONDARY_PHONE_MARKERS,
} = require('./phoneFieldUtils');

const EG_MOBILE_RE = /01[0125]\d{8}/g;

const ARABIC_NUMBER_WORDS = {
  واحد: 1,
  واحده: 1,
  اتنين: 2,
  اثنين: 2,
  اتنين: 2,
  تلاته: 3,
  ثلاثه: 3,
  اربعه: 4,
  خمسه: 5,
  تيشرت: 1,
  تيشرتين: 2,
  قطعه: 1,
  قطعتين: 2,
  قطع: 2,
  ثلاث: 3,
  تلات: 3,
};

function buildClarifyingMessage(field, draft, userContext, lang) {
  const isAr = lang === 'ar';
  const name = draft.fullName || (isAr ? 'العميل' : 'the customer');
  const zoneName = draft.zoneQuery || (isAr ? 'المنطقة' : 'the area');

  switch (field) {
    case 'fullName':
      return isAr ? 'تمام. اسم العميل بالكامل إيه؟' : "Sure. What's the customer's full name?";
    case 'phoneNumber':
      return isAr
        ? `محتاج رقم موبايل ${name} (١١ رقم — 010 / 011 / 012 / 015). لو في رقم تاني اكتبه في رسالة منفصلة أو قول «رقم تاني» مع الرقم.`
        : `I need ${name}'s mobile (11 digits — 010 / 011 / 012 / 015). For a second number, send it separately or say "other number" with the digits.`;
    case 'zone':
      return isAr
        ? `المنطقة أو الحي فين بالظبط؟ (مثال: المعادي، عابدين، مدينة نصر)`
        : 'Which area or neighborhood? (e.g. Maadi, Abdeen, Nasr City)';
    case 'address':
      return isAr
        ? `محتاج عنوان ${name} بالتفصيل في ${zoneName} — الشارع، المبنى، رقم الشقة.`
        : `I need ${name}'s street address in ${zoneName} — building, street, apartment.`;
    case 'productDescription':
      return isAr ? 'الأوردر فيه إيه بالظبط؟ (وصف المنتج)' : "What's in the order? (product description)";
    case 'numberOfItems':
      return isAr ? 'كم قطعة في الأوردر؟' : 'How many items in the order?';
    case 'codConfirmation':
      return isAr
        ? 'هل الدفع عند الاستلام (كاش)؟'
        : 'Is this a cash-on-delivery (COD) order?';
    case 'shippingSpeed':
      return isAr
        ? 'التوصيل عادي (١٠٠ ج.م) ولا سريع (٢٠٠ ج.م)?'
        : 'Standard delivery (100 EGP) or express (200 EGP)?';
    case 'amountCOD':
      return isAr
        ? 'كم مبلغ التحصيل (كاش) بالجنيه؟'
        : 'What is the cash-on-delivery amount in EGP?';
    case 'selectedPickupAddressId': {
      const pickups = userContext?.pickupAddresses || [];
      if (pickups.length > 1) {
        const list = pickups
          .map((p, i) => `${i + 1}. ${p.label}`)
          .join('\n');
        return isAr
          ? `اختار عنوان الاستلام للتوصيل السريع:\n${list}`
          : `Choose a pickup address for express delivery:\n${list}`;
      }
      return isAr ? 'محتاج عنوان الاستلام للتوصيل السريع.' : 'I need a pickup address for express delivery.';
    }
    case 'originalOrderNumber':
      return isAr ? 'رقم الأوردر الأصلي إيه؟' : 'What is the original order number?';
    case 'returnReason':
      return isAr ? 'سبب الإرجاع إيه؟' : 'What is the return reason?';
    case 'currentPD':
      return isAr ? 'المنتج الحالي اللي عند العميل إيه؟' : 'What is the current product with the customer?';
    case 'newPD':
      return isAr ? 'المنتج الجديد اللي هيتبدل بيه إيه؟' : 'What is the new replacement product?';
    case 'numberOfItemsCurrentPD':
      return isAr ? 'كم قطعة من المنتج الحالي؟' : 'How many items of the current product?';
    case 'numberOfItemsNewPD':
      return isAr ? 'كم قطعة من المنتج الجديد؟' : 'How many items of the new product?';
    default: {
      const label = getFieldLabel(field, lang);
      return isAr ? `محتاج ${label}.` : `I need the ${label}.`;
    }
  }
}

function buildQuickReplies(field, lang) {
  const isAr = lang === 'ar';
  if (field === 'codConfirmation') {
    return [
      {
        label: isAr ? 'نعم، دفع عند الاستلام' : 'Yes, cash on delivery',
        value: isAr ? 'نعم' : 'Yes',
      },
      {
        label: isAr ? 'لا، بدون كاش' : 'No cash on delivery',
        value: isAr ? 'لا' : 'No',
      },
    ];
  }
  if (field === 'shippingSpeed') {
    return [
      {
        label: isAr ? 'توصيل عادي · ١٠٠ ج.م' : 'Standard · 100 EGP',
        value: isAr ? 'توصيل عادي' : 'Standard delivery',
      },
      {
        label: isAr ? 'توصيل سريع · ٢٠٠ ج.م' : 'Express · 200 EGP',
        value: isAr ? 'توصيل سريع' : 'Express delivery',
      },
    ];
  }
  return [];
}

function splitAckFromGeminiReply(replyText, question) {
  const reply = String(replyText || '').trim();
  const q = String(question || '').trim();
  if (!reply) return '';
  if (!q) return reply;
  if (reply.includes(q)) {
    return reply
      .replace(q, '')
      .replace(/[\s.؟?,،\-–—]+$/g, '')
      .trim();
  }
  const sentences = reply.split(/(?<=[.؟?])\s+/);
  if (sentences.length > 1 && /[؟?]$/.test(sentences[sentences.length - 1])) {
    return sentences.slice(0, -1).join(' ').trim();
  }
  return reply;
}

function buildSuggestionsForField(field, lang, userContext) {
  const isAr = lang === 'ar';
  switch (field) {
    case 'shippingSpeed':
      return isAr ? ['توصيل عادي', 'توصيل سريع'] : ['Standard delivery', 'Express delivery'];
    case 'selectedPickupAddressId': {
      const pickups = userContext?.pickupAddresses || [];
      return pickups.slice(0, 4).map((p, i) => String(i + 1));
    }
    default:
      return isAr ? ['إلغاء'] : ['Cancel'];
  }
}

function parseArabicNumberFromText(text) {
  const n = String(text || '').trim().toLowerCase();
  const digit = n.match(/\d+/);
  if (digit) return parseInt(digit[0], 10);
  for (const [word, val] of Object.entries(ARABIC_NUMBER_WORDS)) {
    if (n.includes(word)) return val;
  }
  return null;
}

function detectShippingSpeed(text) {
  const n = String(text || '').toLowerCase();
  if (/سريع|express|fast|٢٠٠|200/.test(n)) {
    return { isExpressShipping: true, shippingSpeedConfirmed: true };
  }
  if (/عادي|standard|normal|١٠٠|100|مش سريع/.test(n)) {
    return { isExpressShipping: false, shippingSpeedConfirmed: true };
  }
  return null;
}

function detectCodConfirmation(text) {
  const n = String(text || '').trim().toLowerCase();
  if (/^(نعم|اه|آه|ايوه|أيوه|yes|yeah|yep|y)$/i.test(n)) {
    return { COD: true, codConfirmed: true };
  }
  if (/^(لا|لأ|لاء|no|nope|n)$/i.test(n)) {
    return { COD: false, codConfirmed: true };
  }
  if (/بدون كاش|مش كاش|no cod|without cod/i.test(n)) {
    return { COD: false, codConfirmed: true };
  }
  if (/كاش|cod|دفع عند الاستلام|cash on delivery/i.test(n) && !/\d/.test(n)) {
    return { COD: true, codConfirmed: true };
  }
  return null;
}

function detectCODAmount(text) {
  const n = String(text || '').trim();
  const amountOnly = n.match(/^(\d+(?:\.\d+)?)\s*(?:ج\.?م|egp)?$/i);
  if (amountOnly) {
    return { COD: true, codConfirmed: true, amountCOD: parseFloat(amountOnly[1]) };
  }
  const withLabel = n.match(/(\d+(?:\.\d+)?)\s*(?:ج\.?م|egp)?/i);
  if (withLabel) {
    return { COD: true, codConfirmed: true, amountCOD: parseFloat(withLabel[1]) };
  }
  return null;
}

function extractEgyptianPhones(text) {
  return extractEgyptianMobiles(text);
}

function extractSecondaryPhone(text, draft) {
  const parsed = parsePhoneFieldsFromText(text, draft, null);
  return parsed.otherPhoneNumber || null;
}

function scrubPhoneFromNotes(fields) {
  if (!fields || fields.otherPhoneNumber) return fields;
  const notes = String(fields.Notes || '').trim();
  if (!notes) return fields;

  const hasMarker = SECONDARY_PHONE_MARKERS.some((p) => p.test(notes));
  const phones = extractEgyptianPhones(notes);
  if (!hasMarker && phones.length < 2) return fields;

  const next = { ...fields };
  const primary = String(next.phoneNumber || '').replace(/\D/g, '');
  const secondary = phones.find((p) => p !== primary) || (hasMarker ? phones[0] : null);
  if (!secondary || secondary === primary) return fields;

  next.otherPhoneNumber = secondary;
  let cleaned = notes;
  for (const marker of SECONDARY_PHONE_MARKERS) {
    cleaned = cleaned.replace(marker, '');
  }
  cleaned = cleaned.replace(EG_MOBILE_RE, '').replace(/\s+/g, ' ').trim();
  next.Notes = cleaned;
  return next;
}

function extractFromUserReply(message, pendingField, draft, userContext) {
  const text = String(message || '').trim();
  if (!text) return {};

  const extracted = {};

  if (pendingField === 'codConfirmation') {
    const codDecision = detectCodConfirmation(text);
    if (codDecision) Object.assign(extracted, codDecision);
  } else if (pendingField === 'amountCOD') {
    const codAmount = detectCODAmount(text);
    if (codAmount) Object.assign(extracted, codAmount);
  } else if (pendingField === 'shippingSpeed') {
    const speed = detectShippingSpeed(text);
    if (speed) Object.assign(extracted, speed);
  }

  if (pendingField === 'numberOfItems') {
    const norm = normalizeArabicDigitsToLatin(text).trim();
    if (/^\d{1,3}$/.test(norm)) {
      const num = parseInt(norm, 10);
      if (num > 0 && num <= 999) extracted.numberOfItems = num;
    }
  }

  if (pendingField === 'fullName') {
    extracted.fullName = text;
  } else if (pendingField === 'phoneNumber') {
    Object.assign(extracted, parsePhoneFieldsFromText(text, draft, 'phoneNumber'));
  } else if (pendingField === 'address') {
    extracted.address = sanitizeAddressText(text, /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en');
  } else if (pendingField === 'productDescription') {
    extracted.productDescription = text;
  } else if (pendingField === 'zone') {
    const phones = parsePhoneFieldsFromText(text, draft, 'zone');
    if (phones.otherPhoneNumber) extracted.otherPhoneNumber = phones.otherPhoneNumber;
    if (phones.phoneNumber) extracted.phoneNumber = phones.phoneNumber;
    if (!phones.otherPhoneNumber && !phones.phoneNumber) {
      extracted.zoneQuery = text;
    }
  } else if (pendingField === 'originalOrderNumber') {
    extracted.originalOrderNumber = text.replace(/\D/g, '');
  } else if (pendingField === 'returnReason') {
    extracted.returnReason = text;
  } else if (pendingField === 'currentPD') {
    extracted.currentPD = text;
  } else if (pendingField === 'newPD') {
    extracted.newPD = text;
  } else if (pendingField === 'selectedPickupAddressId') {
    const pickups = userContext?.pickupAddresses || [];
    const num = parseInt(text, 10);
    if (Number.isFinite(num) && num >= 1 && num <= pickups.length) {
      extracted.selectedPickupAddressId = pickups[num - 1].addressId;
    }
  } else if (!pendingField && draft && Object.keys(draft).length > 0) {
    if (!draft.address && text.length > 5) extracted.address = text;
    if (!draft.fullName && text.length < 40 && !/\d{8,}/.test(text)) {
      /* avoid overwriting */
    }
  }

  if (!extracted.address && (pendingField === 'address' || looksLikeAddressReply(text, draft))) {
    if (!extracted.address) extracted.address = text;
  }

  if (!extracted.otherPhoneNumber && !draft?.otherPhoneNumber) {
    const parsed = parsePhoneFieldsFromText(text, draft, pendingField);
    if (parsed.otherPhoneNumber) extracted.otherPhoneNumber = parsed.otherPhoneNumber;
  }

  return extracted;
}

function looksLikeAddressReply(text, draft) {
  if (!draft) return false;
  const hasCore = draft.fullName && draft.phoneNumber && draft.productDescription;
  const missingAddr = !draft.address;
  const hasStreetSignal = /\d|شارع|ميدان|برج|عمارة|طابق|شقة|street|building/i.test(text);
  return hasCore && missingAddr && (hasStreetSignal || text.length > 8);
}

function buildZoneCorrectionAck(regionHints, draftFields, lang) {
  if (!regionHints?.zoneCorrectedFromAddress) return '';
  const isAr = lang === 'ar';
  let label = '';
  if (draftFields?.government && draftFields?.zone) {
    label = formatZoneForDisplay(draftFields.government, draftFields.zone, lang);
  } else if (regionHints.suggestedZone) {
    label = formatZoneForDisplay(
      regionHints.suggestedZone.government,
      regionHints.suggestedZone.zone,
      lang
    );
  }
  if (!label) {
    return isAr ? 'عدّلت المنطقة حسب العنوان.' : 'Updated the area based on the address.';
  }
  return isAr
    ? `عدّلت المنطقة لـ ${label} حسب العنوان.`
    : `Updated the area to ${label} based on the address.`;
}

function buildAcknowledgment(field, lang) {
  const isAr = lang === 'ar';
  switch (field) {
    case 'address':
      return isAr ? 'تمام، سجلت العنوان.' : 'Got it, address saved.';
    case 'phoneNumber':
      return isAr ? 'تمام، سجلت الرقم.' : 'Got it, phone number saved.';
    case 'codConfirmation':
      return isAr ? 'تمام، سجلت خيار الدفع.' : 'Got it, payment option saved.';
    case 'amountCOD':
      return isAr ? 'تمام، سجلت مبلغ التحصيل.' : 'Got it, COD amount saved.';
    case 'shippingSpeed':
      return isAr ? 'تمام، سجلت نوع التوصيل.' : 'Got it, shipping speed saved.';
    case 'zone':
      return isAr ? 'تمام، سجلت المنطقة.' : 'Got it, area saved.';
    case 'productDescription':
      return isAr ? 'تمام، سجلت المنتج.' : 'Got it, product saved.';
    case 'fullName':
      return isAr ? 'تمام، سجلت الاسم.' : 'Got it, name saved.';
    default:
      return isAr ? 'تمام.' : 'Got it.';
  }
}

function mergeClarifyingText(recap, clarifying) {
  if (recap && clarifying && recap !== clarifying) {
    return `${recap}\n\n${clarifying}`;
  }
  return clarifying || recap || '';
}

module.exports = {
  buildClarifyingMessage,
  buildQuickReplies,
  buildSuggestionsForField,
  extractFromUserReply,
  extractSecondaryPhone,
  scrubPhoneFromNotes,
  looksLikeAddressReply,
  buildAcknowledgment,
  buildZoneCorrectionAck,
  mergeClarifyingText,
  splitAckFromGeminiReply,
  detectShippingSpeed,
  detectCodConfirmation,
  detectCODAmount,
  parseArabicNumberFromText,
};
