/**
 * Shared order creation from normalized field objects (web form + Excel import).
 */
const Order = require('../models/order');
const statusHelper = require('./statusHelper');
const { calculateOrderFee } = require('./fees');
const {
  getDefaultPickupAddressId,
  findPickupAddressById,
} = require('./pickupAddressResolve');

function calculateFees(government, orderType, isExpressShipping) {
  return calculateOrderFee(government, orderType, isExpressShipping);
}

/** Six-digit numeric string (100000–999999), suitable for display as Order ID. */
function generateOrderNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Reserves a 6-digit order number not already used in `Order` (unique index).
 */
async function generateUniqueOrderNumber(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    const n = generateOrderNumber();
    const taken = await Order.exists({ orderNumber: n });
    if (!taken) return n;
  }
  throw new Error('Could not allocate a unique order number');
}

/**
 * Normalize Express req.body into a consistent fields object.
 */
function normalizeFieldsFromBody(body) {
  const isPartialReturn = body.isPartialReturn === 'true' || body.isPartialReturn === true;
  let numberOfItemsForOrder = body.numberOfItems;
  if (body.orderType === 'Return' && isPartialReturn) {
    numberOfItemsForOrder = body.partialReturnItemCount;
  } else if (body.orderType === 'Exchange') {
    numberOfItemsForOrder = body.numberOfItemsCurrentPD || body.numberOfItems;
  }

  return {
    fullName: body.fullName,
    phoneNumber: body.phoneNumber,
    otherPhoneNumber: body.otherPhoneNumber,
    address: body.address,
    government: body.government,
    zone: body.zone,
    deliverToWorkAddress: body.deliverToWorkAddress === 'on' || body.deliverToWorkAddress === true,
    orderType: body.orderType,
    productDescription: body.productDescription,
    numberOfItems:
      numberOfItemsForOrder != null && numberOfItemsForOrder !== ''
        ? Number(numberOfItemsForOrder)
        : null,
    currentPD: body.currentPD,
    numberOfItemsCurrentPD:
      body.numberOfItemsCurrentPD != null && body.numberOfItemsCurrentPD !== ''
        ? Number(body.numberOfItemsCurrentPD)
        : null,
    newPD: body.newPD,
    numberOfItemsNewPD:
      body.numberOfItemsNewPD != null && body.numberOfItemsNewPD !== ''
        ? Number(body.numberOfItemsNewPD)
        : null,
    COD: !!body.COD || body.COD === 'on',
    amountCOD: body.amountCOD != null && body.amountCOD !== '' ? Number(body.amountCOD) : null,
    CashDifference: !!body.CashDifference || body.CashDifference === 'on',
    amountCashDifference:
      body.amountCashDifference != null && body.amountCashDifference !== ''
        ? Number(body.amountCashDifference)
        : null,
    previewPermission: body.previewPermission === 'on' || body.previewPermission === true,
    referralNumber: body.referralNumber || '',
    Notes: body.Notes || '',
    isExpressShipping:
      body.orderType === 'Deliver' &&
      (body.isExpressShipping === 'on' || body.isExpressShipping === true),
    selectedPickupAddressId:
      ['Deliver', 'Return', 'Exchange'].includes(body.orderType) &&
      body.selectedPickupAddressId != null &&
      String(body.selectedPickupAddressId).trim() !== ''
        ? String(body.selectedPickupAddressId).trim()
        : null,
    originalOrderNumber: body.originalOrderNumber,
    returnReason: body.returnReason,
    returnNotes: body.returnNotes,
    isPartialReturn,
    originalOrderItemCount:
      body.originalOrderItemCount != null && body.originalOrderItemCount !== ''
        ? Number(body.originalOrderItemCount)
        : null,
    partialReturnItemCount:
      body.partialReturnItemCount != null && body.partialReturnItemCount !== ''
        ? Number(body.partialReturnItemCount)
        : null,
  };
}

/**
 * Structural + type validation (no DB). Returns { errors: string[] }.
 */
const ALLOWED_ORDER_TYPES = ['Deliver', 'Return', 'Exchange'];

