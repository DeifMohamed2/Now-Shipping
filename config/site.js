/**
 * Public site identity — contact email shown on marketing pages, email footers, and transactional headers.
 * Override with SITE_CONTACT_EMAIL in the environment when needed.
 */
const contactEmail = process.env.SITE_CONTACT_EMAIL || 'info@now.com.eg';

module.exports = {
  contactEmail,
};
