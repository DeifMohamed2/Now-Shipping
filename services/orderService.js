const mongoose = require('mongoose');
const Order = require('../models/order');
const firebase = require('../config/firebase');
const statusHelper = require('../utils/statusHelper');
const { calculateOrderFee } = require('../utils/fees');
const { resolveEffectivePricing } = require('../utils/effectivePricing');
const {
  normalizeFieldsFromBody,
  validateOrderFieldsStructural,
  validateAndCanonicalizeGovernmentZone,
  applyPickupDefaults,
  validatePickupForOrderCreation,
  validateReturnOrderAsync,
  buildOrderDocumentFromFields,
  generateUniqueOrderNumber,
} = require('../utils/orderCreationHelper');
const {
  getMetroDeliveryZonesCatalog,
  getMetroDeliveryZonesCatalogWeakEtag,
  normalizeGovKey,
  METRO_GOVERNORATE_KEYS,
} = require('../utils/deliveryZonesBosta');
const { resolvePickupAddressForOrder } = require('../utils/pickupAddressResolve');
const {
  canBusinessCancel,
  canBusinessChangeAddress,
  ADDRESS_EDITABLE_STATUSES,
} = require('../utils/orderUiPolicy');
const { applyBusinessLikeCancellation } = require('../utils/orderCancellationFlow');
const orderWaitingActionPolicy = require('../utils/orderWaitingActionPolicy');
const { renderDeliveryPolicyPdfBuffer } = require('../utils/deliveryPolicyPdf');

const FEE_FIELDS_TO_STRIP = ['orderFees', 'fee', 'amountOfFees', 'shippingFee'];

function stripClientFeeFields(body) {
  if (!body || typeof body !== 'object') return {};
  const copy = { ...body };
  for (const key of FEE_FIELDS_TO_STRIP) {
    delete copy[key];
  }
  return copy;
}

async function findOrderByIdOrNumber(orderId) {
  if (orderId == null || String(orderId).trim() === '') {
    return null;
  }
  const raw = String(orderId).trim();
  let order = null;
  if (mongoose.Types.ObjectId.isValid(raw)) {
    order = await Order.findById(raw);
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: raw });
  }
  return order;
}

async function computeOrderFee(government, orderType, isExpressShipping, business) {
  const pricing = await resolveEffectivePricing(business);
  return calculateOrderFee(government, orderType, isExpressShipping, pricing);
}

/**
 * Create order for a business. Fees are always computed server-side.
 */
async function createOrderForBusiness(business, body) {
  const sanitizedBody = stripClientFeeFields(body);
  const fields = normalizeFieldsFromBody(sanitizedBody);
  applyPickupDefaults(business, fields);

  const structural = validateOrderFieldsStructural(fields);
  if (structural.errors.length) {
    return { ok: false, status: 400, error: structural.errors[0] };
  }

  const zoneVal = validateAndCanonicalizeGovernmentZone(fields);
  if (zoneVal.errors.length) {
    return { ok: false, status: 400, error: zoneVal.errors[0] };
  }

  const pickupVal = validatePickupForOrderCreation(business, fields);
  if (pickupVal.errors.length) {
    return { ok: false, status: 400, error: pickupVal.errors[0] };
  }

  const returnVal = await validateReturnOrderAsync(business._id, fields);
  if (returnVal.errors.length) {
    return { ok: false, status: 400, error: returnVal.errors[0] };
  }

  const orderNumber = await generateUniqueOrderNumber();
  const newOrder = await buildOrderDocumentFromFields(business, fields, orderNumber);
  const savedOrder = await newOrder.save();

  return {
    ok: true,
    status: 201,
    order: savedOrder,
    message: 'Order created successfully.',
  };
}

/**
 * Update order for a business. Fees are recomputed server-side.
 */
