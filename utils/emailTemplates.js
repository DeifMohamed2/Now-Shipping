/**
 * Professional Email Templates for Order Company Platform
 * 
 * This module contains professional HTML email templates with:
 * - Responsive design
 * - Company branding
 * - Professional styling
 * - Anti-spam optimization
 * - Mobile-friendly layouts
 */

const site = require('../config/site');

/** Matches business dashboard palette ([public/assets/rCSS/business-dashboard.css]) */
const EMAIL_THEME = {
  primary: '#F5A623',
  primaryDark: '#e8890f',
  pageBg: '#F8FAFC',
  cardBg: '#ffffff',
  text: '#1E293B',
  muted: '#64748B',
  footerDark: '#0F172A',
  linkBlue: '#4b9fda',
  borderSubtle: '#e2e8f0',
  highlightBg: '#F8FAFC',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Rounded CTA: table + bgcolor + inline white on anchor (fixes blue link text in clients).
 */
function renderBulletproofButton(href, label) {
  const safeHref = escapeAttr(href);
  const safeLabel = escapeHtml(label);
  const bg = EMAIL_THEME.primary;
  return `
<!-- CTA -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:28px auto;">
  <tr>
    <td align="center" bgcolor="${bg}" style="border-radius:12px;background:${bg};mso-padding-alt:14px 32px;">
      <a href="${safeHref}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;color:#ffffff !important;text-decoration:none;border-radius:12px;background:${bg};">${safeLabel}</a>
    </td>
  </tr>
</table>`;
}

/**
 * Table-based footer: contact line + optional social profile links as text (no remote images).
 */
function buildFooterBlock() {
  const brand = escapeHtml(site.legalEntityName || 'Now Shipping');
  const mailto = escapeAttr(site.contactEmail);
  const mailLabel = escapeHtml(site.contactEmail);

  const linkStyle =
    'color:rgba(255,255,255,0.92);text-decoration:underline;font-size:13px;font-weight:500;';
  const sep = `<span style="color:rgba(255,255,255,0.35);margin:0 10px;">·</span>`;

  const socialParts = [];
  if (site.socialFacebookUrl && String(site.socialFacebookUrl).trim()) {
    const u = escapeAttr(site.socialFacebookUrl.trim());
    socialParts.push(`<a href="${u}" title="Facebook" style="${linkStyle}">Facebook</a>`);
  }
  if (site.socialInstagramUrl && String(site.socialInstagramUrl).trim()) {
    const u = escapeAttr(site.socialInstagramUrl.trim());
    socialParts.push(`<a href="${u}" title="Instagram" style="${linkStyle}">Instagram</a>`);
  }
  if (site.socialLinkedInUrl && String(site.socialLinkedInUrl).trim()) {
    const u = escapeAttr(site.socialLinkedInUrl.trim());
    socialParts.push(`<a href="${u}" title="LinkedIn" style="${linkStyle}">LinkedIn</a>`);
  }

  const socialRow =
    socialParts.length > 0
      ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;">${socialParts.join(sep)}</p>`
      : '';

  const phoneLine =
    site.publicPhone && String(site.publicPhone).trim()
      ? `<p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.82);">${escapeHtml(site.publicPhone.trim())}</p>`
      : '';

  const addressBlock =
    site.physicalAddress && String(site.physicalAddress).trim()
      ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.72);">${escapeHtml(site.physicalAddress.trim())}</p>`
      : '';

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_THEME.footerDark};border-top:3px solid ${EMAIL_THEME.primary};">
  <tr>
    <td style="padding:28px 24px 32px;text-align:center;">
      <p style="margin:0 0 6px;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">${brand}</p>
      <p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,0.75);">Your trusted delivery partner</p>
      <p style="margin:0;font-size:14px;">
        <a href="mailto:${mailto}" style="color:#ffffff;text-decoration:underline;">${mailLabel}</a>
      </p>
      ${phoneLine}
      ${addressBlock}
      ${socialRow}
    </td>
  </tr>
