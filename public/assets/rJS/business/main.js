function toggleHamburgerIcon() {
  const width = document.documentElement.clientWidth;
  const layout = document.documentElement.getAttribute('data-layout');
  const sidebarSize =
    document.documentElement.getAttribute('data-sidebar-size');
  const hamburgerIcon = document.querySelector('.hamburger-icon');
  const body = document.body;

  if (width > 767) {
    hamburgerIcon.classList.toggle('open');
  }

  if (layout === 'horizontal') {
    body.classList.toggle('menu');
  } else if (layout === 'vertical') {
    if (width <= 1025 && width > 767) {
      body.classList.remove('vertical-sidebar-enable');
      document.documentElement.setAttribute(
        'data-sidebar-size',
        sidebarSize === 'sm' ? '' : 'sm'
      );
    } else if (width > 1025) {
      body.classList.remove('vertical-sidebar-enable');
      document.documentElement.setAttribute(
        'data-sidebar-size',
        sidebarSize === 'lg' ? 'sm' : 'lg'
      );
    } else if (width <= 767) {
      body.classList.add('vertical-sidebar-enable');
      document.documentElement.setAttribute('data-sidebar-size', 'lg');
    }
  } else if (layout === 'semibox') {
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
        document.getElementById('sidebar-visibility-show').click();
        document.documentElement.setAttribute('data-sidebar-size', sidebarSize);
      }
    } else if (width <= 767) {
      body.classList.add('vertical-sidebar-enable');
      document.documentElement.setAttribute('data-sidebar-size', 'lg');
    }
  } else if (layout === 'twocolumn') {
    body.classList.toggle('twocolumn-panel');
  }
}

const topnavHamburgerIcon = document.getElementById('topnav-hamburger-icon');
if (topnavHamburgerIcon) {
  topnavHamburgerIcon.addEventListener('click', toggleHamburgerIcon);
}

document.addEventListener('DOMContentLoaded', function () {
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
});

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
  elements.forEach((element) => {
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
  langElements.forEach((element) => {
    element.addEventListener('click', function () {
      const lang = element.getAttribute('data-lang');
      setLanguage(lang);
    });
  });
});
