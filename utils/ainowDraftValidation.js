/**
 * Shared "draft ready" validation for AINOW preview and confirm gates.
 */
const { isValidPickupDate, getPickupDateTooEarlyMessage } = require('./pickupDatePolicy');
const {
  validateOrderFieldsStructural,
  validatePickupForOrderCreation,
  validateReturnOrderAsync,
  normalizeFieldsFromBody,
  applyPickupDefaults,
} = require('./orderCreationHelper');
const {
  hasUsablePickupAddress,
  isAddressRowUsable,
  buildLocationFromAddress,
  getStrictPickupAddress,
} = require('./pickupAddressValidation');
const { draftToSubmitBody } = require('../services/ai/orderDraftService');

function getPickupDraftHelpers() {
  return require('../services/ai/pickupDraftService');
}

const EGYPTIAN_MOBILE_REGEX = /^01[0125]\d{8}$/;

function isValidEgyptianMobile(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return EGYPTIAN_MOBILE_REGEX.test(digits);
}

function getPickupReadyMessage(lang, key) {
  const isAr = lang === 'ar';
  const { PICKUP_ORDER_COUNT_MIN, PICKUP_ORDER_COUNT_MAX } = getPickupDraftHelpers();
  const map = {
    orderCount: isAr
      ? `عدد الأوردرات لازم يكون بين ${PICKUP_ORDER_COUNT_MIN} و ${PICKUP_ORDER_COUNT_MAX}.`
      : `Order count must be between ${PICKUP_ORDER_COUNT_MIN} and ${PICKUP_ORDER_COUNT_MAX}.`,
    phone: isAr
      ? 'رقم التواصل لازم يكون رقم موبايل مصري صحيح (11 رقم).'
      : 'Contact phone must be a valid Egyptian mobile number (11 digits).',
    noAddress: isAr
      ? 'محتاج تضيف عنوان استلام في الإعدادات قبل ما نكمل.'
      : 'Add a pickup address in Settings before we can continue.',
    pickAddress: isAr
      ? 'اختار عنوان استلام صحيح من عناوينك المحفوظة.'
      : 'Choose a valid pickup address from your saved addresses.',
    emptyAddress: isAr
      ? 'عنوان الاستلام ناقص. حدّث العنوان في الإعدادات.'
      : 'Pickup address is incomplete. Update it in Settings.',
  };
  return map[key] || map.pickAddress;
}

function validatePickupDraftReady(fields, userData, lang = 'en') {
  const { applyPickupDraftDefaults, validatePickupOrderCount } = getPickupDraftHelpers();
  const errors = [];
  let blockingField = null;
  let needsSettings = false;
  const f = applyPickupDraftDefaults(fields, userData);

  if (!validatePickupOrderCount(f.numberOfOrders)) {
    errors.push(getPickupReadyMessage(lang, 'orderCount'));
    blockingField = blockingField || 'numberOfOrders';
  }

  if (!isValidPickupDate(f.pickupDate)) {
    errors.push(getPickupDateTooEarlyMessage(lang));
    blockingField = blockingField || 'pickupDate';
  }

  if (!isValidEgyptianMobile(f.phoneNumber)) {
    errors.push(getPickupReadyMessage(lang, 'phone'));
    blockingField = blockingField || 'phoneNumber';
  }

  if (!hasUsablePickupAddress(userData)) {
    errors.push(getPickupReadyMessage(lang, 'noAddress'));
    blockingField = blockingField || 'pickupAddressId';
    needsSettings = true;
    return { ok: false, blockingField, errors, needsSettings };
  }

  const addresses = userData?.pickUpAddresses || [];
  const addr = getStrictPickupAddress(userData, f.pickupAddressId);

  if (addresses.length > 1) {
    if (!f.pickupAddressId || !addr) {
      errors.push(getPickupReadyMessage(lang, 'pickAddress'));
      blockingField = blockingField || 'pickupAddressId';
    }
  } else if (!addr) {
    errors.push(getPickupReadyMessage(lang, 'pickAddress'));
    blockingField = blockingField || 'pickupAddressId';
  }

  if (addr && !isAddressRowUsable(addr)) {
    errors.push(getPickupReadyMessage(lang, 'emptyAddress'));
    blockingField = blockingField || 'pickupAddressId';
    needsSettings = true;
  }

  const location = (f.pickupLocation || buildLocationFromAddress(addr) || '').trim();
  if (!location && !errors.some((e) => e.includes('عنوان') || e.toLowerCase().includes('address'))) {
    errors.push(getPickupReadyMessage(lang, 'emptyAddress'));
    blockingField = blockingField || 'pickupAddressId';
    needsSettings = true;
  }

  return {
    ok: errors.length === 0,
    blockingField,
    errors,
    needsSettings,
  };
}

