// Centralized email configuration
// Reads both EMAIL_* and SMTP_* environment variables with sensible defaults

function getEmailConfig() {
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 465);
  const secure = port === 465 || (process.env.EMAIL_SECURE || process.env.SMTP_SECURE || 'true') === 'true';
  const user = process.env.EMAIL_USERNAME || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASSWORD || process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || 'no-reply@nowshipping.com';

  return {
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    from,
  };
}

module.exports = {
  getEmailConfig,
};