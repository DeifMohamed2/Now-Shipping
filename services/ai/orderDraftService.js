const { validateOrderFieldsStructural } = require('../../utils/orderCreationHelper');
const { calculateOrderFee } = require('../../utils/fees');
const { getFieldLabel } = require('../gemini/prompts');
const { formatZoneForDisplay } = require('./regionResolver');
const { normalizeDraftFields } = require('./textNormalizer');
const DELIVER_PRIORITY = [
  'fullName', 'phoneNumber', 'zone', 'address', 'productDescription', 'numberOfItems',
  'codConfirmation', 'amountCOD', 'shippingSpeed', 'selectedPickupAddressId',
];

const ORDER_DRAFT_DEFAULTS = {
  orderType: 'Deliver',
  COD: false,
  codConfirmed: false,
  isExpressShipping: false,
  shippingSpeedConfirmed: false,
  previewPermission: false,
  deliverToWorkAddress: false,
  Notes: '',
  referralNumber: '',
};

const POST_STRUCTURAL_KEYS = [
  'COD',
  'codConfirmed',
  'amountCOD',
  'isExpressShipping',
  'shippingSpeedConfirmed',
];

function isPresent(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (typeof val === 'number') return Number.isFinite(val);
  if (typeof val === 'boolean') return true;
  return !!val;
}

function mergeField(target, key, value) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  target[key] = value;
}

/**
 * Strip post-structural fields that were set before their step in the queue.
 */
function enforcePostStructuralOrder(fields, userData) {
  const next = { ...fields };
  const structural = getStructuralMissing(next, userData || {});

  if (structural.length > 0) {
    next.COD = false;
    next.codConfirmed = false;
    delete next.amountCOD;
    next.isExpressShipping = false;
    next.shippingSpeedConfirmed = false;
    return next;
  }

  if ((next.orderType || 'Deliver') !== 'Deliver') {
    return next;
  }

  if (!next.codConfirmed) {
    next.COD = false;
    delete next.amountCOD;
    next.isExpressShipping = false;
    next.shippingSpeedConfirmed = false;
    return next;
  }

  if (!next.COD) {
    delete next.amountCOD;
    next.isExpressShipping = false;
    next.shippingSpeedConfirmed = false;
    return next;
  }

  if (!isPresent(next.amountCOD)) {
    next.isExpressShipping = false;
    next.shippingSpeedConfirmed = false;
  }

  return next;
}

/**
 * Merge Gemini extraction into existing draft (never drop collected data).
 */
function mergeDraft(existing, extracted, lang, opts = {}) {
  const allowPostStructural = opts.allowPostStructuralFromExtract === true;
  const userData = opts.userData || null;
  const base = { ...ORDER_DRAFT_DEFAULTS, ...(existing || {}) };

  if (!extracted || typeof extracted !== 'object') {
    return normalizeDraftFields(enforcePostStructuralOrder(base, userData), lang || 'ar');
  }

  const extractedCopy = { ...extracted };
  if (!allowPostStructural) {
    for (const key of POST_STRUCTURAL_KEYS) {
      delete extractedCopy[key];
    }
  }

  const keys = [
    'orderType', 'fullName', 'phoneNumber', 'otherPhoneNumber', 'address',
    'government', 'zone', 'zoneQuery', 'replaceZone', 'isExpressShipping', 'shippingSpeedConfirmed',
    'productDescription', 'numberOfItems',
    'COD', 'codConfirmed', 'amountCOD', 'Notes', 'originalOrderNumber', 'returnReason',
    'selectedPickupAddressId', 'currentPD', 'numberOfItemsCurrentPD', 'newPD', 'numberOfItemsNewPD',
    'isPartialReturn', 'partialReturnItemCount',
  ];

  for (const key of keys) {
    mergeField(base, key, extractedCopy[key]);
  }

  if (allowPostStructural) {
    if (extracted.isExpressShipping === true || extracted.isExpressShipping === false) {
      base.shippingSpeedConfirmed = true;
    }
    if (extracted.shippingSpeedConfirmed === true) {
      base.shippingSpeedConfirmed = true;
    }
    if (extracted.codConfirmed === true) {
      base.codConfirmed = true;
    }
    if (extracted.COD === false) {
      base.COD = false;
      base.codConfirmed = true;
      delete base.amountCOD;
    }
    if (isPresent(extracted.amountCOD)) {
      base.COD = true;
      base.codConfirmed = true;
    }
  }

  if (base.orderType !== 'Deliver') {
    base.isExpressShipping = false;
    base.shippingSpeedConfirmed = true;
  }

  return normalizeDraftFields(enforcePostStructuralOrder(base, userData), lang || 'ar');
}

