const wasender = require('./wasenderClient');
const { toJid } = require('./phoneUtils');

const SESSION_API_KEY = process.env.WHATSAPP_SESSION_API_KEY || '7efbc4b2e82b35696e8715783f7ccb42bee14ac206e300e6874dab263b058961';

/** Timestamp (ms) when the previous queued WhatsApp send finished; used for spacing. */
let lastSendCompletedAt = 0;
/** Serialize outbound sends so throttle + jitter apply in order (FIFO). */
let sendQueueTail = Promise.resolve();

function parseEnvMs(key, defaultMs) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === '') return defaultMs;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : defaultMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Optional footer for opt-out / compliance (Wasender guidance). Unset = unchanged behavior.
 */
function appendOptOutFooter(text) {
  const footer = process.env.WHATSAPP_OPT_OUT_FOOTER;
  if (footer == null || String(footer).trim() === '') return text;
  const f = String(footer).trim();
  return `${String(text).trimEnd()}\n\n${f}`;
}

async function applyOutboundThrottle() {
  const minMs = parseEnvMs('WHATSAPP_MIN_SEND_INTERVAL_MS', 30000);
  const jitterMax = parseEnvMs('WHATSAPP_SEND_JITTER_MS_MAX', 2000);
  const now = Date.now();
  const eligibleAt = lastSendCompletedAt + minMs;
  const waitGap = Math.max(0, eligibleAt - now);
  if (waitGap > 0) await sleep(waitGap);
  const jitter = jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
  if (jitter > 0) await sleep(jitter);
}

/**
 * Public shipment tracking (see routes/web/authRoutes.js → authController.trackingPage):
 * - Search: GET /tracking?q=...
 * - Direct / WhatsApp: GET /t/:orderNumber
 *
 * WhatsApp uses: {origin}/t/{orderNumber}
 * Origin: TRACKING_BASE_URL (only origin is used if you pass a full URL with path), else APP_URL, else HOST,
 * else default https://now.com.eg (correct TLD is .com.eg, not .co.eg).
 */
const DEFAULT_TRACKING_SITE_ORIGIN = 'https://now.com.eg';

function getTrackingOrigin() {
  const raw =
    process.env.TRACKING_BASE_URL ||
    process.env.APP_URL ||
    process.env.HOST ||
    DEFAULT_TRACKING_SITE_ORIGIN;
  const trimmed = String(raw).trim();
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return u.origin;
  } catch {
    return DEFAULT_TRACKING_SITE_ORIGIN;
  }
}

/** Full URL for sharing tracking (orderNumber = Now order ref). */
function trackingUrlForOrder(orderNumber) {
  const num = String(orderNumber || '').trim();
  return `${getTrackingOrigin()}/t/${encodeURIComponent(num)}`;
}

