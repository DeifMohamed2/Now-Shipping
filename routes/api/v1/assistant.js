const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const User = require('../../../models/user');

const jwtSecret = process.env.JWT_SECRET;
const assistantController = require('../../../controllers/assistantController');

const { AINOW_VOICE_MIME_TYPES } = require('../../../utils/ainowApiSerializer');

const ainowVoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ok =
      mime.startsWith('audio/') ||
      mime === 'video/mp4' ||
      AINOW_VOICE_MIME_TYPES.includes(mime);
    if (ok) cb(null, true);
    else cb(new Error('Unsupported audio format. Use m4a, mp4, webm, wav, or aac.'));
  },
});

function ainowVoiceUploadSingle(req, res, next) {
  ainowVoiceUpload.single('audio')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Audio upload failed.' });
    }
    next();
  });
}

const authenticateAPI = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'User not found',
      });
    }

    req.userData = user;
    next();
  } catch (error) {
    console.error('API Authentication Error:', error);
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token',
    });
  }
};

router.use(authenticateAPI);

// Legacy assistant routes
router.get('/preferences', assistantController.getPreferences);
router.post('/preferences', assistantController.updatePreferences);
router.get('/conversation', assistantController.getConversation);
router.post('/send', assistantController.sendMessage);
router.post('/clear', assistantController.clearConversation);

// AINOW routes — mobile / Flutter parity with web widget
router.get('/ainow/status', assistantController.getAinowStatus);
router.get('/ainow/greeting', assistantController.getAinowGreeting);
router.get('/ainow/conversation', assistantController.getAinowConversation);
router.post('/ainow/message', assistantController.sendAinowMessage);
router.post('/ainow/voice', ainowVoiceUploadSingle, assistantController.sendAinowVoice);
router.post('/ainow/confirm-order', assistantController.confirmAinowOrder);
router.post('/ainow/confirm-pickup', assistantController.confirmAinowPickup);
router.post('/ainow/cancel-draft', assistantController.cancelAinowDraft);
router.post('/ainow/clear', assistantController.clearAinowConversation);

module.exports = router;
