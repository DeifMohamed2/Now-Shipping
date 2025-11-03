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

const getDashboardPage = (req, res) => {
  res.render('courier/dashboard', {
    title: 'Dashboard',
    page_title: 'Dashboard',
    folder: 'Pages',
  });
};

//=============================================== Orders =============================================== //
const get_ordersPage = (req, res) => {
  res.render('courier/orders', {
    title: 'Orders',
    page_title: 'Orders',
    folder: 'Pages',
  });
};

const get_orders = async (req, res) => {
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    return res.status(401).json({ message: 'Courier ID not found in request' });
  }
  
  const { statusCategory, orderType } = req.query;
  try {
    // Build query with courier ID
    const query = {
      deliveryMan: courierId,
      // Exclude return orders for the regular orders page
      $or: [
        { 'orderShipping.orderType': { $ne: 'Return' } },
        { 'orderShipping.orderType': 'Return', orderStatus: 'headingToYou' },
      ],
    };
    
    // Add status category filter if provided
    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      query.statusCategory = statusCategory;
    }
    
    // Add order type filter if provided
    if (orderType && statusHelper.ORDER_TYPES[orderType]) {
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
      } else if (order.orderShipping.orderType === 'Cash Collection') {
        orderObj.isCashCollection = true;
        orderObj.collectionAmount = order.orderShipping.amount;
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
    const query = {
      deliveryMan: courierId,
      'orderShipping.orderType': 'Return',
    };

    // Add status filter if provided
    if (status && status !== 'all') {
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

// New function to render the returns page
const get_returnsPage = async (req, res) => {
  res.render('courier/returns', {
    title: 'Returns',
    page_title: 'Manage Returns',
    folder: 'Pages',
  });
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/returns');
  }

  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
      'orderShipping.orderType': 'Return',
    })
      .populate('deliveryMan', 'name phone email')
      .populate('business', 'businessName email phone address')
      .populate(
        'orderShipping.linkedDeliverOrder',
        'orderNumber orderStatus orderCustomer'
      );

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Return order not found' });
      }
      req.flash('error', 'Return order not found');
      return res.redirect('/courier/returns');
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

    const responseData = {
      order: order,
      progressPercentage,
      stageTimeline,
      currentStage: getCurrentReturnStage(order.orderStatus),
      nextAction: getNextReturnAction(order.orderStatus),
      feeBreakdown: order.feeBreakdown,
    };

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json(responseData);
    }
    
    // Render page for web requests
    res.render('courier/return-details', {
      title: 'Return Order Details',
      page_title: 'Return Details',
      folder: 'Pages',
      ...responseData,
      courierData: req.courierData
    });
  } catch (error) {
    console.error('Error fetching return order details:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/returns');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/orders');
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
      req.flash('error', 'Order not found');
      return res.redirect('/courier/orders');
    }
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

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ order: enhancedOrder });
    }
    
    // Render page for web requests
    res.render('courier/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Pages',
      order: enhancedOrder,
      courierData: req.courierData
    });
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/orders');
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
        status === 'rejected' ? 'rejected by courier' : 'failed delivery'
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
            ? 'courier rejection'
            : 'failed delivery attempts'
        }`,
        initiatedBy: 'system',
        reason: status === 'rejected' ? 'courier_rejection' : 'delivery_failed',
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
        notes: `Courier preserved for return process after ${status}`,
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
          status === 'rejected' ? 'Courier rejection' : 'Failed delivery',
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
          status === 'rejected' ? 'Courier rejection' : 'Failed delivery',
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
      status === 'rejected' ? 'Courier rejection' : 'Failed delivery attempts';

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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/orders');
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
      req.flash('error', 'Order not found');
      return res.redirect('/courier/orders');
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
      req.flash('error', `Order status '${order.orderStatus}' does not allow status updates`);
      return res.redirect(`/courier/order-details/${orderNumber}`);
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
          order.orderStages.inProgress.notes = 'Customer unavailable';
        }
        order.orderStages.outForDelivery.isCompleted = false;
        order.scheduledRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
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
      // Courier rejected the order - initiate full return process
      await fullInitiationReturn(order, status);

      // Send push notification to business about order rejection
      try {
        await firebase.sendOrderStatusNotification(
          order.business._id,
          order.orderNumber,
          'rejected',
          {
            courierName: order.deliveryMan.name,
            reason: reason || 'Order rejected by courier',
            updatedAt: new Date()
          }
        );
        console.log(`📱 Push notification sent to business ${order.business._id} about order ${order.orderNumber} rejection`);
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
    req.flash('success', 'Order status updated successfully');
    res.redirect(`/courier/order-details/${orderNumber}`);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/orders');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/orders');
  }
  
  const { collectionReceipt, exchangePhotos } = req.body || {}; // Parameters for Exchange and Cash Collection
  
  try {
    const order = await Order.findOne({
      orderNumber: orderNumber,
      deliveryMan: courierId,
    }).populate('deliveryMan');
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
      req.flash('error', 'Order not found');
      return res.redirect('/courier/orders');
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
        'returnToBusiness'
      ].includes(order.orderStatus)
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status '${order.orderStatus}' does not allow completion`,
        });
      }
      req.flash('error', `Order status '${order.orderStatus}' does not allow completion`);
      return res.redirect(`/courier/order-details/${orderNumber}`);
    }

    // For regular deliveries
    if (
      ![
        'inStock',
        'headingToCustomer',
        'headingToYou',
        'inReturnStock',
        'rescheduled',
        'waitingAction',
        'exchangePickup',
        'exchangeDelivery',
        'collectionComplete'
      ].includes(order.orderStatus) &&
      order.orderStatus !== 'returnInProgress'
    ) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for completion`,
        });
      }
      req.flash('error', `Order status ${order.orderStatus} is not valid for completion`);
      return res.redirect(`/courier/order-details/${orderNumber}`);
    }

    // Handle different completion types based on order type and status
    const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

    if (order.orderStatus === 'returnInProgress') {
      // This is a return being picked up from customer
      order.orderStatus = 'inReturnStock';
      // Update inProgress stage for return completion
      if (!order.orderStages.inProgress.isCompleted) {
        order.orderStages.inProgress.isCompleted = true;
        order.orderStages.inProgress.completedAt = new Date();
        order.orderStages.inProgress.notes = `Return completed by courier ${courierName} and received in return stock`;
      }

      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'delivered_to_warehouse',
        notes: `Courier ${courierName} delivered return from customer to warehouse`,
      });
    } else if (order.orderStatus === 'headingToYou') {
      // This is returning an order to the business
      order.orderStatus = 'returnCompleted';
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
      // For Exchange orders, first we mark the exchange pickup stage
      order.orderStatus = 'exchangePickup';
      
      // Update exchange pickup stage
      if (order.orderStages.exchangePickup) {
        order.orderStages.exchangePickup.isCompleted = true;
        order.orderStages.exchangePickup.completedAt = new Date();
        order.orderStages.exchangePickup.notes = `Original item picked up by courier ${courierName}`;
        order.orderStages.exchangePickup.pickedUpBy = courierId;
        order.orderStages.exchangePickup.pickupLocation = order.orderCustomer.address;
        if (exchangePhotos && Array.isArray(exchangePhotos)) {
          order.orderStages.exchangePickup.originalItemPhotos = exchangePhotos;
        }
      }
      
      // Update outForDelivery stage to mark that courier has reached customer
      if (!order.orderStages.outForDelivery.isCompleted) {
        order.orderStages.outForDelivery.isCompleted = true;
        order.orderStages.outForDelivery.completedAt = new Date();
        order.orderStages.outForDelivery.notes = `Courier ${courierName} reached customer for exchange`;
      }
      
      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'exchange_pickup',
        notes: `Courier ${courierName} picked up original item for exchange`
      });
      
    } else if (order.orderShipping.orderType === 'Exchange' && order.orderStatus === 'exchangePickup') {
      // For Exchange orders, next we mark the exchange delivery stage
      order.orderStatus = 'exchangeDelivery';
      
      // Update exchange delivery stage
      if (order.orderStages.exchangeDelivery) {
        order.orderStages.exchangeDelivery.isCompleted = true;
        order.orderStages.exchangeDelivery.completedAt = new Date();
        order.orderStages.exchangeDelivery.notes = `Replacement item delivered by courier ${courierName}`;
        order.orderStages.exchangeDelivery.deliveredBy = courierId;
        order.orderStages.exchangeDelivery.deliveryLocation = order.orderCustomer.address;
        if (exchangePhotos && Array.isArray(exchangePhotos)) {
          order.orderStages.exchangeDelivery.replacementItemPhotos = exchangePhotos;
        }
      }
      
      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'exchange_delivery',
        notes: `Courier ${courierName} delivered replacement item`
      });
      
      // Now mark the order as completed
      order.orderStatus = 'completed';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.completedDate = new Date();
      
    } else if (order.orderShipping.orderType === 'Cash Collection' && order.orderStatus === 'headingToCustomer') {
      // For Cash Collection orders, mark the collection complete stage
      order.orderStatus = 'collectionComplete';
      
      // Update collection complete stage
      if (order.orderStages.collectionComplete) {
        order.orderStages.collectionComplete.isCompleted = true;
        order.orderStages.collectionComplete.completedAt = new Date();
        order.orderStages.collectionComplete.notes = `Cash collected by courier ${courierName}`;
        order.orderStages.collectionComplete.collectedBy = courierId;
        order.orderStages.collectionComplete.collectionAmount = order.orderShipping.amount;
        order.orderStages.collectionComplete.collectionReceipt = collectionReceipt || null;
      }
      
      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'cash_collected',
        notes: `Courier ${courierName} collected cash amount ${order.orderShipping.amount}`
      });
      
      // Now mark the order as completed
      order.orderStatus = 'completed';
      order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
      order.completedDate = new Date();
      
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

    // Send SMS to customer on successful completion
    if (order.orderStatus === 'completed') {
      try {
        const phone = order.orderCustomer?.phoneNumber;
        const brand = (order.business && order.business.brandInfo && order.business.brandInfo.brandName) || (order.business && order.business.name) || 'NowShipping';
        if (phone) {
          await sendSms({
            recipient: phone,
            message: `NowShipping - ${brand}: Your order ${order.orderNumber} has been delivered by ${courierName}. Thank you!`
          });
        }
      } catch (e) {
        console.error('SMS send error (order completed):', e.details || e.message);
      }
    }
    
    // Send professional order delivery notification to business
    try {
      const business = await User.findById(order.business).select('email brandInfo name');
      if (business && business.email) {
        const orderData = {
          orderNumber: order.orderNumber,
          orderId: order._id,
          customerName: order.orderCustomer?.fullName || 'N/A',
          orderType: order.orderShipping?.orderType || 'Standard',
          amount: order.orderShipping?.amount || 0,
          deliveryDate: order.completedDate,
          courierName: courierName,
          status: order.orderStatus
        };

        await emailService.sendOrderDeliveryNotification(orderData, business.email);
        console.log(`📧 Order delivery notification sent to business ${business._id} for order ${order.orderNumber}`);
      }
    } catch (emailError) {
      console.error(`❌ Failed to send order delivery email for order ${order.orderNumber}:`, emailError);
      // Don't fail the order completion if email fails
    }

    // Send push notification to business about order completion
    try {
      await firebase.sendOrderStatusNotification(
        order.business,
        order.orderNumber,
        'completed',
        {
          courierName: courierName,
          completedAt: order.completedDate,
          orderType: order.orderShipping?.orderType || 'Standard'
        }
      );
      console.log(`📱 Push notification sent to business ${order.business} about order ${order.orderNumber} completion`);
    } catch (notificationError) {
      console.error(`❌ Failed to send push notification for order ${order.orderNumber}:`, notificationError);
      // Don't fail the order completion if notification fails
    }
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Order completed successfully' });
    }
    
    // For web requests, redirect back to order details
    req.flash('success', 'Order completed successfully');
    res.redirect(`/courier/order-details/${orderNumber}`);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/orders');
  }
};
// const completeOrder = async (req, res) => {
//   const { orderNumber } = req.params;
//   // Handle both API (JWT) and web (session) authentication
//   const courierId = req.courierId || req.userId;
  
//   if (!courierId) {
//     if (req.headers.accept && req.headers.accept.includes('application/json')) {
//       return res.status(401).json({ message: 'Courier ID not found in request' });
//     }
//     req.flash('error', 'Unauthorized');
//     return res.redirect('/courier/orders');
//   }
  
//   const { collectionReceipt, exchangePhotos, otp } = req.body; // Added parameters for Exchange and Cash Collection + OTP
  
//   try {
//     const order = await Order.findOne({
//       orderNumber: orderNumber,
//       deliveryMan: courierId,
//     }).populate('deliveryMan');
//     if (!order) {
//       if (req.headers.accept && req.headers.accept.includes('application/json')) {
//         return res.status(404).json({ message: 'Order not found' });
//       }
//       req.flash('error', 'Order not found');
//       return res.redirect('/courier/orders');
//     }

//     // Check if order can be completed based on status
//     if (
//       [
//         'completed',
//         'canceled',
//         'rejected',
//         'returned',
//         'terminated',
//         'returnCompleted',
//         'new',
//         'pickedUp',
//         'inStock',
//         'inReturnStock',
//         'returnAssigned',
//         'returnPickedUp',
//         'returnAtWarehouse',
//         'returnToBusiness'
//       ].includes(order.orderStatus)
//     ) {
//       if (req.headers.accept && req.headers.accept.includes('application/json')) {
//         return res.status(400).json({
//           message: `Order status '${order.orderStatus}' does not allow completion`,
//         });
//       }
//       req.flash('error', `Order status '${order.orderStatus}' does not allow completion`);
//       return res.redirect(`/courier/order-details/${orderNumber}`);
//     }

//     // For regular deliveries
//     if (
//       ![
//         'inStock',
//         'headingToCustomer',
//         'headingToYou',
//         'inReturnStock',
//         'rescheduled',
//         'waitingAction',
//         'exchangePickup',
//         'exchangeDelivery',
//         'collectionComplete'
//       ].includes(order.orderStatus) &&
//       order.orderStatus !== 'returnInProgress'
//     ) {
//       if (req.headers.accept && req.headers.accept.includes('application/json')) {
//         return res.status(400).json({
//           message: `Order status ${order.orderStatus} is not valid for completion`,
//         });
//       }
//       req.flash('error', `Order status ${order.orderStatus} is not valid for completion`);
//       return res.redirect(`/courier/order-details/${orderNumber}`);
//     }

//     // OTP requirement: All non-return completion flows require valid OTP
//     const isReturnFlow = order.orderShipping?.orderType === 'Return' ||
//                          order.orderStatus === 'returnInProgress' ||
//                          order.orderStatus === 'headingToYou';

//     async function requireValidOtpOrFail() {

//       if (isReturnFlow) return; // Skip OTP for return flows
//       if (!order.deliveryOtp || !order.deliveryOtp.otpHash || !order.deliveryOtp.expiresAt) {
//         return res.status(400).json({ message: 'Delivery OTP not generated. Please contact support.' });
//       }
//       if (new Date(order.deliveryOtp.expiresAt).getTime() < Date.now()) {
//         return res.status(400).json({ message: 'OTP expired. Ask admin to resend.' });
//       }
//       if (!otp) {
//         return res.status(400).json({ message: 'OTP is required to complete this order' });
//       }
//       const bcrypt = require('bcrypt');
//       const ok = await bcrypt.compare(String(otp), order.deliveryOtp.otpHash);
//       if (!ok) {
//         order.deliveryOtp.attempts = (order.deliveryOtp.attempts || 0) + 1;
//         await order.save();
//         return res.status(400).json({ message: 'Invalid OTP' });
//       }
//       order.deliveryOtp.verifiedAt = new Date();
//       await order.save();
//     }

//     // Handle different completion types based on order type and status
//     const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

//     if (order.orderStatus === 'returnInProgress') {
//       // This is a return being picked up from customer
//       order.orderStatus = 'inReturnStock';
//       // Update inProgress stage for return completion
//       if (!order.orderStages.inProgress.isCompleted) {
//         order.orderStages.inProgress.isCompleted = true;
//         order.orderStages.inProgress.completedAt = new Date();
//         order.orderStages.inProgress.notes = `Return completed by courier ${courierName} and received in return stock`;
//       }

//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'delivered_to_warehouse',
//         notes: `Courier ${courierName} delivered return from customer to warehouse`,
//       });
//     } else if (order.orderStatus === 'headingToYou') {
//       // This is returning an order to the business
//       order.orderStatus = 'returnCompleted';
//       // Update delivered stage for return completion
//       if (!order.orderStages.delivered.isCompleted) {
//         order.orderStages.delivered.isCompleted = true;
//         order.orderStages.delivered.completedAt = new Date();
//         order.orderStages.delivered.notes = `Return delivered to business by courier ${courierName}`;
//       }

//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'delivered_to_business',
//         notes: `Courier ${courierName} delivered return to business`,
//       });
//     } else if (order.orderShipping.orderType === 'Exchange' && order.orderStatus === 'headingToCustomer') {
//       const otpCheck = await requireValidOtpOrFail();
//       if (otpCheck) return; // if response already sent
//       // For Exchange orders, first we mark the exchange pickup stage
//       order.orderStatus = 'exchangePickup';
      
//       // Update exchange pickup stage
//       if (order.orderStages.exchangePickup) {
//         order.orderStages.exchangePickup.isCompleted = true;
//         order.orderStages.exchangePickup.completedAt = new Date();
//         order.orderStages.exchangePickup.notes = `Original item picked up by courier ${courierName}`;
//         order.orderStages.exchangePickup.pickedUpBy = courierId;
//         order.orderStages.exchangePickup.pickupLocation = order.orderCustomer.address;
//         if (exchangePhotos && Array.isArray(exchangePhotos)) {
//           order.orderStages.exchangePickup.originalItemPhotos = exchangePhotos;
//         }
//       }
      
//       // Update outForDelivery stage to mark that courier has reached customer
//       if (!order.orderStages.outForDelivery.isCompleted) {
//         order.orderStages.outForDelivery.isCompleted = true;
//         order.orderStages.outForDelivery.completedAt = new Date();
//         order.orderStages.outForDelivery.notes = `Courier ${courierName} reached customer for exchange`;
//       }
      
//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'exchange_pickup',
//         notes: `Courier ${courierName} picked up original item for exchange`
//       });
      
//     } else if (order.orderShipping.orderType === 'Exchange' && order.orderStatus === 'exchangePickup') {
//       const otpCheck = await requireValidOtpOrFail();
//       if (otpCheck) return;
//       // For Exchange orders, next we mark the exchange delivery stage
//       order.orderStatus = 'exchangeDelivery';
      
//       // Update exchange delivery stage
//       if (order.orderStages.exchangeDelivery) {
//         order.orderStages.exchangeDelivery.isCompleted = true;
//         order.orderStages.exchangeDelivery.completedAt = new Date();
//         order.orderStages.exchangeDelivery.notes = `Replacement item delivered by courier ${courierName}`;
//         order.orderStages.exchangeDelivery.deliveredBy = courierId;
//         order.orderStages.exchangeDelivery.deliveryLocation = order.orderCustomer.address;
//         if (exchangePhotos && Array.isArray(exchangePhotos)) {
//           order.orderStages.exchangeDelivery.replacementItemPhotos = exchangePhotos;
//         }
//       }
      
//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'exchange_delivery',
//         notes: `Courier ${courierName} delivered replacement item`
//       });
      
//       // Now mark the order as completed
//       order.orderStatus = 'completed';
//       order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
//       order.completedDate = new Date();
      
//     } else if (order.orderShipping.orderType === 'Cash Collection' && order.orderStatus === 'headingToCustomer') {
//       const otpCheck = await requireValidOtpOrFail();
//       if (otpCheck) return;
//       // For Cash Collection orders, mark the collection complete stage
//       order.orderStatus = 'collectionComplete';
      
//       // Update collection complete stage
//       if (order.orderStages.collectionComplete) {
//         order.orderStages.collectionComplete.isCompleted = true;
//         order.orderStages.collectionComplete.completedAt = new Date();
//         order.orderStages.collectionComplete.notes = `Cash collected by courier ${courierName}`;
//         order.orderStages.collectionComplete.collectedBy = courierId;
//         order.orderStages.collectionComplete.collectionAmount = order.orderShipping.amount;
//         order.orderStages.collectionComplete.collectionReceipt = collectionReceipt || null;
//       }
      
//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'cash_collected',
//         notes: `Courier ${courierName} collected cash amount ${order.orderShipping.amount}`
//       });
      
//       // Now mark the order as completed
//       order.orderStatus = 'completed';
//       order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
//       order.completedDate = new Date();
      
//     } else {
//       const otpCheck = await requireValidOtpOrFail();
//       if (otpCheck) return;
//       // Regular delivery completion
//       order.orderStatus = 'completed';
//       order.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
//       order.scheduledRetryAt = null;
//       order.completedDate = new Date();
      
//       // Increment attempts but ensure it doesn't exceed 2
//       if (order.Attemps < 2) {
//         order.Attemps += 1;
//       }
//       // Update delivered stage for completion
//       if (!order.orderStages.delivered.isCompleted) {
//         order.orderStages.delivered.isCompleted = true;
//         order.orderStages.delivered.completedAt = new Date();
//         order.orderStages.delivered.notes = `Order completed by courier ${courierName}`;
//         // Mark all other order stages as completed
//         if (!order.orderStages.orderPlaced.isCompleted) {
//           order.orderStages.orderPlaced.isCompleted = true;
//         }

//         if (!order.orderStages.packed.isCompleted) {
//           order.orderStages.packed.isCompleted = true;
//         }

//         if (!order.orderStages.shipping.isCompleted) {
//           order.orderStages.shipping.isCompleted = true;
//         }

//         if (!order.orderStages.inProgress.isCompleted) {
//           order.orderStages.inProgress.isCompleted = true;
//         }
//         if (!order.orderStages.outForDelivery.isCompleted) {
//           order.orderStages.outForDelivery.isCompleted = true;
//         }
//       }

//       // Add to courier history
//       order.courierHistory.push({
//         courier: courierId,
//         assignedAt: new Date(),
//         action: 'completed',
//         notes: `Courier ${courierName} completed delivery to customer`,
//       });
//     }

//     await order.save();

//     // Send SMS to customer on successful completion
//     if (order.orderStatus === 'completed') {
//       try {
//         const phone = order.orderCustomer?.phoneNumber;
//         const brand = (order.business && order.business.brandInfo && order.business.brandInfo.brandName) || (order.business && order.business.name) || 'NowShipping';
//         if (phone) {
//           await sendSms({
//             recipient: phone,
//             message: `NowShipping - ${brand}: Your order ${order.orderNumber} has been delivered by ${courierName}. Thank you!`
//           });
//         }
//       } catch (e) {
//         console.error('SMS send error (order completed):', e.details || e.message);
//       }
//     }
    
//     // Send professional order delivery notification to business
//     try {
//       const business = await User.findById(order.business).select('email brandInfo name');
//       if (business && business.email) {
//         const orderData = {
//           orderNumber: order.orderNumber,
//           orderId: order._id,
//           customerName: order.orderCustomer?.fullName || 'N/A',
//           orderType: order.orderShipping?.orderType || 'Standard',
//           amount: order.orderShipping?.amount || 0,
//           deliveryDate: order.completedDate,
//           courierName: courierName,
//           status: order.orderStatus
//         };

//         await emailService.sendOrderDeliveryNotification(orderData, business.email);
//         console.log(`📧 Order delivery notification sent to business ${business._id} for order ${order.orderNumber}`);
//       }
//     } catch (emailError) {
//       console.error(`❌ Failed to send order delivery email for order ${order.orderNumber}:`, emailError);
//       // Don't fail the order completion if email fails
//     }

//     // Send push notification to business about order completion
//     try {
//       await firebase.sendOrderStatusNotification(
//         order.business,
//         order.orderNumber,
//         'completed',
//         {
//           courierName: courierName,
//           completedAt: order.completedDate,
//           orderType: order.orderShipping?.orderType || 'Standard'
//         }
//       );
//       console.log(`📱 Push notification sent to business ${order.business} about order ${order.orderNumber} completion`);
//     } catch (notificationError) {
//       console.error(`❌ Failed to send push notification for order ${order.orderNumber}:`, notificationError);
//       // Don't fail the order completion if notification fails
//     }
    
//     // Check if request expects JSON response (API call)
//     if (req.headers.accept && req.headers.accept.includes('application/json')) {
//       return res.status(200).json({ message: 'Order completed successfully' });
//     }
    
//     // For web requests, redirect back to order details
//     req.flash('success', 'Order completed successfully');
//     res.redirect(`/courier/order-details/${orderNumber}`);
//   } catch (error) {
//     console.log(error.message);
//     if (req.headers.accept && req.headers.accept.includes('application/json')) {
//       return res.status(500).json({ message: error.message });
//     }
//     req.flash('error', 'Internal Server Error');
//     res.redirect('/courier/orders');
//   }
// };

// Enhanced pick up return from customer with comprehensive tracking
const pickupReturn = async (req, res) => {
  const { orderNumber } = req.params;
  // Handle both API (JWT) and web (session) authentication
  const courierId = req.courierId || req.userId;
  
  if (!courierId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Courier ID not found in request' });
    }
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/returns');
  }
  
  const {
    notes,
    pickupLocation,
    pickupPhotos,
    customerSignature,
    returnCondition,
    returnValue,
  } = req.body || {};

  try {
    // Find the return order by scanning the ORIGINAL order number (not the return order number)
    // The scanned orderNumber should match the originalOrderNumber field in the return order
    let order = await Order.findOne({
      'orderShipping.originalOrderNumber': orderNumber,
      'orderShipping.orderType': 'Return',
      orderStatus: 'returnAssigned',
      deliveryMan: courierId,
    });
    
    // If not found by originalOrderNumber, also try finding via smartFlyerBarcode of the original order
    if (!order) {
      // First, try to find the original deliver order by smartFlyerBarcode
      const originalOrder = await Order.findOne({
        $or: [
          { orderNumber: orderNumber },
          { smartFlyerBarcode: orderNumber }
        ],
        'orderShipping.orderType': 'Deliver',
      });
      
      if (originalOrder) {
        // Then find the return order that references this original order
        const returnOrder = await Order.findOne({
          'orderShipping.originalOrderNumber': originalOrder.orderNumber,
          'orderShipping.orderType': 'Return',
          orderStatus: 'returnAssigned',
          deliveryMan: courierId,
        });
        
        if (returnOrder) {
          // Use the return order found via original order lookup
          order = returnOrder;
        }
      }
    }
    
    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ 
          message: 'Return order not found. Please scan the ORIGINAL order number, not the return order number.' 
        });
      }
      req.flash('error', 'Return order not found. Please scan the ORIGINAL order number.');
      return res.redirect('/courier/returns');
    }

    if (order.orderStatus !== 'returnAssigned') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for return pickup Must be returnAssigned`,
        });
      }
      req.flash('error', `Order status ${order.orderStatus} is not valid for return pickup`);
      return res.redirect(`/courier/return-orders/${order.orderNumber}`);
    }

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
        message: 'Return picked up successfully',
        order: order,
        nextAction: 'Deliver to warehouse',
      });
    }
    
    // For web requests, redirect back to return details (use return order number, not original)
    req.flash('success', 'Return picked up successfully');
    res.redirect(`/courier/return-orders/${order.orderNumber}`);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/returns');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/returns');
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
      req.flash('error', 'Order not found');
      return res.redirect('/courier/returns');
    }

    if (order.orderStatus !== 'returnPickedUp') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for warehouse delivery`,
        });
      }
      req.flash('error', `Order status ${order.orderStatus} is not valid for warehouse delivery`);
      return res.redirect(`/courier/return-orders/${orderNumber}`);
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
      return res.status(200).json({
        message: 'Return delivered to warehouse successfully',
        order: order,
        nextAction: 'Wait for admin inspection and processing',
      });
    }
    
    // For web requests, redirect back to return details
    req.flash('success', 'Return delivered to warehouse successfully');
    res.redirect(`/courier/return-orders/${orderNumber}`);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/returns');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/returns');
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
      req.flash('error', 'Order not found');
      return res.redirect('/courier/returns');
    }

    if (order.orderStatus !== 'returnToBusiness') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          message: `Order status ${order.orderStatus} is not valid for business delivery`,
        });
      }
      req.flash('error', `Order status ${order.orderStatus} is not valid for business delivery`);
      return res.redirect(`/courier/return-orders/${orderNumber}`);
    }

    order.orderStatus = 'returnCompleted';

    // Determine courier name safely for API requests where req.courierData might be undefined
    const courierName = (req.courierData && req.courierData.name) || (order.deliveryMan && order.deliveryMan.name) || 'Courier';

    // Update returnCompleted stage with comprehensive details
    order.orderStages.returnCompleted = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Return completed and delivered to business by courier ${
        courierName
      }${notes ? ': ' + notes : ''}`,
      completedBy: courierId,
      deliveryLocation: deliveryLocation || order.business.address,
      businessSignature: businessSignature || null,
    };

    // Set completion date
    order.completedDate = new Date();

    // Add to courier history
    order.courierHistory.push({
      courier: courierId,
      assignedAt: new Date(),
      action: 'delivered_to_business',
      notes: `Courier ${
        courierName
      } completed return delivery to business${notes ? ': ' + notes : ''}`,
    });

    await order.save();

    // Send push notification to business about return completion
    try {
      await firebase.sendOrderStatusNotification(
        order.business,
        order.orderNumber,
        'returnCompleted',
        {
          courierName: courierName,
          completedAt: order.completedDate,
          returnReason: order.orderShipping?.returnReason || 'Customer return'
        }
      );
      console.log(`📱 Push notification sent to business ${order.business} about return completion for order ${order.orderNumber}`);
    } catch (notificationError) {
      console.error(`❌ Failed to send push notification for return completion ${order.orderNumber}:`, notificationError);
      // Don't fail the return completion if notification fails
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
      return res.status(200).json({
        message: 'Return completed successfully',
        order: order,
        completionDate: order.completedDate,
      });
    }
    
    // For web requests, redirect back to return details
    req.flash('success', 'Return completed successfully');
    res.redirect(`/courier/return-orders/${orderNumber}`);
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/returns');
  }
};

