const { calculatePickupFee } = require('../../utils/fees');
const Pickup = require('../../models/pickup');
const {
  isValidPickupDate,
  getPickupDateTooEarlyMessage,
} = require('../../utils/pickupDatePolicy');
const {
  hasUsablePickupAddress,
  isAddressRowUsable,
  buildLocationFromAddress,
  getStrictPickupAddress,
} = require('../../utils/pickupAddressValidation');

const PICKUP_PRIORITY = ['numberOfOrders', 'pickupDate', 'phoneNumber', 'pickupAddressId'];

const PICKUP_DRAFT_DEFAULTS = {
  numberOfOrders: null,
  pickupDate: null,
  phoneNumber: '',
  pickupAddressId: null,
  pickupLocation: '',
  pickupNotes: '',
  isFragileItems: false,
  isLargeItems: false,
};

const PICKUP_FIELD_LABELS = {
  ar: {
    numberOfOrders: 'عدد الأوردرات',
    pickupDate: 'تاريخ الاستلام',
    phoneNumber: 'رقم التواصل',
    pickupAddressId: 'عنوان الاستلام',
    pickupNotes: 'ملاحظات الاستلام',
    isFragileItems: 'منتجات قابلة للكسر',
    isLargeItems: 'منتجات كبيرة',
  },
  en: {
    numberOfOrders: 'number of orders',
    pickupDate: 'pickup date',
    phoneNumber: 'contact phone',
    pickupAddressId: 'pickup address',
    pickupNotes: 'pickup notes',
    isFragileItems: 'fragile items',
    isLargeItems: 'large items',
  },
};

function getPickupFieldLabel(field, lang) {
  const l = lang === 'ar' ? 'ar' : 'en';
  return (PICKUP_FIELD_LABELS[l] && PICKUP_FIELD_LABELS[l][field]) || field;
}

function isPresent(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (typeof val === 'number') return Number.isFinite(val);
  if (val instanceof Date) return !Number.isNaN(val.getTime());
  if (typeof val === 'boolean') return true;
  return !!val;
}

function resolvePickupAddress(userData, addressId) {
  const addresses = userData?.pickUpAddresses || [];
  if (addressId) {
    const found = addresses.find((a) => a.addressId === addressId);
    if (found) return found;
  }
  if (addresses.length === 1) return addresses[0];
  return addresses.find((a) => a.isDefault) || addresses[0] || null;
}

function applyPickupDraftDefaults(fields, userData) {
  const next = { ...fields };
  const addresses = userData?.pickUpAddresses || [];

  if (!next.pickupAddressId && addresses.length === 1) {
    next.pickupAddressId = addresses[0].addressId;
  } else if (!next.pickupAddressId && addresses.length > 1) {
    const def = addresses.find((a) => a.isDefault);
    if (def) next.pickupAddressId = def.addressId;
  }

  const addr = getStrictPickupAddress(userData, next.pickupAddressId)
    || resolvePickupAddress(userData, next.pickupAddressId);
  if (!next.phoneNumber) {
    next.phoneNumber =
      addr?.pickupPhone || userData?.phoneNumber || userData?.pickUpAdress?.pickupPhone || '';
  }
  if (!next.pickupLocation && addr) {
    next.pickupLocation = buildLocationFromAddress(addr);
  }
  return next;
}

function getPickupMissingFields(fields, userData) {
  const missing = [];
  const f = applyPickupDraftDefaults(fields, userData);

  if (!Number.isFinite(Number(f.numberOfOrders)) || Number(f.numberOfOrders) < 1) {
    missing.push('numberOfOrders');
  }
  if (!isPresent(f.pickupDate)) {
    missing.push('pickupDate');
  }
  if (!isPresent(f.phoneNumber)) {
    missing.push('phoneNumber');
  }

  if (!hasUsablePickupAddress(userData)) {
    missing.push('pickupAddressId');
    return [...new Set(missing)];
  }

  const addresses = userData?.pickUpAddresses || [];
  const addr = getStrictPickupAddress(userData, f.pickupAddressId);

  if (addresses.length > 1 && !isPresent(f.pickupAddressId)) {
    missing.push('pickupAddressId');
  } else if (!addr || !isAddressRowUsable(addr)) {
    missing.push('pickupAddressId');
  } else if (!(f.pickupLocation || buildLocationFromAddress(addr)).trim()) {
    missing.push('pickupAddressId');
  }

  return [...new Set(missing)];
}

