/**
 * Admin Couriers page — table, filters, modals, zone assignment.
 */
(function (global) {
  'use strict';

  const Catalog = () => global.CourierZoneCatalog;
  const Picker = () => global.CourierZonePicker;

  let allCouriers = [];
  let filteredCouriers = [];
  let datePicker = null;
  let uploadedPhoto = '';
  let selectedZonesForAdd = [];
  let pendingNewZones = [];
  let currentAssignCourierId = null;
  let currentAssignedZones = [];
  const courierZonesCache = new Map();
  let viewZonesCourierId = null;

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function escapeCsvCell(value) {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  function getFilters() {
    return {
      search: (document.getElementById('courierSearch')?.value || '').trim().toLowerCase(),
      status: document.getElementById('courierStatusFilter')?.value || 'all',
      zone: document.getElementById('courierZoneFilter')?.value || '',
      dateRange: datePicker?.input?.value || document.getElementById('courierDateRange')?.value || '',
    };
  }

  function parseDateRange(dateRange) {
    if (!dateRange || !dateRange.trim()) return null;
    const parts = dateRange.split(/\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
    const parseOne = (s) => {
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const from = parseOne(parts[0]);
    if (!from) return null;
    from.setHours(0, 0, 0, 0);
    let to = new Date(from);
    if (parts[1]) {
      const t = parseOne(parts[1]);
      if (t) { to = t; to.setHours(23, 59, 59, 999); }
    } else {
      to.setHours(23, 59, 59, 999);
    }
    return { from, to };
  }

  function applyFilters() {
    const f = getFilters();
    const range = parseDateRange(f.dateRange);

    filteredCouriers = allCouriers.filter((c) => {
      if (f.status === 'active' && !c.isAvailable) return false;
      if (f.status === 'inactive' && c.isAvailable) return false;
      if (f.zone) {
        const zones = c.assignedZones || [];
        if (!zones.some((z) => z === f.zone || z.startsWith(`${f.zone} - `))) return false;
      }
      if (range) {
        const created = c.createdAt ? new Date(c.createdAt) : null;
        if (!created || created < range.from || created > range.to) return false;
      }
      if (f.search) {
        const hay = [
          c.courierID, c.name, c.phoneNumber, c.email,
          ...(c.assignedZones || []),
        ].join(' ').toLowerCase();
        if (!hay.includes(f.search)) return false;
      }
      return true;
    });

    updateStats(allCouriers);
    updateResultsCount();
    updateFilterChips(f);
    renderTable(filteredCouriers);
  }

  function updateStats(couriers) {
    const total = couriers.length;
    const active = couriers.filter((c) => c.isAvailable).length;
    const onRoute = couriers.filter((c) => (c.activeOrders || 0) + (c.activePickups || 0) > 0).length;
    const zoneSet = new Set();
    couriers.forEach((c) => (c.assignedZones || []).forEach((z) => zoneSet.add(z)));

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('statTotalCouriers', total);
    set('statActiveCouriers', active);
    set('statOnRoute', onRoute);
    set('statZonesCovered', zoneSet.size);
  }

  function updateResultsCount() {
    const el = document.getElementById('couriersResultsCount');
    if (el) {
      el.innerHTML = `Showing <strong>${filteredCouriers.length}</strong> of <strong>${allCouriers.length}</strong> couriers`;
    }
  }

  function updateFilterChips(f) {
    const chipsEl = document.getElementById('couriersFilterChips');
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    const chips = [];
    if (f.search) chips.push({ key: 'search', label: `Search: ${f.search}` });
    if (f.status && f.status !== 'all') chips.push({ key: 'status', label: `Status: ${f.status}` });
    if (f.zone) chips.push({ key: 'zone', label: `Zone: ${f.zone}` });
    if (f.dateRange) chips.push({ key: 'dateRange', label: `Date: ${f.dateRange}` });

    chips.forEach((chip) => {
      const span = document.createElement('span');
      span.className = 'couriers-chip';
      span.innerHTML = `${escapeHtml(chip.label)} <button type="button" aria-label="Remove filter">&times;</button>`;
      span.querySelector('button').addEventListener('click', () => clearFilter(chip.key));
      chipsEl.appendChild(span);
    });
  }

  function clearFilter(key) {
    if (key === 'search') document.getElementById('courierSearch').value = '';
    if (key === 'status') document.getElementById('courierStatusFilter').value = 'all';
    if (key === 'zone') document.getElementById('courierZoneFilter').value = '';
    if (key === 'dateRange') {
      if (datePicker) datePicker.clear();
      else document.getElementById('courierDateRange').value = '';
    }
    applyFilters();
  }

  function clearAllFilters() {
    document.getElementById('courierSearch').value = '';
    document.getElementById('courierStatusFilter').value = 'all';
    document.getElementById('courierZoneFilter').value = '';
    if (datePicker) datePicker.clear();
    applyFilters();
  }

  function renderZoneCellHtml(courierId, zoneValues) {
    const zones = zoneValues || [];
    courierZonesCache.set(String(courierId), zones);

    if (!zones.length) {
      return `<button type="button" class="zone-cell-trigger zone-cell-trigger--empty" data-action="assign-zones" data-courier-id="${escapeHtml(String(courierId))}" title="Assign delivery zones">
        <i class="ri-map-pin-add-line zone-cell-trigger__icon" aria-hidden="true"></i>
        <span class="zone-cell-trigger__text">Assign zones</span>
      </button>`;
    }

    const groups = Catalog().collapseSelectedForDisplay(zones);
    const meta = `${groups.length} zone${groups.length === 1 ? '' : 's'} · ${zones.length} area${zones.length === 1 ? '' : 's'}`;

    return `
      <button type="button" class="zone-cell-trigger" data-action="view-zones" data-courier-id="${escapeHtml(String(courierId))}" title="View assigned zones">
        <i class="ri-map-pin-2-line zone-cell-trigger__icon" aria-hidden="true"></i>
        <span class="zone-cell-trigger__text">${escapeHtml(meta)}</span>
        <i class="ri-arrow-right-s-line zone-cell-trigger__chevron" aria-hidden="true"></i>
      </button>`;
  }

  function buildZoneViewListHtml(groups) {
    const cat = Catalog();
    return groups.map((g) => {
      if (g.type === 'full') {
        const areaLabels = g.values.map((v) => cat.getZoneLabel(v));
        const searchText = [g.label, ...areaLabels].join(' ').toLowerCase();
        const areaChips = g.values.map((v) => (
          `<span class="zone-view-area-chip">${escapeHtml(cat.getZoneLabel(v))}</span>`
        )).join('');
        return `
          <details class="zone-view-item zone-view-item--full" data-search="${escapeHtml(searchText)}">
            <summary class="zone-view-item__summary">
              <span class="zone-view-item__badge">Full</span>
              <span class="zone-view-item__name">${escapeHtml(g.label)}</span>
              <span class="zone-view-item__meta">${g.count} area${g.count === 1 ? '' : 's'}</span>
              <i class="ri-arrow-down-s-line zone-view-item__chevron" aria-hidden="true"></i>
            </summary>
            <div class="zone-view-item__areas">${areaChips}</div>
          </details>`;
      }
      const searchText = String(g.label || '').toLowerCase();
      return `
        <div class="zone-view-item zone-view-item--partial" data-search="${escapeHtml(searchText)}">
          <span class="zone-view-item__dot" aria-hidden="true"></span>
          <span class="zone-view-item__name">${escapeHtml(g.label)}</span>
        </div>`;
    }).join('');
  }

  function filterZoneViewList(query) {
    const list = document.getElementById('viewZonesList');
    const empty = document.getElementById('viewZonesEmpty');
    if (!list) return;

    const q = (query || '').trim().toLowerCase();
    let visible = 0;
    list.querySelectorAll('.zone-view-item').forEach((item) => {
      const hay = item.getAttribute('data-search') || '';
      const match = !q || hay.includes(q);
      item.classList.toggle('d-none', !match);
      if (match) visible += 1;
    });

    if (empty) {
      empty.classList.toggle('d-none', visible > 0 || !q);
    }
    list.classList.toggle('d-none', visible === 0 && !!q);
  }

  function showCourierZonesModal(courierId) {
    const courier = findCourier(courierId);
    if (!courier) {
      Swal.fire({ icon: 'error', title: 'Courier not found', text: 'Please refresh and try again.' });
      return;
    }
    const zones = courierZonesCache.get(String(courierId)) || courier.assignedZones || [];
    const groups = Catalog().collapseSelectedForDisplay(zones);
    viewZonesCourierId = courierId;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setText('viewZonesName', courier?.name || 'Unknown');
    setText('viewZonesPhone', courier?.phoneNumber || '—');
    setText('viewZonesId', courier ? `#${courier.courierID}` : '—');
    setText('viewZonesSubtitle', courier?.name ? `Coverage for ${courier.name}` : 'Assigned coverage');
    setText('viewZonesGroupCount', groups.length);
    setText('viewZonesAreaCount', zones.length);
    setText('viewZonesFullCount', groups.filter((g) => g.type === 'full').length);

    const avatar = document.getElementById('viewZonesAvatar');
    if (avatar) {
      avatar.onerror = function onAvatarError() {
        this.onerror = null;
        this.src = '/placeholder.svg?height=52&width=52';
      };
      avatar.src = courier?.personalPhoto || '/placeholder.svg?height=52&width=52';
      avatar.alt = courier?.name || 'Courier';
    }

    const list = document.getElementById('viewZonesList');
    if (list) {
      if (!groups.length) {
        list.innerHTML = '<div class="zone-view-empty"><i class="ri-map-pin-line"></i><p>No zones assigned yet.</p></div>';
      } else {
        list.innerHTML = buildZoneViewListHtml(groups);
      }
      list.classList.remove('d-none');
    }

    const search = document.getElementById('viewZonesSearch');
    if (search) {
      search.value = '';
      filterZoneViewList('');
    }

    const empty = document.getElementById('viewZonesEmpty');
    if (empty) empty.classList.add('d-none');

    bootstrap.Modal.getOrCreateInstance(document.getElementById('viewCourierZonesModal')).show();
  }

  function renderZoneChips(containerId, zoneValues, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const options = opts || {};
    const groups = Catalog().collapseSelectedForDisplay(zoneValues || []);

    if (!groups.length) {
      container.innerHTML = '<span class="zone-empty-hint">No zones selected</span>';
      return;
    }

    container.innerHTML = groups.map((g) => {
      const cls = g.type === 'full' ? 'zone-chip zone-chip--full' : 'zone-chip';
      const label = g.type === 'full'
        ? `${escapeHtml(g.label)} · Full (${g.count})`
        : escapeHtml(g.label);
      const removeBtn = options.removable
        ? `<button type="button" data-remove-values="${escapeHtml(JSON.stringify(g.values))}" aria-label="Remove">&times;</button>`
        : '';
      return `<span class="${cls}">${label}${removeBtn}</span>`;
    }).join('');

    if (options.removable) {
      container.querySelectorAll('button[data-remove-values]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const toRemove = new Set(JSON.parse(btn.getAttribute('data-remove-values')));
          const next = (zoneValues || []).filter((v) => !toRemove.has(v));
          if (options.onChange) options.onChange(next);
        });
      });
    }
  }

  function renderPendingZoneChips() {
    renderZoneChips('selectedZonesTags', pendingNewZones, {
      removable: true,
      onChange: (next) => {
        pendingNewZones = next;
        refreshAssignModalZones();
      },
    });
  }

  function renderAddCourierZoneChips() {
    renderZoneChips('addCourierSelectedZonesTags', selectedZonesForAdd, {
      removable: true,
      onChange: (next) => {
        selectedZonesForAdd = next;
        const c = document.getElementById('addCourierZoneCount');
        if (c) c.textContent = next.length;
        renderAddCourierZoneChips();
      },
    });
  }

  function renderTable(couriers) {
    const tableBody = document.getElementById('couriersTable');
    const noResult = document.querySelector('.noresult');
    if (!tableBody) return;

    if (!couriers.length) {
      tableBody.innerHTML = '';
      if (noResult) noResult.style.display = 'block';
      return;
    }
    if (noResult) noResult.style.display = 'none';

    tableBody.innerHTML = couriers.map((courier) => `
      <tr>
        <th scope="row">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" name="checkAll[]" value="${escapeHtml(courier.courierID)}">
          </div>
        </th>
        <td>
          <div class="d-flex align-items-center">
            <img src="${escapeHtml(courier.personalPhoto || '/placeholder.svg?height=40&width=40')}" class="courier-avatar me-2" alt="" onerror="this.onerror=null;this.src='/placeholder.svg?height=40&width=40'">
            <div class="min-w-0">
              <div class="fw-medium fs-14 text-truncate">${escapeHtml(courier.name || 'Unknown')}</div>
              <div class="text-muted fs-12">#${escapeHtml(courier.courierID)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(courier.phoneNumber || 'N/A')}</td>
        <td class="zones-col"><div class="zone-badge-container">${renderZoneCellHtml(courier.courierID, courier.assignedZones)}</div></td>
        <td>
          <small class="text-info d-block"><i class="ri-truck-line me-1"></i>${courier.activeOrders || 0} Orders</small>
          <small class="text-warning d-block"><i class="ri-takeaway-line me-1"></i>${courier.activePickups || 0} Pickups</small>
        </td>
        <td class="text-center">
          <div class="fw-semibold fs-14">${courier.totalAssignedOrders || 0}</div>
          <small class="text-muted">${courier.successPercentage || 0}%</small>
        </td>
        <td class="text-center fw-semibold fs-14">${courier.totalAssignedPickups || 0}</td>
        <td>
          <span class="badge ${courier.isAvailable ? 'badge-courier-active' : 'badge-courier-inactive'} text-uppercase">${courier.isAvailable ? 'Active' : 'Inactive'}</span>
        </td>
        <td>${courier.createdAt ? new Date(courier.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
        <td>
          <div class="orders-table-dropdown" data-courier-id="${escapeHtml(courier.courierID)}">
            <button type="button" class="dropdown-toggle" data-dropdown-toggle aria-expanded="false" aria-label="Actions"><i class="ri-more-fill"></i></button>
            <ul class="dropdown-menu">
              <li><a class="dropdown-item" href="/admin/courier-details/${escapeHtml(courier.courierID)}"><i class="ri-eye-fill text-muted"></i><span>View Details</span></a></li>
              <li><button type="button" class="dropdown-item" data-action="assign-zones" data-courier-id="${escapeHtml(courier.courierID)}"><i class="ri-map-pin-line text-muted"></i><span>Assign Zones</span></button></li>
              <li><button type="button" class="dropdown-item" data-action="edit-courier" data-courier-id="${escapeHtml(courier.courierID)}"><i class="ri-pencil-fill text-muted"></i><span>Edit</span></button></li>
              <li><hr class="dropdown-divider my-1"></li>
              <li><button type="button" class="dropdown-item text-danger" data-act="deactivate-courier" data-courier-id="${escapeHtml(courier.courierID)}"><i class="ri-user-unfollow-line"></i><span>Deactivate</span></button></li>
              <li><button type="button" class="dropdown-item text-danger" data-act="delete-courier" data-courier-id="${escapeHtml(courier.courierID)}"><i class="ri-delete-bin-fill"></i><span>Delete</span></button></li>
            </ul>
          </div>
        </td>
      </tr>`).join('');

    updateBulkToolbar();
  }

  async function fetchCouriers() {
    const tableBody = document.getElementById('couriersTable');
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm"></div></td></tr>`;
    }
    try {
      const res = await fetch('/admin/get-couriers');
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Failed to load');
      allCouriers = Array.isArray(data) ? data : [];
      applyFilters();
    } catch (err) {
      console.error(err);
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Could not load couriers' });
    }
  }

  function populateZoneFilter() {
    const sel = document.getElementById('courierZoneFilter');
    if (!sel || !Catalog().getHierarchy()) return;
    const current = sel.value;
    const options = Catalog().getParentZoneOptions();
    sel.innerHTML = '<option value="">All zones</option>' + options.map((o) =>
      `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)} (${o.subCount})</option>`
    ).join('');
    if (current) sel.value = current;
  }

  function initDatePicker() {
    const el = document.getElementById('courierDateRange');
    if (!el || typeof flatpickr === 'undefined') return;
    datePicker = flatpickr(el, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd M, Y',
      disableMobile: true,
      onChange: () => applyFilters(),
    });
  }

  function findCourier(courierId) {
    if (courierId == null || courierId === '') return null;
    const id = String(courierId);
    return allCouriers.find((c) => String(c.courierID) === id) || null;
  }

  function closeActionDropdown(el) {
    const portaledMenu = el?.closest('.orders-table-dropdown-menu--fixed');
    const owner = portaledMenu?._adminDropdownOwner || el?.closest('.orders-table-dropdown');
    if (owner && global.AdminTableDropdowns?.close) {
      global.AdminTableDropdowns.close(owner);
    }
  }

  function openAssignModal(courierId) {
    const courier = findCourier(courierId);
    if (!courier) {
      Swal.fire({ icon: 'error', title: 'Courier not found', text: 'Please refresh and try again.' });
      return;
    }

    currentAssignCourierId = courier.courierID;
    currentAssignedZones = [...(courier.assignedZones || [])];
    pendingNewZones = [];

    document.getElementById('courierIdForZones').value = courier.courierID;
    document.getElementById('courierNameForZones').textContent = courier.name || 'Unknown';
    document.getElementById('courierPhoneForZones').textContent = courier.phoneNumber || 'N/A';
    const avatar = document.getElementById('courierAvatarForZones');
    if (avatar) {
      avatar.onerror = function onAvatarError() {
        this.onerror = null;
        this.src = '/placeholder.svg?height=52&width=52';
      };
      avatar.src = courier.personalPhoto || '/placeholder.svg?height=52&width=52';
    }

    refreshAssignModalZones();
    document.getElementById('zoneNotes').value = '';

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('assignZonesModal'));
    modal.show();
  }

  function refreshAssignModalZones() {
    const countEl = document.getElementById('currentZoneCount');
    const newCountEl = document.getElementById('pendingZoneCount');
    if (countEl) countEl.textContent = currentAssignedZones.length;

    renderZoneChips('currentZones', currentAssignedZones, {
      removable: true,
      onChange: async (next) => {
        const ok = await saveZonesDirect(currentAssignCourierId, next);
        if (ok) {
          currentAssignedZones = next;
          refreshAssignModalZones();
        }
      },
    });

    renderZoneChips('selectedZonesTags', pendingNewZones, {
      removable: true,
      onChange: (next) => {
        pendingNewZones = next;
        renderPendingZoneChips();
        const newCountEl = document.getElementById('pendingZoneCount');
        if (newCountEl) newCountEl.textContent = next.length;
      },
    });

    if (newCountEl) newCountEl.textContent = pendingNewZones.length;
  }

  async function saveZonesDirect(courierId, zones) {
    if (!zones.length) {
      Swal.fire({ icon: 'warning', title: 'At least one zone required', text: 'A courier must have at least one assigned zone.' });
      return false;
    }
    const res = await fetch('/admin/couriers/update-zones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courierId, zones, notes: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'Update failed' });
      return false;
    }
    await fetchCouriers();
    return true;
  }

  async function saveZoneAssignments() {
    const courierId = currentAssignCourierId;
    const notes = document.getElementById('zoneNotes')?.value || '';
    const combined = Catalog().uniqueValues([...currentAssignedZones, ...pendingNewZones]);

    if (!combined.length) {
      Swal.fire({ icon: 'warning', title: 'No zones', text: 'Select at least one zone.' });
      return;
    }

    const btn = document.getElementById('saveZonesBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin me-1"></i>Saving…';

    try {
      const res = await fetch('/admin/couriers/update-zones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierId, zones: combined, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      Swal.fire({ icon: 'success', title: 'Zones saved', timer: 2000, showConfirmButton: false });
      bootstrap.Modal.getInstance(document.getElementById('assignZonesModal'))?.hide();
      pendingNewZones = [];
      await fetchCouriers();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  function openZonePickerForAssign() {
    Picker().open({
      context: 'assign',
      initialValues: pendingNewZones,
      onConfirm: (values) => {
        pendingNewZones = values;
        refreshAssignModalZones();
      },
    });
  }

  function openZonePickerForAdd() {
    Picker().open({
      context: 'add',
      initialValues: selectedZonesForAdd,
      onConfirm: (values) => {
        selectedZonesForAdd = values;
        const countEl = document.getElementById('addCourierZoneCount');
        if (countEl) countEl.textContent = values.length;
        renderAddCourierZoneChips();
      },
    });
  }

  function exportCouriers(format) {
    const rows = filteredCouriers;
    if (!rows.length) {
      Swal.fire({ icon: 'warning', title: 'Nothing to export', text: 'No couriers match filters.' });
      return;
    }
    const headers = ['Courier ID', 'Name', 'Phone', 'Email', 'Status', 'Zones', 'Active Orders', 'Active Pickups', 'Created'];
    const data = rows.map((c) => ({
      id: c.courierID,
      name: c.name,
      phone: c.phoneNumber,
      email: c.email,
      status: c.isAvailable ? 'Active' : 'Inactive',
      zones: (c.assignedZones || []).join('; '),
      orders: c.activeOrders || 0,
      pickups: c.activePickups || 0,
      created: c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : '',
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `couriers_${stamp}_${rows.length}`;

    if (format === 'csv') {
      const lines = [headers.map(escapeCsvCell).join(','), ...data.map((r) =>
        [r.id, r.name, r.phone, r.email, r.status, r.zones, r.orders, r.pickups, r.created].map(escapeCsvCell).join(',')
      )];
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }

    const tableRows = data.map((r) => `<tr>
      <td>${escapeHtml(r.id)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.phone)}</td>
      <td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.zones)}</td>
      <td>${escapeHtml(r.orders)}</td><td>${escapeHtml(r.pickups)}</td><td>${escapeHtml(r.created)}</td>
    </tr>`).join('');
    const html = `<html><head><meta charset="UTF-8"></head><body><table border="1">
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${tableRows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function updateBulkToolbar() {
    const n = document.querySelectorAll('#couriersTable input[name="checkAll[]"]:checked').length;
    const bar = document.getElementById('courier-bulk-toolbar');
    if (bar) {
      bar.classList.toggle('d-none', n === 0);
      bar.classList.toggle('d-flex', n > 0);
    }
  }

  async function bulkDeactivate() {
    const ids = [...document.querySelectorAll('#couriersTable input[name="checkAll[]"]:checked')].map((cb) => cb.value);
    if (!ids.length) return;
    const r = await Swal.fire({ title: 'Deactivate selected?', icon: 'warning', showCancelButton: true });
    if (!r.isConfirmed) return;
    const res = await fetch('/admin/couriers/bulk-deactivate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courierIDs: ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { Swal.fire({ icon: 'success', title: 'Done' }); fetchCouriers(); }
    else Swal.fire({ icon: 'error', text: data.error || 'Failed' });
  }

  async function bulkDelete() {
    const ids = [...document.querySelectorAll('#couriersTable input[name="checkAll[]"]:checked')].map((cb) => cb.value);
    if (!ids.length) return;
    const r = await Swal.fire({ title: 'Delete selected?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' });
    if (!r.isConfirmed) return;
    const res = await fetch('/admin/couriers/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courierIDs: ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      Swal.fire({ icon: 'success', text: `Deleted: ${(data.deleted || []).length}` });
      fetchCouriers();
    } else Swal.fire({ icon: 'error', text: data.error || 'Failed' });
  }

  function openAssignModalFromView() {
    const id = viewZonesCourierId;
    if (!id) return;

    const viewModalEl = document.getElementById('viewCourierZonesModal');
    const viewModal = viewModalEl ? bootstrap.Modal.getInstance(viewModalEl) : null;

    const launchAssign = () => {
      setTimeout(() => openAssignModal(id), 50);
    };

    if (viewModal && viewModalEl?.classList.contains('show')) {
      viewModalEl.addEventListener('hidden.bs.modal', launchAssign, { once: true });
      viewModal.hide();
    } else {
      launchAssign();
    }
  }

  function onCourierActionClick(e) {
    if (!e.target.closest('.couriers-page') && !e.target.closest('#viewCourierZonesModal') && !e.target.closest('.orders-table-dropdown-menu--fixed')) {
      return;
    }

    const viewZones = e.target.closest('[data-action="view-zones"]');
    if (viewZones) {
      e.preventDefault();
      e.stopPropagation();
      showCourierZonesModal(viewZones.getAttribute('data-courier-id'));
      return;
    }

    const assign = e.target.closest('[data-action="assign-zones"]');
    if (assign) {
      e.preventDefault();
      e.stopPropagation();
      closeActionDropdown(assign);
      openAssignModal(assign.getAttribute('data-courier-id'));
      return;
    }

    const edit = e.target.closest('[data-action="edit-courier"]');
    if (edit) {
      e.preventDefault();
      e.stopPropagation();
      closeActionDropdown(edit);
      openEditModal(edit.getAttribute('data-courier-id'));
      return;
    }

    const deact = e.target.closest('[data-act="deactivate-courier"]');
    if (deact) {
      e.preventDefault();
      e.stopPropagation();
      closeActionDropdown(deact);
      const id = deact.getAttribute('data-courier-id');
      Swal.fire({ title: 'Deactivate?', icon: 'warning', showCancelButton: true }).then(async (r) => {
        if (!r.isConfirmed) return;
        const res = await fetch('/admin/couriers/bulk-deactivate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courierIDs: [id] }),
        });
        if (res.ok) fetchCouriers();
      });
      return;
    }

    const del = e.target.closest('[data-act="delete-courier"]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      closeActionDropdown(del);
      const id = del.getAttribute('data-courier-id');
      Swal.fire({ title: 'Delete?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33' }).then(async (r) => {
        if (!r.isConfirmed) return;
        const res = await fetch('/admin/couriers/bulk-delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courierIDs: [id] }),
        });
        if (res.ok) fetchCouriers();
      });
    }
  }

  function openEditModal(courierId) {
    const courier = findCourier(courierId);
    if (!courier) {
      Swal.fire({ icon: 'error', title: 'Courier not found', text: 'Please refresh and try again.' });
      return;
    }
    const parts = (courier.name || '').trim().split(/\s+/);
    document.getElementById('editCourierId').value = courier.courierID;
    document.getElementById('editFirstName').value = parts[0] || '';
    document.getElementById('editLastName').value = parts.slice(1).join(' ') || '';
    document.getElementById('editEmail').value = courier.email || '';
    document.getElementById('editPhone').value = courier.phoneNumber || '';
    document.getElementById('editVehicleType').value = courier.vehicleType || '';
    document.getElementById('editStatus').value = courier.isAvailable ? 'Active' : 'Inactive';
    document.getElementById('editAddress').value = courier.address || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editCourierModal')).show();
  }

  function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.querySelector('.password-addon i');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    if (icon) {
      icon.classList.toggle('ri-eye-fill', !show);
      icon.classList.toggle('ri-eye-off-fill', show);
    }
  }

  function initPhotoUpload() {
    const UPLOAD_URL = '/api/v1/upload/single';
    document.getElementById('courierPhoto')?.addEventListener('change', function (event) {
      const file = event.target.files[0];
      uploadedPhoto = '';
      if (!file) return;
      const submitButton = document.getElementById('addCourierBtn');
      submitButton.disabled = true;
      submitButton.innerText = 'Uploading…';
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'couriers');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', UPLOAD_URL, true);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          document.getElementById('photoStatus').innerText = `Uploading: ${Math.round((ev.loaded * 100) / ev.total)}%`;
        }
      };
      xhr.onload = function () {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          if (data.secure_url) {
            uploadedPhoto = data.secure_url;
            document.getElementById('photoStatus').innerText = 'Photo uploaded';
          }
        } else {
          document.getElementById('photoStatus').innerText = 'Upload failed';
        }
        submitButton.disabled = false;
        submitButton.innerText = 'Create Courier';
      };
      xhr.onerror = () => {
        document.getElementById('photoStatus').innerText = 'Upload failed';
        submitButton.disabled = false;
        submitButton.innerText = 'Create Courier';
      };
      xhr.send(formData);
    });
  }

  function initAddCourierForm() {
    document.getElementById('addCourierForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedZonesForAdd.length) {
        Swal.fire({ icon: 'warning', title: 'Select zones', text: 'Assign at least one delivery zone.' });
        return;
      }
      const form = e.target;
      const data = Object.fromEntries(new FormData(form).entries());
      data.zones = selectedZonesForAdd;
      data.photo = uploadedPhoto;
      try {
        const res = await fetch('/admin/couriers/create-courier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (res.ok) {
          Swal.fire({ icon: 'success', title: 'Courier created' }).then(() => window.location.reload());
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: result.error || 'Create failed' });
        }
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Request failed' });
      }
    });
  }

  function initSelection() {
    const table = document.getElementById('courierTable');
    const checkAll = document.getElementById('checkAll');
    if (table && checkAll && global.AdminTableDropdowns?.bindTableSelection) {
      global.AdminTableDropdowns.bindTableSelection(table, checkAll, updateBulkToolbar);
    }
    document.getElementById('bulk-deactivate-couriers')?.addEventListener('click', bulkDeactivate);
    document.getElementById('remove-actions')?.addEventListener('click', bulkDelete);
    document.addEventListener('click', onCourierActionClick);
  }

  async function init() {
    await Catalog().loadCatalog();
    populateZoneFilter();
    initDatePicker();
    initPhotoUpload();
    initAddCourierForm();
    initSelection();

    document.getElementById('courierSearch')?.addEventListener('input', () => applyFilters());
    document.getElementById('courierStatusFilter')?.addEventListener('change', () => applyFilters());
    document.getElementById('courierZoneFilter')?.addEventListener('change', () => applyFilters());
    document.getElementById('openZoneSelectionBtn')?.addEventListener('click', openZonePickerForAssign);
    document.getElementById('openAddCourierZoneSelectionBtn')?.addEventListener('click', openZonePickerForAdd);
    document.getElementById('saveZonesBtn')?.addEventListener('click', saveZoneAssignments);

    document.getElementById('viewZonesSearch')?.addEventListener('input', (e) => {
      filterZoneViewList(e.target.value);
    });
    document.getElementById('viewZonesAssignBtn')?.addEventListener('click', openAssignModalFromView);

    document.getElementById('addCourierModal')?.addEventListener('show.bs.modal', () => {
      selectedZonesForAdd = [];
      renderAddCourierZoneChips();
      const c = document.getElementById('addCourierZoneCount');
      if (c) c.textContent = '0';
    });

    global.togglePassword = togglePassword;
    global.exportCouriers = exportCouriers;
    global.clearAllCourierFilters = clearAllFilters;
    global.applyCourierFilters = applyFilters;

    await fetchCouriers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CouriersPage = { fetchCouriers, applyFilters };
})(typeof window !== 'undefined' ? window : global);
