/**
 * Normalize AINOW conversation + assistant payloads for mobile clients.
 */

const AINOW_VOICE_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/ogg',
  'video/mp4',
  'application/octet-stream',
];

function parseAssistantPayload(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  try {
    return JSON.parse(content);
  } catch {
    return { text: String(content) };
  }
}

function serializeMessage(msg) {
  const base = {
    sender: msg.sender,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  if (msg.sender === 'assistant') {
    base.payload = parseAssistantPayload(msg.content);
  }
  return base;
}

function serializeConversation(conversation) {
  if (!conversation) return null;
  const doc = typeof conversation.toObject === 'function' ? conversation.toObject() : conversation;
  return {
    _id: doc._id,
    user: doc.user,
    messages: (doc.messages || []).map(serializeMessage),
    activeDraft: doc.activeDraft || { type: null, fields: {}, missingFields: [] },
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function apiSuccess(body, statusCode = 200) {
  return { statusCode, body: { status: 'success', ...body } };
}

function apiError(message, statusCode = 400, extra = {}) {
  return {
    statusCode,
    body: { status: 'error', message, ...extra },
  };
}

module.exports = {
  AINOW_VOICE_MIME_TYPES,
  parseAssistantPayload,
  serializeMessage,
  serializeConversation,
  apiSuccess,
  apiError,
};