function validateOrderFieldsStructural(fields) {
  const errors = [];
  const {
    fullName,
    phoneNumber,
    address,
    government,
    zone,
    orderType,
    productDescription,
    numberOfItems,
    currentPD,
    numberOfItemsCurrentPD,
    newPD,
    numberOfItemsNewPD,
    originalOrderNumber,
    returnReason,
    isPartialReturn,
    partialReturnItemCount,
  } = fields;

  if (!fullName || !phoneNumber || !address || !government || !zone || !orderType) {
    errors.push('All customer info fields are required (name, phone, address, government, zone, order type).');
  }

  if (orderType && !ALLOWED_ORDER_TYPES.includes(orderType)) {
    errors.push(`Invalid order type "${orderType}". Use: Deliver, Return, or Exchange.`);
  }

  if (orderType === 'Deliver') {
    const n = Number(numberOfItems);
    if (!productDescription || !Number.isFinite(n) || n <= 0) {
      errors.push('Deliver orders require product description and a positive number of items.');
    }
  } else if (orderType === 'Return') {
    if (isPartialReturn) {
      const pr = Number(partialReturnItemCount);
      if (
        !Number.isFinite(pr) ||
        pr <= 0 ||
        !productDescription ||
        !originalOrderNumber ||
        !returnReason
      ) {
        errors.push(
          'Partial return orders require partial return item count, product description, original order number, and return reason.'
        );
      }
    } else {
      const n = Number(numberOfItems);
      if (!productDescription || !Number.isFinite(n) || n <= 0 || !originalOrderNumber || !returnReason) {
        errors.push(
          'Return orders require product description, number of items, original order number, and return reason.'
        );
      }
    }
  } else if (orderType === 'Exchange') {
    const ni = Number(numberOfItemsCurrentPD);
    const nn = Number(numberOfItemsNewPD);
    if (!currentPD || !Number.isFinite(ni) || ni <= 0 || !newPD || !Number.isFinite(nn) || nn <= 0) {
      errors.push('Exchange orders require current and new product details with positive item counts.');
    }
  }

  if (orderType === 'Deliver' && fields.isExpressShipping) {
    if (!fields.selectedPickupAddressId) {
      errors.push(
        'Express delivery requires a business pickup address. Add one in Settings or select it from the list.'
      );
    }
  }

  return { errors };
}

const ORDER_TYPES_WITH_PICKUP = ['Deliver', 'Return', 'Exchange'];

/**
 * When the client omits or sends an unknown pickup id, set the business default (main / first).
 * Mutates `fields.selectedPickupAddressId`.
 * @param {{ pickUpAddresses?: Array<{ addressId?: string }> }} userData
 * @param {object} fields - normalized fields (must include orderType)
 */
function applyPickupDefaults(userData, fields) {
  if (!fields || !ORDER_TYPES_WITH_PICKUP.includes(fields.orderType)) return;
  const list = Array.isArray(userData && userData.pickUpAddresses) ? userData.pickUpAddresses : [];
  if (!list.length) {
    fields.selectedPickupAddressId = null;
    return;
  }
  const raw = fields.selectedPickupAddressId;
  const trimmed = raw != null && raw !== '' ? String(raw).trim() : '';
  const match = trimmed ? findPickupAddressById(list, trimmed) : null;
  if (match) {
    fields.selectedPickupAddressId = trimmed;
    return;
  }
  fields.selectedPickupAddressId = getDefaultPickupAddressId(list);
}

/**
 * Pickup rules that need the business user document (after applyPickupDefaults).
 * @param {{ pickUpAddresses?: unknown[] }} userData
 * @param {object} fields
 * @returns {{ errors: string[] }}
 */
function validatePickupForOrderCreation(userData, fields) {
  const errors = [];
  if (!fields || fields.orderType !== 'Return') {
    return { errors };
  }
  const list = Array.isArray(userData && userData.pickUpAddresses) ? userData.pickUpAddresses : [];
  if (list.length === 0) {
    errors.push(
      'Return orders require at least one business pickup address. Add pickup addresses in Settings.'
    );
    return { errors };
  }
  if (!fields.selectedPickupAddressId) {
    errors.push(
      'Return orders require a valid business pickup address. Add pickup addresses in Settings or select one.'
    );
  }
  return { errors };
}