</table>`;
}

const getEmailBaseTemplate = (
  title,
  content,
  buttonText = null,
  buttonLink = null,
  additionalInfo = null,
  preheader = null
) => {
  const T = EMAIL_THEME;
  const preheaderBlock =
    preheader && String(preheader).trim()
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
  ${escapeHtml(String(preheader).trim())}
</div>`
      : '';

  const ctaBlock =
    buttonText && buttonLink ? renderBulletproofButton(buttonLink, buttonText) : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${escapeHtml(title)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.65;
            color: ${T.text};
            background-color: ${T.pageBg};
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }

        .email-shell {
            max-width: 600px;
            margin: 0 auto;
            background-color: ${T.cardBg};
            border-radius: 16px 16px 0 0;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(15, 23, 42, 0.07);
        }

        .email-header {
            background: linear-gradient(135deg, ${T.primary} 0%, ${T.primaryDark} 100%);
            padding: 32px 24px;
            text-align: center;
            color: #ffffff;
        }

        .email-header h1 {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.02em;
        }

        .email-header p {
            font-size: 15px;
            opacity: 0.95;
            margin: 0;
            font-weight: 500;
        }

        .email-body {
            padding: 36px 28px 40px;
        }

        .email-content {
            font-size: 16px;
            line-height: 1.75;
            color: ${T.text};
            margin-bottom: 8px;
        }

        .email-content h2 {
            color: ${T.primary};
            font-size: 22px;
            margin-bottom: 18px;
            font-weight: 700;
            letter-spacing: -0.02em;
        }

        .email-content h3 {
            color: ${T.linkBlue};
            font-size: 18px;
            margin: 22px 0 12px 0;
            font-weight: 600;
        }

        .email-content p {
            margin-bottom: 14px;
        }

        .highlight-box {
            background-color: ${T.highlightBg};
            border-left: 4px solid ${T.primary};
            padding: 18px 20px;
            margin: 20px 0;
            border-radius: 0 12px 12px 0;
        }

        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin: 20px 0;
        }

        .info-item {
            background-color: ${T.highlightBg};
            padding: 14px;
            border-radius: 10px;
            border: 1px solid ${T.borderSubtle};
        }

        .info-label {
            font-weight: 600;
            color: ${T.linkBlue};
            font-size: 13px;
            margin-bottom: 6px;
        }

        .info-value {
            font-size: 15px;
            color: ${T.text};
        }

        .order-details {
            background-color: ${T.cardBg};
            border: 1px solid ${T.borderSubtle};
            border-radius: 12px;
            padding: 18px;
            margin: 18px 0;
        }

        .order-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid ${T.borderSubtle};
        }

        .order-item:last-child {
            border-bottom: none;
        }

        .order-item-label {
            font-weight: 600;
            color: ${T.linkBlue};
            font-size: 14px;
        }

        .order-item-value {
            color: ${T.text};
            font-weight: 500;
            font-size: 15px;
            text-align: right;
        }

        .total-amount {
            background: linear-gradient(135deg, ${T.primary} 0%, ${T.primaryDark} 100%);
            color: #ffffff;
            padding: 22px;
            border-radius: 12px;
            text-align: center;
            margin: 20px 0;
        }

        .total-amount h3 {
            color: #ffffff;
            font-size: 20px;
            margin-bottom: 8px;
            font-weight: 700;
        }

        .total-amount .amount {
            font-size: 28px;
            font-weight: 700;
        }

        .otp-code-digit {
            font-size: 32px;
            letter-spacing: 10px;
            font-weight: 700;
            color: ${T.linkBlue};
        }

        @media only screen and (max-width: 600px) {
            .email-shell {
                margin: 0;
                border-radius: 0;
            }
            .email-body {
                padding: 24px 18px 28px;
            }
            .info-grid {
                grid-template-columns: 1fr;
            }
            .email-header h1 {
                font-size: 22px;
            }
            .email-content h2 {
                font-size: 19px;
            }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:${T.pageBg};">
    ${preheaderBlock}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${T.pageBg};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding:0;">
                <div class="email-shell">
                  <div class="email-header">
                    <h1>${escapeHtml(site.legalEntityName || 'Now Shipping')}</h1>
                    <p>Professional Delivery Solutions</p>
                  </div>
                  <div class="email-body">
                    <div class="email-content">
                      ${content}
                    </div>
                    ${ctaBlock}
                    ${
                      additionalInfo
                        ? `<div class="highlight-box">${additionalInfo}</div>`
                        : ''
                    }
                  </div>
                </div>
              </td>
            </tr>
          </table>
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;margin:0 auto;">
            <tr>
              <td style="padding:0;">
                ${buildFooterBlock()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
</body>
</html>`;
};

/**
 * Email Verification Template
 */
const getEmailVerificationTemplate = (userName, verificationLink) => {
  const safeName = escapeHtml(userName || 'there');
  const safeLink = escapeAttr(verificationLink);
  const content = `
    <h2>Verify your email address</h2>
    <p>Hi ${safeName},</p>
    <p>Thanks for creating an account with Now Shipping. Please confirm that <strong>this is your email address</strong> to finish setting up your account.</p>
    <p>If the button below does not work, copy and paste this link into your browser:</p>
    <p style="word-break: break-all;"><a href="${safeLink}" style="color: ${EMAIL_THEME.linkBlue};text-decoration: underline;">${escapeHtml(verificationLink)}</a></p>
  `;

  return getEmailBaseTemplate(
    'Verify your email address',
    content,
    'Verify email',
    verificationLink,
    'If you did not request this, you can safely ignore this email.',
    'Confirm your email to finish setting up your Now Shipping account.'
  );
};

/** Plain-text body for verification email (link on its own line). */
const getVerificationPlainText = (userName, verificationLink) => {
  const name = (userName || 'there').trim() || 'there';
  const link = String(verificationLink || '').trim();
  return `Hi ${name},

Thanks for creating an account with Now Shipping. Confirm this email address by opening the link below:

${link}

If you did not create an account, you can ignore this email.

— Now Shipping
`;
};

/** Plain-text body for password reset OTP (code on its own line). */
const getPasswordResetPlainText = (businessDisplayName, otp) => {
  const display = String(businessDisplayName || 'Now Shipping').trim() || 'Now Shipping';
  const code = String(otp || '').replace(/\D/g, '').slice(0, 6);
  return `${display} — password reset

Your verification code:

${code}

This code expires in 15 minutes. If you did not request a password reset, ignore this email.

— Now Shipping
`;
};

/**
 * Order Delivery Notification Template
 */
const getOrderDeliveryTemplate = (orderData) => {
  const content = `
    <h2>Order delivered</h2>
    <p>Your order has been successfully delivered to your customer.</p>
    
    <div class="order-details">
      <div class="order-item">
        <span class="order-item-label">Order Number:</span>
        <span class="order-item-value">${orderData.orderNumber}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Customer Name:</span>
        <span class="order-item-value">${orderData.customerName}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Delivery Date:</span>
        <span class="order-item-value">${new Date(orderData.deliveryDate).toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Order Type:</span>
        <span class="order-item-value">${orderData.orderType}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Amount:</span>
        <span class="order-item-value">${orderData.amount} EGP</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Courier:</span>
        <span class="order-item-value">${orderData.courierName}</span>
      </div>
    </div>
    
    <div class="highlight-box">
      <h3>Payment information</h3>
      <p>Your payment for this order will be processed according to your payment schedule. 
      You can track your earnings in your business dashboard.</p>
    </div>
    
    <p>Thank you for choosing Now Shipping for your delivery needs!</p>
  `;

  return getEmailBaseTemplate(
    'Order Delivered Successfully',
    content,
    'View Order Details',
    `${process.env.BUSINESS_DASHBOARD_URL}/orders/${orderData.orderId}`,
    'Need help? Contact our support team for any questions about your orders.'
  );
};

/**
 * Daily Cash Cycle Summary Template
 */
const getDailyCashCycleTemplate = (businessData, ordersData, releaseData) => {
  const totalAmount = ordersData.reduce((sum, order) => sum + (order.amount || 0), 0);
  const totalFees = ordersData.reduce((sum, order) => sum + (order.fees || 0), 0);
  const netAmount = totalAmount - totalFees;

  const ordersList = ordersData.map(order => `
    <div class="order-item">
      <div>
        <strong>${order.orderNumber}</strong><br>
        <small>${order.customerName} • ${order.orderType}</small>
      </div>
      <div style="text-align: right;">
        <strong>${order.amount} EGP</strong><br>
        <small>Fees: ${order.fees} EGP</small>
      </div>
    </div>
  `).join('');

  const content = `
    <h2>Daily cash cycle summary</h2>
    <p>Here's your daily summary for <strong>${new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}</strong></p>
    
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Total Orders</div>
        <div class="info-value">${ordersData.length}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Total Amount</div>
        <div class="info-value">${totalAmount} EGP</div>
      </div>
      <div class="info-item">
        <div class="info-label">Total Fees</div>
        <div class="info-value">${totalFees} EGP</div>
      </div>
      <div class="info-item">
        <div class="info-label">Net Amount</div>
        <div class="info-value">${netAmount} EGP</div>
      </div>
    </div>
    
    <div class="total-amount">
      <h3>Your Daily Earnings</h3>
      <div class="amount">${netAmount} EGP</div>
    </div>
    
    <h3>Order details</h3>
    <div class="order-details">
      ${ordersList}
    </div>
    
    ${releaseData ? `
    <div class="highlight-box">
      <h3>Payment release information</h3>
      <p><strong>Release Date:</strong> ${new Date(releaseData.releaseDate).toLocaleDateString()}</p>
      <p><strong>Release Amount:</strong> ${releaseData.amount} EGP</p>
      <p><strong>Payment Method:</strong> ${releaseData.paymentMethod}</p>
    </div>
    ` : ''}
    
    <p>All transactions have been processed and your balance has been updated accordingly.</p>
  `;

  return getEmailBaseTemplate(
    'Daily Cash Cycle Summary',
    content,
    'View Full Report',
    `${process.env.BUSINESS_DASHBOARD_URL}/transactions`,
    'This is an automated summary. For detailed reports, please visit your business dashboard.'
  );
};

/**
 * Money Release Notification Template
 */
const getMoneyReleaseTemplate = (releaseData) => {
  const content = `
    <h2>Payment released</h2>
    <p>Your payment has been released and should be available in your account shortly.</p>
    
    <div class="order-details">
      <div class="order-item">
        <span class="order-item-label">Release ID:</span>
        <span class="order-item-value">${releaseData.releaseId}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Amount Released:</span>
        <span class="order-item-value">${releaseData.amount} EGP</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Release Date:</span>
        <span class="order-item-value">${new Date(releaseData.releaseDate).toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Payment Method:</span>
        <span class="order-item-value">${releaseData.paymentMethod}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Transaction Count:</span>
        <span class="order-item-value">${releaseData.transactionCount} transactions</span>
      </div>
    </div>
    
    <div class="total-amount">
      <h3>Amount Released</h3>
      <div class="amount">${releaseData.amount} EGP</div>
    </div>
    
    <div class="highlight-box">
      <h3>What happens next</h3>
      <p>Your payment has been processed and should appear in your account within 1-2 business days, 
      depending on your payment method. You can track all your transactions in your business dashboard.</p>
    </div>
    
    <p>Thank you for your business with Now Shipping!</p>
  `;

  return getEmailBaseTemplate(
    'Payment Released Successfully',
    content,
    'View Transaction Details',
    `${process.env.BUSINESS_DASHBOARD_URL}/transactions/${releaseData.releaseId}`,
    'If you have any questions about this payment, please contact our support team.'
  );
};

/**
 * Order Status Update Template
 */
const getOrderStatusUpdateTemplate = (orderData) => {
  const statusMessages = {
    'pickedUp': 'Your order has been picked up and is on its way to the warehouse.',
    'inStock': 'Your order has arrived at our warehouse and is ready for delivery.',
    'inProgress': 'Your order is being prepared for delivery.',
    'headingToCustomer': 'Your order is out for delivery and should arrive soon.',
    'delivered': 'Your order has been successfully delivered!',
    'completed': 'Your order has been completed successfully.',
    'returned': 'Your order has been returned to the warehouse.',
    'canceled': 'Your order has been canceled.'
  };

  const content = `
    <h2>Order status update</h2>
    <p>${statusMessages[orderData.status] || 'Your order status has been updated.'}</p>
    
    <div class="order-details">
      <div class="order-item">
        <span class="order-item-label">Order Number:</span>
        <span class="order-item-value">${orderData.orderNumber}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Current Status:</span>
        <span class="order-item-value">${orderData.status}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Updated At:</span>
        <span class="order-item-value">${new Date(orderData.updatedAt).toLocaleString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</span>
      </div>
      <div class="order-item">
        <span class="order-item-label">Customer:</span>
        <span class="order-item-value">${orderData.customerName}</span>
      </div>
      ${orderData.courierName ? `
      <div class="order-item">
        <span class="order-item-label">Courier:</span>
        <span class="order-item-value">${orderData.courierName}</span>
      </div>
      ` : ''}
    </div>
    
    <div class="highlight-box">
      <h3>Track your order</h3>
      <p>You can track your order in real-time through your business dashboard. 
      Get instant updates on your order's progress and delivery status.</p>
    </div>
    
    <p>We'll keep you updated on any further changes to your order status.</p>
  `;

  return getEmailBaseTemplate(
    `Order Status Update - ${orderData.orderNumber}`,
    content,
    'Track Order',
    `${process.env.BUSINESS_DASHBOARD_URL}/orders/${orderData.orderId}`,
    'Need help? Our support team is available 24/7 to assist you.'
  );
};

/**
 * Welcome Email Template for New Businesses
 */
const getWelcomeTemplate = (businessData) => {
  const content = `
    <h2>Welcome to Now Shipping</h2>
    <p>Thank you for joining Now Shipping! We're excited to help you grow your business with our professional delivery services.</p>
    
    <div class="highlight-box">
      <h3>Getting started</h3>
      <p>Here's what you can do next:</p>
      <ul style="margin: 15px 0; padding-left: 20px;">
        <li>Complete your business profile</li>
        <li>Set up your payment preferences</li>
        <li>Create your first order</li>
        <li>Explore our dashboard features</li>
      </ul>
    </div>
    
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Business Name</div>
        <div class="info-value">${businessData.businessName}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Account Type</div>
        <div class="info-value">${businessData.accountType}</div>
      </div>
    </div>
    
    <h3>Need help?</h3>
    <p>Our support team is here to help you get started. Don't hesitate to reach out if you have any questions!</p>
    
    <p>Welcome aboard and happy delivering!</p>
  `;

  return getEmailBaseTemplate(
    'Welcome to Now Shipping!',
    content,
    'Complete Setup',
    `${process.env.BUSINESS_DASHBOARD_URL}/setup`,
    'This is your welcome email. You can update your email preferences anytime in your account settings.'
  );
};

const getPasswordResetOtpTemplate = (businessDisplayName, otp) => {
  const safeName = String(businessDisplayName || 'Now Shipping').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeOtp = String(otp || '').replace(/\D/g, '').slice(0, 6);
  const content = `
    <h2>Password reset</h2>
    <p>You requested to reset the password for your <strong>${safeName}</strong> account on Now Shipping.</p>
    <div class="highlight-box">
      <p style="font-size: 14px; margin-bottom: 8px;"><strong>Your verification code</strong></p>
      <p class="otp-code-digit" style="margin: 0;">${safeOtp}</p>
      <p style="font-size: 13px; margin-top: 12px; color: ${EMAIL_THEME.muted};">This code expires in 15 minutes. If you did not request a reset, you can ignore this email.</p>
    </div>
  `;
  return getEmailBaseTemplate(
    'Password reset code',
    content,
    null,
    null,
    'For your security, never share this code with anyone. Now Shipping staff will never ask you for it.',
    'Use this code only if you requested a password reset on Now Shipping.'
  );
};

/** Settings / email-change OTP — same styling as password reset OTP. */
const getEmailSettingsOtpTemplate = (businessDisplayName, otp) => {
  const safeName = String(businessDisplayName || 'Now Shipping').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeOtp = String(otp || '').replace(/\D/g, '').slice(0, 6);
  const content = `
    <h2>Email verification code</h2>
    <p>Use this code to confirm an email change for your <strong>${safeName}</strong> account on Now Shipping.</p>
    <div class="highlight-box">
      <p style="font-size: 14px; margin-bottom: 8px;"><strong>Your verification code</strong></p>
      <p class="otp-code-digit" style="margin: 0;">${safeOtp}</p>
      <p style="font-size: 13px; margin-top: 12px; color: ${EMAIL_THEME.muted};">This code expires in 6 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;
  return getEmailBaseTemplate(
    'Email verification code',
    content,
    null,
    null,
    'For your security, never share this code with anyone. Now Shipping staff will never ask you for it.',
    'Use this code only if you are updating your email in Now Shipping settings.'
  );
};

const getEmailSettingsOtpPlainText = (businessDisplayName, otp) => {
  const display = String(businessDisplayName || 'Now Shipping').trim() || 'Now Shipping';
  const code = String(otp || '').replace(/\D/g, '').slice(0, 6);
  return `${display} — email verification

Your verification code:

${code}

This code expires in 6 minutes. If you did not request an email change, ignore this email.

— Now Shipping
`;
};

module.exports = {
  getEmailBaseTemplate,
  getEmailVerificationTemplate,
  getVerificationPlainText,
  getOrderDeliveryTemplate,
  getDailyCashCycleTemplate,
  getMoneyReleaseTemplate,
  getOrderStatusUpdateTemplate,
  getWelcomeTemplate,
  getPasswordResetOtpTemplate,
  getPasswordResetPlainText,
  getEmailSettingsOtpTemplate,
  getEmailSettingsOtpPlainText,
};
