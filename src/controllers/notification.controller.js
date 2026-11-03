const notificationService = require('../services/notification.service');
const { optionalString } = require('../validators/schemas');
const { AppError } = require('../middleware/errorHandler');

async function listNotifications(req, res) {
  const data = await notificationService.listNotifications(req.user);
  return res.json({ ok: true, ...data });
}

async function markAllRead(_req, res) {
  const data = await notificationService.markAllRead(_req.user);
  return res.json({ ok: true, ...data });
}

async function markRead(req, res) {
  const kind = optionalString(req.body.kind, 30);
  const id = Number(req.body.id);
  // id 0 marks every notification of that kind (the Announcements tab uses it).
  if (!kind || !Number.isInteger(id) || id < 0) {
    throw new AppError(400, 'A notification kind and id are required.');
  }
  const data = await notificationService.markRead(req.user, { kind, id });
  return res.json({ ok: true, ...data });
}

module.exports = {
  listNotifications,
  markAllRead,
  markRead,
};
