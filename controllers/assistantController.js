const { AssistantConversation, AssistantPreferences } = require('../models/assistant');
const orchestrator = require('../services/ai/assistantOrchestrator');
const { isConfigured, getChatModel, getLiteModel } = require('../services/gemini/geminiClient');
const {
  AINOW_VOICE_MIME_TYPES,
  serializeConversation,
} = require('../utils/ainowApiSerializer');

function isMobileApiRequest(req) {
  return String(req.originalUrl || req.baseUrl || '').includes('/api/v1/assistant');
}

function resolveLangHint(req) {
  if (req.body?.lang) return String(req.body.lang).toLowerCase().startsWith('ar') ? 'ar' : 'en';
  if (req.query?.lang) return String(req.query.lang).toLowerCase().startsWith('ar') ? 'ar' : 'en';
  const appLang = req.headers['x-app-language'] || req.headers['accept-language'];
  if (appLang) {
    const first = String(appLang).split(',')[0].trim().toLowerCase();
    if (first.startsWith('ar')) return 'ar';
    if (first.startsWith('en')) return 'en';
  }
  const cookieLang = req.cookies?.language || req.language;
  if (cookieLang && String(cookieLang).toLowerCase().startsWith('ar')) return 'ar';
  return 'en';
}

function detectLang(req, message) {
  if (message && /[\u0600-\u06FF]/.test(message)) return 'ar';
  return resolveLangHint(req);
}

function getGreeting(req) {
  return orchestrator.getGreeting(detectLang(req));
}

function buildApiPayload(req, extras = {}) {
  if (!isMobileApiRequest(req)) return extras;
  return {
    status: 'success',
    ...extras,
    meta: {
      lang: detectLang(req),
      ...(extras.meta || {}),
    },
  };
}

function sendJson(res, req, statusCode, body) {
  if (isMobileApiRequest(req) && body && !body.status && !body.error) {
    return res.status(statusCode).json(buildApiPayload(req, body));
  }
  return res.status(statusCode).json(body);
}

function sendError(res, req, statusCode, message, extra = {}) {
  if (isMobileApiRequest(req)) {
    return res.status(statusCode).json({ status: 'error', message, ...extra });
  }
  return res.status(statusCode).json({ error: message, ...extra });
}