function formatDate(date) {
  if (!date) return 'غير محدد';
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTomorrowFormatted() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

function isPopulated(field) {
  return field && typeof field === 'object' && !(field instanceof require('mongoose').Types.ObjectId);
}

/**
 * Send a WhatsApp text message to a phone number.
 * Outbound sends are queued (FIFO), spaced by WHATSAPP_MIN_SEND_INTERVAL_MS + random jitter,
 * and optionally append WHATSAPP_OPT_OUT_FOOTER. See deploy/whatsapp-compliance.md.
 */
async function sendWhatsAppMessage(phone, message) {
  const body = appendOptOutFooter(message);

  const run = sendQueueTail.then(async () => {
    await applyOutboundThrottle();
    try {
      if (!SESSION_API_KEY || SESSION_API_KEY === 'YOUR_SESSION_API_KEY') {
        console.error('WhatsApp: Missing session API key');
        return { success: false, message: 'Missing WhatsApp session API key' };
      }

      const jid = toJid(phone, '20');
      if (!jid) {
        console.error('WhatsApp: Invalid phone number', phone);
        return { success: false, message: 'Invalid phone number' };
      }

      const result = await wasender.sendTextMessage(SESSION_API_KEY, jid, body);

      if (result.success) {
        console.log(`✅ WhatsApp sent to ${phone}`);
      } else {
        console.error(`❌ WhatsApp failed for ${phone}:`, result.message);
      }

      return result;
    } catch (error) {
      console.error('WhatsApp send error:', error.message);
      return { success: false, message: error.message };
    } finally {
      lastSendCompletedAt = Date.now();
    }
  });

  sendQueueTail = run.catch(() => {});
  return run;
}

/**
 * Ensure order has populated business and deliveryMan fields.
 * If not populated, fetches the full order with populates.
 */
async function ensurePopulated(order) {
  const needsPopulate = !isPopulated(order.business) || (order.deliveryMan && !isPopulated(order.deliveryMan));
  if (!needsPopulate) return order;

  const Order = require('mongoose').model('order');
  const populated = await Order.findById(order._id)
    .populate('business')
    .populate('deliveryMan')
    .lean();

  return populated || order;
}

/**
 * Notification 1: Order Picked Up
 * Sent when courier picks up the order from the business
 */
async function sendOrderPickedUpNotification(order) {
  try {
    const customer = order.orderCustomer;
    if (!customer?.phoneNumber) {
      return { success: false, message: 'No customer phone number' };
    }

    const populatedOrder = await ensurePopulated(order);

    const businessName = populatedOrder.business?.brandInfo?.brandName || populatedOrder.business?.name || 'المتجر';
    const trackingUrl = trackingUrlForOrder(populatedOrder.orderNumber);
    const canOpen = populatedOrder.isOrderAvailableForPreview ? 'نعم' : 'لا';
    const amount = populatedOrder.orderShipping?.amount || 0;
    const description = populatedOrder.orderShipping?.productDescription || 'شحنة';
    const orderType = populatedOrder.orderShipping?.orderType || 'Deliver';
    const flyerBarcode = populatedOrder.smartFlyerBarcode
      ? `\n🏷️ باركود الفلاير: *${populatedOrder.smartFlyerBarcode}*`
      : '';
    const address = customer.address || '';
    const zone = customer.zone || '';
    const government = customer.government || '';

    const message = `👋 *مرحبًا ${customer.fullName}*

📦 تم استلام شحنتك من *${businessName}* بنجاح

📅 التاريخ المتوقع للتوصيل: *${getTomorrowFormatted()}*
🚚 رقم الشحنة: *${populatedOrder.orderNumber}*
📋 نوع الطلب: *${orderType}*${flyerBarcode}
📝 وصف الشحنة: *${description}*
💰 مبلغ التحصيل: *${amount}*
📦 إمكانية فتح الشحنة: *${canOpen}*
📍 العنوان: *${address} - ${zone} - ${government}*

لمتابعة حالة الشحنة اضغط هنا 🔗
${trackingUrl}`;

    return await sendWhatsAppMessage(customer.phoneNumber, message);
  } catch (error) {
    console.error('WhatsApp pickedUp notification error:', error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Arabic body for "heading to customer" WhatsApp.
 *
 * Server paths that set `headingToCustomer` and call `sendHeadingToCustomerNotification`:
 * - `POST /api/v1/courier/orders/:orderNumber/scan-fast-shipping` (express) — see `scanFastShippingOrder`
 * - Admin `courier_received` (bulk `inProgress` → `headingToCustomer`) — see `courier_received` in adminController
 *
 * If you add a new transition to `headingToCustomer`, call `sendHeadingToCustomerNotification` there too.
 */
function buildHeadingToCustomerBody(populatedOrder, customer) {
  const fullName = customer.fullName || '';
  const businessName =
    populatedOrder.business?.brandInfo?.brandName || populatedOrder.business?.name || 'المتجر';
  const courierName = populatedOrder.deliveryMan?.name || 'المندوب';
  const courierPhone = populatedOrder.deliveryMan?.phoneNumber || '';
  const trackingUrl = trackingUrlForOrder(populatedOrder.orderNumber);
  const amount = populatedOrder.orderShipping?.amount || 0;
  const orderType = populatedOrder.orderShipping?.orderType || 'Deliver';
  const isExpress = Boolean(populatedOrder.orderShipping?.isExpressShipping);
  const flyerBarcode = populatedOrder.smartFlyerBarcode
    ? `\n🏷️ باركود الفلاير: *${populatedOrder.smartFlyerBarcode}*`
    : '';

  const courierBlock = `👤 اسم المندوب: *${courierName}*

📞 رقم المندوب: *${courierPhone}*

💰 مبلغ التحصيل: *${amount}*
📋 نوع الطلب: *${orderType}*${flyerBarcode}`;

  const trackingBlock = `📍 لتتبع حالة الشحنة، اضغط هنا:
*${trackingUrl}*`;

  if (orderType === 'Exchange') {
    return `👋 *مرحبًا ${fullName}*

📦 *استبدال* — المنتج البديل من *${businessName}* في الطريق إليك مع المندوب 🚚

🕒 الوقت المتوقع للوصول: *من 11ص إلى 6م*

${courierBlock}

📝 عند التسليم: استلم المنتج البديل وسلِّم الأصلي للمندوب حسب سياسة الاستبدال. يمكنك التواصل مع المندوب لأي استفسار.

${trackingBlock}

من فضلك تواصل معنا في حالة عدم تواجدك أو تغيير في موعد التوصيل.`;
  }

  if (orderType === 'Return') {
    return `👋 *مرحبًا ${fullName}*

↩️ شحنة *الإرجاع* من *${businessName}* في الطريق إليك مع المندوب لاستلام المرتجع 🚚

🕒 الوقت المتوقع للوصول: *من 11ص إلى 6م*

${courierBlock}

${trackingBlock}

يرجى تجهيز المرتجع حسب تعليمات المتجر والتواصل مع المندوب عند الحاجة.`;
  }

  // Deliver + express
  if (isExpress) {
    return `👋 *مرحبًا ${fullName}*

⚡ *توصيل سريع* — شحنتك من *${businessName}* خرجت مع المندوب للتوصيل في أقرب وقت 🚚

🕒 الوقت المتوقع للوصول: *اليوم — من 11ص إلى 6م*

${courierBlock}

يمكنك التواصل مع المندوب لمزيد من التفاصيل حول التوصيل.

${trackingBlock}

من فضلك تواصل معنا في حالة عدم تواجدك أو رغبتك في رفض الشحنة.`;
  }

  // Deliver (standard)
  return `👋 *مرحبًا ${fullName}*

شحنتك من *${businessName}* خرجت مع المندوب للتوصيل 🚚

🕒 الوقت المتوقع للوصول: *من 11ص إلى 6م*

${courierBlock}

يمكنك التواصل مع المندوب لمزيد من التفاصيل حول التوصيل.

${trackingBlock}

من فضلك تواصل معنا في حالة عدم تواجدك أو رغبتك في رفض الشحنة.`;
}

/**
 * Notification 2: Heading to Customer
 * Sent when courier is on the way to deliver (copy varies by order type / express).
 */
async function sendHeadingToCustomerNotification(order) {
  try {
    const customer = order.orderCustomer;
    if (!customer?.phoneNumber) {
      return { success: false, message: 'No customer phone number' };
    }

    const populatedOrder = await ensurePopulated(order);
    const message = buildHeadingToCustomerBody(populatedOrder, customer);

    return await sendWhatsAppMessage(customer.phoneNumber, message);
  } catch (error) {
    console.error('WhatsApp headingToCustomer notification error:', error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Exchange phase 1: replacement delivered + original collected at customer
 */
async function sendExchangePickupNotification(order) {
  try {
    const customer = order.orderCustomer;
    if (!customer?.phoneNumber) {
      return { success: false, message: 'No customer phone number' };
    }

    const populatedOrder = await ensurePopulated(order);

    const businessName =
      populatedOrder.business?.brandInfo?.brandName ||
      populatedOrder.business?.name ||
      'المتجر';
    const trackingUrl = trackingUrlForOrder(populatedOrder.orderNumber);
    const orderType = populatedOrder.orderShipping?.orderType || 'Exchange';
    const flyerBarcode = populatedOrder.smartFlyerBarcode
      ? `\n🏷️ باركود الفلاير: *${populatedOrder.smartFlyerBarcode}*`
      : '';

    const message = `👋 *مرحبًا ${customer.fullName}*

تم إتمام خطوة الاستبدال من *${businessName}* ✅

تم تسليم المنتج البديل وجمع المنتج الأصلي. المنتج الأصلي في طريقه للمخزن ثم للمتجر.

📋 نوع الطلب: *${orderType}*${flyerBarcode}

📍 لمتابعة حالة الشحنة:
*${trackingUrl}*

شكرًا لاستخدامك Now Shipping.`;

    return await sendWhatsAppMessage(customer.phoneNumber, message);
  } catch (error) {
    console.error('WhatsApp exchange pickup notification error:', error.message);
    return { success: false, message: error.message };
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendOrderPickedUpNotification,
  sendHeadingToCustomerNotification,
  sendExchangePickupNotification,
};
