const messagingService = require('../services/messaging.service');
const { optionalString } = require('../validators/schemas');
const { AppError } = require('../middleware/errorHandler');
const { cleanupUploadedFiles } = require('../config/upload');

function filesOf(req) {
  return Array.isArray(req.files) ? req.files : [];
}

async function getRecipients(req, res) {
  const data = await messagingService.getRecipientOptions(req.user);
  return res.json({ ok: true, ...data });
}

async function listThreads(req, res) {
  const data = await messagingService.listThreads(req.user, {
    search: optionalString(req.query.search, 120),
  });
  return res.json({ ok: true, ...data });
}

async function getThread(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id > 0 === false) {
    throw new AppError(400, 'Invalid conversation.');
  }
  const data = await messagingService.getThread(req.user, id);
  return res.json({ ok: true, ...data });
}

async function createThread(req, res) {
  try {
    const created = await messagingService.createThread(req.user, {
      subject: req.body.subject,
      body: req.body.body,
      audienceType: req.body.audienceType || req.body.audience_type,
      audienceValue: req.body.audienceValue ?? req.body.audience_value ?? '',
      files: filesOf(req),
      ipAddress: req.ip,
    });
    return res.status(201).json({ ok: true, ...created });
  } catch (err) {
    cleanupUploadedFiles(filesOf(req));
    throw err;
  }
}

async function reply(req, res) {
  try {
    const result = await messagingService.replyToThread(req.user, req.params.id, {
      body: req.body.body,
      files: filesOf(req),
      ipAddress: req.ip,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    cleanupUploadedFiles(filesOf(req));
    throw err;
  }
}

async function markRead(req, res) {
  const result = await messagingService.markThreadRead(req.user, req.params.id);
  return res.json({ ok: true, ...result });
}

async function markAllRead(req, res) {
  const result = await messagingService.markAllRead(req.user);
  return res.json({ ok: true, ...result });
}

async function unread(req, res) {
  const data = await messagingService.getUnreadSummary(req.user);
  return res.json({ ok: true, ...data });
}

module.exports = {
  getRecipients,
  listThreads,
  getThread,
  createThread,
  reply,
  markRead,
  markAllRead,
  unread,
};
