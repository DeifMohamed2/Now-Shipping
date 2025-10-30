document.querySelectorAll('input[name="orderType"]').forEach(function(element) {
    element.addEventListener('change', function() {
        // Hide all sections initially
        document.getElementById('deliver-section').style.display = 'none';
        document.getElementById('exchange-section').style.display = 'none';
        document.getElementById('return-section').style.display = 'none';
        document.getElementById('cash-collection-section').style.display = 'none';
        document.getElementById('cash-on-delivery-section').style.display = 'none';
        document.getElementById('cash-difference-section').style.display = 'none';

        // Show the relevant section based on the selected order type
        if (this.id === 'paymentMethod01') {
            document.getElementById('deliver-section').style.display = 'block';
            document.getElementById('cash-on-delivery-section').style.display = 'block';
            document.getElementById('orderCanbeOpened').style.display = 'block';
        } else if (this.id === 'paymentMethod02') {
            document.getElementById('exchange-section').style.display = 'block';
            document.getElementById('cash-difference-section').style.display = 'block';
            document.getElementById('orderCanbeOpened').style.display = 'block';
        } else if (this.id === 'paymentMethod03') {
            document.getElementById('return-section').style.display = 'block';
        } else if (this.id === 'paymentMethod04') {
            document.getElementById('cash-collection-section').style.display = 'block';
            document.getElementById('orderCanbeOpened').style.display = 'none';
        }
    });
});

// Handle Cash on Delivery checkbox
document.getElementById('cash-on-delivery-checkbox').addEventListener('change', function() {
    document.getElementById('cash-on-delivery-amount').style.display = this.checked ? 'block' : 'none';
});

// Handle Cash Difference checkbox
document.getElementById('cash-difference-checkbox').addEventListener('change', function() {
    document.getElementById('cash-difference-amount').style.display = this.checked ? 'block' : 'none';
});

// Counter functionality
function setupCounter(buttonId, inputId, increment = true) {
    document.getElementById(buttonId).addEventListener('click', function() {
        const input = document.getElementById(inputId);
        let value = parseInt(input.value) || 0;
        if(increment) {
            input.value = value + 1;
        } else {
            if(value > 1) {
                input.value = value - 1;
            } else {
                Swal.fire({
                    icon: 'warning',
                    title: 'Invalid Value',
                });
            }
        }
    });
}

// Add input validation for number fields
function setupNumberValidation(inputId) {
    document.getElementById(inputId).addEventListener('input', function() {
        const value = parseInt(this.value);
        if(value <= 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Invalid Value',
                text: 'Number of items cannot be zero or negative.',
            });
            this.value = 1;
        }
    });
}

setupCounter('increment-shipping', 'shipping-count', true);
setupCounter('decrement-shipping', 'shipping-count', false);
setupCounter('increment-current', 'exchange-current-count', true);
setupCounter('decrement-current', 'exchange-current-count', false);
setupCounter('increment-new', 'exchange-new-count', true);
setupCounter('decrement-new', 'exchange-new-count', false);
// setupCounter('increment-return', 'return-count', true);
// setupCounter('decrement-return', 'return-count', false);

// Setup validation for all number input fields
setupNumberValidation('shipping-count');
setupNumberValidation('exchange-current-count');
setupNumberValidation('exchange-new-count');

