/**
 * Clarification queue, templates, and reply extractors for AINOW pickup scheduling.
 */
const { normalizeArabicDigitsToLatin } = require('../../utils/bostaRegionsServer');
const { parseArabicNumberFromText } = require('./clarificationEngine');
const {
  getPickupFieldLabel,
  PICKUP_ORDER_COUNT_MAX,
  PICKUP_ORDER_COUNT_MIN,
  validatePickupOrderCount,
  applyPickupDraftDefaults,
} = require('./pickupDraftService');
const { getEarliestPickupDateIso } = require('../../utils/pickupDatePolicy');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

function parsePickupDate(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const norm = normalizeArabicDigitsToLatin(raw).toLowerCase();
  const now = startOfDay(new Date());

  if (/^(today|النهارده|النهاردة|اليوم|today)$/i.test(norm)) {
    return now;
  }
  if (/^(tomorrow|بكرة|بكرا|غدا|غداً)$/i.test(norm)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (/^(after tomorrow|بعد بكرة|بعد بكرا)$/i.test(norm)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d;
  }

  const iso = norm.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = startOfDay(new Date(iso[0]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dmy = norm.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    let day = parseInt(dmy[1], 10);
    let month = parseInt(dmy[2], 10) - 1;
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    const d = startOfDay(new Date(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return startOfDay(new Date(parsed));
  }
  return null;
}

function detectFragileLarge(text) {
  const t = String(text).toLowerCase();
  const fragile = /(fragile|قابل.*كسر|قابلة.*كسر|هش|زجاج|breakable)/i.test(t);
  const large = /(large|كبير|كبيرة|heavy|ثقيل)/i.test(t);
  return { isFragileItems: fragile, isLargeItems: large };
}

function buildPickupClarifyingMessage(field, draft, userContext, lang) {
  const isAr = lang === 'ar';

  switch (field) {
    case 'numberOfOrders':
      return isAr
        ? 'كم أوردر محتاج نستلم؟'
        : 'How many orders should we pick up?';
    case 'pickupDate':
      return isAr
        ? 'إمتى تحب الاستلام؟ (بكرة أو بعد بكرة — مثال: 09/06/2026)'
        : 'When should we pick up? (tomorrow or day after — e.g. 09/06/2026)';
    case 'phoneNumber':
      return isAr
        ? 'رقم التواصل للاستلام؟ (واتساب)'
        : 'Contact phone for pickup? (WhatsApp)';
    case 'pickupAddressId': {
      const pickups = userContext?.pickupAddresses || [];
      if (pickups.length > 1) {
        const list = pickups
          .map((p, i) => `${i + 1}. ${p.label}${p.isDefault ? (isAr ? ' (افتراضي)' : ' (default)') : ''}`)
          .join('\n');
        return isAr
          ? `من أي عنوان نستلم؟\n${list}`
          : `Which pickup address?\n${list}`;
      }
      return isAr ? 'محتاج عنوان استلام في الإعدادات.' : 'A pickup address is required in Settings.';
    }
    default:
      return isAr ? 'تمام.' : 'Got it.';
  }
}

function buildPickupQuickReplies(field, lang) {
  const isAr = lang === 'ar';
  switch (field) {
    case 'pickupDate':
      return isAr
        ? [
            { label: 'بكرة', value: 'بكرة' },
            { label: 'بعد بكرة', value: 'بعد بكرة' },
          ]
        : [
            { label: 'Tomorrow', value: 'tomorrow' },
            { label: 'Day after tomorrow', value: 'after tomorrow' },
          ];
    case 'numberOfOrders':
      return isAr
        ? [
            { label: '5', value: '5' },
            { label: '10', value: '10' },
            { label: '20', value: '20' },
          ]
        : [
            { label: '5', value: '5' },
            { label: '10', value: '10' },
            { label: '20', value: '20' },
          ];
    default:
      return [];
  }
}

function buildPickupSuggestionsForField(field, lang, userContext) {
  return buildPickupQuickReplies(field, lang).map((q) => q.label);
}

function buildPickupStructuredField(field, lang, userContext, draftFields, userData) {
  const isAr = lang === 'ar';

  switch (field) {
    case 'numberOfOrders':
      return {
        field: 'numberOfOrders',
        type: 'number_presets',
        min: PICKUP_ORDER_COUNT_MIN,
        max: PICKUP_ORDER_COUNT_MAX,
        placeholder: isAr ? 'أدخل رقم تاني' : 'Enter another number',
        submitLabel: isAr ? 'متابعة' : 'Continue',
        dividerLabel: isAr ? 'أو اكتب رقم مخصص' : 'Or enter a custom number',
      };
    case 'pickupDate': {
      const minIso = getEarliestPickupDateIso();
      return {
        field: 'pickupDate',
        type: 'date_inline',
        minDate: minIso,
        defaultDate: minIso,
        hint: isAr ? 'اختار تاريخ من التقويم (بكرة أو بعد بكرة)' : 'Pick a date (tomorrow or later)',
      };
    }
    case 'phoneNumber': {
      const f = applyPickupDraftDefaults(draftFields || {}, userData || {});
      return {
        field: 'phoneNumber',
        type: 'phone',
        defaultValue: f.phoneNumber || '',
        placeholder: isAr ? 'رقم واتساب للتواصل' : 'WhatsApp contact number',
        submitLabel: isAr ? 'متابعة' : 'Continue',
      };
    }
    default:
      return null;
  }
}

function extractPickupFieldsFromMessage(text, pendingField, draft, userContext) {
  const raw = String(text || '').trim();
  if (!raw) return {};

  const extracted = {};
  const extras = detectFragileLarge(raw);
  if (extras.isFragileItems) extracted.isFragileItems = true;
  if (extras.isLargeItems) extracted.isLargeItems = true;

  if (pendingField === 'numberOfOrders' || !draft.numberOfOrders) {
    const num = parseArabicNumberFromText(raw);
    const orderMatch = raw.match(/(\d+)\s*(?:order|orders|اوردر|أوردر|اوردرات|أوردرات)/i);
    const fromText = orderMatch ? parseInt(orderMatch[1], 10) : null;
    const value = num != null && num > 0 ? num : fromText;
    if (value != null && value > 0) extracted.numberOfOrders = value;
  }

  if (pendingField === 'pickupDate' || !draft.pickupDate) {
    const date = parsePickupDate(raw);
    if (date) extracted.pickupDate = date;
  }

  if (pendingField === 'phoneNumber') {
    const phone = normalizeArabicDigitsToLatin(raw).replace(/\D/g, '');
    if (phone.length >= 10) extracted.phoneNumber = phone;
  } else if (!draft.phoneNumber && /01[0125]\d{8}/.test(normalizeArabicDigitsToLatin(raw))) {
    const phone = normalizeArabicDigitsToLatin(raw).replace(/\D/g, '').match(/01[0125]\d{8}/);
    if (phone) extracted.phoneNumber = phone[0];
  }

  if (pendingField === 'pickupAddressId') {
    const pickups = userContext?.pickupAddresses || [];
    const num = parseInt(raw, 10);
    if (Number.isFinite(num) && num >= 1 && num <= pickups.length) {
      extracted.pickupAddressId = pickups[num - 1].addressId;
    }
  }

  if (pendingField === 'pickupNotes' || (!draft.pickupNotes && raw.length > 3)) {
    if (pendingField === 'pickupNotes') extracted.pickupNotes = raw;
  }

  if (pendingField === 'numberOfOrders' && !extracted.numberOfOrders) {
    const onlyNum = parseInt(normalizeArabicDigitsToLatin(raw), 10);
    if (Number.isFinite(onlyNum) && validatePickupOrderCount(onlyNum)) {
      extracted.numberOfOrders = onlyNum;
    }
  }

  if (extracted.numberOfOrders != null && !validatePickupOrderCount(extracted.numberOfOrders)) {
    delete extracted.numberOfOrders;
  }

  return extracted;
}

function buildPickupAcknowledgment(field, lang) {
  const isAr = lang === 'ar';
  switch (field) {
    case 'numberOfOrders':
      return isAr ? 'تمام، سجلت عدد الأوردرات.' : 'Got it, order count saved.';
    case 'pickupDate':
      return isAr ? 'تمام، سجلت تاريخ الاستلام.' : 'Got it, pickup date saved.';
    case 'phoneNumber':
      return isAr ? 'تمام، سجلت رقم التواصل.' : 'Got it, contact phone saved.';
    case 'pickupAddressId':
      return isAr ? 'تمام، سجلت عنوان الاستلام.' : 'Got it, pickup address saved.';
    default:
      return isAr ? 'تمام.' : 'Got it.';
  }
}

function extractPickupFieldsFromGemini(extracted) {
  if (!extracted || typeof extracted !== 'object') return {};
  const out = {};
  const keys = [
    'numberOfOrders', 'pickupDate', 'phoneNumber', 'pickupAddressId',
    'pickupLocation', 'pickupNotes', 'isFragileItems', 'isLargeItems',
  ];
  for (const key of keys) {
    if (extracted[key] !== undefined && extracted[key] !== null) {
      out[key] = extracted[key];
    }
  }
  if (out.pickupDate && typeof out.pickupDate === 'string') {
    const parsed = parsePickupDate(out.pickupDate);
    if (parsed) out.pickupDate = parsed;
    else delete out.pickupDate;
  }
  return out;
}

module.exports = {
  parsePickupDate,
  buildPickupClarifyingMessage,
  buildPickupQuickReplies,
  buildPickupSuggestionsForField,
  buildPickupStructuredField,
  extractPickupFieldsFromMessage,
  buildPickupAcknowledgment,
  extractPickupFieldsFromGemini,
  getPickupFieldLabel,
  validatePickupOrderCount,
};
