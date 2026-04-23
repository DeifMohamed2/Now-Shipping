/**
 * edit-order.js — Redesigned 4-step wizard for editing an order.
 * Works with the redesigned edit-order.ejs.
 */
(function () {
  'use strict';

  var CUR = (typeof window !== 'undefined' && window.__EO_CURRENCY) ? window.__EO_CURRENCY : 'EGP';

  // ── i18n ─────────────────────────────────────────────────────────────────
  var __NSEO =
    typeof window !== 'undefined' &&
    window.__NS_BUSINESS_I18N &&
    window.__NS_BUSINESS_I18N.editOrder
      ? window.__NS_BUSINESS_I18N.editOrder
      : {};

  function t(key, fallback) {
    return (__NSEO[key] != null ? __NSEO[key] : fallback) || fallback || '';
  }

  function stepBadgeText(step, max) {
    var m = max != null ? max : 4;
    return t('stepOf', 'Step {cur} of {max}')
      .replace(/\{cur\}/g, String(step))
      .replace(/\{max\}/g, String(m));
  }

  function getStepMeta(step) {
    var table = {
      1: { kT: 'wizStep1Title', kS: 'wizStep1Sub', fT: 'Customer Details', fS: 'Update the recipient\'s contact and location' },
      2: { kT: 'wizStep2Title', kS: 'wizStep2Sub', fT: 'Shipping Details', fS: 'Review order type and configure delivery options' },
      3: { kT: 'wizStep3Title', kS: 'wizStep3Sub', fT: 'Additional Options', fS: 'Update special instructions and review fees' },
      4: { kT: 'wizStep4Title', kS: 'wizStep4Sub', fT: 'Review & Update', fS: 'Confirm your changes before saving' },
    };
    var d = table[step] || table[1];
    return { title: t(d.kT, d.fT), subtitle: t(d.kS, d.fS) };
  }

  function getStepTip(step) {
    return t('wizTip' + step, [
      'Update the customer info, address, and options then review before saving.',
      'Express shipping toggle is locked for orders older than 6 hours.',
      'Add special notes so our couriers know exactly what to do.',
      'Review all changes carefully before pressing Update Order.',
    ][step - 1] || '');
  }

  // ── Server-side state injected by EJS ─────────────────────────────────────
  var S = (typeof window !== 'undefined' && window.__EO_STATE) ? window.__EO_STATE : {};

  // ── Mutable state ─────────────────────────────────────────────────────────
  var state = {
    step:          1,
    isExpress:     !!S.isExpress,
    expressLocked: !!S.expressLocked,
    isCOD:         !!S.isCOD,
    isCD:          !!S.isCD,
    canOpenPackage: false,
    submitting:    false,
    baseFee:       0,
    lastFee:       S.orderFees || 0,
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function el(id)  { return document.getElementById(id); }

  function setCollapsible(id, open) {
    var c = el(id);
    if (!c) return;
    c.classList.toggle('co-collapsible--open', open);
  }

  function setToggleCard(btn, on) {
    if (!btn) return;
    btn.classList.toggle('co-toggle-card--on', on);
  }

  function setCheckCard(btn, on) {
    if (!btn) return;
    btn.classList.toggle('co-check-card--on', on);
  }

  function showFieldError(id, show) {
    var e = el(id);
    if (!e) return;
    e.classList.toggle('co-field-error--show', show);
  }

  function setInputError(inputId, isError) {
    var i = el(inputId);
    if (!i) return;
    i.classList.toggle('is-error', isError);
  }

  // ── Step Indicator Update ─────────────────────────────────────────────────
  function updateStepUI(step) {
    var meta = getStepMeta(step);
    var titleEl = el('co-step-title');
    var subEl   = el('co-step-subtitle');
    var badgeEl = el('co-step-badge');
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl)   subEl.textContent   = meta.subtitle;
    if (badgeEl) badgeEl.textContent = stepBadgeText(step, 4);

    var fill = el('co-progress-fill');
    if (fill) fill.style.width = ((step - 1) / 3 * 100) + '%';

    for (var i = 1; i <= 4; i++) {
      var node  = el('co-node-'  + i);
      var label = el('co-label-' + i);
      if (!node) continue;
      node.classList.remove('co-step-node--active', 'co-step-node--done');
      if (label) label.classList.remove('co-step-label--active', 'co-step-label--done');
      if (i < step) {
        node.classList.add('co-step-node--done');
        if (label) label.classList.add('co-step-label--done');
      } else if (i === step) {
        node.classList.add('co-step-node--active');
        if (label) label.classList.add('co-step-label--active');
      }
    }

    var tip = el('co-tip-text');
    if (tip) tip.textContent = getStepTip(step) || '';

    var footer = el('co-nav-footer');
    if (footer) footer.style.display = step === 4 ? 'none' : '';

    var btnBack = el('co-btn-back');
    if (btnBack) btnBack.disabled = step === 1;

    var btnNext = el('co-btn-next');
    if (btnNext) {
      if (step === 3) {
        btnNext.innerHTML = t('labelReview', 'Review') + ' <i class="ri-arrow-right-s-line co-btn-next__chev" aria-hidden="true"></i>';
      } else {
        btnNext.innerHTML = t('labelContinue', 'Continue') + ' <i class="ri-arrow-right-s-line co-btn-next__chev" aria-hidden="true"></i>';
      }
    }

    if (btnBack) {
      btnBack.innerHTML = '<i class="ri-arrow-left-s-line co-btn-back__chev" aria-hidden="true"></i> ' + t('labelBack', 'Back');
    }
  }

  // ── Show step panel ───────────────────────────────────────────────────────
  function showStep(step) {
    for (var i = 1; i <= 4; i++) {
      var panel = el('co-step-' + i);
      if (!panel) continue;
      panel.classList.toggle('step-panel--active', i === step);
    }
    state.step = step;
    updateStepUI(step);
    if (step === 3) { updateFeeSummary(); }
    if (step === 4) { populateReview(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validateStep(step) {
    var ok = true;

    if (step === 1) {
      var fn   = el('fullName');
      var ph   = el('phoneNumber');
      var gv   = el('government-value');
      var zn   = el('zone-value');
      var addr = el('address');

      if (!fn || !fn.value.trim()) {
        setInputError('fullName', true);
        showFieldError('err-fullName', true);
        ok = false;
      }
      if (!ph || !ph.value.trim()) {
        setInputError('phoneNumber', true);
        showFieldError('err-phoneNumber', true);
        ok = false;
      }
      if (!gv || !gv.value || !zn || !zn.value) {
        var areaBtn = el('selectAreaBtn');
        if (areaBtn) areaBtn.classList.add('is-error');
        showFieldError('err-zone', true);
        ok = false;
      }
      if (!addr || !addr.value.trim()) {
        setInputError('address', true);
        showFieldError('err-address', true);
        ok = false;
      }
      if (!ok && fn && !fn.value.trim()) fn.focus();
    }

    return ok;
  }

  function clearErrors() {
    ['fullName','phoneNumber','address'].forEach(function (id) {
      setInputError(id, false);
    });
    ['err-fullName','err-phoneNumber','err-zone','err-address'].forEach(function (id) {
      showFieldError(id, false);
    });
    var areaBtn = el('selectAreaBtn');
    if (areaBtn) areaBtn.classList.remove('is-error');
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    if (!validateStep(state.step)) return;
    clearErrors();
    showStep(state.step + 1);
  }

  function goBack() {
    if (state.step <= 1) return;
    clearErrors();
    showStep(state.step - 1);
  }

  // ── Toggle helpers ────────────────────────────────────────────────────────
  window.eoToggleCard = function (btn, hiddenInputName, btnId) {
    var isOn = btn.classList.contains('co-toggle-card--on');
    setToggleCard(btn, !isOn);
    if (hiddenInputName) {
      var inp = document.querySelector('input[name="' + hiddenInputName + '"]');
      if (inp) inp.value = !isOn ? 'on' : '';
    }
    if (btnId === 'co-open-pkg-toggle') {
      state.canOpenPackage = !isOn;
    }
  };

  window.eoToggleWorkAddress = function () {
    var btn = el('co-work-addr-toggle');
    var inp = el('deliverToWorkAddress-input');
    var isOn = btn && btn.classList.contains('co-check-card--on');
    setCheckCard(btn, !isOn);
    if (inp) inp.value = !isOn ? 'on' : '';
  };

  window.eoToggleExpress = function () {
    if (state.expressLocked) return;
    state.isExpress = !state.isExpress;
    var btn = el('co-express-toggle');
    setToggleCard(btn, state.isExpress);
    var inp = el('isExpressShipping-input');
    if (inp) inp.value = state.isExpress ? 'on' : '';
    // Show/hide express row in fee summary
    var expRow = el('co-fee-express-row');
    if (expRow) expRow.style.display = state.isExpress ? '' : 'none';
    // Update review panel
    var revExp = el('rev-express');
    if (revExp) revExp.textContent = state.isExpress ? t('yes', 'Yes') : t('no', 'No');
    updateFeeSummary();
  };

  window.eoToggleCOD = function () {
    state.isCOD = !state.isCOD;
    var btn = el('co-cod-toggle');
    var inp = el('COD-input');
    setToggleCard(btn, state.isCOD);
    if (inp) inp.value = state.isCOD ? 'on' : '';
    setCollapsible('co-cod-amount-wrap', state.isCOD);
  };

  window.eoToggleCD = function () {
    state.isCD = !state.isCD;
    var btn = el('co-cd-toggle');
    var inp = el('CashDifference-input');
    setToggleCard(btn, state.isCD);
    if (inp) inp.value = state.isCD ? 'on' : '';
    setCollapsible('co-cd-amount-wrap', state.isCD);
  };

  // ── Item counter ──────────────────────────────────────────────────────────
  window.eoAdjustCounter = function (inputId, displayId, delta) {
    var inp  = el(inputId);
    var disp = el(displayId);
    if (!inp) return;
    var val = Math.max(1, (parseInt(inp.value) || 1) + delta);
    inp.value = val;
    if (disp) disp.textContent = val;
  };

  // ── Fee calculation ───────────────────────────────────────────────────────
  function updateFeeSummary() {
    var govEl      = el('government-value');
    var government = govEl ? govEl.value : '';
    var orderType  = S.orderType || 'Deliver';
    var isExpress  = state.isExpress;

    var feeBaseEl    = el('co-fee-base-val');
    var feeExpressEl = el('co-fee-express-val');
    var feeExpressRow = el('co-fee-express-row');
    var feeTotEl     = el('co-fee-total-num');
    var spinnerEl    = el('feeLoadingSpinner');

    if (!government) {
      state.baseFee = 0;
      state.lastFee = 0;
      return;
    }

    if (spinnerEl) spinnerEl.style.display = '';

    // Fetch base (non-express) and express fees simultaneously
    var baseCall = fetch('/business/calculate-fees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ government: government, orderType: orderType, isExpressShipping: false }),
    }).then(function(r) { return r.json(); });

    var expressCall = isExpress
      ? fetch('/business/calculate-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ government: government, orderType: orderType, isExpressShipping: true }),
        }).then(function(r) { return r.json(); })
      : Promise.resolve(null);

    Promise.all([baseCall, expressCall])
      .then(function(results) {
        var baseFee    = (results[0] && results[0].fee != null) ? results[0].fee : 0;
        var expressFee = (results[1] && results[1].fee != null) ? results[1].fee : 0;
        var totalFee   = isExpress ? expressFee : baseFee;
        var expressAdd = isExpress ? (expressFee - baseFee) : 0;

        state.baseFee = baseFee;
        state.lastFee = totalFee;

        if (feeBaseEl)     feeBaseEl.textContent     = baseFee + ' ' + CUR;
        if (feeTotEl)      feeTotEl.textContent      = totalFee;
        if (feeExpressRow) feeExpressRow.style.display = isExpress ? '' : 'none';
        if (feeExpressEl && isExpress) feeExpressEl.textContent = '+' + expressAdd + ' ' + CUR;

        // Sidebar
        var sumFee = el('sum-fee-val');
        if (sumFee) sumFee.textContent = totalFee + ' ' + CUR;

        // Review step
        var revFeeNum = el('rev-fee-num');
        if (revFeeNum) revFeeNum.textContent = totalFee;
      })
      .catch(function(err) { console.error('eoFee error:', err); })
      .finally(function() {
        if (spinnerEl) spinnerEl.style.display = 'none';
      });
  }

  // ── Populate review step ──────────────────────────────────────────────────
  function populateReview() {
    var fn   = (el('fullName')          || {}).value || '—';
    var ph   = (el('phoneNumber')       || {}).value || '—';
    var gv   = (el('government-value')  || {}).value || '';
    var zv   = (el('zone-value')        || {}).value || '';
    var addr = (el('address')           || {}).value || '—';
    var area = zv && gv ? zv + ', ' + gv : (gv || zv || '—');

    var revCust = el('rev-customer'); if (revCust) revCust.textContent = fn;
    var revPh   = el('rev-phone');    if (revPh)   revPh.textContent   = ph;
    var revArea = el('rev-area');     if (revArea) revArea.textContent  = area;
    var revAddr = el('rev-address');  if (revAddr) revAddr.textContent  = addr;
    var revExp  = el('rev-express');  if (revExp)  revExp.textContent   = state.isExpress ? t('yes', 'Yes') : t('no', 'No');
    var revFee  = el('rev-fee-num');  if (revFee)  revFee.textContent   = state.lastFee;

    // Also update sidebar
    var sumCust = el('sum-customer'); if (sumCust) sumCust.textContent = fn;
    var sumPh   = el('sum-phone');    if (sumPh)   sumPh.textContent   = ph;
    var sumArea = el('sum-area');     if (sumArea) sumArea.textContent  = area;
  }

  // ── Area selection integration ────────────────────────────────────────────
  function onAreaSelected() {
    var govInput  = el('government-value');
    var zoneInput = el('zone-value');
    var areaBtn   = el('selectAreaBtn');
    var display   = el('selectedAreaDisplay');

    var gv  = govInput  ? govInput.value  : '';
    var zv  = zoneInput ? zoneInput.value : '';
    var txt = display ? display.textContent : (zv && gv ? zv + ', ' + gv : (gv || zv || ''));

    if (areaBtn) {
      areaBtn.classList.toggle('co-area-btn--filled', !!(zv || gv));
      if (zv || gv) {
        areaBtn.classList.remove('is-error');
        showFieldError('err-zone', false);
      }
    }

    // Update sidebar + review
    var sumArea = el('sum-area'); if (sumArea) sumArea.textContent = txt;
    var revArea = el('rev-area'); if (revArea) revArea.textContent = txt;

    updateFeeSummary();
  }

  function bindAreaListeners() {
    // area-selection-modal.js calls window.updateFees() after selection
    // Also listen for change events as fallback
    var govInput  = el('government-value');
    var zoneInput = el('zone-value');
    if (govInput)  govInput.addEventListener('change', onAreaSelected);
    if (zoneInput) zoneInput.addEventListener('change', onAreaSelected);
  }

  // Called by area-selection-modal.js after area is confirmed
  window.updateFees = function () { onAreaSelected(); };

  // ── Bind live customer field updates ─────────────────────────────────────
  function bindCustomerListeners() {
    function syncSidebar() {
      var fn  = (el('fullName')         || {}).value || '—';
      var ph  = (el('phoneNumber')      || {}).value || '—';
      var sc  = el('sum-customer'); if (sc) sc.textContent = fn;
      var sp  = el('sum-phone');    if (sp) sp.textContent = ph;
    }

    ['fullName','phoneNumber'].forEach(function(id) {
      var inp = el(id);
      if (!inp) return;
      inp.addEventListener('input', function () {
        setInputError(id, false);
        showFieldError('err-' + id, false);
        syncSidebar();
      });
    });

    var addr = el('address');
    if (addr) addr.addEventListener('input', function () {
      setInputError('address', false);
      showFieldError('err-address', false);
    });
  }

  // ── Form submission ───────────────────────────────────────────────────────
  function bindFormSubmit() {
    var form = el('editOrderForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.submitting) return;

      state.submitting = true;
      var updateBtn = el('updateOrderBtn');
      if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<span class="co-spinner"></span> ' + t('updating', 'Updating…');
      }

      var formData = new FormData(form);
      var payload  = {};
      formData.forEach(function (v, k) { payload[k] = v; });

      // Consolidate express and area from state / hidden inputs
      payload.isExpressShipping = state.isExpress ? 'true' : 'false';
      payload.government = (el('government-value') || {}).value || '';
      payload.zone       = (el('zone-value')       || {}).value || '';

      // Ensure orderType from hidden (not from disabled radio buttons)
      payload.orderType = S.orderType || payload.orderType || 'Deliver';

      var orderId = form.getAttribute('data-order-id');

      fetch('/business/orders/edit-order/' + orderId, {
        method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (res) {
          if (res.ok) {
          Swal.fire({
              icon:              'success',
              title:             t('swalUpdated', 'Order updated'),
              text:              t('swalUpdatedText', 'The order has been updated successfully.'),
            confirmButtonText: t('swalViewOrder', 'View order'),
              confirmButtonColor: '#2D3561',
          }).then(function (result) {
              if (result.isConfirmed && res.data && res.data.order && res.data.order.orderNumber) {
                window.location.href = '/business/order-details/' + res.data.order.orderNumber;
            } else {
              window.location.href = '/business/orders';
            }
          });
        } else {
          Swal.fire({
              icon:  'error',
              title: t('swalUpdateFailed', 'Update failed'),
              text:  (res.data && res.data.error) || t('swalUpdateFailedText', 'Failed to update the order.'),
              confirmButtonColor: '#F97316',
            });
          }
        })
        .catch(function (err) {
          console.error('editOrder submit error:', err);
          Swal.fire({
            icon:  'error',
            title: t('swalUpdateFailed', 'Update failed'),
            text:  t('swalUpdateFailedText', 'An error occurred while updating the order.'),
            confirmButtonColor: '#F97316',
          });
        })
        .finally(function () {
          state.submitting = false;
          if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.innerHTML = t('labelUpdateHtml', '<i class="ri-save-line"></i> Update Order');
          }
        });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Nav buttons
    var btnNext = el('co-btn-next');
    var btnBack = el('co-btn-back');
    if (btnNext) btnNext.addEventListener('click', goNext);
    if (btnBack) btnBack.addEventListener('click', goBack);

    // Area integration
    bindAreaListeners();
    bindCustomerListeners();

    // Form submit
    bindFormSubmit();

    // Initial fee calculation
    updateFeeSummary();

    // Set initial toggle states from server state
    setToggleCard(el('co-express-toggle'), state.isExpress);
    setToggleCard(el('co-cod-toggle'),     state.isCOD);
    setToggleCard(el('co-cd-toggle'),      state.isCD);

    // Initial step UI
    updateStepUI(1);
  });

})();
