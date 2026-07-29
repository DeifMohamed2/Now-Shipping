/**
 * Render the branded 404 page with the correct layout and home link per area.
 */
function resolveNotFoundContext(req, overrides = {}) {
  const url = req.originalUrl || req.url || '';
  let layout = 'layouts/layout-without-nav';
  let homeHref = '/';
  let homeLabel = 'Back to home';

  if (url.startsWith('/business')) {
    layout = 'layouts/layout';
    homeHref = '/business/dashboard';
    homeLabel = 'Go to Dashboard';
  } else if (url.startsWith('/admin')) {
    layout = 'layouts/admin-layout';
    homeHref = '/admin/dashboard';
    homeLabel = 'Go to Dashboard';
  } else if (url.startsWith('/courier')) {
    layout = 'layouts/courier-layout';
    homeHref = '/mobileApp';
    homeLabel = 'Back to app';
  } else if (url.startsWith('/manage')) {
    layout = 'layouts/admin-layout';
    homeHref = '/manage/dashboard';
    homeLabel = 'Go to Dashboard';
  }

  return {
    layout,
    title: overrides.title || 'Page not found',
    page_title: overrides.page_title || '404 — Page not found',
    requestedUrl: overrides.requestedUrl ?? url,
    homeHref: overrides.homeHref || homeHref,
    homeLabel: overrides.homeLabel || homeLabel,
    notFoundTitle: overrides.notFoundTitle,
    notFoundSubtitle: overrides.notFoundSubtitle,
    ...overrides,
  };
}

function renderNotFound(req, res, overrides = {}) {
  const status = overrides.status || 404;
  const ctx = resolveNotFoundContext(req, overrides);
  return res.status(status).render('errors/not-found', ctx);
}

module.exports = { renderNotFound, resolveNotFoundContext };
