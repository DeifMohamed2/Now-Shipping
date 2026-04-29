const Order = require('../models/order');
const Courier = require('../models/courier');
const Pickup = require('../models/pickup');
const User = require('../models/user');
const ShopOrder = require('../models/shopOrder');
const statusHelper = require('../utils/statusHelper');
const { calculatePickupFee } = require('../utils/fees');
const { emailService } = require('../utils/email');
const firebase = require('../config/firebase');
const { sendSms } = require('../utils/sms');
const bcrypt = require('bcrypt');
const { resolvePickupAddressForOrder } = require('../utils/pickupAddressResolve');

/** Business fields needed to resolve default pickup for courier/mobile JSON. */
const BUSINESS_PICKUP_POPULATE_SELECT =
  'businessName email phone address pickUpAddresses brandInfo name';

/**
 * Sets `selectedPickupAddress` and fills `selectedPickupAddressId` when missing
 * (effective id = stored id or business default). Mutates plain object.
 * @param {Record<string, unknown>|null|undefined} orderPlain
 * @param {import('mongoose').Document|object|null|undefined} businessDoc
 */
function attachEffectivePickupToOrderPlain(orderPlain, businessDoc) {
  if (!orderPlain) return;
  const { addressId, address } = resolvePickupAddressForOrder(
    { selectedPickupAddressId: orderPlain.selectedPickupAddressId },
    businessDoc
  );
  orderPlain.selectedPickupAddress = address || null;
  if (addressId) {
    orderPlain.selectedPickupAddressId =
      orderPlain.selectedPickupAddressId || addressId;
  }
  // Do not ship full pickUpAddresses on embedded business — client uses selectedPickupAddress.
  if (
    orderPlain.business &&
    typeof orderPlain.business === 'object' &&
    orderPlain.business.pickUpAddresses
  ) {
    delete orderPlain.business.pickUpAddresses;
  }
}

/** Courier browser UI removed — use mobile app + `/api/v1/courier` (Bearer JWT). */
const respondCourierWebDeprecated = (req, res) => {
  const msg =
    'Courier web portal is discontinued. Use the Now Shipping courier mobile app. API base: /api/v1/courier (Bearer token).';
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(410).json({
      success: false,
      code: 'COURIER_WEB_DEPRECATED',
      message: msg,
    });
  }
  return res.status(410).type('html').send(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Mobile app required</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2.5rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.2rem">Courier access is mobile-only</h1><p>${msg}</p></body></html>`
  );
};

const normalizeCourierLanguage = (language) => {
  const normalized = String(language || '')
    .trim()
    .toLowerCase();
  return normalized === 'ar' || normalized === 'en' ? normalized : null;
};

/** `ordersPickedUp` may be ObjectIds or populated order docs; extract id. */
const pickedListEntryId = (entry) => (entry && entry._id ? entry._id : entry);

function isOrderInPickedUpList(ordersPickedUp, orderId) {
  if (!orderId) return false;
  const want = orderId.toString();
  return (ordersPickedUp || []).some((e) => pickedListEntryId(e).toString() === want);
}

function countUniquePicked(ordersPickedUp) {
  return new Set((ordersPickedUp || []).map((e) => pickedListEntryId(e).toString())).size;
}

/**
 * A physical order can only be on one "live" pickup at a time. Pickups in terminal/unsuccessful
 * states can keep stale refs for history; re‑adding the order to a new run is allowed only then.
 */
const PICKUP_CONFLICT_INACTIVE = ['canceled', 'rejected', 'returned', 'terminated'];

/**
 * @returns {Promise<{ pickupNumber: string }|null>}
 */
async function findOtherActivePickupHoldingOrder(orderId, currentPickupId) {
  if (!orderId) return null;
  return Pickup.findOne({
    _id: { $ne: currentPickupId },
    ordersPickedUp: orderId,
    picikupStatus: { $nin: PICKUP_CONFLICT_INACTIVE },
  })
    .select('pickupNumber')
    .lean();
}

//=============================================== Orders =============================================== //
const get_orders = async (req, res) => {
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    return res.status(401).json({ message: 'Courier ID not found in request' });
  }
  
  const { statusCategory, orderType } = req.query;
  try {
    const terminalOrderStatuses = [
      'completed',
      'canceled',
      'returned',
      'terminated',
      'deliveryFailed',
      'returnCompleted',
    ];

    // Build query with courier ID.
    // Exclude return-pipeline statuses for non-Return orders. True Return-type jobs use GET /returns.
    // Do not exclude returnToBusiness here: Exchange phase 2 (return original to business) keeps
    // orderType "Exchange" with orderStatus returnToBusiness and must appear in this list.
    const query = {
      deliveryMan: courierId,
      'orderShipping.orderType': { $ne: 'Return' },
      orderStatus: {
        $nin: [
          'returnInitiated',
          'returnAssigned',
          'returnPickedUp',
          'returnToWarehouse',
          'returnAtWarehouse',
          'returnInspection',
          'returnProcessing',
          'returnCompleted',
          'returnLinked',
          ...terminalOrderStatuses,
        ],
      },
    };
    
    // Add status category filter if provided
    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      query.statusCategory = statusCategory;
    }
    
    // Add order type filter if provided
    if (orderType && statusHelper.ORDER_TYPES[orderType] && orderType !== 'Return') {
      query['orderShipping.orderType'] = orderType;
    }
    
    const orders = await Order.find(query)
      .populate('deliveryMan')
      .populate('business')
      .exec();
      
    // Enhance orders with status information
    const enhancedOrders = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
      orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
      orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
      orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
      orderObj.nextPossibleStatuses = statusHelper.getNextPossibleStatuses(order.orderStatus);
      
      // Add order type specific information
      if (order.orderShipping.orderType === 'Exchange') {
        orderObj.isExchange = true;
        orderObj.exchangeDetails = {
          originalProduct: order.orderShipping.productDescription,
          originalCount: order.orderShipping.numberOfItems,
          replacementProduct: order.orderShipping.productDescriptionReplacement,
          replacementCount: order.orderShipping.numberOfItemsReplacement
        };
      }
      
      return orderObj;
    });
    
    res.status(200).json(enhancedOrders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Enhanced function to get return orders with comprehensive details
const get_returns = async (req, res) => {
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    return res.status(401).json({ message: 'Courier ID not found in request' });
  }
  
  const { status, page = 1, limit = 10 } = req.query;

  try {
    const hiddenReturnStatuses = [
      'returnCompleted',
      'completed',
      'returned',
      'canceled',
      'terminated',
      'deliveryFailed',
    ];

    const query = {
      deliveryMan: courierId,
      'orderShipping.orderType': 'Return',
    };

    // Add status filter if provided
    if (status && status !== 'all') {
      if (hiddenReturnStatuses.includes(status)) {
        return res.status(200).json({
          orders: [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: 0,
            totalCount: 0,
            hasNext: false,
            hasPrev: false,
          },
        });
      }
      query.orderStatus = status;
    } else {
      // Default to active return statuses
      query.orderStatus = {
        $in: [
          'returnAssigned',
          'returnPickedUp',
          'returnInspection',
          'returnToWarehouse',
          'returnToBusiness',
        ],
      };
    }

    // Never return terminal statuses in courier returns list (even for status=all).
    if (status === 'all') {
      query.orderStatus = { $nin: hiddenReturnStatuses };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .populate('deliveryMan', 'name phone email')
      .populate('business', 'brandInfo.brandName email phone')
      .populate(
        'orderShipping.linkedDeliverOrder',
        'orderNumber orderStatus orderCustomer'
      )
      .sort({ orderDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .exec();
    const totalCount = await Order.countDocuments(query);

    // Add progress calculation for each order
    const ordersWithProgress = orders.map((order) => {
      const returnStages = [
        'returnInitiated',
        'returnAssigned',
        'returnPickedUp',
        'returnToWarehouse',
        'returnAtWarehouse',
        'returnInspection',
        'returnProcessing',
        'returnToBusiness',
        'returnCompleted',
      ];

      const completedStages = returnStages.filter(
        (stage) => order.orderStages[stage]?.isCompleted
      ).length;

      const progressPercentage = Math.round(
        (completedStages / returnStages.length) * 100
      );

      return {
        ...order.toObject(),
        progressPercentage,
        currentStage: getCurrentReturnStage(order.orderStatus),
        nextAction: getNextReturnAction(order.orderStatus),
        // Include partial return information for display
        isPartialReturn: order.orderShipping.isPartialReturn,
        partialReturnInfo: order.orderShipping.isPartialReturn ? {
          originalItemCount: order.orderShipping.originalOrderItemCount,
          partialReturnItemCount: order.orderShipping.partialReturnItemCount,
        } : null
      };
    });
    return res.status(200).json({
      orders: ordersWithProgress,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + orders.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
   return res.status(500).json({ message: error.message });
  }
};

// Helper function to get current return stage
const getCurrentReturnStage = (status) => {
  const stageMap = {
    returnAssigned: 'Assigned for Pickup',
    returnPickedUp: 'Picked Up from Customer',
    returnAtWarehouse: 'At Warehouse',
    returnToBusiness: 'Assigned for Delivery to Business',
    returnCompleted: 'Completed',
  };
  return stageMap[status] || 'Unknown';
};

// Helper function to get next return action
const getNextReturnAction = (status) => {
  const actionMap = {
    returnAssigned: 'Pick up from customer',
    returnPickedUp: 'Deliver to warehouse',
    returnAtWarehouse: 'Wait for processing',
    returnToBusiness: 'Deliver to business',
    returnCompleted: 'Completed',
  };
  return actionMap[status] || 'Unknown';
};

// Get detailed return order information for courier
const getReturnOrderDetails = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }

  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
      'orderShipping.orderType': 'Return',
    })
      .populate('deliveryMan', 'name phone email')
      .populate('business', BUSINESS_PICKUP_POPULATE_SELECT)
      .populate(
        'orderShipping.linkedDeliverOrder',
        'orderNumber orderStatus orderCustomer'
      );

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Return order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Calculate progress percentage
    const returnStages = [
      'returnInitiated',
      'returnAssigned',
      'returnPickedUp',
      'returnAtWarehouse',
      'returnInspection',
      'returnProcessing',
      'returnToBusiness',
      'returnCompleted',
    ];

    const completedStages = returnStages.filter(
      (stage) => order.orderStages[stage]?.isCompleted
    ).length;

    const progressPercentage = Math.round(
      (completedStages / returnStages.length) * 100
    );

    // Get stage timeline
    const stageTimeline = returnStages.map((stage) => ({
      stage,
      isCompleted: order.orderStages[stage]?.isCompleted || false,
      completedAt: order.orderStages[stage]?.completedAt || null,
      notes: order.orderStages[stage]?.notes || '',
      ...order.orderStages[stage]?.toObject(),
    }));

    const orderPlain = order.toObject();
    if (orderPlain.returnOtp && orderPlain.returnOtp.otpHash) {
      delete orderPlain.returnOtp.otpHash;
    }
    attachEffectivePickupToOrderPlain(orderPlain, order.business);

    const responseData = {
      order: orderPlain,
      progressPercentage,
      stageTimeline,
      currentStage: getCurrentReturnStage(order.orderStatus),
      nextAction: getNextReturnAction(order.orderStatus),
      feeBreakdown: order.feeBreakdown,
      // OTP metadata for mobile app — never expose otpHash
      returnOtpInfo: order.orderStatus === 'returnAssigned' ? {
        otpRequired: !!(order.returnOtp?.otpHash && order.returnOtp?.issuedAt),
        otpIssuedAt: order.returnOtp?.issuedAt || null,
        otpExpiresAt: order.returnOtp?.expiresAt || null,
        otpVerified: !!(order.returnOtp?.verifiedAt),
        isLegacy: !(order.returnOtp?.otpHash),
      } : null,
    };

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json(responseData);
    }
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.error('Error fetching return order details:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

const get_orderDetails= async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
    })
      .populate('deliveryMan')
      .populate('business')
      .exec();
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    
    const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
      order,
      order.business
    );

    // Enhance order with partial return information
    const enhancedOrder = {
      ...order.toObject(),
      isPartialReturn: order.orderShipping.isPartialReturn,
      partialReturnInfo: order.orderShipping.isPartialReturn ? {
        originalItemCount: order.orderShipping.originalOrderItemCount,
        partialReturnItemCount: order.orderShipping.partialReturnItemCount,
        partialReturnDescription: order.orderShipping.partialReturnDescription,
        remainingItemsDescription: order.orderShipping.remainingItemsDescription
      } : null
    };
    attachEffectivePickupToOrderPlain(enhancedOrder, order.business);
    if (enhancedOrder.returnOtp && enhancedOrder.returnOtp.otpHash) {
      delete enhancedOrder.returnOtp.otpHash;
    }
    if (enhancedOrder.deliveryOtp && enhancedOrder.deliveryOtp.otpHash) {
      delete enhancedOrder.deliveryOtp.otpHash;
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({
        order: enhancedOrder,
        selectedPickupAddress: selectedPickupAddress || enhancedOrder.selectedPickupAddress,
      });
    }
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

