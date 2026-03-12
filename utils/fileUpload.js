const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Local File Upload Utility
 * Replaces Cloudinary with local file storage
 */

// Base upload directory
const UPLOAD_BASE_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Ensure upload directories exist
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Generate a unique filename
 * @param {string} originalName - Original filename
 * @returns {string} - Unique filename
 */
const generateUniqueFilename = (originalName) => {
  if (!originalName) {
    throw new Error('Original filename is required');
  }
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const nameWithoutExt = path.basename(originalName, ext);
  const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
  return `${sanitizedName}_${timestamp}_${randomString}${ext}`;
};

/**
 * Get file type from mimetype
 * @param {string} mimetype - File mimetype
 * @returns {string} - File type category
 */
const getFileType = (mimetype) => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.includes('pdf')) return 'pdf';
  return 'file';
};

/**
 * Upload a single file to local storage
 * @param {Object} file - File object (from express-fileupload or multer)
 * @param {string} folder - Target folder (e.g., 'tickets', 'profiles', 'products')
 * @returns {Promise<Object>} - Upload result with file details
 */
const uploadFile = async (file, folder = 'general') => {
  try {
    console.log('📦 File object received:', {
      name: file.name,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      hasPath: !!file.path,
      hasBuffer: !!file.buffer,
      hasData: !!file.data,
      hasMv: !!file.mv
    });

    // Create folder path
    const folderPath = path.join(UPLOAD_BASE_DIR, folder);
    ensureDirectoryExists(folderPath);

    // Get original filename (express-fileupload uses 'name', multer uses 'originalname')
    const originalFilename = file.name || file.originalname;
    if (!originalFilename) {
      throw new Error('File does not have a name property');
    }

    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(originalFilename);
    const filePath = path.join(folderPath, uniqueFilename);

    console.log('💾 Saving file to:', filePath);

    // Handle different file upload methods
    if (file.mv) {
      // express-fileupload: use mv() method
      await file.mv(filePath);
    } else if (file.path) {
      // multer disk storage: move from temp location
      fs.renameSync(file.path, filePath);
    } else if (file.buffer) {
      // multer memory storage: write buffer
      fs.writeFileSync(filePath, file.buffer);
    } else if (file.data) {
      // express-fileupload buffer mode
      fs.writeFileSync(filePath, file.data);
    } else {
      throw new Error('File has no valid data source (no mv, path, buffer, or data)');
    }

    // Get file stats
    const stats = fs.statSync(filePath);

    // Get mimetype (express-fileupload and multer both use 'mimetype')
    const mimetype = file.mimetype || 'application/octet-stream';

    // Determine file type
    const fileType = getFileType(mimetype);

    // Generate public URL
    const publicUrl = `/uploads/${folder}/${uniqueFilename}`;

    // Generate thumbnail URL for videos (we'll use a placeholder)
    let thumbnailUrl = null;
    if (fileType === 'video') {
      thumbnailUrl = '/assets/images/video-placeholder.png';
    }

    console.log('✅ File saved successfully:', publicUrl);

    return {
      success: true,
      type: fileType,
      url: publicUrl,
      publicId: uniqueFilename, // Using filename as publicId for compatibility
      filename: originalFilename,
      savedFilename: uniqueFilename,
      filesize: stats.size,
      mimetype: mimetype,
      thumbnailUrl,
      path: filePath,
    };
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    throw new Error(`File upload failed: ${error.message}`);
  }
};

/**
 * Upload multiple files
 * @param {Array} files - Array of file objects
 * @param {string} folder - Target folder
 * @returns {Promise<Array>} - Array of upload results
 */
const uploadMultipleFiles = async (files, folder = 'general') => {
  if (!Array.isArray(files)) {
    console.warn('⚠️ uploadMultipleFiles received non-array, converting to array');
    files = [files];
  }
  const uploadPromises = files.map((file) => uploadFile(file, folder));
  return Promise.all(uploadPromises);
};

/**
 * Delete a file from local storage
 * @param {string} filename - Filename or public URL
 * @param {string} folder - Folder name
 * @returns {Promise<boolean>} - Success status
 */
const deleteFile = async (filename, folder = 'general') => {
  try {
    // Extract filename if a URL is provided
    let actualFilename = filename;
    if (filename.startsWith('/uploads/')) {
      const parts = filename.split('/');
      actualFilename = parts[parts.length - 1];
      folder = parts[parts.length - 2];
    }

    const filePath = path.join(UPLOAD_BASE_DIR, folder, actualFilename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✅ Deleted file: ${filePath}`);
      return true;
    } else {
      console.warn(`⚠️ File not found: ${filePath}`);
      return false;
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

/**
 * Delete multiple files
 * @param {Array} filenames - Array of filenames or URLs
 * @param {string} folder - Folder name
 * @returns {Promise<Array>} - Array of deletion results
 */
const deleteMultipleFiles = async (filenames, folder = 'general') => {
  const deletePromises = filenames.map((filename) => deleteFile(filename, folder));
  return Promise.all(deletePromises);
};

/**
 * Clean up old uploaded files
 * @param {string} folder - Folder to clean
 * @param {number} daysOld - Delete files older than this many days
 * @returns {Promise<number>} - Number of files deleted
 */
const cleanupOldFiles = async (folder, daysOld = 30) => {
  try {
    const folderPath = path.join(UPLOAD_BASE_DIR, folder);
    
    if (!fs.existsSync(folderPath)) {
      return 0;
    }

    const files = fs.readdirSync(folderPath);
    const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);

      if (stats.mtimeMs < cutoffDate) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    console.log(`🗑️ Cleaned up ${deletedCount} old files from ${folder}`);
    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up old files:', error);
    return 0;
  }
};

module.exports = {
  uploadFile,
  uploadMultipleFiles,
  deleteFile,
  deleteMultipleFiles,
  cleanupOldFiles,
  generateUniqueFilename,
  getFileType,
};
