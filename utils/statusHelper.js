/**
 * Status Helper Utility
 * Provides consistent status management functions across the application
 */

/**
 * Status category definitions
 */
const STATUS_CATEGORIES = {
  NEW: 'NEW',
  PROCESSING: 'PROCESSING',
  PAUSED: 'PAUSED',
  SUCCESSFUL: 'SUCCESSFUL',
  UNSUCCESSFUL: 'UNSUCCESSFUL'
};

/**
 * Status flow definitions for each order type
 */
const STATUS_FLOWS = {
  Deliver: ['new', 'pickedUp', 'inStock', 'inProgress', 'headingToCustomer', 'completed'],
  Return: ['new', 'returnInitiated', 'returnAssigned', 'returnPickedUp', 'returnAtWarehouse', 'returnInspection', 'returnProcessing', 'returnToBusiness', 'returnCompleted'],
  Exchange: ['new', 'pickedUp', 'inStock', 'inProgress', 'headingToCustomer', 'exchangePickup', 'exchangeDelivery', 'completed'],
  'Cash Collection': ['new', 'pickedUp', 'inStock', 'inProgress', 'headingToCustomer', 'collectionComplete', 'completed']
};

/**
 * Order status definitions with their categories
 */
const ORDER_STATUSES = {
  // NEW category
  new: { category: STATUS_CATEGORIES.NEW, label: 'New', description: 'Order has been created' },
  pendingPickup: { category: STATUS_CATEGORIES.NEW, label: 'Pending Pickup', description: 'Order is waiting for pickup' },
  
  // PROCESSING category
  pickedUp: { category: STATUS_CATEGORIES.PROCESSING, label: 'Picked Up', description: 'Order has been picked up from business' },
  inStock: { category: STATUS_CATEGORIES.PROCESSING, label: 'In Stock', description: 'Order is in warehouse' },
  inReturnStock: { category: STATUS_CATEGORIES.PROCESSING, label: 'In Return Stock', description: 'Return order is in warehouse' },
  inProgress: { category: STATUS_CATEGORIES.PROCESSING, label: 'In Progress', description: 'Order is being processed' },
  headingToCustomer: { category: STATUS_CATEGORIES.PROCESSING, label: 'Heading to Customer', description: 'Order is on the way to customer' },
  returnToWarehouse: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return to Warehouse', description: 'Return is on the way to warehouse' },
  headingToYou: { category: STATUS_CATEGORIES.PROCESSING, label: 'Heading to You', description: 'Order is heading to business (return)' },
  rescheduled: { category: STATUS_CATEGORIES.PROCESSING, label: 'Rescheduled', description: 'Delivery has been rescheduled' },
  returnInitiated: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return Initiated', description: 'Return has been initiated' },
  returnAssigned: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return Assigned', description: 'Courier assigned to return' },
  returnPickedUp: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return Picked Up', description: 'Return has been picked up from customer' },
  returnAtWarehouse: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return at Warehouse', description: 'Return is at warehouse' },
  returnToBusiness: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return to Business', description: 'Return is on the way to business' },
  
  // Exchange-specific statuses
  exchangePickup: { category: STATUS_CATEGORIES.PROCESSING, label: 'Exchange Pickup', description: 'Original item picked up for exchange' },
  exchangeDelivery: { category: STATUS_CATEGORIES.PROCESSING, label: 'Exchange Delivery', description: 'Replacement item being delivered' },
  
  // Cash Collection-specific statuses
  collectionComplete: { category: STATUS_CATEGORIES.PROCESSING, label: 'Collection Complete', description: 'Cash has been collected successfully' },
  
  // PAUSED category
  waitingAction: { category: STATUS_CATEGORIES.PAUSED, label: 'Awaiting Action', description: 'Order is waiting for business action' },
  rejected: { category: STATUS_CATEGORIES.PAUSED, label: 'Rejected', description: 'Order has been rejected by courier' },
  
  // SUCCESSFUL category
  completed: { category: STATUS_CATEGORIES.SUCCESSFUL, label: 'Completed', description: 'Order has been successfully delivered' },
  returnCompleted: { category: STATUS_CATEGORIES.SUCCESSFUL, label: 'Return Completed', description: 'Return has been successfully completed' },
  
  // UNSUCCESSFUL category
  canceled: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Canceled', description: 'Order has been canceled' },
  returned: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Returned', description: 'Order has been returned to business' },
  terminated: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Terminated', description: 'Order has been terminated' },
  deliveryFailed: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Delivery Failed', description: 'Delivery has failed' },
  autoReturnInitiated: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Auto-Return Initiated', description: 'System initiated return' },
  returnLinked: { category: STATUS_CATEGORIES.PROCESSING, label: 'Return Linked', description: 'Return order linked to deliver order' }
};