async function updateOrderForBusiness(business, orderId, body) {
  const sanitizedBody = stripClientFeeFields(body);
  const {
    fullName,
    phoneNumber,
    otherPhoneNumber,
    address,
    buildingNo,
    apartmentNo,
    government,
    zone,
    deliverToWorkAddress,
    orderType,
    productDescription,
    numberOfItems,
    COD,
    amountCOD,
    currentPD,
    numberOfItemsCurrentPD,
    newPD,
    numberOfItemsNewPD,
    CashDifference,
    amountCashDifference,
    previewPermission,
    referralNumber,
    Notes,
    isExpressShipping,
  } = sanitizedBody;

  const order = await findOrderByIdOrNumber(orderId);
  if (!order) {
    return { ok: false, status: 404, error: 'Order not found' };
  }

  if (order.business.toString() !== business._id.toString()) {
    return { ok: false, status: 403, error: 'You do not have permission to edit this order' };
  }

  if (!canBusinessChangeAddress(order)) {
    return {
      ok: false,
      status: 403,
      error:
        'Address and order details cannot be edited — a courier may already be assigned, or this order is past the editable stage.',
      meta: {
        orderStatus: order.orderStatus,
        allowedStatuses: Array.from(ADDRESS_EDITABLE_STATUSES),
        courierAssigned: Boolean(order.deliveryMan),
      },
    };
  }

  const updatedOrderType = orderType || order.orderShipping.orderType;

  if (!fullName || !phoneNumber || !address || !government || !zone) {
    return { ok: false, status: 400, error: 'All customer info fields are required' };
  }

  const zoneFields = { government, zone };
  const zoneVal = validateAndCanonicalizeGovernmentZone(zoneFields);
  if (zoneVal.errors.length) {
    return { ok: false, status: 400, error: zoneVal.errors[0] };
  }
  const canonicalGovernment = zoneFields.government;
  const canonicalZone = zoneFields.zone;

  const orderCreationTime = new Date(order.createdAt).getTime();
  const currentTime = new Date().getTime();
  const sixHoursInMs = 6 * 60 * 60 * 1000;
  const isOrderOlderThanSixHours = currentTime - orderCreationTime > sixHoursInMs;

  const requestedExpressShipping =
    isExpressShipping === true || isExpressShipping === 'true' || isExpressShipping === 'on';
  const currentExpressShipping = order.orderShipping.isExpressShipping;

  if (isOrderOlderThanSixHours && requestedExpressShipping !== currentExpressShipping) {
    return {
      ok: false,
      status: 403,
      error: 'Express shipping option cannot be changed for orders older than 6 hours.',
      meta: { orderAge: 'old' },
    };
  }

  const expressShippingValue = requestedExpressShipping;
  const calculatedOrderFees = await computeOrderFee(
    canonicalGovernment,
    updatedOrderType,
    expressShippingValue,
    business
  );

  let amountFromConditions = 0;
  let amountType = 'NA';

  if (COD === 'on' || COD === true) {
    amountType = 'COD';
    amountFromConditions = parseFloat(amountCOD) || 0;
  } else if (CashDifference === 'on' || CashDifference === true) {
    amountType = 'CD';
    amountFromConditions = parseFloat(amountCashDifference) || 0;
  }

  const updatedOrder = await Order.findByIdAndUpdate(
    order._id,
    {
      orderCustomer: {
        fullName,
        phoneNumber,
        otherPhoneNumber: otherPhoneNumber || null,
        address,
        buildingNo: buildingNo != null && String(buildingNo).trim() !== '' ? String(buildingNo).trim() : null,
        apartmentNo:
          apartmentNo != null && String(apartmentNo).trim() !== '' ? String(apartmentNo).trim() : null,
        government: canonicalGovernment,
        zone: canonicalZone,
        deliverToWorkAddress: deliverToWorkAddress === 'on' || deliverToWorkAddress === true,
      },
      orderFees: calculatedOrderFees ? Number(calculatedOrderFees) : 120,
      orderShipping: {
        productDescription: productDescription || currentPD || '',
        numberOfItems: numberOfItems || numberOfItemsCurrentPD || 0,
        productDescriptionReplacement: newPD || '',
        numberOfItemsReplacement: numberOfItemsNewPD || 0,
        orderType: updatedOrderType,
        amountType,
        amount: amountFromConditions,
        isExpressShipping: expressShippingValue,
      },
      isOrderAvailableForPreview: previewPermission === 'on',
      orderNotes: Notes || '',
      referralNumber: referralNumber || '',
    },
    { new: true }
  );

  if (!updatedOrder) {
    return { ok: false, status: 404, error: 'Order not found.' };
  }

  return { ok: true, status: 200, order: updatedOrder, message: 'Order updated successfully.' };
}

