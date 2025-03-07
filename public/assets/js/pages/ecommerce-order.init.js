// Function to format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    const period = hours >= 12 ? 'PM' : 'AM';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    const formattedHours = hours % 12 || 12;

    return `${day} ${month}, ${year} <small class='text-muted'>${formattedHours}:${formattedMinutes} ${period}</small>`;
}

// Initialize Choices.js for dropdowns
const statusElement = document.getElementById('idStatus');
const statusChoices = new Choices(statusElement, { searchEnabled: false });

const paymentElement = document.getElementById('idPayment');
const paymentChoices = new Choices(paymentElement, { searchEnabled: false });

// Handle "Check All" functionality
const checkAllElement = document.getElementById('checkAll');
if (checkAllElement) {
    checkAllElement.onclick = function () {
        const checkboxes = document.querySelectorAll('.form-check-all input[type="checkbox"]');
        const checkedCount = document.querySelectorAll('.form-check-all input[type="checkbox"]:checked').length;

        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
            checkbox.closest('tr').classList.toggle('table-active', checkbox.checked);
        });

        document.getElementById('remove-actions').style.display = checkedCount > 0 ? 'none' : 'block';
    };
}

// Initialize List.js for order list
const perPage = 8;
const options = {
    valueNames: ['id', 'customer_name', 'product_name', 'date', 'amount', 'payment', 'status'],
    page: perPage,
    pagination: true,
    plugins: [ListPagination({ left: 2, right: 2 })],
};

const orderList = new List('orderList', options).on('updated', function (list) {
    const noResultElement = document.getElementsByClassName('noresult')[0];
    noResultElement.style.display = list.matchingItems.length === 0 ? 'block' : 'none';

    const isFirstPage = list.i === 1;
    const isLastPage = list.i > list.matchingItems.length - list.page;

    document.querySelector('.pagination-prev').classList.toggle('disabled', isFirstPage);
    document.querySelector('.pagination-next').classList.toggle('disabled', isLastPage);

    const paginationWrap = document.querySelector('.pagination-wrap');
    paginationWrap.style.display = list.matchingItems.length <= perPage ? 'none' : 'flex';

    if (list.matchingItems.length === perPage) {
        document.querySelector('.pagination.listjs-pagination').firstElementChild.children[0].click();
    }
});

// Load order data from JSON
const xhttp = new XMLHttpRequest();
xhttp.onload = function () {
    const orders = JSON.parse(this.responseText.replace(/<[^>]*>/g, ''));
    orders.forEach(order => {
        orderList.add({
            id: `<a href="apps-ecommerce-order-details.html" class="fw-medium link-primary">#VZ${order.id}</a>`,
            customer_name: order.customer_name,
            product_name: order.product_name,
            date: formatDate(order.date),
            amount: order.amount,
            payment: order.payment,
            status: formatStatus(order.status),
        });
        orderList.sort('id', { order: 'desc' });
        refreshCallbacks();
    });
    orderList.remove('id', '<a href="apps-ecommerce-order-details.html" class="fw-medium link-primary">#VZ2101</a>');
};
xhttp.open('GET', 'assets/json/orders-list.init.json');
xhttp.send();

// Helper function to format status
function formatStatus(status) {
    const statusClasses = {
        'Delivered': 'bg-success-subtle text-success',
        'Cancelled': 'bg-danger-subtle text-danger',
        'Inprogress': 'bg-secondary-subtle text-secondary',
        'Pickups': 'bg-info-subtle text-info',
        'Returns': 'bg-primary-subtle text-primary',
        'Pending': 'bg-warning-subtle text-warning',
    };
    return `<span class="badge ${statusClasses[status]} text-uppercase">${status}</span>`;
}

