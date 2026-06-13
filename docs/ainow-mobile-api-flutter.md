# AINOW Mobile API — Flutter integration guide

This document describes how the **Flutter business mobile app** can use the same AINOW assistant as the web portal: text chat, voice transcription, order/pickup drafts, platform help guides, wallet queries, and confirmations.

---

## Base URL and authentication

| Item | Value |
|------|--------|
| **API base** | `https://<your-host>/api/v1/assistant` |
| **Auth** | `Authorization: Bearer <JWT>` |
| **Login** | `POST /api/v1/auth/login` |

### Login (business user)

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "merchant@example.com",
  "password": "your-password"
}
```

**Success `200`**

```json
{
  "status": "success",
  "message": "Login successful",
  "token": "<JWT>",
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "role": "Business",
    "isCompleted": true
  }
}
```

Store `token` securely (e.g. `flutter_secure_storage`) and attach it to every AINOW request.

### Recommended headers (all AINOW calls)

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <token>` |
| `Accept` | `application/json` |
| `Content-Type` | `application/json` (text endpoints) |
| `X-App-Language` | `ar` or `en` (optional; used when message has no Arabic script) |

You may also pass `lang` in JSON body or query string: `"lang": "ar"`.

---

## Endpoint overview

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ainow/status` | Capabilities, models, voice limits (no Gemini key exposed) |
| `GET` | `/ainow/greeting` | Static welcome message + suggestion chips |
| `GET` | `/ainow/conversation` | Load or create active conversation |
| `POST` | `/ainow/message` | Send text message |
| `POST` | `/ainow/voice` | Send audio → server transcribes + responds |
| `POST` | `/ainow/confirm-order` | Confirm active order draft |
| `POST` | `/ainow/confirm-pickup` | Confirm active pickup draft |
| `POST` | `/ainow/cancel-draft` | Cancel active draft |
| `POST` | `/ainow/clear` | Clear chat and start fresh |
| `GET` | `/preferences` | User assistant UI preferences |
| `POST` | `/preferences` | Update preferences |

Legacy aliases `/conversation`, `/send`, `/clear` map to the same handlers.

---

## 1. Check service status

Call once after login (or on assistant screen open).

```http
GET /api/v1/assistant/ainow/status
Authorization: Bearer <token>
```

**Success `200`**

```json
{
  "status": "success",
  "ainow": {
    "configured": true,
    "provider": "gemini",
    "chatModel": "gemini-2.5-flash",
    "liteModel": "gemini-2.5-flash-lite",
    "features": {
      "textChat": true,
      "voiceTranscription": true,
      "orderDraft": true,
      "pickupDraft": true,
      "platformHelp": true,
      "walletQueries": true
    },
    "voice": {
      "maxFileSizeBytes": 8388608,
      "fieldName": "audio",
      "supportedMimeTypes": ["audio/webm", "audio/mp4", "audio/m4a", "..."],
      "recommendedMimeTypes": {
        "android": "audio/mp4",
        "ios": "audio/m4a",
        "web": "audio/webm"
      },
      "optionalFormFields": ["mimeType", "lang"]
    },
    "apiVersion": "1"
  },
  "meta": { "lang": "en" }
}
```

If `configured` is `false`, show fallback UI and link to manual order creation.

---

## 2. Load conversation

```http
GET /api/v1/assistant/ainow/conversation
Authorization: Bearer <token>
X-App-Language: ar
```

**Success `200`**

```json
{
  "status": "success",
  "conversation": {
    "_id": "...",
    "messages": [
      {
        "sender": "assistant",
        "content": "{\"text\":\"...\",\"suggestions\":[...]}",
        "timestamp": "2026-06-07T10:00:00.000Z",
        "payload": {
          "text": "أهلاً! أنا AINOW...",
          "suggestions": ["إنشاء أوردر", "حالة آخر أوردر"]
        }
      }
    ],
    "activeDraft": {
      "type": null,
      "fields": {},
      "missingFields": [],
      "pendingField": null
    },
    "isActive": true
  },
  "meta": { "lang": "ar" }
}
```

**Mobile tip:** Render assistant bubbles from `message.payload` (already parsed JSON). User messages use plain `content` string.

---

## 3. Send text message

```http
POST /api/v1/assistant/ainow/message
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "عايز أعمل استلام بكرة",
  "lang": "ar"
}
```

**Success `200`**

```json
{
  "status": "success",
  "message": "Message sent successfully",
  "response": { "...see response schema below..." },
  "conversation": { "...serialized conversation..." },
  "meta": { "lang": "ar" }
}
```

The `response` object is **identical** to what the web AINOW widget receives. Your Flutter UI should mirror the web widget renderers.

---

## 4. Voice message (transcription)

Transcription is performed **server-side** via Gemini multimodal API. The app only records and uploads audio.

```http
POST /api/v1/assistant/ainow/voice
Authorization: Bearer <token>
Content-Type: multipart/form-data

