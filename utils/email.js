const nodemailer = require('nodemailer');
const emailTemplates = require('./emailTemplates');
const { getEmailConfig } = require('./emailConfig');
const site = require('../config/site');

/** SMTP From envelope address (EMAIL_FROM may be `Name <email@domain>`). */
function parseSmtpFromAddress(fromEnv) {
  const raw = String(fromEnv || '').trim();
  const m = raw.match(/<([^>]+)>/);
  return m ? m[1].trim() : raw;
}

/** Domain for Message-ID alignment with MAIL FROM / DKIM. */
function domainFromFromAddress(fromAddr) {
  const raw = String(fromAddr || '').trim();
  const angle = raw.match(/<([^>]+)>/);
  const addr = angle ? angle[1].trim() : raw;
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1) : 'localhost';
}

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    const cfg = getEmailConfig();
    const rejectUnauthorized = process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false';

    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
      tls: { rejectUnauthorized },
    });

    this.transporter.verify((error) => {
      if (error) {
        console.error('❌ Email transporter verification failed:', error.message);
        if (error.code === 'EAUTH') {
          console.log('🔧 Authentication Error: Check your EMAIL_USERNAME and EMAIL_PASSWORD');
          console.log('💡 For Gmail: Use App Password instead of regular password');
        } else if (error.code === 'ESOCKET') {
          console.log('🔧 Connection Error: Check your EMAIL_HOST and EMAIL_PORT');
        }
      } else {
        console.log('✅ Email transporter is ready to send messages');
      }
    });
  }

  /**
   * @param {object} options
   * @param {'transactional'|'marketing'} [options.category] transactional omits list-unsubscribe headers (account/security mail).
   */
  async sendEmail(options) {
    try {
      const cfg = getEmailConfig();
      const fromName = options.fromName || site.legalEntityName || 'Now Shipping';
      const category = options.category === 'marketing' ? 'marketing' : 'transactional';

      const replyToRaw = options.replyTo || process.env.EMAIL_REPLY_TO || site.contactEmail;
      const replyTo = String(replyToRaw).trim() || site.contactEmail;

      const smtpAddress = parseSmtpFromAddress(cfg.from);
      const msgDomain = domainFromFromAddress(cfg.from);
      const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 11)}@${msgDomain}>`;

      const headerObj = {
        'X-Mailer': 'Now Shipping',
        'MIME-Version': '1.0',
      };

      if (category === 'transactional') {
        headerObj.Precedence = 'normal';
      }

      if (category === 'marketing') {
        headerObj['List-Unsubscribe'] = `<mailto:${site.contactEmail}>`;
      }

      const mailOptions = {
        from: {
          name: fromName,
          address: smtpAddress,
        },
        replyTo,
        to: options.email,
        subject: options.subject,
        html: options.html,
        text:
          options.text !== undefined && options.text !== null
            ? options.text
            : this.stripHtml(options.html),
        headers: headerObj,
        messageId,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${options.email}: ${result.messageId}`);
      return result;
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw error;
    }
  }

  async sendOrderDeliveryNotification(orderData, businessEmail) {
    const html = emailTemplates.getOrderDeliveryTemplate(orderData);

    return await this.sendEmail({
      email: businessEmail,
      subject: `Order delivered — ${orderData.orderNumber}`,
      html,
      category: 'transactional',
    });
  }

  async sendDailyCashCycleSummary(businessData, ordersData, releaseData = null) {
    const html = emailTemplates.getDailyCashCycleTemplate(businessData, ordersData, releaseData);

    return await this.sendEmail({
      email: businessData.email,
      subject: `Daily cash cycle summary — ${new Date().toLocaleDateString()}`,
      html,
      category: 'transactional',
    });
  }

  async sendMoneyReleaseNotification(releaseData, businessEmail) {
    const html = emailTemplates.getMoneyReleaseTemplate(releaseData);

    return await this.sendEmail({
      email: businessEmail,
      subject: `Payment released — ${releaseData.amount} EGP`,
      html,
      category: 'transactional',
    });
  }

  async sendOrderStatusUpdate(orderData, businessEmail) {
    const html = emailTemplates.getOrderStatusUpdateTemplate(orderData);

    return await this.sendEmail({
      email: businessEmail,
      subject: `Order status update — ${orderData.orderNumber}`,
      html,
      category: 'transactional',
    });
  }

  async sendWelcomeEmail(businessData) {
    const html = emailTemplates.getWelcomeTemplate(businessData);

    return await this.sendEmail({
      email: businessData.email,
      subject: 'Welcome to Now Shipping',
      html,
      category: 'transactional',
    });
  }

  async sendVerificationEmail(user, token, baseUrl = process.env.APP_BASE_URL || 'http://localhost:6098') {
    const verificationLink = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
    const html = emailTemplates.getEmailVerificationTemplate(user?.name, verificationLink);
    const text = emailTemplates.getVerificationPlainText(user?.name, verificationLink);

    return await this.sendEmail({
      email: user.email,
      subject: 'Confirm your email address — Now Shipping',
      html,
      text,
      category: 'transactional',
    });
  }

  async sendPasswordResetOtp(toEmail, otp, businessDisplayName) {
    const display = (businessDisplayName || '').trim() || 'Now Shipping';
    const html = emailTemplates.getPasswordResetOtpTemplate(display, otp);
    const text = emailTemplates.getPasswordResetPlainText(display, otp);

    return await this.sendEmail({
      email: toEmail,
      subject: `${display} — Password reset code`,
      html,
      text,
      fromName: display,
      category: 'transactional',
    });
  }

  async sendCustomEmail(
    email,
    subject,
    content,
    buttonText = null,
    buttonLink = null,
    additionalInfo = null,
    category = 'transactional',
    text = null,
    preheader = null
  ) {
    const html = emailTemplates.getEmailBaseTemplate(
      subject,
      content,
      buttonText,
      buttonLink,
      additionalInfo,
      preheader
    );

    return await this.sendEmail({
      email,
      subject,
      html,
      text: text !== undefined && text !== null ? text : undefined,
      category,
    });
  }

  async sendBulkEmails(emails, subject, content, buttonText = null, buttonLink = null) {
    const results = [];
    const errors = [];

    for (const email of emails) {
      try {
        const result = await this.sendCustomEmail(
          email,
          subject,
          content,
          buttonText,
          buttonLink,
          null,
          'marketing'
        );
        results.push({ email, success: true, messageId: result.messageId });
      } catch (error) {
        errors.push({ email, error: error.message });
      }
    }

    return { results, errors };
  }

  stripHtml(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async sendTestEmail(email) {
    const content = `
      <h2>Test email</h2>
      <p>This is a test message from Now Shipping.</p>
      <p>If you received this email, your outbound configuration is working.</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    `;

    return await this.sendEmail({
      email,
      subject: 'Now Shipping — Test email',
      html: emailTemplates.getEmailBaseTemplate('Test email', content),
      category: 'transactional',
    });
  }
}

const emailService = new EmailService();

const sendEmail = async (options) => {
  return await emailService.sendEmail(options);
};

module.exports = {
  sendEmail,
  emailService,
  EmailService,
};
