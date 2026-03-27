/**
 * Business users are stored with role "Business" at signup (authController2)
 * while some queries used "business". MongoDB string equality is case-sensitive.
 * Use this filter so User queries match both values.
 */
function businessRoleFilter() {
  return { role: { $in: ['business', 'Business'] } };
}

module.exports = { businessRoleFilter };
