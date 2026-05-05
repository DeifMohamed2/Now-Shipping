# WhatsApp compliance (Wasender guidance)

This app sends **transactional** WhatsApp messages only: order picked up, courier heading to customer, and exchange pickup updates (`utils/whatsapp.js`). Customers already engaged by placing an order; messages are personalized and include an **HTTPS** tracking link for their shipment.

Follow [Wasender’s messaging guidance](https://wasenderapi.com) (warm-up, consent context, opt-out, pacing) to reduce risk of number flagging or blocking. The items below split what **operators** must do vs what the **server** can enforce.

## Operator responsibilities (not enforced in code)

- **Warm up the number** before heavy API use: for a newly registered SIM, use WhatsApp normally with real users for a while; avoid linking the session (QR) to the API the same day as registration when possible.
- **Complete the WhatsApp Business profile**: photo and description help legitimacy.
- **Do not repurpose this channel for unsolicited bulk marketing**. Use email/SMS/other channels for campaigns unless you add explicit consent and tooling.
- **Links**: Tracking URLs are order-specific and HTTPS. Avoid stuffing unrelated links into transactional templates.

## Server-enforced safeguards

Configurable via environment variables (see root `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `WHATSAPP_MIN_SEND_INTERVAL_MS` | `30000` | Minimum spacing between **completed** sends from this process (~2/min ceiling Wasender cites as a conservative starting point). Set `0` to disable spacing (e.g. local testing). |
| `WHATSAPP_SEND_JITTER_MS_MAX` | `2000` | Extra random delay between `0` and this many ms after the interval wait (more natural pacing). Set `0` to disable jitter. |
| `WHATSAPP_OPT_OUT_FOOTER` | _(empty)_ | If set, appended to every customer message (e.g. how to reply STOP or contact you to opt out of shipment updates). Use `\n` in `.env` for line breaks if needed. |

Sends are **serialized** in a FIFO queue: if many couriers trigger notifications at once, WhatsApp deliveries may **stagger** by design.

## Heading-to-customer message

`sendHeadingToCustomerNotification` runs only when an order becomes **`headingToCustomer`**:

- **Express:** courier API `POST /api/v1/courier/orders/:orderNumber/scan-fast-shipping` (`scanFastShippingOrder` in `controllers/courierController.js`).
- **Non-express (bulk):** admin **`courier_received`** moves all `inProgress` orders for a courier to `headingToCustomer` (`controllers/adminController.js`).

Message text branches on **`orderShipping.orderType`** (Deliver / Exchange / Return) and **`isExpressShipping`** inside `buildHeadingToCustomerBody` in [`utils/whatsapp.js`](../utils/whatsapp.js). New code paths that set `headingToCustomer` should call the same helper.

## Inbound “STOP” handling

Not implemented here. Processing opt-out replies requires a Wasender **webhook**, inbound parsing, and storing preferences—add separately if needed.