const fullInitiationReturn = async (order, status) => {
  try {
    order.Attemps += 1;

    // Transition failed delivery into return pipeline
    const previousStatus = order.orderStatus;
    order.orderStatus = 'returnToWarehouse';

    // Record status change in history
    order.orderStatusHistory.push({
      status: 'returnToWarehouse',
      date: new Date(),
      notes: `Order ${
        status === 'rejected' ? 'refused by customer at delivery' : 'failed delivery'
      }, initiating return process.`,
      reason: status,
    });

    // Initialize return stages if not already
    if (
      !order.orderStages.returnInitiated ||
      !order.orderStages.returnInitiated.isCompleted
    ) {
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: `Return initiated due to ${
          status === 'rejected'
            ? 'customer refusal at delivery'
            : 'failed delivery attempts'
        }`,
        initiatedBy: 'system',
        reason: status === 'rejected' ? 'customer_rejection' : 'delivery_failed',
        previousStatus: previousStatus,
      };
    }

    // If order has a courier assigned, preserve the assignment and mark return stages as completed
    if (order.deliveryMan) {
      // IMPORTANT: Keep the deliveryMan field intact - don't clear it
      // The courier should remain assigned for the return process

      // Add courier to history for return process
      order.courierHistory.push({
        courier: order.deliveryMan,
        assignedAt: new Date(),
        action: 'assigned',
        notes: `Same courier kept assigned for the return after ${status === 'rejected' ? 'customer refusal' : 'failed delivery'}`,
      });

      // Mark return assigned as completed (same courier)
      order.orderStages.returnAssigned = {
        isCompleted: true,
        completedAt: new Date(),
        notes:
          'Same courier assigned for return (preserved from original delivery)',
        courier: order.deliveryMan,
        autoAssigned: true,
      };

      // Mark return picked up as completed (courier already has the order)
      order.orderStages.returnPickedUp = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return picked up (courier already has the order from delivery)',
        courier: order.deliveryMan,
        pickupLocation: order.orderCustomer.address,
        returnReason:
          status === 'rejected' ? 'Customer refused delivery' : 'Failed delivery',
      };
    } else {
      // SAFETY CHECK: If order has stages completed but no courier assigned, log this issue
      console.warn(
        `Order ${order.orderNumber} has completed stages but no courier assigned:`,
        {
          orderStages: order.orderStages,
          status: status,
        }
      );

      // Initialize return stages without courier (admin will need to assign)
      order.orderStages.returnAssigned = {
        isCompleted: false,
        completedAt: null,
        notes: 'No courier assigned - admin needs to assign courier for return',
        courier: null,
        returnReason:
          status === 'rejected' ? 'Customer refused delivery' : 'Failed delivery',
      };

      order.orderStages.returnPickedUp = {
        isCompleted: false,
        completedAt: null,
        notes: 'Return pickup pending - courier assignment required',
        courier: null,
      };
    }

    // Reset forward delivery stages
    order.orderStages.outForDelivery.isCompleted = false;
    order.orderStages.inProgress.isCompleted = false;

    // Update order shipping info to reflect return status
    order.orderShipping.orderType = 'Return';
    order.orderShipping.originalOrderNumber = order.orderNumber;
    order.orderShipping.returnInitiatedAt = new Date();
    order.orderShipping.returnReason =
      status === 'rejected' ? 'Customer refused delivery' : 'Failed delivery attempts';

    // Update any scheduled delivery times
    order.scheduledRetryAt = null;

    // Save the order with all changes
    await order.save();

    console.log(
      `Return process initiated for order ${order.orderNumber} due to ${status}`
    );

    // Notify relevant parties if notification system exists
    // This would be implemented based on your notification system
  } catch (error) {
    console.error(
      `Error initiating return for order ${order?.orderNumber}:`,
      error
    );
    throw error; // Rethrow to allow the caller to handle it
  }
};