function getPickupClarificationQueue(fields, userData) {
  const missing = getPickupMissingFields(fields, userData);
  const ordered = [];
  for (const key of PICKUP_PRIORITY) {
    if (missing.includes(key)) ordered.push(key);
  }
  for (const key of missing) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

function isPickupDraftComplete(fields, userData) {
  return getPickupClarificationQueue(fields, userData).length === 0;
}

function getPickupDraftProgress(fields, userData) {
  const queue = getPickupClarificationQueue(fields, userData);
  const addresses = userData?.pickUpAddresses || [];
  const total = addresses.length > 1 ? 4 : 3;
  let collected = 0;
  if (!queue.length) {
    collected = total;
  } else {
    const stepIdx = PICKUP_PRIORITY.indexOf(queue[0]);
    collected = stepIdx >= 0 ? stepIdx : 0;
  }

  return {
    collected: Math.min(collected, total),
    total,
    missingFields: queue,
    currentField: queue[0] || null,
    upcomingField: queue.length > 1 ? queue[1] : null,
  };
}

function isPickupFieldBeforeStep(fieldKey, firstMissingField) {
  if (!firstMissingField) return true;
  const fieldIdx = PICKUP_PRIORITY.indexOf(fieldKey);
  const missingIdx = PICKUP_PRIORITY.indexOf(firstMissingField);
  if (fieldIdx < 0) return false;
  if (missingIdx < 0) return true;
  return fieldIdx < missingIdx;
}

function mergePickupDraft(existing, extracted, lang, opts = {}) {
  const userData = opts.userData || null;
  const base = { ...PICKUP_DRAFT_DEFAULTS, ...(existing || {}) };

  if (!extracted || typeof extracted !== 'object') {
    return applyPickupDraftDefaults(base, userData);
  }

  const keys = [
    'numberOfOrders', 'pickupDate', 'phoneNumber', 'pickupAddressId',
    'pickupLocation', 'pickupNotes', 'isFragileItems', 'isLargeItems',
  ];

  for (const key of keys) {
    const value = extracted[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (key === 'numberOfOrders') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) base.numberOfOrders = Math.floor(n);
      continue;
    }
    if (key === 'pickupDate') {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        base.pickupDate = value;
      } else if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) base.pickupDate = d;
      }
      continue;
    }
    if (key === 'phoneNumber') {
      base.phoneNumber = String(value).replace(/\s/g, '');
      continue;
    }
    if (key === 'isFragileItems' || key === 'isLargeItems') {
      base[key] = value === true || value === 'true' || value === 'on';
      continue;
    }
    base[key] = value;
  }

  return applyPickupDraftDefaults(base, userData);
}

