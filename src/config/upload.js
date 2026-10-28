const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { AppError } = require('../middleware/errorHandler');

function resolveUploadsDir() {
  if (process.env.SMS_UPLOADS_DIR) {
    return path.resolve(process.env.SMS_UPLOADS_DIR);
  }
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    return '/tmp/sms_uploads';
  }
  return path.resolve(process.cwd(), 'data', 'uploads');
}

const EXTENSION_MEDIA_MAP = {
  '.pdf': { kind: 'pdf', mimes: ['application/pdf'] },
  '.jpg': { kind: 'image', mimes: ['image/jpeg', 'image/pjpeg'] },
  '.jpeg': { kind: 'image', mimes: ['image/jpeg', 'image/pjpeg'] },
  '.png': { kind: 'image', mimes: ['image/png'] },
  '.webp': { kind: 'image', mimes: ['image/webp'] },
  '.gif': { kind: 'image', mimes: ['image/gif'] },
  '.mp4': { kind: 'video', mimes: ['video/mp4', 'application/mp4'] },
  '.webm': { kind: 'video', mimes: ['video/webm'] },
  '.mov': { kind: 'video', mimes: ['video/quicktime'] },
  '.m4v': { kind: 'video', mimes: ['video/x-m4v', 'video/mp4'] },
  '.ogg': { kind: 'video', mimes: ['video/ogg', 'application/ogg'] },
  '.ogv': { kind: 'video', mimes: ['video/ogg'] },
  '.doc': {
    kind: 'document',
    mimes: ['application/msword', 'application/octet-stream'],
  },
  '.docx': {
    kind: 'document',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream',
      'application/zip',
    ],
  },
  '.ppt': {
    kind: 'document',
    mimes: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  },
  '.pptx': {
    kind: 'document',
    mimes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/octet-stream',
      'application/zip',
    ],
  },
  '.xls': {
    kind: 'document',
    mimes: ['application/vnd.ms-excel', 'application/octet-stream'],
  },
  '.xlsx': {
    kind: 'document',
    mimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'application/zip',
    ],
  },
  '.txt': { kind: 'document', mimes: ['text/plain'] },
  '.csv': { kind: 'document', mimes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'] },
  '.rtf': { kind: 'document', mimes: ['application/rtf', 'text/rtf'] },
  '.odt': { kind: 'document', mimes: ['application/vnd.oasis.opendocument.text'] },
};

function classifyUploadFile(originalName, mimeType) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const rule = EXTENSION_MEDIA_MAP[ext];
  if (!rule) return null;
  const normalizedMime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const mimeAllowed =
    rule.mimes.includes(normalizedMime) ||
    (rule.kind === 'image' && normalizedMime.startsWith('image/') && normalizedMime !== 'image/svg+xml') ||
    (rule.kind === 'video' && normalizedMime.startsWith('video/'));
  if (!mimeAllowed) return null;
  return {
    ext,
    kind: rule.kind,
    mimeType: normalizedMime || rule.mimes[0],
  };
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      const dir = resolveUploadsDir();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(String(file.originalname || '')).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const storedName = `${Date.now()}_${crypto.randomUUID()}${ext}`;
    cb(null, storedName);
  },
});

const rawMulter = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 100 * 1024 * 1024, // 100 MB per file (supports videos, PDFs, high-res images & documents)
    fieldSize: 512 * 1024,
  },
  fileFilter(_req, file, cb) {
    const classified = classifyUploadFile(file.originalname, file.mimetype);
    if (!classified) {
      return cb(
        new AppError(
          400,
          `Unsupported file "${file.originalname}". Allowed formats: PDF, Images (JPG, PNG, WEBP, GIF), Videos (MP4, WEBM, MOV, OGG), and Documents (DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT).`
        )
      );
    }
    file.mediaKind = classified.kind;
    file.safeMimeType = classified.mimeType;
    return cb(null, true);
  },
});

function uploadAttachments(req, res, next) {
  const handler = rawMulter.array('attachments', 10);
  handler(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(400, 'Each uploaded file must be 100 MB or smaller.'));
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return next(new AppError(400, 'You can upload at most 10 files at a time.'));
      }
      return next(new AppError(400, `Upload error: ${err.message}`));
    }
    return next(err);
  });
}

function cleanupUploadedFiles(files = []) {
  for (const f of files || []) {
    if (f?.path) {
      try {
        fs.unlinkSync(f.path);
      } catch (_) {
        // ignore cleanup error
      }
    }
  }
}

module.exports = {
  resolveUploadsDir,
  classifyUploadFile,
  uploadAttachments,
  cleanupUploadedFiles,
};
