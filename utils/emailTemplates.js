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

const getEmailBaseTemplate = (title, content, buttonText = null, buttonLink = null, additionalInfo = null) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${title}</title>
    <style>
        /* Reset styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333333;
            background-color: #f8f9fa;
            margin: 0;
            padding: 0;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .email-header {
            background: linear-gradient(135deg, #fdb614 0%, #f39720 100%);
            padding: 30px 20px;
            text-align: center;
            color: #ffffff;
        }
        
        .email-header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .email-header p {
            font-size: 16px;
            opacity: 0.9;
            margin: 0;
        }
        
        .email-body {
            padding: 40px 30px;
        }
        
        .email-content {
            font-size: 16px;
            line-height: 1.8;
            color: #444444;
            margin-bottom: 30px;
        }
        
        .email-content h2 {
            color: #fdb614;
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 600;
        }
        
        .email-content h3 {
            color: #2b71b9;
            font-size: 20px;
            margin: 25px 0 15px 0;
            font-weight: 600;
        }
        
        .email-content p {
            margin-bottom: 15px;
        }
        
        .highlight-box {
            background-color: #f8f9fa;
            border-left: 4px solid #fdb614;
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 20px 0;
        }
        
        .info-item {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #e9ecef;
        }
        
        .info-label {
            font-weight: 600;
            color: #2b71b9;
            font-size: 14px;
            margin-bottom: 5px;
        }
        
        .info-value {
            font-size: 16px;
            color: #333333;
        }
        
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #fdb614 0%, #f39720 100%);
            color: #ffffff;
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
            box-shadow: 0 4px 8px rgba(253, 182, 20, 0.3);
            transition: all 0.3s ease;
        }
        
        .cta-button:hover {
            background: linear-gradient(135deg, #f39720 0%, #e8850e 100%);
        }
        
        .order-details {
            background-color: #ffffff;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .order-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #f1f3f4;
        }
        
        .order-item:last-child {
            border-bottom: none;
        }
        
        .order-item-label {
            font-weight: 600;
            color: #2b71b9;
        }
        
        .order-item-value {
            color: #333333;
            font-weight: 500;
        }
        
        .total-amount {
            background-color: #fdb614;
            color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin: 20px 0;
        }
        
        .total-amount h3 {
            color: #ffffff;
            font-size: 24px;
            margin-bottom: 10px;
        }
        
        .total-amount .amount {
            font-size: 32px;
            font-weight: 700;
        }
        
        .email-footer {
            background-color: #2b71b9;
            color: #ffffff;
            padding: 30px;
            text-align: center;
        }
        
        .email-footer h3 {
            color: #ffffff;
            font-size: 20px;
            margin-bottom: 15px;
        }
        
        .email-footer p {
            font-size: 14px;
            opacity: 0.9;
            margin-bottom: 10px;
        }
        
        .social-links {
            margin: 20px 0;
        }
        
        .social-links a {
            color: #ffffff;
            text-decoration: none;
            margin: 0 10px;
            font-size: 14px;
        }
        
        
        
        /* Responsive design */
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            
            .email-body {
                padding: 20px;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .email-header h1 {
                font-size: 24px;
            }
            
            .email-content h2 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            <h1>Now Shipping</h1>
            <p>Professional Delivery Solutions</p>
        </div>
        
        <div class="email-body">
            <div class="email-content">
                ${content}
            </div>
            
            ${buttonText && buttonLink ? `
            <div style="text-align: center; margin: 30px 0;">
                <a href="${buttonLink}" class="cta-button">${buttonText}</a>
            </div>
            ` : ''}
            
            ${additionalInfo ? `
            <div class="highlight-box">
                ${additionalInfo}
            </div>
            ` : ''}
        </div>
        
        <div class="email-footer">
            <h3>Now Shipping</h3>
            <p>Your trusted delivery partner</p>
            <p>📧 support@nowshipping.com | 📞 +20 123 456 7890</p>
            <div class="social-links">
                <a href="#">Facebook</a> | 
                <a href="#">Twitter</a> | 
                <a href="#">LinkedIn</a>
            </div>
        </div>
    </div>
</body>
</html>`;
};

/**
 * Email Verification Template
 */
const getEmailVerificationTemplate = (userName, verificationLink) => {
  const content = `
    <h2>🔐 Verify Your Email Address</h2>
    <p>Hi ${userName || 'there'},</p>
    <p>Thanks for creating an account with Now Shipping. Please confirm that <strong>this is your email address</strong> to finish setting up your account.</p>
    <div class="highlight-box">
      <p><strong>Why verification?</strong> It keeps your account secure and enables important notifications about your orders, payouts, and account activity.</p>
    </div>
    <p>If the button below does not work, copy and paste this link into your browser:</p>
    <p style="word-break: break-all; color: #2b71b9;">${verificationLink}</p>
  `;

  return getEmailBaseTemplate(
    'Verify your email address',
    content,
    'Verify Email',
    verificationLink,
    'If you did not request this, you can safely ignore this email.'
  );
};

/**
 * Order Delivery Notification Template
 */
const getOrderDeliveryTemplate = (orderData) => {
  const content = `
    <h2>🎉 Order Delivered Successfully!</h2>
    <p>Great news! Your order has been successfully delivered to your customer.</p>
    
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
      <h3>💰 Payment Information</h3>
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
    <h2>📊 Daily Cash Cycle Summary</h2>
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
    
    <h3>📋 Order Details</h3>
    <div class="order-details">
      ${ordersList}
    </div>
    
    ${releaseData ? `
    <div class="highlight-box">
      <h3>💳 Payment Release Information</h3>
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
    <h2>💰 Money Released Successfully!</h2>
    <p>Great news! Your payment has been released and should be available in your account shortly.</p>
    
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
      <h3>📋 What's Next?</h3>
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

  const statusIcons = {
    'pickedUp': '📦',
    'inStock': '🏪',
    'inProgress': '⚙️',
    'headingToCustomer': '🚚',
    'delivered': '✅',
    'completed': '🎉',
    'returned': '↩️',
    'canceled': '❌'
  };

  const content = `
    <h2>${statusIcons[orderData.status]} Order Status Update</h2>
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
      <h3>📱 Track Your Order</h3>
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
    <h2>🎉 Welcome to Now Shipping!</h2>
    <p>Thank you for joining Now Shipping! We're excited to help you grow your business with our professional delivery services.</p>
    
    <div class="highlight-box">
      <h3>🚀 Getting Started</h3>
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
    
    <h3>📞 Need Help?</h3>
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

module.exports = {
  getEmailBaseTemplate,
  getEmailVerificationTemplate,
  getOrderDeliveryTemplate,
  getDailyCashCycleTemplate,
  getMoneyReleaseTemplate,
  getOrderStatusUpdateTemplate,
  getWelcomeTemplate
};