function getStructuralMissing(fields, userData) {
  const missing = [];
  const f = fields;
  const orderType = f.orderType || 'Deliver';

  if (!isPresent(f.fullName)) missing.push('fullName');
  if (!isPresent(f.phoneNumber)) missing.push('phoneNumber');
  if (!isPresent(f.address)) missing.push('address');
  if (!isPresent(f.government)) missing.push('government');
  if (!isPresent(f.zone)) missing.push('zone');

  if (orderType === 'Deliver') {
    if (!isPresent(f.productDescription)) missing.push('productDescription');
    if (!Number.isFinite(Number(f.numberOfItems)) || Number(f.numberOfItems) <= 0) {
      missing.push('numberOfItems');
    }
    if (f.isExpressShipping && !isPresent(f.selectedPickupAddressId)) {
      const pickups = userData?.pickUpAddresses || [];
      if (pickups.length === 0) {
        missing.push('selectedPickupAddressId');
      } else if (pickups.length > 1 && !isPresent(f.selectedPickupAddressId)) {
        missing.push('selectedPickupAddressId');
      }
    }
  } else if (orderType === 'Return') {
    if (!isPresent(f.originalOrderNumber)) missing.push('originalOrderNumber');
    if (!isPresent(f.returnReason)) missing.push('returnReason');
    if (!isPresent(f.productDescription)) missing.push('productDescription');
    if (!Number.isFinite(Number(f.numberOfItems)) || Number(f.numberOfItems) <= 0) {
      missing.push('numberOfItems');
    }
    const pickups = userData?.pickUpAddresses || [];
    if (pickups.length === 0) {
      missing.push('selectedPickupAddressId');
    } else if (pickups.length > 1 && !isPresent(f.selectedPickupAddressId)) {
      missing.push('selectedPickupAddressId');
    }
  } else if (orderType === 'Exchange') {
    if (!isPresent(f.currentPD)) missing.push('currentPD');
    if (!isPresent(f.newPD)) missing.push('newPD');
    if (!Number.isFinite(Number(f.numberOfItemsCurrentPD)) || Number(f.numberOfItemsCurrentPD) <= 0) {
      missing.push('numberOfItemsCurrentPD');
    }
    if (!Number.isFinite(Number(f.numberOfItemsNewPD)) || Number(f.numberOfItemsNewPD) <= 0) {
      missing.push('numberOfItemsNewPD');
    }
  }

  return [...new Set(missing)];
}

function getPostStructuralMissing(fields, userData) {
  const orderType = fields.orderType || 'Deliver';
  if (orderType !== 'Deliver') {
    return [];
  }

  if (!fields.codConfirmed) {
    return ['codConfirmation'];
  }
  if (fields.COD && !isPresent(fields.amountCOD)) {
    return ['amountCOD'];
  }
  if (!fields.shippingSpeedConfirmed) {
    return ['shippingSpeed'];
  }

  const pickups = userData?.pickUpAddresses || [];
  if (
    fields.isExpressShipping &&
    pickups.length > 1 &&
    !isPresent(fields.selectedPickupAddressId)
  ) {
    return ['selectedPickupAddressId'];
  }

  return [];
}

function getMissingRequiredFields(fields, userData) {
  const structural = getStructuralMissing(fields, userData);
  if (structural.length > 0) {
    return structural;
  }
  return getPostStructuralMissing(fields, userData);
}

