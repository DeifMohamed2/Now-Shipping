document.querySelectorAll('input[name="orderType"]').forEach(function(element) {
    element.addEventListener('change', function() {
        // Hide all sections initially
        document.getElementById('deliver-section').style.display = 'none';
        document.getElementById('exchange-section').style.display = 'none';
        // document.getElementById('return-section').style.display = 'none';
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
            document.getElementById('deliver-section').style.display = 'block';
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
                    text: 'Number of items cannot be zero or negative.',
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
    const cashCollectionSection = document.getElementById('cash-collection-section');
    const completeOrderBTN = document.getElementById('completeOrderBTN');

    // Fee calculation configuration
    const feeConfig = {
        governments: {
            'Cairo': {
                Delivery: 80,
                RTO: 70,
                CashCollection: 70,
                CRP: 90,
                Exchange: 95,
                LightBulky: 180,
                HeavyBulky: 430
            },
            'Alexandria': {
                Delivery: 85,
                RTO: 75,
                CashCollection: 75,
                CRP: 95,
                Exchange: 100,
                LightBulky: 185,
                HeavyBulky: 480
            },
            'Delta-Canal': {
                Delivery: 91,
                RTO: 81,
                CashCollection: 81,
                CRP: 101,
                Exchange: 106,
                LightBulky: 191,
                HeavyBulky: 540
            },
            'Upper-RedSea': {
                Delivery: 116,
                RTO: 106,
                CashCollection: 106,
                CRP: 126,
                Exchange: 131,
                LightBulky: 216,
                HeavyBulky: 790
            }
        },
        governmentCategories: {
            'Cairo': ['Cairo', 'Giza'],
            'Alexandria': ['Alexandria', 'Matrouh'],
            'Delta-Canal': ['Dakahlia', 'Sharqia', 'Qalyubia', 'Kafr El Sheikh', 'Gharbia', 'Monufia', 'Beheira', 'Damietta', 'Port Said', 'Ismailia', 'Suez'],
            'Upper-RedSea': ['Faiyum', 'Beni Suef', 'Minya', 'Asyut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea', 'New Valley', 'North Sinai', 'South Sinai']
        }
    };

    // Function to update fees display
    function updateFees() {
        const selectedGovernment = form.querySelector('select[name="government"]').value;
        const selectedOrderType = form.querySelector('input[name="orderType"]:checked')?.value || 'Deliver';
        const isExpressShipping = form.querySelector('input[name="isExpressShipping"]:checked') !== null;
        
        // Determine which government category the selected government belongs to
        let governmentCategory = 'Cairo'; // Default
        for (const [category, governments] of Object.entries(feeConfig.governmentCategories)) {
            if (governments.includes(selectedGovernment)) {
                governmentCategory = category;
                break;
            }
        }
        
        // Get base fee based on service type and government category
        let baseFee = 0;
        
        if (selectedOrderType === 'Deliver') {
            baseFee = feeConfig.governments[governmentCategory].Delivery;
        } else if (selectedOrderType === 'Return') {
            baseFee = feeConfig.governments[governmentCategory].RTO;
        } else if (selectedOrderType === 'Exchange') {
            baseFee = feeConfig.governments[governmentCategory].Exchange;
        } else if (selectedOrderType === 'Cash Collection') {
            baseFee = feeConfig.governments[governmentCategory].CashCollection;
        }
        
        // Apply express shipping if selected (doubles the fee)
        const totalFee = isExpressShipping ? baseFee * 2 : baseFee;
        
        document.getElementById('totalFee').textContent = totalFee;
        
        // Update hidden input for order fees
        const orderFeesInput = document.getElementById('orderFeesInput');
        if (!orderFeesInput) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'orderFees';
            input.id = 'orderFeesInput';
            input.value = totalFee;
            form.appendChild(input);
        } else {
            orderFeesInput.value = totalFee;
        }
    }

    // Add event listeners for zone, government, order type, and express shipping changes
    form.querySelector('select[name="zone"]').addEventListener('change', updateFees);
    form.querySelector('select[name="government"]').addEventListener('change', updateFees);
    
    orderTypeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            updateFees();
            
            // Show/hide express shipping checkboxes based on order type
            const expressCheckboxes = document.querySelectorAll('input[name="isExpressShipping"]');
            expressCheckboxes.forEach(checkbox => {
                checkbox.checked = false; // Reset when changing order type
            });
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
        const government = form.querySelector('select[name="government"]');
        const zone = form.querySelector('select[name="zone"]');

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
            // Deliver
            const productDescription = form.querySelector('textarea[name="productDescription"]');
            const numberOfItems = form.querySelector('input[name="numberOfItems"]');
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
        } else if(selectedOrderType.id === 'paymentMethod03') {
            // Deliver
            const productDescription = form.querySelector('textarea[name="productDescription"]');
            const numberOfItems = form.querySelector('input[name="numberOfItems"]');
            if (!productDescription.value.trim() || !numberOfItems.value || parseInt(numberOfItems.value) <= 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please fill out all required fields in the Deliver section with valid values.',
                });
                return false;
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
            console.log(formObject);
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
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: data.error,
                });
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

    // Function to show/hide sections based on order type
    orderTypeRadios.forEach((radio) => {
        radio.addEventListener('change', function () {
            deliverSection.style.display = this.id === 'paymentMethod01' || this.id === 'paymentMethod03' ? 'block' : 'none';
            exchangeSection.style.display = this.id === 'paymentMethod02' ? 'block' : 'none';
            cashCollectionSection.style.display = this.id === 'paymentMethod04' ? 'block' : 'none';
        });
    });
});