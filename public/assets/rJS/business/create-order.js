/**
 * create-order.js — Redesigned 4-step wizard for creating orders.
 * Works with the redesigned create-order.ejs.
 */
(function () {
  'use strict';

  var CUR = (typeof window !== 'undefined' && window.__CO_CURRENCY) ? window.__CO_CURRENCY : 'EGP';

  // ── i18n ─────────────────────────────────────────────────────────────────
var __NSCO =
    typeof window !== 'undefined' &&
    window.__NS_BUSINESS_I18N &&
    window.__NS_BUSINESS_I18N.createOrder
    ? window.__NS_BUSINESS_I18N.createOrder
    : {};

  function t(key, fallback) {
    return (__NSCO[key] != null ? __NSCO[key] : fallback) || fallback || '';
  }

  function stepBadgeText(step, max) {
    var m = max != null ? max : 4;
    return t('stepOf', 'Step {cur} of {max}')
      .replace(/\{cur\}/g, String(step))
      .replace(/\{max\}/g, String(m));
  }

  function getStepMeta(step) {
    var table = {
      1: { kT: 'wizStep1Title', kS: 'wizStep1Sub', fT: 'Shipping Details', fS: 'Choose order type and configure delivery' },
      2: { kT: 'wizStep2Title', kS: 'wizStep2Sub', fT: 'Customer Details', fS: 'Enter the recipient\'s contact and location' },
      3: { kT: 'wizStep3Title', kS: 'wizStep3Sub', fT: 'Additional Options', fS: 'Add special instructions and review fees' },
      4: { kT: 'wizStep4Title', kS: 'wizStep4Sub', fT: 'Order Complete', fS: 'Your order has been placed successfully' },
    };
    var d = table[step] || table[1];
    return {
      title: t(d.kT, d.fT),
      subtitle: t(d.kS, d.fS),
    };
  }

  function getStepTip(step) {
    return t('wizTip' + step, [
      'Choose your order type and fill in the delivery details to continue.',
      'Accurate customer contact info ensures smooth delivery.',
      'Add special notes so our couriers know exactly what to do.',
      'Your order has been placed successfully!',
    ][step - 1] || '');
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    step: 1,
    orderType: null,         // 'Deliver' | 'Exchange' | 'Return'
    expressShipping: false,
    codEnabled: false,
    cashDiffEnabled: false,
    partialReturn: false,
    workAddress: false,
    canOpenPackage: false,
    numItems: 1,
    baseFee: 0,
    lastFee: 0,
    submitting: false,
    returnOrderCheck: { status: 'idle', orderNumber: '', itemCount: 0, hasMultiple: false },
    originalOrderDebounce: null,
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }

  function setCollapsible(id, open) {
    var c = el(id);
    if (!c) return;
    if (open) {
      c.classList.add('co-collapsible--open');
    } else {
      c.classList.remove('co-collapsible--open');
    }
  }

  function setToggleCard(btn, on) {
    if (!btn) return;
    if (on) {
      btn.classList.add('co-toggle-card--on');
        } else {
      btn.classList.remove('co-toggle-card--on');
    }
  }

  function setCheckCard(btn, on) {
    if (!btn) return;
    if (on) {
      btn.classList.add('co-check-card--on');
            } else {
      btn.classList.remove('co-check-card--on');
    }
  }

  function showFieldError(id, show) {
    var e = el(id);
    if (!e) return;
    if (show) {
      e.classList.add('co-field-error--show');
    } else {
      e.classList.remove('co-field-error--show');
    }
  }

  function setInputError(inputId, isError) {
    var i = el(inputId);
    if (!i) return;
    if (isError) {
      i.classList.add('is-error');
    } else {
      i.classList.remove('is-error');
    }
  }

  function setFieldTextContent(id, text) {
    var n = el(id);
    if (n) n.textContent = text || '';
  }

  function setOriginalOrderHint(kind, message) {
    var h = el('co-original-order-ok');
    if (!h) return;
    h.textContent = message || '';
    h.className = 'co-field-hint';
    if (kind === 'ok') {
      h.classList.add('co-field-hint--show', 'co-field-hint--ok');
    } else if (kind === 'load') {
      h.classList.add('co-field-hint--show', 'co-field-hint--muted');
    } else {
      h.classList.remove('co-field-hint--show', 'co-field-hint--ok', 'co-field-hint--muted');
    }
  }

  function syncProductFieldNames() {
    var d = el('productDescription');
    var r = el('returnProductDescription');
    if (d) d.removeAttribute('name');
    if (r) r.removeAttribute('name');
    if (state.orderType === 'Return' && r) {
      r.setAttribute('name', 'productDescription');
    } else if (d && (state.orderType === 'Deliver' || !state.orderType)) {
      d.setAttribute('name', 'productDescription');
    }
  }

  function resetReturnOrderCheckUI() {
    state.returnOrderCheck = { status: 'idle', orderNumber: '', itemCount: 0, hasMultiple: false };
    setOriginalOrderHint('hide', '');
    var oic = el('originalOrderItemCount');
    if (oic) oic.value = '';
    var prBlock = el('co-partial-return-block');
    if (prBlock) prBlock.style.display = 'none';
    if (state.partialReturn) {
      state.partialReturn = false;
      setToggleCard(el('co-partial-return-toggle'), false);
      var ir = el('isPartialReturn-input');
      if (ir) ir.value = '';
      setCollapsible('co-partial-return-wrap', false);
    }
    var prInp = el('partialReturnItemCount');
    var prDisp = el('co-pr-display');
    if (prInp) prInp.value = '1';
    if (prDisp) prDisp.textContent = '1';
  }

  function applyReturnItemCountsFromCheck() {
    if (state.returnOrderCheck.status !== 'ok') return;
    var ic = state.returnOrderCheck.itemCount;
    var oic = el('originalOrderItemCount');
    if (oic) oic.value = String(ic);
    if (!state.partialReturn) {
      var ni = el('numberOfItems');
      if (ni) ni.value = String(ic);
      state.numItems = ic;
      var disp = el('co-num-display');
      var lbl = el('co-num-label');
      if (disp) disp.textContent = String(ic);
      if (lbl) lbl.textContent = ic === 1 ? t('itemSingular', 'item') : t('itemPlural', 'items');
    }
  }

  function updatePartialReturnBlockVisibility() {
    var prBlock = el('co-partial-return-block');
    if (!prBlock) return;
    if (state.orderType === 'Return' && state.returnOrderCheck.status === 'ok' && state.returnOrderCheck.hasMultiple) {
      prBlock.style.display = '';
    } else {
      prBlock.style.display = 'none';
    }
  }

  function mapValidateOriginalError(data, status) {
    var err = (data && (data.error || data.message)) || '';
    var low = String(err).toLowerCase();
    if (status === 400 && low.indexOf('already') !== -1) {
      return t('returnOriginalAlreadyReturned', 'A return is already linked to this order.');
    }
    if (status === 404 && (low.indexOf('not eligible') !== -1 || low.indexOf('order found but') !== -1)) {
      return t('returnOriginalNotEligible', 'This order cannot be returned. Only completed delivery orders are eligible.');
    }
    if (data && data.message && String(data.message).indexOf('Only completed') !== -1) {
      return t('returnOriginalNotEligible', 'This order cannot be returned. Only completed delivery orders are eligible.');
    }
    if (status === 404) {
      return t('returnOriginalNotFound', 'No matching delivered order for your business, or the number is wrong.');
    }
    return t('returnOriginalNotFound', 'No matching delivered order for your business, or the number is wrong.');
  }

  function runValidateOriginalOrder(callback) {
    var inp = el('originalOrderNumber');
    if (!inp) { if (callback) callback(false); return; }
    var raw = inp.value.trim();
    if (!raw) {
      setInputError('originalOrderNumber', true);
      showFieldError('err-originalOrderNumber', true);
      if (callback) callback(false);
      return;
    }

    setInputError('originalOrderNumber', false);
    showFieldError('err-originalOrderNumber', false);
    setFieldTextContent('err-originalOrderNumber', t('errOriginalOrderEmpty', 'Please enter the original order number.'));
    setOriginalOrderHint('load', t('returnOriginalValidating', 'Verifying order number…'));
    state.returnOrderCheck = { status: 'loading', orderNumber: raw, itemCount: 0, hasMultiple: false };

    fetch('/business/validate-original-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ orderNumber: raw }),
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      })
      .then(function (res) {
        if (res.ok && res.data && res.data.success && res.data.order) {
          var ord = res.data.order;
          var ic = ord.itemCount != null ? ord.itemCount : (ord.orderShipping && ord.orderShipping.numberOfItems) || 1;
          var hm = ord.hasMultipleItems;
          if (typeof hm === 'undefined' || hm === null) {
            hm = Number(ic) > 1;
          }
          state.returnOrderCheck = {
            status: 'ok',
            orderNumber: raw,
            itemCount: Math.max(1, parseInt(String(ic), 10) || 1),
            hasMultiple: !!hm,
          };
          if (!state.returnOrderCheck.hasMultiple && state.partialReturn) {
            state.partialReturn = false;
            setToggleCard(el('co-partial-return-toggle'), false);
            var ir0 = el('isPartialReturn-input');
            if (ir0) ir0.value = '';
            setCollapsible('co-partial-return-wrap', false);
            var pInp0 = el('partialReturnItemCount');
            var pD0 = el('co-pr-display');
            if (pInp0) pInp0.value = '1';
            if (pD0) pD0.textContent = '1';
          }
          setOriginalOrderHint('ok', t('returnOriginalOk', 'Order found — {count} item(s) in the original order. You can continue.').replace(/\{count\}/g, String(state.returnOrderCheck.itemCount)));
          applyReturnItemCountsFromCheck();
          updatePartialReturnBlockVisibility();
          if (state.partialReturn && state.returnOrderCheck.hasMultiple) {
            clampPartialReturnCount();
          }
          if (callback) callback(true);
        } else {
          state.returnOrderCheck = { status: 'err', orderNumber: raw, itemCount: 0, hasMultiple: false };
          setOriginalOrderHint('hide', '');
          var msg = mapValidateOriginalError(res.data, res.status);
          setFieldTextContent('err-originalOrderNumber', msg);
          showFieldError('err-originalOrderNumber', true);
          setInputError('originalOrderNumber', true);
          var prB = el('co-partial-return-block');
          if (prB) prB.style.display = 'none';
          if (callback) callback(false);
        }
      })
      .catch(function () {
        state.returnOrderCheck = { status: 'err', orderNumber: raw, itemCount: 0, hasMultiple: false };
        setOriginalOrderHint('hide', '');
        setFieldTextContent('err-originalOrderNumber', t('jsCreateErrorNetwork', 'An error occurred. Please try again.'));
        showFieldError('err-originalOrderNumber', true);
        setInputError('originalOrderNumber', true);
        if (callback) callback(false);
      });
  }

  function currentOriginalOrderNumberMatches() {
    var raw = (el('originalOrderNumber') && el('originalOrderNumber').value || '').trim();
    return state.returnOrderCheck && state.returnOrderCheck.status === 'ok' && state.returnOrderCheck.orderNumber === raw;
  }

  function clampPartialReturnCount() {
    if (state.returnOrderCheck.status !== 'ok' || !state.returnOrderCheck.hasMultiple) return;
    var maxP = state.returnOrderCheck.itemCount - 1;
    if (maxP < 1) maxP = 1;
    var pInp = el('partialReturnItemCount');
    var pD = el('co-pr-display');
    if (!pInp) return;
    var n = parseInt(pInp.value, 10) || 1;
    n = Math.max(1, Math.min(maxP, n));
    pInp.value = String(n);
    if (pD) pD.textContent = String(n);
  }

  // ── Step Indicator Update ─────────────────────────────────────────────────
  function updateStepUI(step) {
    // Title / subtitle / badge
    var meta = getStepMeta(step);
    var titleEl = el('co-step-title');
    var subEl   = el('co-step-subtitle');
    var badgeEl = el('co-step-badge');
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl)   subEl.textContent   = meta.subtitle;
    if (badgeEl) badgeEl.textContent = stepBadgeText(step, 4);

    // Progress bar
    var fill = el('co-progress-fill');
    if (fill) fill.style.width = ((step - 1) / 3 * 100) + '%';

    // Nodes + labels
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

    // Tip
    var tip = el('co-tip-text');
    if (tip) tip.textContent = getStepTip(step) || '';

    // Show/hide nav footer
    var footer = el('co-nav-footer');
    if (footer) footer.style.display = step === 4 ? 'none' : '';

    // Back button
    var btnBack = el('co-btn-back');
    if (btnBack) btnBack.disabled = step === 1;

    // Next button label
    var btnNext = el('co-btn-next');
    if (btnNext) {
      if (step === 3) {
        btnNext.innerHTML = t('labelPlaceOrder', 'Place Order') + ' <i class="ri-check-line" aria-hidden="true"></i>';
        btnNext.classList.add('co-btn-next--place');
      } else {
        btnNext.innerHTML = t('labelContinue', 'Continue') + ' <i class="ri-arrow-right-s-line co-btn-next__chev" aria-hidden="true"></i>';
        btnNext.classList.remove('co-btn-next--place');
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
      if (i === step) {
        panel.classList.add('step-panel--active');
      } else {
        panel.classList.remove('step-panel--active');
      }
    }
    state.step = step;
    updateStepUI(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validateStep(step) {
    var ok = true;

    if (step === 1) {
      if (!state.orderType) {
        Swal.fire({
          icon: 'warning',
          title: t('selectOrderTypeTitle', 'Select order type'),
          text: t('errSelectOrderType', 'Please select an order type to continue.'),
          confirmButtonColor: '#F97316',
        });
        return false;
      }

      if (state.orderType === 'Deliver') {
        var pd = el('productDescription');
        if (!pd || !pd.value.trim()) {
          setInputError('productDescription', true);
          showFieldError('err-productDescription', true);
          if (pd) pd.focus();
          ok = false;
        }
      }

      if (state.orderType === 'Return') {
        var rpd = el('returnProductDescription');
        if (!rpd || !rpd.value.trim()) {
          setInputError('returnProductDescription', true);
          showFieldError('err-returnProductDescription', true);
          ok = false;
        }
        var origNum = el('originalOrderNumber');
        var reason  = el('returnReason');
        if (!origNum || !origNum.value.trim()) {
          setInputError('originalOrderNumber', true);
          showFieldError('err-originalOrderNumber', true);
          ok = false;
        }
        if (!reason || !reason.value.trim()) {
          setInputError('returnReason', true);
          showFieldError('err-returnReason', true);
          ok = false;
        }
        if (ok && state.returnOrderCheck.status === 'ok' && state.partialReturn && state.returnOrderCheck.hasMultiple) {
          var pr = parseInt((el('partialReturnItemCount') || {}).value, 10) || 0;
          var maxP = state.returnOrderCheck.itemCount - 1;
          if (maxP < 1) maxP = 1;
          if (!Number.isFinite(pr) || pr < 1 || pr > maxP) {
            Swal.fire({
              icon: 'warning',
              title: t('jsInvalidValue', 'Invalid value'),
              text: t('returnPartialCountInvalid', 'For a partial return, choose how many items to return (1 to {max}).').replace(/\{max\}/g, String(maxP)),
              confirmButtonColor: '#F97316',
            });
            ok = false;
          }
        }
        if (!ok && rpd && !rpd.value.trim()) rpd.focus();
        else if (!ok && origNum) origNum.focus();
      }

      if (state.orderType === 'Exchange') {
        var cur = el('currentPD'); var nw = el('newPD');
        if (!cur || !cur.value.trim()) { setInputError('currentPD', true); ok = false; }
        if (!nw  || !nw.value.trim())  { setInputError('newPD',    true); ok = false; }
        if (!ok && cur) cur.focus();
      }

      if (state.orderType === 'Return') {
        var pcR = typeof window !== 'undefined' && window.__CO_PICKUP_ADDR_COUNT != null
          ? Number(window.__CO_PICKUP_ADDR_COUNT) : 0;
        if (pcR < 1) {
          Swal.fire({
            icon: 'warning',
            title: t('expressPickupRequiredTitle', 'Pickup address required'),
            text: t('businessPickupNoAddress', 'Add a business pickup address in Settings before creating a return.'),
            confirmButtonColor: '#F97316',
          });
          ok = false;
        } else {
          ensureDefaultPickupSelection();
          var pSelR = el('selectedPickupAddressId');
          if (pSelR && pSelR.tagName === 'SELECT' && !pSelR.value) {
            pSelR.classList.add('is-error');
            var erR = el('err-selectedPickup');
            if (erR) erR.classList.add('co-field-error--show');
            ok = false;
            pSelR.focus();
          }
        }
      }

      if (state.orderType === 'Deliver' && state.expressShipping) {
        var pc = typeof window !== 'undefined' && window.__CO_PICKUP_ADDR_COUNT != null
          ? Number(window.__CO_PICKUP_ADDR_COUNT) : 0;
        if (pc < 1) {
          Swal.fire({
            icon: 'warning',
            title: t('expressPickupRequiredTitle', 'Pickup address required'),
            text: t('expressNoPickupAddress', 'Add a business pickup address in Settings before using express shipping.'),
            confirmButtonColor: '#F97316',
          });
          ok = false;
        } else {
          ensureDefaultPickupSelection();
          var pSel = el('selectedPickupAddressId');
          if (pSel && pSel.tagName === 'SELECT' && !pSel.value) {
            pSel.classList.add('is-error');
            var ep = el('err-selectedPickup');
            if (ep) ep.classList.add('co-field-error--show');
            ok = false;
            pSel.focus();
          }
        }
      }
    }

    if (step === 2) {
      var fn = el('fullName');   var ph = el('phoneNumber');
      var gv = el('government-value'); var zn = el('zone-value');
      var addr = el('address');

      if (!fn || !fn.value.trim()) {
        setInputError('fullName', true); showFieldError('err-fullName', true); ok = false;
      }
      if (!ph || !ph.value.trim()) {
        setInputError('phoneNumber', true); showFieldError('err-phoneNumber', true); ok = false;
      }
      if (!gv || !gv.value || !zn || !zn.value) {
        var btn = el('selectAreaBtn');
        if (btn) btn.classList.add('is-error');
        showFieldError('err-zone', true); ok = false;
      }
      if (!addr || !addr.value.trim()) {
        setInputError('address', true); showFieldError('err-address', true); ok = false;
      }
      if (!ok && fn && !fn.value.trim()) fn.focus();
    }

    return ok;
  }

  function clearValidationErrors() {
    var ids = [
      'productDescription','returnProductDescription','originalOrderNumber','returnReason','currentPD','newPD',
      'fullName','phoneNumber','address',
    ];
    ids.forEach(function(id) {
      setInputError(id, false);
    });
    setFieldTextContent('err-originalOrderNumber', t('errOriginalOrderEmpty', 'Please enter the original order number.'));
    [
      'err-productDescription','err-originalOrderNumber','err-returnReason','err-returnProductDescription',
      'err-fullName','err-phoneNumber','err-zone','err-address','err-selectedPickup',
    ].forEach(function(id) { showFieldError(id, false); });
    var pSel2 = el('selectedPickupAddressId');
    if (pSel2) pSel2.classList.remove('is-error');
    var btn = el('selectAreaBtn');
    if (btn) btn.classList.remove('is-error');
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    if (state.submitting) return;
    if (!validateStep(state.step)) return;

    if (state.step === 1 && state.orderType === 'Return') {
      if (state.returnOrderCheck.status === 'loading') {
        Swal.fire({
          icon: 'info',
          title: t('jsMissingInfo', 'Missing information'),
          text: t('returnOriginalValidating', 'Verifying order number…'),
          confirmButtonColor: '#F97316',
        });
        return;
      }
      if (currentOriginalOrderNumberMatches()) {
        if (!validateStep(1)) return;
        clearValidationErrors();
        showStep(2);
        updateSummary();
        return;
      }
      var onum = (el('originalOrderNumber') && el('originalOrderNumber').value || '').trim();
      if (onum) {
        runValidateOriginalOrder(function (vok) {
          if (!vok) return;
          if (!validateStep(1)) return;
          clearValidationErrors();
          showStep(2);
          updateSummary();
        });
        return;
      }
    }

    clearValidationErrors();

    if (state.step === 3) {
      submitOrder();
      return;
    }

    showStep(state.step + 1);
    updateSummary();
  }

  function goBack() {
    if (state.step <= 1) return;
    clearValidationErrors();
    showStep(state.step - 1);
  }

  // ── Order type selection ──────────────────────────────────────────────────
  window.coSelectOrderType = function (type, btn) {
    state.orderType = type;
    el('orderTypeInput').value = type;

    // Update cards
    ['deliver','exchange','return'].forEach(function(t) {
      var card = el('co-type-' + t);
      if (card) card.classList.remove('co-type-card--selected');
    });
    if (btn) btn.classList.add('co-type-card--selected');

    // Show the details section
    setCollapsible('co-delivery-details', true);

    ['deliver','exchange','return'].forEach(function(t) {
      var sec = el('co-section-' + t);
      if (sec) sec.classList.remove('co-type-section--active');
    });

    var key = type.toLowerCase();
    var targetSec = el('co-section-' + key);
    if (targetSec) targetSec.classList.add('co-type-section--active');

    resetReturnOrderCheckUI();
    syncProductFieldNames();

    if (type !== 'Deliver') {
      state.expressShipping = false;
    }
    syncExpressToggle();
    updatePartialReturnBlockVisibility();
    updateBusinessPickupVisibility();
    updateSummary();
  };

  // ── Toggle helpers ────────────────────────────────────────────────────────
  window.coToggleCard = function (btn, hiddenInputName, btnId) {
    var isOn = btn.classList.contains('co-toggle-card--on');
    setToggleCard(btn, !isOn);

    if (hiddenInputName) {
      var inp = qs('input[name="' + hiddenInputName + '"]');
      if (inp) inp.value = !isOn ? 'on' : '';
    }

    if (btnId === 'co-express-toggle') {
      var n = typeof window !== 'undefined' && window.__CO_PICKUP_ADDR_COUNT != null
        ? Number(window.__CO_PICKUP_ADDR_COUNT) : 0;
      if (!isOn && n < 1) {
        setToggleCard(btn, false);
        state.expressShipping = false;
        Swal.fire({
          icon: 'info',
          title: t('expressPickupRequiredTitle', 'Pickup address required'),
          text: t('expressNoPickupAddress', 'Add a business pickup address in Settings before using express shipping.'),
          confirmButtonColor: '#2D3561',
        });
        syncExpressToggle();
        return;
      }
      state.expressShipping = !isOn;
      syncExpressToggle();
      updateFeeSummary();
      updateSummary();
    }
    if (btnId === 'co-open-pkg-toggle') {
      state.canOpenPackage = !isOn;
    }
  };

  function ensureDefaultPickupSelection() {
    var sel = el('selectedPickupAddressId');
    if (!sel || sel.tagName !== 'SELECT') return;
    if (sel.value) return;
    var defOpt = sel.querySelector('option[data-co-default="1"]');
    if (defOpt && defOpt.value) {
      sel.value = defOpt.value;
      return;
    }
    var first = sel.querySelector('option[value]:not([value=""])');
    if (first) sel.value = first.value;
  }

  /** Business pickup / return-to-business — Deliver, Exchange, Return. */
  function updateBusinessPickupVisibility() {
    var wrap = el('co-business-pickup-wrap');
    if (!wrap) return;
    var t = state.orderType;
    var show = t === 'Deliver' || t === 'Exchange' || t === 'Return';
    if (show) {
      wrap.classList.add('co-collapsible--open');
      wrap.style.removeProperty('display');
      ensureDefaultPickupSelection();
    } else {
      wrap.classList.remove('co-collapsible--open');
      wrap.style.display = 'none';
    }
    var reqStar = el('co-business-pickup-required');
    if (reqStar) {
      reqStar.style.display =
        t === 'Return' || (t === 'Deliver' && state.expressShipping) ? '' : 'none';
    }
    var err = el('err-selectedPickup');
    if (err) {
      err.classList.remove('co-field-error--show');
    }
    var sel = el('selectedPickupAddressId');
    if (sel) sel.classList.remove('is-error');
  }

  function syncExpressToggle() {
    var inp = el('isExpressShipping-input');
    if (inp) inp.value = state.expressShipping ? 'on' : '';
    // Deliver only — exchange no longer has a separate express control
    setToggleCard(el('co-express-toggle'), state.expressShipping);
    updateBusinessPickupVisibility();
  }

  window.coToggleCOD = function () {
    state.codEnabled = !state.codEnabled;
    setToggleCard(el('co-cod-toggle'), state.codEnabled);
    var inp = el('COD-input');
    if (inp) inp.value = state.codEnabled ? 'on' : '';
    setCollapsible('co-cod-amount-wrap', state.codEnabled);
    updateFeeSummary();
    updateSummary();
  };

  window.coToggleCD = function () {
    state.cashDiffEnabled = !state.cashDiffEnabled;
    setToggleCard(el('co-cd-toggle'), state.cashDiffEnabled);
    var inp = el('CashDifference-input');
    if (inp) inp.value = state.cashDiffEnabled ? 'on' : '';
    setCollapsible('co-cd-amount-wrap', state.cashDiffEnabled);
    updateFeeSummary();
    updateSummary();
  };

  window.coToggleWorkAddress = function () {
    state.workAddress = !state.workAddress;
    setCheckCard(el('co-work-addr-toggle'), state.workAddress);
    var inp = el('deliverToWorkAddress-input');
    if (inp) inp.value = state.workAddress ? 'on' : '';
  };

  window.coTogglePartialReturn = function () {
    if (state.orderType === 'Return' && state.returnOrderCheck.status === 'ok' && !state.returnOrderCheck.hasMultiple) {
      return;
    }
    state.partialReturn = !state.partialReturn;
    setToggleCard(el('co-partial-return-toggle'), state.partialReturn);
    var inp = el('isPartialReturn-input');
    if (inp) inp.value = state.partialReturn ? 'true' : '';
    setCollapsible('co-partial-return-wrap', state.partialReturn);
    if (state.orderType === 'Return' && state.returnOrderCheck.status === 'ok') {
      if (state.partialReturn) {
        clampPartialReturnCount();
        var prI = el('partialReturnItemCount');
        var prN = prI ? (parseInt(prI.value, 10) || 1) : 1;
        var nio = el('numberOfItems');
        if (nio) nio.value = String(prN);
        state.numItems = prN;
      } else {
        applyReturnItemCountsFromCheck();
      }
    }
  };

  // ── Item counter ──────────────────────────────────────────────────────────
  function setupMainCounter() {
    var dec = el('co-decrement');
    var inc = el('co-increment');
    if (dec) dec.addEventListener('click', function () {
      state.numItems = Math.max(1, state.numItems - 1);
      updateMainCounter();
    });
    if (inc) inc.addEventListener('click', function () {
      state.numItems += 1;
      updateMainCounter();
    });
  }

  function updateMainCounter() {
    var disp = el('co-num-display');
    var lbl  = el('co-num-label');
    var inp  = el('numberOfItems');
    if (disp) disp.textContent = state.numItems;
    if (lbl)  lbl.textContent  = state.numItems === 1 ? t('itemSingular', 'item') : t('itemPlural', 'items');
    if (inp)  inp.value        = state.numItems;
    updateSummary();
  }

  window.coAdjustCounter = function (inputId, displayId, delta) {
    var inp  = el(inputId);
    var disp = el(displayId);
    if (!inp) return;
    var base = (parseInt(inp.value) || 1) + delta;
    var val;
    if (inputId === 'partialReturnItemCount' && state.orderType === 'Return' && state.returnOrderCheck.status === 'ok' && state.returnOrderCheck.hasMultiple) {
      var maxP = Math.max(1, state.returnOrderCheck.itemCount - 1);
      val = Math.max(1, Math.min(maxP, base));
    } else {
      val = Math.max(1, base);
    }
    inp.value = val;
    if (disp) disp.textContent = val;
    if (inputId === 'partialReturnItemCount' && state.orderType === 'Return' && state.returnOrderCheck.status === 'ok' && state.partialReturn) {
      var nio2 = el('numberOfItems');
      if (nio2) nio2.value = String(val);
      state.numItems = val;
    }
  };

  // ── Fee calculation ───────────────────────────────────────────────────────
  // Always fetch both base fee (no express) and optionally express fee,
  // then display them as separate line items.
  function updateFeeSummary() {
    var government = (el('government-value') || {}).value || '';
    var orderType  = state.orderType || '';
    var isExpress  = state.expressShipping;

    if (!government || !orderType) {
      state.baseFee = 0;
      state.lastFee = 0;
      el('co-fee-base-val') && (el('co-fee-base-val').textContent = '—');
      el('co-fee-total-num') && (el('co-fee-total-num').textContent = '0');
      var er = el('co-fee-express-row');
      if (er) er.style.display = 'none';
      updateSummary();
      return;
    }

    // Fetch base fee (without express)
    var baseCall = fetch('/business/calculate-fees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ government: government, orderType: orderType, isExpressShipping: false }),
    }).then(function(r) { return r.json(); });

    // If express selected, also fetch express fee
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

        // Step 3 fee card
        var bv  = el('co-fee-base-val');
        var ev  = el('co-fee-express-val');
        var tv  = el('co-fee-total-num');
        var eRow = el('co-fee-express-row');

        if (bv)   bv.textContent  = baseFee + ' ' + CUR;
        if (tv)   tv.textContent  = totalFee;
        if (eRow) eRow.style.display = isExpress ? '' : 'none';
        if (ev && isExpress) ev.textContent = '+' + expressAdd + ' ' + CUR;

        updateSummary();
      })
      .catch(function(err) { console.error('fee calc error:', err); });
  }

  // ── Order Summary sidebar update ──────────────────────────────────────────
  function updateSummary() {
    var typeEl = el('sum-type');
    if (typeEl) {
      if (state.orderType) {
        var dMap = { Deliver: t('displayDeliver', 'Delivery'), Exchange: t('displayExchange', 'Exchange'), Return: t('displayReturn', 'Return') };
        typeEl.textContent = dMap[state.orderType] || state.orderType;
        typeEl.classList.remove('co-sum-row__value--empty');
      } else {
        typeEl.textContent = '—';
        typeEl.classList.add('co-sum-row__value--empty');
      }
    }

    // Product
    var pdVal = '';
    if (state.orderType === 'Deliver') pdVal = (el('productDescription') || {}).value || '';
    if (state.orderType === 'Exchange') pdVal = (el('currentPD') || {}).value || '';
    var prodRow = el('sum-product-row');
    var prodEl  = el('sum-product');
    if (prodRow) prodRow.style.display = (state.orderType === 'Deliver' || state.orderType === 'Exchange') ? '' : 'none';
    if (prodEl)  prodEl.textContent = pdVal || '—';

    // Customer
    var fn = ((el('fullName') || {}).value || '').trim();
    var ph = ((el('phoneNumber') || {}).value || '').trim();
    var gv = ((el('government-value') || {}).value || '').trim();
    var zv = ((el('zone-value') || {}).value || '').trim();
    var areaStr = zv && gv ? zv + ', ' + gv : (gv || zv || '');

    var custRow = el('sum-customer-row'); var custEl = el('sum-customer');
    var phoneRow = el('sum-phone-row');   var phoneEl = el('sum-phone');
    var areaRow  = el('sum-area-row');    var areaEl  = el('sum-area');

    if (custRow) custRow.style.display = fn ? '' : 'none';
    if (custEl)  custEl.textContent    = fn || '—';
    if (phoneRow) phoneRow.style.display = ph ? '' : 'none';
    if (phoneEl)  phoneEl.textContent    = ph || '—';
    if (areaRow)  areaRow.style.display  = areaStr ? '' : 'none';
    if (areaEl)   areaEl.textContent     = areaStr || '—';

    // Fee rows in sidebar
    var baseFee  = state.baseFee  || 0;
    var totalFee = state.lastFee  || 0;
    var isExpress = state.expressShipping;
    var expressAdd = isExpress ? (totalFee - baseFee) : 0;

    var dRow   = el('sum-fee-delivery-row'); var dEl  = el('sum-fee-delivery');
    var eRow   = el('sum-fee-express-row');  var eEl  = el('sum-fee-express-val');
    var tot    = el('sum-fee-total-row');    var totEl = el('sum-fee-total');

    if (state.orderType) {
      if (dRow)  dRow.style.display  = '';
      if (dEl)   dEl.textContent     = baseFee + ' ' + CUR;
      if (eRow)  eRow.style.display  = isExpress ? '' : 'none';
      if (eEl && isExpress) eEl.textContent = '+' + expressAdd + ' ' + CUR;
      if (tot)   tot.style.display   = '';
      if (totEl) totEl.textContent   = totalFee + ' ' + CUR;
            } else {
      if (dRow)  dRow.style.display  = 'none';
      if (eRow)  eRow.style.display  = 'none';
      if (tot)   tot.style.display   = 'none';
    }
  }

  // ── Area selection integration ────────────────────────────────────────────
  function onAreaSelected() {
    var govInput  = el('government-value');
    var zoneInput = el('zone-value');
    var areaBtn   = el('selectAreaBtn');

    var gv = govInput  ? govInput.value  : '';
    var zv = zoneInput ? zoneInput.value : '';

    if (zv || gv) {
      if (areaBtn) {
        areaBtn.classList.add('co-area-btn--filled');
        areaBtn.classList.remove('is-error');
      }
      showFieldError('err-zone', false);
    }

    updateFeeSummary();
    updateSummary();
  }

  function bindAreaListeners() {
    // area-selection-modal.js calls window.updateFees() after selection
    // We also listen for change events as a fallback
    var govInput  = el('government-value');
    var zoneInput = el('zone-value');
    if (govInput)  govInput.addEventListener('change', onAreaSelected);
    if (zoneInput) zoneInput.addEventListener('change', onAreaSelected);
  }

  // Called by area-selection-modal.js after area is confirmed
  window.updateFees = function () { onAreaSelected(); };

  // ── Listen on step 2 fields for live summary update ───────────────────────
  function bindStep2Listeners() {
    ['fullName','phoneNumber'].forEach(function(id) {
      var inp = el(id);
      if (inp) inp.addEventListener('input', function () {
        setInputError(id, false);
        showFieldError('err-' + id, false);
        updateSummary();
      });
    });

    var addr = el('address');
    if (addr) addr.addEventListener('input', function () {
      setInputError('address', false);
      showFieldError('err-address', false);
    });

    var pd = el('productDescription');
    if (pd) pd.addEventListener('input', function () {
      setInputError('productDescription', false);
      showFieldError('err-productDescription', false);
      updateSummary();
    });
  }

  // ── Form submission ───────────────────────────────────────────────────────
  function submitOrder() {
    if (state.submitting) return;

    var form = el('createOrderForm');
    if (!form) return;

    state.submitting = true;
    var btnNext = el('co-btn-next');
    if (btnNext) {
      btnNext.disabled = true;
      btnNext.innerHTML = '<span class="co-spinner"></span> ' + t('jsProcessing', 'Processing…');
    }

    var formData = new FormData(form);
    var payload  = Object.fromEntries ? Object.fromEntries(formData.entries()) : {};
    if (!Object.fromEntries) {
      formData.forEach(function(v, k) { payload[k] = v; });
    }

    // Consolidate express from active section
    payload.isExpressShipping = state.expressShipping ? 'on' : '';
    payload.government = (el('government-value') || {}).value || '';
    payload.zone       = (el('zone-value') || {}).value || '';

    fetch('/business/submit-order', {
                method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok && res.data && res.data.order) {
          // Populate step 4 success view
          var order = res.data.order;
          var orderNum = el('co-success-order-num');
          if (orderNum) orderNum.textContent = order.orderNumber || '—';
          var rtEl = el('co-result-type');
          if (rtEl) rtEl.textContent = state.orderType || '—';
          var rcEl = el('co-result-customer');
          if (rcEl) rcEl.textContent = order.orderCustomer ? order.orderCustomer.fullName : '—';
          var rpEl = el('co-result-phone');
          if (rpEl) rpEl.textContent = order.orderCustomer ? order.orderCustomer.phoneNumber : '—';
          var raEl = el('co-result-area');
          var zv = (el('zone-value') || {}).value || '';
          var gv = (el('government-value') || {}).value || '';
          if (raEl) raEl.textContent = zv && gv ? zv + ', ' + gv : (gv || zv || '—');
          var rfEl = el('co-result-fee');
          if (rfEl) rfEl.textContent = (order.orderFees || state.lastFee || 0) + ' ' + CUR;

          showStep(4);
                } else {
                    Swal.fire({
                        icon: 'error',
            title: t('jsErrorTitle', 'Error'),
            text: (res.data && res.data.error) || t('createFailed', 'Failed to create order. Please try again.'),
            confirmButtonColor: '#F97316',
          });
        }
      })
      .catch(function (err) {
        console.error('submitOrder error:', err);
            Swal.fire({
                icon: 'error',
          title: t('jsErrorTitle', 'Error'),
          text: t('jsCreateErrorNetwork', 'An error occurred while creating the order. Please try again.'),
          confirmButtonColor: '#F97316',
        });
      })
      .finally(function () {
        state.submitting = false;
        if (btnNext) {
          btnNext.disabled = false;
          btnNext.innerHTML = t('labelPlaceOrder', 'Place Order') + ' <i class="ri-check-line" aria-hidden="true"></i>';
        }
      });
  }

  // ── Reset for "Create New Order" ─────────────────────────────────────────
  function resetForm() {
    var form = el('createOrderForm');
    if (form) form.reset();

    state.orderType       = null;
    state.expressShipping = false;
    state.codEnabled      = false;
    state.cashDiffEnabled = false;
    state.partialReturn   = false;
    state.workAddress     = false;
    state.canOpenPackage  = false;
    state.numItems        = 1;
    state.baseFee         = 0;
    state.lastFee         = 0;
    resetReturnOrderCheckUI();

    // Deselect type cards
    ['deliver','exchange','return'].forEach(function(t) {
      var c = el('co-type-' + t);
      if (c) c.classList.remove('co-type-card--selected');
    });

    // Close collapsibles
    setCollapsible('co-delivery-details', false);
    setCollapsible('co-cod-amount-wrap', false);
    setCollapsible('co-cd-amount-wrap', false);
    setCollapsible('co-partial-return-wrap', false);

    // Reset toggles
    [
      'co-express-toggle','co-cod-toggle',
      'co-cd-toggle','co-partial-return-toggle',
    ].forEach(function(id) { setToggleCard(el(id), false); });
    setCheckCard(el('co-work-addr-toggle'), false);
    setToggleCard(el('co-open-pkg-toggle'), false);

    // Clear hidden inputs
    ['orderTypeInput','COD-input','isExpressShipping-input','CashDifference-input',
     'isPartialReturn-input','deliverToWorkAddress-input','previewPermission-input',
     'government-value','zone-value',
    ].forEach(function(id) { var i = el(id); if (i) i.value = ''; });
    el('numberOfItems').value = 1;
    updateMainCounter();
    var pSelR = el('selectedPickupAddressId');
    if (pSelR && pSelR.tagName === 'SELECT') {
      pSelR.selectedIndex = 0;
    }
    updateBusinessPickupVisibility();
    updatePartialReturnBlockVisibility();

    // Reset area button
    var areaBtn = el('selectAreaBtn');
    var areaDisp = el('selectedAreaDisplay');
    if (areaBtn)  { areaBtn.classList.remove('co-area-btn--filled'); }
    if (areaDisp) { areaDisp.textContent = t('jsSelectArea', 'Select Area'); }

    // Sections
    ['deliver','exchange','return'].forEach(function(t) {
      var s = el('co-section-' + t);
      if (s) s.classList.remove('co-type-section--active');
    });

    clearValidationErrors();
    syncProductFieldNames();
    updateSummary();
    showStep(1);
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Nav buttons
    var btnNext = el('co-btn-next');
    var btnBack = el('co-btn-back');
    if (btnNext) btnNext.addEventListener('click', goNext);
    if (btnBack) btnBack.addEventListener('click', goBack);

    // "Create New Order" button
    var btnNew = el('co-btn-new-order');
    if (btnNew) btnNew.addEventListener('click', resetForm);

    // Counters
    setupMainCounter();

    // Area listeners
    bindAreaListeners();
    bindStep2Listeners();

    var pAddr = el('selectedPickupAddressId');
    if (pAddr && pAddr.tagName === 'SELECT') {
      pAddr.addEventListener('change', function () {
        pAddr.classList.remove('is-error');
        var er = el('err-selectedPickup');
        if (er) er.classList.remove('co-field-error--show');
      });
    }
    updateBusinessPickupVisibility();
    updatePartialReturnBlockVisibility();

    // When step 3 becomes active, recalculate fees
    var step3Observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.target.classList.contains('step-panel--active')) {
          updateFeeSummary();
        }
        });
    });
    var step3El = el('co-step-3');
    if (step3El) {
      step3Observer.observe(step3El, { attributes: true, attributeFilter: ['class'] });
    }

    // Initial summary
    syncProductFieldNames();
    updateSummary();
    updateStepUI(1);

    var oon = el('originalOrderNumber');
    if (oon) {
      oon.addEventListener('input', function () {
        if (state.orderType !== 'Return') return;
        state.returnOrderCheck = { status: 'idle', orderNumber: '', itemCount: 0, hasMultiple: false };
        setInputError('originalOrderNumber', false);
        showFieldError('err-originalOrderNumber', false);
        setFieldTextContent('err-originalOrderNumber', t('errOriginalOrderEmpty', 'Please enter the original order number.'));
        setOriginalOrderHint('hide', '');
        var oic1 = el('originalOrderItemCount');
        if (oic1) oic1.value = '';
        var prB1 = el('co-partial-return-block');
        if (prB1) prB1.style.display = 'none';
        if (state.partialReturn) {
          state.partialReturn = false;
          setToggleCard(el('co-partial-return-toggle'), false);
          var iri1 = el('isPartialReturn-input');
          if (iri1) iri1.value = '';
          setCollapsible('co-partial-return-wrap', false);
        }
        var pInp1 = el('partialReturnItemCount');
        var pD1 = el('co-pr-display');
        if (pInp1) pInp1.value = '1';
        if (pD1) pD1.textContent = '1';
      });
      oon.addEventListener('blur', function () {
        if (state.orderType !== 'Return') return;
        var v = oon.value.trim();
        if (!v) {
          setOriginalOrderHint('hide', '');
          return;
        }
        if (state.originalOrderDebounce) clearTimeout(state.originalOrderDebounce);
        state.originalOrderDebounce = setTimeout(function () {
          runValidateOriginalOrder(null);
        }, 500);
      });
    }
    var rpdE = el('returnProductDescription');
    if (rpdE) {
      rpdE.addEventListener('input', function () {
        setInputError('returnProductDescription', false);
        showFieldError('err-returnProductDescription', false);
      });
    }
  });

})();
