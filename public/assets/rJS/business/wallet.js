/**
 * wallet.js — Business Wallet page
 */
(function () {
  'use strict';

  const I = typeof window !== 'undefined' && window.__NS_BUSINESS_I18N ? window.__NS_BUSINESS_I18N : {};
  const W = I.wallet || {};
  const TYPES = W.types || {};

  // ── State ──────────────────────────────────────────────────
  let currentPage = 1;
  let currentFilters = { period: 'month', type: 'all', settled: 'all', search: '' };
  let debounceTimer;

  // ── DOM refs ───────────────────────────────────────────────
  const tbody        = document.getElementById('ledgerTbody');
  const infoEl       = document.getElementById('ledgerInfo');
  const pagination   = document.getElementById('ledgerPagination');
  const searchInput  = document.getElementById('searchInput');
  const typeFilter   = document.getElementById('typeFilter');
  const settledFilter= document.getElementById('settledFilter');
  const heroBalance  = document.getElementById('heroBalance');

  const statCod   = document.getElementById('statTotalCod');
  const statFees  = document.getElementById('statTotalFees');
  const statPaid  = document.getElementById('statTotalPaid');

  // ── Period buttons ─────────────────────────────────────────
  document.querySelectorAll('#periodGroup button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#periodGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilters.period = btn.dataset.period;
      currentPage = 1;
      load();
    });
  });

  // ── Filter change events ───────────────────────────────────
  typeFilter.addEventListener('change', () => {
    currentFilters.type = typeFilter.value;
    currentPage = 1;
    load();
  });

  settledFilter.addEventListener('change', () => {
    currentFilters.settled = settledFilter.value;
    currentPage = 1;
    load();
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentFilters.search = searchInput.value.trim();
      currentPage = 1;
      load();
    }, 350);
  });

  // ── Build date range from period ───────────────────────────
  function periodToDates(period) {
    const now = new Date();
    let startDate = null, endDate = null;

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
      endDate   = startDate;
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      endDate   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    } else if (period === 'year') {
      startDate = `${now.getFullYear()}-01-01`;
      endDate   = `${now.getFullYear()}-12-31`;
    }
    return { startDate, endDate };
  }

  // ── Type display helpers ───────────────────────────────────
  const TYPE_LABELS = {
    cod_collected: TYPES.cod_collected || 'COD Collected',
    delivery_fee: TYPES.delivery_fee || 'Delivery Fee',
    pickup_fee: TYPES.pickup_fee || 'Pickup Fee',
    adjustment: TYPES.adjustment || 'Adjustment',
    payout: TYPES.payout || 'Payout',
  };

  function typeIconClass(type) {
    if (type === 'cod_collected' || (type === 'adjustment')) return 'credit';
    if (type === 'payout') return 'payout';
    return 'debit';
  }

  function typeIcon(type, amount) {
    const cls = amount >= 0 ? 'credit' : (type === 'payout' ? 'payout' : 'debit');
    const icon = amount >= 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line';
    if (type === 'payout') return `<div class="wl-type-icon payout"><i class="ri-bank-line"></i></div>`;
    return `<div class="wl-type-icon ${cls}"><i class="${icon}"></i></div>`;
  }

  // ── Format ─────────────────────────────────────────────────
  function fmt(n) {
    const loc = document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-EG';
    return Number(n).toLocaleString(loc, { minimumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    const loc = document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-GB';
    return new Date(iso).toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Load entries ───────────────────────────────────────────
  async function load() {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><span class="wl-spin"><i class="ri-loader-4-line"></i></span> ${W.loadingRow || (I.common && I.common.loading) || 'Loading…'}</td></tr>`;

    const { startDate, endDate } = periodToDates(currentFilters.period);
    const params = new URLSearchParams({ page: currentPage, limit: 50 });

    if (currentFilters.type !== 'all') params.set('type', currentFilters.type);
    if (currentFilters.settled !== 'all') params.set('settled', currentFilters.settled);
    if (currentFilters.search) params.set('search', currentFilters.search);
    if (startDate) params.set('startDate', startDate);
    if (endDate)   params.set('endDate', endDate);

    try {
      const res = await fetch(`/business/wallet/entries?${params.toString()}`);
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      renderTable(data.entries);
      renderPagination(data.total, data.pages);
      updateHeroBalance(data.balance);
      computeStats(data.entries);

      const from = (currentPage - 1) * 50 + 1;
      const to   = Math.min(currentPage * 50, data.total);
      const rangeTpl = W.showingRange || 'Showing {from}–{to} of {total}';
      infoEl.textContent =
        data.total === 0
          ? (W.noTransactionsFound || 'No transactions found')
          : rangeTpl.replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(data.total));
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${W.failedLoad || 'Failed to load transactions'}</td></tr>`;
      console.error(err);
    }
  }

  // ── Render table ───────────────────────────────────────────
  function renderTable(entries) {
    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-5 text-muted"><i class="ri-inbox-line fs-1 d-block mb-2"></i>${W.noTransactionsYet || 'No transactions yet'}</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(e => {
      const isCredit = e.amount >= 0;
      const amtClass = isCredit ? 'wl-amount-credit' : 'wl-amount-debit';
      const amtStr   = (isCredit ? '+' : '') + fmt(e.amount) + ' EGP';
      // payoutId is populated → has .status; if null entry is still pending
      const payoutStatus = e.payoutId?.status || null;
      let statusPill;
      if (!payoutStatus) {
        statusPill = `<span class="wl-status-pill wl-status-pill-unsettled">${W.pending || 'Pending'}</span>`;
      } else if (payoutStatus === 'paid') {
        statusPill = `<span class="wl-status-pill wl-status-pill-settled">${W.paid || 'Paid'}</span>`;
      } else {
        // scheduled or processing — in payout batch but money not sent yet
        statusPill = `<span class="wl-status-pill wl-status-pill-inpayout">${W.inPayout || 'In Payout'}</span>`;
      }
      const settled = statusPill;

      return `<tr>
        <td class="text-muted fs-13">${fmtDate(e.createdAt)}</td>
        <td>
          <div class="d-flex align-items-center gap-2">
            ${typeIcon(e.type, e.amount)}
            <div>
              <div class="fw-medium fs-13">${escHtml(e.description)}</div>
              ${e.orderNumber ? `<small class="text-muted">${escHtml(e.orderNumber)}</small>` : ''}
            </div>
          </div>
        </td>
        <td><span class="badge bg-light text-dark fw-normal">${TYPE_LABELS[e.type] || e.type}</span></td>
        <td class="text-end ${amtClass} fw-semibold">${amtStr}</td>
        <td class="text-center">${settled}</td>
      </tr>`;
    }).join('');
  }

  // ── Pagination ─────────────────────────────────────────────
  function renderPagination(total, pages) {
    if (pages <= 1) { pagination.innerHTML = ''; return; }
    const max = 5;
    let start = Math.max(1, currentPage - 2);
    let end   = Math.min(pages, start + max - 1);
    if (end - start < max - 1) start = Math.max(1, end - max + 1);

    let html = `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage - 1}">«</a></li>`;
    for (let i = start; i <= end; i++) {
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
        if (p >= 1 && p <= pages && p !== currentPage) {
          currentPage = p;
          load();
        }
      });
    });
  }

  // ── Update hero balance ────────────────────────────────────
  function updateHeroBalance(bal) {
    heroBalance.innerHTML = `${fmt(bal)} <span class="fs-5 fw-normal opacity-75">EGP</span>`;
  }

  // ── Stat cards ─────────────────────────────────────────────
  function computeStats(entries) {
    let cod = 0, fees = 0, paid = 0;
    entries.forEach(e => {
      if (e.type === 'cod_collected') cod  += e.amount;
      if (e.type === 'delivery_fee' || e.type === 'pickup_fee') fees += Math.abs(e.amount);
      if (e.type === 'payout') paid += Math.abs(e.amount);
    });
    statCod.textContent  = `${fmt(cod)} EGP`;
    statFees.textContent = `${fmt(fees)} EGP`;
    statPaid.textContent = `${fmt(paid)} EGP`;
  }

  // ── Escape html ────────────────────────────────────────────
  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Initial load ───────────────────────────────────────────
  load();
})();
