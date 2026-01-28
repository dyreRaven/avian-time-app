const fs = require('fs');
const path = require('path');
const multer = require('multer');

module.exports = function createEmployeeMediaUpload(rootDir = __dirname) {
  const idUploadsRoot = path.join(rootDir, 'secure_uploads', 'employee_ids');
  const photoUploadsRoot = path.join(rootDir, 'secure_uploads', 'employee_photos');
  fs.mkdirSync(idUploadsRoot, { recursive: true });
  fs.mkdirSync(photoUploadsRoot, { recursive: true });
  const idUploadsRootResolved = path.resolve(idUploadsRoot);
  const photoUploadsRootResolved = path.resolve(photoUploadsRoot);
  const legacyIdRoot = path.resolve(path.join(rootDir, 'uploads', 'employee_ids'));
  const legacyPublicIdRoot = path.resolve(path.join(rootDir, 'public', 'uploads', 'employee_ids'));

  const allowedExts = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  const allowedMimes = new Set(Object.values(allowedExts));

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      if (file.fieldname === 'id_document') {
        return cb(null, idUploadsRoot);
      }
      if (file.fieldname === 'employee_photo') {
        return cb(null, photoUploadsRoot);
      }
      return cb(new Error('Unexpected field'), null);
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

  function resolveEmployeeIdPath(filePath) {
    if (!filePath) return null;
    const normalized = filePath.replace(/^\/+/, '');

    if (normalized.startsWith('employee_ids/')) {
      return safeResolve(idUploadsRootResolved, normalized.replace(/^employee_ids[\\/]/, ''));
    }

    if (normalized.startsWith('uploads/employee_ids/')) {
      return safeResolve(legacyIdRoot, normalized.replace(/^uploads[\\/]+employee_ids[\\/]/, ''));
    }

    if (normalized.startsWith('public/uploads/employee_ids/')) {
      return safeResolve(
        legacyPublicIdRoot,
        normalized.replace(/^public[\\/]+uploads[\\/]+employee_ids[\\/]/, '')
      );
    }

    return safeResolve(idUploadsRootResolved, normalized);
  }

  function resolveEmployeePhotoPath(filePath) {
    if (!filePath) return null;
    const normalized = filePath.replace(/^\/+/, '');

    if (normalized.startsWith('employee_photos/')) {
      return safeResolve(photoUploadsRootResolved, normalized.replace(/^employee_photos[\\/]/, ''));
    }

    return safeResolve(photoUploadsRootResolved, normalized);
  }

  return {
    upload,
    resolveEmployeeIdPath,
    resolveEmployeePhotoPath,
    idUploadsRoot,
    photoUploadsRoot,
    idAllowedMimes: allowedMimes,
    idAllowedExts: allowedExts,
    photoAllowedMimes: allowedMimes,
    photoAllowedExts: allowedExts
  };
};
