/**
 * Public site identity — contact email, footers, transactional email metadata.
 * Override with SITE_* environment variables in production.
 */
const contactEmail = 'info@now.com.eg';

/** Public support phone shown in email footers (avoid fake placeholders). */
const publicPhone = '+201119177677';

/** Single line for registered / mailing address (optional, improves legitimacy). */
const physicalAddress = 'Cairo, Egypt';

/** Legal or display name for email footers. */
const legalEntityName = 'Now Shipping';

const socialFacebookUrl = 'https://www.facebook.com/share/1CRNE68xiL/?mibextid=wwXIfr';
/** Instagram — override with SITE_SOCIAL_INSTAGRAM_URL if the profile URL changes. */
const socialInstagramUrl ='https://www.instagram.com/now.co.eg?igsh=MWcxYzUzaG4wYW5jMg==';
const socialLinkedInUrl ='https://www.linkedin.com/company/now-shipping/';

module.exports = {
  contactEmail,
  publicPhone,
  physicalAddress,
  legalEntityName,
  socialFacebookUrl,
  socialInstagramUrl,
  socialLinkedInUrl,
};
