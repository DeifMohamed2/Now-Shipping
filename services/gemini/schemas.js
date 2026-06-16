const { Type } = require('@google/genai');

const EXTRACTED_FIELDS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    orderType: { type: Type.STRING, description: 'Deliver, Return, or Exchange' },
    fullName: { type: Type.STRING },
    phoneNumber: { type: Type.STRING },
    otherPhoneNumber: {
      type: Type.STRING,
      description: 'Alternate/second phone (رقم تاني / رقم آخر / other number)',
    },
    address: {
      type: Type.STRING,
      description:
        'Street/building/landmark only — strip meta labels like العنوان بالتفصيل or العنوان هو. Never include prompt filler.',
    },
    government: { type: Type.STRING, description: 'Leave empty — server resolves from zoneQuery' },
    zone: { type: Type.STRING, description: 'Leave empty — server resolves from zoneQuery' },
    zoneQuery: {
      type: Type.STRING,
      description:
        'Raw area/neighborhood from user speech (e.g. المعادي، اوبيرا). Set when user mentions area OR when address implies a different area than current draft zone.',
    },
    replaceZone: {
      type: Type.BOOLEAN,
      description:
        'Set true when latest message contradicts the draft zone (e.g. draft has Maadi but address says Opera). Server will re-resolve zone.',
    },
    isExpressShipping: { type: Type.BOOLEAN },
    productDescription: { type: Type.STRING },
    numberOfItems: { type: Type.NUMBER },
    COD: { type: Type.BOOLEAN, description: 'Do not set — server asks COD in order' },
    amountCOD: { type: Type.NUMBER, description: 'Do not set — server asks after COD yes/no' },
    codConfirmed: { type: Type.BOOLEAN, description: 'Do not set — server tracks COD step' },
    Notes: { type: Type.STRING },
    originalOrderNumber: { type: Type.STRING },
    returnReason: { type: Type.STRING },
    selectedPickupAddressId: { type: Type.STRING },
    currentPD: { type: Type.STRING },
    newPD: { type: Type.STRING },
    numberOfItemsCurrentPD: { type: Type.NUMBER },
    numberOfItemsNewPD: { type: Type.NUMBER },
    shippingSpeedConfirmed: {
      type: Type.BOOLEAN,
      description: 'Do not set — server asks delivery speed after COD',
    },
    numberOfOrders: { type: Type.NUMBER, description: 'For pickup scheduling — orders to collect' },
    pickupDate: { type: Type.STRING, description: 'Pickup date ISO or natural language e.g. tomorrow, بكرة' },
    pickupNotes: { type: Type.STRING, description: 'Optional pickup notes' },
    isFragileItems: { type: Type.BOOLEAN, description: 'Pickup has fragile items' },
    isLargeItems: { type: Type.BOOLEAN, description: 'Pickup has large/heavy items' },
    pickupAddressId: { type: Type.STRING, description: 'Leave empty unless user names a specific saved address' },
    pickupNumberQuery: { type: Type.STRING, description: 'For pickup_status intent — pickup number to track' },
  },
};

const ASSISTANT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      description:
        'create_order | clarify_order | create_pickup | clarify_pickup | pickup_status | order_status | wallet | pickup | platform_help | general_chat | out_of_scope',
    },
    helpTopic: {
      type: Type.STRING,
      description:
        'When intent=platform_help: add_pickup_address | create_order | schedule_pickup | order_status | wallet_balance | import_orders | return_order | express_shipping | shop_orders | tickets_support | integrations | profile_settings | account_completion | zones_areas',
    },
    language: { type: Type.STRING, description: 'ar or en' },
    transcript: { type: Type.STRING, description: 'Voice transcript if applicable' },
    replyText: {
      type: Type.STRING,
      description: 'Natural language reply to show the user in their language',
    },
    extractedFields: EXTRACTED_FIELDS_SCHEMA,
    missingRequiredFields: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    clarifyingQuestion: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    orderNumberQuery: { type: Type.STRING, description: 'For order_status intent' },
    pickupNumberQuery: { type: Type.STRING, description: 'For pickup_status intent' },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['intent', 'language', 'replyText', 'extractedFields', 'missingRequiredFields', 'confidence'],
};

module.exports = {
  ASSISTANT_RESPONSE_SCHEMA,
  EXTRACTED_FIELDS_SCHEMA,
  TRANSCRIPT_ONLY_SCHEMA: {
    type: Type.OBJECT,
    properties: {
      transcript: { type: Type.STRING, description: 'Exact transcription of the voice message' },
      language: { type: Type.STRING, description: 'ar or en based on spoken language' },
    },
    required: ['transcript', 'language'],
  },
};