/**
 * Pickup status definitions with their categories
 */
const PICKUP_STATUSES = {
  // NEW category
  new: { category: STATUS_CATEGORIES.NEW, label: 'New', description: 'Pickup request has been created' },
  pendingPickup: { category: STATUS_CATEGORIES.NEW, label: 'Pending Pickup', description: 'Pickup is waiting to be assigned' },
  driverAssigned: { category: STATUS_CATEGORIES.NEW, label: 'Driver Assigned', description: 'Driver has been assigned to pickup' },
  
  // PROCESSING category
  pickedUp: { category: STATUS_CATEGORIES.PROCESSING, label: 'Picked Up', description: 'Orders have been picked up' },
  inStock: { category: STATUS_CATEGORIES.PROCESSING, label: 'In Stock', description: 'Pickup is in warehouse' },
  inProgress: { category: STATUS_CATEGORIES.PROCESSING, label: 'In Progress', description: 'Pickup is being processed' },
  
  // SUCCESSFUL category
  completed: { category: STATUS_CATEGORIES.SUCCESSFUL, label: 'Completed', description: 'Pickup has been successfully completed' },
  
  // UNSUCCESSFUL category
  canceled: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Canceled', description: 'Pickup has been canceled' },
  rejected: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Rejected', description: 'Pickup has been rejected by driver' },
  returned: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Returned', description: 'Pickup has been returned to business' },
  terminated: { category: STATUS_CATEGORIES.UNSUCCESSFUL, label: 'Terminated', description: 'Pickup has been terminated' }
};

/**
 * Order type definitions
 */
const ORDER_TYPES = {
  Deliver: { label: 'Deliver', description: 'Standard delivery order' },
  Return: { label: 'Return', description: 'Return order' },
  Exchange: { label: 'Exchange', description: 'Exchange order with replacement items' },
  'Cash Collection': { label: 'Cash Collection', description: 'Cash collection without product delivery' },
  'Sign & Return': { label: 'Sign & Return', description: 'Sign and return order' }
};

/**
 * Get the category for a given order status
 * @param {string} status - The order status
 * @returns {string} The category name
 */
function getOrderStatusCategory(status) {
  return ORDER_STATUSES[status]?.category || STATUS_CATEGORIES.NEW;
}

/**
 * Get the human-readable label for a given order status
 * @param {string} status - The order status
 * @returns {string} The status label
 */
function getOrderStatusLabel(status) {
  return ORDER_STATUSES[status]?.label || status;
}

/**
 * Get the description for a given order status
 * @param {string} status - The order status
 * @returns {string} The status description
 */
function getOrderStatusDescription(status) {
  return ORDER_STATUSES[status]?.description || '';
}

/**
 * Get the category for a given pickup status
 * @param {string} status - The pickup status
 * @returns {string} The category name
 */
function getPickupStatusCategory(status) {
  return PICKUP_STATUSES[status]?.category || STATUS_CATEGORIES.NEW;
}