const updateOrderStatus = async (req, res) => {
  const { orderNumber } = req.params;
  const { status, reason } = req.body || {};
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
    })
      .populate('deliveryMan')
      .populate('business', 'name brandInfo email phoneNumber')
      .exec();

    // Cache brand name before save() depopulates business
    const businessBrandName = order?.business?.brandInfo?.brandName || order?.business?.name || 'NowShipping';

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    // Check if order status allows actions
    if (
      [
        'completed',
        'canceled',
        'rejected',
        'returned',
        'terminated',
        'returnCompleted',
        'new',
        'pickedUp',
        'inStock',
        'inReturnStock',
        'returnAssigned',
        'returnPickedUp',
        'returnAtWarehouse',
        'returnToBusiness'
      ].includes(order.orderStatus)
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status '${order.orderStatus}' does not allow status updates`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }
    if (status === 'Unavailable' && reason) {
      order.Attemps += 1;
      order.UnavailableReason.push(reason);
      if (order.Attemps >= 2) {
        // After 2 failed attempts, initiate full return process
        await fullInitiationReturn(order, status);
      } else {
        order.orderStatus = 'waitingAction';
        // Update inProgress stage for waiting action - fix object access
        if (!order.orderStages.inProgress.isCompleted) {
          order.orderStages.inProgress.isCompleted = true;
          order.orderStages.inProgress.completedAt = new Date();
          const r = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 240) : '';
          order.orderStages.inProgress.notes = r
            ? `Delivery attempt failed (${r})`
            : 'Delivery attempt failed';
        }
        order.orderStages.outForDelivery.isCompleted = false;
        // Do not set scheduledRetryAt here — that implies the business confirmed a retry.
        // The business sets the retry time via "Retry tomorrow" or "Schedule retry".
      }
      await order.save();

      // Send push notification to business about order status change
      try {
        await firebase.sendOrderStatusNotification(
          order.business._id,
          order.orderNumber,
          order.orderStatus,
          {
            courierName: order.deliveryMan.name,
            reason: reason,
            attempts: order.Attemps,
            updatedAt: new Date()
          }
        );
        console.log(`📱 Push notification sent to business ${order.business._id} about order ${order.orderNumber} status change to ${order.orderStatus}`);
      } catch (notificationError) {
        console.error(`❌ Failed to send push notification to business ${order.business._id}:`, notificationError);
        // Don't fail the status update if notification fails
      }
    } else if (status === 'rejected') {
      // Customer refused at delivery — initiate full return process
      await fullInitiationReturn(order, status);

      // Send push notification to business (customer refused at delivery)
      try {
        await firebase.sendOrderStatusNotification(
          order.business._id,
          order.orderNumber,
          'rejected',
          {
            courierName: order.deliveryMan.name,
            reason: reason || 'Customer refused delivery',
            updatedAt: new Date()
          }
        );
        console.log(`📱 Push notification sent to business ${order.business._id} about order ${order.orderNumber} (customer refused)`);
      } catch (notificationError) {
        console.error(`❌ Failed to send push notification to business ${order.business._id}:`, notificationError);
        // Don't fail the status update if notification fails
      }
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Order status updated successfully' });
    }
    
    // For web requests, redirect back to order details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

/**
 * Complete an order with proper status transition
 */
const completeOrder = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  
  const { exchangePhotos, otp } = req.body || {}; // Parameters for Exchange and OTP
  
  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
    }).populate('deliveryMan');
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Check if order can be completed based on status
    if (
      [
        'completed',
        'canceled',
        'rejected',
        'returned',
        'terminated',
        'returnCompleted',
        'new',
        'pickedUp',
        'inStock',
        'inReturnStock',
        'returnAssigned',
        'returnPickedUp',
        'returnAtWarehouse',
      ].includes(order.orderStatus)
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status '${order.orderStatus}' does not allow completion`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (
      order.orderStatus === 'returnToBusiness' &&
      order.orderShipping.orderType !== 'Exchange'
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message:
            'Use the Returns page “Complete Return” action for this return delivery.',
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // For regular deliveries
    if (
      ![
        'inStock',
        'headingToCustomer',
        'headingToYou',
        'returnToBusiness',
        'rescheduled',
        'waitingAction',
      ].includes(order.orderStatus)
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for completion`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // OTP Validation for orders heading to customer (not return / exchange-return flows)
    const isReturnFlow =
      order.orderStatus === 'headingToYou' ||
      (order.orderShipping.orderType === 'Exchange' &&
        order.orderStatus === 'returnToBusiness');
    if (!isReturnFlow && order.orderStatus === 'headingToCustomer') {
      // Check if OTP exists and is valid
      if (!order.deliveryOtp || !order.deliveryOtp.otpHash || !order.deliveryOtp.expiresAt) {
        return res.status(400).json({ message: 'Delivery OTP not generated. Please contact support.' });
      }
      if (new Date(order.deliveryOtp.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ message: 'OTP expired. Please contact support to resend.' });
      }
      if (!otp) {
        return res.status(400).json({ message: 'OTP is required to complete this order' });
      }
      const ok = await bcrypt.compare(String(otp), order.deliveryOtp.otpHash);
      if (!ok) {
        order.deliveryOtp.attempts = (order.deliveryOtp.attempts || 0) + 1;
        await order.save();
        return res.status(400).json({ message: 'Invalid OTP. Please try again.' });
      }
      order.deliveryOtp.verifiedAt = new Date();
    }

    // Handle different completion types based on order type and status
    const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

    if (order.orderStatus === 'headingToYou') {
      // This is returning an order to the business
      order.orderStatus = 'returnCompleted';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.completedDate = new Date();
      
      // Increment attempts but ensure it doesn't exceed 2
      if (order.Attemps < 2) {
        order.Attemps += 1;
      }
      
      // Update delivered stage for return completion
      if (!order.orderStages.delivered.isCompleted) {
        order.orderStages.delivered.isCompleted = true;
        order.orderStages.delivered.completedAt = new Date();
        order.orderStages.delivered.notes = `Return delivered to business by courier ${courierName}`;
      }

      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'delivered_to_business',
        notes: `Courier ${courierName} delivered return to business`,
      });
    } else if (order.orderShipping.orderType === 'Exchange' && order.orderStatus === 'headingToCustomer') {
      // Phase 1: replacement delivered + original collected at customer → return stock
      order.orderStatus = 'inReturnStock';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;

      if (order.orderStages.exchangePickup) {
        order.orderStages.exchangePickup.isCompleted = true;
        order.orderStages.exchangePickup.completedAt = new Date();
        order.orderStages.exchangePickup.notes = `Replacement delivered and original item collected by courier ${courierName}`;
        order.orderStages.exchangePickup.pickedUpBy = courierId;
        order.orderStages.exchangePickup.pickupLocation = order.orderCustomer.address;
        if (exchangePhotos && Array.isArray(exchangePhotos)) {
          order.orderStages.exchangePickup.originalItemPhotos = exchangePhotos;
        }
      }

      if (!order.orderStages.outForDelivery.isCompleted) {
        order.orderStages.outForDelivery.isCompleted = true;
        order.orderStages.outForDelivery.completedAt = new Date();
        order.orderStages.outForDelivery.notes = `Courier ${courierName} completed exchange at customer`;
      }

      if (!order.orderStages.delivered.isCompleted) {
        order.orderStages.delivered.isCompleted = true;
        order.orderStages.delivered.completedAt = new Date();
        order.orderStages.delivered.notes = `Replacement delivered to customer by courier ${courierName} (exchange)`;
      }

      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'exchange_pickup',
        notes: `Courier ${courierName} delivered replacement and collected original item; order in return stock`,
      });

      // Phase 1 courier is done; admin assigns a (possibly different) courier for return-to-business
      order.deliveryMan = null;
    } else if (order.orderShipping.orderType === 'Exchange' && order.orderStatus === 'returnToBusiness') {
      // Phase 2: original item returned to business — full exchange order complete
      order.orderStatus = 'completed';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.scheduledRetryAt = null;
      order.completedDate = new Date();

      if (order.Attemps < 2) {
        order.Attemps += 1;
      }

      if (!order.orderStages.returnCompleted || !order.orderStages.returnCompleted.isCompleted) {
        order.orderStages.returnCompleted = {
          isCompleted: true,
          completedAt: new Date(),
          notes: `Exchange return leg completed at business by courier ${courierName}`,
          completedBy: courierId,
          deliveryLocation: order.business?.address || null,
          businessSignature: null,
        };
      }

      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'delivered_to_business',
        notes: `Courier ${courierName} returned original item to business (exchange complete)`,
      });
    } else {
      // Regular delivery completion
      order.orderStatus = 'completed';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.scheduledRetryAt = null;
      order.completedDate = new Date();
      
      // Increment attempts but ensure it doesn't exceed 2
      if (order.Attemps < 2) {
        order.Attemps += 1;
      }
      // Update delivered stage for completion
      if (!order.orderStages.delivered.isCompleted) {
        order.orderStages.delivered.isCompleted = true;
        order.orderStages.delivered.completedAt = new Date();
        order.orderStages.delivered.notes = `Order completed by courier ${courierName}`;
        // Mark all other order stages as completed
        if (!order.orderStages.orderPlaced.isCompleted) {
          order.orderStages.orderPlaced.isCompleted = true;
        }

        if (!order.orderStages.packed.isCompleted) {
          order.orderStages.packed.isCompleted = true;
        }

        if (!order.orderStages.shipping.isCompleted) {
          order.orderStages.shipping.isCompleted = true;
        }

        if (!order.orderStages.inProgress.isCompleted) {
          order.orderStages.inProgress.isCompleted = true;
        }
        if (!order.orderStages.outForDelivery.isCompleted) {
          order.orderStages.outForDelivery.isCompleted = true;
        }
      }

      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'completed',
        notes: `Courier ${courierName} completed delivery to customer`,
      });
    }

    await order.save();

    const business = await User.findById(order.business).select('email brandInfo name');
    const businessBrandName =
      business?.brandInfo?.brandName || business?.name || 'NowShipping';

    // Exchange phase 1: customer WhatsApp + business heads-up (no duplicate "delivered" spam)
    if (
      order.orderShipping?.orderType === 'Exchange' &&
      order.orderStatus === 'inReturnStock'
    ) {
      try {
        const { sendExchangePickupNotification } = require('../utils/whatsapp');
        sendExchangePickupNotification(order)
          .catch((e) =>
            console.error(`WhatsApp exchange pickup error for ${order.orderNumber}:`, e.message)
          );
      } catch (e) {
        console.error(`Exchange pickup notification load error:`, e.message);
      }
      try {
        if (business?.email) {
          await emailService.sendEmail({
            email: business.email,
            subject: `Exchange: item collected at customer — ${order.orderNumber}`,
            html: `<p>Order <strong>${order.orderNumber}</strong> (Exchange): the courier delivered the replacement and collected the original item at the customer.</p><p>The original item is in <strong>return stock</strong>. Assign a courier from Stock Returns to return it to your business.</p>`,
          });
          console.log(
            `📧 Exchange phase-1 email sent to business ${business._id} for order ${order.orderNumber}`
          );
        }
      } catch (emailError) {
        console.error(
          `❌ Failed to send exchange phase-1 email for order ${order.orderNumber}:`,
          emailError
        );
      }
    }

    // SMS to customer only when order is fully completed
    if (order.orderStatus === 'completed') {
      try {
        const phone = order.orderCustomer?.phoneNumber;
        if (phone) {
          await sendSms({
            recipient: phone,
            message: `NowShipping - ${businessBrandName}: Your order ${order.orderNumber} has been delivered by ${courierName}. Thank you!`,
          });
        }
      } catch (e) {
        console.error(`SMS completion error for ${order.orderNumber}:`, e.details || e.message);
      }
    }

    // Business "order delivered" email + push only on full completion (fixes Exchange multi-tap spam)
    if (order.orderStatus === 'completed') {
      try {
        if (business && business.email) {
          const orderData = {
            orderNumber: order.orderNumber,
            orderId: order._id,
            customerName: order.orderCustomer?.fullName || 'N/A',
            orderType: order.orderShipping?.orderType || 'Standard',
            amount: order.orderShipping?.amount || 0,
            deliveryDate: order.completedDate,
            courierName: courierName,
            status: order.orderStatus,
          };

          await emailService.sendOrderDeliveryNotification(orderData, business.email);
          console.log(
            `📧 Order delivery notification sent to business ${business._id} for order ${order.orderNumber}`
          );
        }
      } catch (emailError) {
        console.error(
          `❌ Failed to send order delivery email for order ${order.orderNumber}:`,
          emailError
        );
      }

      try {
        await firebase.sendOrderStatusNotification(
          order.business,
          order.orderNumber,
          'completed',
          {
            courierName: courierName,
            completedAt: order.completedDate,
            orderType: order.orderShipping?.orderType || 'Standard',
          }
        );
        console.log(
          `📱 Push notification sent to business ${order.business} about order ${order.orderNumber} completion`
        );
      } catch (notificationError) {
        console.error(
          `❌ Failed to send push notification for order ${order.orderNumber}:`,
          notificationError
        );
      }
    } else if (order.orderStatus === 'returnCompleted') {
      try {
        await firebase.sendOrderStatusNotification(
          order.business,
          order.orderNumber,
          'returnCompleted',
          {
            courierName: courierName,
            completedAt: order.completedDate,
            orderType: order.orderShipping?.orderType || 'Standard',
          }
        );
        console.log(
          `📱 Push notification sent to business ${order.business} about return completion for order ${order.orderNumber}`
        );
      } catch (notificationError) {
        console.error(
          `❌ Failed to send push notification for return completion ${order.orderNumber}:`,
          notificationError
        );
      }
    }
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Order completed successfully' });
    }
    
    // For web requests, redirect back to order details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};


const pickupReturn = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  
  const {
    notes,
    pickupLocation,
    pickupPhotos,
    customerSignature,
    returnCondition,
    returnValue,
    otp,
  } = req.body || {};

  try {
    // Try multiple lookup strategies to find the return order:
    // 1. By the return order's own orderNumber
    // 2. By originalOrderNumber field
    // 3. By smartFlyerBarcode of the original deliver order
    let order = await Order.findOne({
      orderNumber: orderNumber,
      'orderShipping.orderType': 'Return',
      orderStatus: 'returnAssigned',
      deliveryMan: courierId,
    });

    if (!order) {
      order = await Order.findOne({
        'orderShipping.originalOrderNumber': orderNumber,
        'orderShipping.orderType': 'Return',
        orderStatus: 'returnAssigned',
        deliveryMan: courierId,
      });
    }
    
    if (!order) {
      const originalOrder = await Order.findOne({
        $or: [
          { orderNumber: orderNumber },
          { smartFlyerBarcode: orderNumber }
        ],
        'orderShipping.orderType': 'Deliver',
      });
      
      if (originalOrder) {
        order = await Order.findOne({
          'orderShipping.originalOrderNumber': originalOrder.orderNumber,
          'orderShipping.orderType': 'Return',
          orderStatus: 'returnAssigned',
          deliveryMan: courierId,
        });
      }
    }
    
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ 
          message: 'Return order not found or not assigned to you.' 
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (order.orderStatus !== 'returnAssigned') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for return pickup Must be returnAssigned`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // ── Return pickup OTP verification ─────────────────────────────────────────
    // If a returnOtp has been issued (new flow), require courier to enter it.
    // Legacy orders that never had a returnOtp (null hash + null issuedAt) are
    // allowed through once; admin should use the resend-return-otp endpoint for them.
    const hasReturnOtp = order.returnOtp?.otpHash && order.returnOtp?.issuedAt;
    if (hasReturnOtp) {
      if (!order.returnOtp.expiresAt || new Date(order.returnOtp.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ message: 'Return OTP has expired. Ask the admin to resend it.' });
      }
      if (!otp) {
        return res.status(400).json({ message: 'Return OTP is required to confirm pickup from customer.' });
      }
      const otpMatch = await bcrypt.compare(String(otp), order.returnOtp.otpHash);
      if (!otpMatch) {
        order.returnOtp.attempts = (order.returnOtp.attempts || 0) + 1;
        await order.save();
        return res.status(400).json({ message: 'Invalid OTP. Please ask the customer to check their SMS and try again.' });
      }
      // Mark OTP as verified
      order.returnOtp.verifiedAt = new Date();
    } else {
      // Legacy path — log for audit but do not block
      console.warn(`⚠️ Legacy return pickup (no returnOtp issued) for order ${order.orderNumber} by courier ${courierId}`);
    }
    // ───────────────────────────────────────────────────────────────────────────

    order.orderStatus = 'returnPickedUp';

    // Determine courier name safely for API requests where req.courierData might be undefined
    const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

    // Update returnPickedUp stage with comprehensive details
    // Note: Original order number ${orderNumber} was scanned to identify this return order
    let pickupNotes = `Return picked up from customer by courier ${courierName} (Scanned original order: ${orderNumber}, Return order: ${order.orderNumber})`;
    
    // Add partial return information if applicable
    if (order.orderShipping.isPartialReturn) {
      pickupNotes += ` (Partial return: ${order.orderShipping.partialReturnItemCount} of ${order.orderShipping.originalOrderItemCount} items)`;
    }
    
    if (notes) {
      pickupNotes += `. Notes: ${notes}`;
    }

    order.orderStages.returnPickedUp = {
      isCompleted: true,
      completedAt: new Date(),
      notes: pickupNotes,
      pickedUpBy: courierId,
      pickupLocation: pickupLocation || order.orderCustomer.address,
      pickupPhotos: pickupPhotos || [],
    };

    // Update return condition and value if provided
    if (returnCondition) {
      order.orderShipping.returnCondition = returnCondition;
    }
    if (returnValue) {
      order.orderShipping.returnValue = returnValue;
    }

    // Add to courier history
    order.courierHistory.push({
      courier: courierId,
      assignedAt: new Date(),
      action: 'pickup_from_customer',
      notes: `Courier ${courierName} picked up return from customer${
        notes ? ': ' + notes : ''
      }`,
    });

    // Auto-link with original order if not already linked
    if (
      order.orderShipping.originalOrderNumber &&
      !order.orderShipping.linkedDeliverOrder
    ) {
      try {
        const originalOrder = await Order.findOne({
          orderNumber: order.orderShipping.originalOrderNumber,
          business: order.business,
          orderStatus: 'completed',
          'orderShipping.orderType': 'Deliver',
        });

        if (originalOrder) {
          // Link the orders
          order.orderShipping.linkedDeliverOrder = originalOrder._id;
          originalOrder.orderShipping.linkedReturnOrder = order._id;
          originalOrder.orderShipping.returnOrderCode = order.orderNumber;
          originalOrder.orderStatus = 'returnLinked';

          // Update original order's returned stage
          originalOrder.orderStages.returned = {
            isCompleted: false,
            completedAt: null,
            notes: `Return order ${order.orderNumber} has been picked up and linked.`,
            returnOrderCompleted: false,
            returnOrderCompletedAt: null,
          };

          await originalOrder.save();

          console.log(
            `Auto-linked return order ${order.orderNumber} with original order ${originalOrder.orderNumber}`
          );
        }
      } catch (linkError) {
        console.error('Error auto-linking return order:', linkError);
        // Don't fail the pickup if linking fails
      }
    }

    await order.save();

    // Reload for API + mobile: full row so the app can switch to "Deliver to warehouse" without a second GET
    const populatedReturn = await Order.findById(order._id)
      .populate('deliveryMan', 'name phone email')
      .populate('business', BUSINESS_PICKUP_POPULATE_SELECT)
      .populate(
        'orderShipping.linkedDeliverOrder',
        'orderNumber orderStatus orderCustomer'
      )
      .exec();

    const returnStagesForProgress = [
      'returnInitiated',
      'returnAssigned',
      'returnPickedUp',
      'returnToWarehouse',
      'returnAtWarehouse',
      'returnInspection',
      'returnProcessing',
      'returnToBusiness',
      'returnCompleted',
    ];
    const completedReturnStages = populatedReturn
      ? returnStagesForProgress.filter(
          (stage) => populatedReturn.orderStages[stage]?.isCompleted
        ).length
      : 0;
    const progressAfterPickup = populatedReturn
      ? Math.round(
          (completedReturnStages / returnStagesForProgress.length) * 100
        )
      : 0;

    let orderForClient = null;
    if (populatedReturn) {
      orderForClient = populatedReturn.toObject();
      if (orderForClient.returnOtp && orderForClient.returnOtp.otpHash) {
        delete orderForClient.returnOtp.otpHash;
      }
      orderForClient.progressPercentage = progressAfterPickup;
      orderForClient.currentStage = getCurrentReturnStage(
        populatedReturn.orderStatus
      );
      orderForClient.nextAction = getNextReturnAction(
        populatedReturn.orderStatus
      );
      orderForClient.isPartialReturn =
        populatedReturn.orderShipping.isPartialReturn;
      orderForClient.partialReturnInfo = populatedReturn.orderShipping
        .isPartialReturn
        ? {
            originalItemCount:
              populatedReturn.orderShipping.originalOrderItemCount,
            partialReturnItemCount:
              populatedReturn.orderShipping.partialReturnItemCount,
          }
        : null;
      attachEffectivePickupToOrderPlain(orderForClient, populatedReturn.business);
    }

    // Courier push: advance UI to warehouse leg without requiring pull-to-refresh
    try {
      await firebase.sendCourierAssignmentNotification(
        courierId,
        order.orderNumber,
        'return_deliver_warehouse',
        {
          orderStatus: 'returnPickedUp',
          nextAction: 'Deliver to warehouse',
        }
      );
    } catch (courierPushErr) {
      console.warn(
        `⚠️ Courier push after return pickup skipped for ${order.orderNumber}:`,
        courierPushErr.message
      );
    }

    try {
      const io = req.app.get('io');
      if (io && courierId) {
        io.to(`courier:${String(courierId)}`).emit('return-order-updated', {
          orderNumber: order.orderNumber,
          orderStatus: 'returnPickedUp',
          nextAction: 'Deliver to warehouse',
          currentStage: getCurrentReturnStage('returnPickedUp'),
          progressPercentage: progressAfterPickup,
        });
      }
    } catch (socketErr) {
      // optional socket
    }

    // Send push notification to business about return pickup
    try {
      await firebase.sendOrderStatusNotification(
        order.business,
        order.orderNumber,
        'returnPickedUp',
        {
          courierName: courierName,
          pickedUpAt: new Date(),
          returnReason: order.orderShipping?.returnReason || 'Customer return'
        }
      );
      console.log(`📱 Push notification sent to business ${order.business} about return pickup for order ${order.orderNumber}`);
    } catch (notificationError) {
      console.error(`❌ Failed to send push notification for return pickup ${order.orderNumber}:`, notificationError);
      // Don't fail the pickup if notification fails
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({
        success: true,
        message: 'Return picked up successfully',
        orderNumber: order.orderNumber,
        orderStatus: 'returnPickedUp',
        currentStage: getCurrentReturnStage('returnPickedUp'),
        nextAction: 'Deliver to warehouse',
        progressPercentage: progressAfterPickup,
        order: orderForClient,
      });
    }
    
    // For web requests, redirect back to return details (use return order number, not original)
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.error('Error in pickupReturn:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ 
        success: false,
        message: error.message || 'Internal Server Error' 
      });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

// Enhanced deliver return to warehouse with comprehensive tracking
const deliverReturnToWarehouse = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  
  const { notes, warehouseLocation, conditionNotes, deliveryPhotos } = req.body || {};

  try {
    const order = await Order.findOne({
      $or: [
        { orderNumber: orderNumber },
        { smartFlyerBarcode: orderNumber }
      ],
      deliveryMan: courierId,
    });
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (order.orderStatus !== 'returnPickedUp') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for warehouse delivery`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    order.orderStatus = 'returnAtWarehouse';

    // Determine courier name safely for API requests where req.courierData might be undefined
    const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

    // Update returnAtWarehouse stage with comprehensive details
    order.orderStages.returnAtWarehouse = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Return delivered to warehouse by courier ${courierName}${
        notes ? ': ' + notes : ''
      }`,
      receivedBy: null, // Will be updated by admin
      warehouseLocation: warehouseLocation || 'Main Warehouse',
      conditionNotes: conditionNotes || '',
    };

    // Update return condition notes if provided
    if (conditionNotes) {
      order.orderShipping.returnInspectionNotes = conditionNotes;
    }

    // Add to courier history
    order.courierHistory.push({
      courier: courierId,
      assignedAt: new Date(),
      action: 'delivered_to_warehouse',
      notes: `Courier ${courierName} delivered return to warehouse${
        notes ? ': ' + notes : ''
      }`,
    });

    await order.save();

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      const fresh = await Order.findById(order._id)
        .populate('deliveryMan', 'name phone email')
        .populate('business', BUSINESS_PICKUP_POPULATE_SELECT)
        .populate(
          'orderShipping.linkedDeliverOrder',
          'orderNumber orderStatus orderCustomer'
        )
        .exec();
      const orderOut = fresh ? fresh.toObject() : order.toObject();
      if (orderOut.returnOtp && orderOut.returnOtp.otpHash) {
        delete orderOut.returnOtp.otpHash;
      }
      attachEffectivePickupToOrderPlain(orderOut, fresh ? fresh.business : null);
      return res.status(200).json({
        message: 'Return delivered to warehouse successfully',
        order: orderOut,
        nextAction: 'Wait for admin inspection and processing',
      });
    }

    // For web requests, redirect back to return details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

