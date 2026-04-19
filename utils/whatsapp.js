const wasender = require('./wasenderClient');
const { toJid } = require('./phoneUtils');

const SESSION_API_KEY = process.env.WHATSAPP_SESSION_API_KEY || '68296773f7ccbc4a5d955d31ba00863eaf9a0e2fe193b493a18c76c257fb4a5d';
const TRACKING_BASE_URL = process.env.TRACKING_BASE_URL || 'https://nowshipping.com/t';

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
 * Send a WhatsApp text message to a phone number
 */
async function sendWhatsAppMessage(phone, message) {
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

    const result = await wasender.sendTextMessage(SESSION_API_KEY, jid, message);

    if (result.success) {
      console.log(`✅ WhatsApp sent to ${phone}`);
    } else {
      console.error(`❌ WhatsApp failed for ${phone}:`, result.message);
    }

    return result;
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    return { success: false, message: error.message };
  }
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
    const trackingUrl = `${TRACKING_BASE_URL}/${populatedOrder.orderNumber}`;
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
 * Notification 2: Heading to Customer
 * Sent when courier is on the way to deliver
 */
async function sendHeadingToCustomerNotification(order) {
  try {
    const customer = order.orderCustomer;
    if (!customer?.phoneNumber) {
      return { success: false, message: 'No customer phone number' };
    }

    const populatedOrder = await ensurePopulated(order);

    const businessName = populatedOrder.business?.brandInfo?.brandName || populatedOrder.business?.name || 'المتجر';
    const courierName = populatedOrder.deliveryMan?.name || 'المندوب';
    const courierPhone = populatedOrder.deliveryMan?.phoneNumber || '';
    const trackingUrl = `${TRACKING_BASE_URL}/${populatedOrder.orderNumber}`;
    const amount = populatedOrder.orderShipping?.amount || 0;
    const orderType = populatedOrder.orderShipping?.orderType || 'Deliver';
    const flyerBarcode = populatedOrder.smartFlyerBarcode
      ? `\n🏷️ باركود الفلاير: *${populatedOrder.smartFlyerBarcode}*`
      : '';

    const message = `👋 *مرحبًا ${customer.fullName}*

شحنتك من *${businessName}* خرجت مع المندوب للتوصيل 🚚

🕒 الوقت المتوقع للوصول: *من 11ص إلى 6م*

👤 اسم المندوب: *${courierName}*

📞 رقم المندوب: *${courierPhone}*

💰 مبلغ التحصيل: *${amount}*
📋 نوع الطلب: *${orderType}*${flyerBarcode}

يمكنك التواصل مع المندوب لمزيد من التفاصيل حول التوصيل.

📍 لتتبع حالة الشحنة، اضغط هنا:
*${trackingUrl}*

من فضلك تواصل معنا في حالة عدم تواجدك أو رغبتك في رفض الشحنة.`;

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
    const trackingUrl = `${TRACKING_BASE_URL}/${populatedOrder.orderNumber}`;
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
