const orderService = require('../services/orderService');
const pickupService = require('../services/pickupService');
const merchantService = require('../services/merchantService');
const { sendApiError } = require('../middleware/apiKeyAuth');

function sendSuccess(res, statusCode, data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.status(statusCode).json(payload);
}

function sendApiErrorWithMeta(res, status, code, message, meta) {
  const body = { success: false, error: { code, message } };
  if (meta) body.error.details = meta;
  return res.status(status).json(body);
}

const ping = (req, res) => {
  const account = req.company || req.userData;
  const payload = {
    message: 'Now Shipping Public API v1',
    account: {
      id: account._id,
      name: account.name,
      brandName: account.brandInfo?.brandName || null,
      businessAccountCode: account.businessAccountCode || null,
      isCompanyAccount: Boolean(req.isCompanyAccount),
    },
    scopes: req.apiKey?.scopes || ['orders', 'pickups'],
    keyPrefix: req.apiKey?.keyPrefix || null,
  };

  if (req.merchant) {
    payload.activeMerchant = {
      id: req.merchant._id,
      businessAccountCode: req.merchant.businessAccountCode || null,
      name: req.merchant.name,
      brandName: req.merchant.brandInfo?.brandName || null,
    };
  }

  return sendSuccess(res, 200, payload);
};

const getDeliveryZones = (req, res) => {
  try {
    const result = orderService.getDeliveryZonesCatalogData(req);
    if (result.notModified) {
      res.setHeader('ETag', result.etag);
      return res.status(304).end();
    }
    res.setHeader('ETag', result.etag);
    return sendSuccess(res, 200, result.catalog);
  } catch (error) {
    console.error('[publicApi] getDeliveryZones:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to load delivery zones.');
  }
};

const calculateFees = (req, res) => {
  try {
    const result = orderService.calculateOrderFeesForBusiness(req.userData, req.body);
    if (!result.ok) {
      return sendApiErrorWithMeta(res, result.status, 'VALIDATION_ERROR', result.error);
    }
    return sendSuccess(res, 200, {
      fee: result.fee,
      currency: 'EGP',
      note: 'Fees are computed by Now Shipping based on zone, order type, and express shipping. Never send fee values when creating orders.',
    });
  } catch (error) {
    console.error('[publicApi] calculateFees:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to calculate fees.');
  }
};

const createOrder = async (req, res) => {
  try {
    const result = await orderService.createOrderForBusiness(req.userData, req.body);
    if (!result.ok) {
      return sendApiErrorWithMeta(res, result.status, 'VALIDATION_ERROR', result.error);
    }
    return sendSuccess(res, result.status, {
      message: result.message,
      order: orderService.serializeOrderSummary(result.order),
    });
  } catch (error) {
    console.error('[publicApi] createOrder:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to create order.');
  }
};

const listOrders = async (req, res) => {
  try {
    const data = await orderService.listOrdersForBusiness(req.userData, req.query);
    return sendSuccess(res, 200, {
      orders: data.orders.map(orderService.serializeOrderSummary),
      pagination: data.pagination,
    });
  } catch (error) {
    console.error('[publicApi] listOrders:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to list orders.');
  }
};

const getOrder = async (req, res) => {
  try {
    const result = await orderService.getOrderDetailsForBusiness(req.userData, req.params.orderNumber);
    if (!result.ok) {
      return sendApiError(res, result.status, 'NOT_FOUND', result.error);
    }
    return sendSuccess(res, 200, { order: result.order });
  } catch (error) {
    console.error('[publicApi] getOrder:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to get order details.');
  }
};

const updateOrder = async (req, res) => {
  try {
    const result = await orderService.updateOrderForBusiness(
      req.userData,
      req.params.orderId,
      req.body
    );
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, {
      message: result.message,
      order: orderService.serializeOrderSummary(result.order),
    });
  } catch (error) {
    console.error('[publicApi] updateOrder:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update order.');
  }
};

const cancelOrder = async (req, res) => {
  try {
    const result = await orderService.cancelOrderForBusiness(req.userData, req.params.orderId);
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, { message: result.message });
  } catch (error) {
    console.error('[publicApi] cancelOrder:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to cancel order.');
  }
};

const deleteOrder = async (req, res) => {
  try {
    const result = await orderService.deleteOrderForBusiness(req.userData, req.params.orderId);
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, { message: result.message });
  } catch (error) {
    console.error('[publicApi] deleteOrder:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to delete order.');
  }
};

const downloadAwb = async (req, res) => {
  try {
    const pageSize = req.query.size || req.query.pageSize || 'A4';
    const result = await orderService.generateAwbPdfForBusiness(
      req.userData,
      req.params.orderNumber,
      pageSize
    );
    if (!result.ok) {
      return sendApiError(res, result.status, 'NOT_FOUND', result.error);
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    return res.end(result.pdfBuffer, 'binary');
  } catch (error) {
    console.error('[publicApi] downloadAwb:', error);
    if (!res.headersSent) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', error.message || 'Failed to generate AWB PDF.');
    }
    return undefined;
  }
};

