const fs = require('fs');

const db = require('../config/database');
const profileService = require('../services/profile.service');
const { AppError } = require('../middleware/errorHandler');

// Authenticated, ownership-agnostic profile photo streaming (no-store, sniffing blocked)
async function getAvatar(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(400, 'Invalid user reference.');
  }

  const row = await db.get('SELECT id, avatar_file FROM users WHERE id = ?', [userId]);
  const filePath = row ? profileService.resolveStoredAvatar(row) : null;
  if (!filePath) {
    throw new AppError(404, 'No profile photo on file for this account.');
  }

  res.setHeader('Content-Type', profileService.mimeForStoredName(row.avatar_file));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(404).end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

// Superadmin-managed profile photos for any portal account
async function setUserAvatar(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(400, 'Invalid user reference.');
  }
  const result = await profileService.setUserAvatar({
    actor: req.user,
    targetUserId: userId,
    file: req.file,
    ipAddress: req.ip,
  });
  return res.json(result);
}

async function clearUserAvatar(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AppError(400, 'Invalid user reference.');
  }
  const result = await profileService.clearUserAvatar({
    actor: req.user,
    targetUserId: userId,
    ipAddress: req.ip,
  });
  return res.json(result);
}

module.exports = { getAvatar, setUserAvatar, clearUserAvatar };
