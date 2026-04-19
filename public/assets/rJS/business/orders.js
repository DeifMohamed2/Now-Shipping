const __NSO =
  typeof window !== 'undefined' && window.__NS_BUSINESS_I18N && window.__NS_BUSINESS_I18N.orders
    ? window.__NS_BUSINESS_I18N.orders
    : {};

/** Maps API `orderStatus` values to keys on `__NSO` (from i18n). */
const ORDER_STATUS_I18N_MAP = {
  new: 'statusNew',
  pendingPickup: 'statusPendingPickup',
  pickedUp: 'statusPickedUp',
  inStock: 'statusInStock',
  inReturnStock: 'statusInReturnStock',
  inProgress: 'statusInProgress',
  headingToCustomer: 'statusHeadingToCustomer',
  returnToWarehouse: 'statusReturnToWarehouse',
  headingToYou: 'statusHeadingToYou',
  rescheduled: 'statusRescheduled',
  returnInitiated: 'statusReturnInitiated',
  returnAssigned: 'statusReturnAssigned',
  returnPickedUp: 'statusReturnPickedUp',
  returnAtWarehouse: 'statusReturnAtWarehouse',
  returnToBusiness: 'statusReturnToBusiness',
  exchangePickup: 'statusExchangePickup',
  waitingAction: 'statusWaitingAction',
  rejected: 'statusRejected',
  completed: 'statusCompleted',
  returnCompleted: 'statusReturnCompleted',
  canceled: 'statusCancelled',
  returned: 'statusReturned',
  terminated: 'statusTerminated',
  deliveryFailed: 'statusDeliveryFailed',
  autoReturnInitiated: 'statusAutoReturnInitiated',
  returnLinked: 'statusReturnLinked',
};

function getLocalizedOrderStatusLabel(status) {
  if (!status) return '';
  const i18nKey = ORDER_STATUS_I18N_MAP[status];
  if (i18nKey && __NSO[i18nKey]) return __NSO[i18nKey];
  if (window.StatusHelper) return StatusHelper.getOrderStatusLabel(status);
  return String(status);
}

// Utility Functions
function selectPaperSize(size) {
  document.getElementById('paperSize').value = size;
  document.querySelectorAll('.paper-size-option').forEach((option) => {
    option.classList.remove('selected');
  });
  document
    .querySelector(`.paper-size-option[onclick="selectPaperSize('${size}')"]`)
    .classList.add('selected');
}

function setOrderId(orderId) {
  document.getElementById('orderId').value = orderId;
}

const tableBody = document.getElementById('ordersTable');
const NoResult = document.getElementById('NoResult');

// Global variables for current filters
let currentOrderType = 'all';
let currentStatusCategory = 'all';

const ORDERS_PER_PAGE = 20;
let currentPage = 1;
let lastPaginationData = { currentPage: 1, totalPages: 1, totalCount: 0 };

/** Must match order-details.ejs: hide cancel when order cannot be cancelled from UI */
const NON_CANCELLABLE_ORDER_STATUSES = [
  'completed',
  'returnCompleted',
  'canceled',
  'returned',
  'terminated',
  'headingToCustomer',
  'exchangePickup',
  'inReturnStock',
  'returnToBusiness',
  'deliveryFailed',
];

// Helper: parse 'd M, Y' (e.g., '30 Oct, 2025') to ISO 'YYYY-MM-DD'
function parseFlatpickrDateToISO(dateStr) {
  if (!dateStr) return '';
  const months = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };
  const parts = dateStr.replace(',', '').split(' ').map(s => s.trim()).filter(Boolean);
  // Expecting [day, Mon, Year]
  if (parts.length !== 3) {
    // Fallback to native parse and return ISO if possible
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return '';
  }
  const dayNum = parseInt(parts[0], 10);
  const monIdx = months[parts[1]];
  const yearNum = parseInt(parts[2], 10);
  if (isNaN(dayNum) || isNaN(monIdx) || isNaN(yearNum)) return '';
  const d = new Date(yearNum, monIdx, dayNum);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Helper to fetch current filter values from UI
function getFiltersFromUI() {
  const searchInput = document.querySelector('.search-box .search');
  const dateInput = document.getElementById('demo-datepicker');
  const statusSelect = document.getElementById('idStatus');
  const paymentSelect = document.getElementById('idPayment');
  let dateFrom = '', dateTo = '';
  if (dateInput && dateInput.value) {
    if (dateInput.value.includes('to')) {
      const [from, to] = dateInput.value.split('to').map(s => s.trim());
      dateFrom = parseFlatpickrDateToISO(from);
      dateTo = parseFlatpickrDateToISO(to);
    } else {
      const iso = parseFlatpickrDateToISO(dateInput.value.trim());
      dateFrom = iso;
      dateTo = iso;
    }
  }
  return {
    search: (searchInput && searchInput.value ? searchInput.value.trim() : ''),
    status: (statusSelect && statusSelect.value ? statusSelect.value : 'all'),
    paymentType: (paymentSelect && paymentSelect.value ? paymentSelect.value : 'all'),
    dateFrom,
    dateTo
  };
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Load the status helper script dynamically if not already loaded
  if (!window.StatusHelper) {
    const script = document.createElement('script');
    script.src = '/assets/js/status-helper.js';
    script.onload = () => {
      console.log('Status helper loaded');
      fetchOrders();
    };
    document.head.appendChild(script);
  } else {
    fetchOrders();
  }
  
  // Add status category filter to the UI
  addStatusCategoryFilter();
  
  // Initialize professional dropdown system
  initializeDropdownSystem();
  
  // Add search input event listener for real-time search with debounce
  const searchInput = document.querySelector('.search-box .search');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentPage = 1; // Reset to first page on search
        SearchData();
      }, 500); // 500ms debounce
    });
    
    // Allow Enter key to trigger immediate search
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        currentPage = 1;
        SearchData();
      }
    });
  }
  
  // Add filter change listeners to reset pagination
  const statusSelect = document.getElementById('idStatus');
  const paymentSelect = document.getElementById('idPayment');
  const dateInput = document.getElementById('demo-datepicker');
  
  if (statusSelect) {
    statusSelect.addEventListener('change', function() {
      currentPage = 1;
      SearchData();
    });
  }
  
  if (paymentSelect) {
    paymentSelect.addEventListener('change', function() {
      currentPage = 1;
      SearchData();
    });
  }
  
  if (dateInput) {
    dateInput.addEventListener('change', function() {
      currentPage = 1;
      SearchData();
    });
  }
});

