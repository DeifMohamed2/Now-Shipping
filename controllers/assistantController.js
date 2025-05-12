const { AssistantConversation, AssistantPreferences } = require('../models/assistant');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const Transaction = require('../models/transactions');
const User = require('../models/user');
const axios = require('axios');

// Define common assistant responses and suggestions
const assistantResponses = {
  greeting: "Hello! I'm your virtual assistant. How can I help you today?",
  orderHelp: "I can help you with your orders. Would you like to check order status, create a new order, or get order statistics?",
  pickupHelp: "I can assist with pickups. Do you want to schedule a pickup, check pickup status, or view pickup history?",
  paymentHelp: "I can help with payment-related queries. Would you like to check your balance, view transactions, or understand payment methods?",
  notUnderstood: "I'm sorry, I didn't quite understand that. Could you please rephrase or choose one of the suggested options?",
  suggestions: [
    "Check my recent orders",
    "Schedule a pickup",
    "View my balance",
    "Create a new order",
    "Get order statistics",
    "Help with shipping rates"
  ]
};

// Configuration for external AI model API
const AI_MODEL_CONFIG = {
  apiKey: process.env.AI_MODEL_API_KEY || 'your-api-key',
  endpoint: process.env.AI_MODEL_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
  model: process.env.AI_MODEL_NAME || 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 500
};

