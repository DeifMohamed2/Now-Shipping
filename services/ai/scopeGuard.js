/**
 * Server-side scope guard — AINOW only answers NowShipping business topics.
 */
const { isHelpQuestion } = require('./platformHelpEngine');

const SHIPPING_SIGNALS = [
  'order', 'orders', 'shipping', 'shipment', 'deliver', 'delivery', 'return', 'exchange',
  'pickup', 'wallet', 'balance', 'cod', 'cash', 'track', 'status', 'parcel', 'package',
  'express', 'courier', 'fee', 'payout', 'ledger', 'import', 'create', 'أوردر', 'اوردر',
  'طلب', 'طلبات', 'شحن', 'توصيل', 'استلام', 'محفظ', 'رصيد', 'كاش', 'دفع', 'مرتجع',
  'استبدال', 'سريع', 'عنوان', 'منطقة', 'محافظة', 'منتج', 'قطع', 'رقم', 'تتبع', 'حالة',
  'nowshipping', 'now shipping', 'ainow',
];

const OFF_TOPIC_SIGNALS = [
  'weather', 'joke', 'politics', 'president', 'football', 'movie', 'recipe', 'homework',
  'python', 'javascript', 'code', 'programming', 'bitcoin', 'stock', 'crypto',
  'الطقس', 'نكتة', 'سياس', 'كورة', 'فيلم', 'وصفة', 'برمجة', 'كود',
];

const SCOPE_REFUSAL = {
  ar: 'أنا AINOW ومتخصص في الشحن وطلباتك. اسألني عن إنشاء أوردر، حالة الطلب، رصيدك، الاستلام، أو **ازاي** تعمل أي خطوة في المنصة.',
  en: "I'm AINOW — I help with your NowShipping orders, balance, pickups, and how to use the platform. Ask me how to do anything step by step.",
};

const SCOPE_SUGGESTIONS = {
  ar: ['إنشاء أوردر', 'حالة الطلب', 'رصيدي', 'جدولة استلام'],
  en: ['Create an order', 'Order status', 'My balance', 'Schedule pickup'],
};

function normalize(s) {
  return String(s || '').toLowerCase().trim();
}

function hasSignal(text, signals) {
  const n = normalize(text);
  return signals.some(function (sig) {
    return n.includes(sig.toLowerCase());
  });
}

function isShippingRelated(message) {
  return hasSignal(message, SHIPPING_SIGNALS);
}

function isObviouslyOffTopic(message) {
  return hasSignal(message, OFF_TOPIC_SIGNALS);
}

const GREETINGS = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'مرحبا', 'اهلا', 'أهلا', 'السلام', 'صباح', 'مساء', 'شكرا'];

function isGreeting(message) {
  const n = normalize(message).replace(/[!?.،]/g, '').trim();
  if (!n || n.length > 40) return false;
  return GREETINGS.some(function (g) {
    return n === g || n.startsWith(g + ' ');
  });
}

/**
 * Returns true if the message should be refused (off-topic).
 */
function shouldRefuse(message, geminiResult) {
  const intent = geminiResult?.intent || '';
  if (intent === 'out_of_scope') return true;
  if (intent === 'platform_help') return false;

  const msg = normalize(message);
  if (!msg) return false;

  if (isGreeting(message)) return false;
  if (isHelpQuestion(message)) return false;

  if (isObviouslyOffTopic(message) && !isShippingRelated(message)) return true;

  if (intent === 'general_chat' && !isShippingRelated(message)) return true;

  return false;
}

function buildScopeRefusal(lang) {
  const isAr = lang === 'ar';
  return {
    text: isAr ? SCOPE_REFUSAL.ar : SCOPE_REFUSAL.en,
    suggestions: isAr ? SCOPE_SUGGESTIONS.ar : SCOPE_SUGGESTIONS.en,
    intent: 'out_of_scope',
  };
}

module.exports = {
  shouldRefuse,
  buildScopeRefusal,
  isShippingRelated,
  isHelpQuestion,
};