// Add status category filter dropdown
function addStatusCategoryFilter() {
  const orderTypeFilter = document.querySelector('#orderList ul.nav-tabs.nav-tabs-custom');
  if (orderTypeFilter) {
    const li = document.createElement('li');
    li.className = 'nav-item ms-auto d-flex align-items-center ps-2';
    const i18n = __NSO;
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
    const btnAlign = isRtl ? 'd-inline-flex align-items-center gap-1 flex-row-reverse' : 'd-inline-flex align-items-center gap-1';
    const menuAlign = isRtl ? 'dropdown-menu-start' : 'dropdown-menu-end';
    li.innerHTML = `
      <div class="dropdown status-category-dropdown-wrapper">
        <button class="btn btn-soft-primary dropdown-toggle ${btnAlign}" type="button" id="statusCategoryDropdown"
          data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false" data-bs-auto-close="outside">
          <i class="ri-filter-2-line"></i><span>${i18n.statusCategoryLabel || 'Status Category'}</span>
        </button>
        <ul class="dropdown-menu ${menuAlign} status-category-menu" aria-labelledby="statusCategoryDropdown">
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('all');return false;">${i18n.catAll || 'All'}</a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('NEW');return false;">
            <span class="status-indicator new"></span> ${i18n.catNew || 'New'}
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('PROCESSING');return false;">
            <span class="status-indicator processing"></span> ${i18n.catProcessing || 'Processing'}
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('PAUSED');return false;">
            <span class="status-indicator paused"></span> ${i18n.catPaused || 'Paused'}
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('SUCCESSFUL');return false;">
            <span class="status-indicator successful"></span> ${i18n.catSuccessful || 'Successful'}
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('UNSUCCESSFUL');return false;">
            <span class="status-indicator unsuccessful"></span> ${i18n.catUnsuccessful || 'Unsuccessful'}
          </a></li>
        </ul>
      </div>
    `;
    orderTypeFilter.appendChild(li);
    const btn = document.getElementById('statusCategoryDropdown');
    if (btn && typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
      try {
        bootstrap.Dropdown.getOrCreateInstance(btn, {
          popperConfig: {
            strategy: 'fixed',
            modifiers: [
              {
                name: 'preventOverflow',
                options: {
                  boundary: document.querySelector('#layout-wrapper') || document.body,
                },
              },
            ],
          },
        });
      } catch (e) {
        console.warn('Status category dropdown Popper config:', e);
      }
      btn.addEventListener('shown.bs.dropdown', () => {
        const menu = btn.nextElementSibling;
        if (menu && menu.classList && menu.classList.contains('dropdown-menu')) {
          menu.style.zIndex = '1110';
        }
      });
    }
  }
}

const checkAll = document.getElementById("checkAll");
if (checkAll) {
  checkAll.addEventListener("change", function() {
    const checkboxes = document.querySelectorAll("input[name='checkAll[]']");
    checkboxes.forEach(checkbox => {
      checkbox.checked = checkAll.checked;
    });
  });
}

// Filter by status category
function filterByStatusCategory(category) {
  currentStatusCategory = category;
  currentPage = 1;
  const btn = document.getElementById('statusCategoryDropdown');
  if (btn) {
    const i18n = __NSO;
    const labelMap = {
      all: i18n.catAll || 'All',
      NEW: i18n.catNew || 'New',
      PROCESSING: i18n.catProcessing || 'Processing',
      PAUSED: i18n.catPaused || 'Paused',
      SUCCESSFUL: i18n.catSuccessful || 'Successful',
      UNSUCCESSFUL: i18n.catUnsuccessful || 'Unsuccessful',
    };
    const label = labelMap[category] || category;
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
    const btnAlign = isRtl ? 'd-inline-flex align-items-center gap-1 flex-row-reverse' : 'd-inline-flex align-items-center gap-1';
    btn.className = `btn btn-soft-primary dropdown-toggle ${btnAlign}`;
    btn.innerHTML = `<i class="ri-filter-2-line"></i><span>${label}</span>`;
  }
  fetchOrders(currentOrderType, category, 1);
}

// Filter by order type
function filterOrders(orderType) {
  currentOrderType = orderType;
  currentPage = 1; // Reset to first page when filtering
  fetchOrders(orderType, currentStatusCategory, 1);
}