async function cancelOrderForBusiness(business, orderId) {
  const order = await findOrderByIdOrNumber(orderId);
  if (!order) {
    return { ok: false, status: 404, error: 'Order not found' };
  }

  if (order.business.toString() !== business._id.toString()) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (!canBusinessCancel(order)) {
    return {
      ok: false,
      status: 400,
      error: 'This order cannot be canceled from its current status.',
      meta: {
        currentStatus: order.orderStatus,
        statusLabel: statusHelper.getOrderStatusLabel(order.orderStatus),
      },
    };
  }

  const cancelOutcome = applyBusinessLikeCancellation(order, { canceledBy: 'business' });
  if (cancelOutcome.result === 'already_in_return') {
    return { ok: false, status: 400, error: cancelOutcome.message };
  }
  order.$locals = order.$locals || {};
  order.$locals.nextStatusHistoryNote = cancelOutcome.message;
  await order.save();

  if (cancelOutcome.notifyCourier && order.deliveryMan) {
    try {
      const reason =
        cancelOutcome.result === 'exchange_cancel'
          ? 'Exchange order canceled by business'
          : 'Order canceled by business before pickup';
      await firebase.sendOrderStatusNotification(order.deliveryMan, order.orderNumber, 'canceled', {
        cancelledBy: 'Business',
        cancelledAt: new Date(),
        reason,
      });
    } catch (notificationError) {
      console.error(
        `Failed to send push notification to courier ${order.deliveryMan}:`,
        notificationError
      );
    }
  }

  return { ok: true, status: 200, message: cancelOutcome.message };
}

async function deleteOrderForBusiness(business, orderId) {
  const order = await findOrderByIdOrNumber(orderId);
  if (!order) {
    return { ok: false, status: 404, error: 'Order not found' };
  }

  if (order.business.toString() !== business._id.toString()) {
    return { ok: false, status: 403, error: 'You do not have permission to delete this order' };
  }

  if (order.orderStatus !== 'new') {
    return {
      ok: false,
      status: 400,
      error: 'This order can no longer be deleted — it has already been processed.',
      meta: { currentStatus: order.orderStatus },
    };
  }

  await order.deleteOne();
  return { ok: true, status: 200, message: 'Order deleted successfully.' };
}

