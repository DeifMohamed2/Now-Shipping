/**
 * Context-aware NowShipping platform help for AINOW.
 */
const { hasUsablePickupAddress } = require('../../utils/pickupAddressValidation');

const HELP_PHRASES = [
  'ازاي', 'ازاى', 'إزاي', 'ازى', 'كيف', 'فين', 'ايه الخطوات', 'الخطوات',
  'شرح', 'اشرح', 'اشرحلي', 'شرحلي', 'وضح', 'وضحلي', 'اعملها', 'اعمل إزاي',
  'اعمل ازاي', 'محتاج اعرف', 'عايز اعرف', 'ازاي اروح', 'ازاي اقدر',
  'how do i', 'how to', 'how can i', 'where do i', 'where can i',
  'explain', 'show me', 'steps to', 'help me', 'walk me through',
  'what do i do', 'need help', 'guide me',
];

const TOPIC_KEYWORDS = [
  { topic: 'add_pickup_address', patterns: ['عنوان استلام', 'عنوان الاستلام', 'pickup address', 'add address', 'اضافة عنوان'] },
  { topic: 'create_order', patterns: ['انشاء اوردر', 'إنشاء أوردر', 'اعمل اوردر', 'create order', 'new order'] },
  { topic: 'schedule_pickup', patterns: ['جدول استلام', 'جدولة استلام', 'schedule pickup', 'book pickup'] },
  { topic: 'order_status', patterns: ['حالة الطلب', 'حالة الاوردر', 'تتبع', 'track order', 'order status'] },
  { topic: 'wallet_balance', patterns: ['رصيد', 'محفظ', 'wallet', 'balance', 'payout'] },
  { topic: 'import_orders', patterns: ['استيراد', 'import', 'excel', 'اكسل'] },
  { topic: 'return_order', patterns: ['مرتجع', 'ارجاع', 'return order', 'returns'] },
  { topic: 'express_shipping', patterns: ['توصيل سريع', 'express', 'سريع'] },
  { topic: 'shop_orders', patterns: ['المتجر', 'shop order', 'shop'] },
  { topic: 'tickets_support', patterns: ['تذكرة', 'دعم', 'ticket', 'support'] },
  { topic: 'integrations', patterns: ['شوبيفاي', 'shopify', 'woocommerce', 'ربط', 'integration'] },
  { topic: 'profile_settings', patterns: ['الملف الشخصي', 'البروفايل', 'profile', 'brand info'] },
  { topic: 'account_completion', patterns: ['اكمال الحساب', 'complete account', 'verification'] },
  { topic: 'zones_areas', patterns: ['منطقة', 'محافظة', 'zone', 'area', 'governorate'] },
];

const PENDING_FIELD_TOPIC = {
  pickupAddressId: 'add_pickup_address',
  selectedPickupAddressId: 'add_pickup_address',
  zone: 'zones_areas',
  government: 'zones_areas',
  originalOrderNumber: 'return_order',
  returnReason: 'return_order',
  codConfirmation: 'create_order',
  amountCOD: 'create_order',
  shippingSpeed: 'express_shipping',
};