// Process user message using external AI model
const processMessageWithAI = async (userId, userMessage, userContext) => {
  try {
    // Prepare system prompt with context about the application
    const systemPrompt = `You are an AI assistant for a shipping and order management platform called NowShipping. 
    Your job is to help business users manage their orders, pickups, and finances.
    
    Available features in the platform:
    1. Orders: Create, track, and manage orders (types: Deliver, Return, Exchange, Cash Collection)
    2. Pickups: Schedule pickups for orders
    3. Wallet: Check balance, view transactions, understand cash cycles
    4. Shop: Purchase shipping supplies
    5. Tickets: Get support for issues
    
    User context: ${JSON.stringify(userContext)}
    
    Respond in a helpful, concise, and professional manner. When appropriate, suggest actions the user can take in the platform.`;

    // Call external AI model API
    const response = await axios.post(
      AI_MODEL_CONFIG.endpoint,
      {
        model: AI_MODEL_CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: AI_MODEL_CONFIG.temperature,
        max_tokens: AI_MODEL_CONFIG.maxTokens
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_MODEL_CONFIG.apiKey}`
        }
      }
    );

    // Extract AI response
    const aiResponse = response.data.choices[0].message.content;
    
    // Fall back to basic processing if AI API fails
    return {
      text: aiResponse,
      suggestions: generateSuggestions(userMessage)
    };
  } catch (error) {
    console.error('Error calling AI model API:', error);
    // Fall back to basic processing if AI API fails
    return processMessageBasic(userId, userMessage);
  }
};

// Generate contextual suggestions based on user message
const generateSuggestions = (message) => {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('order') || lowerMessage.includes('shipping')) {
    return [
      "Check order status",
      "Create new order",
      "View recent orders",
      "Get shipping rates"
    ];
  } else if (lowerMessage.includes('pickup') || lowerMessage.includes('collect')) {
    return [
      "Schedule pickup",
      "Check pickup status",
      "View pickup history"
    ];
  } else if (lowerMessage.includes('payment') || lowerMessage.includes('balance') || 
             lowerMessage.includes('transaction') || lowerMessage.includes('money')) {
    return [
      "Check my balance",
      "View transactions",
      "Payment methods"
    ];
  } else {
    return assistantResponses.suggestions;
  }
};

// Basic message processing as fallback
const processMessageBasic = async (userId, message) => {
  // Simple keyword-based response logic
  const lowerMessage = message.toLowerCase();
  
  // Order-related queries
  if (lowerMessage.includes('order') || lowerMessage.includes('shipping')) {
    if (lowerMessage.includes('status') || lowerMessage.includes('track') || lowerMessage.includes('where')) {
      // Get recent orders for this user
      const recentOrders = await Order.find({ business: userId })
        .sort({ orderDate: -1 })
        .limit(3);
      
      if (recentOrders.length > 0) {
        return {
          text: "Here are your most recent orders:",
          data: recentOrders.map(order => ({
            orderNumber: order.orderNumber,
            status: order.orderStatus,
            date: order.orderDate,
            type: order.orderShipping.orderType
          })),
          suggestions: ["View order details", "Create new order", "Check completed orders"]
        };
      } else {
        return {
          text: "You don't have any recent orders. Would you like to create a new order?",
          suggestions: ["Create new order", "Schedule pickup", "View shipping rates"]
        };
      }
    } else if (lowerMessage.includes('create') || lowerMessage.includes('new')) {
      return {
        text: "To create a new order, you can use our order form. Would you like me to take you there?",
        actions: [
          { text: "Go to Order Form", url: "/business/create-order" }
        ],
        suggestions: ["Show shipping rates first", "Check my balance", "Schedule pickup instead"]
      };
    } else if (lowerMessage.includes('statistics') || lowerMessage.includes('stats')) {
      // Get order statistics
      const totalOrders = await Order.countDocuments({ business: userId });
      const completedOrders = await Order.countDocuments({ business: userId, orderStatus: 'completed' });
      const processingOrders = await Order.countDocuments({ business: userId, orderStatus: 'processing' });
      
      return {
        text: "Here's a summary of your orders:",
        data: {
          total: totalOrders,
          completed: completedOrders,
          processing: processingOrders,
          completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0
        },
        suggestions: ["View all orders", "Check in-progress orders", "Create new order"]
      };
    }
    
    return {
      text: assistantResponses.orderHelp,
      suggestions: ["Check order status", "Create new order", "Get order statistics"]
    };
  }
  
  // Pickup-related queries
  else if (lowerMessage.includes('pickup') || lowerMessage.includes('collect')) {
    if (lowerMessage.includes('schedule') || lowerMessage.includes('new') || lowerMessage.includes('create')) {
      return {
        text: "You can schedule a new pickup using our pickup form. Would you like to go there now?",
        actions: [
          { text: "Schedule Pickup", url: "/business/pickups" }
        ],
        suggestions: ["Check existing pickups", "View pickup requirements", "Check my balance"]
      };
    } else if (lowerMessage.includes('status') || lowerMessage.includes('existing')) {
      // Get recent pickups
      const recentPickups = await Pickup.find({ business: userId })
        .sort({ createdAt: -1 })
        .limit(3);
      
      if (recentPickups.length > 0) {
        return {
          text: "Here are your recent pickups:",
          data: recentPickups.map(pickup => ({
            pickupNumber: pickup.pickupNumber,
            status: pickup.picikupStatus,
            date: pickup.pickupDate,
            numberOfOrders: pickup.numberOfOrders
          })),
          suggestions: ["Schedule new pickup", "View pickup details", "Check orders"]
        };
      } else {
        return {
          text: "You don't have any recent pickups. Would you like to schedule one?",
          actions: [
            { text: "Schedule Pickup", url: "/business/pickups" }
          ],
          suggestions: ["Create order first", "Check my balance", "View shipping rates"]
        };
      }
    }
    
    return {
      text: assistantResponses.pickupHelp,
      suggestions: ["Schedule pickup", "Check pickup status", "View pickup history"]
    };
  }
  
  // Payment and balance queries
  else if (lowerMessage.includes('payment') || lowerMessage.includes('balance') || 
           lowerMessage.includes('transaction') || lowerMessage.includes('money')) {
    if (lowerMessage.includes('balance') || lowerMessage.includes('total')) {
      // Get transaction summary
      const transactions = await Transaction.find({ business: userId });
      const totalBalance = transactions.reduce((total, transaction) => {
        return total + (transaction.transactionType === 'credit' ? transaction.amount : -transaction.amount);
      }, 0);
      
      return {
        text: `Your current balance is ${totalBalance.toFixed(2)} EGP.`,
        actions: [
          { text: "View Balance Details", url: "/business/wallet/total-balance" }
        ],
        suggestions: ["View recent transactions", "Check payment methods", "View cash cycles"]
      };
    } else if (lowerMessage.includes('transaction') || lowerMessage.includes('history')) {
      return {
        text: "You can view your transaction history in the wallet section. Would you like to go there?",
        actions: [
          { text: "View Transactions", url: "/business/wallet/total-balance" }
        ],
        suggestions: ["Check my balance", "View cash cycles", "Payment methods"]
      };
    }
    
    return {
      text: assistantResponses.paymentHelp,
      suggestions: ["Check my balance", "View transactions", "Payment methods"]
    };
  }
  
  // Help or general queries
  else if (lowerMessage.includes('help') || lowerMessage.includes('support') || lowerMessage.includes('assist')) {
    return {
      text: "I can help you with orders, pickups, payments, and general information. What would you like assistance with?",
      suggestions: ["Order help", "Pickup help", "Payment help", "Contact support"]
    };
  }
  
  // Greeting
  else if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || 
           lowerMessage.includes('hey') || lowerMessage === 'start') {
    return {
      text: assistantResponses.greeting,
      suggestions: assistantResponses.suggestions
    };
  }
  
  // Default response
  return {
    text: assistantResponses.notUnderstood,
    suggestions: assistantResponses.suggestions
  };
};

// Main process message function that decides which processor to use
const processMessage = async (userId, message) => {
  try {
    // Get user data for context
    const userContext = await getUserContext(userId);
    
    // Use AI model if API key is available, otherwise use basic processing
    if (process.env.AI_MODEL_API_KEY) {
      return processMessageWithAI(userId, message, userContext);
    } else {
      return processMessageBasic(userId, message);
    }
  } catch (error) {
    console.error('Error in processMessage:', error);
    // Fallback to basic response if anything fails
    return {
      text: "I'm sorry, I encountered an error. Please try again later.",
      suggestions: ["Start over", "Help", "Contact support"]
    };
  }
};

// Get user context for AI processing
const getUserContext = async (userId) => {
  try {
    // Get basic user info
    const user = await User.findById(userId).select('name email brandInfo');
    
    // Get order statistics
    const totalOrders = await Order.countDocuments({ business: userId });
    const completedOrders = await Order.countDocuments({ business: userId, orderStatus: 'completed' });
    const pendingOrders = await Order.countDocuments({ 
      business: userId, 
      orderStatus: { $in: ['new', 'processing', 'headingToCustomer'] } 
    });
    
    // Get recent activity
    const recentOrders = await Order.find({ business: userId })
      .sort({ orderDate: -1 })
      .limit(3)
      .select('orderNumber orderStatus orderShipping.orderType');
    
    // Get financial info
    const transactions = await Transaction.find({ business: userId })
      .sort({ createdAt: -1 })
      .limit(5);
    
    const totalBalance = transactions.reduce((total, transaction) => {
      return total + (transaction.transactionType === 'credit' ? transaction.amount : -transaction.amount);
    }, 0);
    
    return {
      user: {
        name: user?.name || 'User',
        businessName: user?.brandInfo?.brandName || 'Your Business',
      },
      statistics: {
        totalOrders,
        completedOrders,
        pendingOrders,
        completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0
      },
      recentActivity: {
        orders: recentOrders
      },
      financials: {
        balance: totalBalance
      }
    };
  } catch (error) {
    console.error('Error getting user context:', error);
    return {
      user: { name: 'User' },
      statistics: {},
      recentActivity: {},
      financials: {}
    };
  }
};

// Get assistant view page
const getAssistantPage = async (req, res) => {
  try {
    res.render('business/assistant', {
      title: "Virtual Assistant",
      page_title: 'Virtual Assistant',
      folder: 'Pages',
      user: req.userData
    });
  } catch (error) {
    console.error('Error in getAssistantPage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get user preferences for assistant
const getPreferences = async (req, res) => {
  try {
    let preferences = await AssistantPreferences.findOne({ user: req.userData._id });
    
    if (!preferences) {
      // Create default preferences if none exist
      preferences = new AssistantPreferences({ user: req.userData._id });
      await preferences.save();
    }
    
    res.status(200).json(preferences);
  } catch (error) {
    console.error('Error in getPreferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update user preferences for assistant
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
        theme
      });
    } else {
      preferences.enabled = enabled !== undefined ? enabled : preferences.enabled;
      preferences.showSuggestions = showSuggestions !== undefined ? showSuggestions : preferences.showSuggestions;
      preferences.autoOpen = autoOpen !== undefined ? autoOpen : preferences.autoOpen;
      preferences.theme = theme || preferences.theme;
    }
    
    await preferences.save();
    res.status(200).json(preferences);
  } catch (error) {
    console.error('Error in updatePreferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get conversation history
const getConversation = async (req, res) => {
  try {
    let conversation = await AssistantConversation.findOne({ 
      user: req.userData._id,
      isActive: true
    }).sort({ updatedAt: -1 });
    
    if (!conversation) {
      // Create a new conversation with a greeting
      conversation = new AssistantConversation({
        user: req.userData._id,
        messages: [{
          sender: 'assistant',
          content: JSON.stringify({
            text: assistantResponses.greeting,
            suggestions: assistantResponses.suggestions
          })
        }]
      });
      await conversation.save();
    }
    
    res.status(200).json(conversation);
  } catch (error) {
    console.error('Error in getConversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Send message to assistant
const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Find or create conversation
    let conversation = await AssistantConversation.findOne({ 
      user: req.userData._id,
      isActive: true
    }).sort({ updatedAt: -1 });
    
    if (!conversation) {
      conversation = new AssistantConversation({
        user: req.userData._id,
        messages: []
      });
    }
    
    // Add user message
    conversation.messages.push({
      sender: 'user',
      content: message
    });
    
    // Process message and get response
    const response = await processMessage(req.userData._id, message);
    
    // Add assistant response
    conversation.messages.push({
      sender: 'assistant',
      content: JSON.stringify(response)
    });
    
    await conversation.save();
    
    res.status(200).json({
      message: 'Message sent successfully',
      response
    });
  } catch (error) {
    console.error('Error in sendMessage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Clear conversation history
const clearConversation = async (req, res) => {
  try {
    // Mark current conversation as inactive
    await AssistantConversation.updateMany(
      { user: req.userData._id, isActive: true },
      { isActive: false }
    );
    
    // Create a new conversation with a greeting
    const newConversation = new AssistantConversation({
      user: req.userData._id,
      messages: [{
        sender: 'assistant',
        content: JSON.stringify({
          text: assistantResponses.greeting,
          suggestions: assistantResponses.suggestions
        })
      }]
    });
    
    await newConversation.save();
    
    res.status(200).json({
      message: 'Conversation cleared successfully',
      conversation: newConversation
    });
  } catch (error) {
    console.error('Error in clearConversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAssistantPage,
  getPreferences,
  updatePreferences,
  getConversation,
  sendMessage,
  clearConversation
}; 