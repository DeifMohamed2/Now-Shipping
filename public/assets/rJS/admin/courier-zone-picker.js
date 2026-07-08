/**
 * Zone picker modal: governorate accordion, parent groups, full-zone toggle.
 */
(function (global) {
  'use strict';

  const Catalog = () => global.CourierZoneCatalog;
  let context = 'assign';
  let selectedValues = new Set();
  let onConfirmCallback = null;
  let expandedGov = null;
  let expandedParents = new Set();

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function getSelectedArray() {
    return [...selectedValues];
  }

  function setSelected(values) {
    selectedValues = new Set(Catalog().uniqueValues(values));
    updateConfirmCount();
    renderList();
  }

  function addValues(values) {
    (values || []).forEach((v) => selectedValues.add(v));
    updateConfirmCount();
    syncListSelection();
  }

  function removeValues(values) {
    (values || []).forEach((v) => selectedValues.delete(v));
    updateConfirmCount();
    syncListSelection();
  }

  function toggleFullZone(govKey, parentKey) {
    const values = Catalog().expandFullZone(govKey, parentKey);
    const allOn = Catalog().isFullZoneSelected(govKey, parentKey, selectedValues);
    if (allOn) {
      removeValues(values);
    } else {
      addValues(values);
    }
  }

  function toggleArea(value) {
    if (selectedValues.has(value)) selectedValues.delete(value);
    else selectedValues.add(value);
    updateConfirmCount();
    syncListSelection();
  }

  function updateConfirmCount() {
    const el = document.getElementById('pickerConfirmCount');
    if (el) el.textContent = selectedValues.size;
  }

  function renderParentGroup(govKey, parentGroup, lang) {
    const { parentKey, areas } = parentGroup;
    const parentArea = areas.find((a) => a.value === parentKey) || areas[0];
    const parentLabel = Catalog().labelFor(parentArea, lang);
    const parentLabelAr = parentArea.label && parentArea.label.ar ? parentArea.label.ar : '';
    const childCount = areas.length;
    const hasChildren = childCount > 1 || (childCount === 1 && areas[0].value !== parentKey);
    const fullSelected = Catalog().isFullZoneSelected(govKey, parentKey, selectedValues);
    const parentExpanded = expandedParents.has(`${govKey}::${parentKey}`);
    const showChildren = hasChildren && parentExpanded;

    let childrenHtml = '';
    if (showChildren) {
      childrenHtml = areas
        .filter((a) => a.value !== parentKey || areas.length === 1)
        .map((area) => {
          const lbl = Catalog().labelFor(area, lang);
          const sel = selectedValues.has(area.value);
          return `
            <button type="button" class="zone-picker-area ${sel ? 'is-selected' : ''}" data-action="toggle-area" data-value="${escapeHtml(area.value)}">
              <span class="zone-picker-area__check"><i class="ri-check-line"></i></span>
              <span class="zone-picker-area__text">${escapeHtml(lbl)}</span>
            </button>`;
        })
        .join('');
    }

    return `
      <div class="zone-picker-parent" data-parent="${escapeHtml(parentKey)}">
        <div class="zone-picker-parent__row">
          ${hasChildren ? `
            <button type="button" class="zone-picker-parent__expand ${parentExpanded ? 'is-open' : ''}" data-action="toggle-parent" data-gov="${escapeHtml(govKey)}" data-parent="${escapeHtml(parentKey)}" aria-label="Expand sub-areas">
              <i class="ri-arrow-right-s-line"></i>
            </button>` : '<span class="zone-picker-parent__expand-spacer"></span>'}
          <div class="zone-picker-parent__info">
            <div class="zone-picker-parent__name">${escapeHtml(parentLabel)}</div>
            ${parentLabelAr && parentLabelAr !== parentLabel ? `<div class="zone-picker-parent__name-ar text-muted">${escapeHtml(parentLabelAr)}</div>` : ''}
          </div>
          ${hasChildren ? `
            <span class="zone-picker-parent__badge">${childCount} areas</span>
            <button type="button" class="zone-picker-full-btn ${fullSelected ? 'is-active' : ''}" data-action="toggle-full" data-gov="${escapeHtml(govKey)}" data-parent="${escapeHtml(parentKey)}">
              <i class="ri-checkbox-${fullSelected ? 'fill' : 'blank-line'}"></i>
              Full zone
            </button>` : `
            <button type="button" class="zone-picker-area zone-picker-area--solo ${selectedValues.has(parentKey) ? 'is-selected' : ''}" data-action="toggle-area" data-value="${escapeHtml(parentKey)}">
              <span class="zone-picker-area__check"><i class="ri-check-line"></i></span>
              <span class="zone-picker-area__text">Select</span>
            </button>`}
        </div>
        ${childrenHtml ? `<div class="zone-picker-children">${childrenHtml}</div>` : ''}
      </div>`;
  }

  function renderList() {
    const container = document.getElementById('governorateZoneList');
    if (!container) return;
    const hierarchy = Catalog().getHierarchy();
    if (!hierarchy) {
      container.innerHTML = '<div class="text-center py-4 text-muted">No zones loaded</div>';
      return;
    }

    const lang = Catalog().getLang();
    const govKeys = Object.keys(hierarchy).sort((a, b) =>
      hierarchy[a].label.en.localeCompare(hierarchy[b].label.en)
    );

    container.innerHTML = govKeys.map((govKey) => {
      const gov = hierarchy[govKey];
      const govLabel = gov.label[lang] || gov.label.en;
      const isOpen = expandedGov === govKey;
      const parentCount = gov.parents.length;
      const parentsHtml = isOpen
        ? gov.parents.map((p) => renderParentGroup(govKey, p, lang)).join('')
        : '';

      return `
        <div class="zone-picker-gov ${isOpen ? 'is-open' : ''}" data-governorate="${escapeHtml(govKey)}">
          <button type="button" class="zone-picker-gov__header" data-action="toggle-gov" data-gov="${escapeHtml(govKey)}">
            <span class="zone-picker-gov__chevron"><i class="ri-arrow-right-s-line"></i></span>
            <span class="zone-picker-gov__name">${escapeHtml(govLabel)}</span>
            <span class="zone-picker-gov__badge">${parentCount} zones</span>
          </button>
          <div class="zone-picker-gov__body">${parentsHtml}</div>
        </div>`;
    }).join('');

    bindListEvents();
  }

  function syncListSelection() {
    document.querySelectorAll('[data-action="toggle-area"]').forEach((btn) => {
      const val = btn.getAttribute('data-value');
      btn.classList.toggle('is-selected', selectedValues.has(val));
    });
    document.querySelectorAll('[data-action="toggle-full"]').forEach((btn) => {
      const gov = btn.getAttribute('data-gov');
      const parent = btn.getAttribute('data-parent');
      const on = Catalog().isFullZoneSelected(gov, parent, selectedValues);
      btn.classList.toggle('is-active', on);
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = on ? 'ri-checkbox-fill' : 'ri-checkbox-blank-line';
      }
    });
    updateConfirmCount();
  }

  function bindListEvents() {
    const container = document.getElementById('governorateZoneList');
    if (!container || container._zonePickerBound) return;
    container._zonePickerBound = true;

    container.addEventListener('click', (e) => {
      const govBtn = e.target.closest('[data-action="toggle-gov"]');
      if (govBtn) {
        const gov = govBtn.getAttribute('data-gov');
        expandedGov = expandedGov === gov ? null : gov;
        renderList();
        return;
      }

      const parentBtn = e.target.closest('[data-action="toggle-parent"]');
      if (parentBtn) {
        const key = `${parentBtn.getAttribute('data-gov')}::${parentBtn.getAttribute('data-parent')}`;
        if (expandedParents.has(key)) expandedParents.delete(key);
        else expandedParents.add(key);
        renderList();
        return;
      }

      const fullBtn = e.target.closest('[data-action="toggle-full"]');
      if (fullBtn) {
        toggleFullZone(fullBtn.getAttribute('data-gov'), fullBtn.getAttribute('data-parent'));
        renderList();
        return;
      }

      const areaBtn = e.target.closest('[data-action="toggle-area"]');
      if (areaBtn) {
        toggleArea(areaBtn.getAttribute('data-value'));
        syncListSelection();
      }
    });
  }

  function applySearch(term) {
    const q = (term || '').trim().toLowerCase();
    const hierarchy = Catalog().getHierarchy();
    if (!hierarchy || !q) {
      document.querySelectorAll('.zone-picker-gov').forEach((el) => { el.style.display = ''; });
      document.querySelectorAll('.zone-picker-parent').forEach((el) => { el.style.display = ''; });
      return;
    }

    Object.keys(hierarchy).forEach((govKey) => {
      const gov = hierarchy[govKey];
      const govEl = document.querySelector(`.zone-picker-gov[data-governorate="${govKey}"]`);
      if (!govEl) return;

      let govMatch = (gov.label.en || '').toLowerCase().includes(q)
        || (gov.label.ar || '').includes(q);

      let anyParent = false;
      govEl.querySelectorAll('.zone-picker-parent').forEach((parentEl) => {
        const text = parentEl.textContent.toLowerCase();
        const show = govMatch || text.includes(q);
        parentEl.style.display = show ? '' : 'none';
        if (show) anyParent = true;
      });

      govEl.style.display = govMatch || anyParent ? '' : 'none';
      if (govMatch || anyParent) {
        govEl.classList.add('is-open');
        expandedGov = govKey;
      }
    });
  }

  async function open(opts) {
    context = opts.context || 'assign';
    onConfirmCallback = opts.onConfirm || null;
    expandedGov = null;
    expandedParents = new Set();

    await Catalog().loadCatalog();
    setSelected(opts.initialValues || []);

    const modalEl = document.getElementById('zoneSelectionModal');
    if (!modalEl) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

  function init() {
    document.getElementById('zoneSearchInput')?.addEventListener('input', (e) => {
      applySearch(e.target.value);
    });

    document.getElementById('confirmZoneSelection')?.addEventListener('click', () => {
      const values = getSelectedArray();
      if (onConfirmCallback) onConfirmCallback(values, context);
      const modalEl = document.getElementById('zoneSelectionModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    });

    document.getElementById('zoneSelectionModal')?.addEventListener('hidden.bs.modal', () => {
      const search = document.getElementById('zoneSearchInput');
      if (search) search.value = '';
      expandedGov = null;
      expandedParents = new Set();
    });
  }

  global.CourierZonePicker = {
    init,
    open,
    getSelectedArray,
    setSelected,
    renderList,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : global);