//=============================================== PickUps =============================================== //

const get_pickupsPage = (req, res) => {
  res.render('courier/pickups', {
    title: 'Pickups',
    page_title: 'Pickups',
    folder: 'Pages',
  });
};

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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/pickups');
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
      req.flash('error', 'Pickup not found');
      return res.redirect('/courier/pickups');
    }
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ pickup: pickup });
    }
    
    // Render page for web requests
    res.render('courier/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: pickup,
      courierData: req.courierData
    });
  } catch (error) {
    console.log(error.message);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/pickups');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/pickups');
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
      req.flash('error', 'Pickup not found');
      return res.redirect('/courier/pickups');
    }
    
    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ orders: pickup.ordersPickedUp });
    }
    
    // For web requests, render the pickup details page with orders
    res.render('courier/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: pickup,
      orders: pickup.ordersPickedUp,
      courierData: req.courierData
    });
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/pickups');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/pickups');
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
      req.flash('error', 'Pickup not found');
      return res.redirect('/courier/pickups');
    }

    if (pickup.ordersPickedUp.length === pickup.numberOfOrders) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Maximum number of orders reached for this pickup' });
      }
      req.flash('error', 'Maximum number of orders reached for this pickup');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
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
      req.flash('error', 'You cannot add a pickup order at this moment.');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.assignedDriver._id.toString() !== courierId) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(403).json({ message: 'You are not authorized to view this order' });
      }
      req.flash('error', 'You are not authorized to view this order');
      return res.redirect('/courier/pickups');
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
      req.flash('error', 'Order not found');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (!pickup.ordersPickedUp.includes(order._id)) {
      pickup.ordersPickedUp.push(order._id);
    }
    // Recalculate pickup fee based on picked orders count and business city
    const businessCity = pickup?.business?.pickUpAdress?.city || '';
    const pickedCount = pickup.ordersPickedUp.length;
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
    req.flash('success', 'Order picked up successfully');
    res.redirect(`/courier/pickup-details/${pickupNumber}`);
  } catch (error) {
    console.log(error.message);
    if (error.name === 'ValidationError' && error.errors.ordersPickedUp) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Order is already picked up' });
      }
      req.flash('error', 'Order is already picked up');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    } else {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(500).json({ message: error.message });
      }
      req.flash('error', 'Internal Server Error');
      res.redirect('/courier/pickups');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/pickups');
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
      req.flash('error', 'Pickup not found');
      return res.redirect('/courier/pickups');
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
      req.flash('error', 'You Cannot delete it at this moment');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ message: 'Order not found' });
      }
      req.flash('error', 'Order not found');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }
    if (!pickup.ordersPickedUp.includes(order._id)) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Order is not picked up' });
      }
      req.flash('error', 'Order is not picked up');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    const index = pickup.ordersPickedUp.indexOf(order._id);
    pickup.ordersPickedUp.splice(index, 1);
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
    const pickedCount = pickup.ordersPickedUp.length;
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
    req.flash('success', 'Order removed successfully');
    res.redirect(`/courier/pickup-details/${pickupNumber}`);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/pickups');
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
    req.flash('error', 'Unauthorized');
    return res.redirect('/courier/pickups');
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
      req.flash('error', 'Pickup not found');
      return res.redirect('/courier/pickups');
    }

    if (pickup.picikupStatus === 'canceled') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is canceled' });
      }
      req.flash('error', 'Pickup is canceled');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.picikupStatus === 'rejected') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already rejected' });
      }
      req.flash('error', 'Pickup is already rejected');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.picikupStatus === 'completed') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already completed' });
      }
      req.flash('error', 'Pickup is already completed');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.picikupStatus === 'inStock') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is in stock' });
      }
      req.flash('error', 'Pickup is in stock');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.picikupStatus === 'pickedUp') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'Pickup is already Completed' });
      }
      req.flash('error', 'Pickup is already Completed');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
    }

    if (pickup.ordersPickedUp.length === 0) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ message: 'No orders picked up' });
      }
      req.flash('error', 'No orders picked up');
      return res.redirect(`/courier/pickup-details/${pickupNumber}`);
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
      // Update packed stage for pickup completion
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = `Order picked up by courier ${courierName}`;
      }
      await order.save();
    }

    await pickup.save();

    // Send push notification to business about pickup completion
    try {
      await firebase.sendOrderStatusNotification(
        pickup.business,
        pickup.pickupNumber,
        'pickedUp',
        {
          courierName: courierName,
          pickedUpAt: new Date(),
          ordersCount: pickup.ordersPickedUp.length,
          pickupFees: pickup.pickupFees
        }
      );
      console.log(`📱 Push notification sent to business ${pickup.business} about pickup completion for pickup ${pickup.pickupNumber}`);
    } catch (notificationError) {
      console.error(`❌ Failed to send push notification for pickup completion ${pickup.pickupNumber}:`, notificationError);
      // Don't fail the pickup completion if notification fails
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ message: 'Pickup completed successfully' });
    }
    
    // For web requests, redirect back to pickup details
    req.flash('success', 'Pickup completed successfully');
    res.redirect(`/courier/pickup-details/${pickupNumber}`);
  } catch (error) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ message: error.message });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/pickups');
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
  res.redirect('/courier-login');
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
      .populate('business', 'name email phoneNumber')
      .populate('deliveryMan', 'name phoneNumber');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found by order number or smart flyer barcode' 
      });
    }

    // Verify this is a fast shipping order
    if (!order.orderShipping || !order.orderShipping.isExpressShipping) {
      return res.status(400).json({ 
        success: false, 
        message: 'This is not a fast shipping order' 
      });
    }

    // Verify the order is in progress and assigned to this courier
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

    // Mark all previous stages as completed and update status
    const now = new Date();
    
    // Mark packed stage as completed
    if (!order.orderStages.packed.isCompleted) {
      order.orderStages.packed = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - marked as completed after business pickup scan'
      };
    }

    // Mark shipping stage as completed
    if (!order.orderStages.shipping.isCompleted) {
      order.orderStages.shipping = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - marked as completed after business pickup scan'
      };
    }

    // Mark outForDelivery stage as completed
    if (!order.orderStages.outForDelivery.isCompleted) {
      order.orderStages.outForDelivery = {
        isCompleted: true,
        completedAt: now,
        notes: 'Fast shipping - ready for delivery to customer'
      };
    }

    // Update order status to headingToCustomer
    order.orderStatus = 'headingToCustomer';
    order.statusCategory = 'PROCESSING';

    // Add to courier history
    order.courierHistory.push({
      courier: courierId,
      assignedAt: now,
      action: 'pickup_from_warehouse',
      notes: 'Fast shipping order scanned - stages marked as completed, proceeding to customer delivery'
    });

    // Generate and send 24h OTP to customer for delivery verification
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    // Hash OTP using bcrypt already available in this controller
    order.deliveryOtp = {
      otpHash: require('bcrypt').hashSync(otp, 10),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      verifiedAt: null,
      attempts: 0,
    };

    // Send SMS (best-effort; non-blocking failures)
    const phone = order.orderCustomer?.phoneNumber;
    const brand = order.business?.brandInfo?.brandName || order.business?.name || 'Your Order';
    if (phone) {
      sendSms({ recipient: phone, message: `NowShipping - ${brand}: Your delivery OTP for order ${order.orderNumber} is ${otp}. Valid for 24 hours.` })
        .catch((e) => console.error('SMS send error (delivery OTP):', e.details || e.message));
    }

    // Save the order
    await order.save();

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

