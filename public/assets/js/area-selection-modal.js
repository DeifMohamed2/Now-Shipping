// Area Selection Modal Handler - Reusable Component
// This handles the Bosta regions area selection modal across the application

(function(window) {
  'use strict';

  // State variables
  let bostaRegionsData = {};
  let selectedGovernorate = null;
  let selectedArea = null;
  let callbacks = {
    onSelect: null,
    onClose: null
  };

  /** Normalize to `ar` or `en` for `label.ar` / `label.en` keys. */
  function getCurrentLanguage() {
    let raw = '';

    const htmlLang = document.documentElement.lang;
    if (htmlLang && String(htmlLang).trim()) raw = htmlLang;

    if (!raw) {
      const cookies = document.cookie.split(';');
      const langCookie = cookies.find(function(cookie) { return cookie.trim().startsWith('language='); });
      if (langCookie) {
        raw = langCookie.split('=')[1].trim();
      }
    }

    if (!raw) {
      const storedLang = localStorage.getItem('language');
      if (storedLang) raw = storedLang;
    }

    const base = String(raw || 'en').toLowerCase().split('-')[0];
    return base === 'ar' ? 'ar' : 'en';
  }

  function normalizeArabicDigitsToLatin(s) {
    if (!s) return '';
    const map = {
      '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
      '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
      '\u06f0': '0', '\u06f1': '1', '\u06f2': '2', '\u06f3': '3', '\u06f4': '4',
      '\u06f5': '5', '\u06f6': '6', '\u06f7': '7', '\u06f8': '8', '\u06f9': '9'
    };
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      out += map[ch] !== undefined ? map[ch] : ch;
    }
    return out;
  }

  /** True if `text` matches user `query` (Arabic, English, mixed, digit variants). */
  function textMatches(text, query) {
    const q = (query || '').trim();
    if (!q) return true;
    const t = String(text || '');
    if (t.includes(q)) return true;
    const tN = normalizeArabicDigitsToLatin(t);
    const qN = normalizeArabicDigitsToLatin(q);
    if (tN.includes(qN)) return true;
    if (t.toLowerCase().includes(q.toLowerCase())) return true;
    if (tN.toLowerCase().includes(qN.toLowerCase())) return true;
    return false;
  }

  function matchesGovernorate(gov, query) {
    if (!gov) return false;
    const q = (query || '').trim();
    if (!q) return true;
    return textMatches(gov.label && gov.label.ar, q) ||
      textMatches(gov.label && gov.label.en, q) ||
      textMatches(gov.value, q);
  }

  function matchesArea(area, query) {
    if (!area) return false;
    const q = (query || '').trim();
    if (!q) return true;
    return textMatches(area.label && area.label.ar, q) ||
      textMatches(area.label && area.label.en, q) ||
      textMatches(area.value, q);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function getModalI18n() {
    const el = document.getElementById('areaSelectionModal');
    if (!el || !el.dataset) {
      return { swalTitle: 'Please Select', swalText: 'Please select both a governorate and an area.' };
    }
    return {
      swalTitle: el.dataset.swalTitle || 'Please Select',
      swalText: el.dataset.swalText || 'Please select both a governorate and an area.'
    };
  }

  // Load the regions data
  function loadRegionsData() {
    return fetch('/assets/js/bosta-regions-data-processed.json')
      .then(function(response) { return response.json(); })
      .then(function(data) {
        bostaRegionsData = data;
        renderGovernorates(data);
      })
      .catch(function(error) {
        console.error('Error loading regions data:', error);
      });
  }

  // Render governorates in the modal
  function renderGovernorates(data) {
    const governorateList = document.getElementById('governorateList');
    if (!governorateList) return;

    governorateList.innerHTML = '';

    const cairoData = data['Cairo'] ? { 'Cairo': data['Cairo'] } : {};
    const currentLang = getCurrentLanguage();

    const sortedGovernorates = Object.keys(cairoData).sort(function(a, b) {
      const la = (cairoData[a].label[currentLang] || cairoData[a].label.en || a).toLowerCase();
      const lb = (cairoData[b].label[currentLang] || cairoData[b].label.en || b).toLowerCase();
      return la.localeCompare(lb, currentLang === 'ar' ? 'ar' : 'en');
    });

    sortedGovernorates.forEach(function(govValue) {
      const gov = cairoData[govValue];
      const governorateItem = document.createElement('div');
      governorateItem.className = 'governorate-item';
      governorateItem.dataset.governorate = govValue;

      const govLabel = escapeHtml(gov.label[currentLang] || gov.label.en);
      const areaCount = gov.areas.length;

      governorateItem.innerHTML =
        '<div class="governorate-header">' +
          '<div class="governorate-header__main">' +
            '<span class="governorate-header__name">' + govLabel + '</span>' +
            '<span class="area-count-badge">' + areaCount + '</span>' +
          '</div>' +
          '<i class="governorate-header__chevron ri-arrow-down-s-line governorate-arrow" aria-hidden="true"></i>' +
        '</div>' +
        '<div class="area-list">' +
          renderAreas(gov.areas) +
        '</div>';

      governorateItem.addEventListener('click', function(e) {
        if (e.target.closest('.area-item')) return;

        const isActive = governorateItem.classList.contains('active');
        document.querySelectorAll('.governorate-item').forEach(function(item) {
          item.classList.remove('active');
        });

        if (!isActive) {
          governorateItem.classList.add('active');
          setTimeout(function() {
            governorateItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 150);
        }
      });

      governorateList.appendChild(governorateItem);
    });
  }

  function renderAreas(areas) {
    const currentLang = getCurrentLanguage();
    return areas.map(function(area, index) {
      const areaLabel = escapeHtml(area.label[currentLang] || area.label.en);
      return (
        '<div class="area-item" data-area-value="' + escapeAttr(area.value) + '" data-area-index="' + index + '">' +
          '<div class="area-item-text">' +
            '<span>' + areaLabel + '</span>' +
            '<i class="ri-check-line" style="display: none;"></i>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  document.addEventListener('click', function(e) {
    const areaItem = e.target.closest('.area-item');
    if (areaItem) {
      document.querySelectorAll('.area-item').forEach(function(item) {
        item.classList.remove('selected');
        const checkIcon = item.querySelector('i');
        if (checkIcon) checkIcon.style.display = 'none';
      });

      areaItem.classList.add('selected');
      const checkIcon = areaItem.querySelector('i');
      if (checkIcon) checkIcon.style.display = 'block';

      selectedGovernorate = areaItem.closest('.governorate-item').dataset.governorate;
      selectedArea = areaItem.dataset.areaValue;
    }
  });

  function setupSearch() {
    const areaSearchInput = document.getElementById('areaSearchInput');
    if (!areaSearchInput) return;

    areaSearchInput.addEventListener('input', function() {
      const queryRaw = this.value.trim();

      if (!queryRaw) {
        document.querySelectorAll('.governorate-item').forEach(function(item) {
          item.style.display = 'block';
        });
        document.querySelectorAll('.area-item').forEach(function(item) {
          item.style.display = 'block';
        });
        return;
      }

      document.querySelectorAll('.governorate-item').forEach(function(item) {
        item.style.display = 'none';
        item.classList.remove('active');
      });

      const cairoData = bostaRegionsData['Cairo'];
      if (!cairoData) return;

      const gov = cairoData;
      const govMatches = matchesGovernorate(gov, queryRaw);
      const matchingAreas = gov.areas.filter(function(area) {
        return matchesArea(area, queryRaw);
      });

      if (govMatches || matchingAreas.length > 0) {
        const governorateItem = document.querySelector('[data-governorate="Cairo"]');
        if (governorateItem) {
          governorateItem.style.display = 'block';
          const showAllAreas = govMatches && matchingAreas.length === 0;
          if (matchingAreas.length > 0) {
            governorateItem.classList.add('active');
          }

          governorateItem.querySelectorAll('.area-item').forEach(function(item) {
            const areaValue = item.dataset.areaValue;
            const isMatch = matchingAreas.some(function(area) { return area.value === areaValue; });
            item.style.display = (showAllAreas || isMatch) ? 'block' : 'none';
          });
        }
      }
    });
  }

  function getAreaModal() {
    const modal = document.getElementById('areaSelectionModal');
    const BS = typeof window !== 'undefined' ? window.bootstrap : null;
    if (!modal || !BS || !BS.Modal) return null;
    return BS.Modal.getOrCreateInstance(modal);
  }

  /**
   * When the area modal hides, ensure no stray backdrops remain (e.g. after legacy double-open).
   * Only clears body state if no other Bootstrap modal is still visible.
   */
  function bindAreaModalLifecycleOnce() {
    const modalEl = document.getElementById('areaSelectionModal');
    if (!modalEl || modalEl.dataset.asmLifecycleBound === '1') return;
    modalEl.dataset.asmLifecycleBound = '1';
    modalEl.addEventListener('hidden.bs.modal', function() {
      window.requestAnimationFrame(function() {
        if (document.querySelector('.modal.show')) return;
        document.querySelectorAll('.modal-backdrop').forEach(function(node) {
          node.remove();
        });
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      });
    });
  }

  function setupModalHandlers() {
    bindAreaModalLifecycleOnce();

    document.addEventListener('click', function(e) {
      if (e.target.closest('.area-selection-trigger, #selectAreaBtn')) {
        const inst = getAreaModal();
        if (inst) inst.show();
      }
    });

    const confirmAreaSelection = document.getElementById('confirmAreaSelection');
    if (confirmAreaSelection) {
      confirmAreaSelection.addEventListener('click', function() {
        if (selectedGovernorate && selectedArea) {
          const gov = bostaRegionsData[selectedGovernorate];
          const area = gov.areas.find(function(a) { return a.value === selectedArea; });

          if (gov && area) {
            const currentLang = getCurrentLanguage();
            const displayText =
              (area.label[currentLang] || area.label.en) +
              ', ' +
              (gov.label[currentLang] || gov.label.en);

            const displayElement = document.getElementById('selectedAreaDisplay');
            if (displayElement) {
              displayElement.textContent = displayText;
            }

            const govInput = document.getElementById('government-value');
            if (govInput) {
              govInput.value = selectedGovernorate;
            }

            const zoneInput = document.getElementById('zone-value');
            if (zoneInput) {
              zoneInput.value = selectedArea;
            }

            if (callbacks.onSelect) {
              callbacks.onSelect({
                governorate: selectedGovernorate,
                zone: selectedArea,
                displayText: displayText,
                data: { governorate: gov, area: area }
              });
            }

            const modalInst = getAreaModal();
            if (modalInst) modalInst.hide();

            if (typeof window.updateFees === 'function') {
              window.updateFees();
            }
          }
        } else {
          if (typeof Swal !== 'undefined') {
            const am = getModalI18n();
            Swal.fire({
              icon: 'warning',
              title: am.swalTitle,
              text: am.swalText
            });
          }
        }
      });
    }
  }

  function init() {
    loadRegionsData().then(function() {
      setupSearch();
      setupModalHandlers();
    });
  }

  window.AreaSelectionModal = {
    init: init,
    onSelect: function(callback) {
      callbacks.onSelect = callback;
    },
    onClose: function(callback) {
      callbacks.onClose = callback;
    },
    open: function() {
      const inst = getAreaModal();
      if (inst) inst.show();
    },
    getSelectedData: function() {
      return {
        governorate: selectedGovernorate,
        zone: selectedArea
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
