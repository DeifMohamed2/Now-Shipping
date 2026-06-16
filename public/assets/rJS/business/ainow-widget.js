/**
 * AINOW — Global floating Gemini AI assistant widget
 */
(function () {
  'use strict';

  const API_BASE = '/business/ainow';
  const i18n = (window.__NS_BUSINESS_I18N && window.__NS_BUSINESS_I18N.ainow) || {};

  function t(key, fallback) {
    return i18n[key] != null ? i18n[key] : fallback;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatInlineBold(s) {
    const str = String(s || '');
    const parts = str.split(/(\*\*.+?\*\*)/g);
    return parts.map(function (part) {
      const m = part.match(/^\*\*(.+)\*\*$/);
      return m ? '<strong>' + escHtml(m[1]) + '</strong>' : escHtml(part);
    }).join('');
  }

  function formatTimer(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  const fab = document.getElementById('ainow-fab');
  const panel = document.getElementById('ainow-panel');
  if (!fab || !panel) return;

  const messagesEl = document.getElementById('ainow-messages');
  const suggestionsEl = document.getElementById('ainow-suggestions');
  const inputEl = document.getElementById('ainow-input');
  const sendBtn = document.getElementById('ainow-send');
  const micBtn = document.getElementById('ainow-mic');
  const closeBtn = document.getElementById('ainow-close');
  const clearBtn = document.getElementById('ainow-clear');
  const expandBtn = document.getElementById('ainow-expand');
  const footerEl = document.getElementById('ainow-footer');
  const voiceBar = document.getElementById('ainow-voice-bar');
  const voiceStatus = document.getElementById('ainow-voice-status');
  const voiceTimer = document.getElementById('ainow-voice-timer');
  const voiceDot = document.getElementById('ainow-voice-dot');
  const voiceWave = document.getElementById('ainow-voice-wave');
  const voicePauseBtn = document.getElementById('ainow-voice-pause');
  const voicePauseIcon = document.getElementById('ainow-voice-pause-icon');
  const voicePauseLabel = document.getElementById('ainow-voice-pause-label');
  const voiceCancelBtn = document.getElementById('ainow-voice-cancel');
  const voiceSendBtn = document.getElementById('ainow-voice-send');
  const openBtn = fab.querySelector('.ainow-fab__btn');

  let isOpen = false;
  let isLoading = false;
  let typingEl = null;
  let activeStructuredFlatpickr = null;
  let voiceRaf = null;
  let voiceTimerInterval = null;
  let waveBars = [];
  let lastDraftState = { complete: false, confirmType: null };

  function scrollBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** Align the top of a message with the top of the messages viewport (draft steps / calendar). */
  function scrollToMessageTop(msgEl) {
    if (!messagesEl || !msgEl) return;
    function align() {
      const pad = 10;
      const msgRect = msgEl.getBoundingClientRect();
      const containerRect = messagesEl.getBoundingClientRect();
      const delta = msgRect.top - containerRect.top;
      messagesEl.scrollTop = Math.max(0, messagesEl.scrollTop + delta - pad);
    }
    requestAnimationFrame(function () {
      align();
      requestAnimationFrame(align);
    });
    setTimeout(align, 60);
    setTimeout(align, 180);
  }

  function shouldScrollMessageToTop(parsed, sender) {
    if (sender !== 'assistant' || !parsed) return false;
    if (parsed.structuredField) return true;
    if (parsed.progress && (parsed.clarifyingQuestion || parsed.pendingField)) return true;
    return false;
  }

  function autoResizeTextarea() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  function showTyping() {
    removeTyping();
    typingEl = document.createElement('div');
    typingEl.className = 'ainow-msg ainow-msg--assistant ainow-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typingEl);
    scrollBottom();
  }

  function removeTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  const CHIP_ICONS = {
    fullName: 'ri-user-3-line',
    phoneNumber: 'ri-phone-line',
    otherPhoneNumber: 'ri-phone-find-line',
    address: 'ri-map-pin-line',
    zone: 'ri-road-map-line',
    productDescription: 'ri-t-shirt-line',
    numberOfItems: 'ri-stack-line',
    shippingSpeed: 'ri-truck-line',
    codConfirmation: 'ri-hand-coin-line',
    amountCOD: 'ri-money-dollar-circle-line',
    numberOfOrders: 'ri-shopping-bag-3-line',
    pickupDate: 'ri-calendar-line',
    pickupAddressId: 'ri-map-pin-2-line',
    pickupNotes: 'ri-sticky-note-line',
    isFragileItems: 'ri-alert-line',
    isLargeItems: 'ri-box-3-line',
  };

  const PENDING_FIELD_I18N = {
    fullName: 'fieldFullName',
    phoneNumber: 'fieldPhone',
    otherPhoneNumber: 'fieldOtherPhone',
    address: 'fieldAddress',
    zone: 'fieldZone',
    productDescription: 'fieldProduct',
    numberOfItems: 'fieldItems',
    codConfirmation: 'fieldCodConfirmation',
    shippingSpeed: 'fieldShippingSpeed',
    amountCOD: 'fieldCod',
    selectedPickupAddressId: 'fieldPickup',
    numberOfOrders: 'fieldPickupOrders',
    pickupDate: 'fieldPickupDate',
    pickupAddressId: 'fieldPickupAddress',
    pickupNotes: 'fieldPickupNotes',
    isFragileItems: 'fieldFragileItems',
    isLargeItems: 'fieldLargeItems',
  };

  function questionInText(text, question) {
    if (!text || !question) return false;
    const t = String(text).trim();
    const q = String(question).trim();
    return t === q || t.includes(q);
  }

  function renderChips(chips) {
    if (!chips || !chips.length) return '';
    return (
      '<div class="ainow-chip-grid">' +
      chips
        .map(function (c) {
          const icon = CHIP_ICONS[c.key] || 'ri-checkbox-circle-line';
          return (
            '<div class="ainow-chip ainow-chip--structured">' +
            '<span class="ainow-chip__icon"><i class="' + icon + '" aria-hidden="true"></i></span>' +
            '<span class="ainow-chip__body">' +
            '<span class="ainow-chip__label">' + escHtml(c.label) + '</span>' +
            '<span class="ainow-chip__value">' + escHtml(c.value) + '</span>' +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function destroyStructuredFlatpickr() {
    if (activeStructuredFlatpickr && typeof activeStructuredFlatpickr.destroy === 'function') {
      try {
        activeStructuredFlatpickr.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    activeStructuredFlatpickr = null;
  }

  function isRtlUi() {
    return document.documentElement.getAttribute('dir') === 'rtl'
      || document.body.classList.contains('rtl')
      || document.body.classList.contains('lang-ar');
  }

  function renderStructuredField(sf) {
    if (!sf || !sf.type) return '';

    if (sf.type === 'number_presets') {
      const placeholder = escHtml(sf.placeholder || t('customOrderPlaceholder', 'Enter another number'));
      const submitLabel = escHtml(sf.submitLabel || t('customOrderSubmit', 'Continue'));
      const divider = escHtml(sf.dividerLabel || t('customOrderDivider', 'Or enter a custom number'));
      const min = sf.min != null ? sf.min : 1;
      const max = sf.max != null ? sf.max : 999;
      return (
        '<div class="ainow-structured-field ainow-structured-field--number" data-field="' + escHtml(sf.field) + '">' +
        '<p class="ainow-structured-field__divider">' + divider + '</p>' +
        '<div class="ainow-structured-field__row">' +
        '<input type="number" class="ainow-structured-field__input" min="' + min + '" max="' + max + '" step="1" inputmode="numeric" placeholder="' + placeholder + '" aria-label="' + placeholder + '" />' +
        '<button type="button" class="ainow-structured-field__submit">' + submitLabel + '</button>' +
        '</div>' +
        '</div>'
      );
    }

    if (sf.type === 'date_inline') {
      const hint = escHtml(sf.hint || t('pickupDateHint', 'Pick a date from the calendar'));
      return (
        '<div class="ainow-structured-field ainow-structured-field--date" data-field="' + escHtml(sf.field) + '" data-min-date="' + escHtml(sf.minDate || '') + '">' +
        '<p class="ainow-structured-field__hint"><i class="ri-calendar-2-line" aria-hidden="true"></i> ' + hint + '</p>' +
        '<div class="ainow-structured-field__calendar-wrap">' +
        '<div class="ainow-structured-field__calendar ainow-pickup-date-inline"></div>' +
        '</div>' +
        '</div>'
      );
    }

    if (sf.type === 'phone') {
      const placeholder = escHtml(sf.placeholder || t('fieldPhone', 'Phone number'));
      const submitLabel = escHtml(sf.submitLabel || t('customOrderSubmit', 'Continue'));
      const defaultVal = escHtml(sf.defaultValue || '');
      return (
        '<div class="ainow-structured-field ainow-structured-field--phone" data-field="' + escHtml(sf.field) + '">' +
        '<div class="ainow-structured-field__row">' +
        '<input type="tel" class="ainow-structured-field__input" inputmode="tel" placeholder="' + placeholder + '" value="' + defaultVal + '" aria-label="' + placeholder + '" />' +
        '<button type="button" class="ainow-structured-field__submit">' + submitLabel + '</button>' +
        '</div>' +
        '</div>'
      );
    }

    return '';
  }

  function bindStructuredField(container, sf, msgEl) {
    if (!container || !sf) return;

    if (sf.type === 'number_presets') {
      const wrap = container.querySelector('.ainow-structured-field--number');
      if (!wrap) return;
      const input = wrap.querySelector('.ainow-structured-field__input');
      const btn = wrap.querySelector('.ainow-structured-field__submit');
      const min = sf.min != null ? sf.min : 1;
      const max = sf.max != null ? sf.max : 999;

      function submitNumber() {
        if (!input || isLoading) return;
        const n = parseInt(String(input.value || '').trim(), 10);
        if (!Number.isFinite(n) || n < min || n > max) {
          input.classList.add('ainow-structured-field__input--error');
          input.focus();
          return;
        }
        input.classList.remove('ainow-structured-field__input--error');
        sendText(String(n));
      }

      if (btn) btn.addEventListener('click', submitNumber);
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitNumber();
          }
        });
      }
      return;
    }

    if (sf.type === 'phone') {
      const wrap = container.querySelector('.ainow-structured-field--phone');
      if (!wrap) return;
      const input = wrap.querySelector('.ainow-structured-field__input');
      const btn = wrap.querySelector('.ainow-structured-field__submit');

      function submitPhone() {
        if (!input || isLoading) return;
        const val = String(input.value || '').trim();
        if (val.length < 10) {
          input.classList.add('ainow-structured-field__input--error');
          input.focus();
          return;
        }
        input.classList.remove('ainow-structured-field__input--error');
        sendText(val);
      }

      if (btn) btn.addEventListener('click', submitPhone);
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitPhone();
          }
        });
      }
      return;
    }

    if (sf.type === 'date_inline') {
      const calEl = container.querySelector('.ainow-pickup-date-inline');
      if (!calEl || typeof window.flatpickr !== 'function') return;

      destroyStructuredFlatpickr();

      const fpOpts = {
        inline: true,
        static: true,
        minDate: sf.minDate || sf.defaultDate || 'today',
        defaultDate: sf.defaultDate || sf.minDate || 'today',
        disableMobile: true,
        animate: false,
        dateFormat: 'Y-m-d',
        monthSelectorType: 'static',
        onReady: function () {
          if (msgEl) scrollToMessageTop(msgEl);
        },
        onChange: function (selectedDates) {
          if (!selectedDates || !selectedDates[0] || isLoading) return;
          const d = selectedDates[0];
          const iso =
            d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
          destroyStructuredFlatpickr();
          sendText(iso);
        },
      };

      if (isRtlUi() && window.flatpickr.l10ns && window.flatpickr.l10ns.ar) {
        fpOpts.locale = window.flatpickr.l10ns.ar;
      }

      try {
        activeStructuredFlatpickr = window.flatpickr(calEl, fpOpts);
        if (msgEl) scrollToMessageTop(msgEl);
      } catch (e) {
        console.error('AINOW flatpickr init failed', e);
      }
    }
  }

  function renderQuickReplies(quickReplies, opts) {
    if (!quickReplies || !quickReplies.length) return '';
    const isZone = opts && opts.zonePick;
    const wrapClass = isZone
      ? 'ainow-quick-replies ainow-quick-replies--zone'
      : 'ainow-quick-replies';
    const btnClass = isZone
      ? 'ainow-quick-reply ainow-quick-reply--zone'
      : 'ainow-quick-reply';
    return (
      '<div class="' + wrapClass + '">' +
      quickReplies
        .map(function (qr) {
          return (
            '<button type="button" class="' + btnClass + '" data-value="' +
            escHtml(qr.value) +
            '">' +
            escHtml(qr.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderPreview(preview) {
    if (!preview) return '';
    let html = '<div class="ainow-preview">';
    html += '<div class="ainow-preview__title">' + escHtml(preview.title) + '</div>';
    if (preview.isExpressShipping) {
      html += '<span class="ainow-preview__badge">' + escHtml(t('express', 'Express')) + '</span>';
    }
    html += '<div class="ainow-preview__summary">' + escHtml(preview.summary) + '</div>';
    html += '<div class="ainow-preview__actions">';
    (preview.actions || []).forEach(function (action) {
      if (action.type === 'confirm_order' || action.type === 'confirm_pickup') {
        html +=
          '<button type="button" class="btn btn-primary btn-sm ainow-action-confirm" data-confirm="' +
          escHtml(action.type) +
          '">' +
          escHtml(action.label) +
          '</button>';
      } else if (action.type === 'cancel_draft') {
        html += '<button type="button" class="btn btn-outline-secondary btn-sm ainow-action-cancel">' + escHtml(action.label) + '</button>';
      } else if (action.url) {
        html += '<a href="' + escHtml(action.url) + '" class="btn btn-outline-primary btn-sm">' + escHtml(action.label) + '</a>';
      }
    });
    html += '</div></div>';
    return html;
  }

  function renderActions(actions) {
    if (!actions || !actions.length) return '';
    let html = '<div class="ainow-actions-row">';
    actions.forEach(function (a) {
      if (a.url) {
        html += '<a href="' + escHtml(a.url) + '" class="btn btn-sm btn-outline-primary">' + escHtml(a.text) + '</a>';
      }
    });
    html += '</div>';
    return html;
  }

  function renderHelpGuide(guide) {
    if (!guide || !guide.steps || !guide.steps.length) return '';
    let html = '<div class="ainow-help-guide">';
    if (guide.title) {
      html += '<div class="ainow-help-guide__title">' + escHtml(guide.title) + '</div>';
    }
    html += '<ol class="ainow-help-guide__steps">';
    guide.steps.forEach(function (step) {
      const stripped = String(step).replace(/^\d+\.\s*/, '');
      html += '<li class="ainow-help-guide__step">' + formatInlineBold(stripped) + '</li>';
    });
    html += '</ol></div>';
    return html;
  }

  function helpTopicChipLabel(helpTopic) {
    const isAr = document.documentElement.getAttribute('dir') === 'rtl';
    if (helpTopic === 'add_pickup_address') {
      return isAr ? 'شرح إضافة عنوان الاستلام' : 'How to add pickup address';
    }
    return isAr ? 'شرح الخطوات' : 'Show steps';
  }

  function renderHelpTopicChip(helpTopic) {
    const label = helpTopicChipLabel(helpTopic);
    return (
      '<button type="button" class="ainow-help-chip" data-help-topic="' + escHtml(helpTopic) + '">' +
      escHtml(label) +
      '</button>'
    );
  }

  function fieldLabelForKey(fieldKey) {
    if (!fieldKey || !PENDING_FIELD_I18N[fieldKey]) return '';
    return t(PENDING_FIELD_I18N[fieldKey], fieldKey);
  }

  function getCurrentField(progress, pendingField) {
    if (pendingField) return pendingField;
    if (progress && progress.currentField) return progress.currentField;
    const queue = (progress && progress.missingFields) || [];
    return queue.length ? queue[0] : null;
  }

  /** Upcoming field after the one being asked now. */
  function getUpcomingField(progress, currentField) {
    if (progress && progress.upcomingField) {
      return progress.upcomingField;
    }
    const queue = (progress && progress.missingFields) || [];
    const upcoming = queue.length > 1 ? queue[1] : null;
    if (upcoming && upcoming === currentField) return null;
    return upcoming;
  }

  function renderProgress(progress, pendingField) {
    if (!progress || !progress.total) return '';
    const collected = progress.collected || 0;
    const total = progress.total || 1;
    const pct = Math.round((collected / total) * 100);
    const label = t('progressLabel', '{collected}/{total} collected')
      .replace('{collected}', String(collected))
      .replace('{total}', String(total));
    let stepHtml = '';
    const current = getCurrentField(progress, pendingField);
    const currentLabel = fieldLabelForKey(current);
    if (currentLabel) {
      stepHtml =
        '<span class="ainow-progress__step">' +
        escHtml(t('currentStep', 'Now: {field}').replace('{field}', currentLabel)) +
        '</span>';
    }
    const upcoming = getUpcomingField(progress, current);
    const upcomingLabel = fieldLabelForKey(upcoming);
    if (upcomingLabel && upcoming !== current) {
      stepHtml +=
        '<span class="ainow-progress__step ainow-progress__step--next">' +
        escHtml(t('nextStep', 'Next: {field}').replace('{field}', upcomingLabel)) +
        '</span>';
    } else if (!upcomingLabel && (progress.missingFields || []).length === 1 && currentLabel) {
      stepHtml +=
        '<span class="ainow-progress__step ainow-progress__step--next">' +
        escHtml(t('lastStep', 'Final step')) +
        '</span>';
    }
    return (
      '<div class="ainow-progress" role="status">' +
      '<div class="ainow-progress__header">' +
      '<span class="ainow-progress__label">' + escHtml(label) + '</span>' +
      stepHtml +
      '</div>' +
      '<div class="ainow-progress__bar"><div class="ainow-progress__fill" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }

  function isConflictingZoneStepText(parsed) {
    if (parsed.pendingField !== 'zone' || !parsed.quickReplies || !parsed.quickReplies.length) {
      return false;
    }
    const t = String(parsed.text || '');
    return /رقم|تليفون|موبايل|phone|mobile|كاش|cod/i.test(t)
      && !/منطقة|area|zone|اختر|اختيار/i.test(t);
  }

  function renderMessage(sender, content) {
    let parsed = content;
    if (typeof content === 'string') {
      try { parsed = JSON.parse(content); } catch { parsed = { text: content }; }
    }

    const el = document.createElement('div');
    const isStructuredStep = shouldScrollMessageToTop(parsed, sender);
    el.className = 'ainow-msg ainow-msg--' + sender + (isStructuredStep ? ' ainow-msg--draft-step' : '');

    let html = '';
    if (parsed.transcript && sender === 'user') {
      html = '<p class="ainow-msg__text">' + escHtml(parsed.transcript) + '</p>';
    } else if (sender === 'assistant') {
      const isDraftStep = !!(parsed.progress || parsed.clarifyingQuestion || parsed.chips);
      if (parsed.progress) {
        html += renderProgress(parsed.progress, parsed.pendingField);
      }
      if (parsed.text && !isConflictingZoneStepText(parsed)) {
        const textContent = parsed.helpGuide ? formatInlineBold(parsed.text) : escHtml(parsed.text);
        html += isDraftStep
          ? '<p class="ainow-msg__ack">' + textContent + '</p>'
          : '<p class="ainow-msg__text">' + textContent + '</p>';
      }
      if (parsed.helpGuide) html += renderHelpGuide(parsed.helpGuide);
      if (parsed.helpTopic && !parsed.helpGuide) html += renderHelpTopicChip(parsed.helpTopic);
      if (parsed.clarifyingQuestion && !questionInText(parsed.text, parsed.clarifyingQuestion)) {
        html += '<div class="ainow-msg__question">' + escHtml(parsed.clarifyingQuestion) + '</div>';
      }
      if (parsed.quickReplies && parsed.quickReplies.length) {
        html += renderQuickReplies(parsed.quickReplies, {
          zonePick: parsed.pendingField === 'zone' || !!parsed.zonePickReason,
        });
      }
      if (parsed.structuredField) {
        html += renderStructuredField(parsed.structuredField);
      }
      if (parsed.chips) html += renderChips(parsed.chips);
    } else {
      html += '<p class="ainow-msg__text">' + escHtml(parsed.text || String(content)) + '</p>';
    }
    if (parsed.preview) html += renderPreview(parsed.preview);
    if (parsed.data && parsed.data.length) {
      html += '<ul class="mb-0 mt-2 ps-3" style="font-size:0.8rem">';
      parsed.data.forEach(function (d) {
        if (d.orderNumber) html += '<li>#' + escHtml(d.orderNumber) + ' — ' + escHtml(d.status || '') + '</li>';
      });
      html += '</ul>';
    }
    if (parsed.actions) html += renderActions(parsed.actions);
    el.innerHTML = html;

    if (parsed.preview) {
      const confirmBtn = el.querySelector('.ainow-action-confirm');
      const cancelBtn = el.querySelector('.ainow-action-cancel');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          const confirmType = confirmBtn.getAttribute('data-confirm') || 'confirm_order';
          confirmDraft(confirmType);
        });
      }
      if (cancelBtn) cancelBtn.addEventListener('click', cancelDraft);
    }

    el.querySelectorAll('.ainow-quick-reply').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const val = btn.getAttribute('data-value');
        if (val) sendText(val);
      });
    });

    el.querySelectorAll('.ainow-help-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendText(btn.textContent.trim());
      });
    });

    if (parsed.structuredField) {
      bindStructuredField(el, parsed.structuredField, el);
    }

    messagesEl.appendChild(el);
    if (isStructuredStep) {
      scrollToMessageTop(el);
    } else {
      scrollBottom();
    }
  }

  function getConfirmTypeFromPreview(preview) {
    if (!preview || !preview.actions) return null;
    for (let i = 0; i < preview.actions.length; i++) {
      const action = preview.actions[i];
      if (action.type === 'confirm_pickup') return 'confirm_pickup';
      if (action.type === 'confirm_order') return 'confirm_order';
    }
    return null;
  }

  function normalizeSuggestionText(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function isConfirmSuggestion(text) {
    const norm = normalizeSuggestionText(text);
    return norm === 'تأكيد الاستلام'
      || norm === 'confirm pickup'
      || norm === 'تأكيد الأوردر'
      || norm === 'تأكيد الطلب'
      || norm === 'confirm order';
  }

  function isCancelSuggestion(text) {
    const norm = normalizeSuggestionText(text);
    return norm === 'إلغاء' || norm === 'الغاء' || norm === 'cancel';
  }

  function finalizePreviewMessages() {
    if (!messagesEl) return;
    messagesEl.querySelectorAll('.ainow-preview').forEach(function (preview) {
      preview.classList.add('ainow-preview--confirmed');
      preview.querySelectorAll('.ainow-action-confirm, .ainow-action-cancel').forEach(function (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      });
    });
  }

  function renderSuggestions(suggestions) {
    suggestionsEl.innerHTML = '';
    if (!suggestions || !suggestions.length) return;
    suggestions.forEach(function (s) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ainow-suggestion';
      btn.textContent = s;
      btn.addEventListener('click', function () {
        if (lastDraftState.complete && lastDraftState.confirmType && isConfirmSuggestion(s)) {
          confirmDraft(lastDraftState.confirmType);
        } else if (isCancelSuggestion(s)) {
          cancelDraft();
        } else {
          sendText(s);
        }
      });
      suggestionsEl.appendChild(btn);
    });
  }

  function displayResponse(response) {
    renderMessage('assistant', response);
    lastDraftState = {
      complete: !!(response.draft && response.draft.complete),
      confirmType: response.preview ? getConfirmTypeFromPreview(response.preview) : lastDraftState.confirmType,
    };
    if (response.preview) {
      lastDraftState.complete = true;
      lastDraftState.confirmType = getConfirmTypeFromPreview(response.preview);
    }
    if (response.intent === 'pickup_created' || response.intent === 'order_created') {
      lastDraftState = { complete: false, confirmType: null };
    }
    if (response.quickReplies && response.quickReplies.length) {
      renderSuggestions([]);
    } else {
      renderSuggestions(response.suggestions);
    }
  }

  function renderConversationMessages(messages) {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    (messages || []).forEach(function (msg) {
      if (msg.sender === 'assistant') {
        try { renderMessage('assistant', JSON.parse(msg.content)); }
        catch { renderMessage(msg.sender, msg.content); }
      } else {
        renderMessage(msg.sender, msg.content);
      }
    });
    const last = messages && messages[messages.length - 1];
    if (last && last.sender === 'assistant') {
      try { renderSuggestions(JSON.parse(last.content).suggestions); } catch { /* ignore */ }
    } else {
      renderSuggestions([]);
    }
    scrollBottom();
  }

  async function loadConversation() {
    try {
      const res = await fetch(API_BASE + '/conversation');
      const data = await res.json();
      renderConversationMessages(data.messages || []);
    } catch (e) {
      console.error('AINOW load error:', e);
    }
  }

  async function sendText(text) {
    const message = (text || '').trim();
    if (!message || isLoading) return;

    destroyStructuredFlatpickr();
    isLoading = true;
    inputEl.value = '';
    autoResizeTextarea();
    renderMessage('user', message);
    renderSuggestions([]);
    showTyping();

    try {
      const res = await fetch(API_BASE + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      removeTyping();
      if (data.response) displayResponse(data.response);
      else if (data.error) renderMessage('assistant', { text: data.error });
    } catch (e) {
      removeTyping();
      renderMessage('assistant', { text: t('errorSend', 'Sorry, something went wrong. Please try again.') });
    }
    isLoading = false;
  }

  async function sendVoice(blob) {
    if (isLoading) return;
    isLoading = true;
    renderMessage('user', t('voiceProcessing', 'Processing voice…'));
    showTyping();

    const form = new FormData();
    form.append('audio', blob, 'recording.webm');

    try {
      const res = await fetch(API_BASE + '/voice', { method: 'POST', body: form });
      const data = await res.json();
      removeTyping();
      const msgs = messagesEl.querySelectorAll('.ainow-msg--user');
      const lastUser = msgs[msgs.length - 1];
      if (lastUser) lastUser.remove();
      if (data.response && data.response.transcript) {
        renderMessage('user', data.response.transcript);
      }
      if (data.response) displayResponse(data.response);
      else if (data.error) renderMessage('assistant', { text: data.error });
    } catch (e) {
      removeTyping();
      renderMessage('assistant', { text: t('errorVoice', 'Voice processing failed. Try typing instead.') });
    }
    isLoading = false;
  }

  async function confirmDraft(confirmType) {
    if (isLoading) return;
    isLoading = true;
    showTyping();
    const endpoint = confirmType === 'confirm_pickup' ? '/confirm-pickup' : '/confirm-order';
    const errorKey = confirmType === 'confirm_pickup' ? 'errorConfirmPickup' : 'errorConfirm';
    const errorFallback =
      confirmType === 'confirm_pickup'
        ? 'Could not schedule pickup.'
        : 'Could not create order.';
    try {
      const res = await fetch(API_BASE + endpoint, { method: 'POST' });
      const data = await res.json();
      removeTyping();
      if (data.success) {
        finalizePreviewMessages();
        lastDraftState = { complete: false, confirmType: null };
        displayResponse({
          text: data.text,
          actions: data.actions,
          suggestions: [],
          intent: confirmType === 'confirm_pickup' ? 'pickup_created' : 'order_created',
        });
      } else {
        renderMessage('assistant', { text: data.error || t(errorKey, errorFallback) });
      }
    } catch (e) {
      removeTyping();
      renderMessage('assistant', { text: t(errorKey, errorFallback) });
    }
    isLoading = false;
  }

  async function cancelDraft() {
    try {
      await fetch(API_BASE + '/cancel-draft', { method: 'POST' });
      renderMessage('assistant', { text: t('draftCancelled', 'Order draft cancelled.') });
      renderSuggestions([]);
    } catch (e) {
      console.error(e);
    }
  }

  function updateExpandIcon(expanded) {
    if (!expandBtn) return;
    const icon = expandBtn.querySelector('i');
    if (icon) {
      icon.className = expanded ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line';
    }
    expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    expandBtn.classList.toggle('is-active', expanded);
    expandBtn.title = expanded
      ? t('collapse', 'Collapse')
      : t('expand', 'Expand');
    expandBtn.setAttribute('aria-label', expandBtn.title);
  }

  function setPanelExpanded(expanded) {
    panel.classList.toggle('ainow-panel--expanded', expanded);
    updateExpandIcon(expanded);
  }

  async function clearChat() {
    if (isLoading) return;
    if (!window.confirm(t('clearConfirm', 'Clear chat history and start over?'))) return;

    isLoading = true;
    try {
      destroyStructuredFlatpickr();
      await hideVoiceBar();
      setPanelExpanded(false);
      removeTyping();

      const res = await fetch(API_BASE + '/clear', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clear failed');

      lastDraftState = { complete: false, confirmType: null };
      const messages = (data.conversation && data.conversation.messages) || [];
      renderConversationMessages(messages);
    } catch (e) {
      console.error(e);
      renderMessage('assistant', {
        text: t('clearFailed', 'Could not clear chat. Please try again.'),
      });
    }
    isLoading = false;
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('ainow-panel--open');
    fab.classList.remove('ainow-fab--hidden');
    setPanelExpanded(false);
    hideVoiceBar();
  }

  function togglePanel() {
    if (isOpen) {
      closePanel();
      return;
    }
    isOpen = true;
    panel.classList.add('ainow-panel--open');
    fab.classList.add('ainow-fab--hidden');
    loadConversation();
  }

  function initWaveform() {
    if (!voiceWave || waveBars.length) return;
    voiceWave.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const bar = document.createElement('span');
      bar.className = 'ainow-voice-wave__bar';
      bar.style.height = '4px';
      voiceWave.appendChild(bar);
      waveBars.push(bar);
    }
  }

  function updateWaveform() {
    if (!window.AinowVoice || waveBars.length === 0) return;
    const data = window.AinowVoice.getFrequencyData();
    const step = Math.max(1, Math.floor(data.length / waveBars.length));
    waveBars.forEach(function (bar, i) {
      const v = data[i * step] || 0;
      const h = Math.max(4, (v / 255) * 28);
      bar.style.height = h + 'px';
    });
  }

  function startVoiceAnimation() {
    function tick() {
      if (!window.AinowVoice) return;
      const st = window.AinowVoice.getState();
      if (st === 'recording') updateWaveform();
      if (st !== 'idle') voiceRaf = requestAnimationFrame(tick);
    }
    voiceRaf = requestAnimationFrame(tick);

    if (voiceTimerInterval) clearInterval(voiceTimerInterval);
    voiceTimerInterval = setInterval(function () {
      if (!window.AinowVoice || !voiceTimer) return;
      voiceTimer.textContent = formatTimer(window.AinowVoice.getElapsedMs());
    }, 200);
  }

  function stopVoiceAnimation() {
    if (voiceRaf) cancelAnimationFrame(voiceRaf);
    voiceRaf = null;
    if (voiceTimerInterval) clearInterval(voiceTimerInterval);
    voiceTimerInterval = null;
  }

  function setVoiceUiState(st) {
    if (!voiceStatus || !voiceDot) return;
    if (st === 'recording') {
      voiceStatus.textContent = t('voiceRecording', 'Recording');
      voiceDot.className = 'ainow-voice-bar__dot ainow-voice-bar__dot--recording';
      if (voicePauseIcon) voicePauseIcon.className = 'ri-pause-line';
      if (voicePauseLabel) voicePauseLabel.textContent = t('voicePause', 'Pause');
    } else if (st === 'paused') {
      voiceStatus.textContent = t('voicePaused', 'Paused');
      voiceDot.className = 'ainow-voice-bar__dot ainow-voice-bar__dot--paused';
      if (voicePauseIcon) voicePauseIcon.className = 'ri-play-line';
      if (voicePauseLabel) voicePauseLabel.textContent = t('voiceResume', 'Resume');
    }
  }

  function showVoiceBar() {
    if (!voiceBar) return;
    initWaveform();
    voiceBar.classList.remove('ainow-voice-bar--hidden');
    voiceBar.setAttribute('aria-hidden', 'false');
    if (footerEl) footerEl.classList.add('ainow-panel__footer--dimmed');
    if (micBtn) micBtn.classList.add('ainow-btn-mic--active');
    if (voiceTimer) voiceTimer.textContent = '00:00';
    setVoiceUiState('recording');
    startVoiceAnimation();
  }

  async function hideVoiceBar() {
    stopVoiceAnimation();
    if (window.AinowVoice && window.AinowVoice.getState() !== 'idle') {
      await window.AinowVoice.cancel();
    }
    if (voiceBar) {
      voiceBar.classList.add('ainow-voice-bar--hidden');
      voiceBar.setAttribute('aria-hidden', 'true');
    }
    if (footerEl) footerEl.classList.remove('ainow-panel__footer--dimmed');
    if (micBtn) micBtn.classList.remove('ainow-btn-mic--active');
    waveBars.forEach(function (b) { b.style.height = '4px'; });
  }

  async function startVoiceSession() {
    if (!window.AinowVoice || !window.AinowVoice.isSupported()) {
      renderMessage('assistant', { text: t('micDenied', 'Microphone not supported.') });
      return;
    }
    try {
      await window.AinowVoice.startSession();
      showVoiceBar();
    } catch (err) {
      renderMessage('assistant', {
        text: t('micDenied', 'Microphone access denied. Please allow mic or type your message.'),
      });
    }
  }

  function bindClick(el, handler) {
    if (!el) return;
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    });
  }

  bindClick(openBtn, togglePanel);
  bindClick(closeBtn, closePanel);
  bindClick(clearBtn, clearChat);
  bindClick(expandBtn, function () {
    setPanelExpanded(!panel.classList.contains('ainow-panel--expanded'));
  });
  bindClick(sendBtn, function () { sendText(inputEl && inputEl.value); });

  if (inputEl) {
    inputEl.addEventListener('input', autoResizeTextarea);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText(inputEl.value);
      }
    });
    autoResizeTextarea();
  }

  if (micBtn && window.AinowVoice) {
    micBtn.addEventListener('click', function () {
      if (window.AinowVoice.getState() !== 'idle') return;
      startVoiceSession();
    });
  } else if (micBtn) {
    micBtn.style.display = 'none';
  }

  if (voicePauseBtn) {
    voicePauseBtn.addEventListener('click', function () {
      if (!window.AinowVoice) return;
      const st = window.AinowVoice.getState();
      if (st === 'recording') {
        window.AinowVoice.pause();
        setVoiceUiState('paused');
      } else if (st === 'paused') {
        window.AinowVoice.resume();
        setVoiceUiState('recording');
      }
    });
  }

  if (voiceCancelBtn) {
    voiceCancelBtn.addEventListener('click', function () { hideVoiceBar(); });
  }

  if (voiceSendBtn) {
    voiceSendBtn.addEventListener('click', async function () {
      if (!window.AinowVoice || window.AinowVoice.getState() === 'idle') return;
      voiceSendBtn.disabled = true;
      try {
        const blob = await window.AinowVoice.stopAndGetBlob();
        await hideVoiceBar();
        if (blob && blob.size > 0) await sendVoice(blob);
      } catch (err) {
        console.error(err);
        await hideVoiceBar();
      }
      voiceSendBtn.disabled = false;
    });
  }

  function prefill(text) {
    if (!isOpen) togglePanel();
    if (inputEl) {
      inputEl.value = String(text || '');
      autoResizeTextarea();
      inputEl.focus();
    }
  }

  window.AinowWidget = {
    open: function () { if (!isOpen) togglePanel(); },
    sendText: sendText,
    prefill: prefill,
  };
})();
