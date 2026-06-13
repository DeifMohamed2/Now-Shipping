/**
 * AINOW dashboard page — open widget, quick prompts, preferences.
 */
(function () {
  'use strict';

  function openWidget() {
    if (window.AinowWidget && window.AinowWidget.open) {
      window.AinowWidget.open();
    }
  }

  function prefillWidget(text) {
    if (!text) return;
    if (window.AinowWidget && window.AinowWidget.prefill) {
      window.AinowWidget.prefill(text);
      return;
    }
    openWidget();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var openBtn = document.getElementById('ainow-page-open-btn');
    var heroBtn = document.getElementById('ainow-page-hero-open');
    if (openBtn) openBtn.addEventListener('click', openWidget);
    if (heroBtn) heroBtn.addEventListener('click', openWidget);

    document.querySelectorAll('[data-ainow-prompt]').forEach(function (el) {
      el.addEventListener('click', function () {
        prefillWidget(el.getAttribute('data-ainow-prompt') || '');
      });
    });

    fetch('/business/assistant/preferences')
      .then(function (r) { return r.json(); })
      .then(function (prefs) {
        if (!prefs) return;
        var el;
        if ((el = document.getElementById('assistant-enabled'))) el.checked = prefs.enabled !== false;
        if ((el = document.getElementById('assistant-suggestions'))) el.checked = prefs.showSuggestions !== false;
        if ((el = document.getElementById('assistant-auto-open'))) el.checked = !!prefs.autoOpen;
      })
      .catch(function () {});

    var form = document.getElementById('assistant-preferences-form');
    if (form) {
      form.addEventListener('change', function () {
        fetch('/business/assistant/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: document.getElementById('assistant-enabled').checked,
            showSuggestions: document.getElementById('assistant-suggestions').checked,
            autoOpen: document.getElementById('assistant-auto-open').checked,
          }),
        }).catch(function () {});
      });
    }
  });
})();
