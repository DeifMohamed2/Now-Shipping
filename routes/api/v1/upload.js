const express = require('express');
const router = express.Router();
const uploadController = require('../../../controllers/uploadController');

/**
 * File Upload Routes
 * Replaces Cloudinary with local storage
 */

// Upload single file
// POST /api/v1/upload/single
// Accepts: multipart/form-data with 'file' field and optional 'folder' or 'upload_preset'
router.post('/single', uploadController.uploadSingle);

// Upload multiple files
// POST /api/v1/upload/multiple
// Accepts: multipart/form-data with 'files[]' field and optional 'folder' or 'upload_preset'
router.post('/multiple', uploadController.uploadMultiple);

// Delete file
// DELETE /api/v1/upload/delete
// Body: { filename, folder }
router.delete('/delete', uploadController.deleteFile);

module.exports = router;