const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return sendError(res, req, 400, 'Message is required');
    }

    const lang = detectLang(req, message);
    const conversation = await orchestrator.getOrCreateConversation(req.userData._id);
    conversation.messages.push({ sender: 'user', content: message });

    const response = await orchestrator.processTextMessage(req.userData._id, message, conversation, {
      preferredLang: lang,
    });

    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify(response),
    });
    await conversation.save();

    sendJson(res, req, 200, {
      message: 'Message sent successfully',
      response,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error('Error in sendMessage:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const sendAinowMessage = sendMessage;

const sendAinowVoice = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return sendError(res, req, 400, 'Audio file is required');
    }

    const lang = detectLang(req);
    const conversation = await orchestrator.getOrCreateConversation(req.userData._id);
    const mimeType = req.body?.mimeType || req.file.mimetype || 'audio/webm';

    conversation.messages.push({
      sender: 'user',
      content: '[voice message]',
    });

    const response = await orchestrator.processVoiceMessage(
      req.userData._id,
      req.file.buffer,
      mimeType,
      conversation,
      { preferredLang: lang }
    );

    if (response.transcript) {
      conversation.messages[conversation.messages.length - 1].content = response.transcript;
    }

    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify(response),
    });
    await conversation.save();

    sendJson(res, req, 200, {
      message: 'Voice processed successfully',
      response,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error('Error in sendAinowVoice:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const confirmAinowPickup = async (req, res) => {
  try {
    const conversation = await orchestrator.getOrCreateConversation(req.userData._id);
    const result = await orchestrator.confirmPickup(
      req.userData._id,
      conversation,
      detectLang(req)
    );

    if (!result.success) {
      return sendError(res, req, 400, result.error);
    }

    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify({
        text: result.text,
        actions: result.actions,
        pickupNumber: result.pickupNumber,
        intent: 'pickup_created',
      }),
    });
    await conversation.save();

    sendJson(res, req, 201, {
      ...result,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error('Error in confirmAinowPickup:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const confirmAinowOrder = async (req, res) => {
  try {
    const conversation = await orchestrator.getOrCreateConversation(req.userData._id);
    const result = await orchestrator.confirmOrder(req.userData._id, conversation);

    if (!result.success) {
      return sendError(res, req, 400, result.error);
    }

    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify({
        text: result.text,
        actions: result.actions,
        orderNumber: result.orderNumber,
        intent: 'order_created',
      }),
    });
    await conversation.save();

    sendJson(res, req, 201, {
      ...result,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error('Error in confirmAinowOrder:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const cancelAinowDraft = async (req, res) => {
  try {
    const conversation = await orchestrator.getOrCreateConversation(req.userData._id);
    const lang = detectLang(req);
    const draftType = conversation.activeDraft?.type;
    const result = await orchestrator.cancelDraft(conversation);
    if (draftType === 'pickup') {
      result.text = lang === 'ar' ? 'تم إلغاء مسودة الاستلام.' : 'Pickup draft cancelled.';
    } else {
      result.text = lang === 'ar' ? 'تم إلغاء مسودة الأوردر.' : 'Order draft cancelled.';
    }

    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify(result),
    });
    await conversation.save();

    sendJson(res, req, 200, {
      ...result,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error('Error in cancelAinowDraft:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const getAinowConversation = async (req, res) => {
  try {
    let conversation = await AssistantConversation.findOne({
      user: req.userData._id,
      isActive: true,
    }).sort({ updatedAt: -1 });

    if (!conversation) {
      const greeting = getGreeting(req);
      conversation = new AssistantConversation({
        user: req.userData._id,
        messages: [
          {
            sender: 'assistant',
            content: JSON.stringify(greeting),
          },
        ],
        activeDraft: { type: null, fields: {}, missingFields: [] },
      });
      await conversation.save();
    }

    if (isMobileApiRequest(req)) {
      return sendJson(res, req, 200, {
        conversation: serializeConversation(conversation),
      });
    }
    res.status(200).json(conversation);
  } catch (error) {
    console.error('Error in getAinowConversation:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const getConversation = getAinowConversation;

const getAinowGreeting = async (req, res) => {
  try {
    const greeting = getGreeting(req);
    sendJson(res, req, 200, { greeting });
  } catch (error) {
    console.error('Error in getAinowGreeting:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const getAinowStatus = async (req, res) => {
  try {
    const configured = isConfigured();
    sendJson(res, req, 200, {
      ainow: {
        configured,
        provider: process.env.AI_PROVIDER || 'gemini',
        chatModel: getChatModel(),
        liteModel: getLiteModel(),
        features: {
          textChat: configured,
          voiceTranscription: configured,
          orderDraft: true,
          pickupDraft: true,
          platformHelp: true,
          walletQueries: true,
        },
        voice: {
          maxFileSizeBytes: 8 * 1024 * 1024,
          fieldName: 'audio',
          supportedMimeTypes: AINOW_VOICE_MIME_TYPES,
          recommendedMimeTypes: {
            android: 'audio/mp4',
            ios: 'audio/m4a',
            web: 'audio/webm',
          },
          optionalFormFields: ['mimeType', 'lang'],
        },
        apiVersion: '1',
      },
    });
  } catch (error) {
    console.error('Error in getAinowStatus:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const getAssistantPage = async (req, res) => {
  try {
    res.render('business/assistant', {
      title: req.translations.business.pages.assistant.title,
      page_title: req.translations.business.pages.assistant.title,
      folder: req.translations.business.breadcrumb.pages,
      user: req.userData,
    });
  } catch (error) {
    console.error('Error in getAssistantPage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPreferences = async (req, res) => {
  try {
    let preferences = await AssistantPreferences.findOne({ user: req.userData._id });
    if (!preferences) {
      preferences = new AssistantPreferences({ user: req.userData._id });
      await preferences.save();
    }
    sendJson(res, req, 200, { preferences });
  } catch (error) {
    console.error('Error in getPreferences:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const updatePreferences = async (req, res) => {
  try {
    const { enabled, showSuggestions, autoOpen, theme } = req.body;
    let preferences = await AssistantPreferences.findOne({ user: req.userData._id });

    if (!preferences) {
      preferences = new AssistantPreferences({
        user: req.userData._id,
        enabled,
        showSuggestions,
        autoOpen,
        theme,
      });
    } else {
      if (enabled !== undefined) preferences.enabled = enabled;
      if (showSuggestions !== undefined) preferences.showSuggestions = showSuggestions;
      if (autoOpen !== undefined) preferences.autoOpen = autoOpen;
      if (theme) preferences.theme = theme;
    }

    await preferences.save();
    sendJson(res, req, 200, { preferences });
  } catch (error) {
    console.error('Error in updatePreferences:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const clearConversation = async (req, res) => {
  try {
    await AssistantConversation.updateMany(
      { user: req.userData._id, isActive: true },
      { isActive: false }
    );

    const greeting = getGreeting(req);
    const newConversation = new AssistantConversation({
      user: req.userData._id,
      messages: [
        {
          sender: 'assistant',
          content: JSON.stringify(greeting),
        },
      ],
      activeDraft: {
        type: null,
        fields: {},
        missingFields: [],
        pendingField: null,
      },
    });

    await newConversation.save();
    sendJson(res, req, 200, {
      message: 'Conversation cleared successfully',
      conversation: serializeConversation(newConversation),
    });
  } catch (error) {
    console.error('Error in clearConversation:', error);
    sendError(res, req, 500, 'Internal server error');
  }
};

const clearAinowConversation = clearConversation;

module.exports = {
  getAssistantPage,
  getPreferences,
  updatePreferences,
  getConversation,
  getAinowConversation,
  getAinowGreeting,
  getAinowStatus,
  sendMessage,
  sendAinowMessage,
  sendAinowVoice,
  confirmAinowOrder,
  confirmAinowPickup,
  cancelAinowDraft,
  clearConversation,
  clearAinowConversation,
};
