const nodemailer = require('nodemailer');
const emailTemplates = require('./emailTemplates');
const { getEmailConfig } = require('./emailConfig');


class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter with professional settings
   */
  initializeTransporter() {
    const cfg = getEmailConfig();
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
      tls: { rejectUnauthorized: false },
      headers: {
        'X-Mailer': 'Order Company Platform',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
      },
    });

    // Verify transporter configuration
    this.transporter.verify((error, success) => {
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
   * Send professional email with template
   */
  async sendEmail(options) {
    try {
      const cfg = getEmailConfig();
      const mailOptions = {
        from: {
          name: 'Now Shipping',
          address: cfg.from,
        },
        to: options.email,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
        // Anti-spam headers
        headers: {
          'X-Mailer': 'Now Shipping Platform',
          'X-Priority': '3',
          'X-MSMail-Priority': 'Normal',
          'List-Unsubscribe': '<mailto:unsubscribe@ordercompany.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        },
        // Professional message ID
        messageId: `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@nowshipping.com>`
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${options.email}: ${result.messageId}`);
      return result;
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw error;
    }
  }

  /**
   * Send order delivery notification
   */
  async sendOrderDeliveryNotification(orderData, businessEmail) {
    const html = emailTemplates.getOrderDeliveryTemplate(orderData);
    
    return await this.sendEmail({
      email: businessEmail,
      subject: `🎉 Order Delivered - ${orderData.orderNumber}`,
      html: html
    });
  }

  /**
   * Send daily cash cycle summary
   */
  async sendDailyCashCycleSummary(businessData, ordersData, releaseData = null) {
    const html = emailTemplates.getDailyCashCycleTemplate(businessData, ordersData, releaseData);
    
    return await this.sendEmail({
      email: businessData.email,
      subject: `📊 Daily Cash Cycle Summary - ${new Date().toLocaleDateString()}`,
      html: html
    });
  }

  /**
   * Send money release notification
   */
  async sendMoneyReleaseNotification(releaseData, businessEmail) {
    const html = emailTemplates.getMoneyReleaseTemplate(releaseData);
    
    return await this.sendEmail({
      email: businessEmail,
      subject: `💰 Payment Released - ${releaseData.amount} EGP`,
      html: html
    });
  }

  /**
   * Send order status update
   */
  async sendOrderStatusUpdate(orderData, businessEmail) {
    const html = emailTemplates.getOrderStatusUpdateTemplate(orderData);
    
    return await this.sendEmail({
      email: businessEmail,
      subject: `📦 Order Status Update - ${orderData.orderNumber}`,
      html: html
    });
  }

  /**
   * Send welcome email to new business
   */
  async sendWelcomeEmail(businessData) {
    const html = emailTemplates.getWelcomeTemplate(businessData);
    
    return await this.sendEmail({
      email: businessData.email,
      subject: '🎉 Welcome to Order Company!',
      html: html
    });
  }

  /**
   * Send email verification
   */
  async sendVerificationEmail(user, token, baseUrl = process.env.BUSINESS_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:6098') {
    const verificationLink = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
    const html = emailTemplates.getEmailVerificationTemplate(user?.name, verificationLink);
    return await this.sendEmail({
      email: user.email,
      subject: 'Verify your email address',
      html,
    });
  }

  /**
   * Send custom professional email
   */
  async sendCustomEmail(email, subject, content, buttonText = null, buttonLink = null, additionalInfo = null) {
    const html = emailTemplates.getEmailBaseTemplate(subject, content, buttonText, buttonLink, additionalInfo);
    
    return await this.sendEmail({
      email: email,
      subject: subject,
      html: html
    });
  }

  /**
   * Send bulk emails to multiple businesses
   */
  async sendBulkEmails(emails, subject, content, buttonText = null, buttonLink = null) {
    const results = [];
    const errors = [];

    for (const email of emails) {
      try {
        const result = await this.sendCustomEmail(email, subject, content, buttonText, buttonLink);
        results.push({ email, success: true, messageId: result.messageId });
      } catch (error) {
        errors.push({ email, error: error.message });
      }
    }

    return { results, errors };
  }

  /**
   * Strip HTML tags for text version
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Send test email
   */
  async sendTestEmail(email) {
    const content = `
      <h2>🧪 Test Email</h2>
      <p>This is a test email from Order Company Platform.</p>
      <p>If you received this email, your email configuration is working correctly!</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    `;

    return await this.sendEmail({
      email: email,
      subject: '🧪 Now Shipping - Test Email',
      html: emailTemplates.getEmailBaseTemplate('Test Email', content)
    });
  }
}

// Create singleton instance
const emailService = new EmailService();

// Legacy function for backward compatibility
const sendEmail = async (options) => {
  return await emailService.sendEmail(options);
};

module.exports = {
  sendEmail,
  emailService,
  EmailService
};