// Enhanced complete return delivery to business with comprehensive tracking
const completeReturnToBusiness = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  
  const { notes, deliveryLocation, businessSignature, deliveryPhotos } =
    req.body || {};

  try {
    const order = await Order.findOne({
      $or: [
        { orderNumber: orderNumber },
        { smartFlyerBarcode: orderNumber }
      ],
      deliveryMan: courierId,
    });
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (order.orderStatus !== 'returnToBusiness') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for business delivery`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    const courierName =
      (req.courierData && req.courierData.name) ||
      (order.deliveryMan && order.deliveryMan.name) ||
      'Courier';

    const isExchange = order.orderShipping.orderType === 'Exchange';

    if (isExchange) {
      order.orderStatus = 'completed';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.scheduledRetryAt = null;
      order.completedDate = new Date();
      if (order.Attemps < 2) {
        order.Attemps += 1;
      }
      order.orderStages.returnCompleted = {
        isCompleted: true,
        completedAt: new Date(),
        notes: `Exchange return leg completed at business by courier ${courierName}${
          notes ? ': ' + notes : ''
        }`,
        completedBy: courierId,
        deliveryLocation: deliveryLocation || order.business?.address,
        businessSignature: businessSignature || null,
      };
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'delivered_to_business',
        notes: `Courier ${courierName} returned original item to business (exchange complete)${
          notes ? ': ' + notes : ''
        }`,
      });
    } else {
      order.orderStatus = 'returnCompleted';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.completedDate = new Date();

      if (order.Attemps < 2) {
        order.Attemps += 1;
      }

      order.orderStages.returnCompleted = {
        isCompleted: true,
        completedAt: new Date(),
        notes: `Return completed and delivered to business by courier ${courierName}${
          notes ? ': ' + notes : ''
        }`,
        completedBy: courierId,
        deliveryLocation: deliveryLocation || order.business.address,
        businessSignature: businessSignature || null,
      };

      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'delivered_to_business',
        notes: `Courier ${courierName} completed return delivery to business${
          notes ? ': ' + notes : ''
        }`,
      });
    }

    await order.save();

    const business = await User.findById(order.business).select('email brandInfo name');
    const businessBrandName =
      business?.brandInfo?.brandName || business?.name || 'NowShipping';

    if (isExchange && order.orderStatus === 'completed') {
      try {
        const phone = order.orderCustomer?.phoneNumber;
        if (phone) {
          await sendSms({
            recipient: phone,
            message: `NowShipping - ${businessBrandName}: Your order ${order.orderNumber} has been delivered by ${courierName}. Thank you!`,
          });
        }
      } catch (e) {
        console.error(`SMS completion error for ${order.orderNumber}:`, e.details || e.message);
      }
      try {
        if (business?.email) {
          const orderData = {
            orderNumber: order.orderNumber,
            orderId: order._id,
            customerName: order.orderCustomer?.fullName || 'N/A',
            orderType: order.orderShipping?.orderType || 'Standard',
            amount: order.orderShipping?.amount || 0,
            deliveryDate: order.completedDate,
            courierName: courierName,
            status: order.orderStatus,
          };
          await emailService.sendOrderDeliveryNotification(orderData, business.email);
        }
      } catch (emailError) {
        console.error(
          `❌ Failed to send order delivery email for order ${order.orderNumber}:`,
          emailError
        );
      }
      try {
        await firebase.sendOrderStatusNotification(
          order.business,
          order.orderNumber,
          'completed',
          {
            courierName: courierName,
            completedAt: order.completedDate,
            orderType: order.orderShipping?.orderType || 'Standard',
          }
        );
        console.log(
          `📱 Push notification sent to business ${order.business} about order ${order.orderNumber} completion`
        );
      } catch (notificationError) {
        console.error(
          `❌ Failed to send push notification for order ${order.orderNumber}:`,
          notificationError
        );
      }
    } else if (!isExchange) {
      try {
        await firebase.sendOrderStatusNotification(
          order.business,
          order.orderNumber,
          'returnCompleted',
          {
            courierName: courierName,
            completedAt: order.completedDate,
            returnReason: order.orderShipping?.returnReason || 'Customer return',
          }
        );
        console.log(
          `📱 Push notification sent to business ${order.business} about return completion for order ${order.orderNumber}`
        );
      } catch (notificationError) {
        console.error(
          `❌ Failed to send push notification for return completion ${order.orderNumber}:`,
          notificationError
        );
      }
    }

    // If this return order is linked to a deliver order, mark the deliver order as returned
    if (order.orderShipping.linkedDeliverOrder) {
      try {
        const deliverOrder = await Order.findById(
          order.orderShipping.linkedDeliverOrder
        );
        if (deliverOrder && deliverOrder.orderStatus === 'returnLinked') {
          deliverOrder.orderStatus = 'returned';
          deliverOrder.completedDate = new Date();

          // Update return stages
          deliverOrder.orderStages.returned = {
            isCompleted: true,
            completedAt: new Date(),
            notes: `Order marked as returned. Return order ${order.orderNumber} completed.`,
            returnOrderCompleted: true,
            returnOrderCompletedAt:
              order.orderStages.returnCompleted.completedAt,
          };

          await deliverOrder.save();
          console.log(
            `Deliver order ${deliverOrder.orderNumber} marked as returned`
          );
        }
      } catch (error) {
        console.error('Error marking linked deliver order as returned:', error);
      }
    }
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      const fresh = await Order.findById(order._id)
        .populate('deliveryMan', 'name phone email')
        .populate('business', BUSINESS_PICKUP_POPULATE_SELECT)
        .populate(
          'orderShipping.linkedDeliverOrder',
          'orderNumber orderStatus orderCustomer'
        )
        .exec();
      const orderOut = fresh ? fresh.toObject() : order.toObject();
      if (orderOut.returnOtp && orderOut.returnOtp.otpHash) {
        delete orderOut.returnOtp.otpHash;
      }
      attachEffectivePickupToOrderPlain(orderOut, fresh ? fresh.business : null);
      return res.status(200).json({
        message: 'Return completed successfully',
        order: orderOut,
        completionDate: order.completedDate,
      });
    }

    // For web requests, redirect back to return details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

//=============================================== PickUps =============================================== //

const get_pickups = async (req, res) => {
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    return res.status(401).json({ message: 'Courier ID not found in request' });
  }
  
  try {
    const pickups = await Pickup.find({ assignedDriver: courierId })
      .sort({ createdAt: -1 })
      .populate('assignedDriver')
      .populate('business')
      .exec();
    return res.status(200).json(pickups);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const get_pickupDetails = async (req, res) => {
  const { pickupNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const pickup = await Pickup.findOne({
      pickupNumber: pickupNumber,
      assignedDriver: courierId,
    })
      .populate('assignedDriver')
      .populate('business')
      .exec();

    if (!pickup) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Pickup not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    
    const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
      { selectedPickupAddressId: pickup.pickupAddressId },
      pickup.business
    );

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ pickup: pickup, selectedPickupAddress: selectedPickupAddress });
    }
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return respondCourierWebDeprecated(req, res);
  }
}; 

const get_picked_up_orders = async (req, res) => {
  const { pickupNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const pickup = await Pickup.findOne({
      pickupNumber: pickupNumber,
      assignedDriver: courierId,
    })
      .populate('assignedDriver')
      .populate('business')
      .populate({
        path: 'ordersPickedUp',
        populate: { path: 'deliveryMan business' },
      })
      .exec();
    if (!pickup) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Pickup not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    
    const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
      { selectedPickupAddressId: pickup.pickupAddressId },
      pickup.business
    );

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ orders: pickup.ordersPickedUp, selectedPickupAddress: selectedPickupAddress });
    }
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

const getAndSet_order_To_Pickup = async (req, res) => {
  const { orderNumber, pickupNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    console.log(orderNumber, pickupNumber);
    const pickup = await Pickup.findOne({ pickupNumber: pickupNumber })
      .populate('assignedDriver')
      .populate('business')
      .populate({
        path: 'ordersPickedUp',
        populate: { path: 'deliveryMan business' },
      })
      .exec();

    if (!pickup) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Pickup not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (countUniquePicked(pickup.ordersPickedUp) >= pickup.numberOfOrders) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Maximum number of orders reached for this pickup' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (
      pickup.picikupStatus === 'pickedUp' ||
      pickup.picikupStatus === 'completed' ||
      pickup.picikupStatus === 'inStock' ||
      pickup.picikupStatus === 'canceled' ||
      pickup.picikupStatus === 'rejected'
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'You cannot add a pickup order at this moment.' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.assignedDriver._id.toString() !== courierId) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(403).json({ message: 'You are not authorized to view this order' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Search in both orderNumber and smartFlyerBarcode fields
    const order = await Order.findOne({
      business: pickup.business,
      $or: [
        { orderNumber: orderNumber },
        { smartFlyerBarcode: orderNumber }
      ]
    })
      .populate('deliveryMan')
      .populate('business')
      .exec();

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    const otherPickupHolding = await findOtherActivePickupHoldingOrder(order._id, pickup._id);
    if (otherPickupHolding) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `This order is already on pickup #${otherPickupHolding.pickupNumber}. It cannot be added to another pickup.`,
        });
      }
      return respondCourierWebDeprecated(req, res);
    }

    if (!isOrderInPickedUpList(pickup.ordersPickedUp, order._id)) {
      pickup.ordersPickedUp.push(order._id);
    }
    // Recalculate pickup fee based on picked orders count and business city
    const businessCity = pickup?.business?.pickUpAdress?.city || '';
    const pickedCount = countUniquePicked(pickup.ordersPickedUp);
    pickup.pickupFees = calculatePickupFee(businessCity, pickedCount);
    await pickup.save();
    const populatedPickup = await Pickup.findOne({ pickupNumber: pickupNumber })
      .populate('assignedDriver')
      .populate('business')
      .populate({
        path: 'ordersPickedUp',
        populate: { path: 'deliveryMan business' },
      })
      .exec();

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({
        orders: populatedPickup.ordersPickedUp,
        message: 'Order picked up successfully',
      });
    }
    
    // For web requests, redirect back to pickup details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.log(error.message);
    if (error.name === 'ValidationError' && error.errors.ordersPickedUp) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Order is already picked up' });
      }
    return respondCourierWebDeprecated(req, res);
    } else {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(500).json({ message: error.message });
      }
    return respondCourierWebDeprecated(req, res);
    }
  }
};