// Filter returned orders
function filterReturnedOrders() {
  currentPage = 1; // Reset to first page when filtering
  fetchOrders('Return', currentStatusCategory, 1);
}

// Replace fetchOrders to always fetch from server with pagination/filters
async function fetchOrders(orderType = "all", statusCategory = "all", page = 1) {
  try {
    currentPage = page; // Update global currentPage
    showLoadingSpinner();
    const filters = getFiltersFromUI();
    const params = new URLSearchParams();
    params.append('limit', ORDERS_PER_PAGE);
    params.append('page', page);
    if (orderType && orderType !== 'all') {
      params.append('orderType', orderType);
    }
    if (statusCategory && statusCategory !== 'all') {
      params.append('statusCategory', statusCategory);
    }
    if (filters.status && filters.status !== 'all') {
      params.append('status', filters.status);
    }
    if (filters.paymentType && filters.paymentType !== 'all') {
      params.append('paymentType', filters.paymentType);
    }
    if (filters.search) {
      params.append('search', filters.search);
    }
    if (filters.dateFrom) {
      params.append('dateFrom', filters.dateFrom);
    }
    if (filters.dateTo) {
      params.append('dateTo', filters.dateTo);
    }
    const url = `/business/get-orders?${params}`;
    const response = await fetch(url);
    const data = await response.json();
    if (response.ok && data.orders) {
      lastPaginationData = data.pagination;
      currentPage = data.pagination.currentPage || page; // Sync with server response
      handleOrdersResponse(data.orders);
      updatePaginationBar();
    } else {
      showError(`Error fetching orders: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error("Error fetching orders:", error);
  }
}

function showLoadingSpinner() {
  const loading = __NSO.loadingTable || 'Loading…';
  tableBody.innerHTML = `
    <tr>
      <td colspan="10" class="text-center">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">${loading}</span>
        </div>
      </td>
    </tr>
  `;
}

function handleOrdersResponse(orders) {
  tableBody.innerHTML = ""; // Clear existing rows
  NoResult.style.display = "none";
  // Cache globally for client-side filtering
  window.allOrders = Array.isArray(orders) ? orders.slice() : [];
  if (!orders || orders.length === 0) {
    NoResult.style.display = "block";
    return;
  }
  populateOrdersTable(orders);
}

function populateOrdersTable(orders) {
  tableBody.innerHTML = ""; // Clear existing rows
  orders.forEach(order => {
    const row = document.createElement("tr");
    
    // Add highlighting for different important statuses based on category
    const categoryClass = order.categoryClass || getStatusCategoryClass(order.statusCategory);
    if (order.statusCategory === 'NEW') {
      row.classList.add('table-info');
      row.style.borderLeft = '4px solid #3498db';
    } else if (order.statusCategory === 'PROCESSING') {
      row.classList.add('table-warning');
      row.style.borderLeft = '4px solid #f39c12';
    } else if (order.statusCategory === 'PAUSED') {
      row.classList.add('table-danger');
      row.style.borderLeft = '4px solid #e74c3c';
    } else if (order.statusCategory === 'SUCCESSFUL') {
      row.classList.add('table-success');
      row.style.borderLeft = '4px solid #2ecc71';
    } else if (order.statusCategory === 'UNSUCCESSFUL') {
      row.classList.add('table-secondary');
      row.style.borderLeft = '4px solid #95a5a6';
    }
    
    // Add special highlighting for fast shipping orders
    if (order.isFastShipping) {
      row.style.backgroundColor = '#fff3cd';
      row.style.borderTop = '2px solid #ffc107';
      row.style.borderBottom = '2px solid #ffc107';
    }
    
    row.innerHTML = `
      <th scope="row">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" name="checkAll[]" value="${
            order.orderNumber
          }">
        </div>
      </th>
      <td class="id"><a href="/business/order-details/${
        order.orderNumber
      }" class="fw-medium link-primary">${order.orderNumber}</a></td>
      <td class="customer_name">${order.orderCustomer.fullName}</td>
      <td class="product_name" style="font-size:15px !important;" >
        ${getOrderTypeWithIcon(order.orderShipping.orderType)}
        ${order.isFastShipping ? `<span class="badge bg-warning text-dark ms-1"><i class="ri-flashlight-line me-1"></i>${__NSO.badgeFast || 'Fast'}</span>` : ''}
      </td>
      <td class="location">
        <div>${order.orderCustomer.government}</div>
        <div class="text-muted">${order.orderCustomer.zone}</div>
      </td>
      <td class="amount">
        <div>${getFormattedAmount(order)}</div>
        <div class="text-muted">${getAmountTypeLabel(order.orderShipping.amountType, order.orderShipping.orderType)}</div>
      </td>
      <td class="status">
        <span class="status-badge ${order.categoryClass || getStatusCategoryClass(order.statusCategory)}">
          ${getLocalizedOrderStatusLabel(order.orderStatus)}
        </span>
      </td>
      <td class="tries">
        <div>${(__NSO.triesOf || '{n}/2').replace('{n}', String(order.Attemps || 0))}</div>
      </td>
      <td class="date">${new Date(order.orderDate).toLocaleDateString(__NSO.locale || 'en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}</td>
      <td>
        <div class="orders-table-dropdown" data-order-id="${order.orderNumber}">
          <button class="dropdown-toggle" type="button" aria-expanded="false" data-dropdown-toggle>
            <i class="ri-more-fill"></i>
          </button>
          <ul class="dropdown-menu">
            <li>
              <button class="dropdown-item" onclick="handlePrintPolicy('${order.orderNumber}')">
                <i class="ri-printer-fill text-primary"></i>${__NSO.actionPrintPolicy || 'Print Delivery Policy'}
              </button>
            </li>
            <li>
              <button class="dropdown-item" onclick="handleSmartStickerScan('${order.orderNumber}')">
                <i class="ri-barcode-fill text-success"></i>${__NSO.actionSmartSticker || 'Smart Sticker Scan'}
              </button>
            </li>
            <li>
              <a class="dropdown-item" href="/business/edit-order/${order.orderNumber}">
                <i class="ri-edit-2-fill text-warning"></i>${__NSO.actionEditOrder || 'Edit Order'}
              </a>
            </li>
            ${!NON_CANCELLABLE_ORDER_STATUSES.includes(order.orderStatus)
              ? `<li>
                <button class="dropdown-item" onclick="handleCancelOrder('${order._id}', '${order.orderNumber}')">
                  <i class="ri-delete-bin-6-fill text-danger"></i>${__NSO.actionCancelOrder || 'Cancel order'}
                </button>
              </li>`
              : ''}
            <li>
              <a class="dropdown-item" href="/business/order-details/${order.orderNumber}">
                <i class="ri-truck-line text-info"></i>${__NSO.actionTrackOrder || 'Track Order'}
              </a>
            </li>
          </ul>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
    
    // Add event listeners to dropdown items to prevent menu from closing immediately
    const dropdown = row.querySelector('.orders-table-dropdown');
    if (dropdown) {
      const menuItems = dropdown.querySelectorAll('.dropdown-item');
      menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
          // Stop propagation to prevent the click-outside handler from closing the menu immediately
          e.stopPropagation();
        });
      });
    }
  });
}