function peekUpcomingField(fields, queue) {
  if (!queue || !queue.length) return null;
  const current = queue[0];
  if (current === 'codConfirmation') {
    return null;
  }
  if (current === 'amountCOD') {
    return 'shippingSpeed';
  }
  if (current === 'shippingSpeed') {
    return null;
  }
  return queue[1] || null;
}

function orderByPriority(fields) {
  const ordered = [];
  for (const key of DELIVER_PRIORITY) {
    if (fields.includes(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of fields) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

function getClarificationQueue(fields, userData) {
  let missing = getMissingRequiredFields(fields, userData);
  const hasGov = missing.includes('government');
  const hasZone = missing.includes('zone');
  if (hasGov || hasZone) {
    missing = missing.filter((m) => m !== 'government' && m !== 'zone');
    if (!missing.includes('zone')) missing.push('zone');
  }
  return orderByPriority(missing);
}

function isDraftComplete(fields, userData) {
  return getClarificationQueue(fields, userData).length === 0;
}

function getDraftProgress(fields, userData) {
  const queue = getClarificationQueue(fields, userData);
  const orderType = fields.orderType || 'Deliver';
  let total = orderType === 'Deliver' ? 8 : 7;
  if (orderType === 'Deliver') {
    if (!fields.codConfirmed) {
      total = 9;
    } else if (fields.COD) {
      total = 9;
    }
  }

  let collected = 0;
  if (fields.fullName) collected++;
  if (fields.phoneNumber) collected++;
  if (fields.government && fields.zone) collected++;
  if (fields.address) collected++;
  if (fields.productDescription) collected++;
  if (fields.numberOfItems > 0) collected++;
  if (fields.codConfirmed) collected++;
  if (fields.COD && fields.amountCOD) collected++;
  if (fields.shippingSpeedConfirmed) collected++;

  return {
    collected: Math.min(collected, total),
    total,
    missingFields: queue,
    currentField: queue[0] || null,
    upcomingField: peekUpcomingField(fields, queue),
  };
}

function buildOrderPreview(fields, userData, lang) {
  const isAr = lang === 'ar';
  const gov = fields.government;
  const zoneLabel = formatZoneForDisplay(fields.government, fields.zone, lang);

  let estimatedFee = null;
  try {
    if (gov && fields.orderType) {
      estimatedFee = calculateOrderFee(gov, fields.orderType, !!fields.isExpressShipping);
    }
  } catch {
    estimatedFee = null;
  }

  const lines = [];
  if (isAr) {
    lines.push(`العميل: ${fields.fullName || '—'}`);
    lines.push(`الهاتف: ${fields.phoneNumber || '—'}`);
    if (fields.otherPhoneNumber) lines.push(`رقم آخر: ${fields.otherPhoneNumber}`);
    lines.push(`العنوان: ${fields.address || '—'}`);
    lines.push(`المنطقة: ${zoneLabel}`);
    if (fields.productDescription) lines.push(`المنتج: ${fields.productDescription}`);
    if (fields.numberOfItems) lines.push(`العدد: ${fields.numberOfItems}`);
    lines.push(fields.isExpressShipping ? 'توصيل سريع (٢٠٠ ج.م)' : 'توصيل عادي (١٠٠ ج.م)');
    if (fields.COD && fields.amountCOD) lines.push(`دفع عند الاستلام: ${fields.amountCOD} ج.م`);
    if (estimatedFee != null) lines.push(`الرسوم التقديرية: ${estimatedFee} ج.م`);
  } else {
    lines.push(`Customer: ${fields.fullName || '—'}`);
    lines.push(`Phone: ${fields.phoneNumber || '—'}`);
    if (fields.otherPhoneNumber) lines.push(`Alt. phone: ${fields.otherPhoneNumber}`);
    lines.push(`Address: ${fields.address || '—'}`);
    lines.push(`Area: ${zoneLabel}`);
    if (fields.productDescription) lines.push(`Product: ${fields.productDescription}`);
    if (fields.numberOfItems) lines.push(`Items: ${fields.numberOfItems}`);
    lines.push(fields.isExpressShipping ? 'Express delivery (200 EGP)' : 'Standard delivery (100 EGP)');
    if (fields.COD && fields.amountCOD) lines.push(`COD: ${fields.amountCOD} EGP`);
    if (estimatedFee != null) lines.push(`Est. fee: ${estimatedFee} EGP`);
  }

  return {
    title: isAr ? 'معاينة الأوردر' : 'Order Preview',
    summary: lines.join('\n'),
    fields: { ...fields },
    estimatedFee,
    zoneLabel,
    orderType: fields.orderType || 'Deliver',
    isExpressShipping: !!fields.isExpressShipping,
    actions: [
      { type: 'confirm_order', label: isAr ? 'تأكيد الأوردر' : 'Confirm Order' },
      { type: 'cancel_draft', label: isAr ? 'إلغاء' : 'Cancel' },
      { type: 'edit_manual', label: isAr ? 'تعديل يدوي' : 'Edit manually', url: '/business/create-order' },
    ],
  };
}

function buildCollectedChips(fields, missingFields, lang) {
  const chips = [];
  const allKeys = [
    'fullName', 'phoneNumber', 'otherPhoneNumber', 'address', 'zone', 'productDescription', 'numberOfItems',
  ];
  for (const key of allKeys) {
    if (isPresent(fields[key]) && !missingFields.includes(key)) {
      chips.push({
        key,
        label: getFieldLabel(key, lang),
        value: key === 'zone'
          ? formatZoneForDisplay(fields.government, fields.zone, lang)
          : String(fields[key]),
      });
    }
  }
  if (fields.codConfirmed) {
    chips.push({
      key: 'codConfirmation',
      label: getFieldLabel('codConfirmation', lang),
      value: fields.COD
        ? (lang === 'ar' ? 'نعم' : 'Yes')
        : (lang === 'ar' ? 'لا' : 'No'),
    });
  }
  if (fields.COD && fields.amountCOD) {
    chips.push({
      key: 'amountCOD',
      label: getFieldLabel('amountCOD', lang),
      value: String(fields.amountCOD),
    });
  }
  const enforced = enforcePostStructuralOrder(fields, {});
  if (
    enforced.shippingSpeedConfirmed &&
    enforced.codConfirmed &&
    (!enforced.COD || isPresent(enforced.amountCOD))
  ) {
    chips.push({
      key: 'shippingSpeed',
      label: getFieldLabel('shippingSpeed', lang),
      value: fields.isExpressShipping
        ? (lang === 'ar' ? 'سريع' : 'Express')
        : (lang === 'ar' ? 'عادي' : 'Standard'),
    });
  }
  return chips;
}

function draftToSubmitBody(fields) {
  return {
    fullName: fields.fullName,
    phoneNumber: fields.phoneNumber,
    otherPhoneNumber: fields.otherPhoneNumber || '',
    address: fields.address,
    government: fields.government,
    zone: fields.zone,
    orderType: fields.orderType || 'Deliver',
    productDescription: fields.productDescription,
    numberOfItems: fields.numberOfItems,
    COD: fields.COD ? 'on' : '',
    amountCOD: fields.amountCOD,
    isExpressShipping: fields.isExpressShipping ? 'on' : '',
    selectedPickupAddressId: fields.selectedPickupAddressId,
    Notes: fields.Notes || '',
    referralNumber: fields.referralNumber || '',
    previewPermission: fields.previewPermission ? 'on' : '',
    originalOrderNumber: fields.originalOrderNumber,
    returnReason: fields.returnReason,
    currentPD: fields.currentPD,
    numberOfItemsCurrentPD: fields.numberOfItemsCurrentPD,
    newPD: fields.newPD,
    numberOfItemsNewPD: fields.numberOfItemsNewPD,
  };
}

module.exports = {
  mergeDraft,
  enforcePostStructuralOrder,
  POST_STRUCTURAL_KEYS,
  getMissingRequiredFields,
  getStructuralMissing,
  getClarificationQueue,
  isDraftComplete,
  buildOrderPreview,
  buildCollectedChips,
  draftToSubmitBody,
  getDraftProgress,
  peekUpcomingField,
  getPostStructuralMissing,
  ORDER_DRAFT_DEFAULTS,
};
