const MID_RETURN_STATUSES = new Set([
  'returnToWarehouse',
  'returnAtWarehouse',
  'returnInitiated',
  'returnAssigned',
  'returnPickedUp',
  'returnToBusiness',
  'inReturnStock',
  'returnLinked',
  'headingToYou',
  'autoReturnInitiated',
]);

/**
 * Single source of truth for business-like order cancellation (return vs hard cancel).
 * Mutates the order document in memory; caller must save and handle side effects (e.g. push).
 *
 * @param {import('mongoose').Document} order - Order document
 * @param {{ canceledBy: 'business' | 'admin' }} options
 * @returns {{ result: string, message: string, notifyCourier?: boolean }}
 */
function applyBusinessLikeCancellation(order, options) {
  const canceledBy = options.canceledBy === 'admin' ? 'admin' : 'business';
  const actorWord = canceledBy === 'admin' ? 'admin' : 'business';
  const returnInitiatedBy = canceledBy === 'admin' ? 'admin' : 'business';

  if (MID_RETURN_STATUSES.has(order.orderStatus)) {
    return {
      result: 'already_in_return',
      message:
        'This order is already in the return process. Use warehouse or return tools for the next steps.',
    };
  }

  const isOrderPickedUp = order.orderStages.packed && order.orderStages.packed.isCompleted;
  const isOrderInProgress = order.orderStages.shipping && order.orderStages.shipping.isCompleted;
  const isOrderOutForDelivery =
    order.orderStages.outForDelivery && order.orderStages.outForDelivery.isCompleted;

  // Not yet on delivery path → hard cancel
  if (!isOrderPickedUp && !isOrderInProgress && !isOrderOutForDelivery) {
    order.orderStatus = 'canceled';
    order.orderStages.canceled = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Order canceled by ${actorWord} before pickup`,
      canceledBy,
    };
    return {
      result: 'hard_cancel',
      message: 'Order canceled successfully.',
      notifyCourier: !!(order.deliveryMan && String(order.deliveryMan).length),
    };
  }

  // Exchange: never coerce into return flow
  if (order.orderShipping && order.orderShipping.orderType === 'Exchange') {
    order.orderStatus = 'canceled';
    order.orderStages.canceled = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Exchange order canceled by ${actorWord} after pickup — no return leg initiated`,
      canceledBy,
      reason: canceledBy === 'admin' ? 'admin_canceled' : 'business_canceled',
    };
    return {
      result: 'exchange_cancel',
      message: 'Exchange order canceled successfully.',
      notifyCourier: !!(order.deliveryMan && String(order.deliveryMan).length),
    };
  }

  const returnReasonKey = canceledBy === 'admin' ? 'admin_canceled' : 'business_canceled';

  if (order.orderStatus === 'pickedUp') {
    order.orderStatus = 'returnToWarehouse';
    if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
      order.orderShipping.returnReason = returnReasonKey;
      order.orderShipping.orderType = 'Return';
    }
    order.orderStages.returnInitiated = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Order canceled by ${actorWord} after pickup — moved to return flow`,
      initiatedBy: returnInitiatedBy,
      reason: returnReasonKey,
    };
    order.orderStages.returnPickedUp = {
      isCompleted: true,
      completedAt: new Date(),
      notes: 'Return picked up (courier already has the order from original pickup)',
      pickedUpBy: order.deliveryMan,
    };
    return { result: 'return_to_warehouse', message: 'Order moved to return to warehouse.' };
  }

  if (order.orderStatus === 'inStock') {
    order.orderStatus = 'returnAtWarehouse';
    if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
      order.orderShipping.returnReason = returnReasonKey;
      order.orderShipping.orderType = 'Return';
    }
    order.orderStages.returnInitiated = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Order canceled by ${actorWord} while in stock — moved to return flow`,
      initiatedBy: returnInitiatedBy,
      reason: returnReasonKey,
    };
    order.orderStages.returnPickedUp = {
      isCompleted: true,
      completedAt: new Date(),
      notes: 'Return picked up (order was already at warehouse)',
      pickedUpBy: order.deliveryMan,
    };
    order.orderStages.returnAtWarehouse = {
      isCompleted: true,
      completedAt: new Date(),
      notes: 'Return at warehouse (order was already at warehouse)',
      receivedBy: null,
      warehouseLocation: 'main_warehouse',
      conditionNotes: 'Order was already in stock before cancellation',
    };
    return { result: 'return_at_warehouse', message: 'Order moved to return at warehouse.' };
  }

  if (order.orderStatus === 'headingToCustomer') {
    order.orderStatus = 'returnToWarehouse';
    if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
      order.orderShipping.returnReason = returnReasonKey;
      order.orderShipping.orderType = 'Return';
    }
    order.orderStages.returnInitiated = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Order canceled by ${actorWord} while heading to customer — moved to return flow`,
      initiatedBy: returnInitiatedBy,
      reason: returnReasonKey,
    };
    if (order.deliveryMan) {
      order.courierHistory.push({
        courier: order.deliveryMan,
        assignedAt: new Date(),
        action: 'assigned',
        notes: 'Courier reassigned for return process after cancellation',
      });
      order.orderStages.returnAssigned = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Same courier assigned for return (preserved from original delivery)',
        assignedCourier: order.deliveryMan,
        assignedBy: null,
      };
    }
    return {
      result: 'heading_recall',
      message: 'Order heading to customer has been recalled to warehouse.',
    };
  }

  if (isOrderPickedUp || isOrderInProgress || isOrderOutForDelivery) {
    const statusBeforeReturn = order.orderStatus;
    order.orderStatus = 'returnToWarehouse';
    if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
      order.orderShipping.returnReason = returnReasonKey;
      order.orderShipping.orderType = 'Return';
    }
    if (!order.orderStages.returnInitiated || !order.orderStages.returnInitiated.isCompleted) {
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: `Order canceled by ${actorWord} after processing — moved to return flow`,
        initiatedBy: returnInitiatedBy,
        reason: returnReasonKey,
      };
    }
    if (order.deliveryMan) {
      order.courierHistory.push({
        courier: order.deliveryMan,
        assignedAt: new Date(),
        action: 'assigned',
        notes: 'Courier preserved for return process after cancellation',
      });
      order.orderStages.returnAssigned = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Same courier assigned for return (preserved from original delivery)',
        assignedCourier: order.deliveryMan,
        assignedBy: null,
      };
      if (statusBeforeReturn === 'headingToCustomer' || isOrderOutForDelivery) {
        order.orderStages.returnPickedUp = {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Return picked up (courier already has the order from delivery)',
          pickedUpBy: order.deliveryMan,
          pickupLocation: 'with_courier',
          pickupPhotos: [],
        };
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Order ${order.orderNumber} has completed stages but no courier assigned:`, {
        isOrderPickedUp,
        isOrderInProgress,
        isOrderOutForDelivery,
        orderStages: order.orderStages,
      });
      order.orderStages.returnAssigned = {
        isCompleted: false,
        completedAt: null,
        notes: 'No courier assigned - admin needs to assign courier for return',
        assignedCourier: null,
        assignedBy: null,
      };
    }
    if (order.orderStages.outForDelivery) {
      order.orderStages.outForDelivery.isCompleted = false;
    }
    if (order.orderStages.inProgress) {
      order.orderStages.inProgress.isCompleted = false;
    }
    return { result: 'return_pipeline', message: 'Order moved to return pipeline for processing.' };
  }

  order.orderStatus = 'canceled';
  order.orderStages.canceled = {
    isCompleted: true,
    completedAt: new Date(),
    notes: `Order canceled by ${actorWord}`,
    canceledBy,
  };
  return {
    result: 'hard_cancel_fallback',
    message: 'Order canceled successfully.',
    notifyCourier: false,
  };
}

module.exports = {
  applyBusinessLikeCancellation,
};
