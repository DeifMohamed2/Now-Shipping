/**
 * payouts.js — Admin Payouts Management page
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  let currentPage = 1;
  let debounceTimer;
  let spSearchTimer;
  let allPayouts = [];   // full page cache for stat computation

  // ── DOM refs ───────────────────────────────────────────────
  const tbody          = document.getElementById('payoutsTbody');
  const infoEl         = document.getElementById('payoutsInfo');
  const pagination     = document.getElementById('payoutsPagination');
  const statusFilter   = document.getElementById('statusFilter');
  const searchInput    = document.getElementById('searchInput');

  const statScheduledAmount = document.getElementById('statScheduledAmount');
  const statScheduledCount  = document.getElementById('statScheduledCount');
  const statPaidAmount      = document.getElementById('statPaidAmount');
  const statPaidCount       = document.getElementById('statPaidCount');
  const statBusinessCount   = document.getElementById('statBusinessCount');

  // ── Filter events ──────────────────────────────────────────
  statusFilter.addEventListener('change', () => { currentPage = 1; loadPayouts(); });
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadPayouts(); }, 350);
  });

  // ── Load payouts ───────────────────────────────────────────
  async function loadPayouts() {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><span class="py-spin"><i class="ri-loader-4-line"></i></span> Loading…</td></tr>`;

    const params = new URLSearchParams({ page: currentPage, limit: 50 });
    const status = statusFilter.value;
    if (status !== 'all') params.set('status', status);

    try {
      const res = await fetch(`/admin/api/payouts?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      allPayouts = data.payouts;
      renderTable(data.payouts, searchInput.value.trim().toLowerCase());
      renderPagination(data.total, data.pages);
      loadStats();

      const from = (currentPage - 1) * 50 + 1;
      const to   = Math.min(currentPage * 50, data.total);
      infoEl.textContent = data.total === 0 ? 'No payouts found' : `Showing ${from}–${to} of ${data.total}`;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Failed to load payouts</td></tr>`;
      console.error(err);
    }
  }

  // ── Stats section (separate calls for accuracy) ────────────
  async function loadStats() {
    try {
      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
      const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23,59,59,999);

      const [schRes, paidRes] = await Promise.all([
        fetch(`/admin/api/payouts?status=scheduled&limit=1000`),
        fetch(`/admin/api/payouts?status=paid&limit=1000`),
      ]);
      const schData  = await schRes.json();
      const paidData = await paidRes.json();

      if (schData.success) {
        const total = schData.payouts.reduce((s, p) => s + p.amount, 0);
        statScheduledAmount.textContent = fmt(total) + ' EGP';
        statScheduledCount.textContent  = schData.total;
      }
      if (paidData.success) {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthPaid  = paidData.payouts.filter(p => new Date(p.paidDate) >= monthStart);
        const total      = monthPaid.reduce((s, p) => s + p.amount, 0);
        statPaidAmount.textContent = fmt(total) + ' EGP';
        statPaidCount.textContent  = monthPaid.length;
      }

      // Active businesses = distinct businesses across all scheduled payouts
      if (schData.success) {
        const ids = new Set(schData.payouts.map(p => p.business?._id));
        statBusinessCount.textContent = ids.size;
      }
    } catch (e) { console.error('stats error', e); }
  }

  // ── Render table ───────────────────────────────────────────
  function renderTable(payouts, search) {
    const filtered = search
      ? payouts.filter(p => (p.business?.name || '').toLowerCase().includes(search) ||
                            (p.business?.email || '').toLowerCase().includes(search))
      : payouts;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-5 text-muted"><i class="ri-inbox-line fs-1 d-block mb-2"></i>No payouts found</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(p => {
      const badge  = badgeHtml(p.status);
      const biz    = p.business || {};
      const pm     = paymentMethodLabel(biz.paymentMethod);
      const sched  = p.scheduledDate ? fmtDate(p.scheduledDate) : '—';
      const paid   = p.paidDate ? fmtDate(p.paidDate) : '—';
      const canPay = p.status === 'scheduled' || p.status === 'processing';

      return `<tr>
        <td>
          <div class="fw-medium">${escHtml(biz.name || '—')}</div>
          <small class="text-muted">${escHtml(biz.email || '')}</small>
        </td>
        <td><small>${escHtml(pm)}</small></td>
        <td class="text-end fw-semibold">${fmt(p.amount)} EGP</td>
        <td class="text-center">${badge}</td>
        <td class="text-muted fs-13">${sched}</td>
        <td class="text-muted fs-13">${paid}</td>
        <td class="text-center py-actions">
          <button type="button" class="btn btn-outline-dark btn-sm" title="Payout breakdown & Excel export" onclick="openPayoutDetail('${p._id}')">
            <i class="ri-receipt-line"></i><span>Details</span>
          </button>
          ${canPay ? `<button type="button" class="btn btn-success btn-sm" title="Confirm bank transfer completed" onclick="openMarkPaid('${p._id}','${escHtml(biz.name || '')}',${p.amount})">
            <i class="ri-checkbox-circle-line"></i><span>Mark paid</span>
          </button>` : ''}
          <button type="button" class="btn btn-outline-primary btn-sm" title="Open full business ledger" onclick="viewLedger('${biz._id}','${escHtml(biz.name || '')}')">
            <i class="ri-file-list-3-line"></i><span>Ledger</span>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  // ── Payment method label ───────────────────────────────────
  function paymentMethodLabel(pm) {
    if (!pm || !pm.paymentChoice) return '—';
    const d = pm.details || {};
    if (pm.paymentChoice === 'instaPay')       return `InstaPay: ${d.IPAorPhoneNumber || ''}`;
    if (pm.paymentChoice === 'mobileWallet')   return `Wallet: ${d.mobileWalletNumber || ''}`;
    if (pm.paymentChoice === 'bankTransfer')   return `Bank: ${d.bankName || ''} — ${d.accountNumber || ''}`;
    return pm.paymentChoice;
  }

  // ── Status badge (no Bootstrap .badge — it forces white text via --bs-badge-color) ──
  function badgeHtml(status) {
    const map = {
      scheduled:  'py-badge-scheduled',
      processing: 'py-badge-processing',
      paid:       'py-badge-paid',
      failed:     'py-badge-failed',
    };
    const cls = map[status] || 'py-badge-scheduled';
    return `<span class="${cls}">${escHtml(status)}</span>`;
  }

  // ── Mark Paid modal ────────────────────────────────────────
  window.openMarkPaid = function (id, name, amount) {
    document.getElementById('mpPayoutId').value  = id;
    document.getElementById('mpBusinessName').value = name;
    document.getElementById('mpAmount').value    = fmt(amount) + ' EGP';
    document.getElementById('mpNote').value      = '';
    new bootstrap.Modal(document.getElementById('markPaidModal')).show();
  };

  document.getElementById('confirmMarkPaid').addEventListener('click', async () => {
    const id   = document.getElementById('mpPayoutId').value;
    const note = document.getElementById('mpNote').value;
    try {
      const res = await fetch(`/admin/api/payouts/${id}/paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      bootstrap.Modal.getInstance(document.getElementById('markPaidModal')).hide();
      Swal.fire({ icon: 'success', title: 'Payout marked as paid!', timer: 1800, showConfirmButton: false });
      loadPayouts();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
  });

  // ── Adjustment modal ───────────────────────────────────────
  window.openAdjustmentModal = function () {
    document.getElementById('adjBusinessId').value = '';
    document.getElementById('adjAmount').value     = '';
    document.getElementById('adjNote').value       = '';
    new bootstrap.Modal(document.getElementById('adjustmentModal')).show();
  };

  document.getElementById('confirmAdjustment').addEventListener('click', async () => {
    const businessId = document.getElementById('adjBusinessId').value.trim();
    const amount     = parseFloat(document.getElementById('adjAmount').value);
    const note       = document.getElementById('adjNote').value.trim();

    if (!businessId || isNaN(amount) || !note) {
      Swal.fire({ icon: 'warning', title: 'All fields required', text: 'Please fill in business ID, amount, and note.' });
      return;
    }

    try {
      const res = await fetch('/admin/api/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, amount, note }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      bootstrap.Modal.getInstance(document.getElementById('adjustmentModal')).hide();
      Swal.fire({ icon: 'success', title: 'Adjustment saved!', timer: 1800, showConfirmButton: false });
      loadPayouts();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
  });

  // ── View business ledger (opens proper ledger page) ────────
  window.viewLedger = function (bizId, name) {
    window.open(`/admin/business/${bizId}/ledger`, '_blank');
  };

  // ── Trigger manual payout processing (all businesses) ─────
  window.triggerPayoutProcessing = async function () {
    const conf = await Swal.fire({
      title: 'Run All Payouts Now?',
      text: 'Creates payouts for all businesses with a positive unsettled balance. Businesses already paid this week are automatically skipped.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Run',
      confirmButtonColor: '#f7b84b',
    });
    if (!conf.isConfirmed) return;
    await _runPayout({});
  };

  // ── Single-business payout modal (search by name / email / code) ──
  const spSearch         = document.getElementById('spSearch');
  const spSearchResults    = document.getElementById('spSearchResults');
  const spSelectedBusinessId = document.getElementById('spSelectedBusinessId');
  const spSelectedCard     = document.getElementById('spSelectedCard');
  const spSelBrand         = document.getElementById('spSelBrand');
  const spSelNameEmail     = document.getElementById('spSelNameEmail');
  const spSelCode          = document.getElementById('spSelCode');

  function clearSinglePayoutSelection() {
    spSelectedBusinessId.value = '';
    spSelectedCard.classList.add('d-none');
    spSearchResults.classList.add('d-none');
    spSearchResults.innerHTML = '';
  }

  window.openSingleBusinessPayoutModal = function () {
    spSearch.value = '';
    document.getElementById('spNote').value = '';
    clearSinglePayoutSelection();
    new bootstrap.Modal(document.getElementById('singlePayoutModal')).show();
    setTimeout(() => spSearch.focus(), 400);
  };

  async function runBusinessSearch(q) {
    if (!q || q.length < 2) {
      spSearchResults.classList.add('d-none');
      spSearchResults.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/admin/api/businesses/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const list = data.businesses || [];
      if (!list.length) {
        spSearchResults.innerHTML = `<div class="py-search-item text-muted small">No businesses found</div>`;
        spSearchResults.classList.remove('d-none');
        return;
      }
      spSearchResults.innerHTML = list.map((b) => {
        const id = String(b._id);
        const title = escHtml(b.brandName || b.name || '—');
        const sub = escHtml([b.name, b.email].filter(Boolean).join(' · '));
        const code = escHtml(b.businessAccountCode || '—');
        return `<button type="button" class="py-search-item w-100 text-start border-0 bg-transparent" data-id="${id}">
          <div class="fw-semibold">${title}</div>
          <div class="small text-muted">${sub}</div>
          <div class="mt-1"><span class="py-code-badge">${code}</span></div>
        </button>`;
      }).join('');
      spSearchResults.querySelectorAll('.py-search-item[data-id]').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          spSelectedBusinessId.value = btn.getAttribute('data-id') || '';
          spSelBrand.textContent = btn.querySelector('.fw-semibold')?.textContent || '—';
          spSelNameEmail.textContent = btn.querySelector('.small')?.textContent || '';
          spSelCode.textContent = btn.querySelector('.py-code-badge')?.textContent || '—';
          spSelectedCard.classList.remove('d-none');
          spSearchResults.classList.add('d-none');
          spSearchResults.innerHTML = '';
        });
      });
      spSearchResults.classList.remove('d-none');
    } catch (e) {
      console.error(e);
      spSearchResults.innerHTML = `<div class="py-search-item text-danger small">Search failed</div>`;
      spSearchResults.classList.remove('d-none');
    }
  }

  spSearch.addEventListener('input', () => {
    clearTimeout(spSearchTimer);
    spSearchTimer = setTimeout(() => {
      spSelectedBusinessId.value = '';
      spSelectedCard.classList.add('d-none');
      runBusinessSearch(spSearch.value.trim());
    }, 280);
  });

  spSearch.addEventListener('blur', () => {
    setTimeout(() => { spSearchResults.classList.add('d-none'); }, 200);
  });

  spSearch.addEventListener('focus', () => {
    if (spSearch.value.trim().length >= 2 && spSearchResults.innerHTML) {
      spSearchResults.classList.remove('d-none');
    }
  });

  document.getElementById('confirmSinglePayout').addEventListener('click', async () => {
    const businessId = spSelectedBusinessId.value.trim();
    if (!businessId || !/^[a-f0-9]{24}$/i.test(businessId)) {
      Swal.fire({ icon: 'warning', title: 'Select a business', text: 'Search and pick one business from the list.' });
      return;
    }
    bootstrap.Modal.getInstance(document.getElementById('singlePayoutModal')).hide();
    await _runPayout({ businessId });
  });

  // ── Shared payout POST helper ──────────────────────────────
  async function _runPayout({ businessId = null } = {}) {
    try {
      const res = await fetch('/admin/api/run-payout-processing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();

      if (data.skipped) {
        Swal.fire({ icon: 'info', title: 'Already Running', text: data.message, timer: 3000, showConfirmButton: false });
        return;
      }
      if (!data.success) throw new Error(data.error || data.message);

      const icon = data.errors?.length ? 'warning' : 'success';
      const skippedNote = data.businessesSkipped ? ` ${data.businessesSkipped} already paid this week.` : '';
      Swal.fire({
        icon,
        title: 'Done!',
        text: data.message + skippedNote,
        timer: data.errors?.length ? undefined : 2500,
        showConfirmButton: !!data.errors?.length,
      });
      loadPayouts();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
  }

  // ── Pagination ─────────────────────────────────────────────
  function renderPagination(total, pages) {
    if (pages <= 1) { pagination.innerHTML = ''; return; }
    let html = `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage - 1}">«</a></li>`;
    for (let i = 1; i <= pages; i++) {
      html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    html += `<li class="page-item ${currentPage === pages ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage + 1}">»</a></li>`;
    pagination.innerHTML = html;
    pagination.querySelectorAll('a[data-page]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const p = parseInt(a.dataset.page);
        if (p >= 1 && p <= pages && p !== currentPage) { currentPage = p; loadPayouts(); }
      });
    });
  }

  // ── Utilities ──────────────────────────────────────────────
  function fmt(n) { return Number(n).toLocaleString('en-EG', { minimumFractionDigits: 0 }); }
  function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Payout Detail Modal ────────────────────────────────────
  const pdModal     = new bootstrap.Modal(document.getElementById('payoutDetailModal'));
  const pdModalBody = document.getElementById('pdModalBody');
  const pdExportBtn = document.getElementById('pdExportBtn');
  const pdMarkPaidBtn = document.getElementById('pdMarkPaidBtn');
  let pdCurrentPayoutId = null;

  const TYPE_LABELS = {
    cod_collected:             'COD Collected',
    cash_difference_collected: 'Cash Difference',
    delivery_fee:              'Delivery Fee',
    return_fee:                'Return Fee',
    pickup_fee:                'Pickup Fee',
    payout:        'Payout',
    adjustment:    'Adjustment',
  };

  function pmLabel(pm) {
    if (!pm || !pm.paymentChoice) return '—';
    const d = pm.details || {};
    if (pm.paymentChoice === 'instaPay')     return `InstaPay — ${d.IPAorPhoneNumber || ''}`;
    if (pm.paymentChoice === 'mobileWallet') return `Mobile Wallet — ${d.mobileWalletNumber || ''}`;
    if (pm.paymentChoice === 'bankTransfer') {
      const parts = [d.bankName, d.IBAN || d.accountNumber, d.accountName].filter(Boolean);
      return `Bank Transfer — ${parts.join(' · ')}`;
    }
    return pm.paymentChoice;
  }

  window.openPayoutDetail = async function (payoutId) {
    pdCurrentPayoutId = payoutId;
    pdExportBtn.href = `/admin/api/payouts/${payoutId}/export`;
    pdMarkPaidBtn.classList.add('d-none');
    pdModalBody.innerHTML = '<div class="text-center py-5 text-muted"><i class="ri-loader-4-line me-1"></i> Loading…</div>';
    pdModal.show();

    try {
      const res = await fetch(`/admin/api/payouts/${payoutId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');

      const p   = data.payout;
      const biz = p.business || {};
      const entries = data.entries || [];

      const canPay = p.status === 'scheduled' || p.status === 'processing';
      if (canPay) {
        pdMarkPaidBtn.classList.remove('d-none');
        pdMarkPaidBtn.onclick = () => {
          pdModal.hide();
          setTimeout(() => openMarkPaid(p._id, biz.brandInfo?.brandName || biz.name || '—', p.amount), 300);
        };
      }

      // income / expenses breakdown
      let income = 0, expenses = 0;
      entries.forEach(e => { if (e.amount > 0) income += e.amount; else expenses += Math.abs(e.amount); });
      const net = income - expenses;

      const statusBadge = { scheduled: 'py-badge-scheduled', processing: 'py-badge-processing', paid: 'py-badge-paid', failed: 'py-badge-failed' };

      pdModalBody.innerHTML = `
        <!-- Hero -->
        <div class="pd-hero">
          <div class="d-flex align-items-center gap-3 mb-1 flex-wrap">
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="fw-bold fs-5">${escHtml(biz.brandInfo?.brandName || biz.name || '—')}</span>
                ${biz.businessAccountCode ? `<span class="pd-code"><i class="ri-shield-keyhole-line me-1 opacity-75"></i>${escHtml(biz.businessAccountCode)}</span>` : ''}
              </div>
              <div class="opacity-75 small">${escHtml(biz.email || '')}</div>
            </div>
            <span class="${statusBadge[p.status] || 'py-badge-scheduled'}">${escHtml(p.status)}</span>
          </div>
        </div>

        <!-- Stats row -->
        <div class="row g-2 mb-3">
          <div class="col-6 col-sm-3">
            <div class="pd-stat">
              <div class="pd-stat-value text-warning">${fmt(p.amount)} EGP</div>
              <div class="pd-stat-label">Payout Amount</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="pd-stat">
              <div class="pd-stat-value text-success">+${fmt(income)} EGP</div>
              <div class="pd-stat-label">Income</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="pd-stat">
              <div class="pd-stat-value text-danger">−${fmt(expenses)} EGP</div>
              <div class="pd-stat-label">Fees & Deductions</div>
            </div>
          </div>
          <div class="col-6 col-sm-3">
            <div class="pd-stat">
              <div class="pd-stat-value ${net >= 0 ? 'text-success' : 'text-danger'}">${net >= 0 ? '+' : ''}${fmt(net)} EGP</div>
              <div class="pd-stat-label">Net</div>
            </div>
          </div>
        </div>

        <!-- Payment method + dates -->
        <div class="row g-2 mb-3">
          <div class="col-md-7">
            <div class="pd-pm-block">
              <div class="fw-semibold mb-1 small text-muted">Payment Method</div>
              <div>${escHtml(pmLabel(p.paymentSnapshot || biz.paymentMethod))}</div>
            </div>
          </div>
          <div class="col-md-5">
            <div class="pd-pm-block h-100">
              <div class="d-flex justify-content-between small mb-1">
                <span class="text-muted">Scheduled</span>
                <span class="fw-semibold">${p.scheduledDate ? new Date(p.scheduledDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span>
              </div>
              <div class="d-flex justify-content-between small mb-1">
                <span class="text-muted">Paid on</span>
                <span class="fw-semibold">${p.paidDate ? new Date(p.paidDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span>
              </div>
              <div class="d-flex justify-content-between small">
                <span class="text-muted">Entries</span>
                <span class="fw-semibold">${entries.length}</span>
              </div>
            </div>
          </div>
        </div>

        ${p.adminNote ? `<div class="alert alert-info py-2 px-3 mb-3 small"><i class="ri-sticky-note-line me-1"></i><strong>Admin note:</strong> ${escHtml(p.adminNote)}</div>` : ''}

        <!-- Entries table -->
        <div class="fw-semibold mb-2 fs-14">Ledger Entries (${entries.length})</div>
        <div style="max-height:340px;overflow-y:auto;">
          <table class="table table-nowrap align-middle mb-0 pd-entries-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Reference</th>
                <th class="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${entries.length === 0
                ? `<tr><td colspan="5" class="text-center text-muted py-3">No entries</td></tr>`
                : entries.map(e => {
                    const typeKey = e.type || 'default';
                    const typeLabel = TYPE_LABELS[typeKey] || typeKey;
                    const ref = [
                      e.orderNumber ? `<span class="badge bg-soft-primary text-primary">${escHtml(e.orderNumber)}</span>` : '',
                      e.pickupNumber ? `<span class="badge bg-soft-info text-info">${escHtml(e.pickupNumber)}</span>` : '',
                    ].filter(Boolean).join(' ') || '—';
                    return `<tr>
                      <td class="small text-muted">${e.createdAt ? new Date(e.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
                      <td><span class="pd-type-pill pd-type-${escHtml(typeKey)}">${escHtml(typeLabel)}</span></td>
                      <td class="small">${escHtml(e.description || '—')}</td>
                      <td>${ref}</td>
                      <td class="text-end ${e.amount >= 0 ? 'pd-amount-pos' : 'pd-amount-neg'}">${e.amount >= 0 ? '+' : ''}${fmt(e.amount)} EGP</td>
                    </tr>`;
                  }).join('')
              }
              <tr class="pd-net-row">
                <td colspan="4" class="text-end">NET TOTAL</td>
                <td class="text-end ${net >= 0 ? 'pd-amount-pos' : 'pd-amount-neg'}">${net >= 0 ? '+' : ''}${fmt(net)} EGP</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      pdModalBody.innerHTML = `<div class="text-center text-danger py-4"><i class="ri-error-warning-line me-1"></i>${escHtml(err.message)}</div>`;
    }
  };

  // ── Initial load ───────────────────────────────────────────
  loadPayouts();

  // expose for inline onclick
  window.loadPayouts = loadPayouts;
})();
