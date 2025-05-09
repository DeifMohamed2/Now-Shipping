!(function () {
  'use strict';
  if (sessionStorage.getItem('defaultAttribute')) {
    var t = document.documentElement.attributes,
      e = {};
    if (
      (Object.entries(t).forEach(function (t) {
        if (t[1] && t[1].nodeName && 'undefined' != t[1].nodeName) {
          var a = t[1].nodeName;
          e[a] = t[1].nodeValue;
        }
      }),
      sessionStorage.getItem('defaultAttribute') !== JSON.stringify(e))
    )
      sessionStorage.clear(), window.location.reload();
    else {
      var a = {};
      (a['data-layout'] = sessionStorage.getItem('data-layout')),
        (a['data-sidebar-size'] = sessionStorage.getItem('data-sidebar-size')),
        (a['data-bs-theme'] = sessionStorage.getItem('data-bs-theme')),
        (a['data-layout-width'] = sessionStorage.getItem('data-layout-width')),
        (a['data-sidebar'] = sessionStorage.getItem('data-sidebar')),
        (a['data-sidebar-image'] =
          sessionStorage.getItem('data-sidebar-image')),
        (a['data-layout-direction'] = sessionStorage.getItem(
          'data-layout-direction'
        )),
        (a['data-layout-position'] = sessionStorage.getItem(
          'data-layout-position'
        )),
        (a['data-layout-style'] = sessionStorage.getItem('data-layout-style')),
        (a['data-topbar'] = sessionStorage.getItem('data-topbar')),
        (a['data-preloader'] = sessionStorage.getItem('data-preloader')),
        (a['data-body-image'] = sessionStorage.getItem('data-body-image')),
        (a['data-theme'] = sessionStorage.getItem('data-theme')),
        (a['data-theme-colors'] = sessionStorage.getItem('data-theme-colors')),
        Object.keys(a).forEach(function (t) {
          a[t] && a[t] && document.documentElement.setAttribute(t, a[t]);
        });
    }
  }
})();
