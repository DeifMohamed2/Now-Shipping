const __NS_OD =
  typeof window !== 'undefined' && window.__NS_BUSINESS_I18N && window.__NS_BUSINESS_I18N.orderDetails
    ? window.__NS_BUSINESS_I18N.orderDetails
    : {};

function escapeHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function returnRequestDialogHtml() {
  const intro = escapeHtml(__NS_OD.requestReturnIntro || '');
  const h = escapeHtml(__NS_OD.requestReturnWhatNext || '');
  const s1 = escapeHtml(__NS_OD.requestReturnStep1 || '');
  const s2 = escapeHtml(__NS_OD.requestReturnStep2 || '');
  const s3 = escapeHtml(__NS_OD.requestReturnStep3 || '');
  const s4 = escapeHtml(__NS_OD.requestReturnStep4 || '');
  const s5 = escapeHtml(__NS_OD.requestReturnStep5 || '');
  return `
        <p class="text-muted mb-3">${intro}</p>
        <div class="text-start od-return-steps" style="background:#f8fafc;border-radius:10px;padding:1rem;font-size:.875rem;">
          <p class="mb-2 fw-semibold" style="color:#0f172a;">${h}</p>
          <ol class="mb-0 ps-3" style="color:#475569;line-height:1.9;">
            <li>${s1}</li>
            <li>${s2}</li>
            <li>${s3}</li>
            <li>${s4}</li>
            <li>${s5}</li>
          </ol>
        </div>
      `;
}

function returnSuccessHtml(message) {
  const body = escapeHtml(message || __NS_OD.returnRequestedBody || '');
  const note = escapeHtml(__NS_OD.returnRequestedOtpNote || '');
  return `
            <p>${body}</p>
            <p class="text-muted small mt-2">
              <i class="ri-shield-keyhole-line me-1" style="color:#F39720;"></i>
              ${note}
            </p>
          `;
}

async function cancelOrder(orderId, isReturnFlow) {
  if (isReturnFlow) {
    const result = await Swal.fire({
      title: __NS_OD.requestReturnTitle || 'Request return',
      html: returnRequestDialogHtml(),
      icon: 'info',
      showCancelButton: true,
      confirmButtonColor: '#F39720',
      cancelButtonColor: '#6c757d',
      confirmButtonText: __NS_OD.requestReturnConfirm || 'Yes, request return',
      cancelButtonText: __NS_OD.requestReturnCancel || 'Not now',
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
    const response = await fetch(`/business/orders/cancel-order/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (response.ok) {
      if (isReturnFlow) {
        await Swal.fire({
          title: __NS_OD.returnRequestedTitle || 'Return requested',
          html: returnSuccessHtml(data.message),
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
