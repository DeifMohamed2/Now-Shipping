function selectPaperSize(size) {
  document.getElementById('paperSize').value = size;
  document.querySelectorAll('.paper-size-option').forEach((option) => {
    option.classList.remove('selected');
  });
  document
    .querySelector(`.paper-size-option[onclick="selectPaperSize('${size}')"]`)
    .classList.add('selected');
}

async function printPolicy() {
  const orderId = document.getElementById('orderId').value;
  const paperSize = document.getElementById('paperSize').value;
  if (!paperSize) {
    alert('Please select a paper size.');
    return;
  }
try{
    console.log('orderId:', orderId);
   await fetch(
    `/business/orders/print-policy/${orderId}/${paperSize}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paperSize }),
    }
  ).then(response => response.blob())  // Convert response to a Blob (PDF file)
.then(blob => {
    const url = window.URL.createObjectURL(blob);
    window.open(url);  // Open in a new tab
})


}catch(err){
    console.error('An error occurred:', err);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'An error occurred while printing the policy. Please try again.',
    });
}


  // Close the modal
  let modal = bootstrap.Modal.getInstance(
    document.getElementById('printPolicyModal')
  );
  modal.hide();
}

function setOrderId(orderId) {
  document.getElementById('orderId').value = orderId;
}
