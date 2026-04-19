const __NS_OD =
  typeof window !== 'undefined' && window.__NS_BUSINESS_I18N && window.__NS_BUSINESS_I18N.orderDetails
    ? window.__NS_BUSINESS_I18N.orderDetails
    : {};

async function cancelOrder(orderId, isReturnFlow) {
  if (isReturnFlow) {
    // Enhanced confirmation for return request
    const result = await Swal.fire({
      title: 'Request Return',
      html: `
        <p class="text-muted mb-3">Once confirmed, we will assign a courier to pick up the item from your customer.</p>
        <div class="text-start" style="background:#f8fafc;border-radius:10px;padding:1rem;font-size:.875rem;">
          <p class="mb-2 fw-semibold" style="color:#0f172a;">Here's what happens next:</p>
          <ol class="mb-0 ps-3" style="color:#475569;line-height:1.9;">
            <li>Admin assigns a courier for pickup</li>
            <li>A one-time OTP is sent to your customer via SMS</li>
            <li>Courier visits the customer and verifies OTP before pickup</li>
            <li>Item is delivered back to our warehouse</li>
            <li>Return is processed and delivered back to you</li>
          </ol>
        </div>
      `,
      icon: 'info',
      showCancelButton: true,
      confirmButtonColor: '#F39720',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Yes, Request Return',
      cancelButtonText: 'Not Now',
      customClass: { popup: 'rounded-3', confirmButton: 'rounded-2', cancelButton: 'rounded-2' },
    });
    if (!result.isConfirmed) return;
  } else {
    const confirm = await Swal.fire({
      title: __NS_OD.cancelConfirmTitle || 'Are you sure?',
      text: __NS_OD.cancelConfirmText || "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: __NS_OD.cancelConfirmYes || 'Yes, cancel it!',
    });
    if (!confirm.isConfirmed) return;
  }

  try {
    const response = await fetch(
      `/business/orders/cancel-order/${orderId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }

    if (response.ok) {
      if (isReturnFlow) {
        await Swal.fire({
          title: 'Return Requested!',
          html: `
            <p>${data.message || 'Your return request has been submitted successfully.'}</p>
            <p class="text-muted small mt-2">
              <i class="ri-shield-keyhole-line me-1" style="color:#F39720;"></i>
              Once admin assigns a courier, your customer will automatically receive an OTP via SMS for pickup verification.
            </p>
          `,
          icon: 'success',
          confirmButtonText: __NS_OD.ok || 'OK',
          confirmButtonColor: '#F39720',
        });
      } else {
        await Swal.fire({
          title: __NS_OD.cancelDoneTitle || 'Done',
          text: data.message || __NS_OD.cancelDoneText || 'Your order has been updated.',
          icon: 'success',
          confirmButtonText: __NS_OD.ok || 'OK',
        });
      }
      window.location.href = '/business/orders';
    } else {
      Swal.fire({
        icon: 'error',
        title: __NS_OD.cannotCancelTitle || 'Cannot cancel',
        text: data.error || __NS_OD.cannotCancelText || 'This order cannot be cancelled from its current status.',
        confirmButtonText: __NS_OD.ok || 'OK',
      });
    }
  } catch (error) {
    console.error('Error:', error);
    Swal.fire({
      title: __NS_OD.errorTitle || 'Error!',
      text: __NS_OD.errorCancelText || 'There was an error cancelling the order. Please try again later.',
      icon: 'error',
      confirmButtonText: __NS_OD.ok || 'OK',
    });
  }
}
