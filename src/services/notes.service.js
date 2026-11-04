const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { sanitizeNoteHtml, noteHtmlToText, countWords } = require('../utils/sanitizeNoteHtml');

const NOTE_COLORS = [
  '#1d4ed8', '#0f766e', '#b45309', '#b91c1c',
  '#7c3aed', '#047857', '#0369a1', '#be185d',
];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TITLE = 200;
const MAX_EXCERPT = 300;

function normaliseTitle(value, { allowEmpty = true } = {}) {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!title && !allowEmpty) throw new AppError(400, 'A note needs a title.');
  return title;
}

function normaliseColor(value) {
  const color = String(value || '').trim();
  if (!COLOR_RE.test(color)) return NOTE_COLORS[0];
  return color.toLowerCase();
}

function normaliseContent(value) {
  if (value === undefined || value === null) return '';
  const sanitized = sanitizeNoteHtml(value, { maxLength: 400000 });
  return sanitized === '<br>' ? '' : sanitized;
}

function buildExcerpt(content, fallbackTitle = '') {
  const text = noteHtmlToText(content);
  const source = text || String(fallbackTitle || '').trim();
  return source.slice(0, MAX_EXCERPT);
}

function requirePositiveInt(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, `Invalid ${label}.`);
  return id;
}

function shapeRow(row, { includeContent = true } = {}) {
  if (!row) return null;
  const text = noteHtmlToText(row.content || '');
  return {
    id: row.id,
    title: row.title || '',
    content: includeContent ? row.content || '' : undefined,
    excerpt: row.excerpt || buildExcerpt(row.content || '', row.title || ''),
    color: row.color || NOTE_COLORS[0],
    pinned: Number(row.pinned || 0) === 1,
    wordCount: countWords(text),
    characterCount: text.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadNoteRow(user, noteId) {
  const id = requirePositiveInt(noteId, 'note ID');
  const row = await db.get('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, user.id]);
  if (!row) throw new AppError(404, 'Note not found.');
  return row;
}

async function listNotes(user, { search = '', limit = 200 } = {}) {
  const term = String(search || '').trim();
  const rows = term
    ? await db.query(
        `SELECT id, user_id, title, content, excerpt, color, pinned, created_at, updated_at
         FROM notes
         WHERE user_id = ? AND (title LIKE ? OR excerpt LIKE ? OR content LIKE ?)
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
        [user.id, `%${term}%`, `%${term}%`, `%${term}%`, Number(limit) || 200]
      )
    : await db.query(
        `SELECT id, user_id, title, content, excerpt, color, pinned, created_at, updated_at
         FROM notes
         WHERE user_id = ?
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
        [user.id, Number(limit) || 200]
      );
  return {
    items: rows.map((row) => shapeRow(row, { includeContent: false })),
    colors: [...NOTE_COLORS],
  };
}

async function createNote(user, payload = {}) {
  const title = normaliseTitle(payload.title, { allowEmpty: true });
  const content = normaliseContent(payload.content);
  const color = normaliseColor(payload.color);
  const excerpt = buildExcerpt(content, title);

  const ins = await db.run(
    `INSERT INTO notes (user_id, title, content, excerpt, color, pinned)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [user.id, title, content, excerpt, color]
  );
  const row = await db.get('SELECT * FROM notes WHERE id = ?', [ins.insertId]);
  return { note: shapeRow(row), message: 'Note created.' };
}

async function updateNote(user, noteId, payload = {}) {
  const existing = await loadNoteRow(user, noteId);
  const title =
    payload.title === undefined ? existing.title : normaliseTitle(payload.title, { allowEmpty: true });
  const content =
    payload.content === undefined ? existing.content : normaliseContent(payload.content);
  const color = payload.color === undefined ? existing.color : normaliseColor(payload.color);
  const pinned =
    payload.pinned === undefined
      ? Number(existing.pinned || 0)
      : payload.pinned
        ? 1
        : 0;
  const excerpt = buildExcerpt(content, title);

  await db.run(
    `UPDATE notes
     SET title = ?, content = ?, excerpt = ?, color = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [title, content, excerpt, color, pinned, existing.id, user.id]
  );
  const row = await db.get('SELECT * FROM notes WHERE id = ?', [existing.id]);
  return { note: shapeRow(row), message: 'Note saved.' };
}

async function deleteNote(user, noteId) {
  const existing = await loadNoteRow(user, noteId);
  const attachments = await db.query(
    'SELECT id, stored_name FROM media_attachments WHERE owner_type = ? AND owner_id = ?',
    ['note', existing.id]
  );
  await db.run('DELETE FROM notes WHERE id = ? AND user_id = ?', [existing.id, user.id]);
  if (attachments.length) {
    await db.run('DELETE FROM media_attachments WHERE owner_type = ? AND owner_id = ?', [
      'note',
      existing.id,
    ]);
  }
  // Physical files are left on disk; they are unreachable without their database row.
  return { message: 'Note deleted.', removedAttachments: attachments.length };
}

async function listAttachments(user, noteId) {
  const existing = await loadNoteRow(user, noteId);
  const rows = await db.query(
    `SELECT id, original_name, mime_type, media_kind, size_bytes, created_at
     FROM media_attachments
     WHERE owner_type = 'note' AND owner_id = ?
     ORDER BY id DESC`,
    [existing.id]
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      url: `/api/media/${row.id}`,
      name: row.original_name,
      mimeType: row.mime_type,
      kind: row.media_kind,
      size: Number(row.size_bytes || 0),
      createdAt: row.created_at,
    })),
  };
}

async function addAttachments(user, noteId, files = []) {
  const existing = await loadNoteRow(user, noteId);
  if (!Array.isArray(files) || !files.length) {
    throw new AppError(400, 'Choose an image, video or file to attach.');
  }
  const created = [];
  for (const file of files) {
    const ins = await db.run(
      `INSERT INTO media_attachments
         (owner_type, owner_id, uploaded_by_user_id, original_name, stored_name, mime_type, media_kind, size_bytes)
       VALUES ('note', ?, ?, ?, ?, ?, ?, ?)`,
      [
        existing.id,
        user.id,
        String(file.originalname || 'attachment').slice(0, 255),
        file.filename,
        file.safeMimeType || file.mimetype || 'application/octet-stream',
        file.mediaKind || 'document',
        Number(file.size || 0),
      ]
    );
    created.push({
      id: ins.insertId,
      url: `/api/media/${ins.insertId}`,
      name: String(file.originalname || 'attachment'),
      mimeType: file.safeMimeType || file.mimetype || 'application/octet-stream',
      kind: file.mediaKind || 'document',
      size: Number(file.size || 0),
    });
  }
  await db.run('UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [existing.id]);
  return { attachments: created, message: `${created.length} file(s) attached.` };
}

async function deleteAttachment(user, noteId, attachmentId) {
  const existing = await loadNoteRow(user, noteId);
  const id = requirePositiveInt(attachmentId, 'attachment ID');
  const att = await db.get(
    'SELECT id FROM media_attachments WHERE id = ? AND owner_type = ? AND owner_id = ?',
    [id, 'note', existing.id]
  );
  if (!att) throw new AppError(404, 'Attachment not found.');
  await db.run('DELETE FROM media_attachments WHERE id = ?', [id]);
  return { message: 'Attachment removed.' };
}

module.exports = {
  NOTE_COLORS,
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  listAttachments,
  addAttachments,
  deleteAttachment,
};