audio=<file>
mimeType=audio/m4a
lang=ar
```

| Field | Required | Notes |
|-------|----------|--------|
| `audio` | Yes | Binary audio file (max 8 MB) |
| `mimeType` | Recommended | Send when platform reports `application/octet-stream` |
| `lang` | Optional | `ar` or `en` |

**Success `200`**

```json
{
  "status": "success",
  "message": "Voice processed successfully",
  "response": {
    "text": "...",
    "transcript": "عايز أعمل استلام بكرة",
    "intent": "create_pickup",
    "suggestions": ["..."],
    "draft": { "complete": false, "type": "pickup" }
  },
  "conversation": { "..." },
  "meta": { "lang": "ar" }
}
```

Display the user bubble from `response.transcript`, then render the assistant `response` like a text reply.

### Flutter voice recording (recommended packages)

```yaml
dependencies:
  record: ^5.1.0
  path_provider: ^2.1.0
  http: ^1.2.0
```

```dart
import 'dart:io';
import 'package:record/record.dart';
import 'package:http/http.dart' as http;

Future<void> sendAinowVoice(String token, String baseUrl) async {
  final recorder = AudioRecorder();
  final path = '${(await getTemporaryDirectory()).path}/ainow.m4a';

  await recorder.start(
    const RecordConfig(encoder: AudioEncoder.aacLc),
    path: path,
  );
  // ... stop after user releases mic ...
  await recorder.stop();

  final uri = Uri.parse('$baseUrl/api/v1/assistant/ainow/voice');
  final request = http.MultipartRequest('POST', uri)
    ..headers['Authorization'] = 'Bearer $token'
    ..headers['X-App-Language'] = 'ar'
    ..fields['mimeType'] = 'audio/m4a'
    ..fields['lang'] = 'ar'
    ..files.add(await http.MultipartFile.fromPath('audio', path));

  final streamed = await request.send();
  final body = await streamed.stream.bytesToString();
  // parse JSON → AinowVoiceResponse
}
```

| Platform | Suggested encoder | `mimeType` |
|----------|-------------------|------------|
| iOS | AAC / m4a | `audio/m4a` |
| Android | AAC in mp4 container | `audio/mp4` |

---

## 5. Confirm / cancel draft

When `response.preview` is present and draft is complete, show confirm/cancel actions (same as web).

```http
POST /api/v1/assistant/ainow/confirm-order
Authorization: Bearer <token>
```

```http
POST /api/v1/assistant/ainow/confirm-pickup
Authorization: Bearer <token>
```

```http
POST /api/v1/assistant/ainow/cancel-draft
Authorization: Bearer <token>
```

**Confirm success `201`**

```json
{
  "status": "success",
  "success": true,
  "text": "تم إنشاء الأوردر بنجاح",
  "orderNumber": "12345678",
  "actions": [{ "text": "عرض الأوردر", "url": "/business/orders" }],
  "conversation": { "..." }
}
```

Users can also confirm by sending text: `تأكيد الأوردر` / `تأكيد الاستلام` via `/ainow/message`.

---

## 6. Clear conversation

```http
POST /api/v1/assistant/ainow/clear
Authorization: Bearer <token>
```

Returns a new conversation with greeting message.

---

## Assistant `response` schema (render contract)

Every assistant reply (text or voice) uses this structure. **Match the web widget** for parity.

### Core fields

| Field | Type | When |
|-------|------|------|
| `text` | string | Main assistant message |
| `intent` | string | `create_order`, `clarify_pickup`, `platform_help`, `wallet`, `pickup_created`, etc. |
| `suggestions` | string[] | Footer quick-reply chips |
| `transcript` | string | Voice only — user's spoken text |

### Draft flow

| Field | Type | When |
|-------|------|------|
| `draft` | object | Active order/pickup draft state |
| `draft.type` | `"order"` \| `"pickup"` | Draft kind |
| `draft.complete` | boolean | Ready for preview confirm |
| `progress` | object | `{ collected, total, missingFields }` |
| `pendingField` | string | Current field key (e.g. `pickupAddressId`, `zone`) |
| `clarifyingQuestion` | string | Question to show prominently |
| `quickReplies` | array | Tappable options `{ label, value }` |
| `chips` | array | COD / express / order-type chips |
| `structuredField` | object | Date picker, zone list, etc. |
| `preview` | object | Order/pickup summary before confirm |
| `preview.actions` | array | `{ type: "confirm_order" }` or `confirm_pickup` |

### Platform help (`intent: "platform_help"`)

When user asks how-to questions (e.g. *"ازاي اضيف عنوان استلام"*):

```json
{
  "text": "إليك الخطوات لـ **إضافة عنوان استلام**:",
  "intent": "platform_help",
  "helpGuide": {
    "topicId": "add_pickup_address",
    "title": "إضافة عنوان استلام",
    "steps": [
      "1. من القائمة الجانبية اضغط **الإعدادات**.",
      "2. افتح تبويب **عنوان الاستلام**.",
      "..."
    ]
  },
  "actions": [
    {
      "text": "فتح الإعدادات — عنوان الاستلام",
      "url": "/business/settings#address"
    }
  ],
  "suggestions": ["كمّل جدولة الاستلام"],
  "draft": { "type": "pickup", "complete": false }
}
```

**Flutter rendering:**

1. Show `text` with `**bold**` segments as `TextSpan(fontWeight: FontWeight.bold)`.
2. Render `helpGuide.steps` as numbered list in a card.
3. Map `actions[].url` to in-app routes (see deep links below).
4. Show `helpTopic` chip on blocked drafts when `helpTopic` is set without full `helpGuide`.

### Blocked draft (missing pickup address)

```json
{
  "text": "محتاج تضيف عنوان استلام الأول.",
  "intent": "clarify_pickup",
  "helpTopic": "add_pickup_address",
  "actions": [{ "text": "الإعدادات", "url": "/business/settings#address" }],
  "suggestions": ["شرح إضافة عنوان الاستلام", "كمّل جدولة الاستلام"]
}
```

Tapping the help suggestion sends another message; server returns full `helpGuide`.

### Wallet / status list responses

| Field | Type |
|-------|------|
| `data` | array of `{ orderNumber, status, ... }` |
| `actions` | deep links |

---

## Deep links: web paths → Flutter screens

Server `actions[].url` uses web paths. Map them in the app:

| Server URL | Flutter screen |
|------------|----------------|
| `/business/settings#address` | Settings → Pickup Address tab |
| `/business/settings#integrations` | Settings → Integrations tab |
| `/business/settings` | Settings home |
| `/business/create-order` | Create order |
| `/business/orders` | Orders list |
| `/business/pickups` | Pickups |
| `/business/wallet` | Wallet |
| `/business/return-orders` | Returns |
| `/business/tickets` | Support tickets |
| `/business/shop` | Shop |