// Get status category class (fallback if StatusHelper not available)
function getStatusCategoryClass(category) {
  if (window.StatusHelper) {
    return StatusHelper.getCategoryClass(category);
  }
  
  // Fallback implementation
  const classMap = {
    'NEW': 'status-new',
    'PROCESSING': 'status-processing',
    'PAUSED': 'status-paused',
    'SUCCESSFUL': 'status-successful',
    'UNSUCCESSFUL': 'status-unsuccessful'
  };
  return classMap[category] || 'status-default';
}

// Get status label — prefer panel locale over StatusHelper English
function getStatusLabel(status) {
  return getLocalizedOrderStatusLabel(status);
}

// Get order type with icon
function getOrderTypeWithIcon(orderType) {
  switch (orderType) {
    case 'Deliver':
      return `<i class="ri-truck-line me-1"></i> ${__NSO.typeDeliver || 'Deliver'}`;
    case 'Return':
      return `<i class="ri-arrow-go-back-line me-1"></i> ${__NSO.typeReturn || 'Return'}`;
    case 'Exchange':
      return `<i class="ri-exchange-line me-1"></i> ${__NSO.typeExchange || 'Exchange'}`;
    default:
      return orderType || '';
  }
}

// Format amount based on order type
function getFormattedAmount(order) {
  const cur = __NSO.currencyEGP || 'EGP';
  if (!order.orderShipping.amount) return `0 ${cur}`;

  const amount = order.orderShipping.amount;
  const amountType = order.orderShipping.amountType;
  const orderType = order.orderShipping.orderType;

  if (orderType === 'Exchange') {
    if (amountType === 'CD') {
      return `<span class="text-warning">${amount} ${cur}</span>`;
    }
    return `<span>${amount} ${cur}</span>`;
  }
  if (amountType === 'COD') {
    return `<span class="text-primary">${amount} ${cur}</span>`;
  }
  return `${amount} ${cur}`;
}

// Get readable amount type label
function getAmountTypeLabel(amountType, orderType) {
  if (amountType === 'CD') return __NSO.amountCD || 'Cash Difference';
  if (amountType === 'NA') return __NSO.amountNA || 'No Payment';
  if (amountType === 'COD') return __NSO.amountCOD || 'Cash on Delivery';
  return amountType || __NSO.amountNAShort || 'N/A';
}