// Refresh callbacks for edit and remove buttons
function refreshCallbacks() {
    const removeButtons = document.getElementsByClassName('remove-item-btn');
    Array.from(removeButtons).forEach(button => {
        button.addEventListener('click', function () {
            const itemId = this.closest('tr').children[1].innerText;
            const items = orderList.get({ id: itemId });
            items.forEach(item => {
                const parsedId = new DOMParser().parseFromString(item._values.id, 'text/html').body.firstElementChild;
                if (parsedId.innerHTML === itemId) {
                    document.getElementById('delete-record').addEventListener('click', function () {
                        orderList.remove('id', parsedId.outerHTML);
                        document.getElementById('deleteRecord-close').click();
                    });
                }
            });
        });
    });

    const editButtons = document.getElementsByClassName('edit-item-btn');
    Array.from(editButtons).forEach(button => {
        button.addEventListener('click', function () {
            const itemId = this.closest('tr').children[1].innerText;
            const items = orderList.get({ id: itemId });
            items.forEach(item => {
                const parsedId = new DOMParser().parseFromString(item._values.id, 'text/html').body.firstElementChild;
                if (parsedId.innerHTML === itemId) {
                    editlist = true;
                    idField.value = parsedId.innerHTML;
                    customerNameField.value = item._values.customer_name;
                    productNameField.value = item._values.product_name;
                    dateField.value = item._values.date;
                    amountField.value = item._values.amount;
                    paymentChoices.setChoiceByValue(item._values.payment);
                    productnameVal.setChoiceByValue(item._values.product_name);
                    statusVal.setChoiceByValue(new DOMParser().parseFromString(item._values.status, 'text/html').body.firstElementChild.innerHTML);
                    flatpickr('#date-field', {
                        enableTime: true,
                        dateFormat: 'd M, Y, h:i K',
                        defaultDate: item._values.date,
                    });
                }
            });
        });
    });
}

// Clear input fields
function clearFields() {
    customerNameField.value = '';
    productNameField.value = '';
    dateField.value = '';
    amountField.value = '';
    paymentField.value = '';
    paymentChoices.clearStore();
    productnameVal.clearStore();
    statusVal.clearStore();
}

// Handle form submission
const forms = document.querySelectorAll('.tablelist-form');
Array.prototype.slice.call(forms).forEach(form => {
    form.addEventListener('submit', function (event) {
        if (form.checkValidity()) {
            event.preventDefault();
            if (editlist) {
                const items = orderList.get({ id: idField.value });
                items.forEach(item => {
                    const parsedId = new DOMParser().parseFromString(item._values.id, 'text/html').body.firstElementChild;
                    if (parsedId.innerHTML === itemId) {
                        item.values({
                            id: `<a href="javascript:void(0);" class="fw-medium link-primary">${idField.value}</a>`,
                            customer_name: customerNameField.value,
                            product_name: productNameField.value,
                            date: `${dateField.value.slice(0, 14)}<small class="text-muted">${dateField.value.slice(14, 22)}</small>`,
                            amount: amountField.value,
                            payment: paymentField.value,
                            status: formatStatus(statusField.value),
                        });
                    }
                });
                document.getElementById('close-modal').click();
                clearFields();
                Swal.fire({
                    position: 'center',
                    icon: 'success',
                    title: 'Order updated Successfully!',
                    showConfirmButton: false,
                    timer: 2000,
                    showCloseButton: true,
                });
            } else {
                orderList.add({
                    id: `<a href="apps-ecommerce-order-details.html" class="fw-medium link-primary">#VZ${count}</a>`,
                    customer_name: customerNameField.value,
                    product_name: productNameField.value,
                    date: dateField.value,
                    amount: `$${amountField.value}`,
                    payment: paymentField.value,
                    status: formatStatus(statusField.value),
                });
                orderList.sort('id', { order: 'desc' });
                document.getElementById('close-modal').click();
                clearFields();
                refreshCallbacks();
                filterOrder('All');
                count++;
                Swal.fire({
                    position: 'center',
                    icon: 'success',
                    title: 'Order inserted successfully!',
                    showConfirmButton: false,
                    timer: 2000,
                    showCloseButton: true,
                });
            }
        } else {
            event.preventDefault();
            event.stopPropagation();
        }
    }, false);
});

// Filter orders based on status
function filterOrder(status) {
    orderList.filter(item => {
        const parsedStatus = new DOMParser().parseFromString(item.values().status, 'text/html').body.firstElementChild.innerHTML;
        return status === 'All' || parsedStatus === status;
    });
    orderList.update();
}

// Update list based on selected status
function updateList() {
    const selectedStatus = document.querySelector('input[name=status]:checked').value;
    orderList.filter(item => selectedStatus === 'All' || item.values().sts === selectedStatus);
    orderList.update();
}