const listMerchants = async (req, res) => {
  try {
    const data = await merchantService.listMerchantsForCompany(req.company, req.query);
    return sendSuccess(res, 200, data);
  } catch (error) {
    console.error('[publicApi] listMerchants:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to list merchants.');
  }
};

const getMerchant = async (req, res) => {
  try {
    const result = await merchantService.getMerchantForCompany(req.company, req.params.merchantId);
    if (!result.ok) {
      return sendApiError(res, result.status, 'NOT_FOUND', result.error);
    }
    return sendSuccess(res, 200, { merchant: result.merchant });
  } catch (error) {
    console.error('[publicApi] getMerchant:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to get merchant.');
  }
};

const createMerchant = async (req, res) => {
  try {
    const result = await merchantService.createMerchantForCompany(req.company, req.body);
    if (!result.ok) {
      const code = result.code || (result.status === 409 ? 'MERCHANT_ALREADY_EXISTS' : 'VALIDATION_ERROR');
      return sendApiError(res, result.status, code, result.error);
    }
    return sendSuccess(res, 201, {
      message: 'Merchant onboarded successfully.',
      merchant: result.merchant,
    });
  } catch (error) {
    console.error('[publicApi] createMerchant:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to create merchant.');
  }
};

const createPickup = async (req, res) => {
  try {
    const result = await pickupService.createPickupForBusiness(req.userData, req.body);
    if (!result.ok) {
      return sendApiErrorWithMeta(res, result.status, 'VALIDATION_ERROR', result.error, result.meta);
    }
    return sendSuccess(res, result.status, {
      message: result.message,
      pickup: pickupService.serializePickupSummary(result.pickup),
    });
  } catch (error) {
    console.error('[publicApi] createPickup:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to create pickup.');
  }
};

const listPickups = async (req, res) => {
  try {
    const data = await pickupService.listPickupsForBusiness(req.userData, req.query);
    return sendSuccess(res, 200, {
      pickups: data.pickups.map(pickupService.serializePickupSummary),
      pagination: data.pagination,
    });
  } catch (error) {
    console.error('[publicApi] listPickups:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to list pickups.');
  }
};

const getPickup = async (req, res) => {
  try {
    const result = await pickupService.getPickupDetailsForBusiness(
      req.userData,
      req.params.pickupNumber
    );
    if (!result.ok) {
      return sendApiError(res, result.status, 'NOT_FOUND', result.error);
    }
    return sendSuccess(res, 200, {
      pickup: result.pickup,
      selectedPickupAddress: result.selectedPickupAddress,
    });
  } catch (error) {
    console.error('[publicApi] getPickup:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to get pickup details.');
  }
};

const updatePickup = async (req, res) => {
  try {
    const result = await pickupService.updatePickupForBusiness(
      req.userData,
      req.params.pickupNumber,
      req.body
    );
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, {
      message: result.message,
      pickup: pickupService.serializePickupSummary(result.pickup),
    });
  } catch (error) {
    console.error('[publicApi] updatePickup:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update pickup.');
  }
};

const cancelPickup = async (req, res) => {
  try {
    const result = await pickupService.cancelPickupForBusiness(
      req.userData,
      req.params.pickupNumber
    );
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, { message: result.message });
  } catch (error) {
    console.error('[publicApi] cancelPickup:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to cancel pickup.');
  }
};

const deletePickup = async (req, res) => {
  try {
    const result = await pickupService.deletePickupForBusiness(
      req.userData,
      req.params.pickupNumber
    );
    if (!result.ok) {
      const code = result.status === 403 ? 'FORBIDDEN' : result.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      return sendApiErrorWithMeta(res, result.status, code, result.error, result.meta);
    }
    return sendSuccess(res, result.status, { message: result.message });
  } catch (error) {
    console.error('[publicApi] deletePickup:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to delete pickup.');
  }
};

const calculatePickupFee = async (req, res) => {
  try {
    const result = await pickupService.calculatePickupFeeForBusiness(req.userData, req.body);
    return sendSuccess(res, 200, {
      fee: result.fee,
      currency: 'EGP',
      note: 'Pickup fees are computed by Now Shipping. Never send pickupFees in create/update requests.',
    });
  } catch (error) {
    console.error('[publicApi] calculatePickupFee:', error);
    return sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to calculate pickup fee.');
  }
};

module.exports = {
  ping,
  getDeliveryZones,
  calculateFees,
  createOrder,
  listOrders,
  getOrder,
  updateOrder,
  cancelOrder,
  deleteOrder,
  downloadAwb,
  listMerchants,
  getMerchant,
  createMerchant,
  createPickup,
  listPickups,
  getPickup,
  updatePickup,
  cancelPickup,
  deletePickup,
  calculatePickupFee,
};