// Legacy status details function (for backward compatibility)
function getStatusDetails(status) {
  let badgeClass = '';
  let statusText = '';

  if (status === 'new') {
    badgeClass = 'bg-primary-subtle text-primary';
    statusText = 'New';
  } else if (status === 'pickedUp') {
    badgeClass = 'bg-secondary-subtle text-secondary';
    statusText = 'Picked Up';
  } else if (status === 'inStock' || status=="inReturnStock") {
    badgeClass = 'bg-info-subtle text-info';
    statusText = 'In Stock';
  } else if (status === 'inProgress') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'In Progress';
  } else if (status === 'headingToCustomer') {
    badgeClass = 'bg-success-subtle text-success';
    statusText = 'Heading To Customer';
  } else if (status === 'headingToYou') {
    badgeClass = 'bg-success-subtle text-success';
    statusText = 'Heading To You';
  } else if (status === 'completed') {
    badgeClass = 'bg-success-subtle text-success';
    statusText = 'Completed';
  } else if (status === 'canceled') {
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Canceled';
  } else if (status === 'rejected') {
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Rejected';
  } else if (status === 'returned') {
    badgeClass = 'bg-warning text-dark';
    statusText = 'Returned';
  } else if (status === 'terminated') {
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Terminated';
  } else if(status === 'waitingAction') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'Waiting Action';
  } else if (status === 'rescheduled') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'Rescheduled'; 
  } else if (status === 'returnInitiated') {
    badgeClass = 'bg-secondary-subtle text-secondary';
    statusText = 'Return Initiated';
  } else if (status === 'returnToWarehouse') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'Return to Warehouse';
  } else if (status === 'returnLinked') {
    badgeClass = 'bg-info text-white';
    statusText = 'Return Linked';
  } else if (status === 'returnAssigned') {
    badgeClass = 'bg-info-subtle text-info';
    statusText = 'Return Assigned';
  } else if (status === 'returnPickedUp') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'Return Picked Up';
  } else if (status === 'returnAtWarehouse') {
    badgeClass = 'bg-primary-subtle text-primary';
    statusText = 'At Warehouse';
  } else if (status === 'returnToBusiness') {
    badgeClass = 'bg-info-subtle text-info';
    statusText = 'Returning to Business';
  } else if (status === 'returnCompleted') {
    badgeClass = 'bg-success-subtle text-success';
    statusText = 'Return Completed';
  } else if (status === 'exchangePickup') {
    badgeClass = 'bg-primary-subtle text-primary';
    statusText = 'Exchange Pickup (legacy)';
  } else if (status === 'deliveryFailed') {
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Delivery Failed';
  } else {
    badgeClass = 'bg-secondary-subtle text-secondary';
    statusText = status || 'Unknown';
  }

  return { badgeClass, statusText };
}

