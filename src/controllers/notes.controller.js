const notesService = require('../services/notes.service');

async function listNotes(req, res) {
  const data = await notesService.listNotes(req.user, {
    search: req.query.search,
    limit: req.query.limit,
  });
  return res.json({ ok: true, ...data });
}

async function createNote(req, res) {
  const data = await notesService.createNote(req.user, {
    title: req.body?.title,
    content: req.body?.content,
    color: req.body?.color,
  });
  return res.status(201).json({ ok: true, ...data });
}

async function updateNote(req, res) {
  const data = await notesService.updateNote(req.user, req.params.id, {
    title: req.body?.title,
    content: req.body?.content,
    color: req.body?.color,
    pinned: req.body?.pinned,
  });
  return res.json({ ok: true, ...data });
}

async function deleteNote(req, res) {
  const data = await notesService.deleteNote(req.user, req.params.id);
  return res.json({ ok: true, ...data });
}

async function listAttachments(req, res) {
  const data = await notesService.listAttachments(req.user, req.params.id);
  return res.json({ ok: true, ...data });
}

async function addAttachments(req, res) {
  const data = await notesService.addAttachments(req.user, req.params.id, req.files || []);
  return res.status(201).json({ ok: true, ...data });
}

async function deleteAttachment(req, res) {
  const data = await notesService.deleteAttachment(req.user, req.params.id, req.params.attachmentId);
  return res.json({ ok: true, ...data });
}

module.exports = {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  listAttachments,
  addAttachments,
  deleteAttachment,
};