async function validateOrderDraftReady(fields, userData, lang = 'en', userId = null) {
  const errors = [];
  let blockingField = null;
  let needsSettings = false;

  if (!isValidEgyptianMobile(fields.phoneNumber)) {
    errors.push(
      lang === 'ar'
        ? 'رقم الموبايل لازم يكون رقم مصري صحيح (11 رقم).'
        : 'Phone number must be a valid Egyptian mobile number (11 digits).'
    );
    blockingField = blockingField || 'phoneNumber';
  }

  if (!fields.government || !fields.zone) {
    errors.push(
      lang === 'ar'
        ? 'المحافظة والمنطقة مطلوبين.'
        : 'Government and zone are required.'
    );
    blockingField = blockingField || 'zone';
  }

  const body = draftToSubmitBody(fields);
  const normalized = normalizeFieldsFromBody(body);
  applyPickupDefaults(userData, normalized);

  const structural = validateOrderFieldsStructural(normalized);
  if (structural.errors.length) {
    errors.push(...structural.errors);
    if (!normalized.orderType || !['Deliver', 'Return', 'Exchange'].includes(normalized.orderType)) {
      blockingField = blockingField || 'orderType';
    } else if (normalized.orderType === 'Return' && !normalized.originalOrderNumber) {
      blockingField = blockingField || 'originalOrderNumber';
    } else if (normalized.orderType === 'Return' && !normalized.returnReason) {
      blockingField = blockingField || 'returnReason';
    } else if (!blockingField) {
      blockingField = 'fullName';
    }
  }

  const pickupVal = validatePickupForOrderCreation(userData, normalized);
  if (pickupVal.errors.length) {
    errors.push(...pickupVal.errors);
    blockingField = blockingField || 'selectedPickupAddressId';
    needsSettings = true;
  }

  if (userId && normalized.orderType === 'Return' && errors.length === 0) {
    const returnVal = await validateReturnOrderAsync(userId, normalized);
    if (returnVal.errors.length) {
      errors.push(...returnVal.errors);
      blockingField = blockingField || 'originalOrderNumber';
    }
  }

  return {
    ok: errors.length === 0,
    blockingField,
    errors,
    needsSettings,
    normalized,
  };
}

const CONFIRM_PICKUP_PHRASES = [
  'تأكيد الاستلام',
  'confirm pickup',
  'confirm_pickup',
];
const CONFIRM_ORDER_PHRASES = [
  'تأكيد الأوردر',
  'تأكيد الطلب',
  'confirm order',
  'confirm_order',
];
const CANCEL_DRAFT_PHRASES = [
  'إلغاء',
  'الغاء',
  'cancel',
  'cancel draft',
];

function normalizePhrase(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesPhrase(text, phrases) {
  const norm = normalizePhrase(text);
  return phrases.some((p) => norm === normalizePhrase(p));
}

function isConfirmPickupPhrase(text) {
  return matchesPhrase(text, CONFIRM_PICKUP_PHRASES);
}

function isConfirmOrderPhrase(text) {
  return matchesPhrase(text, CONFIRM_ORDER_PHRASES);
}

function isCancelDraftPhrase(text) {
  return matchesPhrase(text, CANCEL_DRAFT_PHRASES);
}

function getSettingsActions(lang) {
  const isAr = lang === 'ar';
  return [
    {
      text: isAr ? 'إعدادات العناوين' : 'Address settings',
      url: '/business/settings',
    },
  ];
}

module.exports = {
  EGYPTIAN_MOBILE_REGEX,
  isValidEgyptianMobile,
  validatePickupDraftReady,
  validateOrderDraftReady,
  isConfirmPickupPhrase,
  isConfirmOrderPhrase,
  isCancelDraftPhrase,
  getSettingsActions,
  getPickupReadyMessage,
};
