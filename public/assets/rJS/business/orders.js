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
  document.getElementById('statusCategoryDropdown').innerHTML = 
    `<i class="ri-filter-2-line me-1"></i> ${category === 'all' ? 'All' : category}`;
  fetchOrders(currentOrderType, category);
}

// Filter by order type
function filterOrders(orderType) {
  currentOrderType = orderType;
  fetchOrders(orderType, currentStatusCategory);
}

// Filter returned orders
function filterReturnedOrders() {
  fetchOrders('Return', currentStatusCategory);
}

// Fetch Orders
async function fetchOrders(orderType = "all", statusCategory = "all") {
  try {
    showLoadingSpinner();
    
    // Build the query parameters
    const params = new URLSearchParams();
    
    if (orderType && orderType !== 'all') {
      params.append('orderType', orderType);
    }
    
    if (statusCategory && statusCategory !== 'all') {
      params.append('statusCategory', statusCategory);
    }
    
    // Create the URL with query parameters
    const url = `/business/get-orders${params.toString() ? '?' + params.toString() : ''}`;
    
    const response = await fetch(url);
    const orders = await response.json();
    
    if (response.ok) {
      handleOrdersResponse(orders);
    } else {
      showError(`Error fetching orders: ${orders.message || 'Unknown error'}`);
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
  if (orders.length === 0) {
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
        <div class="dropdown dropdown-fix">
          <button class="btn btn-soft-secondary btn-sm dropdown" type="button" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="ri-more-fill align-middle"></i>
          </button>
          <ul class="dropdown-menu">
            <li><button class="dropdown-item" data-bs-toggle="modal" data-bs-target="#printPolicyModal" onclick="setOrderId('${
              order.orderNumber
            }')">
              <i class="ri-printer-fill align-bottom me-2 text-primary"></i> <span class="fs-6">Print Delivery Policy</span>
            </button></li>
            <li><button class="dropdown-item"><i class="ri-barcode-fill align-bottom me-2 text-success"></i> <span class="fs-6">Smart Sticker Scan</span></button></li>
            <li><a class="dropdown-item" href="/business/edit-order/${
              order.orderNumber
            }">
              <i class="ri-edit-2-fill align-bottom me-2 text-warning"></i> <span class="fs-6">Edit Order</span>
            </a></li>
            ${!['completed', 'returned', 'returnCompleted', 'canceled', 'terminated'].includes(order.orderStatus) ? 
              `<li><button class="dropdown-item" onclick="cancelOrder('${
                order._id
              }')"><i class="ri-delete-bin-6-fill align-bottom me-2 text-danger"></i> <span class="fs-6">Cancel Order</span></button></li>` : ''}
            <li><a class="dropdown-item" href="/business/order-details/${
              order.orderNumber
            }"><i class="ri-truck-line align-bottom me-2 text-info"></i> <span class="fs-6">Track Order</span></a></li>
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