/**
 * Get the human-readable label for a given pickup status
 * @param {string} status - The pickup status
 * @returns {string} The status label
 */
function getPickupStatusLabel(status) {
  return PICKUP_STATUSES[status]?.label || status;
}

/**
 * Get the description for a given pickup status
 * @param {string} status - The pickup status
 * @returns {string} The status description
 */
function getPickupStatusDescription(status) {
  return PICKUP_STATUSES[status]?.description || '';
}

/**
 * Get all statuses for a specific category
 * @param {string} category - The category name
 * @returns {Array} Array of status names in that category
 */
function getStatusesByCategory(category) {
  return Object.keys(ORDER_STATUSES).filter(status => 
    ORDER_STATUSES[status].category === category
  );
}

/**
 * Get all pickup statuses for a specific category
 * @param {string} category - The category name
 * @returns {Array} Array of pickup status names in that category
 */
function getPickupStatusesByCategory(category) {
  return Object.keys(PICKUP_STATUSES).filter(status => 
    PICKUP_STATUSES[status].category === category
  );
}

/**
 * Get the CSS class for a status category (for UI display)
 * @param {string} category - The category name
 * @returns {string} The CSS class name
 */
function getCategoryClass(category) {
  const classMap = {
    [STATUS_CATEGORIES.NEW]: 'status-new',
    [STATUS_CATEGORIES.PROCESSING]: 'status-processing',
    [STATUS_CATEGORIES.PAUSED]: 'status-paused',
    [STATUS_CATEGORIES.SUCCESSFUL]: 'status-successful',
    [STATUS_CATEGORIES.UNSUCCESSFUL]: 'status-unsuccessful'
  };
  return classMap[category] || 'status-default';
}

/**
 * Get the color for a status category (for UI display)
 * @param {string} category - The category name
 * @returns {string} The color code
 */
function getCategoryColor(category) {
  const colorMap = {
    [STATUS_CATEGORIES.NEW]: '#3498db', // Blue
    [STATUS_CATEGORIES.PROCESSING]: '#f39c12', // Orange
    [STATUS_CATEGORIES.PAUSED]: '#e74c3c', // Red
    [STATUS_CATEGORIES.SUCCESSFUL]: '#2ecc71', // Green
    [STATUS_CATEGORIES.UNSUCCESSFUL]: '#95a5a6' // Gray
  };
  return colorMap[category] || '#000000';
}

/**
 * Check if a status transition is valid
 * @param {string} currentStatus - The current status
 * @param {string} newStatus - The new status
 * @returns {boolean} Whether the transition is valid
 */
function isValidStatusTransition(currentStatus, newStatus) {
  // Define allowed transitions
  const allowedTransitions = {
    'new': ['pendingPickup', 'pickedUp', 'canceled'],
    'pendingPickup': ['pickedUp', 'canceled', 'driverAssigned'],
    'pickedUp': ['inStock', 'returnToWarehouse', 'canceled'],
    'inStock': ['inProgress', 'inReturnStock', 'canceled'],
    'inReturnStock': ['returnToBusiness', 'canceled'],
    'inProgress': ['headingToCustomer', 'canceled'],
    'headingToCustomer': ['completed', 'waitingAction', 'rejected', 'returnToWarehouse', 'collectionComplete', 'exchangePickup'], // For Exchange orders, should go to exchangePickup
    'returnToWarehouse': ['inReturnStock', 'canceled'],
    'headingToYou': ['returnCompleted', 'waitingAction'],
    'rescheduled': ['headingToCustomer', 'canceled'],
    'waitingAction': ['headingToCustomer', 'returnToWarehouse', 'canceled'],
    'completed': ['returnInitiated'],
    'returnInitiated': ['returnAssigned', 'canceled'],
    'returnAssigned': ['returnPickedUp', 'canceled'],
    'returnPickedUp': ['returnAtWarehouse', 'canceled'],
    'returnAtWarehouse': ['returnToBusiness', 'canceled'],
    'returnToBusiness': ['returnCompleted', 'canceled'],
    'returnCompleted': [],
    'canceled': [],
    'rejected': ['returnToWarehouse', 'waitingAction'],
    'returned': [],
    'terminated': [],
    'deliveryFailed': ['returnToWarehouse', 'waitingAction'],
    'autoReturnInitiated': ['returnAssigned'],
    'returnLinked': ['returnPickedUp'],
    // Exchange-specific transitions - more restrictive to ensure proper flow
    'exchangePickup': ['exchangeDelivery'], // After picking up original item, must proceed to delivery completion
    'exchangeDelivery': ['completed'], // After exchange delivery, only completion is allowed
    // Cash Collection-specific transitions
    'collectionComplete': ['completed', 'waitingAction', 'rejected']
  };
  
  // Check if transition is allowed
  return allowedTransitions[currentStatus]?.includes(newStatus) || false;
}

