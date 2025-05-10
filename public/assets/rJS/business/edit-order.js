document.addEventListener('DOMContentLoaded', function () {
  // Order Type Toggle Logic
  const orderTypeRadios = document.querySelectorAll('input[name="orderType_display"]');
  const deliverSection = document.getElementById('deliver-section');
  const exchangeSection = document.getElementById('exchange-section');
  const cashCollectionSection = document.getElementById(
    'cash-collection-section'
  );
  
  // Initialize section visibility based on the hidden orderType input
  function initializeOrderTypeSections() {
    // Get the value from the hidden input
    const orderType = document.querySelector('input[name="orderType"]').value;
    
    // Hide all sections first
    if (deliverSection) deliverSection.style.display = 'none';
    if (exchangeSection) exchangeSection.style.display = 'none';
    if (cashCollectionSection) cashCollectionSection.style.display = 'none';
    
    // Show the appropriate section based on the order type
    if (orderType === 'Deliver' || orderType === 'Return') {
      if (deliverSection) deliverSection.style.display = 'block';
    } else if (orderType === 'Exchange') {
      if (exchangeSection) exchangeSection.style.display = 'block';
    } else if (orderType === 'Cash Collection') {
      if (cashCollectionSection) cashCollectionSection.style.display = 'block';
    }
  }
  
  // Call the initialization function
  initializeOrderTypeSections();

  // Cash on Delivery toggle
  const cashOnDeliveryCheckbox = document.getElementById('cash-on-delivery-checkbox');
  const cashOnDeliveryAmount = document.getElementById('cash-on-delivery-amount');
  
  if (cashOnDeliveryCheckbox && cashOnDeliveryAmount) {
    cashOnDeliveryCheckbox.addEventListener('change', function() {
      cashOnDeliveryAmount.style.display = this.checked ? 'block' : 'none';
    });
  }
  
  // Cash Difference toggle
  const cashDifferenceCheckbox = document.getElementById('cash-difference-checkbox');
  const cashDifferenceAmount = document.getElementById('cash-difference-amount');
  
  if (cashDifferenceCheckbox && cashDifferenceAmount) {
    cashDifferenceCheckbox.addEventListener('change', function() {
      cashDifferenceAmount.style.display = this.checked ? 'block' : 'none';
    });
  }

  // Filter zones based on selected government
  function filterZonesByGovernment(governmentSelect, zoneSelect) {
    // Get the selected government
    const selectedGovernment = governmentSelect.value;
    const previouslySelectedZone = zoneSelect.getAttribute('data-selected-zone');
    
    // Clear the zone select dropdown first
    zoneSelect.innerHTML = '<option value="">Select Area</option>';
    
    // If no government is selected, just leave the empty dropdown
    if (!selectedGovernment) {
      return;
    }
    
    // Get all optgroups from the dropdown
    const sourceElement = document.createElement('select');
    sourceElement.style.display = 'none';
    sourceElement.innerHTML = document.getElementById('zone-options-template').innerHTML;
    document.body.appendChild(sourceElement);
    
    // Add only relevant optgroups and options based on selected government
    if (selectedGovernment === 'Cairo') {
      // Add only Cairo zones
      sourceElement.querySelectorAll('optgroup[label^="Cairo"]').forEach(optgroup => {
        zoneSelect.appendChild(optgroup.cloneNode(true));
      });
    } else if (selectedGovernment === 'Giza') {
      // Add only Giza zones
      sourceElement.querySelectorAll('optgroup[label^="Giza"]').forEach(optgroup => {
        zoneSelect.appendChild(optgroup.cloneNode(true));
      });
    } else if (selectedGovernment === 'Alexandria') {
      // Add only Alexandria zones
      sourceElement.querySelectorAll('optgroup[label^="Alexandria"]').forEach(optgroup => {
        zoneSelect.appendChild(optgroup.cloneNode(true));
      });
    }
    
    // Select the previously selected zone if applicable
    if (previouslySelectedZone) {
      Array.from(zoneSelect.options).forEach(option => {
        if (option.value === previouslySelectedZone) {
          option.selected = true;
        }
      });
    }
    
    // Clean up the temporary element
    document.body.removeChild(sourceElement);
  }

  // Function to update fees by calling server API
  async function updateFees() {
    try {
      const selectedGovernment = document.querySelector('select[name="government"]').value;
      if (!selectedGovernment) {
        document.getElementById('totalFee').textContent = '0';
        return;
      }
      
      // Show loading indicator
      const feeDisplayContainer = document.getElementById('feeDisplayContainer');
      if (feeDisplayContainer) {
          feeDisplayContainer.classList.add('loading');
      }
      
      const selectedOrderType = document.querySelector('input[name="orderType"]:checked')?.value || 'Deliver';
      const isExpressShipping = document.querySelector('input[name="isExpressShipping"]:checked') !== null;
      
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
        document.getElementById('totalFee').textContent = data.fee;
      } else {
        console.error('Error calculating fees:', data.error);
        document.getElementById('totalFee').textContent = '0';
      }
    } catch (error) {
      console.error('Error calculating fees:', error);
      document.getElementById('totalFee').textContent = '0';
    } finally {
      // Hide loading indicator
      const feeDisplayContainer = document.getElementById('feeDisplayContainer');
      if (feeDisplayContainer) {
          feeDisplayContainer.classList.remove('loading');
      }
    }
  }

  // Setup government and zone filtering
  const governmentSelect = document.querySelector('select[name="government"]');
  const zoneSelect = document.querySelector('select[name="zone"]');
  
  if (governmentSelect && zoneSelect) {
    // Initialize filtering on page load
    if (governmentSelect.value) {
      filterZonesByGovernment(governmentSelect, zoneSelect);
    }
    
    // Add change event listener to government dropdown
    governmentSelect.addEventListener('change', function() {
        filterZonesByGovernment(governmentSelect, zoneSelect);
        updateFees(); // Recalculate fees when government changes
    });
    
    // Add change listener to zone select
    zoneSelect.addEventListener('change', updateFees);
  }

  // Add event listeners for order type changes - This part is commented out since the order type is disabled in edit mode
  // orderTypeRadios.forEach((radio) => {
  //   radio.addEventListener('change', function () {
  //     // Show/hide sections based on order type
  //     deliverSection.style.display =
  //       this.id === 'orderTypeDeliver' || this.id === 'orderTypeReturn'
  //         ? 'block'
  //         : 'none';
  //     exchangeSection.style.display = this.id === 'orderTypeExchange' ? 'block' : 'none';
  //     cashCollectionSection.style.display = this.id === 'orderTypeCashCollection' ? 'block' : 'none';
  //     
  //     // Show/hide express shipping checkboxes based on order type
  //     const expressCheckboxes = document.querySelectorAll('input[name="isExpressShipping"]');
  //     expressCheckboxes.forEach(checkbox => {
  //         checkbox.checked = false; // Reset when changing order type
  //     });
  //     
  //     // Recalculate fees when order type changes
  //     updateFees();
  //   });
  // });
  
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

  // Form Submission
  document.getElementById('editOrderForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    // Get form data
    const formData = new FormData(this);
    const formValues = Object.fromEntries(formData.entries());
    
    // Handle express shipping checkbox
    formValues.isExpressShipping = !!document.querySelector('input[name="isExpressShipping"]:checked');
    
    // Make sure orderType is included (it should be from the hidden input)
    if (!formValues.orderType) {
      // Fallback in case the hidden input is not working
      const orderTypeDisplayed = document.querySelector('input[name="orderType_display"]:checked');
      if (orderTypeDisplayed) {
        formValues.orderType = orderTypeDisplayed.value;
      }
    }
    
    // Validate required fields
    if (!formValues.fullName || !formValues.phoneNumber || !formValues.address || 
        !formValues.government || !formValues.zone) {
      Swal.fire({
        icon: 'error',
        title: 'Validation Error',
        text: 'Please fill in all required customer information fields.',
      });
      return;
    }
    
    const updateBtn = document.getElementById('updateOrderBtn');
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Updating...';
    
    const orderId = this.getAttribute('data-order-id');
    
    try {
      const response = await fetch(`/business/orders/edit-order/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formValues),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        Swal.fire({
          icon: 'success',
          title: 'Order Updated',
          text: 'Order has been updated successfully!',
          confirmButtonText: 'View Order',
        }).then((result) => {
          if (result.isConfirmed) {
            window.location.href = `/business/order-details/${data.order.orderNumber}`;
          }
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Update Failed',
          text: data.error || 'An error occurred while updating the order.',
        });
      }
    } catch (error) {
      console.error('An error occurred:', error);
      Swal.fire({
        icon: 'error',
        title: 'Update Failed',
        text: 'An error occurred while updating the order.',
      });
    } finally {
      updateBtn.disabled = false;
      updateBtn.innerHTML = '<i class="ri-save-line align-middle me-1"></i> Update Order';
    }
  });

  // Counter functionality
  function setupCounter(buttonId, inputId, increment = true) {
    document.getElementById(buttonId)?.addEventListener('click', function() {
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
    document.getElementById(inputId)?.addEventListener('input', function() {
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

  // Setup counters for all number inputs
  setupCounter('increment-shipping', 'numberOfItems', true);
  setupCounter('decrement-shipping', 'numberOfItems', false);
  setupCounter('increment-current', 'numberOfItemsCurrentPD', true);
  setupCounter('decrement-current', 'numberOfItemsCurrentPD', false);
  setupCounter('increment-new', 'numberOfItemsNewPD', true);
  setupCounter('decrement-new', 'numberOfItemsNewPD', false);

  // Setup validation for all number input fields
  setupNumberValidation('numberOfItems');
  setupNumberValidation('numberOfItemsCurrentPD');
  setupNumberValidation('numberOfItemsNewPD');
  
  // Initialize fees calculation
  updateFees();
});