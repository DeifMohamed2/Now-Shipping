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

// Event Listeners
document.addEventListener("DOMContentLoaded", () => fetchOrders());

const checkAll = document.getElementById("checkAll");
if (checkAll) {
  checkAll.addEventListener("change", function() {
    const checkboxes = document.querySelectorAll("input[name='checkAll[]']");
    checkboxes.forEach(checkbox => {
      checkbox.checked = checkAll.checked;
    });
  });
}

// Fetch Orders
async function fetchOrders(status = "All") {
  try {
    showLoadingSpinner();
    const response = await fetch(`/business/get-orders?orderType=${status}`);
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
      <td colspan="9" class="text-center">
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
    
    // Add highlighting for different important statuses
    if (order.orderStatus === 'new') {
      row.classList.add('table-warning'); // Yellow highlight for new orders
    } else if (order.orderStatus === 'rejected' || order.orderStatus === 'returned') {
      row.classList.add('table-danger'); // Red highlight for problem orders
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
          ${ order.orderShipping.orderType}
  
      </td>
      <td class="location">
        <div>${order.orderCustomer.government}</div>
        <div class="text-muted">${order.orderCustomer.zone}</div>
      </td>
      <td class="amount">
        <div>${order.orderShipping.amount || 0} EGP</div>
        <div class="text-muted">${order.orderShipping.amountType}</div>
      </td>
      <td class="status">
        <span class="badge ${
          getStatusDetails(order.orderStatus).badgeClass
        } text-uppercase fs-6">${
        getStatusDetails(order.orderStatus).statusText
      }</span>
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
            <li><button class="dropdown-item" onclick="cancelOrder('${
              order._id
            }')"><i class="ri-delete-bin-6-fill align-bottom me-2 text-danger"></i> <span class="fs-6">Delete Order</span></button></li>
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
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Returned';
  } else if (status === 'terminated') {
    badgeClass = 'bg-danger-subtle text-danger';
    statusText = 'Terminated';
  } else if(status === 'waitingAction') {
    badgeClass = 'bg-warning-subtle text-warning';
    statusText = 'Waiting Action';
   
  }else{
    badgeClass = 'bg-secondary-subtle text-secondary';
    statusText = 'Unknown';
  }

  return { badgeClass, statusText };
}


async function filterOrders(status) {
  console.log("Filtering orders by status:", status);
  await fetchOrders(status);
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
