(function () {
  'use strict';

  const HAMBURGER_BTN_ID = 'topnav-hamburger-icon';

  function getHamburgerIcon() {
    return document.querySelector('.hamburger-icon');
  }

  function updateHamburgerAria() {
    const btn = document.getElementById(HAMBURGER_BTN_ID);
    if (!btn) return;
    const sidebarOpen = document.body.classList.contains(
      'vertical-sidebar-enable'
    );
    btn.setAttribute('aria-expanded', sidebarOpen ? 'true' : 'false');
  }

  /** On small screens, `.open` on `.hamburger-icon` must match drawer only (not Velzon’s “always open” tablet hint). */
  function syncMobileHamburgerIcon() {
    const width = document.documentElement.clientWidth;
    const icon = getHamburgerIcon();
    if (!icon || width > 767) return;
    icon.classList.toggle(
      'open',
      document.body.classList.contains('vertical-sidebar-enable')
    );
  }

  function closeMobileSidebar() {
    document.body.classList.remove('vertical-sidebar-enable');
    syncMobileHamburgerIcon();
    updateHamburgerAria();
  }

  function toggleHamburgerIcon() {
    const width = document.documentElement.clientWidth;
    const layout = document.documentElement.getAttribute('data-layout');
    const sidebarSize =
      document.documentElement.getAttribute('data-sidebar-size');
    const hamburgerIcon = getHamburgerIcon();
    const body = document.body;

    if (layout === 'horizontal') {
      body.classList.toggle('menu');
      return;
    }

    if (layout === 'vertical') {
      if (width <= 767) {
        body.classList.toggle('vertical-sidebar-enable');
        document.documentElement.setAttribute('data-sidebar-size', 'lg');
        syncMobileHamburgerIcon();
        updateHamburgerAria();
        return;
      }
      if (hamburgerIcon) hamburgerIcon.classList.toggle('open');
      if (width <= 1025 && width > 767) {
        body.classList.remove('vertical-sidebar-enable');
        document.documentElement.setAttribute(
          'data-sidebar-size',
          sidebarSize === 'sm' ? '' : 'sm'
        );
        return;
      }
      if (width > 1025) {
        body.classList.remove('vertical-sidebar-enable');
        document.documentElement.setAttribute(
          'data-sidebar-size',
          sidebarSize === 'lg' ? 'sm' : 'lg'
        );
      }
      return;
    }

    if (layout === 'semibox') {
      if (width > 767) {
        if (
          document.documentElement.getAttribute('data-sidebar-visibility') ===
          'show'
        ) {
          document.documentElement.setAttribute(
            'data-sidebar-size',
            sidebarSize === 'lg' ? 'sm' : 'lg'
          );
        } else {
          const visBtn = document.getElementById('sidebar-visibility-show');
          if (visBtn) visBtn.click();
          document.documentElement.setAttribute('data-sidebar-size', sidebarSize);
        }
      } else if (width <= 767) {
        body.classList.toggle('vertical-sidebar-enable');
        document.documentElement.setAttribute('data-sidebar-size', 'lg');
        syncMobileHamburgerIcon();
        updateHamburgerAria();
      }
      return;
    }

    if (layout === 'twocolumn') {
      body.classList.toggle('twocolumn-panel');
    }
  }

  /** Align sidebar state with viewport (Velzon-style), vertical layout only */
  function applyResponsiveSidebar() {
    const layout = document.documentElement.getAttribute('data-layout');
    if (layout !== 'vertical') return;

    const width = document.documentElement.clientWidth;
    const hamburgerIcon = getHamburgerIcon();

    if (width < 1025 && width > 767) {
      document.body.classList.remove('twocolumn-panel');
      document.body.classList.remove('vertical-sidebar-enable');
      document.documentElement.setAttribute('data-sidebar-size', 'sm');
      if (hamburgerIcon) hamburgerIcon.classList.add('open');
    } else if (width >= 1025) {
      document.body.classList.remove('twocolumn-panel');
      document.body.classList.remove('vertical-sidebar-enable');
      const stored =
        typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem('data-sidebar-size');
      document.documentElement.setAttribute(
        'data-sidebar-size',
        stored && ['lg', 'sm'].includes(stored) ? stored : 'lg'
      );
      if (hamburgerIcon) hamburgerIcon.classList.remove('open');
    } else if (width <= 767) {
      document.body.classList.remove('vertical-sidebar-enable');
      document.documentElement.setAttribute('data-sidebar-size', 'lg');
      if (hamburgerIcon) hamburgerIcon.classList.remove('open');
    }
    if (width <= 767) {
      syncMobileHamburgerIcon();
    }
    updateHamburgerAria();
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyResponsiveSidebar, 120);
  }

  function initShell() {
    const topnavHamburgerIcon = document.getElementById(HAMBURGER_BTN_ID);
    if (topnavHamburgerIcon) {
      topnavHamburgerIcon.addEventListener('click', toggleHamburgerIcon);
    }

    document.querySelector('.vertical-overlay')?.addEventListener('click', function () {
      closeMobileSidebar();
      const layout = document.documentElement.getAttribute('data-layout');
      if (layout === 'twocolumn') {
        document.body.classList.remove('twocolumn-panel');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('vertical-sidebar-enable')) {
        closeMobileSidebar();
      }
    });

    document.querySelectorAll('.app-menu a.nav-link, .app-menu .nav-link').forEach(function (el) {
      el.addEventListener('click', function () {
        if (document.documentElement.clientWidth <= 767) {
          closeMobileSidebar();
        }
      });
    });

    document
      .getElementById('sidebar-mobile-close')
      ?.addEventListener('click', closeMobileSidebar);

    window.addEventListener('resize', onResize);
    applyResponsiveSidebar();
    updateHamburgerAria();

    const langDropdown = document.querySelector(
      '.topbar-head-dropdown .dropdown-menu'
    );
    if (langDropdown) {
      langDropdown.addEventListener('click', function (event) {
        if (event.target && event.target.matches('.dropdown-item')) {
          const selectedLang = event.target.getAttribute('data-lang');
          document.documentElement.setAttribute('lang', selectedLang);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell);
  } else {
    initShell();
  }
})();

function setLanguage(lang) {
  const headerLangImg = document.getElementById('header-lang-img');
  if (headerLangImg) {
    switch (lang) {
      case 'en':
        headerLangImg.src = '/assets/images/flags/us.svg';
        break;
      case 'ar':
        headerLangImg.src = '/assets/images/flags/ae.svg';
        break;
    }
    localStorage.setItem('language', lang);
    loadLanguageFile(lang);
  }
}

function loadLanguageFile(lang) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/assets/lang/${lang}.json`);
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4 && xhr.status === 200) {
      const langData = JSON.parse(xhr.responseText);
      applyLanguage(langData);
    }
  };
  xhr.send();
}

function applyLanguage(langData) {
  const elements = document.querySelectorAll('[data-key]');
  elements.forEach(function (element) {
    const key = element.getAttribute('data-key');
    if (langData[key]) {
      element.textContent = langData[key];
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const defaultLang = 'en';
  const savedLang = localStorage.getItem('language') || defaultLang;
  setLanguage(savedLang);

  const langElements = document.querySelectorAll('.language');
  langElements.forEach(function (element) {
    element.addEventListener('click', function () {
      const lang = element.getAttribute('data-lang');
      setLanguage(lang);
    });
  });
});