// Handle tab change event
const tabElements = document.querySelectorAll('a[data-bs-toggle="tab"]');
tabElements.forEach(tab => {
    tab.addEventListener('shown.bs.tab', function (event) {
        filterOrder(event.target.id);
    });
});

// Handle modal show event
document.getElementById('showModal').addEventListener('show.bs.modal', function (event) {
    if (event.relatedTarget.classList.contains('edit-item-btn')) {
        document.getElementById('exampleModalLabel').innerHTML = 'Edit Order';
        document.getElementById('showModal').querySelector('.modal-footer').style.display = 'block';
        document.getElementById('add-btn').innerHTML = 'Update';
    } else if (event.relatedTarget.classList.contains('add-btn')) {
        document.getElementById('modal-id').style.display = 'none';
        document.getElementById('exampleModalLabel').innerHTML = 'Add Order';
        document.getElementById('showModal').querySelector('.modal-footer').style.display = 'block';
        document.getElementById('add-btn').innerHTML = 'Add Order';
    } else {
        document.getElementById('exampleModalLabel').innerHTML = 'List Order';
        document.getElementById('showModal').querySelector('.modal-footer').style.display = 'none';
    }
});

// Handle modal hide event
document.getElementById('showModal').addEventListener('hidden.bs.modal', clearFields);

// Handle order list click event
document.querySelector('#orderList').addEventListener('click', function() {
    ischeckboxcheck();
});

function ischeckboxcheck() {
    // Define the function logic here
}

// Handle search data
function searchData() {
    const status = document.getElementById('idStatus').value;
    const payment = document.getElementById('idPayment').value;
    const dateRange = document.getElementById('demo-datepicker').value;
    const [startDate, endDate] = dateRange.split(' to ');

    orderList.filter(item => {
        const parsedStatus = new DOMParser().parseFromString(item.values().status, 'text/html').body.firstElementChild.innerHTML;
        const isStatusMatch = status === 'all' || parsedStatus === status;
        const isPaymentMatch = payment === 'all' || item.values().payment === payment;
        const isDateMatch = new Date(item.values().date.slice(0, 12)) >= new Date(startDate) && new Date(item.values().date.slice(0, 12)) <= new Date(endDate);

        return isStatusMatch && isPaymentMatch && isDateMatch;
    });
    orderList.update();
}

// Handle delete multiple orders
function deleteMultiple() {
    const selectedIds = [];
    const checkboxes = document.querySelectorAll('.form-check [value=option1]');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const id = checkbox.closest('tr').querySelector('td a').innerHTML;
            selectedIds.push(id);
        }
    });

    if (selectedIds.length > 0) {
        Swal.fire({
            title: 'Are you sure?',
            text: "You won't be able to revert this!",
            icon: 'warning',
            showCancelButton: true,
            customClass: {
                confirmButton: 'btn btn-primary w-xs me-2 mt-2',
                cancelButton: 'btn btn-danger w-xs mt-2',
            },
            confirmButtonText: 'Yes, delete it!',
            buttonsStyling: false,
            showCloseButton: true,
        }).then(result => {
            if (result.value) {
                selectedIds.forEach(id => {
                    orderList.remove('id', `<a href="apps-ecommerce-order-details.html" class="fw-medium link-primary">${id}</a>`);
                });
                document.getElementById('remove-actions').style.display = 'none';
                document.getElementById('checkAll').checked = false;
                Swal.fire({
                    title: 'Deleted!',
                    text: 'Your data has been deleted.',
                    icon: 'success',
                    customClass: { confirmButton: 'btn btn-info w-xs mt-2' },
                    buttonsStyling: false,
                });
            }
        });
    } else {
        Swal.fire({
            title: 'Please select at least one checkbox',
            customClass: { confirmButton: 'btn btn-info' },
            buttonsStyling: false,
            showCloseButton: true,
        });
    }
}

// Handle pagination next button click
document.querySelector('.pagination-next').addEventListener('click', function () {
    const activePage = document.querySelector('.pagination.listjs-pagination .active');
    if (activePage) {
        activePage.nextElementSibling.children[0].click();
    }
});

// Handle pagination previous button click
document.querySelector('.pagination-prev').addEventListener('click', function () {
    const activePage = document.querySelector('.pagination.listjs-pagination .active');
    if (activePage) {
        activePage.previousSibling.children[0].click();
    }
});