// Get courier shop orders page
const getCourierShopOrdersPage = (req, res) => {
  res.render('courier/shop-orders', {
    title: 'Shop Orders',
    page_title: 'Shop Deliveries',
    folder: 'Shop',
  });
};

// Get courier shop order details page
const getCourierShopOrderDetailsPage = async (req, res) => {
  try {
    const { id } = req.params;
    const courierId = (req.courierData && req.courierData._id) || req.courierId || req.userId;
    
    if (!courierId) {
      req.flash('error', 'Unauthorized');
      return res.redirect('/courier/shop-orders');
    }

    const order = await ShopOrder.findOne({ _id: id, courier: courierId })
      .populate('business', 'brandInfo phone email')
      .populate('items.product')
      .populate('trackingHistory.updatedBy', 'name');

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/courier/shop-orders');
    }

    // Enhance order with consistent data structure
    const enhancedOrder = {
      ...order.toObject(),
      // Ensure all required fields are present
      orderNumber: order.orderNumber || 'N/A',
      status: order.status || 'pending',
      createdAt: order.createdAt || new Date(),
      contactInfo: order.contactInfo || {},
      orderCustomer: order.orderCustomer || {},
      items: order.items || [],
      trackingHistory: order.trackingHistory || [],
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      tax: order.tax || 0,
      deliveryFee: order.deliveryFee || 0,
      totalAmount: order.totalAmount || 0
    };

    res.render('courier/shop-order-details', {
      title: 'Shop Order Details',
      page_title: 'Delivery Details',
      folder: 'Shop',
      order: enhancedOrder,
      courierData: req.courierData
    });
  } catch (error) {
    console.error('Error loading courier shop order details:', error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/shop-orders');
  }
};

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
      req.flash('error', 'Unauthorized');
      return res.redirect('/courier/shop-orders');
    }

    const order = await ShopOrder.findOne({ _id: id, courier: courierId })
      .populate('business', 'brandInfo phone email')
      .populate('items.product');

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      req.flash('error', 'Order not found');
      return res.redirect('/courier/shop-orders');
    }

    // Check if request expects JSON response (API call)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json(order);
    }
    
    // For web requests, render the shop order details page
    res.render('courier/shop-order-details', {
      title: 'Shop Order Details',
      page_title: 'Delivery Details',
      folder: 'Shop',
      order: order,
      courierData: req.courierData
    });
  } catch (error) {
    console.error('Error fetching order details:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ error: 'Failed to fetch order details' });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/shop-orders');
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
      req.flash('error', 'Unauthorized');
      return res.redirect('/courier/shop-orders');
    }

    const order = await ShopOrder.findOne({ _id: id, courier: courierId });

    if (!order) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ error: 'Order not found' });
      }
      req.flash('error', 'Order not found');
      return res.redirect('/courier/shop-orders');
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
      req.flash('error', `Invalid status transition from '${order.status}' to '${status}'`);
      return res.redirect(`/courier/shop-orders/${id}`);
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
    req.flash('success', `Order status successfully updated from '${previousStatus}' to '${status}'`);
    res.redirect(`/courier/shop-orders/${id}`);
  } catch (error) {
    console.error('Error updating order status:', error);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ error: 'Failed to update order status' });
    }
    req.flash('error', 'Internal Server Error');
    res.redirect('/courier/shop-orders');
  }
};

module.exports = {
  getDashboardPage,
  get_ordersPage,
  get_orders,
  get_orderDetails,
  completeOrder,

  get_pickupsPage,
  get_pickups,
  get_pickupDetails,
  getAndSet_order_To_Pickup,
  get_picked_up_orders,
  removePickedUpOrder,
  updateOrderStatus,
  completePickup,
  logOut,
  pickupReturn,
  deliverReturnToWarehouse,
  completeReturnToBusiness,
  get_returns,
  get_returnsPage,
  getReturnOrderDetails,
  getCurrentReturnStage,
  getNextReturnAction,
  scanFastShippingOrder,

  // Shop functions
  getCourierShopOrdersPage,
  getCourierShopOrderDetailsPage,
  getCourierShopOrders,
  getCourierShopOrderDetails,
  updateCourierShopOrderStatus,
};