// Print Policy
async function printPolicy() {
  const orderId = document.getElementById('orderId').value;
  const paperSize = document.getElementById('paperSize').value;
  if (!paperSize) {
    alert(__NSO.selectPaperSize || 'Please select a paper size.');
    return;
  }
  try {
    console.log('orderId:', orderId);
    const response = await fetch(`/business/orders/print-policy/${orderId}/${paperSize}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paperSize }),
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    window.open(url);  // Open in a new tab
  } catch (err) {
    console.error('An error occurred:', err);
    Swal.fire({
      icon: 'error',
      title: __NSO.errorTitle || 'Error',
      text: __NSO.printError || 'An error occurred while printing the policy. Please try again.',
    });
  }
  // Close the modal
  let modal = bootstrap.Modal.getInstance(document.getElementById('printPolicyModal'));
  modal.hide();
}

// Professional Dropdown System - Global Variables
let dropdownSystemInitialized = false;

// Professional Dropdown System
function initializeDropdownSystem() {
  // Only initialize once
  if (dropdownSystemInitialized) {
    return;
  }
  
  dropdownSystemInitialized = true;
  

  // Close all dropdowns when clicking outside
  document.addEventListener('click', function(event) {
    // Check if click is inside any dropdown (toggle button or menu)
    const clickedDropdown = event.target.closest('.orders-table-dropdown');
    const clickedToggle = event.target.closest('[data-dropdown-toggle]');
    const clickedMenuItem = event.target.closest('.dropdown-item');
    const clickedMenu = event.target.closest('.dropdown-menu');
    
    // If clicking on toggle button, let the toggle handler manage it
    if (clickedToggle) {
      return;
    }
    
    // If clicking inside dropdown menu (but not necessarily on an item), don't close
    if (clickedMenu) {
      // If clicking on a menu item, close after a brief delay to allow onclick to execute
      if (clickedMenuItem) {
        const parentDropdown = clickedMenuItem.closest('.orders-table-dropdown');
        if (parentDropdown) {
          // Close after a short delay to allow onclick handlers to execute
          setTimeout(() => {
            if (parentDropdown.classList.contains('show')) {
              closeDropdown(parentDropdown);
            }
          }, 150);
        }
      }
      // Don't close if just clicking in the menu area (not on an item)
      return;
    }
    
    // Close all dropdowns that don't contain the clicked element
    const dropdowns = document.querySelectorAll('.orders-table-dropdown');
    dropdowns.forEach(dropdown => {
      if (dropdown !== clickedDropdown && !dropdown.contains(event.target)) {
        closeDropdown(dropdown);
      }
    });
  });

  // Handle dropdown toggle clicks
  document.addEventListener('click', function(event) {
    if (event.target.closest('[data-dropdown-toggle]')) {
      event.preventDefault();
      event.stopPropagation();
      
      const dropdown = event.target.closest('.orders-table-dropdown');
      if (!dropdown) return;
      
      const isOpen = dropdown.classList.contains('show');
      
      // Close all other dropdowns
      document.querySelectorAll('.orders-table-dropdown.show').forEach(d => {
        if (d !== dropdown) closeDropdown(d);
      });
      
      // Toggle current dropdown
      if (isOpen) {
        closeDropdown(dropdown);
      } else {
        openDropdown(dropdown);
      }
    }
  });

  // Handle escape key
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      document.querySelectorAll('.orders-table-dropdown.show').forEach(dropdown => {
        closeDropdown(dropdown);
      });
    }
  });

  // Handle window resize
  window.addEventListener('resize', function() {
    document.querySelectorAll('.orders-table-dropdown.show').forEach(dropdown => {
      adjustDropdownPosition(dropdown);
    });
  });

  // Reposition dropdowns during scroll to maintain correct position
  window.addEventListener('scroll', function() {
    document.querySelectorAll('.orders-table-dropdown.show').forEach(dropdown => {
      adjustDropdownPosition(dropdown);
    });
  });

  
}

function openDropdown(dropdown) {
  dropdown.classList.add('show');
  const toggle = dropdown.querySelector('[data-dropdown-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  adjustDropdownPosition(dropdown);
}

function closeDropdown(dropdown) {
  dropdown.classList.remove('show');
  const toggle = dropdown.querySelector('[data-dropdown-toggle]');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  // Reset any fixed-positioning we applied
  const menu = dropdown.querySelector('.dropdown-menu');
  if (menu) {
    menu.style.cssText = '';
    dropdown.classList.remove('dropdown-up', 'dropdown-fixed');
  }
}

function adjustDropdownPosition(dropdown) {
  const menu = dropdown.querySelector('.dropdown-menu');
  if (!menu) return;

  const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

  // Make menu temporarily visible but hidden so we can measure it
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const menuW = menu.offsetWidth  || 240;
  const menuH = menu.offsetHeight || 220;
  menu.style.display = '';
  menu.style.visibility = '';

  const toggleEl = dropdown.querySelector('[data-dropdown-toggle]');
  const anchorRect = (toggleEl || dropdown).getBoundingClientRect();

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  // ── Decide vertical direction ──
  const spaceBelow = vpH - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const openUp = spaceBelow < menuH + 8 && spaceAbove > spaceBelow;

  // ── Compute fixed coordinates ──
  let top, left;

  if (openUp) {
    top = anchorRect.top - menuH - 4;
  } else {
    top = anchorRect.bottom + 4;
  }

  if (isRtl) {
    // Anchor on the left edge of toggle, opening rightward
    left = anchorRect.left;
    // If it overflows the right edge, shift left
    if (left + menuW > vpW - 4) {
      left = vpW - menuW - 4;
    }
    // Never go negative
    if (left < 4) left = 4;
  } else {
    // Anchor on the right edge of toggle, opening leftward
    left = anchorRect.right - menuW;
    // If it overflows the left edge, shift right
    if (left < 4) {
      left = anchorRect.left;
    }
    // Never overflow right
    if (left + menuW > vpW - 4) {
      left = vpW - menuW - 4;
    }
  }

  // ── Apply as fixed so nothing clips it ──
  menu.style.position = 'fixed';
  menu.style.top      = top  + 'px';
  menu.style.left     = left + 'px';
  menu.style.right    = 'auto';
  menu.style.bottom   = 'auto';
  // Remove CSS class-based up/down since we're using fixed coords
  dropdown.classList.remove('dropdown-up');
}

// Dropdown Action Handlers
function handlePrintPolicy(orderNumber) {
  setOrderId(orderNumber);
  const modal = new bootstrap.Modal(document.getElementById('printPolicyModal'));
  modal.show();
}

function handleSmartStickerScan(orderNumber) {
  // Open the Smart Sticker Scan modal
  const modal = new bootstrap.Modal(document.getElementById('smartStickerModal'));
  modal.show();
}

function handleCancelOrder(orderId, orderNumber) {
  cancelOrder(orderId);
}


// Cancel Order
async function cancelOrder(orderId) {
  console.log('Cancelling order:', orderId);
  Swal.fire({
    title: __NSO.cancelConfirm || 'Are you sure?',
    text: __NSO.cancelConfirmText || "You won't be able to revert this!",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#3085d6',
    cancelButtonColor: '#d33',
    confirmButtonText: __NSO.cancelConfirmBtn || 'Yes, cancel it!',
  }).then(async (result) => {
    if (result.isConfirmed) {
      const response = await fetch(`/business/orders/cancel-order/${orderId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      let data = {};
      try {
        data = await response.json();
      } catch (_) {
        data = {};
      }
      if (response.ok) {
        Swal.fire({
          title: __NSO.cancelDone || 'Done',
          text: data.message || (__NSO.cancelSuccess || 'Your order has been updated.'),
          icon: 'success',
          confirmButtonText: 'OK',
        }).then(() => {
          window.location.href = '/business/orders';
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: __NSO.cannotCancel || 'Cannot cancel',
          text:
            data.error ||
            (__NSO.cannotCancelText || 'This order cannot be cancelled from its current status.'),
          confirmButtonText: 'OK',
        });
      }
    }
  }).catch((error) => {
    console.error('Error:', error);
    Swal.fire({
      title: __NSO.errorTitle || 'Error!',
      text: __NSO.cancelError || 'There was an error cancelling the order. Please try again later.',
      icon: 'error',
      confirmButtonText: 'OK',
    });
  });
}

// Filters event
function SearchData() {
  currentPage = 1; // reset to first page
  fetchOrders(currentOrderType, currentStatusCategory, 1);
}

// Pagination event handler
function gotoPage(page) {
  if (page < 1 || page > lastPaginationData.totalPages) return;
  currentPage = page;
  fetchOrders(currentOrderType, currentStatusCategory, currentPage);
}