---

## Suggested Flutter architecture

```
lib/
  features/ainow/
    data/
      ainow_api_client.dart      # HTTP + multipart voice
      ainow_repository.dart
      models/
        ainow_response.dart
        ainow_conversation.dart
        ainow_help_guide.dart
    presentation/
      ainow_screen.dart
      widgets/
        ainow_message_bubble.dart
        ainow_help_guide_card.dart
        ainow_draft_preview.dart
        ainow_suggestion_bar.dart
        ainow_voice_button.dart
    ainow_controller.dart        # Riverpod / Bloc
```

### `AinowResponse` Dart model (minimal)

```dart
class AinowResponse {
  final String text;
  final String? intent;
  final String? transcript;
  final List<String> suggestions;
  final AinowHelpGuide? helpGuide;
  final String? helpTopic;
  final List<AinowAction> actions;
  final AinowDraft? draft;
  final AinowPreview? preview;
  // + progress, quickReplies, structuredField, chips, data

  factory AinowResponse.fromJson(Map<String, dynamic> json) => AinowResponse(
    text: json['text'] as String? ?? '',
    intent: json['intent'] as String?,
    transcript: json['transcript'] as String?,
    suggestions: (json['suggestions'] as List?)?.cast<String>() ?? [],
    helpGuide: json['helpGuide'] != null
        ? AinowHelpGuide.fromJson(json['helpGuide'])
        : null,
    helpTopic: json['helpTopic'] as String?,
    actions: (json['actions'] as List?)
            ?.map((e) => AinowAction.fromJson(e))
            .toList() ??
        [],
    draft: json['draft'] != null ? AinowDraft.fromJson(json['draft']) : null,
    preview: json['preview'] != null ? AinowPreview.fromJson(json['preview']) : null,
  );
}
```

