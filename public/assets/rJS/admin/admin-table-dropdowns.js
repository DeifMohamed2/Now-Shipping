/**
 * Shared admin table row dropdowns (same behavior as Orders list).
 * Markup: .orders-table-dropdown > button[data-dropdown-toggle] + ul.dropdown-menu
 * Open menus are portaled to document.body with fixed positioning to escape overflow clipping.
 */
(function () {
  'use strict';

  if (window.__AdminTableDropdownsInitialized) {
    return;
  }
  window.__AdminTableDropdownsInitialized = true;

  var initialized = false;
  var scrollHandlerBound = false;

  function getMenu(dropdown) {
    var menu = dropdown.querySelector('.dropdown-menu');
    if (menu) return menu;
    if (dropdown._adminPortaledMenu) return dropdown._adminPortaledMenu;
    return null;
  }

  function positionPortaledMenu(dropdown, menu) {
    var toggle = dropdown.querySelector('[data-dropdown-toggle]');
    if (!toggle || !menu) return;

    menu.style.visibility = 'hidden';
    menu.style.display = 'block';

    var rect = toggle.getBoundingClientRect();
    var menuHeight = menu.offsetHeight || 200;
    var menuWidth = menu.offsetWidth || 216;
    var gap = 4;
    var openUp =
      rect.bottom + menuHeight + gap > window.innerHeight &&
      rect.top > menuHeight + gap;

    dropdown.classList.toggle('dropdown-up', openUp);

    var top = openUp ? rect.top - menuHeight - gap : rect.bottom + gap;
    var left = rect.right - menuWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8));

    menu.style.position = 'fixed';
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.zIndex = '1080';
    menu.style.visibility = 'visible';
  }

  function portalMenu(dropdown) {
    var menu = getMenu(dropdown);
    if (!menu) return null;
    if (menu._adminDropdownPortaled && menu._adminDropdownOwner === dropdown) {
      return menu;
    }
    if (menu._adminDropdownPortaled) return menu;

    menu._adminDropdownOwner = dropdown;
    menu._adminDropdownOriginalParent = dropdown;
    menu._adminDropdownOriginalNext = menu.nextSibling;
    document.body.appendChild(menu);
    menu.classList.add('orders-table-dropdown-menu--fixed');
    menu._adminDropdownPortaled = true;
    return menu;
  }

  function unportalMenu(dropdown) {
    var menu = dropdown._adminPortaledMenu || getMenu(dropdown);
    if (!menu || !menu._adminDropdownPortaled) return;

    menu.classList.remove('orders-table-dropdown-menu--fixed');
    menu.style.cssText = '';
    menu._adminDropdownPortaled = false;

    var parent = menu._adminDropdownOriginalParent || dropdown;
    if (menu._adminDropdownOriginalNext && menu._adminDropdownOriginalNext.parentNode === parent) {
      parent.insertBefore(menu, menu._adminDropdownOriginalNext);
    } else {
      parent.appendChild(menu);
    }

    delete menu._adminDropdownOwner;
    delete menu._adminDropdownOriginalParent;
    delete menu._adminDropdownOriginalNext;
    delete dropdown._adminPortaledMenu;
  }

  function adjustAdminDropdownPosition(dropdown) {
    var menu = dropdown._adminPortaledMenu || getMenu(dropdown);
    if (!menu || !dropdown.classList.contains('show')) return;
    if (menu._adminDropdownPortaled) {
      positionPortaledMenu(dropdown, menu);
    }
  }

  function openAdminDropdown(dropdown) {
    dropdown.classList.add('show');
    var toggle = dropdown.querySelector('[data-dropdown-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');

    var menu = portalMenu(dropdown);
    dropdown._adminPortaledMenu = menu;
    if (menu) {
      menu.style.display = 'block';
      positionPortaledMenu(dropdown, menu);
    }
  }

  function closeAdminDropdown(dropdown) {
    dropdown.classList.remove('show');
    dropdown.classList.remove('dropdown-up');
    var toggle = dropdown.querySelector('[data-dropdown-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    unportalMenu(dropdown);
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

  function findDropdownFromEventTarget(target) {
    var dd = target.closest('.orders-table-dropdown');
    if (dd) return dd;
    var menu = target.closest('.orders-table-dropdown-menu--fixed');
    if (menu && menu._adminDropdownOwner) return menu._adminDropdownOwner;
    return null;
  }

  function init() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('click', function (event) {
      var clickedToggle = event.target.closest('[data-dropdown-toggle]');
      var clickedMenuItem = event.target.closest('.dropdown-item');
      var clickedMenu = event.target.closest('.dropdown-menu');
      var clickedDropdown = findDropdownFromEventTarget(event.target);

      if (clickedToggle) {
        return;
      }

      if (clickedMenu) {
        if (clickedMenuItem) {
          var parentDropdown =
            clickedMenu._adminDropdownOwner ||
            clickedMenuItem.closest('.orders-table-dropdown');
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
