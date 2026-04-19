/**
 * Shared admin table row dropdowns (same behavior as Orders list).
 * Markup: .orders-table-dropdown > button[data-dropdown-toggle] + ul.dropdown-menu
 */
(function () {
  'use strict';

  var initialized = false;
  var scrollHandlerBound = false;

  function getScrollParent(dropdown) {
    return (
      dropdown.closest('.admin-table-scroll') ||
      dropdown.closest('.admin-orders-table-wrap') ||
      dropdown.closest('.table-responsive')
    );
  }

  function adjustAdminDropdownPosition(dropdown) {
    var menu = dropdown.querySelector('.dropdown-menu');
    if (!menu) return;

    var rect = dropdown.getBoundingClientRect();
    var viewportHeight = window.innerHeight;
    var menuHeight = menu.offsetHeight || 200;

    var spaceBelow = viewportHeight - rect.bottom;
    var spaceAbove = rect.top;

    if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
      dropdown.classList.add('dropdown-up');
    } else {
      dropdown.classList.remove('dropdown-up');
    }

    var tableContainer = getScrollParent(dropdown);
    if (tableContainer) {
      var tableRect = tableContainer.getBoundingClientRect();
      if (rect.bottom + menuHeight > tableRect.bottom) {
        dropdown.classList.add('dropdown-up');
      }
    }
  }

  function openAdminDropdown(dropdown) {
    dropdown.classList.add('show');
    var toggle = dropdown.querySelector('[data-dropdown-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    adjustAdminDropdownPosition(dropdown);
  }

  function closeAdminDropdown(dropdown) {
    dropdown.classList.remove('show');
    var toggle = dropdown.querySelector('[data-dropdown-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function repositionOpen() {
    document.querySelectorAll('.orders-table-dropdown.show').forEach(adjustAdminDropdownPosition);
  }

  function bindScrollContainers() {
    if (scrollHandlerBound) return;
    scrollHandlerBound = true;

    function attach() {
      var sel =
        '.admin-table-scroll, .admin-orders-table-wrap, .table-responsive';
      document.querySelectorAll(sel).forEach(function (el) {
        if (el._adminDropdownScrollBound) return;
        el._adminDropdownScrollBound = true;
        el.addEventListener('scroll', repositionOpen);
      });
    }

    attach();

    var mo = new MutationObserver(function () {
      attach();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('click', function (event) {
      var clickedToggle = event.target.closest('[data-dropdown-toggle]');
      var clickedMenuItem = event.target.closest('.dropdown-item');
      var clickedMenu = event.target.closest('.dropdown-menu');
      var clickedDropdown = event.target.closest('.orders-table-dropdown');

      if (clickedToggle) {
        return;
      }

      if (clickedMenu) {
        if (clickedMenuItem) {
          var parentDropdown = clickedMenuItem.closest('.orders-table-dropdown');
          if (parentDropdown) {
            setTimeout(function () {
              if (parentDropdown.classList.contains('show')) {
                closeAdminDropdown(parentDropdown);
              }
            }, 150);
          }
        }
        return;
      }

      document.querySelectorAll('.orders-table-dropdown').forEach(function (dropdown) {
        if (dropdown !== clickedDropdown && !dropdown.contains(event.target)) {
          closeAdminDropdown(dropdown);
        }
      });
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('[data-dropdown-toggle]')) return;
      event.preventDefault();
      event.stopPropagation();

      var dropdown = event.target.closest('.orders-table-dropdown');
      if (!dropdown) return;

      var isOpen = dropdown.classList.contains('show');
      document.querySelectorAll('.orders-table-dropdown.show').forEach(function (d) {
        if (d !== dropdown) closeAdminDropdown(d);
      });

      if (isOpen) {
        closeAdminDropdown(dropdown);
      } else {
        openAdminDropdown(dropdown);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        document.querySelectorAll('.orders-table-dropdown.show').forEach(closeAdminDropdown);
      }
    });

    window.addEventListener('resize', repositionOpen);
    window.addEventListener('scroll', repositionOpen, true);

    bindScrollContainers();
  }

  /**
   * Wire #checkAll with row checkboxes name="checkAll[]" inside tableEl (selector or element).
   * Optional onSelectionChange() runs after header sync (e.g. show/hide bulk toolbar).
   */
  function bindTableSelection(tableEl, checkAllEl, onSelectionChange) {
    var table =
      typeof tableEl === 'string' ? document.querySelector(tableEl) : tableEl;
    var checkAll =
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
          console.error('AdminTableDropdowns bindTableSelection callback', err);
        }
      }
    }

    function syncHeader() {
      var boxes = rowBoxes();
      var n = boxes.length;
      var checked = 0;
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

  window.AdminTableDropdowns = {
    init: init,
    adjustPosition: adjustAdminDropdownPosition,
    open: openAdminDropdown,
    close: closeAdminDropdown,
    bindTableSelection: bindTableSelection,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
