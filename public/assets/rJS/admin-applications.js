(function () {
  'use strict';

  const PRODUCT_LABELS = {
    fashion: { en: 'Fashion', ar: 'أزياء وملابس' },
    electronics: { en: 'Electronics', ar: 'إلكترونيات' },
    beauty: { en: 'Beauty', ar: 'تجميل وعناية' },
    food: { en: 'Food', ar: 'أغذية ومشروبات' },
    home: { en: 'Home', ar: 'منزل وديكور' },
    other: { en: 'Other', ar: 'أخرى' },
  };

  const ORDERS_LABELS = {
    '1-50': { en: '1–50 orders/month', ar: '1–50 طلب/شهر' },
    '51-200': { en: '51–200 orders/month', ar: '51–200 طلب/شهر' },
    '201-500': { en: '201–500 orders/month', ar: '201–500 طلب/شهر' },
    '501-1000': { en: '501–1,000 orders/month', ar: '501–1,000 طلب/شهر' },
    '1000+': { en: '1,000+ orders/month', ar: 'أكثر من 1,000 طلب/شهر' },
  };

  const STATUS_LABELS = {
    new: { en: 'New', ar: 'جديد' },
    contacted: { en: 'Contacted', ar: 'تم التواصل' },
    qualified: { en: 'Qualified', ar: 'مؤهل' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    converted: { en: 'Converted', ar: 'تم التحويل' },
  };

  let applications = [];
  let selectedId = null;
  let currentPage = 1;
  let totalPages = 1;
  let searchDebounceTimer = null;

  function getLang() {
    const lang = (document.documentElement.lang || 'en').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }

  function label(map, key) {
    const entry = map[key];
    if (!entry) return key || '—';
    const lang = getLang();
    return entry[lang] || entry.en || key;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat(getLang() === 'ar' ? 'ar-EG' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch (_e) {
      return value;
    }
  }

  function whatsappHref(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    const intl = digits.startsWith('0') ? '2' + digits : digits;
    return 'https://wa.me/' + intl;
  }

  function telHref(phone) {
    return 'tel:' + String(phone || '').replace(/\s/g, '');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function updateStats(stats) {
    if (!stats) return;
    $('statTotal').textContent = stats.total || 0;
    $('statNew').textContent = stats.new || 0;
    $('statContacted').textContent = stats.contacted || 0;
    $('statQualified').textContent = stats.qualified || 0;
    $('statConverted').textContent = stats.converted || 0;
  }

  function renderList(items) {
    const listEl = $('appList');
    $('appCount').textContent = String(items.length);

    if (!items.length) {
      listEl.innerHTML =
        '<div class="app-list-empty"><i class="ri-inbox-line display-6 d-block mb-2"></i>No applications found</div>';
      return;
    }

    listEl.innerHTML = items
      .map(function (app) {
        const active = app._id === selectedId ? ' is-active' : '';
        return (
          '<article class="app-card' +
          active +
          '" data-id="' +
          app._id +
          '" tabindex="0" role="button">' +
          '<div class="app-card__store">' +
          escapeHtml(app.storeName) +
          '</div>' +
          '<div class="app-card__meta">' +
          escapeHtml(app.fullName) +
          ' · ' +
          escapeHtml(app.phone) +
          '</div>' +
          '<div class="app-card__row">' +
          '<span class="app-badge app-badge--product">' +
          escapeHtml(label(PRODUCT_LABELS, app.productType)) +
          '</span>' +
          '<span class="app-badge">' +
          escapeHtml(label(ORDERS_LABELS, app.monthlyOrders)) +
          '</span>' +
          '<span class="app-status app-status--' +
          escapeHtml(app.status) +
          '">' +
          escapeHtml(label(STATUS_LABELS, app.status)) +
          '</span>' +
          '<span class="app-badge">' +
          escapeHtml(formatDate(app.createdAt)) +
          '</span>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');

    listEl.querySelectorAll('.app-card').forEach(function (card) {
      card.addEventListener('click', function () {
        selectApplication(card.getAttribute('data-id'));
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectApplication(card.getAttribute('data-id'));
        }
      });
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showDetail(app) {
    $('emptyState').classList.add('d-none');
    const detail = $('detailContainer');
    detail.classList.remove('d-none');
    detail.classList.add('d-flex');

    $('detailStoreName').textContent = app.storeName || '—';
    $('detailMeta').textContent =
      (label(STATUS_LABELS, app.status) || '') +
      ' · ' +
      formatDate(app.createdAt);

    $('detailFullName').textContent = app.fullName || '—';
    $('detailPhone').textContent = app.phone || '—';
    $('detailProductType').textContent = label(PRODUCT_LABELS, app.productType);
    $('detailMonthlyOrders').textContent = label(ORDERS_LABELS, app.monthlyOrders);
    $('detailSubmitted').textContent = formatDate(app.createdAt);
    $('detailSource').textContent = app.source || 'landing';
    $('detailStatus').value = app.status || 'new';
    $('detailNotes').value = app.adminNotes || '';

    $('whatsappBtn').href = whatsappHref(app.phone);
    $('telBtn').href = telHref(app.phone);

    if (app.reviewedAt) {
      const reviewer = app.reviewedBy && app.reviewedBy.name ? app.reviewedBy.name : 'Admin';
      $('reviewInfo').textContent =
        'Last reviewed by ' + reviewer + ' · ' + formatDate(app.reviewedAt);
    } else {
      $('reviewInfo').textContent = '';
    }
  }

  function hideDetail() {
    $('emptyState').classList.remove('d-none');
    const detail = $('detailContainer');
    detail.classList.add('d-none');
    detail.classList.remove('d-flex');
  }

  async function selectApplication(id) {
    if (!id) return;
    selectedId = id;
    renderList(applications);

    try {
      const res = await fetch('/admin/applications/' + encodeURIComponent(id), {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'load_failed');
      showDetail(data.application);
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Could not load application details.',
      });
    }
  }

  async function loadApplications() {
    const params = new URLSearchParams();
    params.set('page', String(currentPage));
    params.set('limit', '20');

    const search = $('searchInput').value.trim();
    const status = $('statusFilter').value;
    const productType = $('productFilter').value;

    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (productType) params.set('productType', productType);

    try {
      const res = await fetch('/admin/get-applications?' + params.toString(), {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'load_failed');

      applications = data.applications || [];
      updateStats(data.stats);
      renderList(applications);

      const pagination = data.pagination || {};
      currentPage = pagination.page || 1;
      totalPages = pagination.pages || 1;
      $('pageInfo').textContent = 'Page ' + currentPage + ' of ' + totalPages;
      $('prevPageBtn').disabled = currentPage <= 1;
      $('nextPageBtn').disabled = currentPage >= totalPages;

      if (selectedId && !applications.some(function (a) { return a._id === selectedId; })) {
        selectedId = null;
        hideDetail();
      } else if (selectedId) {
        renderList(applications);
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Could not load applications.',
      });
    }
  }

  async function saveApplication() {
    if (!selectedId) return;

    const saveBtn = $('saveBtn');
    const original = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="ri-loader-4-line ri-spin me-1"></i>Saving…';

    try {
      const res = await fetch('/admin/applications/' + encodeURIComponent(selectedId), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: $('detailStatus').value,
          adminNotes: $('detailNotes').value,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'save_failed');

      showDetail(data.application);
      await loadApplications();

      Swal.fire({
        icon: 'success',
        title: 'Saved',
        text: 'Application updated successfully.',
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Could not save changes.',
      });
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = original;
    }
  }

  function bindEvents() {
    $('refreshBtn').addEventListener('click', function () {
      loadApplications();
    });

    $('saveBtn').addEventListener('click', saveApplication);

    $('searchInput').addEventListener('input', function () {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        currentPage = 1;
        loadApplications();
      }, 350);
    });

    $('statusFilter').addEventListener('change', function () {
      currentPage = 1;
      loadApplications();
    });

    $('productFilter').addEventListener('change', function () {
      currentPage = 1;
      loadApplications();
    });

    $('prevPageBtn').addEventListener('click', function () {
      if (currentPage > 1) {
        currentPage -= 1;
        loadApplications();
      }
    });

    $('nextPageBtn').addEventListener('click', function () {
      if (currentPage < totalPages) {
        currentPage += 1;
        loadApplications();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    loadApplications();
  });
})();
