const { GoogleGenAI } = require('@google/genai');
const { ASSISTANT_RESPONSE_SCHEMA, ORDER_EXTRACTION_SCHEMA, TRANSCRIPT_ONLY_SCHEMA } = require('./schemas');
const { buildSystemPrompt, buildOrderExtractionPrompt } = require('./prompts');

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

function isQuotaError(err) {
  const msg = String(err?.message || '');
  return err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
}

async function callWithRetry(fn, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isQuotaError(err) && i < retries) {
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
        if (parsed.draft && parsed.draft.fields && Object.keys(parsed.draft.fields).length) {
          const f = parsed.draft.fields;
          const collected = [];
          if (f.fullName) collected.push(`name=${f.fullName}`);
          if (f.phoneNumber) collected.push(`phone=${f.phoneNumber}`);
          if (f.address) collected.push(`address=${f.address}`);
          if (f.zone || f.zoneQuery) collected.push(`zone=${f.zone || f.zoneQuery}`);
          if (f.productDescription) collected.push(`product=${f.productDescription}`);
          if (collected.length) parts.push(`[Collected: ${collected.join('; ')}]`);
        }
        if (parsed.chips && parsed.chips.length) {
          const chipSummary = parsed.chips
            .map((c) => `${c.label || c.key}=${c.value}`)
            .join('; ');
          if (chipSummary) parts.push(`[Saved chips: ${chipSummary}]`);
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

async function generateParsedResponse({ model, contents, systemInstruction, schema }) {
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
        responseSchema: schema || ASSISTANT_RESPONSE_SCHEMA,
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
  if (!Array.isArray(parsed.orderEntities)) parsed.orderEntities = [];
  return parsed;
}

/**
 * Order-pipeline extraction: structured entities with per-field confidence.
 */
async function extractOrderEntities({
  userMessage,
  history,
  userContext,
  draftFields,
  draftMeta,
  useLite = false,
}) {
  const model = useLite ? getLiteModel() : getChatModel();
  const systemInstruction = buildOrderExtractionPrompt(userContext, draftFields, draftMeta);
  const historyContents = buildHistoryContents(history);
  const contents = [
    ...historyContents,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  try {
    const parsed = await generateParsedResponse({
      model,
      contents,
      systemInstruction,
      schema: ORDER_EXTRACTION_SCHEMA,
    });
    if (!Array.isArray(parsed.entities)) parsed.entities = [];
    if (!Array.isArray(parsed.deleteFields)) parsed.deleteFields = [];
    if (typeof parsed.correction !== 'boolean') parsed.correction = false;
    return parsed;
  } catch (error) {
    if (!useLite && (error.code === 'PARSE_ERROR' || error.status >= 500 || isQuotaError(error))) {
      return extractOrderEntities({
        userMessage,
        history,
        userContext,
        draftFields,
        draftMeta,
        useLite: true,
      });
    }
    throw error;
  }
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
    if (!useLite && (error.code === 'PARSE_ERROR' || error.status >= 500 || isQuotaError(error))) {
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
 * Lite-model voice transcription only (separate quota, no full extraction).
 */
async function transcribeAudioOnly({ audioBuffer, mimeType, preferredLang }) {
  const ai = getClient();
  const model = getLiteModel();
  const audioBase64 = audioBuffer.toString('base64');
  const langHint = preferredLang === 'ar' ? 'ar' : 'en';

  const systemInstruction =
    `Transcribe Egyptian Arabic (عامية مصرية) or English voice accurately. ` +
    `Return JSON with transcript (exact words) and language (ar or en). ` +
    `UI preference: ${langHint}.`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/webm',
                data: audioBase64,
              },
            },
            { text: 'Transcribe this voice message exactly.' },
          ],
        },
      ],
      config: {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: TRANSCRIPT_ONLY_SCHEMA,
      },
    })
  );

  const parsed = parseJsonResponse(response.text);
  if (!parsed?.transcript) {
    const err = new Error('Failed to parse lite voice transcript');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  return parsed;
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
  useLite = false,
}) {
  const ai = getClient();
  const model = useLite ? getLiteModel() : getChatModel();
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
    if (!useLite && (error.code === 'PARSE_ERROR' || error.status >= 500 || isQuotaError(error))) {
      console.warn('Gemini voice primary failed, retrying with lite model:', error.message);
      return transcribeAndExtract({
        audioBuffer,
        mimeType,
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

function isConfigured() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

module.exports = {
  getClient,
  getChatModel,
  getLiteModel,
  extractAssistantResponse,
  extractOrderEntities,
  transcribeAndExtract,
  transcribeAudioOnly,
  isConfigured,
  isQuotaError,
  parseJsonResponse,
};
