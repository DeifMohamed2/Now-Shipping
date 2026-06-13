const { GoogleGenAI } = require('@google/genai');
const { ASSISTANT_RESPONSE_SCHEMA } = require('./schemas');
const { buildSystemPrompt } = require('./prompts');

let client = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

function getChatModel() {
  return process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
}

function getLiteModel() {
  return process.env.GEMINI_LITE_MODEL || 'gemini-2.5-flash-lite';
}

function parseJsonResponse(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* try repair truncated JSON */
      }
    }
    let repaired = trimmed;
    if (repaired.startsWith('{') && !repaired.endsWith('}')) {
      repaired = repaired.replace(/,\s*$/, '') + '}';
      try {
        return JSON.parse(repaired);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callWithRetry(fn, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const is429 = err.status === 429 || (err.message && err.message.includes('429'));
      if (is429 && i < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function buildHistoryContents(messages) {
  const contents = [];
  const recent = (messages || []).slice(-12);
  for (const msg of recent) {
    if (msg.sender === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.sender === 'assistant') {
      let text = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        const parts = [];
        if (parsed.text) parts.push(parsed.text);
        if (parsed.clarifyingQuestion && parsed.clarifyingQuestion !== parsed.text) {
          parts.push(`[Asked: ${parsed.clarifyingQuestion}]`);
        }
        if (parsed.draft && parsed.draft.missingFields && parsed.draft.missingFields.length) {
          parts.push(`[Missing: ${parsed.draft.missingFields.join(', ')}]`);
        }
        text = parts.length ? parts.join('\n') : (parsed.replyText || msg.content);
      } catch {
        /* plain text */
      }
      contents.push({ role: 'model', parts: [{ text }] });
    }
  }
  return contents;
}

async function generateParsedResponse({ model, contents, systemInstruction }) {
  const ai = getClient();
  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: ASSISTANT_RESPONSE_SCHEMA,
      },
    })
  );

  const parsed = parseJsonResponse(response.text);
  if (!parsed) {
    console.error('Gemini parse failed. finishReason:', response.candidates?.[0]?.finishReason);
    const err = new Error('Failed to parse Gemini structured response');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  if (!parsed.extractedFields) parsed.extractedFields = {};
  if (!Array.isArray(parsed.missingRequiredFields)) parsed.missingRequiredFields = [];
  return parsed;
}

/**
 * @param {object} params
 * @param {string} params.userMessage
 * @param {Array} params.history
 * @param {object} params.userContext
 * @param {object} params.draftFields
 * @param {object} params.regionHints
 * @param {object} [params.draftMeta]
 * @param {boolean} [params.useLite]
 */
async function extractAssistantResponse({
  userMessage,
  history,
  userContext,
  draftFields,
  regionHints,
  draftMeta,
  useLite = false,
}) {
  const model = useLite ? getLiteModel() : getChatModel();
  const systemInstruction = buildSystemPrompt(userContext, draftFields, regionHints, draftMeta);

  const historyContents = buildHistoryContents(history);
  const contents = [
    ...historyContents,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  try {
    return await generateParsedResponse({ model, contents, systemInstruction });
  } catch (error) {
    if (!useLite && (error.code === 'PARSE_ERROR' || error.status >= 500)) {
      console.warn('Gemini primary model failed, retrying with lite:', error.message);
      return extractAssistantResponse({
        userMessage,
        history,
        userContext,
        draftFields,
        regionHints,
        draftMeta,
        useLite: true,
      });
    }
    throw error;
  }
}

/**
 * Transcribe audio and extract order intent in one multimodal call.
 */
async function transcribeAndExtract({
  audioBuffer,
  mimeType,
  history,
  userContext,
  draftFields,
  regionHints,
  draftMeta,
}) {
  const ai = getClient();
  const model = getChatModel();
  const systemInstruction =
    buildSystemPrompt(userContext, draftFields, regionHints, draftMeta) +
    '\n\nVOICE INPUT: Transcribe Egyptian Arabic (عامية مصرية) accurately. Preserve names, addresses, and Arabic-Indic phone digits in transcript. Set transcript field, then extract order fields. Understand colloquial shipping phrases in context of the conversation and active draft.';

  const historyContents = buildHistoryContents(history);
  const audioBase64 = audioBuffer.toString('base64');

  const contents = [
    ...historyContents,
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'audio/webm',
            data: audioBase64,
          },
        },
        { text: 'Transcribe this voice message and help with the shipping request.' },
      ],
    },
  ];

  try {
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.3,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: ASSISTANT_RESPONSE_SCHEMA,
        },
      })
    );

    const parsed = parseJsonResponse(response.text);
    if (!parsed) {
      const err = new Error('Failed to parse Gemini voice response');
      err.code = 'PARSE_ERROR';
      throw err;
    }
    if (!parsed.extractedFields) parsed.extractedFields = {};
    return parsed;
  } catch (error) {
    if (error.code === 'PARSE_ERROR' || error.status >= 500) {
      console.warn('Gemini voice primary failed, retrying text-only lite on transcript hint');
      throw error;
    }
    throw error;
  }
}

function isConfigured() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

module.exports = {
  getClient,
  getChatModel,
  getLiteModel,
  extractAssistantResponse,
  transcribeAndExtract,
  isConfigured,
  parseJsonResponse,
};
