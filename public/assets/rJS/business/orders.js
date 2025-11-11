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
  const orderTypeFilter = document.querySelector('.nav-tabs');
  if (orderTypeFilter) {
    const categoryFilterContainer = document.createElement('div');
    categoryFilterContainer.className = 'ms-auto d-flex align-items-center';
    categoryFilterContainer.innerHTML = `
      <div class="dropdown">
        <button class="btn btn-soft-primary dropdown-toggle" type="button" id="statusCategoryDropdown" data-bs-toggle="dropdown">
          <i class="ri-filter-2-line me-1"></i> Status Category
        </button>
        <ul class="dropdown-menu" aria-labelledby="statusCategoryDropdown">
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('all')">All</a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('NEW')">
            <span class="status-indicator new"></span> New
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('PROCESSING')">
            <span class="status-indicator processing"></span> Processing
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('PAUSED')">
            <span class="status-indicator paused"></span> Paused
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('SUCCESSFUL')">
            <span class="status-indicator successful"></span> Successful
          </a></li>
          <li><a class="dropdown-item" href="#" onclick="filterByStatusCategory('UNSUCCESSFUL')">
            <span class="status-indicator unsuccessful"></span> Unsuccessful
          </a></li>
        </ul>
      </div>
    `;
    orderTypeFilter.appendChild(categoryFilterContainer);
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
  currentPage = 1; // Reset to first page when filtering
  document.getElementById('statusCategoryDropdown').innerHTML = 
    `<i class="ri-filter-2-line me-1"></i> ${category === 'all' ? 'All' : category}`;
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
  tableBody.innerHTML = `
    <tr>
      <td colspan="10" class="text-center">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
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
        ${order.isFastShipping ? '<span class="badge bg-warning text-dark ms-1"><i class="ri-flashlight-line me-1"></i>Fast</span>' : ''}
      </td>
      <td class="location">
        <div>${order.orderCustomer.government}</div>
        <div class="text-muted">${order.orderCustomer.zone}</div>
      </td>
      <td class="amount">
        <div>${getFormattedAmount(order)}</div>
        <div class="text-muted">${getAmountTypeLabel(order.orderShipping.amountType)}</div>
      </td>
      <td class="status">
        <span class="status-badge ${order.categoryClass || getStatusCategoryClass(order.statusCategory)}">
          ${order.statusLabel || getStatusLabel(order.orderStatus)}
        </span>
      </td>
      <td class="category">
        <span class="status-pill ${(order.statusCategory || 'NEW').toLowerCase()}">
          ${order.statusCategory || 'NEW'}
        </span>
      </td>
      <td class="tries">
        <div>${order.Attemps || 0}/2</div>
      </td>
      <td class="date">${new Date(order.orderDate).toLocaleDateString('en-US', {
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
                <i class="ri-printer-fill text-primary"></i>Print Delivery Policy
              </button>
            </li>
            <li>
              <button class="dropdown-item" onclick="handleSmartStickerScan('${order.orderNumber}')">
                <i class="ri-barcode-fill text-success"></i>Smart Sticker Scan
              </button>
            </li>
            <li>
              <a class="dropdown-item" href="/business/edit-order/${order.orderNumber}">
                <i class="ri-edit-2-fill text-warning"></i>Edit Order
              </a>
            </li>
            ${!['completed', 'returned', 'returnCompleted', 'canceled', 'terminated'].includes(order.orderStatus) ? 
              `<li>
                <button class="dropdown-item" onclick="handleCancelOrder('${order._id}', '${order.orderNumber}')">
                  <i class="ri-delete-bin-6-fill text-danger"></i>Cancel Order
                </button>
              </li>` : ''}
            <li>
              <a class="dropdown-item" href="/business/order-details/${order.orderNumber}">
                <i class="ri-truck-line text-info"></i>Track Order
              </a>
            </li>
          </ul>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
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

// Get status label (fallback if StatusHelper not available)
function getStatusLabel(status) {
  if (window.StatusHelper) {
    return StatusHelper.getOrderStatusLabel(status);
  }
  
  // Fallback to legacy function
  return getStatusDetails(status).statusText;
}

// Get order type with icon
function getOrderTypeWithIcon(orderType) {
  switch(orderType) {
    case 'Deliver':
      return '<i class="ri-truck-line me-1"></i> Deliver';
    case 'Return':
      return '<i class="ri-arrow-go-back-line me-1"></i> Return';
    case 'Exchange':
      return '<i class="ri-exchange-line me-1"></i> Exchange';
    case 'Cash Collection':
      return '<i class="ri-money-dollar-box-line me-1"></i> Cash Collection';
    default:
      return orderType;
  }
}

// Format amount based on order type
function getFormattedAmount(order) {
  if (!order.orderShipping.amount) return '0 EGP';
  
  const amount = order.orderShipping.amount;
  const amountType = order.orderShipping.amountType;
  const orderType = order.orderShipping.orderType;
  
  if (orderType === 'Cash Collection') {
    return `<span class="text-success fw-medium">${amount} EGP</span>`;
  } else if (orderType === 'Exchange') {
    if (amountType === 'CD') {
      return `<span class="text-warning">${amount} EGP</span>`;
    } else {
      return `<span>${amount} EGP</span>`;
    }
  } else if (amountType === 'COD') {
    return `<span class="text-primary">${amount} EGP</span>`;
  } else {
    return `${amount} EGP`;
  }
}

// Get readable amount type label
function getAmountTypeLabel(amountType) {
  switch(amountType) {
    case 'COD':
      return 'Cash on Delivery';
    case 'CD':
      return 'Cash Difference';
    case 'CC':
      return 'Cash Collection';
    case 'NA':
      return 'No Payment';
    default:
      return amountType;
  }
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
  } else {
    badgeClass = 'bg-secondary-subtle text-secondary';
    statusText = 'Unknown';
  }

  return { badgeClass, statusText };
}

// Print Policy
async function printPolicy() {
  const orderId = document.getElementById('orderId').value;
  const paperSize = document.getElementById('paperSize').value;
  if (!paperSize) {
    alert('Please select a paper size.');
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
      title: 'Error',
      text: 'An error occurred while printing the policy. Please try again.',
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
    const dropdowns = document.querySelectorAll('.orders-table-dropdown');
    dropdowns.forEach(dropdown => {
      if (!dropdown.contains(event.target)) {
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
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
  }
  adjustDropdownPosition(dropdown);
}

function closeDropdown(dropdown) {
  dropdown.classList.remove('show');
  const toggle = dropdown.querySelector('[data-dropdown-toggle]');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
  }
}

function adjustDropdownPosition(dropdown) {
  const menu = dropdown.querySelector('.dropdown-menu');
  if (!menu) return;
  
  const rect = dropdown.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const menuHeight = menu.offsetHeight || 200; // fallback height
  
  // Calculate available space below the dropdown button
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  
  // If there's not enough space below and more space above, position dropdown above
  if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
    dropdown.classList.add('dropdown-up');
  } else {
    dropdown.classList.remove('dropdown-up');
  }
  
  // Ensure dropdown stays within viewport bounds
  const tableContainer = dropdown.closest('.table-responsive');
  if (tableContainer) {
    const tableRect = tableContainer.getBoundingClientRect();
    
    // If dropdown would go outside table container, adjust position
    if (rect.bottom + menuHeight > tableRect.bottom) {
      dropdown.classList.add('dropdown-up');
    }
  }
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
    title: 'Are you sure?',
    text: "You won't be able to revert this!",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#3085d6',
    cancelButtonColor: '#d33',
    confirmButtonText: 'Yes, cancel it!',
  }).then(async (result) => {
    if (result.isConfirmed) {
      const response = await fetch(`/business/orders/delete-order/${orderId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        Swal.fire({
          title: 'Cancelled!',
          text: 'Your order has been cancelled.',
          icon: 'success',
          confirmButtonText: 'OK',
        }).then(() => {
          window.location.href = '/business/orders';
        });
      }
    }
  }).catch((error) => {
    console.error('Error:', error);
    Swal.fire({
      title: 'Error!',
      text: 'There was an error cancelling the order. Please try again later.',
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
    title: 'Preparing export...',
    html: 'Please wait while we prepare your orders export.',
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
      title: 'Export Started!',
      text: 'Your orders export has been downloaded.',
      confirmButtonColor: '#0d6efd',
      timer: 2000
    });
  }, 500);
}