function formatPickupDate(date, lang) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const loc = lang === 'ar' ? 'ar-EG' : 'en-EG';
  return d.toLocaleDateString(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPickupStatus(status, lang) {
  const isAr = lang === 'ar';
  const map = {
    new: isAr ? 'جديد' : 'New',
    pendingPickup: isAr ? 'في انتظار الاستلام' : 'Pending pickup',
    driverAssigned: isAr ? 'تم تعيين المندوب' : 'Driver assigned',
    pickedUp: isAr ? 'تم الاستلام' : 'Picked up',
    inStock: isAr ? 'في المخزن' : 'In stock',
    inProgress: isAr ? 'قيد المعالجة' : 'In progress',
    completed: isAr ? 'مكتمل' : 'Completed',
    canceled: isAr ? 'ملغي' : 'Canceled',
    rejected: isAr ? 'مرفوض' : 'Rejected',
    returned: isAr ? 'مرتجع' : 'Returned',
    terminated: isAr ? 'منتهي' : 'Terminated',
  };
  return map[status] || status;
}

function buildPickupPreview(fields, userData, lang) {
  const isAr = lang === 'ar';
  const f = applyPickupDraftDefaults(fields, userData);
  const addr = getStrictPickupAddress(userData, f.pickupAddressId);
  const city = addr?.city || userData?.pickUpAdress?.city || 'Cairo';
  const fee = calculatePickupFee(city, 0);

  const addressLabel = f.pickupLocation
    || (addr
      ? [addr.addressName || addr.label, addr.adressDetails, addr.zone, addr.city].filter(Boolean).join(' — ')
      : '—');

  const lines = [];
  if (isAr) {
    lines.push(`عدد الأوردرات: ${f.numberOfOrders || '—'}`);
    lines.push(`تاريخ الاستلام: ${formatPickupDate(f.pickupDate, lang)}`);
    lines.push(`رقم التواصل: ${f.phoneNumber || '—'}`);
    lines.push(`العنوان: ${addressLabel}`);
    if (f.isFragileItems) lines.push('منتجات قابلة للكسر: نعم');
    if (f.isLargeItems) lines.push('منتجات كبيرة: نعم');
    if (f.pickupNotes) lines.push(`ملاحظات: ${f.pickupNotes}`);
    lines.push(`رسوم الاستلام التقديرية: ${fee} ج.م`);
  } else {
    lines.push(`Orders to pick up: ${f.numberOfOrders || '—'}`);
    lines.push(`Pickup date: ${formatPickupDate(f.pickupDate, lang)}`);
    lines.push(`Contact phone: ${f.phoneNumber || '—'}`);
    lines.push(`Address: ${addressLabel}`);
    if (f.isFragileItems) lines.push('Fragile items: Yes');
    if (f.isLargeItems) lines.push('Large items: Yes');
    if (f.pickupNotes) lines.push(`Notes: ${f.pickupNotes}`);
    lines.push(`Estimated pickup fee: ${fee} EGP`);
  }

  return {
    title: isAr ? 'معاينة طلب الاستلام' : 'Pickup Preview',
    summary: lines.join('\n'),
    fields: { ...f },
    estimatedFee: fee,
    actions: [
      { type: 'confirm_pickup', label: isAr ? 'تأكيد الاستلام' : 'Confirm Pickup' },
      { type: 'cancel_draft', label: isAr ? 'إلغاء' : 'Cancel' },
      { type: 'edit_manual', label: isAr ? 'تعديل يدوي' : 'Edit manually', url: '/business/pickups' },
    ],
  };
}

function buildPickupChips(fields, missingFields, lang) {
  const chips = [];
  const f = applyPickupDraftDefaults(fields, {});
  const firstMissing = missingFields[0] || null;

  if (
    Number(f.numberOfOrders) > 0
    && !missingFields.includes('numberOfOrders')
    && isPickupFieldBeforeStep('numberOfOrders', firstMissing)
  ) {
    chips.push({
      key: 'numberOfOrders',
      label: getPickupFieldLabel('numberOfOrders', lang),
      value: String(f.numberOfOrders),
    });
  }
  if (
    f.pickupDate
    && !missingFields.includes('pickupDate')
    && isPickupFieldBeforeStep('pickupDate', firstMissing)
  ) {
    chips.push({
      key: 'pickupDate',
      label: getPickupFieldLabel('pickupDate', lang),
      value: formatPickupDate(f.pickupDate, lang),
    });
  }
  if (
    f.phoneNumber
    && !missingFields.includes('phoneNumber')
    && isPickupFieldBeforeStep('phoneNumber', firstMissing)
  ) {
    chips.push({
      key: 'phoneNumber',
      label: getPickupFieldLabel('phoneNumber', lang),
      value: String(f.phoneNumber),
    });
  }
  if (
    f.pickupAddressId
    && !missingFields.includes('pickupAddressId')
    && isPickupFieldBeforeStep('pickupAddressId', firstMissing)
  ) {
    chips.push({
      key: 'pickupAddressId',
      label: getPickupFieldLabel('pickupAddressId', lang),
      value: f.pickupLocation || String(f.pickupAddressId),
    });
  }
  if (f.isFragileItems) {
    chips.push({
      key: 'isFragileItems',
      label: getPickupFieldLabel('isFragileItems', lang),
      value: lang === 'ar' ? 'نعم' : 'Yes',
    });
  }
  if (f.isLargeItems) {
    chips.push({
      key: 'isLargeItems',
      label: getPickupFieldLabel('isLargeItems', lang),
      value: lang === 'ar' ? 'نعم' : 'Yes',
    });
  }
  if (f.pickupNotes) {
    chips.push({
      key: 'pickupNotes',
      label: getPickupFieldLabel('pickupNotes', lang),
      value: String(f.pickupNotes),
    });
  }
  return chips;
}

function validatePickupDate(date) {
  return isValidPickupDate(date);
}

async function createPickupFromDraft(userId, userData, fields) {
  const f = applyPickupDraftDefaults(fields, userData);
  const { validatePickupDraftReady } = require('../../utils/ainowDraftValidation');
  const ready = validatePickupDraftReady(f, userData, 'en');
  if (!ready.ok) {
    throw new Error(ready.errors[0] || 'Pickup draft is not valid');
  }

  const addr = getStrictPickupAddress(userData, f.pickupAddressId);
  const businessCity = addr?.city || userData?.pickUpAdress?.city || 'Cairo';
  const computedPickupFee = calculatePickupFee(businessCity, 0);
  const pickupPhoneNumber =
    f.phoneNumber || addr?.pickupPhone || userData?.phoneNumber || '';

  const newPickup = new Pickup({
    business: userId,
    pickupNumber: String(Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000),
    numberOfOrders: f.numberOfOrders,
    pickupDate: f.pickupDate,
    phoneNumber: pickupPhoneNumber,
    isFragileItems: !!f.isFragileItems,
    isLargeItems: !!f.isLargeItems,
    picikupStatus: 'new',
    pickupNotes: f.pickupNotes || '',
    pickupFees: computedPickupFee,
    pickupAddressId: f.pickupAddressId || addr?.addressId || null,
    pickupLocation:
      f.pickupLocation
      || (addr
        ? `${addr.adressDetails || ''}, ${addr.city || ''}, ${addr.country || ''}`.replace(/^,\s*|,\s*$/g, '')
        : ''),
  });

  newPickup.pickupStages.push({
    stageName: 'Pickup Created',
    stageDate: new Date(),
    stageNotes: [{ text: 'Pickup has been created via AINOW.', date: new Date() }],
  });

  return newPickup.save();
}

const PICKUP_ORDER_COUNT_MAX = 999;
const PICKUP_ORDER_COUNT_MIN = 1;

function validatePickupOrderCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < PICKUP_ORDER_COUNT_MIN || n > PICKUP_ORDER_COUNT_MAX) {
    return false;
  }
  return true;
}

module.exports = {
  PICKUP_DRAFT_DEFAULTS,
  PICKUP_PRIORITY,
  PICKUP_ORDER_COUNT_MAX,
  PICKUP_ORDER_COUNT_MIN,
  validatePickupOrderCount,
  isPickupFieldBeforeStep,
  getPickupFieldLabel,
  mergePickupDraft,
  getPickupMissingFields,
  getPickupClarificationQueue,
  isPickupDraftComplete,
  getPickupDraftProgress,
  buildPickupPreview,
  buildPickupChips,
  applyPickupDraftDefaults,
  resolvePickupAddress,
  hasUsablePickupAddress,
  validatePickupDate,
  formatPickupDate,
  formatPickupStatus,
  createPickupFromDraft,
};
