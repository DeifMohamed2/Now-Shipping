document.addEventListener('DOMContentLoaded', function () {
  // Order Type Toggle Logic
  const orderTypeRadios = document.querySelectorAll('input[name="orderType"]');
  const deliverSection = document.getElementById('deliver-section');
  const exchangeSection = document.getElementById('exchange-section');
  const cashCollectionSection = document.getElementById(
    'cash-collection-section'
  );

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

  // Function to update fees display and input
  function updateFees() {
    const selectedGovernment = document.querySelector('select[name="government"]').value;
    const selectedOrderType = document.querySelector('input[name="orderType"]:checked').value;
    
    // Check if any express shipping checkbox is checked
    const isExpressShipping = 
      document.getElementById('express-shipping-checkbox')?.checked || 
      document.getElementById('express-shipping-exchange-checkbox')?.checked || 
      document.getElementById('express-shipping-collection-checkbox')?.checked;
    
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
    
    // Create or update the hidden input for order fees
    let orderFeesInput = document.getElementById('orderFeesInput');
    if (!orderFeesInput) {
      orderFeesInput = document.createElement('input');
      orderFeesInput.type = 'hidden';
      orderFeesInput.name = 'orderFees';
      orderFeesInput.id = 'orderFeesInput';
      document.getElementById('editOrderForm').appendChild(orderFeesInput);
    }
    orderFeesInput.value = totalFee;
  }

  function toggleSections() {
    const selectedValue = document.querySelector(
      'input[name="orderType"]:checked'
    ).value;

    // Hide all sections first
    deliverSection.style.display = 'none';
    exchangeSection.style.display = 'none';
    cashCollectionSection.style.display = 'none';

    // Show the appropriate section based on selection
    if (selectedValue === 'Deliver' || selectedValue === 'Return') {
      deliverSection.style.display = 'block';
    } else if (selectedValue === 'Exchange') {
      exchangeSection.style.display = 'block';
    } else if (selectedValue === 'Cash Collection') {
      cashCollectionSection.style.display = 'block';
    }

    // Update fees whenever sections change
    updateFees();
  }

  orderTypeRadios.forEach((radio) => {
    radio.addEventListener('change', toggleSections);
  });

  // Initialize sections based on default selection
  toggleSections();

  // Cash on Delivery Toggle
  const codCheckbox = document.getElementById('cash-on-delivery-checkbox');
  const codAmount = document.getElementById('cash-on-delivery-amount');

  codCheckbox.addEventListener('change', function () {
    codAmount.style.display = this.checked ? 'block' : 'none';
  });

  // Cash Difference Toggle
  const cashDiffCheckbox = document.getElementById('cash-difference-checkbox');
  const cashDiffAmount = document.getElementById('cash-difference-amount');

  cashDiffCheckbox.addEventListener('change', function () {
    cashDiffAmount.style.display = this.checked ? 'block' : 'none';
  });

  // Express Shipping Checkboxes Sync
  const expressShippingCheckboxes = [
    document.getElementById('express-shipping-checkbox'),
    document.getElementById('express-shipping-exchange-checkbox'),
    document.getElementById('express-shipping-collection-checkbox')
  ].filter(Boolean); // Filter out any null elements

  expressShippingCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      // If this checkbox is checked, uncheck others
      if (this.checked) {
        expressShippingCheckboxes.forEach(cb => {
          if (cb !== this) cb.checked = false;
        });
      }
      // Update fees when express shipping option changes
      updateFees();
    });
  });

  // Update fees when government changes
  document.querySelector('select[name="government"]')?.addEventListener('change', updateFees);

  // Initialize tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  // Increment/Decrement Buttons
  function setupCounter(decrementId, incrementId, inputId) {
    const decrementBtn = document.getElementById(decrementId);
    const incrementBtn = document.getElementById(incrementId);
    const input = document.getElementById(inputId);

    decrementBtn.addEventListener('click', function () {
      const currentValue = parseInt(input.value) || 0;
      if (currentValue > 0) {
        input.value = currentValue - 1;
      }
    });

    incrementBtn.addEventListener('click', function () {
      const currentValue = parseInt(input.value) || 0;
      input.value = currentValue + 1;
    });
  }

  setupCounter('decrement-shipping', 'increment-shipping', 'numberOfItems');
  setupCounter(
    'decrement-current',
    'increment-current',
    'numberOfItemsCurrentPD'
  );
  setupCounter('decrement-new', 'increment-new', 'numberOfItemsNewPD');

  // Calculate fees on load
  updateFees();

  // Edit Submition
  const editOrderForm = document.getElementById('editOrderForm');

  editOrderForm.addEventListener('submit', async  (e)=> {
    e.preventDefault();
    try {
      const orderTypeRadios = document.querySelectorAll(
        'input[name="orderType"]'
      );
      orderTypeRadios.forEach((radio) => {
        radio.disabled = false;
      });

      // Update fees before submission
      updateFees();

      const orderId = document.getElementById('orderId').value;
      const formData = new FormData(editOrderForm);
      const formObject = Object.fromEntries(formData.entries());

      console.log('formObject:', formObject);

      const response = await fetch(`/business/orders/edit-order/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formObject),
      });
      const data = await response.json();
      console.log('data:', data);

      if (response.ok) {
        Swal.fire({
          title: 'Success!',
          text: 'Order has been updated successfully',
          icon: 'success',
          confirmButtonText: 'OK',
        }).then(() => {
          window.location.href = '/business/orders';
        });
        const orderTypeRadios = document.querySelectorAll(
        'input[name="orderType"]'
        );
        orderTypeRadios.forEach((radio) => {
        radio.disabled = true;
        });

      }else{
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: `${data.error}`,
        });
                 const orderTypeRadios = document.querySelectorAll(
                   'input[name="orderType"]'
                 );
                 orderTypeRadios.forEach((radio) => {
                   radio.disabled = true;
                 });

      }
    } catch (error) {
      console.error('An error occurred:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'An error occurred while updating the order. Please try again.',
      });
               const orderTypeRadios = document.querySelectorAll(
                 'input[name="orderType"]'
               );
               orderTypeRadios.forEach((radio) => {
                 radio.disabled = true;
               });

    }
  });
});