// Enhance updatePagination to show professional pagination
function updatePaginationBar() {
  const prev = document.querySelector('.pagination-prev');
  const next = document.querySelector('.pagination-next');
  const ul = document.querySelector('.listjs-pagination');
  if (!ul) return;
  ul.innerHTML = '';
  const { currentPage: serverPage, totalPages } = lastPaginationData;
  const activePage = currentPage || serverPage;
  
  // Only render pagination buttons if more than 1 page
  if (totalPages > 1) {
    let startPage = Math.max(1, activePage - 2);
    let endPage = Math.min(totalPages, activePage + 2);
    if (activePage <= 3) {
      endPage = Math.min(totalPages, 5);
    }
    if (activePage + 2 > totalPages) {
      startPage = Math.max(1, totalPages - 4);
    }
    
    // Add first page if not in range
    if (startPage > 1) {
      const li = document.createElement('li');
      li.className = 'page-item';
      const a = document.createElement('a');
      a.className = 'page-link';
      a.textContent = '1';
      a.href = 'javascript:void(0);';
      a.onclick = () => gotoPage(1);
      li.appendChild(a);
      ul.appendChild(li);
      
      if (startPage > 2) {
        const ellipsis = document.createElement('li');
        ellipsis.className = 'page-item disabled';
        ellipsis.innerHTML = '<span class="page-link">...</span>';
        ul.appendChild(ellipsis);
      }
    }
    
    for (let p = startPage; p <= endPage; p++) {
      const li = document.createElement('li');
      li.className = `page-item${p === activePage ? ' active' : ''}`;
      const a = document.createElement('a');
      a.className = 'page-link';
      a.textContent = p;
      a.href = 'javascript:void(0);';
      a.onclick = () => gotoPage(p);
      li.appendChild(a);
      ul.appendChild(li);
    }
    
    // Add last page if not in range
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('li');
        ellipsis.className = 'page-item disabled';
        ellipsis.innerHTML = '<span class="page-link">...</span>';
        ul.appendChild(ellipsis);
      }
      
      const li = document.createElement('li');
      li.className = `page-item${totalPages === activePage ? ' active' : ''}`;
      const a = document.createElement('a');
      a.className = 'page-link';
      a.textContent = totalPages;
      a.href = 'javascript:void(0);';
      a.onclick = () => gotoPage(totalPages);
      li.appendChild(a);
      ul.appendChild(li);
    }
  }
  
  // Update prev/next buttons
  if (prev) {
    prev.classList.toggle('disabled', activePage === 1);
    prev.onclick = () => {
      if (activePage > 1) gotoPage(activePage - 1);
    };
  }
  if (next) {
    next.classList.toggle('disabled', activePage === totalPages || totalPages === 0);
    next.onclick = () => {
      if (activePage < totalPages) gotoPage(activePage + 1);
    };
  }
}

