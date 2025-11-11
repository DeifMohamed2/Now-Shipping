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

  // Get current language helper
  function getCurrentLanguage() {
    // Try multiple sources for language detection
    const htmlLang = document.documentElement.lang;
    if (htmlLang && htmlLang !== 'en') return htmlLang;
    
    // Try cookie
    const cookies = document.cookie.split(';');
    const langCookie = cookies.find(cookie => cookie.trim().startsWith('language='));
    if (langCookie) {
      const lang = langCookie.split('=')[1].trim();
      if (lang && lang !== 'en') return lang;
    }
    
    // Try localStorage
    const storedLang = localStorage.getItem('language');
    if (storedLang && storedLang !== 'en') return storedLang;
    
    // Default to English
    return 'en';
  }

  // Load the regions data
  function loadRegionsData() {
    return fetch('/assets/js/bosta-regions-data-processed.json')
      .then(response => response.json())
      .then(data => {
        bostaRegionsData = data;
        renderGovernorates(data);
      })
      .catch(error => {
        console.error('Error loading regions data:', error);
      });
  }

  // Render governorates in the modal
  function renderGovernorates(data) {
    const governorateList = document.getElementById('governorateList');
    if (!governorateList) return;
    
    governorateList.innerHTML = '';
    
    // Filter to only show Cairo
    const cairoData = data['Cairo'] ? { 'Cairo': data['Cairo'] } : {};
    
    // Sort governorates alphabetically by English name
    const sortedGovernorates = Object.keys(cairoData).sort((a, b) => {
      return cairoData[a].label.en.localeCompare(cairoData[b].label.en);
    });
    
    sortedGovernorates.forEach(govValue => {
      const gov = cairoData[govValue];
      const governorateItem = document.createElement('div');
      governorateItem.className = 'governorate-item';
      governorateItem.dataset.governorate = govValue;
      
      // Get current language
      const currentLang = getCurrentLanguage();
      const govLabel = gov.label[currentLang] || gov.label.en;
      const areaCount = gov.areas.length;
      
      governorateItem.innerHTML = `
        <div class="governorate-header">
          <div style="display: flex; align-items: center;">
            <span>${govLabel}</span>
            <span class="area-count-badge">${areaCount}</span>
          </div>
          <i class="ri-arrow-down-s-line governorate-arrow"></i>
        </div>
        <div class="area-list">
          ${renderAreas(gov.areas)}
        </div>
      `;
      
      // Add click handler for the entire governorate card
      governorateItem.addEventListener('click', function(e) {
        // Don't toggle if clicking on an area item
        if (e.target.closest('.area-item')) return;
        
        // Toggle active state
        const isActive = governorateItem.classList.contains('active');
        document.querySelectorAll('.governorate-item').forEach(item => {
          item.classList.remove('active');
        });
        
        if (!isActive) {
          governorateItem.classList.add('active');
          // Smooth scroll to center the entire governorate card
          setTimeout(() => {
            governorateItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 150);
        }
      });
      
      governorateList.appendChild(governorateItem);
    });
  }

  // Render areas for a governorate
  function renderAreas(areas) {
    return areas.map((area, index) => {
      const currentLang = getCurrentLanguage();
      const areaLabel = area.label[currentLang] || area.label.en;
      return `
        <div class="area-item" data-area-value="${area.value}" data-area-index="${index}">
          <div class="area-item-text">
            <span>${areaLabel}</span>
            <i class="ri-check-line" style="display: none;"></i>
          </div>
        </div>
      `;
    }).join('');
  }

  // Add click handlers for areas
  document.addEventListener('click', function(e) {
    const areaItem = e.target.closest('.area-item');
    if (areaItem) {
      // Remove selection from all areas
      document.querySelectorAll('.area-item').forEach(item => {
        item.classList.remove('selected');
        const checkIcon = item.querySelector('i');
        if (checkIcon) checkIcon.style.display = 'none';
      });
      
      // Select clicked area
      areaItem.classList.add('selected');
      const checkIcon = areaItem.querySelector('i');
      if (checkIcon) checkIcon.style.display = 'block';
      
      selectedGovernorate = areaItem.closest('.governorate-item').dataset.governorate;
      selectedArea = areaItem.dataset.areaValue;
    }
  });

  // Search functionality
  function setupSearch() {
    const areaSearchInput = document.getElementById('areaSearchInput');
    if (!areaSearchInput) return;
    
    areaSearchInput.addEventListener('input', function() {
      const searchTerm = this.value.toLowerCase().trim();
      
      if (!searchTerm) {
        // Show all governorates and areas
        document.querySelectorAll('.governorate-item').forEach(item => {
          item.style.display = 'block';
        });
        document.querySelectorAll('.area-item').forEach(item => {
          item.style.display = 'block';
        });
        return;
      }
      
      // Hide all first
      document.querySelectorAll('.governorate-item').forEach(item => {
        item.style.display = 'none';
        item.classList.remove('active');
      });
      
      // Search through governorates and areas (only Cairo)
      const cairoData = bostaRegionsData['Cairo'];
      if (cairoData) {
        const gov = cairoData;
        const govMatches = gov.label.en.toLowerCase().includes(searchTerm) || 
                           gov.label.ar.includes(searchTerm);
        
        // Check if any area matches
        const matchingAreas = gov.areas.filter(area => 
          area.label.en.toLowerCase().includes(searchTerm) ||
          area.value.toLowerCase().includes(searchTerm) ||
          area.label.ar.includes(searchTerm)
        );
        
        if (govMatches || matchingAreas.length > 0) {
          const governorateItem = document.querySelector(`[data-governorate="Cairo"]`);
          if (governorateItem) {
            governorateItem.style.display = 'block';
            if (matchingAreas.length > 0) {
              governorateItem.classList.add('active');
            }
            
            // Highlight matching areas
            governorateItem.querySelectorAll('.area-item').forEach(item => {
              const areaValue = item.dataset.areaValue;
              const isMatch = matchingAreas.some(area => area.value === areaValue);
              item.style.display = isMatch ? 'block' : 'none';
            });
          }
        }
      }
    });
  }

  // Setup modal open/close handlers
  function setupModalHandlers() {
    // Open modal on button click
    document.addEventListener('click', function(e) {
      if (e.target.closest('.area-selection-trigger, #selectAreaBtn')) {
        const modal = document.getElementById('areaSelectionModal');
        if (modal) {
          const bsModal = new bootstrap.Modal(modal);
          bsModal.show();
        }
      }
    });

    // Confirm selection
    const confirmAreaSelection = document.getElementById('confirmAreaSelection');
    if (confirmAreaSelection) {
      confirmAreaSelection.addEventListener('click', function() {
        if (selectedGovernorate && selectedArea) {
          const gov = bostaRegionsData[selectedGovernorate];
          const area = gov.areas.find(a => a.value === selectedArea);
          
          if (gov && area) {
            // Get current language for display
            const currentLang = getCurrentLanguage();
            const displayText = `${area.label[currentLang] || area.label.en}, ${gov.label[currentLang] || gov.label.en}`;
            
            // Update display and hidden inputs
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
            
            // Call callback if provided first
            if (callbacks.onSelect) {
              callbacks.onSelect({
                governorate: selectedGovernorate,
                zone: selectedArea,
                displayText: displayText,
                data: { governorate: gov, area: area }
              });
            }
            
            // Close modal properly
            const modalElement = document.getElementById('areaSelectionModal');
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
              // Add event listener to clean up after modal is fully hidden
              modalElement.addEventListener('hidden.bs.modal', function cleanupModal() {
                // Remove any lingering backdrops
                document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                  backdrop.remove();
                });
                
                // Remove modal-open class from body
                document.body.classList.remove('modal-open');
                
                // Reset body styles
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                
                // Remove this event listener after it runs once
                modalElement.removeEventListener('hidden.bs.modal', cleanupModal);
              }, { once: true });
              
              modal.hide();
            } else {
              // Fallback if modal instance not found
              const bsModal = new bootstrap.Modal(modalElement);
              bsModal.hide();
              
              // Cleanup after animation
              setTimeout(() => {
                document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                  backdrop.remove();
                });
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
              }, 300);
            }
            
            // Trigger fees update if function exists
            if (typeof window.updateFees === 'function') {
              window.updateFees();
            }
          }
        } else {
          if (typeof Swal !== 'undefined') {
            Swal.fire({
              icon: 'warning',
              title: 'Please Select',
              text: 'Please select both a governorate and an area.'
            });
          }
        }
      });
    }
  }

  // Initialize the modal component
  function init() {
    loadRegionsData().then(() => {
      setupSearch();
      setupModalHandlers();
    });
  }

  // Public API
  window.AreaSelectionModal = {
    init: init,
    onSelect: function(callback) {
      callbacks.onSelect = callback;
    },
    onClose: function(callback) {
      callbacks.onClose = callback;
    },
    open: function() {
      const modal = document.getElementById('areaSelectionModal');
      if (modal) {
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
      }
    },
    getSelectedData: function() {
      return {
        governorate: selectedGovernorate,
        zone: selectedArea
      };
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);

