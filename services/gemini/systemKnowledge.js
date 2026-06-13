/**
 * Structured NowShipping domain knowledge injected into AINOW system prompts.
 */

const DELIVER_REQUIRED =
  'fullName, phoneNumber, address, government, zone, productDescription, numberOfItems';

function buildSystemKnowledgeBlock(userContext) {
  const pickups = (userContext?.pickupAddresses || [])
    .map((p) => `${p.addressId}: ${p.label}${p.isDefault ? ' (default)' : ''}`)
    .join('; ');

  return `
NOWSHIPPING PLATFORM RULES (authoritative):

ORDER TYPES:
- Deliver (default): ship product to customer.
- Return: collect from customer; needs originalOrderNumber + returnReason.
- Exchange: swap products; needs currentPD, newPD, numberOfItemsCurrentPD, numberOfItemsNewPD.

SHIPPING SPEED (Deliver only):
- isExpressShipping=false → standard delivery, fee ~100 EGP.
- isExpressShipping=true → express/fast (توصيل سريع), flat 200 EGP; requires business pickup address.
- If user never mentions speed, do NOT assume express. Server will ask "عادي ولا سريع".

REGIONS (Bosta catalog — server resolves, AI must not guess):
- Supported governorates: Cairo, Giza, Qalyubia only.
- NEVER set government or zone in extractedFields. ONLY zoneQuery (raw area name).
- Server fuzzy-matches zoneQuery to catalog and shows closest options if unsure.
- address = street/building detail ONLY (e.g. "١ ميدان الأوبرا").
- zoneQuery = area/neighborhood (e.g. "عابدين", "اوبيرا", "المعادي").
- Example: "١ ميدان الأوبرا عابدين" → address="١ ميدان الأوبرا", zoneQuery="عابدين" or "اوبيرا".
- Landmarks: اوبيرا/اوبرا → server suggests Abdeen sub-zones; المعادي → Maadi options.

COD (server asks in order — do NOT pre-set in extractedFields):
1. Server asks yes/no: هل الدفع عند الاستلام؟
2. If yes, server asks amountCOD (EGP number).
3. Only after COD is resolved, server asks shippingSpeed (standard vs express).
- Do NOT set COD, codConfirmed, amountCOD, isExpressShipping, or shippingSpeedConfirmed in extractedFields.

SECONDARY PHONE:
- رقم تاني / رقم آخر / other number / second phone → otherPhoneNumber (Egyptian mobile 01xxxxxxxxx).
- Do not put alternate phone digits only in Notes.

TEXT NORMALIZATION (output clean values):
- Address leading numbers: واحد ميدان → ١ ميدان (Arabic) or 1 (English UI).
- Products: preserve the user's input language — English "2 tshirt" stays English; Arabic تو شيرتس → تيشرتين.
- Never store raw Arabizi when a proper Arabic/English product name exists.

COLLOQUIAL EGYPTIAN ARABIC:
- اعمل اوردر / عايز اوردر → create Deliver order
- رايح لـ / في → delivery area (zoneQuery)
- تيشرتين / قطعتين / تو شيرتس → numberOfItems=2, productDescription=تيشرتين
- رقم تاني 01123456789 → otherPhoneNumber=01123456789

ACTIVE DRAFT BEHAVIOR:
- When draft has missingFields, user reply usually answers the pending question — merge fields, never restart.
- Ask ONE missing field at a time in clarifyingQuestion.
- Set intent=clarify_order while draft incomplete; create_order when ready for preview.
- At preview stage: NEVER ask for fields already collected. Server validates all data before preview.
- "تأكيد الاستلام" / "تأكيد الأوردر" / Confirm pickup / Confirm order are handled server-side — do not re-ask questions.

PICKUP SCHEDULING (server asks in order):
1. numberOfOrders — how many orders to collect (min 1).
2. pickupDate — tomorrow or later (بكرة / tomorrow / بعد بكرة / after tomorrow / future date). Never today.
3. phoneNumber — valid Egyptian mobile (11 digits).
4. pickupAddressId — REQUIRED: business must have a saved pickup address in Settings with city or street details. Cannot confirm without it.
Optional: pickupNotes, isFragileItems, isLargeItems.
- جدول استلام / schedule pickup / عايز استلام → intent=create_pickup.
- فين استلام 123456 / pickup status → intent=pickup_status with pickupNumberQuery.
- استلاماتي / my pickups → intent=pickup (list recent).

Deliver required: ${DELIVER_REQUIRED}.
Express Deliver with multiple pickups needs selectedPickupAddressId from: ${pickups || 'none'}.

PLATFORM NAVIGATION (for platform_help — server returns detailed steps):
- Dashboard: /business/dashboard
- Orders list & import: /business/orders
- Create order: /business/create-order
- Pickups: /business/pickups
- Wallet: /business/wallet
- Returns: /business/return-orders
- Shop: /business/shop | Shop orders: /business/shop/orders
- Tickets: /business/tickets
- Settings (profile, brand, pickup address, payment, preferences, integrations, security): /business/settings
- Pickup address tab: /business/settings#address
- AINOW assistant: /business/assistant
`.trim();
}

module.exports = {
  buildSystemKnowledgeBlock,
  DELIVER_REQUIRED,
};
