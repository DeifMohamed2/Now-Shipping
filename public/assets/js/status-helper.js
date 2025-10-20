/**
 * Status Helper - Client-side status management utilities
 * Provides consistent status display and functionality across the application
 */

const StatusHelper = {
  /**
   * Status category definitions
   */
  STATUS_CATEGORIES: {
    NEW: 'NEW',
    PROCESSING: 'PROCESSING',
    PAUSED: 'PAUSED',
    SUCCESSFUL: 'SUCCESSFUL',
    UNSUCCESSFUL: 'UNSUCCESSFUL'
  },

  /**
   * Order status definitions with their categories
   */
  ORDER_STATUSES: {
    // NEW category
    'new': { category: 'NEW', label: 'New', description: 'Order has been created' },
    'pendingPickup': { category: 'NEW', label: 'Pending Pickup', description: 'Order is waiting for pickup' },
    
    // PROCESSING category
    'pickedUp': { category: 'PROCESSING', label: 'Picked Up', description: 'Order has been picked up from business' },
    'inStock': { category: 'PROCESSING', label: 'In Stock', description: 'Order is in warehouse' },
    'inReturnStock': { category: 'PROCESSING', label: 'In Return Stock', description: 'Return order is in warehouse' },
    'inProgress': { category: 'PROCESSING', label: 'In Progress', description: 'Order is being processed' },
    'headingToCustomer': { category: 'PROCESSING', label: 'Heading to Customer', description: 'Order is on the way to customer' },
    'returnToWarehouse': { category: 'PROCESSING', label: 'Return to Warehouse', description: 'Return is on the way to warehouse' },
    'headingToYou': { category: 'PROCESSING', label: 'Heading to You', description: 'Order is heading to business (return)' },
    'rescheduled': { category: 'PROCESSING', label: 'Rescheduled', description: 'Delivery has been rescheduled' },
    'returnInitiated': { category: 'PROCESSING', label: 'Return Initiated', description: 'Return has been initiated' },
    'returnAssigned': { category: 'PROCESSING', label: 'Return Assigned', description: 'Courier assigned to return' },
    'returnPickedUp': { category: 'PROCESSING', label: 'Return Picked Up', description: 'Return has been picked up from customer' },
    'returnAtWarehouse': { category: 'PROCESSING', label: 'Return at Warehouse', description: 'Return is at warehouse' },
    'returnToBusiness': { category: 'PROCESSING', label: 'Return to Business', description: 'Return is on the way to business' },
    
    // PAUSED category
    'waitingAction': { category: 'PAUSED', label: 'Awaiting Action', description: 'Order is waiting for business action' },
    'rejected': { category: 'PAUSED', label: 'Rejected', description: 'Order has been rejected by courier' },
    
    // SUCCESSFUL category
    'completed': { category: 'SUCCESSFUL', label: 'Completed', description: 'Order has been successfully delivered' },
    'returnCompleted': { category: 'SUCCESSFUL', label: 'Return Completed', description: 'Return has been successfully completed' },
    
    // UNSUCCESSFUL category
    'canceled': { category: 'UNSUCCESSFUL', label: 'Canceled', description: 'Order has been canceled' },
    'returned': { category: 'UNSUCCESSFUL', label: 'Returned', description: 'Order has been returned to business' },
    'terminated': { category: 'UNSUCCESSFUL', label: 'Terminated', description: 'Order has been terminated' },
    'deliveryFailed': { category: 'UNSUCCESSFUL', label: 'Delivery Failed', description: 'Delivery has failed' },
    'autoReturnInitiated': { category: 'UNSUCCESSFUL', label: 'Auto-Return Initiated', description: 'System initiated return' },
    'returnLinked': { category: 'PROCESSING', label: 'Return Linked', description: 'Return order linked to deliver order' }
  },

  /**
   * Pickup status definitions with their categories
   */
  PICKUP_STATUSES: {
    // NEW category
    'new': { category: 'NEW', label: 'New', description: 'Pickup request has been created' },
    'pendingPickup': { category: 'NEW', label: 'Pending Pickup', description: 'Pickup is waiting to be assigned' },
    'driverAssigned': { category: 'NEW', label: 'Driver Assigned', description: 'Driver has been assigned to pickup' },
    
    // PROCESSING category
    'pickedUp': { category: 'PROCESSING', label: 'Picked Up', description: 'Orders have been picked up' },
    'inStock': { category: 'PROCESSING', label: 'In Stock', description: 'Pickup is in warehouse' },
    'inProgress': { category: 'PROCESSING', label: 'In Progress', description: 'Pickup is being processed' },
    
    // SUCCESSFUL category
    'completed': { category: 'SUCCESSFUL', label: 'Completed', description: 'Pickup has been successfully completed' },
    
    // UNSUCCESSFUL category
    'canceled': { category: 'UNSUCCESSFUL', label: 'Canceled', description: 'Pickup has been canceled' },
    'rejected': { category: 'UNSUCCESSFUL', label: 'Rejected', description: 'Pickup has been rejected by driver' },
    'returned': { category: 'UNSUCCESSFUL', label: 'Returned', description: 'Pickup has been returned to business' },
    'terminated': { category: 'UNSUCCESSFUL', label: 'Terminated', description: 'Pickup has been terminated' }
  },

  /**
   * Order type definitions
   */
  ORDER_TYPES: {
    'Deliver': { label: 'Deliver', description: 'Standard delivery order' },
    'Return': { label: 'Return', description: 'Return order' },
    'Exchange': { label: 'Exchange', description: 'Exchange order' },
    'Cash Collection': { label: 'Cash Collection', description: 'Cash collection order' },
    'Sign & Return': { label: 'Sign & Return', description: 'Sign and return order' }
  },

  /**
   * Get the category for a given order status
   * @param {string} status - The order status
   * @returns {string} The category name
   */
  getOrderStatusCategory(status) {
    return this.ORDER_STATUSES[status]?.category || this.STATUS_CATEGORIES.NEW;
  },

  /**
   * Get the human-readable label for a given order status
   * @param {string} status - The order status
   * @returns {string} The status label
   */
  getOrderStatusLabel(status) {
    return this.ORDER_STATUSES[status]?.label || status;
  },

  /**
   * Get the description for a given order status
   * @param {string} status - The order status
   * @returns {string} The status description
   */
  getOrderStatusDescription(status) {
    return this.ORDER_STATUSES[status]?.description || '';
  },

  /**
   * Get the category for a given pickup status
   * @param {string} status - The pickup status
   * @returns {string} The category name
   */
  getPickupStatusCategory(status) {
    return this.PICKUP_STATUSES[status]?.category || this.STATUS_CATEGORIES.NEW;
  },

  /**
   * Get the human-readable label for a given pickup status
   * @param {string} status - The pickup status
   * @returns {string} The status label
   */
  getPickupStatusLabel(status) {
    return this.PICKUP_STATUSES[status]?.label || status;
  },

  /**
   * Get the description for a given pickup status
   * @param {string} status - The pickup status
   * @returns {string} The status description
   */
  getPickupStatusDescription(status) {
    return this.PICKUP_STATUSES[status]?.description || '';
  },

  /**
   * Get all statuses for a specific category
   * @param {string} category - The category name
   * @returns {Array} Array of status names in that category
   */
  getStatusesByCategory(category) {
    return Object.keys(this.ORDER_STATUSES).filter(status => 
      this.ORDER_STATUSES[status].category === category
    );
  },

  /**
   * Get all pickup statuses for a specific category
   * @param {string} category - The category name
   * @returns {Array} Array of pickup status names in that category
   */
  getPickupStatusesByCategory(category) {
    return Object.keys(this.PICKUP_STATUSES).filter(status => 
      this.PICKUP_STATUSES[status].category === category
    );
  },

  /**
   * Get the CSS class for a status category (for UI display)
   * @param {string} category - The category name
   * @returns {string} The CSS class name
   */
  getCategoryClass(category) {
    const classMap = {
      [this.STATUS_CATEGORIES.NEW]: 'status-new',
      [this.STATUS_CATEGORIES.PROCESSING]: 'status-processing',
      [this.STATUS_CATEGORIES.PAUSED]: 'status-paused',
      [this.STATUS_CATEGORIES.SUCCESSFUL]: 'status-successful',
      [this.STATUS_CATEGORIES.UNSUCCESSFUL]: 'status-unsuccessful'
    };
    return classMap[category] || 'status-default';
  },

  /**
   * Get the color for a status category (for UI display)
   * @param {string} category - The category name
   * @returns {string} The color code
   */
  getCategoryColor(category) {
    const colorMap = {
      [this.STATUS_CATEGORIES.NEW]: '#3498db', // Blue
      [this.STATUS_CATEGORIES.PROCESSING]: '#f39c12', // Orange
      [this.STATUS_CATEGORIES.PAUSED]: '#e74c3c', // Red
      [this.STATUS_CATEGORIES.SUCCESSFUL]: '#2ecc71', // Green
      [this.STATUS_CATEGORIES.UNSUCCESSFUL]: '#95a5a6' // Gray
    };
    return colorMap[category] || '#000000';
  },

  /**
   * Create a status badge element
   * @param {string} status - The status value
   * @param {string} type - 'order' or 'pickup'
   * @returns {HTMLElement} The badge element
   */
  createStatusBadge(status, type = 'order') {
    const statusInfo = type === 'order' ? 
      this.ORDER_STATUSES[status] : 
      this.PICKUP_STATUSES[status];
    
    if (!statusInfo) return null;
    
    const category = statusInfo.category;
    const label = statusInfo.label;
    
    const badge = document.createElement('span');
    badge.className = `status-badge ${this.getCategoryClass(category)}`;
    badge.textContent = label;
    
    return badge;
  },

  /**
   * Create a status pill element
   * @param {string} category - The category name
   * @param {string} label - The label to display
   * @returns {HTMLElement} The pill element
   */
  createStatusPill(category, label) {
    const categoryClass = this.getCategoryClass(category).replace('status-', '');
    
    const pill = document.createElement('span');
    pill.className = `status-pill ${categoryClass}`;
    pill.textContent = label;
    
    return pill;
  },

  /**
   * Create a status filter dropdown
   * @param {string} type - 'order' or 'pickup'
   * @param {Function} onChangeCallback - Callback when selection changes
   * @returns {HTMLElement} The dropdown element
   */
  createStatusFilter(type = 'order', onChangeCallback) {
    const container = document.createElement('div');
    container.className = 'status-filter-dropdown';
    
    const select = document.createElement('select');
    
    // Add "All" option
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All Statuses';
    select.appendChild(allOption);
    
    // Add category options
    Object.values(this.STATUS_CATEGORIES).forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category.charAt(0) + category.slice(1).toLowerCase();
      select.appendChild(option);
    });
    
    select.addEventListener('change', (e) => {
      if (typeof onChangeCallback === 'function') {
        onChangeCallback(e.target.value);
      }
    });
    
    container.appendChild(select);
    return container;
  },

  /**
   * Create a status progress bar
   * @param {Array} steps - Array of step objects with name and status properties
   * @returns {HTMLElement} The progress bar element
   */
  createStatusProgressBar(steps) {
    const container = document.createElement('div');
    container.className = 'status-progress-container';
    
    steps.forEach((step, index) => {
      const stepElement = document.createElement('div');
      stepElement.className = `status-step ${step.status}`;
      stepElement.textContent = index + 1;
      
      const label = document.createElement('div');
      label.className = 'status-step-label';
      label.textContent = step.name;
      
      stepElement.appendChild(label);
      container.appendChild(stepElement);
    });
    
    return container;
  },

  /**
   * Create a status timeline
   * @param {Array} events - Array of event objects with title, date, description, and status properties
   * @returns {HTMLElement} The timeline element
   */
  createStatusTimeline(events) {
    const container = document.createElement('div');
    container.className = 'status-timeline';
    
    events.forEach(event => {
      const item = document.createElement('div');
      item.className = `status-timeline-item ${event.status}`;
      
      const date = document.createElement('div');
      date.className = 'status-timeline-date';
      date.textContent = event.date;
      
      const title = document.createElement('div');
      title.className = 'status-timeline-title';
      title.textContent = event.title;
      
      const description = document.createElement('div');
      description.className = 'status-timeline-description';
      description.textContent = event.description;
      
      item.appendChild(date);
      item.appendChild(title);
      item.appendChild(description);
      container.appendChild(item);
    });
    
    return container;
  }
};

// Make available globally
window.StatusHelper = StatusHelper;