const removePickedUpOrder = async (req, res) => {
  const { orderNumber, pickupNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const pickup = await Pickup.findOne({
      pickupNumber: pickupNumber,
      assignedDriver: courierId,
    })
      .populate('assignedDriver')
      .populate('business')
      .exec();
    if (!pickup) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Pickup not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    const order = await Order.findOne({
      orderNumber: orderNumber,
      business: pickup.business,
    })
      .populate('deliveryMan')
      .populate('business')
      .exec();

    if (
      pickup.picikupStatus === 'pickedUp' ||
      pickup.picikupStatus === 'completed' ||
      pickup.picikupStatus === 'inStock' ||
      pickup.picikupStatus === 'canceled' ||
      pickup.picikupStatus === 'rejected' ||
      pickup.picikupStatus === 'returned' ||
      pickup.picikupStatus === 'terminated'
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'You Cannot delete it at this moment' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }
    if (!isOrderInPickedUpList(pickup.ordersPickedUp, order._id)) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Order is not picked up' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    const target = order._id.toString();
    pickup.ordersPickedUp = (pickup.ordersPickedUp || []).filter(
      (e) => pickedListEntryId(e).toString() !== target
    );
    // Recalculate pickup fee after removal
    const businessCity = pickup?.business?.pickUpAdress?.city || '';
    const governmentCategories = {
      Cairo: ['Cairo', 'Giza', 'Qalyubia'],
      Alexandria: ['Alexandria', 'Beheira', 'Matrouh'],
      'Delta-Canal': [
        'Dakahlia',
        'Sharqia',
        'Monufia',
        'Gharbia',
        'Kafr el-Sheikh',
        'Damietta',
        'Port Said',
        'Ismailia',
        'Suez',
      ],
      'Upper-RedSea': [
        'Fayoum',
        'Beni Suef',
        'Minya',
        'Asyut',
        'Sohag',
        'Qena',
        'Luxor',
        'Aswan',
        'Red Sea',
        'North Sinai',
        'South Sinai',
        'New Valley',
      ],
    };
    function getPickupBaseFeeByCity(city) {
      let category = 'Cairo';
      for (const [cat, govs] of Object.entries(governmentCategories)) {
        if (govs.includes(city)) {
          category = cat;
          break;
        }
      }
      const baseByCategory = {
        Cairo: 50,
        Alexandria: 55,
        'Delta-Canal': 60,
        'Upper-RedSea': 80,
      };
      return baseByCategory[category] || 50;
    }
    const basePickupFee = getPickupBaseFeeByCity(businessCity);
    const pickedCount = countUniquePicked(pickup.ordersPickedUp);
    pickup.pickupFees =
      pickedCount < 3 ? Math.round(basePickupFee * 1.3) : basePickupFee;
    // order.orderStatus = 'new';
    // order.orderStages = order.orderStages.filter(
    //   (stage) => stage.stageName !== 'pickedUp'
    // );
    await pickup.save();
    // await order.save();
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Order removed successfully' });
    }
    
    // For web requests, redirect back to pickup details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};


const completePickup = async (req, res) => {
  const { pickupNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    return respondCourierWebDeprecated(req, res);
  }
  try {
    const pickup = await Pickup.findOne({
      pickupNumber: pickupNumber,
      assignedDriver: courierId,
    })
      .populate('assignedDriver')
      .populate('business')
      .populate({
        path: 'ordersPickedUp',
        populate: { path: 'deliveryMan business' },
      })
      .exec();
    if (!pickup) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Pickup not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.picikupStatus === 'canceled') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is canceled' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.picikupStatus === 'rejected') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already rejected' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.picikupStatus === 'completed') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already completed' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.picikupStatus === 'inStock') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is in stock' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.picikupStatus === 'pickedUp') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already Completed' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    if (pickup.ordersPickedUp.length === 0) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'No orders picked up' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    pickup.picikupStatus = 'pickedUp';
    pickup.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;

    // Determine courier name safely for API requests where req.courierData might be undefined
    const courierName = (req.courierData && req.courierData.name) || (pickup.assignedDriver && pickup.assignedDriver.name) || 'Courier';

    const lastPickupStage = pickup.pickupStages[pickup.pickupStages.length - 1];
    if (!lastPickupStage || lastPickupStage.stageName !== 'pickedUp') {
      pickup.pickupStages.push({
        stageName: 'pickedUp',
        stageDate: new Date(),
        stageNotes: [
          {
            text: `Order picked up by courier ${courierName}`,
            date: new Date(),
          },
        ],
      });
    }

    for (const order of pickup.ordersPickedUp) {
      order.orderStatus = 'pickedUp';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = `Order picked up by courier ${courierName}`;
      }
      await order.save();
    }

    await pickup.save();

    // Send push notification to business
    const businessId = pickup.business?._id || pickup.business;
    try {
      await firebase.sendOrderStatusNotification(
        businessId,
        pickup.pickupNumber,
        'pickedUp',
        {
          courierName: courierName,
          pickedUpAt: new Date(),
          ordersCount: pickup.ordersPickedUp.length,
          pickupFees: pickup.pickupFees
        }
      );
      console.log(`📱 Push notification sent for pickup ${pickup.pickupNumber}`);
    } catch (notificationError) {
      console.error(`❌ Push notification failed for pickup ${pickup.pickupNumber}:`, notificationError.message);
    }

    // Send WhatsApp notifications to customers
    const { sendOrderPickedUpNotification } = require('../utils/whatsapp');
    for (const order of pickup.ordersPickedUp) {
      sendOrderPickedUpNotification(order)
        .catch(e => console.error(`❌ WhatsApp failed for order ${order.orderNumber}:`, e.message));
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Pickup completed successfully' });
    }
    
    // For web requests, redirect back to pickup details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

