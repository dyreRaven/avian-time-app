const fs = require('fs');
const path = require('path');
const multer = require('multer');

module.exports = function createEmployeeDocsUpload(rootDir = __dirname) {
  const uploadsRoot = path.join(rootDir, 'secure_uploads', 'employee_docs');
  fs.mkdirSync(uploadsRoot, { recursive: true });
  const uploadsRootResolved = path.resolve(uploadsRoot);
  const legacyRoot = path.resolve(path.join(rootDir, 'uploads', 'employee_docs'));
  const legacyPublicRoot = path.resolve(path.join(rootDir, 'public', 'uploads', 'employee_docs'));

  const allowedExts = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  const allowedMimes = new Set(Object.values(allowedExts));

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
    return allowedMimes.has(m);
  }

  function isAllowedExt(ext) {
    return !!allowedExts[ext];
  }

  const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!isAllowedExt(ext)) {
        return cb(new Error('Unsupported file extension'), false);
      }
      if (
        file.mimetype &&
        file.mimetype !== 'application/octet-stream' &&
        !isAllowedMime(file.mimetype)
      ) {
        return cb(new Error('Unsupported file type'), false);
      }
      cb(null, true);
    }
  });

  function safeResolve(base, relPath) {
    const resolved = path.resolve(base, relPath || '');
    if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
    return null;
  }

  function resolveEmployeeDocumentPath(filePath) {
    if (!filePath) return null;
    const normalized = filePath.replace(/^\/+/, '');

    if (normalized.startsWith('employee_docs/')) {
      return safeResolve(uploadsRootResolved, normalized.replace(/^employee_docs[\\/]/, ''));
    }

    if (normalized.startsWith('uploads/employee_docs/')) {
      return safeResolve(legacyRoot, normalized.replace(/^uploads[\\/]+employee_docs[\\/]/, ''));
    }

    if (normalized.startsWith('public/uploads/employee_docs/')) {
      return safeResolve(
        legacyPublicRoot,
        normalized.replace(/^public[\\/]+uploads[\\/]+employee_docs[\\/]/, '')
      );
    }

    return safeResolve(uploadsRootResolved, normalized);
  }

  return { upload, resolveEmployeeDocumentPath, uploadsRoot, allowedMimes, allowedExts };
};
