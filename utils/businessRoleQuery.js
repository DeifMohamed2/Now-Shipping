/**
 * Business users are stored with role "Business" at signup (authController)
 * while some queries used "business". MongoDB string equality is case-sensitive.
 * Use this filter so User queries match both values.
 */
function businessRoleFilter() {
  return { role: { $in: ['business', 'Business'] } };
}

/** Active (non-deleted) business accounts for listings and login. */
function activeBusinessRoleFilter() {
  return {
    ...businessRoleFilter(),
    isDeleted: { $ne: true },
  };
}

/** Eligible mobile-app business recipients for push notifications (excludes company API parents). */
function businessNotificationRecipientFilter() {
  return {
    ...activeBusinessRoleFilter(),
    isCompleted: true,
    isCompanyAccount: { $ne: true },
  };
}

module.exports = {
  businessRoleFilter,
  activeBusinessRoleFilter,
  businessNotificationRecipientFilter,
};