const logOut = (req, res) => {
  req.session.destroy();
  res.clearCookie('token');
  
  // Check if request expects JSON response (API call)
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(200).json({ message: 'Logged out successfully' });
  }
  
  // For web requests, redirect to login page
  res.redirect('/mobileApp');
};

const getCourierLanguage = async (req, res) => {
  try {
    const courierId = req.courierId || req.userId;
    if (!courierId) {
      return res.status(401).json({ success: false, message: 'Courier ID not found in request' });
    }

    const courier = await Courier.findById(courierId).select('preferredLanguage');
    if (!courier) {
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    return res.status(200).json({
      success: true,
      language: normalizeCourierLanguage(courier.preferredLanguage) || 'en',
    });
  } catch (error) {
    console.error('Error in getCourierLanguage:', error);
    return res.status(500).json({ success: false, message: 'Failed to get language preference' });
  }
};

const updateCourierLanguage = async (req, res) => {
  try {
    const courierId = req.courierId || req.userId;
    if (!courierId) {
      return res.status(401).json({ success: false, message: 'Courier ID not found in request' });
    }

    const language = normalizeCourierLanguage(req.body?.language);
    if (!language) {
      return res.status(400).json({
        success: false,
        message: 'Invalid language. Supported values are: en, ar.',
      });
    }

    const courier = await Courier.findByIdAndUpdate(
      courierId,
      { preferredLanguage: language },
      { new: true, runValidators: true }
    ).select('preferredLanguage');

    if (!courier) {
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Courier language updated successfully.',
      language: normalizeCourierLanguage(courier.preferredLanguage) || 'en',
    });
  } catch (error) {
    console.error('Error in updateCourierLanguage:', error);
    return res.status(500).json({ success: false, message: 'Failed to update language preference' });
  }
};

