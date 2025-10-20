async function cancelOrder(orderId) {
  Swal.fire({
    title: 'Are you sure?',
    text: "You won't be able to revert this!",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#3085d6',
    cancelButtonColor: '#d33',
    confirmButtonText: 'Yes, cancel it!',
  })
    .then(async (result) => {
      if (result.isConfirmed) {
        const response = await fetch(
          `/business/orders/cancel-order/${orderId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

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
    })
    .catch((error) => {
      console.error('Error:', error);
      Swal.fire({
        title: 'Error!',
        text: 'There was an error cancelling the order. Please try again later.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    });
}