// Export orders to Excel
function exportOrdersToExcel() {
  // Show loading indicator
  Swal.fire({
    title: __NSO.exportPreparing || 'Preparing export...',
    html: __NSO.exportPreparingHtml || 'Please wait while we prepare your orders export.',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  // Export ALL orders (no filters)
  const exportUrl = `/business/export-orders`;
  const link = document.createElement('a');
  link.href = exportUrl;
  link.download = `orders_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Close loading indicator after a short delay
  setTimeout(() => {
    Swal.close();
    Swal.fire({
      icon: 'success',
      title: __NSO.exportStarted || 'Export Started!',
      text: __NSO.exportDownloaded || 'Your orders export has been downloaded.',
      confirmButtonColor: '#0d6efd',
      timer: 2000
    });
  }, 500);
}

// --- Bulk Excel import ---
let bulkImportValidated = false;

function resetBulkImportModalState() {
  bulkImportValidated = false;
  const fileInput = document.getElementById('bulkImportFile');
  if (fileInput) fileInput.value = '';
  const commitBtn = document.getElementById('bulkImportCommitBtn');
  if (commitBtn) commitBtn.disabled = true;
  const errWrap = document.getElementById('bulkImportErrorWrap');
  if (errWrap) errWrap.classList.add('d-none');
  const tbody = document.querySelector('#bulkImportErrorTable tbody');
  if (tbody) tbody.innerHTML = '';
  const alertEl = document.getElementById('bulkImportAlert');
  if (alertEl) {
    alertEl.classList.add('d-none');
    alertEl.textContent = '';
  }
}

document.getElementById('bulkImportModal')?.addEventListener('hidden.bs.modal', resetBulkImportModalState);
document.getElementById('bulkImportFile')?.addEventListener('change', () => {
  bulkImportValidated = false;
  const commitBtn = document.getElementById('bulkImportCommitBtn');
  if (commitBtn) commitBtn.disabled = true;
});

async function validateBulkOrderImport() {
  const input = document.getElementById('bulkImportFile');
  const file = input && input.files && input.files[0];
  if (!file) {
    Swal.fire({
      icon: 'warning',
      title: __NSO.chooseFile || 'Choose a file',
      text: __NSO.chooseFileText || 'Select an .xlsx file first.',
    });
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  Swal.fire({
    title: __NSO.validating || 'Validating…',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    },
  });

  try {
    const res = await fetch('/business/orders-import-validate', {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    Swal.close();

    if (res.status === 401) {
      Swal.fire({
        icon: 'warning',
        title: __NSO.sessionExpired || 'Session expired',
        text: __NSO.sessionExpiredText || 'Please sign in again to continue.',
      }).then(() => {
        window.location.href = '/login';
      });
      return;
    }
    if (res.status === 403) {
      Swal.fire({
        icon: 'info',
        title: __NSO.accountSetupRequired || 'Account setup required',
        text: data.message || data.error || (__NSO.accountSetupRequiredText || 'Complete your account to use this feature.'),
      });
      return;
    }

    const alertEl = document.getElementById('bulkImportAlert');
    if (!res.ok) {
      if (alertEl) {
        alertEl.className = 'alert alert-danger py-2';
        alertEl.textContent = data.error || __NSO.validationFailed || 'Validation request failed.';
        alertEl.classList.remove('d-none');
      }
      Swal.fire({
        icon: 'error',
        title: __NSO.validationFailedTitle || 'Validation failed',
        text: data.error || res.statusText || 'Try again.',
      });
      return;
    }

    if (data.ok) {
      bulkImportValidated = true;
      const commitBtn = document.getElementById('bulkImportCommitBtn');
      if (commitBtn) commitBtn.disabled = false;
      const errWrap = document.getElementById('bulkImportErrorWrap');
      if (errWrap) errWrap.classList.add('d-none');
      if (alertEl) {
        alertEl.className = 'alert alert-success py-2';
        let msg = `All ${data.validCount} row(s) passed validation for delivery orders. You can import now.`;
        if (data.ignoredHeaders && data.ignoredHeaders.length) {
          msg += ` Unrecognized columns were ignored: ${data.ignoredHeaders.join(', ')}.`;
        }
        alertEl.textContent = msg;
        alertEl.classList.remove('d-none');
      }
    } else {
      bulkImportValidated = false;
      const commitBtn = document.getElementById('bulkImportCommitBtn');
      if (commitBtn) commitBtn.disabled = true;
      if (alertEl) {
        alertEl.className = 'alert alert-warning py-2';
        alertEl.textContent = (__NSO.rowsHaveErrors || '{count} row(s) have errors. Fix the spreadsheet and validate again.').replace(
          '{count}',
          String(data.invalidCount)
        );
        alertEl.classList.remove('d-none');
      }
      const tbody = document.querySelector('#bulkImportErrorTable tbody');
      if (tbody) {
        tbody.innerHTML = '';
        (data.rows || [])
          .filter((r) => r.errors && r.errors.length)
          .forEach((r) => {
            const tr = document.createElement('tr');
            const tdRow = document.createElement('td');
            tdRow.textContent = String(r.row);
            const tdErr = document.createElement('td');
            (r.errors || []).forEach((err) => {
              const div = document.createElement('div');
              div.className = 'small';
              div.textContent = err;
              tdErr.appendChild(div);
            });
            tr.appendChild(tdRow);
            tr.appendChild(tdErr);
            tbody.appendChild(tr);
          });
      }
      const errWrap = document.getElementById('bulkImportErrorWrap');
      if (errWrap) errWrap.classList.remove('d-none');
    }
  } catch (e) {
    Swal.close();
    Swal.fire({ icon: 'error', title: __NSO.networkError || 'Network error', text: e.message || 'Try again.' });
  }
}

async function commitBulkOrderImport() {
  const input = document.getElementById('bulkImportFile');
  const file = input && input.files && input.files[0];
  if (!file || !bulkImportValidated) {
    Swal.fire({
      icon: 'warning',
      title: __NSO.validateFirst || 'Validate first',
      text: __NSO.validateFirstText || 'Run Validate successfully on the same file before importing.',
    });
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  Swal.fire({
    title: __NSO.importing || 'Importing…',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    },
  });

  try {
    const res = await fetch('/business/orders-import-commit', {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    Swal.close();

    if (res.status === 401) {
      Swal.fire({
        icon: 'warning',
        title: __NSO.sessionExpired || 'Session expired',
        text: __NSO.sessionExpiredText || 'Please sign in again to continue.',
      }).then(() => {
        window.location.href = '/login';
      });
      return;
    }
    if (res.status === 403) {
      Swal.fire({
        icon: 'info',
        title: __NSO.accountSetupRequired || 'Account setup required',
        text: data.message || data.error || (__NSO.accountSetupRequiredText || 'Complete your account to use this feature.'),
      });
      return;
    }

    if (!res.ok) {
      const tbody = document.querySelector('#bulkImportErrorTable tbody');
      if (tbody && data.rows && data.rows.length) {
        tbody.innerHTML = '';
        data.rows.forEach((r) => {
          const tr = document.createElement('tr');
          const tdRow = document.createElement('td');
          tdRow.textContent = String(r.row);
          const tdErr = document.createElement('td');
          (r.errors || []).forEach((err) => {
            const div = document.createElement('div');
            div.className = 'small';
            div.textContent = err;
            tdErr.appendChild(div);
          });
          tr.appendChild(tdRow);
          tr.appendChild(tdErr);
          tbody.appendChild(tr);
        });
        document.getElementById('bulkImportErrorWrap')?.classList.remove('d-none');
      }
      Swal.fire({
        icon: 'error',
        title: __NSO.importFailed || 'Import failed',
        text: data.error || (__NSO.importFailedText || 'No orders were saved.'),
      });
      return;
    }

    const modalEl = document.getElementById('bulkImportModal');
    if (modalEl && window.bootstrap && window.bootstrap.Modal) {
      const inst = window.bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }

    Swal.fire({
      icon: 'success',
      title: __NSO.importSuccess || 'Delivery orders imported',
      text: data.message || `Created ${data.createdCount} delivery order(s).`,
      confirmButtonColor: '#0d6efd',
    });

    if (typeof SearchData === 'function') {
      SearchData();
    }
  } catch (e) {
    Swal.close();
    Swal.fire({ icon: 'error', title: __NSO.networkError || 'Network error', text: e.message || 'Try again.' });
  }
}