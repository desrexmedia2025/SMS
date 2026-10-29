const path = require('path');
const fs = require('fs');

const db = require('../config/database');
const userModel = require('../models/user.model');
const { resolveUploadsDir } = require('../config/upload');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

const AVATAR_SUBDIR = 'avatars';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function avatarsDir() {
  return path.join(resolveUploadsDir(), AVATAR_SUBDIR);
}

function avatarFilePath(storedName) {
  const safeName = path.basename(String(storedName || ''));
  if (!safeName || safeName.startsWith('.') || safeName !== String(storedName || '')) {
    return null;
  }
  return path.join(avatarsDir(), safeName);
}

function resolveStoredAvatar(userRow) {
  const stored = String(userRow?.avatar_file || '').trim();
  if (!stored) return null;
  const fullPath = avatarFilePath(stored);
  if (!fullPath) return null;
  return fs.existsSync(fullPath) ? fullPath : null;
}

function mimeForStoredName(storedName) {
  return ALLOWED_EXT_MIME[path.extname(String(storedName || '')).toLowerCase()] || 'image/jpeg';
}

function assertValidAvatarFile(file) {
  if (!file || !file.path || !file.filename) {
    throw new AppError(400, 'Choose a profile photo to upload.');
  }
  if (Number(file.size || 0) > MAX_AVATAR_BYTES) {
    throw new AppError(400, 'Profile photos must be 2 MB or smaller.');
  }
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  if (!ALLOWED_EXT_MIME[ext]) {
    throw new AppError(400, 'Profile photos must be a JPG, PNG, WEBP or GIF image.');
  }
}

function deleteStoredAvatar(userRow) {
  const target = resolveStoredAvatar(userRow);
  if (!target) return;
  try {
    fs.unlinkSync(target);
  } catch (_) {
    // ignore missing files
  }
}

async function setUserAvatar({ actor, targetUserId, file, ipAddress = '' }) {
  const target = await db.get(
    `SELECT id, full_name, avatar_file FROM users WHERE id = ? LIMIT 1`,
    [targetUserId]
  );
  if (!target) throw new AppError(404, 'User account not found.');

  assertValidAvatarFile(file);

  // Replace the previous photo only after the new one is safely on disk
  const previous = { avatar_file: target.avatar_file };
  deleteStoredAvatar(previous);

  await db.run(
    `UPDATE users
     SET avatar_file = ?, avatar_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [file.filename, target.id]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role || '',
    action: actor.id === target.id ? 'PROFILE_PHOTO_UPDATED' : 'PROFILE_PHOTO_SET_BY_ADMIN',
    targetType: 'user',
    targetId: String(target.id),
    ipAddress,
    metadata: { fileName: String(file.originalname || '').slice(0, 120) },
  });

  const fresh = await userModel.findById(target.id);
  return {
    ok: true,
    avatarUrl: userModel.resolveAvatarUrl(fresh || target),
    message: 'Profile photo updated.',
  };
}

async function clearUserAvatar({ actor, targetUserId, ipAddress = '' }) {
  const target = await db.get('SELECT id, avatar_file FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw new AppError(404, 'User account not found.');

  deleteStoredAvatar(target);
  await db.run(
    `UPDATE users
     SET avatar_file = '', avatar_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [target.id]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role || '',
    action: 'PROFILE_PHOTO_REMOVED',
    targetType: 'user',
    targetId: String(target.id),
    ipAddress,
  });

  return { ok: true, avatarUrl: '', message: 'Profile photo removed.' };
}

module.exports = {
  avatarsDir,
  avatarFilePath,
  resolveStoredAvatar,
  mimeForStoredName,
  setUserAvatar,
  clearUserAvatar,
};