/**
 * Async validation for Return orders (original exists, eligible, no duplicate return).
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {object} fields - normalized fields
 * @param {object} [preload] - optional batch cache from buildReturnPreload
 */
async function validateReturnOrderAsync(businessId, fields, preload) {
  if (fields.orderType !== 'Return') return { errors: [] };

  const trimmed = fields.originalOrderNumber ? String(fields.originalOrderNumber).trim() : null;
  if (!trimmed) {
    return { errors: ['Original order number is required for return orders.'] };
  }

  let originalOrder = null;
  let debugOrder = null;

  if (preload && preload.originalByNumber) {
    originalOrder = preload.originalByNumber.get(trimmed) || null;
    debugOrder = preload.debugByNumber ? preload.debugByNumber.get(trimmed) : null;
    if (!originalOrder && !debugOrder) {
      return {
        errors: ['Original order not found or not eligible for return. Only completed deliver orders can be returned.'],
      };
    }
    if (!originalOrder && debugOrder) {
      return {
        errors: [
          `Original order found but not eligible for return (status: ${debugOrder.orderStatus}, type: ${debugOrder.orderShipping?.orderType}). Only completed Deliver orders can be returned.`,
        ],
      };
    }
  } else {
    originalOrder = await Order.findOne({
      orderNumber: trimmed,
      business: businessId,
      orderStatus: 'completed',
      'orderShipping.orderType': 'Deliver',
    });

    if (!originalOrder) {
      debugOrder = await Order.findOne({
        orderNumber: trimmed,
        business: businessId,
      }).select('orderNumber orderCustomer orderShipping orderStatus business');

      if (debugOrder) {
        return {
          errors: [
            `Original order found but not eligible for return (status: ${debugOrder.orderStatus}, type: ${debugOrder.orderShipping?.orderType}). Only completed Deliver orders can be returned.`,
          ],
        };
      }
      return {
        errors: ['Original order not found or not eligible for return. Only completed deliver orders can be returned.'],
      };
    }
  }

  let existingReturn = false;
  if (preload && preload.hasReturnForOriginal) {
    existingReturn = !!preload.hasReturnForOriginal.get(trimmed);
  } else {
    const er = await Order.findOne({
      'orderShipping.originalOrderNumber': trimmed,
      business: businessId,
    })
      .select('_id')
      .lean();
    existingReturn = !!er;
  }

  if (existingReturn) {
    return { errors: ['This order already has an associated return request.'] };
  }

  return { errors: [] };
}

/**
 * Preload Return-related data for many rows (batch).
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {string[]} originalNumbers - trimmed
 */
async function buildReturnPreload(businessId, originalNumbers) {
  const unique = [...new Set(originalNumbers.filter(Boolean))];
  if (unique.length === 0) {
    return {
      originalByNumber: new Map(),
      debugByNumber: new Map(),
      hasReturnForOriginal: new Map(),
    };
  }

  const originals = await Order.find({
    orderNumber: { $in: unique },
    business: businessId,
  }).select('orderNumber orderStatus orderShipping.orderType');

  const originalByNumber = new Map();
  const debugByNumber = new Map();
  for (const o of originals) {
    debugByNumber.set(o.orderNumber, o);
    if (o.orderStatus === 'completed' && o.orderShipping && o.orderShipping.orderType === 'Deliver') {
      originalByNumber.set(o.orderNumber, o);
    }
  }

  const existingReturns = await Order.find({
    business: businessId,
    'orderShipping.originalOrderNumber': { $in: unique },
  }).select('orderShipping.originalOrderNumber');

  const hasReturnForOriginal = new Map();
  for (const er of existingReturns) {
    const onum = er.orderShipping && er.orderShipping.originalOrderNumber;
    if (onum) hasReturnForOriginal.set(String(onum).trim(), true);
  }

  return { originalByNumber, debugByNumber, hasReturnForOriginal };
}

/**
 * Build unsaved Mongoose Order document.
 * @param {object} userData - req.userData (needs _id)
 * @param {object} fields - normalized fields from normalizeFieldsFromBody or import
 * @param {string} [orderNumber] - defaults to generateOrderNumber(); prefer generateUniqueOrderNumber() at save sites to avoid collisions.
 */
