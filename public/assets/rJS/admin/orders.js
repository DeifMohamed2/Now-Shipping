/**
 * Admin orders list: filters, table render, pagination, modals.
 */
(function () {
  'use strict';

  const ORDERS_PER_PAGE_ADMIN = 30;
  let currentPageAdmin = 1;
  let paginationAdmin = { currentPage: 1, totalPages: 1, totalCount: 0 };
  let businessSearchTimer = null;

  function escHtml(s) {
    if (s == null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFlatpickrDateToISO(dateStr) {
    if (!dateStr) return '';
    const months = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
    const parts = dateStr.replace(',', '').split(' ').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 3) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return '';
    }
    const dayNum = parseInt(parts[0], 10);
    const monIdx = months[parts[1]];
    const yearNum = parseInt(parts[2], 10);
    if (isNaN(dayNum) || isNaN(monIdx) || isNaN(yearNum)) return '';
    const d = new Date(yearNum, monIdx, dayNum);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getAmountTypeLabel(amountType, orderType) {
    if (amountType === 'CD') return 'Cash Difference';
    if (amountType === 'NA') return 'N/A';
    if (amountType === 'COD') {
      return 'Cash on Delivery';
    }
    return amountType || 'N/A';
  }

  function getActiveOrderType() {
    const el = document.querySelector('.orderType.active');
    return el ? el.getAttribute('data-order-type') || 'All' : 'All';
  }

  function setActiveOrderTypeTab(orderType) {
    document.querySelectorAll('.orderType').forEach((btn) => {
      const t = btn.getAttribute('data-order-type');
      btn.classList.toggle('active', t === orderType);
      btn.setAttribute('aria-selected', t === orderType ? 'true' : 'false');
    });
  }

  function getAdminFilters() {
    const search =
      document.querySelector('.admin-orders-filters .search')?.value?.trim() || '';
    const status = document.getElementById('orderStatus')?.value || 'all';
    const statusCategory =
      document.getElementById('idStatusCategory')?.value || 'all';
    const payment = document.getElementById('idPayment')?.value || 'all';
    const businessId = document.getElementById('filterBusinessId')?.value || '';
    const dateInput = document.getElementById('demo-datepicker');
    let dateFrom = '';
    let dateTo = '';
    if (dateInput && dateInput.value) {
      if (dateInput.value.toLowerCase().includes('to')) {
        const [from, to] = dateInput.value.split(/to/i).map((s) => s.trim());
        dateFrom = parseFlatpickrDateToISO(from);
        dateTo = parseFlatpickrDateToISO(to);
      } else {
        const iso = parseFlatpickrDateToISO(dateInput.value.trim());
        dateFrom = iso;
        dateTo = iso;
      }
    }
    return {
      search,
      status,
      statusCategory,
      paymentType: payment,
      businessId,
      dateFrom,
      dateTo,
    };
  }

  async function loadBusinessFilterOptions(q) {
    const sel = document.getElementById('filterBusinessId');
    if (!sel) return;
    const current = sel.value;
    try {
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      const res = await fetch(`/admin/orders-filter-businesses?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.businesses) return;
      sel.innerHTML = '<option value="">All businesses</option>';
      data.businesses.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.label;
        sel.appendChild(opt);
      });
      if (current && [...sel.options].some((o) => o.value === current)) {
        sel.value = current;
      }
    } catch (e) {
      console.error('orders-filter-businesses', e);
    }
  }

  function getStatusDetails(status) {
    let badgeClass = '';
    let statusText = '';

    if (status === 'new') {
      badgeClass = 'bg-primary-subtle text-primary';
      statusText = 'New';
    } else if (status === 'pickedUp') {
      badgeClass = 'bg-secondary-subtle text-secondary';
      statusText = 'Picked Up';
    } else if (status === 'inStock') {
      badgeClass = 'bg-info-subtle text-info';
      statusText = 'In Stock';
    } else if (status === 'inProgress') {
      badgeClass = 'bg-warning-subtle text-warning';
      statusText = 'In Progress';
    } else if (status === 'headingToCustomer') {
      badgeClass = 'bg-success-subtle text-success';
      statusText = 'Heading To Customer';
    } else if (status === 'headingToYou') {
      badgeClass = 'bg-success-subtle text-success';
      statusText = 'Heading To Business';
    } else if (status === 'completed') {
      badgeClass = 'bg-success-subtle text-success';
      statusText = 'Completed';
    } else if (status === 'canceled') {
      badgeClass = 'bg-danger-subtle text-danger';
      statusText = 'Canceled';
    } else if (status === 'rejected') {
      badgeClass = 'bg-danger-subtle text-danger';
      statusText = 'Customer refused';
    } else if (status === 'returned') {
      badgeClass = 'bg-danger-subtle text-danger';
      statusText = 'Returned';
    } else if (status === 'terminated') {
      badgeClass = 'bg-danger-subtle text-danger';
      statusText = 'Terminated';
    } else if (status === 'waitingAction') {
      statusText = 'Waiting Action';
      badgeClass = 'bg-danger-subtle text-danger';
    } else if (status === 'inReturnStock') {
      statusText = 'In Return Stock';
      badgeClass = 'bg-warning-subtle text-warning';
    } else if (status === 'returnInitiated') {
      statusText = 'Return Initiated';
      badgeClass = 'bg-secondary-subtle text-secondary';
    } else if (status === 'exchangePickup') {
      statusText = 'Exchange Pickup (legacy)';
      badgeClass = 'bg-primary-subtle text-primary';
    } else if (status === 'returnLinked') {
      statusText = 'Return Linked';
      badgeClass = 'bg-secondary-subtle text-secondary';
    } else if (status === 'returnCompleted') {
      statusText = 'Return Completed';
      badgeClass = 'bg-success-subtle text-success';
    } else if (status === 'returnAssigned') {
      statusText = 'Return Assigned';
      badgeClass = 'bg-info-subtle text-info';
    } else if (status === 'returnPickedUp') {
      statusText = 'Return Picked Up';
      badgeClass = 'bg-warning-subtle text-warning';
    } else if (status === 'returnAtWarehouse') {
      statusText = 'At Warehouse';
      badgeClass = 'bg-secondary-subtle text-secondary';
    } else if (status === 'returnToBusiness') {
      statusText = 'Returning to Business';
      badgeClass = 'bg-primary-subtle text-primary';
    } else {
      statusText = status || 'Unknown';
      badgeClass = 'bg-light-subtle text-muted';
    }

    return { badgeClass, statusText };
  }

  /** Swap Import vs Cancel selected in header (same slot as Import). */
  function updateOrdersBulkToolbar() {
    const n = document.querySelectorAll(
      '#orderTable input[name="checkAll[]"]:checked'
    ).length;
    const importBtn = document.getElementById('orders-import-btn');
    const cancelBtn = document.getElementById('orders-bulk-cancel-btn');
    if (importBtn) {
      importBtn.style.display = n > 0 ? 'none' : '';
      importBtn.setAttribute('aria-hidden', n > 0 ? 'true' : 'false');
    }
    if (cancelBtn) {
      cancelBtn.style.display = n === 0 ? 'none' : '';
      cancelBtn.setAttribute('aria-hidden', n === 0 ? 'true' : 'false');
    }
  }

  /**
   * Mirrors AdminTableDropdowns.bindTableSelection when shared script is missing.
   */
  function bindOrdersTableSelectionFallback(tableEl, checkAllEl, onSelectionChange) {
    const table =
      typeof tableEl === 'string' ? document.querySelector(tableEl) : tableEl;
    const checkAll =
      typeof checkAllEl === 'string'
        ? document.querySelector(checkAllEl)
        : checkAllEl;
    if (!table || !checkAll) return;

    function rowBoxes() {
      return table.querySelectorAll("input[name='checkAll[]']");
    }

    function notifySelection() {
      if (typeof onSelectionChange === 'function') {
        try {
          onSelectionChange();
        } catch (err) {
          console.error('bindOrdersTableSelectionFallback callback', err);
        }
      }
    }

    function syncHeader() {
      const boxes = rowBoxes();
      let n = boxes.length;
      let checked = 0;
      boxes.forEach(function (cb) {
        if (cb.checked) checked++;
      });
      checkAll.checked = n > 0 && checked === n;
      checkAll.indeterminate = checked > 0 && checked < n;
      notifySelection();
    }

    checkAll.addEventListener('change', function () {
      rowBoxes().forEach(function (cb) {
        cb.checked = checkAll.checked;
      });
      syncHeader();
    });

    table.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'checkAll[]') syncHeader();
    });

    var mo = new MutationObserver(syncHeader);
    mo.observe(table, { childList: true, subtree: true });

    syncHeader();
  }

  function wireOrdersTableSelection() {
    const orderTable = document.getElementById('orderTable');
    const checkAll = document.getElementById('checkAll');
    if (!orderTable || !checkAll) return;
    if (
      window.AdminTableDropdowns &&
      typeof window.AdminTableDropdowns.bindTableSelection === 'function'
    ) {
      window.AdminTableDropdowns.bindTableSelection(
        orderTable,
        checkAll,
        updateOrdersBulkToolbar
      );
    } else {
      console.error(
        '[orders] AdminTableDropdowns.bindTableSelection missing; using fallback.'
      );
      bindOrdersTableSelectionFallback(
        orderTable,
        checkAll,
        updateOrdersBulkToolbar
      );
    }
  }

  async function fetchOrders(orderType, page) {
    const tableBody = document.getElementById('ordersTable');
    const NoResult = document.getElementById('NoResult');
    if (!tableBody) return;

    if (orderType === undefined || orderType === null) {
      orderType = getActiveOrderType();
    }
    if (page === undefined) page = currentPageAdmin;

    try {
      tableBody.innerHTML =
        '<tr><td colspan="11" class="text-center py-4">' +
        '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>' +
        '</td></tr>';

      const filters = getAdminFilters();
      const params = new URLSearchParams();
      params.append('limit', String(ORDERS_PER_PAGE_ADMIN));
      params.append('page', String(page));

      if (orderType && orderType !== 'All' && orderType !== 'all') {
        params.append('orderType', orderType);
      }
      if (filters.status && filters.status !== 'all') {
        params.append('status', filters.status);
      }
      if (filters.statusCategory && filters.statusCategory !== 'all') {
        params.append('statusCategory', filters.statusCategory);
      }
      if (filters.paymentType && filters.paymentType !== 'all') {
        params.append('paymentType', filters.paymentType);
      }
      if (filters.businessId) {
        params.append('businessId', filters.businessId);
      }
      if (filters.search) params.append('search', filters.search);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);

      const response = await fetch(`/admin/get-orders?${params.toString()}`);
      const data = await response.json();

      if (response.ok && data.orders) {
        paginationAdmin = data.pagination;
        currentPageAdmin = page;
        tableBody.innerHTML = '';
        NoResult.style.display = data.orders.length === 0 ? 'block' : 'none';
        if (data.orders.length) populateOrdersTable(data.orders);
        updateAdminPagination();
        updateOrdersBulkToolbar();
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: `Error fetching orders: ${data.message || data.error || 'Unknown error'}`,
        });
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  }

  function updateAdminPagination() {
    const prev = document.querySelector('.pagination-prev');
    const next = document.querySelector('.pagination-next');
    const ul = document.querySelector('.listjs-pagination');
    if (!ul) return;
    ul.innerHTML = '';
    const { currentPage, totalPages } = paginationAdmin;
    if (totalPages > 1 || totalPages === 0) {
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);
      if (currentPage <= 3) endPage = Math.min(totalPages, 5);
      if (currentPage + 2 > totalPages)
        startPage = Math.max(1, totalPages - 4);
      for (let p = startPage; p <= endPage; p++) {
        const li = document.createElement('li');
        li.className = `page-item${p === currentPage ? ' active' : ''}`;
        const a = document.createElement('a');
        a.className = 'page-link';
        a.textContent = p;
        a.href = 'javascript:void(0);';
        a.onclick = () => gotoAdminPage(p);
        li.appendChild(a);
        ul.appendChild(li);
      }
    }
    if (prev) {
      prev.classList.toggle('disabled', currentPage === 1);
      prev.onclick = () => gotoAdminPage(currentPage - 1);
    }
    if (next) {
      next.classList.toggle('disabled', currentPage === totalPages);
      next.onclick = () => gotoAdminPage(currentPage + 1);
    }
  }

  function gotoAdminPage(p) {
    if (p < 1 || p > paginationAdmin.totalPages) return;
    fetchOrders(getActiveOrderType(), p);
  }

  function populateOrdersTable(orders) {
    const tableBody = document.getElementById('ordersTable');
    tableBody.innerHTML = '';

    orders.forEach((order) => {
      const row = document.createElement('tr');
      row.classList.add('align-middle');

      if (order.orderStatus === 'new') {
        row.classList.add('admin-order-row--new');
      } else if (
        order.orderStatus === 'rejected' ||
        order.orderStatus === 'returned'
      ) {
        row.classList.add('admin-order-row--risk');
      } else if (
        order.orderStatus === 'inReturnStock' ||
        order.orderStatus === 'returnCompleted' ||
        (order.orderShipping && order.orderShipping.orderType === 'Return')
      ) {
        row.classList.add('admin-order-row--return');
      }

      const orderType = order.orderShipping
        ? order.orderShipping.orderType
        : 'N/A';
      const orderAmount = order.orderShipping ? order.orderShipping.amount || 0 : 0;
      const orderAmountType = order.orderShipping
        ? order.orderShipping.amountType
        : 'N/A';
      const zone = order.orderCustomer ? order.orderCustomer.zone || '' : '';
      const gov = order.orderCustomer ? order.orderCustomer.government || 'N/A' : 'N/A';
      const govEsc = escHtml(gov);
      const zoneEsc = escHtml(zone);
      const zoneLine = zone
        ? `${govEsc} <span class="text-muted">·</span> <span class="cell-muted">${zoneEsc}</span>`
        : govEsc;

      const shortDate = new Date(order.orderDate).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const st = getStatusDetails(order.orderStatus);
      const businessLabelRaw =
        order.business && order.business.brandInfo && order.business.brandInfo.brandName
          ? order.business.brandInfo.brandName
          : 'N/A';
      const businessLabel = escHtml(businessLabelRaw);

      const assignBlock = order.deliveryMan
        ? `<div class="cell-compact fw-semibold">${escHtml(order.deliveryMan.name)}</div>
           <div class="cell-muted">#${escHtml(String(order.deliveryMan.courierID))}</div>`
        : '<span class="text-muted">—</span>';

      const custName = order.orderCustomer && order.orderCustomer.fullName
        ? escHtml(order.orderCustomer.fullName)
        : 'N/A';
      const retReason =
        order.orderShipping &&
        order.orderShipping.returnReason &&
        order.orderShipping.orderType === 'Return'
          ? order.orderShipping.returnReason
          : '';
      const retReasonShort =
        retReason.length > 24 ? `${escHtml(retReason.substring(0, 24))}…` : escHtml(retReason);

      // Same rules for Deliver and Exchange: only "Assign" for fast orders still at business (new),
      // or after courier picked up from business (pickedUp). Do not show for every NEW Exchange.
      const showAssignDm =
        (order.orderShipping &&
          (order.orderShipping.orderType === 'Deliver' ||
            order.orderShipping.orderType === 'Exchange') &&
          order.isFastShipping &&
          order.readyForCourierAssignment) ||
        order.orderStatus === 'pickedUp';

      const showAssignReturn =
        order.orderStatus === 'inReturnStock' ||
        order.orderStatus === 'returnInitiated' ||
        (order.orderShipping &&
          order.orderShipping.orderType === 'Return' &&
          order.orderStatus === 'new');

      row.innerHTML = `
        <th scope="row">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" name="checkAll[]" value="${order.orderNumber}"
              data-order-id="${order._id}">
          </div>
        </th>
        <td class="id cell-compact">
          <a href="/admin/order-details/${order.orderNumber}" class="fw-semibold link-primary text-nowrap">
            ${order.orderNumber}
            ${
              order.orderShipping && order.orderShipping.orderType === 'Return'
                ? '<i class="ri-arrow-go-back-line text-warning ms-1" title="Return Order"></i>'
                : ''
            }
          </a>
        </td>
        <td class="cell-compact"><span class="text-truncate d-inline-block" style="max-width: 9rem" title="${businessLabel}">${businessLabel}</span></td>
        <td class="cell-compact">${custName}</td>
        <td class="cell-compact">
          <span class="text-nowrap">${escHtml(orderType)}</span>
          ${
            retReason
              ? `<div class="cell-muted text-truncate" style="max-width: 10rem" title="${escHtml(retReason)}">Reason: ${retReasonShort}</div>`
              : ''
          }
          ${
            order.isFastShipping
              ? '<span class="badge bg-warning-subtle text-dark ms-1"><i class="ri-flashlight-line"></i> Fast</span>'
              : ''
          }
        </td>
        <td class="cell-compact">${zoneLine}</td>
        <td class="cell-compact">
          <div class="fw-medium">${orderAmount} EGP</div>
          <div class="cell-muted">${getAmountTypeLabel(orderAmountType, order.orderShipping && order.orderShipping.orderType)}</div>
        </td>
        <td class="cell-compact">
          <span class="badge text-uppercase ${st.badgeClass}">${st.statusText}</span>
        </td>
        <td class="cell-compact">${assignBlock}</td>
        <td class="cell-compact text-nowrap"><span title="${new Date(order.orderDate).toISOString()}">${shortDate}</span></td>
        <td class="text-nowrap">
          <div class="orders-table-dropdown" data-order-id="${order.orderNumber}">
            <button class="dropdown-toggle" type="button" aria-expanded="false" data-dropdown-toggle aria-label="Order actions">
              <i class="ri-more-fill" aria-hidden="true"></i>
            </button>
            <ul class="dropdown-menu">
              ${
                showAssignDm
                  ? `<li>
                <button type="button" class="dropdown-item" data-act="assign-dm" data-order="${order.orderNumber}" data-zone="${encodeURIComponent(zone)}">
                  <i class="ri-user-add-line text-success"></i>
                  <span>Assign Delivery Man${
                    order.isFastShipping
                      ? ' <span class="badge bg-warning-subtle text-dark ms-1">Fast</span>'
                      : ''
                  }</span>
                </button>
              </li>`
                  : ''
              }
              ${
                showAssignReturn
                  ? `<li>
                <button type="button" class="dropdown-item" data-act="assign-return" data-order="${order.orderNumber}" data-zone="${encodeURIComponent(zone)}">
                  <i class="ri-user-received-2-line text-info"></i>
                  <span>Assign Courier (Return)</span>
                </button>
              </li>`
                  : ''
              }
              <li>
                <a class="dropdown-item" href="/business/edit-order/${order.orderNumber}">
                  <i class="ri-edit-2-fill text-warning"></i>
                  <span>Edit Order</span>
                </a>
              </li>
              <li><hr class="dropdown-divider my-1" /></li>
              <li>
                <button type="button" class="dropdown-item text-danger" data-act="cancel" data-id="${order._id}">
                  <i class="ri-delete-bin-6-fill"></i>
                  <span>Cancel Order</span>
                </button>
              </li>
              <li>
                <a class="dropdown-item" href="/business/order-details/${order.orderNumber}">
                  <i class="ri-truck-line text-info"></i>
                  <span>Track Order</span>
                </a>
              </li>
            </ul>
          </div>
        </td>
      `;

      tableBody.appendChild(row);

      row.querySelectorAll('[data-act="assign-dm"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          assignDeliveryMan(
            btn.getAttribute('data-order'),
            decodeURIComponent(btn.getAttribute('data-zone') || '')
          );
        });
      });
      row.querySelectorAll('[data-act="assign-return"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          assignCourierToReturn(
            btn.getAttribute('data-order'),
            decodeURIComponent(btn.getAttribute('data-zone') || '')
          );
        });
      });
      row.querySelectorAll('[data-act="cancel"]').forEach((btn) => {
        btn.addEventListener('click', () =>
          cancelOrder(btn.getAttribute('data-id'))
        );
      });

      const rowDd = row.querySelector('.orders-table-dropdown');
      if (rowDd) {
        rowDd.querySelectorAll('.dropdown-item').forEach((item) => {
          item.addEventListener('click', (e) => e.stopPropagation());
        });
      }
    });

    const checkAll = document.getElementById('checkAll');
    if (checkAll) {
      checkAll.checked = false;
      checkAll.indeterminate = false;
    }
    updateOrdersBulkToolbar();
  }

  async function filterOrders(orderType) {
    setActiveOrderTypeTab(orderType);
    currentPageAdmin = 1;
    await fetchOrders(orderType, 1);
  }

  function SearchData() {
    currentPageAdmin = 1;
    fetchOrders(getActiveOrderType(), 1);
  }

  function clearAdminFilters() {
    const search = document.querySelector('.admin-orders-filters .search');
    if (search) search.value = '';
    const dp = document.getElementById('demo-datepicker');
    if (dp) dp.value = '';
    const st = document.getElementById('orderStatus');
    if (st) st.value = 'all';
    const sc = document.getElementById('idStatusCategory');
    if (sc) sc.value = 'all';
    const pay = document.getElementById('idPayment');
    if (pay) pay.value = 'all';
    const fb = document.getElementById('filterBusinessId');
    if (fb) fb.value = '';
    const bq = document.getElementById('businessFilterSearch');
    if (bq) bq.value = '';
    loadBusinessFilterOptions('');
    currentPageAdmin = 1;
    fetchOrders(getActiveOrderType(), 1);
  }

  async function assignDeliveryMan(orderId, zone) {
    document.querySelectorAll('.orders-table-dropdown.show').forEach((d) => {
      if (window.AdminTableDropdowns) window.AdminTableDropdowns.close(d);
    });
    document.getElementById('orderId').value = orderId;
    const deliveryManSelect = document.getElementById('deliveryMan');
    deliveryManSelect.innerHTML = '<option value="">Select a delivery man</option>';
    document.getElementById('loader').style.display = 'block';

    try {
      const response = await fetch(
        `/admin/get-delivery-men?orderId=${orderId}&zone=${encodeURIComponent(zone || '')}`
      );
      const deliveryMen = await response.json();

      if (response.ok) {
        deliveryMen.forEach((man) => {
          const option = document.createElement('option');
          option.value = man._id;
          option.textContent = man.name;
          deliveryManSelect.appendChild(option);
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: `Error fetching delivery men: ${deliveryMen.message || 'Unknown error'}`,
        });
      }
    } catch (error) {
      console.error('Error fetching delivery men:', error);
    } finally {
      document.getElementById('loader').style.display = 'none';
    }

    const assignDeliveryManModal = new bootstrap.Modal(
      document.getElementById('assignDeliveryManModal')
    );
    assignDeliveryManModal.show();
  }

  async function assignCourierToReturn(orderNumber, zone) {
    document.querySelectorAll('.orders-table-dropdown.show').forEach((d) => {
      if (window.AdminTableDropdowns) window.AdminTableDropdowns.close(d);
    });
    document.getElementById('returnOrderId').value = orderNumber;
    const courierSelect = document.getElementById('returnCourier');
    courierSelect.innerHTML = '<option value="">Select a courier</option>';
    document.getElementById('returnCourierLoader').style.display = 'block';

    try {
      const params = new URLSearchParams();
      if (zone) params.append('zone', zone);
      const response = await fetch(
        `/admin/get-couriers-by-zone?${params.toString()}`
      );
      const couriers = await response.json();

      if (response.ok) {
        couriers.forEach((courier) => {
          const option = document.createElement('option');
          option.value = courier._id;
          option.textContent = courier.name;
          courierSelect.appendChild(option);
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: `Error fetching couriers: ${couriers.message || 'Unknown error'}`,
        });
      }
    } catch (error) {
      console.error('Error fetching couriers:', error);
    } finally {
      document.getElementById('returnCourierLoader').style.display = 'none';
    }

    const assignReturnCourierModal = new bootstrap.Modal(
      document.getElementById('assignReturnCourierModal')
    );
    assignReturnCourierModal.show();
  }

  async function cancelOrder(orderId) {
    Swal.fire({
      title: 'Cancel this order?',
      html: '<p class="text-muted mb-0">The order may be marked <strong>canceled</strong> or moved into the <strong>return</strong> flow (e.g. return to warehouse), depending on pickup and delivery state.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, proceed',
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      try {
        const response = await fetch(`/admin/orders/cancel-order/${orderId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          Swal.fire({
            title: 'Updated',
            text: data.message || 'Order has been updated.',
            icon: 'success',
            confirmButtonText: 'OK',
          }).then(() => {
            fetchOrders(getActiveOrderType(), currentPageAdmin);
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: data.error || 'Could not cancel order.',
          });
        }
      } catch (error) {
        console.error('Error:', error);
        Swal.fire({
          title: 'Error',
          text: 'There was an error. Please try again later.',
          icon: 'error',
        });
      }
    });
  }

  async function deleteMultiple() {
    const checked = document.querySelectorAll(
      "input[name='checkAll[]']:checked"
    );
    if (!checked.length) {
      Swal.fire({ icon: 'info', title: 'No orders selected', text: 'Select one or more orders first.' });
      return;
    }
    Swal.fire({
      title: 'Cancel selected orders?',
      html: `<p class="text-muted mb-0">${checked.length} order(s): each may be canceled or moved into the <strong>return</strong> flow depending on status.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, proceed',
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      let ok = 0;
      for (const cb of checked) {
        const id = cb.getAttribute('data-order-id');
        if (!id) continue;
        const res = await fetch(`/admin/orders/cancel-order/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) ok++;
      }
      Swal.fire({
        icon: ok ? 'success' : 'warning',
        title: ok ? 'Done' : 'Partial failure',
        text: ok
          ? `${ok} order(s) updated (canceled or moved to return as applicable).`
          : 'No orders were updated.',
      }).then(() => fetchOrders(getActiveOrderType(), 1));
    });
  }

  function selectPaperSize(size) {
    document.getElementById('paperSize').value = size;
    document.querySelectorAll('.paper-size-option').forEach((option) => {
      option.classList.remove('selected');
    });
    const match = document.querySelector(
      `.paper-size-option[onclick="selectPaperSize('${size}')"]`
    );
    if (match) match.classList.add('selected');
  }

  async function printPolicy() {
    const orderId = document.getElementById('printPolicyOrderId').value;
    const paperSize = document.getElementById('paperSize').value;
    if (!paperSize) {
      Swal.fire({ icon: 'warning', text: 'Please select a paper size.' });
      return;
    }
    try {
      const response = await fetch(
        `/business/orders/print-policy/${orderId}/${paperSize}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paperSize }),
        }
      );
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      console.error(e);
      Swal.fire({ icon: 'error', text: 'Could not print policy.' });
    }
  }

  function initFlatpickr() {
    const el = document.getElementById('demo-datepicker');
    if (!el) return;
    function run() {
      try {
        flatpickr(el, {
          mode: 'range',
          dateFormat: 'd M, Y',
          allowInput: true,
        });
        el.addEventListener('focus', function () {
          if (el._flatpickr) el._flatpickr.open();
        });
      } catch (e) {
        console.error('Flatpickr init error:', e);
      }
    }
    if (typeof window.flatpickr === 'undefined') {
      const s = document.createElement('script');
      s.src = '/assets/libs/flatpickr/flatpickr.min.js';
      s.onload = run;
      document.head.appendChild(s);
    } else {
      run();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initFlatpickr();

    wireOrdersTableSelection();

    const orderTable = document.getElementById('orderTable');
    if (orderTable) {
      orderTable.addEventListener('change', function (e) {
        const t = e.target;
        if (
          t &&
          (t.name === 'checkAll[]' || t.id === 'checkAll')
        ) {
          updateOrdersBulkToolbar();
        }
      });
    }

    const applyBtn = document.getElementById('adminOrdersApplyFilters');
    if (applyBtn) applyBtn.addEventListener('click', SearchData);

    const clearBtn = document.getElementById('adminOrdersClearFilters');
    if (clearBtn) clearBtn.addEventListener('click', clearAdminFilters);

    const bSearch = document.getElementById('businessFilterSearch');
    if (bSearch) {
      bSearch.addEventListener('input', () => {
        clearTimeout(businessSearchTimer);
        businessSearchTimer = setTimeout(() => {
          loadBusinessFilterOptions(bSearch.value.trim());
        }, 300);
      });
    }

    const fbSel = document.getElementById('filterBusinessId');
    if (fbSel) {
      fbSel.addEventListener('change', () => {
        currentPageAdmin = 1;
        fetchOrders(getActiveOrderType(), 1);
      });
    }

    ['orderStatus', 'idStatusCategory', 'idPayment'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          currentPageAdmin = 1;
          fetchOrders(getActiveOrderType(), 1);
        });
      }
    });

    const searchInput = document.querySelector('.admin-orders-filters .search');
    if (searchInput) {
      let t;
      searchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(SearchData, 450);
      });
    }

    const dp = document.getElementById('demo-datepicker');
    if (dp) {
      dp.addEventListener('change', () => {
        currentPageAdmin = 1;
        fetchOrders(getActiveOrderType(), 1);
      });
    }

    loadBusinessFilterOptions('');
    fetchOrders('All', 1);

    const assignForm = document.getElementById('assignDeliveryManForm');
    if (assignForm) {
      assignForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const orderId = document.getElementById('orderId').value;
        const deliveryManId = document.getElementById('deliveryMan').value;

        try {
          const response = await fetch(`/admin/assign-delivery-man`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderNumbers: [orderId],
              courierId: deliveryManId,
            }),
          });

          if (response.ok) {
            const modalEl = document.getElementById('assignDeliveryManModal');
            const m = bootstrap.Modal.getInstance(modalEl);
            if (m) m.hide();
            Swal.fire({
              title: 'Assigned!',
              text: 'Delivery man has been assigned successfully.',
              icon: 'success',
              confirmButtonText: 'OK',
            }).then(() => {
              fetchOrders(getActiveOrderType(), currentPageAdmin);
            });
          } else {
            const result = await response.json();
            Swal.fire({
              icon: 'error',
              title: 'Oops...',
              text: `Error assigning delivery man: ${result.message || 'Unknown error'}`,
            });
          }
        } catch (error) {
          console.error('Error assigning delivery man:', error);
          Swal.fire({
            icon: 'error',
            title: 'Oops...',
            text: 'There was an error assigning the delivery man. Please try again later.',
          });
        }
      });
    }

    const returnForm = document.getElementById('assignReturnCourierForm');
    if (returnForm) {
      returnForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const orderNumber = document.getElementById('returnOrderId').value;
        const courierId = document.getElementById('returnCourier').value;

        if (!courierId) {
          Swal.fire({
            icon: 'warning',
            title: 'Select Courier',
            text: 'Please select a courier',
          });
          return;
        }

        try {
          const response = await fetch('/admin/return-assign-courier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderNumbers: [orderNumber],
              courierId,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to assign courier');
          }

          const modal = bootstrap.Modal.getInstance(
            document.getElementById('assignReturnCourierModal')
          );
          if (modal) modal.hide();

          Swal.fire({
            icon: 'success',
            title: 'Assigned to Courier',
            text: `Return #${orderNumber} has been assigned.`,
            timer: 2000,
          }).then(() => {
            fetchOrders(getActiveOrderType(), currentPageAdmin);
          });
        } catch (error) {
          console.error('Error assigning courier:', error);
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to assign courier.',
          });
        }
      });
    }

    document.addEventListener('hidden.bs.modal', function () {
      document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('padding-right');
    });
  });

  window.assignDeliveryMan = assignDeliveryMan;
  window.assignCourierToReturn = assignCourierToReturn;
  window.filterOrders = filterOrders;
  window.SearchData = SearchData;
  window.clearAdminFilters = clearAdminFilters;
  window.cancelOrder = cancelOrder;
  window.deleteMultiple = deleteMultiple;
  window.selectPaperSize = selectPaperSize;
  window.printPolicy = printPolicy;
})();