const HELP_TOPICS = {
  add_pickup_address: {
    id: 'add_pickup_address',
    titleAr: 'إضافة عنوان استلام',
    titleEn: 'Add a pickup address',
    stepsAr: [
      'من القائمة الجانبية اضغط **الإعدادات**.',
      'افتح تبويب **عنوان الاستلام**.',
      'اضغط **إضافة عنوان جديد**.',
      'املأ المدينة، تفاصيل العنوان، ورقم التواصل للاستلام.',
      'احفظ العنوان، ثم ارجع لـ AINOW واكتب **كمّل الاستلام** لمتابعة الطلب.',
    ],
    stepsEn: [
      'From the sidebar, open **Settings**.',
      'Go to the **Pickup Address** tab.',
      'Click **Add New Address**.',
      'Fill in city, street details, and pickup contact phone.',
      'Save, then return to AINOW and type **continue pickup** to resume.',
    ],
    actions: [
      { textAr: 'فتح الإعدادات — عنوان الاستلام', textEn: 'Open Settings — Pickup Address', url: '/business/settings#address' },
    ],
    suggestionsAr: ['كمّل جدولة الاستلام', 'جدولة استلام'],
    suggestionsEn: ['Continue pickup scheduling', 'Schedule pickup'],
  },
  create_order: {
    id: 'create_order',
    titleAr: 'إنشاء أوردر جديد',
    titleEn: 'Create a new order',
    stepsAr: [
      'من القائمة اضغط **الأوردرات** ثم **إنشاء أوردر** (أو استخدم AINOW واكتب تفاصيل الأوردر خطوة بخطوة).',
      'أدخل بيانات العميل: الاسم، الموبايل، العنوان، والمنطقة.',
      'أضف وصف المنتج وعدد القطع.',
      'اختر الدفع عند الاستلام (كاش) ونوع التوصيل (عادي أو سريع) عند الطلب.',
      'راجع المعاينة واضغط **تأكيد** لإنشاء الأوردر.',
    ],
    stepsEn: [
      'From the menu, open **Orders** → **Create order** (or use AINOW step by step).',
      'Enter customer name, phone, address, and delivery zone.',
      'Add product description and item count.',
      'Choose COD and delivery speed when prompted.',
      'Review the preview and confirm to create the order.',
    ],
    actions: [
      { textAr: 'إنشاء أوردر', textEn: 'Create order', url: '/business/create-order' },
      { textAr: 'كل الأوردرات', textEn: 'All orders', url: '/business/orders' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'جدولة استلام'],
    suggestionsEn: ['Create an order', 'Schedule pickup'],
  },
  schedule_pickup: {
    id: 'schedule_pickup',
    titleAr: 'جدولة استلام',
    titleEn: 'Schedule a pickup',
    stepsAr: [
      'تأكد أن لديك **عنوان استلام** محفوظ في الإعدادات.',
      'من **الاستلامات** اضغط إنشاء استلام، أو اسأل AINOW: **عايز أجدول استلام**.',
      'حدد عدد الأوردرات وتاريخ الاستلام (من بكرة فما بعد).',
      'أكد رقم التواصل والعنوان.',
      'راجع المعاينة واضغط **تأكيد الاستلام**.',
    ],
    stepsEn: [
      'Make sure you have a **pickup address** saved in Settings.',
      'From **Pickups**, create a pickup, or tell AINOW: **schedule a pickup**.',
      'Set order count and pickup date (tomorrow or later).',
      'Confirm contact phone and address.',
      'Review the preview and tap **Confirm Pickup**.',
    ],
    actions: [
      { textAr: 'صفحة الاستلامات', textEn: 'Pickups page', url: '/business/pickups' },
    ],
    suggestionsAr: ['جدولة استلام', 'كمّل جدولة الاستلام'],
    suggestionsEn: ['Schedule pickup', 'Continue pickup'],
  },
  order_status: {
    id: 'order_status',
    titleAr: 'متابعة حالة الأوردر',
    titleEn: 'Track order status',
    stepsAr: [
      'افتح **الأوردرات** من القائمة الجانبية.',
      'ابحث برقم الأوردر أو اسم العميل.',
      'اضغط على الأوردر لعرض التفاصيل والحالة والتتبع.',
      'أو اسأل AINOW: **حالة أوردر 123456**.',
    ],
    stepsEn: [
      'Open **Orders** from the sidebar.',
      'Search by order number or customer name.',
      'Click the order to see details, status, and tracking.',
      'Or ask AINOW: **status of order 123456**.',
    ],
    actions: [
      { textAr: 'كل الأوردرات', textEn: 'All orders', url: '/business/orders' },
    ],
    suggestionsAr: ['حالة آخر أوردر', 'إنشاء أوردر'],
    suggestionsEn: ['Latest order status', 'Create order'],
  },
  wallet_balance: {
    id: 'wallet_balance',
    titleAr: 'المحفظة والرصيد',
    titleEn: 'Wallet and balance',
    stepsAr: [
      'افتح **المحفظة** من القائمة الجانبية.',
      'ستجد رصيدك الحالي وسجل الحركات (تحصيلات، رسوم، استلامات).',
      'يمكنك تصدير السجل أو مراجعة تفاصيل أي حركة.',
      'اسأل AINOW: **رصيدي** للحصول على ملخص سريع.',
    ],
    stepsEn: [
      'Open **Wallet** from the sidebar.',
      'View your balance and ledger entries (COD, fees, pickups).',
      'Export the ledger or drill into any entry.',
      'Ask AINOW: **my balance** for a quick summary.',
    ],
    actions: [
      { textAr: 'المحفظة', textEn: 'Wallet', url: '/business/wallet' },
    ],
    suggestionsAr: ['رصيدي', 'حالة الطلب'],
    suggestionsEn: ['My balance', 'Order status'],
  },
  import_orders: {
    id: 'import_orders',
    titleAr: 'استيراد أوردرات من Excel',
    titleEn: 'Import orders from Excel',
    stepsAr: [
      'افتح **الأوردرات** من القائمة.',
      'استخدم خيار **استيراد** وحمّل قالب Excel إن وُجد.',
      'املأ البيانات المطلوبة (عميل، عنوان، منتج، إلخ) واحفظ الملف.',
      'ارفع الملف وراجع الأخطاء قبل التأكيد.',
    ],
    stepsEn: [
      'Open **Orders** from the menu.',
      'Use **Import** and download the Excel template if available.',
      'Fill required columns (customer, address, product, etc.) and save.',
      'Upload the file and fix any validation errors before confirming.',
    ],
    actions: [
      { textAr: 'الأوردرات', textEn: 'Orders', url: '/business/orders' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'إنشاء أوردر يدوي'],
    suggestionsEn: ['Create order', 'Create order manually'],
  },
  return_order: {
    id: 'return_order',
    titleAr: 'إنشاء مرتجع',
    titleEn: 'Create a return',
    stepsAr: [
      'تحتاج **عنوان استلام** محفوظ في الإعدادات.',
      'من **المرتجعات** أو إنشاء أوردر نوع Return، أدخل رقم الأوردر الأصلي وسبب الإرجاع.',
      'أو استخدم AINOW واختر نوع **Return** واتبع الخطوات.',
      'تأكد أن الأوردر الأصلي مكتمل ومؤهل للإرجاع.',
    ],
    stepsEn: [
      'You need a saved **pickup address** in Settings.',
      'From **Returns** or create order type Return, enter original order number and reason.',
      'Or use AINOW with order type **Return** and follow the steps.',
      'Ensure the original order is completed and eligible for return.',
    ],
    actions: [
      { textAr: 'المرتجعات', textEn: 'Returns', url: '/business/return-orders' },
      { textAr: 'إنشاء أوردر', textEn: 'Create order', url: '/business/create-order' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'جدولة استلام'],
    suggestionsEn: ['Create order', 'Schedule pickup'],
  },
  express_shipping: {
    id: 'express_shipping',
    titleAr: 'التوصيل السريع',
    titleEn: 'Express delivery',
    stepsAr: [
      'التوصيل السريع متاح لأوردرات **Deliver** فقط.',
      'تحتاج عنوان استلام محفوظ عند اختيار السريع.',
      'أثناء إنشاء الأوردر (أو مع AINOW) اختر **سريع** بعد تحديد الكاش.',
      'رسوم التوصيل السريع أعلى من العادي.',
    ],
    stepsEn: [
      'Express is available for **Deliver** orders only.',
      'A saved pickup address is required for express.',
      'When creating the order (or via AINOW), choose **express** after COD step.',
      'Express fees are higher than standard delivery.',
    ],
    actions: [
      { textAr: 'إنشاء أوردر', textEn: 'Create order', url: '/business/create-order' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'إضافة عنوان استلام'],
    suggestionsEn: ['Create order', 'Add pickup address'],
  },
  shop_orders: {
    id: 'shop_orders',
    titleAr: 'متجر المنتجات',
    titleEn: 'Business shop',
    stepsAr: [
      'افتح **المتجر** من القائمة لعرض المنتجات المتاحة.',
      'يمكنك إنشاء طلبات متجر من الصفحة المخصصة.',
      'راجع **طلبات المتجر** لمتابعة الحالة.',
    ],
    stepsEn: [
      'Open **Shop** from the menu to browse available products.',
      'Create shop orders from the shop page.',
      'Review **shop orders** for status updates.',
    ],
    actions: [
      { textAr: 'المتجر', textEn: 'Shop', url: '/business/shop' },
      { textAr: 'طلبات المتجر', textEn: 'Shop orders', url: '/business/shop/orders' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'حالة الطلب'],
    suggestionsEn: ['Create order', 'Order status'],
  },
  tickets_support: {
    id: 'tickets_support',
    titleAr: 'تذاكر الدعم',
    titleEn: 'Support tickets',
    stepsAr: [
      'افتح **التذاكر** من القائمة الجانبية.',
      'أنشئ تذكرة جديدة واشرح المشكلة بوضوح.',
      'تابع الردود من نفس الصفحة.',
    ],
    stepsEn: [
      'Open **Tickets** from the sidebar.',
      'Create a new ticket and describe your issue clearly.',
      'Follow replies on the same page.',
    ],
    actions: [
      { textAr: 'التذاكر', textEn: 'Tickets', url: '/business/tickets' },
    ],
    suggestionsAr: ['حالة الطلب', 'رصيدي'],
    suggestionsEn: ['Order status', 'My balance'],
  },
  integrations: {
    id: 'integrations',
    titleAr: 'ربط Shopify / WooCommerce',
    titleEn: 'Shopify / WooCommerce integrations',
    stepsAr: [
      'افتح **الإعدادات** → تبويب **التكاملات**.',
      'اتبع خطوات ربط Shopify أو WooCommerce.',
      'بعد الربط، تزامن الأوردرات من لوحة التحكم أو التطبيق المربوط.',
    ],
    stepsEn: [
      'Open **Settings** → **Integrations** tab.',
      'Follow steps to connect Shopify or WooCommerce.',
      'After connecting, sync orders from your dashboard or connected app.',
    ],
    actions: [
      { textAr: 'الإعدادات — التكاملات', textEn: 'Settings — Integrations', url: '/business/settings#integrations' },
    ],
    suggestionsAr: ['إنشاء أوردر', 'الأوردرات'],
    suggestionsEn: ['Create order', 'Orders'],
  },
  profile_settings: {
    id: 'profile_settings',
    titleAr: 'الملف والإعدادات',
    titleEn: 'Profile and settings',
    stepsAr: [
      'افتح **الإعدادات** من القائمة.',
      'تبويب **الملف**: الاسم، البريد، والهاتف.',
      'تبويب **العلامة التجارية**: اسم المتجر والشعار.',
      'تبويب **التفضيلات**: اللغة والإشعارات.',
    ],
    stepsEn: [
      'Open **Settings** from the menu.',
      '**Profile** tab: name, email, phone.',
      '**Brand** tab: store name and logo.',
      '**Preferences** tab: language and notifications.',
    ],
    actions: [
      { textAr: 'الإعدادات', textEn: 'Settings', url: '/business/settings' },
    ],
    suggestionsAr: ['إضافة عنوان استلام', 'جدولة استلام'],
    suggestionsEn: ['Add pickup address', 'Schedule pickup'],
  },
  account_completion: {
    id: 'account_completion',
    titleAr: 'إكمال الحساب',
    titleEn: 'Complete your account',
    stepsAr: [
      'إذا كان حسابك غير مكتمل، ستُوجَّه للوحة التحكم لإكمال البيانات.',
      'أكمل التحقق من البريد أو الهاتف إن طُلب منك.',
      'أضف عنوان استلام في الإعدادات قبل إنشاء الأوردرات أو الاستلامات.',
    ],
    stepsEn: [
      'If your account is incomplete, you will be guided from the dashboard.',
      'Complete email or phone verification if requested.',
      'Add a pickup address in Settings before orders or pickups.',
    ],
    actions: [
      { textAr: 'لوحة التحكم', textEn: 'Dashboard', url: '/business/dashboard' },
      { textAr: 'الإعدادات', textEn: 'Settings', url: '/business/settings' },
    ],
    suggestionsAr: ['إضافة عنوان استلام', 'إنشاء أوردر'],
    suggestionsEn: ['Add pickup address', 'Create order'],
  },
  zones_areas: {
    id: 'zones_areas',
    titleAr: 'المحافظة والمنطقة',
    titleEn: 'Governorate and zone',
    stepsAr: [
      'NowShipping يدعم القاهرة والجيزة والقليوبية.',
      'اكتب **اسم المنطقة** (مثل: المعادي، عابدين) واختر من القائمة المقترحة.',
      'العنوان = الشارع والمبنى فقط؛ المنطقة تُختار منفصلة.',
      'مع AINOW: اكتب العنوان والمنطقة وسيظهر لك أقرب خيارات للاختيار.',
    ],
    stepsEn: [
      'NowShipping supports Cairo, Giza, and Qalyubia.',
      'Type the **area name** (e.g. Maadi, Abdeen) and pick from suggestions.',
      'Address = street/building only; zone is selected separately.',
      'With AINOW: type address and area — closest matches will appear.',
    ],
    actions: [],
    suggestionsAr: ['إنشاء أوردر', 'كمّل الأوردر'],
    suggestionsEn: ['Create order', 'Continue order'],
  },
};

function normalizeText(text) {
  return String(text || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function isHelpQuestion(message) {
  const n = normalizeText(message);
  if (!n) return false;
  return HELP_PHRASES.some(function (phrase) {
    return n.includes(phrase.toLowerCase());
  });
}

function matchTopicByKeywords(message) {
  const n = normalizeText(message);
  for (const entry of TOPIC_KEYWORDS) {
    if (entry.patterns.some(function (p) { return n.includes(p.toLowerCase()); })) {
      return entry.topic;
    }
  }
  return null;
}

function inferTopicFromDraft(conversation, userData) {
  const draft = conversation?.activeDraft;
  if (!draft) return null;

  const pending = draft.pendingField;
  if (pending && PENDING_FIELD_TOPIC[pending]) {
    return PENDING_FIELD_TOPIC[pending];
  }

  if (draft.type === 'pickup' && !hasUsablePickupAddress(userData)) {
    return 'add_pickup_address';
  }

  if (draft.type === 'order' && draft.missingFields?.includes('selectedPickupAddressId')) {
    return 'add_pickup_address';
  }

  if (draft.type === 'pickup') return 'schedule_pickup';
  if (draft.type === 'order') return 'create_order';

  return null;
}

function detectPlatformHelp(message, conversation, userData) {
  const helpLike = isHelpQuestion(message);
  const keywordTopic = matchTopicByKeywords(message);
  const draftTopic = inferTopicFromDraft(conversation, userData);

  if (keywordTopic) {
    return { topicId: keywordTopic, reason: 'keyword' };
  }

  if (helpLike) {
    const topicId = draftTopic || 'create_order';
    return { topicId, reason: 'help_phrase' };
  }

  if (draftTopic && normalizeText(message).length < 30) {
    const vague = ['اعملها', 'how', 'do it', 'كده', 'دي'];
    if (vague.some(function (v) { return normalizeText(message).includes(v); })) {
      return { topicId: draftTopic, reason: 'vague_with_draft' };
    }
  }

  return null;
}

function resolveTopicId(topicId) {
  if (topicId && HELP_TOPICS[topicId]) return topicId;
  return 'create_order';
}

function formatSteps(steps, lang) {
  const isAr = lang === 'ar';
  return steps.map(function (step, i) {
    const num = isAr ? String(i + 1) : String(i + 1);
    return `${num}. ${step}`;
  });
}

function buildPlatformHelpResponse(topicId, lang, opts = {}) {
  const conversation = opts.conversation || null;
  const id = resolveTopicId(topicId);
  const topic = HELP_TOPICS[id];
  const isAr = lang === 'ar';
  const steps = isAr ? topic.stepsAr : topic.stepsEn;
  const formattedSteps = formatSteps(steps, lang);

  const intro = isAr
    ? `إليك الخطوات لـ **${topic.titleAr}**:`
    : `Here is how to **${topic.titleEn}**:`;

  const actions = (topic.actions || []).map(function (a) {
    return {
      text: isAr ? a.textAr : a.textEn,
      url: a.url,
    };
  });

  let suggestions = isAr ? topic.suggestionsAr : topic.suggestionsEn;
  if (conversation?.activeDraft?.type === 'pickup') {
    suggestions = isAr
      ? ['كمّل جدولة الاستلام', 'جدولة استلام']
      : ['Continue pickup scheduling', 'Schedule pickup'];
  } else if (conversation?.activeDraft?.type === 'order') {
    suggestions = isAr
      ? ['كمّل الأوردر', 'إنشاء أوردر']
      : ['Continue order', 'Create order'];
  }

  return {
    text: intro,
    intent: 'platform_help',
    helpGuide: {
      topicId: id,
      title: isAr ? topic.titleAr : topic.titleEn,
      steps: formattedSteps,
    },
    actions,
    suggestions: suggestions || [],
    draft: conversation?.activeDraft
      ? {
          complete: false,
          type: conversation.activeDraft.type,
        }
      : undefined,
  };
}

function buildHelpTopicSuggestion(lang, topicId) {
  const isAr = lang === 'ar';
  if (topicId === 'add_pickup_address') {
    return isAr ? 'شرح إضافة عنوان الاستلام' : 'How to add pickup address';
  }
  return isAr ? 'شرح الخطوات' : 'Show steps';
}

module.exports = {
  HELP_TOPICS,
  isHelpQuestion,
  detectPlatformHelp,
  buildPlatformHelpResponse,
  buildHelpTopicSuggestion,
  matchTopicByKeywords,
  inferTopicFromDraft,
};