// Handle form submission
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('createOrderForm');
    const orderTypeRadios = document.querySelectorAll('input[name="orderType"]');
    const deliverSection = document.getElementById('deliver-section');
    const exchangeSection = document.getElementById('exchange-section');
    const returnSection = document.getElementById('return-section');
    const cashCollectionSection = document.getElementById('cash-collection-section');
    const completeOrderBTN = document.getElementById('completeOrderBTN');
    const feeDisplay = document.getElementById('totalFee');
    const feeDisplayContainer = document.getElementById('feeDisplayContainer');
    
    // Setup government and zone (now using hidden inputs from modal)
    const governmentInput = form.querySelector('input[name="government"]');
    const zoneInput = form.querySelector('input[name="zone"]');
    
    // Note: The old select-based logic is replaced by modal-based selection
    // If you need to add listeners for when values change from the modal, they're already in the main script

    // Function to update fees by calling server API (made global for modal access)
    window.updateFees = async function updateFees() {
        try {
            const selectedGovernment = form.querySelector('input[name="government"]').value;
            if (!selectedGovernment) {
                feeDisplay.textContent = '0';
                return;
            }
            
            // Show loading indicator
            if (feeDisplayContainer) {
                feeDisplayContainer.classList.add('loading');
            }
            
            const selectedOrderType = form.querySelector('input[name="orderType"]:checked')?.value || 'Deliver';
            const isExpressShipping = form.querySelector('input[name="isExpressShipping"]:checked') !== null;
            
            const response = await fetch('/business/calculate-fees', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    government: selectedGovernment,
                    orderType: selectedOrderType,
                    isExpressShipping: isExpressShipping
                }),
            });
            
            const data = await response.json();
            
            if (response.ok) {
                feeDisplay.textContent = data.fee;
            } else {
                console.error('Error calculating fees:', data.error);
                feeDisplay.textContent = '0';
                
                // Handle authentication errors for fee calculation
                if (response.status === 401) {
                    console.warn('Authentication expired during fee calculation');
                    // Don't show popup for fee calculation errors, just log them
                }
            }
        } catch (error) {
            console.error('Error calculating fees:', error);
            feeDisplay.textContent = '0';
        } finally {
            // Hide loading indicator
            if (feeDisplayContainer) {
                feeDisplayContainer.classList.remove('loading');
            }
        }
    }

    // Add event listeners for order type and express shipping changes
    // Note: Government and zone are now handled by the modal in the main script
    
    orderTypeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            // Show/hide express shipping checkboxes based on order type
            const expressCheckboxes = document.querySelectorAll('input[name="isExpressShipping"]');
            expressCheckboxes.forEach(checkbox => {
                checkbox.checked = false; // Reset when changing order type
            });
            
            // Recalculate fees when order type changes
            updateFees();
        });
    });
    
    // Add event listeners for express shipping checkboxes
    document.querySelectorAll('input[name="isExpressShipping"]').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            // Ensure only one express shipping checkbox is checked at a time
            if (this.checked) {
                document.querySelectorAll('input[name="isExpressShipping"]').forEach(cb => {
                    if (cb !== this) cb.checked = false;
                });
            }
            
            // Recalculate fees when express shipping option changes
            updateFees();
        });
    });

    // Initialize tooltips
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(tooltipEl => {
        new bootstrap.Tooltip(tooltipEl);
    });

    // Function to validate Customer Info tab
    function validateCustomerInfo() {
        const fullName = form.querySelector('input[name="fullName"]');
        const phoneNumber = form.querySelector('input[name="phoneNumber"]');
        const address = form.querySelector('textarea[name="address"]');
        const government = form.querySelector('input[name="government"]');
        const zone = form.querySelector('input[name="zone"]');

        if (!fullName.value.trim() || !phoneNumber.value.trim() || !address.value.trim() || !government.value || !zone.value) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Information',
                text: 'Please fill out all required fields in the Customer Info tab.',
            });
            return false;
        }
        return true;
    }

    // Function to validate Shipping Info tab based on order type
    function validateShippingInfo() {
        const selectedOrderType = form.querySelector('input[name="orderType"]:checked');
        if (!selectedOrderType) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Information',
                text: 'Please select an order type.',
            });
            return false;
        }
        console.log(selectedOrderType);
        if (selectedOrderType.id === 'paymentMethod01') {
            // Deliver (scope to deliver section)
            const productDescription = document.querySelector('#deliver-section textarea[name="productDescription"]');
            const numberOfItems = document.querySelector('#deliver-section input[name="numberOfItems"]');
            if (!productDescription.value.trim() || !numberOfItems.value || parseInt(numberOfItems.value) <= 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please fill out all required fields in the Deliver section with valid values.',
                });
                return false;
            }
        } else if (selectedOrderType.id === 'paymentMethod02') {
            // Exchange
            const currentPD = form.querySelector('textarea[name="currentPD"]');
            const numberOfItemsCurrentPD = form.querySelector('input[name="numberOfItemsCurrentPD"]');
            const newPD = form.querySelector('textarea[name="newPD"]');
            const numberOfItemsNewPD = form.querySelector('input[name="numberOfItemsNewPD"]');
            if (!currentPD.value.trim() || !numberOfItemsCurrentPD.value || parseInt(numberOfItemsCurrentPD.value) <= 0 || 
                !newPD.value.trim() || !numberOfItemsNewPD.value || parseInt(numberOfItemsNewPD.value) <= 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please fill out all required fields in the Exchange section with valid values.',
                });
                return false;
            }
        } else if (selectedOrderType.id === 'paymentMethod03') {
            // Return (scope to return section)
            const originalOrderNumber = document.querySelector('#return-section input[name="originalOrderNumber"]');
            
            // Check if this is a partial return
            const returnTypeRadios = document.querySelectorAll('input[name="returnType"]');
            const isPartialReturn = Array.from(returnTypeRadios).find(radio => radio.checked && radio.value === 'partial');
            
            if (isPartialReturn) {
                // For partial returns, validate standard fields plus partial return item count
                const partialReturnItemCount = document.querySelector('#return-section input[name="partialReturnItemCount"]');
                const productDescription = document.querySelector('#return-section textarea[name="productDescription"]');
                const returnReason = document.querySelector('#return-section select[name="returnReason"]');
                
                if (!originalOrderNumber.value.trim() || !partialReturnItemCount.value || parseInt(partialReturnItemCount.value) <= 0 || !productDescription.value.trim() || !returnReason.value) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Missing Information',
                        text: 'Please fill out all required fields in the Return section with valid values.',
                    });
                    return false;
                }
            } else {
                // For full returns, validate standard fields
                const productDescription = document.querySelector('#return-section textarea[name="productDescription"]');
                const numberOfItems = document.querySelector('#return-section input[name="numberOfItems"]');
                const returnReason = document.querySelector('#return-section select[name="returnReason"]');
                
                if (!productDescription.value.trim() || !numberOfItems.value || parseInt(numberOfItems.value) <= 0 ||
                    !originalOrderNumber.value.trim() || !returnReason.value) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Missing Information',
                        text: 'Please fill out all required fields in the Return section with valid values.',
                    });
                    return false;
                }
            }
        }
        else if (selectedOrderType.id === 'paymentMethod04') {
            // Cash Collection
            const amountCashCollection = form.querySelector('input[name="amountCashCollection"]');
            if (!amountCashCollection.value) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please fill out all required fields in the Cash Collection section.',
                });
                return false;
            }
        }
        return true;
    }

    // Function to handle form submission
    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        completeOrderBTN.disabled = true;
        completeOrderBTN.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';  
        if (!validateCustomerInfo() || !validateShippingInfo()) {
            completeOrderBTN.disabled = false;
            completeOrderBTN.innerHTML = '<i class="ri-shopping-basket-line label-icon align-middle fs-16 ms-2"></i>Complete Order';
            return;
        }
        try {
            const formData = new FormData(form);
            const formObject = Object.fromEntries(formData.entries());
            console.log('Form data being submitted:', formObject);
            
            // Handle partial return: automatically set numberOfItems from partialReturnItemCount
            if (formObject.orderType === 'Return' && formObject.returnType === 'partial') {
              formObject.numberOfItems = formObject.partialReturnItemCount;
              formObject.isPartialReturn = 'true'; // Ensure this flag is explicitly set
              console.log('Partial return detected - setting numberOfItems to:', formObject.partialReturnItemCount);
            } else if (formObject.orderType === 'Return') {
              formObject.isPartialReturn = 'false'; // Explicitly set for full returns
            }
            
            // Debug: Check if partial return fields are properly included
            if (formObject.orderType === 'Return') {
              console.log('Return order detected');
              console.log('returnType:', formObject.returnType);
              console.log('isPartialReturn:', formObject.isPartialReturn);
              console.log('partialReturnItemCount:', formObject.partialReturnItemCount);
              console.log('numberOfItems (final):', formObject.numberOfItems);
              console.log('productDescription:', formObject.productDescription);
              console.log('returnReason:', formObject.returnReason);
            }
            const response = await fetch('/business/submit-order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formObject),
            });
            const data = await response.json();

            if (response.ok) {
                document.getElementById('orderNmber').textContent = data.order.orderNumber;
                document.querySelector('[data-bs-target="#pills-finish"]').classList.remove('disabled')
                document.querySelector('[data-bs-target="#pills-finish"]').click();
                form.reset();
                document
                  .querySelectorAll('.nav-create')
                  .forEach(function (tab) {
                    tab.classList.add('disabled');
                  });
            } else {
                // Handle authentication errors specifically
                if (response.status === 401) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Session Expired',
                        text: 'Your session has expired. Please log in again.',
                        confirmButtonText: 'Go to Login'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            window.location.href = '/login';
                        }
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: data.error || 'An error occurred while creating the order.',
                    });
                }
            }
        } catch (error) {
            console.error('An error occurred:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'An error occurred while creating the order. Please try again.',
            });
        } finally {
            completeOrderBTN.disabled = false;
            completeOrderBTN.innerHTML = '<i class="ri-shopping-basket-line label-icon align-middle fs-16 ms-2"></i>Complete Order';
        }
    });

    // Helper to show/hide sections based on selected order type
    function syncSections() {
        const checked = form.querySelector('input[name="orderType"]:checked');
        const id = checked ? checked.id : '';
        deliverSection.style.display = id === 'paymentMethod01' ? 'block' : 'none';
        exchangeSection.style.display = id === 'paymentMethod02' ? 'block' : 'none';
        returnSection.style.display = id === 'paymentMethod03' ? 'block' : 'none';
        cashCollectionSection.style.display = id === 'paymentMethod04' ? 'block' : 'none';
    }

    // Wire change handlers
    orderTypeRadios.forEach((radio) => {
        radio.addEventListener('change', function () {
            syncSections();
        });
    });

    // Initial sync on page load
    syncSections();
    
    // Initialize fees calculation
    updateFees();
});