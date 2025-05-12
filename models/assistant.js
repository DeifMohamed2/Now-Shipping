const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AssistantMessageSchema = new Schema({
  sender: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const AssistantConversationSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  messages: [AssistantMessageSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const AssistantPreferencesSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  showSuggestions: {
    type: Boolean,
    default: true
  },
  autoOpen: {
    type: Boolean,
    default: false
  },
  theme: {
    type: String,
    enum: ['light', 'dark', 'system'],
    default: 'system'
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to update the updatedAt field
AssistantConversationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const AssistantConversation = mongoose.model('AssistantConversation', AssistantConversationSchema);
const AssistantPreferences = mongoose.model('AssistantPreferences', AssistantPreferencesSchema);

module.exports = {
  AssistantConversation,
  AssistantPreferences
}; 