/**
 * Get the next possible statuses for a given status
 * @param {string} currentStatus - The current status
 * @returns {Array} Array of possible next statuses
 */
function getNextPossibleStatuses(currentStatus) {
  // Define allowed transitions
  const allowedTransitions = {
    'new': ['pendingPickup', 'pickedUp', 'canceled'],
    'pendingPickup': ['pickedUp', 'canceled', 'driverAssigned'],
    'pickedUp': ['inStock', 'returnToWarehouse', 'canceled'],
    'inStock': ['inProgress', 'inReturnStock', 'canceled'],
    'inReturnStock': ['returnToBusiness', 'canceled'],
    'inProgress': ['headingToCustomer', 'canceled'],
    'headingToCustomer': ['completed', 'waitingAction', 'rejected', 'returnToWarehouse', 'collectionComplete', 'exchangePickup'], // For Exchange orders, should go to exchangePickup
    'returnToWarehouse': ['inReturnStock', 'canceled'],
    'headingToYou': ['returnCompleted', 'waitingAction'],
    'rescheduled': ['headingToCustomer', 'canceled'],
    'waitingAction': ['headingToCustomer', 'returnToWarehouse', 'canceled'],
    'completed': ['returnInitiated'],
    'returnInitiated': ['returnAssigned', 'canceled'],
    'returnAssigned': ['returnPickedUp', 'canceled'],
    'returnPickedUp': ['returnAtWarehouse', 'canceled'],
    'returnAtWarehouse': ['returnToBusiness', 'canceled'],
    'returnToBusiness': ['returnCompleted', 'canceled'],
    'returnCompleted': [],
    'canceled': [],
    'rejected': ['returnToWarehouse', 'waitingAction'],
    'returned': [],
    'terminated': [],
    'deliveryFailed': ['returnToWarehouse', 'waitingAction'],
    'autoReturnInitiated': ['returnAssigned'],
    'returnLinked': ['returnPickedUp'],
    // Exchange-specific transitions - more restrictive to ensure proper flow
    'exchangePickup': ['exchangeDelivery'], // After picking up original item, must proceed to delivery completion
    'exchangeDelivery': ['completed'], // After exchange delivery, only completion is allowed
    // Cash Collection-specific transitions
    'collectionComplete': ['completed', 'waitingAction', 'rejected']
  };
  
  return allowedTransitions[currentStatus] || [];
}

module.exports = {
  STATUS_CATEGORIES,
  ORDER_STATUSES,
  PICKUP_STATUSES,
  ORDER_TYPES,
  getOrderStatusCategory,
  getOrderStatusLabel,
  getOrderStatusDescription,
  getPickupStatusCategory,
  getPickupStatusLabel,
  getPickupStatusDescription,
  getStatusesByCategory,
  getPickupStatusesByCategory,
  getCategoryClass,
  getCategoryColor,
  isValidStatusTransition,
  getNextPossibleStatuses
};