function buildOrderDocumentFromFields(userData, fields, orderNumber) {
  const orderType = fields.orderType;
  const isPartialReturn = fields.isPartialReturn;
  const expressShippingValue = !!fields.isExpressShipping;

  const orderFees = calculateFees(fields.government, orderType, expressShippingValue);

  const amountType = fields.COD
    ? 'COD'
    : fields.CashDifference
      ? 'CD'
      : 'NA';

  const amount =
    fields.amountCOD != null && !Number.isNaN(fields.amountCOD)
      ? fields.amountCOD
      : fields.amountCashDifference != null && !Number.isNaN(fields.amountCashDifference)
        ? fields.amountCashDifference
        : undefined;

  const returnReason = fields.returnReason || null;

  return new Order({
    orderNumber: orderNumber || generateOrderNumber(),
    orderDate: new Date(),
    orderStatus: 'new',
    statusCategory: statusHelper.STATUS_CATEGORIES.NEW,
    orderFees,
    orderCustomer: {
      fullName: fields.fullName,
      phoneNumber: fields.phoneNumber,
      otherPhoneNumber: fields.otherPhoneNumber || null,
      address: fields.address,
      government: fields.government,
      zone: fields.zone,
      deliverToWorkAddress: !!fields.deliverToWorkAddress,
    },
    orderShipping: {
      productDescription: fields.productDescription || fields.currentPD || '',
      numberOfItems: Number(fields.numberOfItems) || Number(fields.numberOfItemsCurrentPD) || 0,
      productDescriptionReplacement: fields.newPD || '',
      numberOfItemsReplacement: fields.numberOfItemsNewPD || 0,
      orderType,
      amountType,
      amount,
      isExpressShipping: expressShippingValue,
      originalOrderNumber: fields.originalOrderNumber ? String(fields.originalOrderNumber).trim() : null,
      returnReason,
      returnNotes: fields.returnNotes || null,
      isPartialReturn: !!isPartialReturn,
      originalOrderItemCount: fields.originalOrderItemCount || null,
      partialReturnItemCount: fields.partialReturnItemCount || null,
    },
    isOrderAvailableForPreview: !!fields.previewPermission,
    orderNotes: fields.Notes || '',
    referralNumber: fields.referralNumber || '',
    orderStages: {
      orderPlaced: {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order has been created.',
      },
      packed: { isCompleted: false, completedAt: null, notes: '' },
      shipping: { isCompleted: false, completedAt: null, notes: '' },
      inProgress: { isCompleted: false, completedAt: null, notes: '' },
      outForDelivery: { isCompleted: false, completedAt: null, notes: '' },
      delivered: { isCompleted: false, completedAt: null, notes: '' },
      ...(orderType === 'Return' && {
        returnInitiated: {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Return order initiated by business.',
          initiatedBy: 'business',
          reason: returnReason,
        },
        returnAssigned: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          assignedCourier: null,
          assignedBy: null,
        },
        returnPickedUp: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          pickedUpBy: null,
          pickupLocation: null,
          pickupPhotos: [],
        },
        returnAtWarehouse: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          receivedBy: null,
          warehouseLocation: null,
          conditionNotes: '',
        },
        returnInspection: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          inspectedBy: null,
          inspectionResult: null,
          inspectionPhotos: [],
        },
        returnProcessing: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          processedBy: null,
          processingType: null,
        },
        returnToBusiness: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          assignedCourier: null,
          assignedBy: null,
        },
        returnCompleted: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          completedBy: null,
          deliveryLocation: null,
          businessSignature: null,
        },
      }),
      ...(orderType === 'Exchange' && {
        exchangePickup: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          pickedUpBy: null,
          pickupLocation: null,
          originalItemPhotos: [],
        },
      }),
    },
    business: userData._id,
    selectedPickupAddressId: fields.selectedPickupAddressId || null,
  });
}

module.exports = {
  calculateFees,
  generateOrderNumber,
  generateUniqueOrderNumber,
  normalizeFieldsFromBody,
  validateOrderFieldsStructural,
  applyPickupDefaults,
  validatePickupForOrderCreation,
  validateReturnOrderAsync,
  buildReturnPreload,
  buildOrderDocumentFromFields,
};