### UI parity checklist (match web widget)

- [ ] Progress bar when `progress` present
- [ ] Quick replies → send `value` as next message
- [ ] Suggestion chips → send text; if draft complete + confirm phrase → call confirm endpoint
- [ ] Preview card with disabled state after confirm
- [ ] Help guide card for `helpGuide`
- [ ] Help chip when `helpTopic` without guide
- [ ] Voice: replace placeholder user bubble with `transcript`
- [ ] Disable send while request in flight (typing indicator)

---

## Error handling

| HTTP | Meaning | App action |
|------|---------|------------|
| `401` | Invalid/expired JWT | Redirect to login |
| `400` | Validation (empty message, bad audio, confirm failed) | Show `message` from JSON |
| `500` | Server error | Retry + fallback message |

Mobile error envelope:

```json
{
  "status": "error",
  "message": "Audio file is required"
}
```

Web session routes return `{ "error": "..." }` — only `/api/v1/assistant/*` uses `status` + `message`.

---

## Conversation sync with web

The same MongoDB `AssistantConversation` document is used for web and mobile. If a merchant starts a pickup draft on web and opens the app, `GET /ainow/conversation` returns the same `activeDraft`. No separate mobile session is required.

---

## Security notes

1. **Never** embed `GEMINI_API_KEY` in the Flutter app.
2. Store JWT in secure storage; refresh via re-login.
3. Voice files are processed in memory on the server and not stored permanently.
4. Rate limiting may apply server-side (`checkRateLimit` in orchestrator).

---

## Quick test with cURL

```bash
TOKEN="<jwt-from-login>"
BASE="https://your-host.com/api/v1/assistant"

curl -s "$BASE/ainow/status" -H "Authorization: Bearer $TOKEN" | jq

curl -s "$BASE/ainow/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"ممكن تشرحلي ازاي اضيف عنوان استلام","lang":"ar"}' | jq

curl -s "$BASE/ainow/voice" \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@recording.m4a" \
  -F "mimeType=audio/m4a" \
  -F "lang=ar" | jq
```

---

## Related server files

| File | Role |
|------|------|
| `routes/api/v1/assistant.js` | Mobile API routes |
| `controllers/assistantController.js` | Request handlers |
| `services/ai/assistantOrchestrator.js` | Business logic (shared with web) |
| `services/ai/platformHelpEngine.js` | Platform help topics |
| `utils/ainowApiSerializer.js` | Parsed `payload` on messages |
| `public/assets/rJS/business/ainow-widget.js` | Web reference UI |

For platform help behavior and topic list, see `scripts/test-platform-help.js`.
