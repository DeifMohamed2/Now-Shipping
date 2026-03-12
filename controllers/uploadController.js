const { uploadFile, uploadMultipleFiles, deleteFile } = require('../utils/fileUpload');
const fs = require('fs');
const path = require('path');

/**
 * Upload Controller - Handles all file uploads
 * Replaces Cloudinary functionality with local storage
 */

/**
 * Upload single file
 * POST /api/v1/upload/single
 * Body: file (multipart/form-data), folder (optional)
 */
exports.uploadSingle = async (req, res) => {
  try {
    console.log('\n📤 ========== UPLOAD SINGLE FILE ==========');
    console.log('Request body:', req.body);
    console.log('Request files:', req.files ? Object.keys(req.files) : 'none');
    
    if (req.files) {
      console.log('Files structure:', JSON.stringify(Object.keys(req.files).reduce((obj, key) => {
        obj[key] = {
          name: req.files[key].name,
          size: req.files[key].size,
          mimetype: req.files[key].mimetype
        };
        return obj;
      }, {}), null, 2));
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      console.error('❌ No files in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    // Get the first file (could be named 'file', 'image', etc.)
    const fileKey = Object.keys(req.files)[0];
    const file = req.files[fileKey];
    const folder = req.body.folder || req.body.upload_preset || 'general';

    console.log('File key:', fileKey);
    console.log('File name:', file.name);
    console.log('File size:', file.size);
    console.log('File mimetype:', file.mimetype);
    console.log('Target folder:', folder);

    const result = await uploadFile(file, folder);

    console.log('✅ Upload successful:', result.url);
    console.log('==========================================\n');

    // Return in format compatible with Cloudinary response
    return res.status(200).json({
      success: true,
      secure_url: result.url,
      url: result.url,
      public_id: result.publicId,
      resource_type: result.type,
      format: path.extname(result.filename).slice(1),
      original_filename: result.filename,
      bytes: result.filesize,
      ...result,
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    console.error('Error stack:', error.stack);
    console.error('==========================================\n');
    return res.status(500).json({
      success: false,
      message: 'File upload failed',
      error: error.message,
    });
  }
};

/**
 * Upload multiple files
 * POST /api/v1/upload/multiple
 * Body: files[] (multipart/form-data), folder (optional)
 */
exports.uploadMultiple = async (req, res) => {
  try {
    console.log('\n📤 ========== UPLOAD MULTIPLE FILES ==========');
    console.log('Request files:', req.files ? Object.keys(req.files) : 'none');

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded',
      });
    }

    const folder = req.body.folder || req.body.upload_preset || 'general';
    console.log('Target folder:', folder);

    // Convert files object to array
    // express-fileupload can send files as array or single object
    let filesArray = [];
    for (const key in req.files) {
      const fileOrArray = req.files[key];
      if (Array.isArray(fileOrArray)) {
        filesArray.push(...fileOrArray);
      } else {
        filesArray.push(fileOrArray);
      }
    }

    console.log('Total files to upload:', filesArray.length);
    console.log('Files:', filesArray.map(f => ({ name: f.name, size: f.size, mimetype: f.mimetype })));

    const results = await uploadMultipleFiles(filesArray, folder);

    console.log('✅ All files uploaded successfully');
    console.log('==========================================\n');

    return res.status(200).json({
      success: true,
      files: results,
      count: results.length,
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    console.error('Error stack:', error.stack);
    console.error('==========================================\n');
    return res.status(500).json({
      success: false,
      message: 'Files upload failed',
      error: error.message,
    });
  }
};

/**
 * Delete file
 * DELETE /api/v1/upload/delete
 * Body: filename, folder (optional)
 */
exports.deleteFile = async (req, res) => {
  try {
    const { filename, folder } = req.body;

    if (!filename) {
      return res.status(400).json({
        success: false,
        message: 'Filename is required',
      });
    }

    const result = await deleteFile(filename, folder || 'general');

    return res.status(200).json({
      success: result,
      message: result ? 'File deleted successfully' : 'File not found',
    });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({
      success: false,
      message: 'File deletion failed',
      error: error.message,
    });
  }
};