// Scan fast shipping order and mark stages as completed
const scanFastShippingOrder = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    // Handle both API (JWT) and web (session) authentication
    const courierId = req.user?.id || req.courierId;

    // Find the order by orderNumber or smartFlyerBarcode
    const order = await Order.findOne({
      $or: [
        { orderNumber: orderNumber },
        { smartFlyerBarcode: orderNumber }
      ]
    })
      .populate('business', 'name brandInfo email phoneNumber')
      .populate('deliveryMan', 'name phoneNumber');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found by order number or smart flyer barcode' 
      });
    }

    if (!order.orderShipping || !order.orderShipping.isExpressShipping) {
      return res.status(400).json({ 
        success: false, 
        message: 'This is not a fast shipping order' 
      });
    }

    if (order.orderStatus !== 'inProgress') {
      return res.status(400).json({ 
        success: false, 
        message: `Order status '${order.orderStatus}' is not valid for fast shipping scan. Order must be in progress.` 
      });
    }

    if (!order.deliveryMan || order.deliveryMan._id.toString() !== courierId) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not assigned to this order' 
      });
    }

    const now = new Date();
    
    if (!order.orderStages.packed.isCompleted) {
      order.orderStages.packed = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - marked as completed after business pickup scan'
      };
    }

    if (!order.orderStages.shipping.isCompleted) {
      order.orderStages.shipping = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - marked as completed after business pickup scan'
      };
    }

    if (!order.orderStages.outForDelivery.isCompleted) {
      order.orderStages.outForDelivery = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - ready for delivery to customer'
      };
    }

    order.orderStatus = 'headingToCustomer';
    order.statusCategory = 'PROCESSING';

    order.courierHistory.push({
      courier: courierId,
      assignedAt: now,
      action: 'pickup_from_warehouse',
      notes: 'Fast shipping order scanned - proceeding to customer delivery'
    });

    // Generate 24h OTP for delivery verification
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    order.deliveryOtp = {
      otpHash: require('bcrypt').hashSync(otp, 10),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      verifiedAt: null,
      attempts: 0,
    };

    await order.save();

    // Send SMS OTP to customer
    const phone = order.orderCustomer?.phoneNumber;
    const brand = order.business?.brandInfo?.brandName || order.business?.name || 'NowShipping';
    console.log("Delivery OTP Phone: ", otp)
    if (phone) {
      sendSms({ recipient: phone, message: `NowShipping - ${brand}: Your delivery OTP for order ${order.orderNumber} is ${otp}. Valid for 24 hours.` })
        .catch((e) => console.error(`SMS OTP error for ${order.orderNumber}:`, e.details || e.message));
    } else {
      console.warn(`⚠️ No phone number for order ${order.orderNumber} - SMS OTP skipped`);
    }

    // Send WhatsApp notification to customer
    const { sendHeadingToCustomerNotification } = require('../utils/whatsapp');
    sendHeadingToCustomerNotification(order)
      .catch(e => console.error(`WhatsApp error for ${order.orderNumber}:`, e.message));

    res.status(200).json({
      success: true,
      message: 'Fast shipping order processed successfully',
      order: {
        orderNumber: order.orderNumber,
        smartFlyerBarcode: order.smartFlyerBarcode,
        orderStatus: order.orderStatus,
        stages: {
          packed: order.orderStages.packed.isCompleted,
          shipping: order.orderStages.shipping.isCompleted,
          inProgress: order.orderStages.inProgress.isCompleted,
          outForDelivery: order.orderStages.outForDelivery.isCompleted
        }
      }
    });

  } catch (error) {
    console.error('Error scanning fast shipping order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// ======================================== SHOP FUNCTIONS ======================================== //

// Get courier shop orders
const getCourierShopOrders = async (req, res) => {
  try {
    const courierId = (req.courierData && req.courierData._id) || req.courierId || req.userId;
    if (!courierId) {
      return res.status(401).json({ error: 'Unauthorized: courier ID missing' });
    }
    const { status } = req.query;

    const query = { courier: courierId };

    if (status) {
      query.status = status;
    }

    const orders = await ShopOrder.find(query)
      .populate('business', 'brandInfo phone')
      .populate('items.product', 'name nameAr images')
      .sort({ assignedAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching courier shop orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// Get courier shop order details
const getCourierShopOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const courierId = (req.courierData && req.courierData._id) || req.courierId || req.userId;
    if (!courierId) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ error: 'Unauthorized: courier ID missing' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    const order = await ShopOrder.findOne({ _id: id, courier: courierId })
      .populate('business', 'brandInfo phone email')
      .populate('items.product');

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ error: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json(order);
    }
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.error('Error fetching order details:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ error: 'Failed to fetch order details' });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

// Update courier shop order status
const updateCourierShopOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, location, notes } = req.body || {};
    const courierId = (req.courierData && req.courierData._id) || req.courierId || req.userId;
    if (!courierId) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ error: 'Unauthorized: courier ID missing' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    const order = await ShopOrder.findOne({ _id: id, courier: courierId });

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ error: 'Order not found' });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Validate status transition with professional error handling
    const validTransitions = {
      assigned: ['in_transit'],
      in_transit: ['delivered', 'returned'],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          error: `Invalid status transition from '${order.status}' to '${status}'. Valid transitions: ${validTransitions[order.status]?.join(', ') || 'none'}`,
        });
      }
    return respondCourierWebDeprecated(req, res);
    }

    // Update order status with professional handling
    const previousStatus = order.status;
    order.status = status;
    order.updatedBy = courierId;
    order.updatedByModel = 'Courier';

    // Set specific timestamps based on status
    if (status === 'in_transit') {
      order.pickedUpAt = new Date();
    } else if (status === 'delivered') {
      order.deliveredAt = new Date();
      order.paymentStatus = 'paid';
    }

    // Add location to tracking if provided
    if (location && order.trackingHistory.length > 0) {
      order.trackingHistory[order.trackingHistory.length - 1].location = location;
    }

    // Add courier notes professionally
    if (notes) {
      const timestamp = new Date().toISOString();
      order.notes = (order.notes ? order.notes + '\n' : '') + `[${timestamp}] [Courier] ${notes}`;
    }

    await order.save();

    // Send push notification to business about shop order status change
    try {
      await firebase.sendShopOrderStatusNotification(
        order.business,
        order.orderNumber,
        status,
        {
          courierName: req.courierData ? req.courierData.name : 'Courier',
          previousStatus: previousStatus,
          updatedAt: new Date(),
          notes: notes || '',
          location: location || null
        }
      );
      console.log(`📱 Push notification sent to business ${order.business} about shop order ${order.orderNumber} status change to ${status}`);
    } catch (notificationError) {
      console.error(`❌ Failed to send push notification to business ${order.business}:`, notificationError);
      // Don't fail the status update if notification fails
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({
        message: `Order status successfully updated from '${previousStatus}' to '${status}'`,
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          updatedAt: order.updatedAt
        },
      });
    }
    
    // For web requests, redirect back to shop order details
    return respondCourierWebDeprecated(req, res);
  } catch (error) {
    console.error('Error updating order status:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ error: 'Failed to update order status' });
    }
    return respondCourierWebDeprecated(req, res);
  }
};

module.exports = {
  respondCourierWebDeprecated,
  get_orders,
  get_orderDetails,
  completeOrder,

  get_pickups,
  get_pickupDetails,
  getAndSet_order_To_Pickup,
  get_picked_up_orders,
  removePickedUpOrder,
  updateOrderStatus,
  completePickup,
  logOut,
  getCourierLanguage,
  updateCourierLanguage,
  pickupReturn,
  deliverReturnToWarehouse,
  completeReturnToBusiness,
  get_returns,
  getReturnOrderDetails,
  getCurrentReturnStage,
  getNextReturnAction,
  scanFastShippingOrder,

  getCourierShopOrders,
  getCourierShopOrderDetails,
  updateCourierShopOrderStatus,
};
