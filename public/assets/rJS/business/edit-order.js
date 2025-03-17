document.addEventListener('DOMContentLoaded', function () {
  // Order Type Toggle Logic
  const orderTypeRadios = document.querySelectorAll('input[name="orderType"]');
  const deliverSection = document.getElementById('deliver-section');
  const exchangeSection = document.getElementById('exchange-section');
  const cashCollectionSection = document.getElementById(
    'cash-collection-section'
  );

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