async function listOrdersForBusiness(business, query = {}) {
  const {
    page = 1,
    limit = 50,
    orderType,
    status,
    statusCategory,
    paymentType,
    dateFrom,
    dateTo,
    search,
  } = query;

  const mongoQuery = { business: business._id };

  if (orderType && orderType !== 'All') {
    mongoQuery['orderShipping.orderType'] = orderType;
  }
  if (status && status !== 'All') {
    mongoQuery.orderStatus = status;
  }
  if (statusCategory && statusCategory !== 'All') {
    mongoQuery.statusCategory = statusCategory;
  }
  if (paymentType && paymentType !== 'All') {
    mongoQuery['orderShipping.amountType'] = paymentType;
  }
  if (dateFrom || dateTo) {
    mongoQuery.orderDate = {};
    if (dateFrom) mongoQuery.orderDate.$gte = new Date(dateFrom);
    if (dateTo) mongoQuery.orderDate.$lte = new Date(dateTo);
  }
  if (search && search.trim() !== '') {
    const searchRegex = new RegExp(search.trim(), 'i');
    mongoQuery.$or = [
      { orderNumber: searchRegex },
      { 'orderCustomer.fullName': searchRegex },
      { 'orderCustomer.phoneNumber': searchRegex },
      { 'orderShipping.productDescription': searchRegex },
      { 'orderShipping.productDescriptionReplacement': searchRegex },
    ];
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitNum = parseInt(limit, 10);

  const orders = await Order.find(mongoQuery)
    .sort({ orderDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(limitNum);
  const totalCount = await Order.countDocuments(mongoQuery);

  const enhancedOrders = orders.map((order) => {
    const orderObj = order.toObject();
    orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
    orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
    orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
    orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
    orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
    orderObj.canCancel = canBusinessCancel(order);
    orderObj.canEditAddress = canBusinessChangeAddress(order);
    orderObj.canDelete = order.orderStatus === 'new';
    return orderObj;
  });

  return {
    orders: enhancedOrders,
    pagination: {
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(totalCount / limitNum),
      totalCount,
      hasNext: skip + orders.length < totalCount,
      hasPrev: parseInt(page, 10) > 1,
    },
  };
}

async function getOrderDetailsForBusiness(business, orderNumber) {
  const order = await Order.findOne({ orderNumber, business: business._id })
    .populate('deliveryMan', 'name phone email')
    .populate({
      path: 'courierHistory.courier',
      model: 'courier',
      select: 'name phone email',
    })
    .populate('business', 'name email phone brandInfo pickUpAddresses');

  if (!order) {
    return { ok: false, status: 404, error: 'Order not found' };
  }

  const orderObj = order.toObject();
  orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
  orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
  orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
  orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
  orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;

  const orderType = order.orderShipping && order.orderShipping.orderType;
  let orderStages;
  if (orderType === 'Exchange') {
    orderStages = [
      'orderPlaced',
      'packed',
      'shipping',
      'inProgress',
      'outForDelivery',
      'exchangePickup',
      'delivered',
      'returnCompleted',
    ];
  } else {
    orderStages = [
      'orderPlaced',
      'packed',
      'shipping',
      'inProgress',
      'outForDelivery',
      'delivered',
    ];
  }

  const completedStages = orderStages.filter((stage) => order.orderStages[stage]?.isCompleted).length;
  const progressPercentage = Math.round((completedStages / orderStages.length) * 100);

  const stageTimeline = orderStages.map((stage) => ({
    stage,
    isCompleted: order.orderStages[stage]?.isCompleted || false,
    completedAt: order.orderStages[stage]?.completedAt || null,
    notes: order.orderStages[stage]?.notes || '',
    ...(order.orderStages[stage]?.toObject
      ? order.orderStages[stage].toObject()
      : order.orderStages[stage] || {}),
  }));

  const { address: resolvedPickupAddress, addressId: resolvedPickupAddressId } =
    resolvePickupAddressForOrder(order, order.business);

  const businessForApi =
    orderObj.business && typeof orderObj.business === 'object'
      ? (() => {
          const b = { ...orderObj.business };
          delete b.pickUpAddresses;
          return b;
        })()
      : orderObj.business;

  return {
    ok: true,
    order: {
      _id: orderObj._id,
      orderNumber: orderObj.orderNumber,
      orderDate: orderObj.orderDate,
      completedDate: orderObj.completedDate,
      orderStatus: orderObj.orderStatus,
      statusLabel: orderObj.statusLabel,
      statusDescription: orderObj.statusDescription,
      categoryClass: orderObj.categoryClass,
      categoryColor: orderObj.categoryColor,
      isFastShipping: orderObj.isFastShipping,
      orderCustomer: orderObj.orderCustomer,
      orderShipping: orderObj.orderShipping,
      orderFees: orderObj.orderFees,
      orderNotes: orderObj.orderNotes,
      referralNumber: orderObj.referralNumber,
      isOrderAvailableForPreview: orderObj.isOrderAvailableForPreview,
      deliveryMan: orderObj.deliveryMan,
      courierHistory: orderObj.courierHistory,
      orderStages: orderObj.orderStages,
      progressPercentage,
      stageTimeline,
      business: businessForApi,
      scheduledRetryAt: orderObj.scheduledRetryAt,
      createdAt: orderObj.createdAt,
      updatedAt: orderObj.updatedAt,
      canCancelOrder: canBusinessCancel(order),
      canChangeAddress: canBusinessChangeAddress(order),
      canDelete: order.orderStatus === 'new',
      waitingAction: orderWaitingActionPolicy.getWaitingActionFlags(order),
      selectedPickupAddressId: orderObj.selectedPickupAddressId,
      selectedPickupAddress: resolvedPickupAddress,
      resolvedPickupAddressId,
    },
  };
}

async function calculateOrderFeesForBusiness(business, { government, orderType, isExpressShipping }) {
  if (!government || !orderType) {
    return { ok: false, status: 400, error: 'Government and orderType are required' };
  }
  const govKey = normalizeGovKey(government);
  if (!govKey || !METRO_GOVERNORATE_KEYS.includes(govKey)) {
    return {
      ok: false,
      status: 400,
      error: `Government must be one of: ${METRO_GOVERNORATE_KEYS.join(', ')}.`,
    };
  }
  const express =
    isExpressShipping === 'true' || isExpressShipping === true || isExpressShipping === 'on';
  const fee = await computeOrderFee(govKey, orderType, express, business);
  return { ok: true, fee };
}

function getDeliveryZonesCatalogData(req) {
  const etag = getMetroDeliveryZonesCatalogWeakEtag();
  if (req && req.headers && req.headers['if-none-match'] === etag) {
    return { notModified: true, etag };
  }
  return { notModified: false, etag, catalog: getMetroDeliveryZonesCatalog() };
}

async function generateAwbPdfForBusiness(business, orderNumber, pageSize) {
  const order = await Order.findOne({ orderNumber, business: business._id }).populate('business');
  if (!order) {
    return { ok: false, status: 404, error: 'Order not found' };
  }

  const rawPaper = pageSize || 'A4';
  const pdfBuffer = await renderDeliveryPolicyPdfBuffer(order, rawPaper);

  const orderType = order.orderShipping?.orderType || 'Deliver';
  let filenamePrefix = 'delivery';
  if (orderType === 'Return') filenamePrefix = 'return';
  else if (orderType === 'Exchange') filenamePrefix = 'exchange';

  const awb = order.orderNumber != null ? String(order.orderNumber) : '';
  return {
    ok: true,
    pdfBuffer,
    filename: `${filenamePrefix}-policy-${awb}.pdf`,
    contentType: 'application/pdf',
  };
}

/** Compact order summary for public API list/create responses */
function serializeOrderSummary(order) {
  const o = order.toObject ? order.toObject() : order;
  return {
    orderId: o._id,
    orderNumber: o.orderNumber,
    orderStatus: o.orderStatus,
    statusCategory: o.statusCategory,
    orderFees: o.orderFees,
    orderDate: o.orderDate,
    orderType: o.orderShipping?.orderType,
    isExpressShipping: o.orderShipping?.isExpressShipping,
    amountType: o.orderShipping?.amountType,
    amount: o.orderShipping?.amount,
    customer: {
      fullName: o.orderCustomer?.fullName,
      phoneNumber: o.orderCustomer?.phoneNumber,
      government: o.orderCustomer?.government,
      zone: o.orderCustomer?.zone,
    },
    productDescription: o.orderShipping?.productDescription,
    numberOfItems: o.orderShipping?.numberOfItems,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

module.exports = {
  stripClientFeeFields,
  findOrderByIdOrNumber,
  createOrderForBusiness,
  updateOrderForBusiness,
  cancelOrderForBusiness,
  deleteOrderForBusiness,
  listOrdersForBusiness,
  getOrderDetailsForBusiness,
  calculateOrderFeesForBusiness,
  getDeliveryZonesCatalogData,
  generateAwbPdfForBusiness,
  serializeOrderSummary,
};
