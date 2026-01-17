const fs = require('fs');
const path = require('path');
const multer = require('multer');

module.exports = function createShipmentUpload(rootDir = __dirname) {
  const uploadsRoot = path.join(rootDir, 'secure_uploads', 'shipments'); // outside public root
  fs.mkdirSync(uploadsRoot, { recursive: true });

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      cb(null, uploadsRoot);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${base}-${unique}${ext}`);
    }
  });

  function isAllowedMime(m) {
    return (
      m === 'application/pdf' ||
      m === 'image/jpeg' ||
      m === 'image/png' ||
      m === 'image/gif' ||
      m === 'image/webp'
    );
  }

  const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter(req, file, cb) {
      if (!file.mimetype || !isAllowedMime(file.mimetype)) {
        return cb(new Error('Unsupported file type'), false);
      }
      cb(null, true);
    }
  });

  function resolveShipmentDocumentPath(filePath) {
    if (!filePath) return null;
    const normalized = filePath.replace(/^\/+/, '');

    if (normalized.startsWith('shipments/')) {
      return path.join(uploadsRoot, normalized.replace(/^shipments[\\/]/, ''));
    }

    if (normalized.startsWith('uploads/shipments/')) {
      return path.join(rootDir, normalized);
    }

    return path.join(uploadsRoot, normalized);
  }

  return { upload, resolveShipmentDocumentPath, uploadsRoot };
};
