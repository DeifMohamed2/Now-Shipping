/**
 * Admin business removal: impact report, soft delete, or full cascade.
 */
(function (global) {
  const BRAND = '#F39720';

  function formatEgp(n) {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n || 0);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildImpactHtml(impact) {
    const b = impact.business;
    const fin = impact.financial;
    const ops = impact.operations;
    const integ = impact.integrations;
    const finClass = impact.hardBlock ? 'text-danger' : '';

    let warningsHtml = '';
    if (impact.warnings && impact.warnings.length) {
      warningsHtml = `<div class="alert alert-warning text-start small mb-2">
        <strong>Operational warnings</strong>
        <ul class="mb-0 ps-3">${impact.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </div>`;
    }

    let blockHtml = '';
    if (impact.hardBlock && impact.blockReasons && impact.blockReasons.length) {
      blockHtml = `<div class="alert alert-danger text-start small mb-2">
        <strong>Cannot remove until resolved</strong>
        <ul class="mb-0 ps-3">${impact.blockReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      </div>`;
    }

    return `
      ${blockHtml}
      ${warningsHtml}
      <div class="text-start small">
        <p class="mb-2"><strong>${escapeHtml(b.brandName || b.name)}</strong><br>
        <span class="text-muted">${escapeHtml(b.email)} · ${escapeHtml(b.phoneNumber || '—')}</span>
        ${b.businessAccountCode ? `<br>Account code: <code>${escapeHtml(b.businessAccountCode)}</code>` : ''}
        </p>
        <table class="table table-sm table-bordered mb-2">
          <tbody>
            <tr><th class="w-50">Wallet balance</th><td class="${finClass} fw-semibold">${formatEgp(fin.balance)}</td></tr>
            <tr><th>Pending payouts</th><td>${fin.pendingPayouts}</td></tr>
            <tr><th>Ledger entries</th><td>${fin.totalLedgerEntries} <span class="text-muted">(kept)</span></td></tr>
            <tr><th>Total payouts</th><td>${fin.totalPayouts} <span class="text-muted">(kept)</span></td></tr>
            <tr><th>Orders</th><td>${ops.totalOrders} total · ${ops.activeOrders} active</td></tr>
            <tr><th>Pickups</th><td>${ops.totalPickups} total · ${ops.pendingPickups} pending</td></tr>
            <tr><th>Shop orders</th><td>${ops.totalShopOrders}</td></tr>
            <tr><th>Open tickets</th><td>${ops.openTickets}</td></tr>
            <tr><th>Notifications</th><td>${ops.totalNotifications}</td></tr>
            <tr><th>Shopify</th><td>${integ.shopifyConnected ? 'Connected' : 'Not connected'}</td></tr>
            <tr><th>WooCommerce</th><td>${integ.wooConnected ? 'Connected' : 'Not connected'}</td></tr>
          </tbody>
        </table>
        <p class="text-muted mb-0">Ledger entries and payouts are always retained for accounting.</p>
      </div>`;
  }

  async function promptReason() {
    const { value: reason, isConfirmed } = await Swal.fire({
      title: 'Deletion reason',
      input: 'textarea',
      inputLabel: 'Required (min. 10 characters)',
      inputPlaceholder: 'Describe why this business is being removed…',
      inputAttributes: { maxlength: 500 },
      showCancelButton: true,
      confirmButtonText: 'Confirm removal',
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      inputValidator: (v) => {
        if (!v || String(v).trim().length < 10) {
          return 'Please enter at least 10 characters.';
        }
        return null;
      },
    });
    if (!isConfirmed) return null;
    return String(reason).trim();
  }

  async function executeDelete(businessId, mode, reason) {
    const res = await fetch(`/admin/business/${businessId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ mode, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Removal failed');
      err.blockReasons = data.blockReasons;
      throw err;
    }
    return data;
  }

  async function openDeletionFlow(businessId, businessLabel, options) {
    options = options || {};
    const label = businessLabel || 'this business';

    Swal.fire({
      title: 'Loading impact report…',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    let impact;
    try {
      const res = await fetch(`/admin/business/${businessId}/deletion-impact`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load impact');
      }
      impact = data.impact;
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: e.message || 'Could not load deletion impact',
        confirmButtonColor: BRAND,
      });
      return;
    }

    const titleName = impact.business.brandName || impact.business.name || label;

    if (impact.hardBlock) {
      await Swal.fire({
        icon: 'error',
        title: `Cannot remove — ${titleName}`,
        html: buildImpactHtml(impact),
        confirmButtonColor: BRAND,
        width: 560,
      });
      return;
    }

    const choice = await Swal.fire({
      icon: 'warning',
      title: `Remove business — ${titleName}`,
      html: buildImpactHtml(impact),
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Soft delete (recommended)',
      denyButtonText: 'Full delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: BRAND,
      denyButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      width: 580,
      reverseButtons: true,
    });

    let mode = null;
    if (choice.isConfirmed) mode = 'soft';
    else if (choice.isDenied) mode = 'cascade';
    else return;

    if (mode === 'cascade') {
      const confirmCascade = await Swal.fire({
        icon: 'warning',
        title: 'Confirm full delete',
        html: `<p class="text-start small">This will permanently delete <strong>all orders, pickups, shop orders, tickets, and integrations</strong> for this business.</p>
          <p class="text-start small mb-0"><strong>Ledger entries and payouts will be kept</strong> for accounting.</p>`,
        showCancelButton: true,
        confirmButtonText: 'Yes, full delete',
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
      });
      if (!confirmCascade.isConfirmed) return;
    }

    const reason = await promptReason();
    if (!reason) return;

    Swal.fire({
      title: 'Removing business…',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const result = await executeDelete(businessId, mode, reason);
      await Swal.fire({
        icon: 'success',
        title: 'Business removed',
        text: result.message || 'Done',
        confirmButtonColor: BRAND,
      });
      if (typeof options.onSuccess === 'function') {
        options.onSuccess(result, mode);
      } else if (options.redirectAfter) {
        window.location.href = options.redirectAfter;
      }
    } catch (e) {
      let html = escapeHtml(e.message || 'Removal failed');
      if (e.blockReasons && e.blockReasons.length) {
        html += `<ul class="text-start small mt-2 mb-0">${e.blockReasons
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join('')}</ul>`;
      }
      Swal.fire({
        icon: 'error',
        title: 'Removal failed',
        html,
        confirmButtonColor: BRAND,
      });
    }
  }

  global.AdminBusinessDelete = {
    openDeletionFlow,
    formatEgp,
  };
})(typeof window !== 'undefined' ? window : this);
