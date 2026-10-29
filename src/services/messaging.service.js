const db = require('../config/database');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

const MIN_BODY = 1;
const MAX_BODY = 4000;
const MAX_SUBJECT = 160;

const AUDIENCE_TYPES = ['all', 'role', 'class', 'user'];

function cleanText(value, { min = MIN_BODY, max = MAX_BODY, field = 'Message' }) {
  const text = String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
  if (text.length < min) throw new AppError(400, `${field} cannot be empty.`);
  return text.slice(0, max);
}

function cleanSubject(value) {
  const subject = String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, MAX_SUBJECT);
  return subject;
}

async function loadTeacher(user) {
  return db.get('SELECT id, first_name, last_name FROM teachers WHERE user_id = ?', [user.id]);
}

async function loadStudent(user) {
  return db.get(
    `SELECT s.id, s.first_name, s.last_name, se.class_id, c.name AS class_name
     FROM students s
     LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
     LEFT JOIN classes c ON c.id = se.class_id
     WHERE s.user_id = ?
     ORDER BY se.id DESC
     LIMIT 1`,
    [user.id]
  );
}

// Which audience options a role may address, with the concrete recipient pool for each
async function getRecipientOptions(user) {
  const options = [];
  const teacher = user.role === 'teacher' ? await loadTeacher(user) : null;
  const student = user.role === 'student' ? await loadStudent(user) : null;

  if (user.role === 'superadmin') {
    options.push({ type: 'all', value: '', label: 'Everyone (all staff, teachers & students)' });
    const roles = await db.query(
      `SELECT r.slug, r.name, COUNT(ur.user_id) AS members
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       LEFT JOIN users u ON u.id = ur.user_id AND u.status = 'active'
       GROUP BY r.id, r.slug, r.name
       ORDER BY r.id ASC`
    );
    roles.forEach((r) =>
      options.push({ type: 'role', value: r.slug, label: `All ${r.name} (${Number(r.members || 0)})` })
    );
    const classes = await db.query('SELECT id, name FROM classes ORDER BY name ASC');
    classes.forEach((c) => options.push({ type: 'class', value: String(c.id), label: `Class ${c.name}` }));
    const users = await db.query(
      `SELECT u.id, u.full_name, u.email,
              (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS role
       FROM users u
       WHERE u.id <> ? AND u.status = 'active'
       ORDER BY u.full_name ASC
       LIMIT 300`,
      [user.id]
    );
    users.forEach((u) =>
      options.push({ type: 'user', value: String(u.id), label: `${u.full_name} (${u.role || 'user'})` })
    );
    return { options, canBroadcast: true };
  }

  if (user.role === 'teacher') {
    if (teacher) {
      const classes = await db.query(
        `SELECT DISTINCT c.id, c.name
         FROM teacher_assignments ta
         INNER JOIN classes c ON c.id = ta.class_id
         WHERE ta.teacher_id = ?
         ORDER BY c.name ASC`,
        [teacher.id]
      );
      classes.forEach((c) => options.push({ type: 'class', value: String(c.id), label: `Class ${c.name}` }));
    }
    const others = await db.query(
      `SELECT u.id, u.full_name,
              (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS role
       FROM users u
       WHERE u.id <> ? AND u.status = 'active' AND u.id IN (
         SELECT user_id FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE r.slug IN ('superadmin', 'financial')
       )
       ORDER BY u.full_name ASC
       LIMIT 100`,
      [user.id]
    );
    others.forEach((u) =>
      options.push({ type: 'user', value: String(u.id), label: `${u.full_name} (${u.role || 'user'})` })
    );
    if (teacher) {
      const classStudents = await db.query(
        `SELECT DISTINCT u.id, s.first_name, s.last_name, c.name AS class_name
         FROM teacher_assignments ta
         INNER JOIN classes c ON c.id = ta.class_id
         INNER JOIN student_enrolments se ON se.class_id = c.id AND se.status IN ('enrolled', 'active')
         INNER JOIN students s ON s.id = se.student_id
         INNER JOIN users u ON u.id = s.user_id AND u.status = 'active'
         WHERE ta.teacher_id = ?
         ORDER BY s.first_name ASC
         LIMIT 300`,
        [teacher.id]
      );
      classStudents.forEach((s) =>
        options.push({
          type: 'user',
          value: String(s.id),
          label: `${s.first_name} ${s.last_name} (${s.class_name})`,
        })
      );
    }
    return { options, canBroadcast: false };
  }

  if (user.role === 'student' && student?.class_id) {
    const teachers = await db.query(
      `SELECT DISTINCT u.id, t.first_name, t.last_name, sub.name AS subject_name
       FROM teacher_assignments ta
       INNER JOIN teachers t ON t.id = ta.teacher_id
       INNER JOIN users u ON u.id = t.user_id AND u.status = 'active'
       LEFT JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.class_id = ?
       ORDER BY t.first_name ASC
       LIMIT 100`,
      [student.class_id]
    );
    teachers.forEach((t) =>
      options.push({
        type: 'user',
        value: String(t.id),
        label: `${t.first_name} ${t.last_name}${t.subject_name ? ` (${t.subject_name})` : ''}`,
      })
    );
  }

  if (user.role === 'student') {
    const admins = await db.query(
      `SELECT u.id, u.full_name
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE r.slug = 'superadmin' AND u.status = 'active'
       LIMIT 20`
    );
    admins.forEach((u) => options.push({ type: 'user', value: String(u.id), label: `${u.full_name} (admin)` }));
  }

  if (user.role === 'financial') {
    const others = await db.query(
      `SELECT u.id, u.full_name,
              (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS role
       FROM users u
       WHERE u.id <> ? AND u.status = 'active'
       ORDER BY u.full_name ASC
       LIMIT 300`,
      [user.id]
    );
    others.forEach((u) =>
      options.push({ type: 'user', value: String(u.id), label: `${u.full_name} (${u.role || 'user'})` })
    );
  }

  return { options, canBroadcast: false };
}

// Resolves the actual recipient user ids for a requested audience, enforcing role permissions
async function resolveRecipients(user, audienceType, audienceValue) {
  const type = String(audienceType || '').trim().toLowerCase();
  const value = String(audienceValue ?? '').trim();
  if (!AUDIENCE_TYPES.includes(type)) throw new AppError(400, 'Invalid message audience.');

  const ids = new Set();
  let label = '';

  if (type === 'all') {
    if (user.role !== 'superadmin') {
      throw new AppError(403, 'Only the Superadmin can message everyone.');
    }
    const rows = await db.query("SELECT id FROM users WHERE status = 'active'");
    rows.forEach((r) => ids.add(Number(r.id)));
    label = 'Everyone';
  } else if (type === 'role') {
    if (user.role !== 'superadmin') {
      throw new AppError(403, 'Only the Superadmin can message a whole role.');
    }
    const rows = await db.query(
      `SELECT u.id FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE r.slug = ? AND u.status = 'active'`,
      [value]
    );
    rows.forEach((r) => ids.add(Number(r.id)));
    const role = await db.get('SELECT name FROM roles WHERE slug = ?', [value]);
    label = `All ${role?.name || value}`;
    if (!role) throw new AppError(400, 'Unknown role selected.');
  } else if (type === 'class') {
    const classId = Number(value);
    if (!Number.isInteger(classId) || classId <= 0) throw new AppError(400, 'Select a valid class.');
    const klass = await db.get('SELECT id, name FROM classes WHERE id = ?', [classId]);
    if (!klass) throw new AppError(404, 'Class not found.');
    if (user.role === 'teacher') {
      const teacher = await loadTeacher(user);
      const allowed = teacher
        ? await db.get('SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? LIMIT 1', [
            teacher.id,
            classId,
          ])
        : null;
      if (!allowed) throw new AppError(403, 'You can only message classes assigned to you.');
    } else if (user.role !== 'superadmin') {
      throw new AppError(403, 'You cannot message a whole class.');
    }
    const rows = await db.query(
      `SELECT s.user_id
       FROM student_enrolments se
       INNER JOIN students s ON s.id = se.student_id
       INNER JOIN users u ON u.id = s.user_id AND u.status = 'active'
       WHERE se.class_id = ? AND se.status IN ('enrolled', 'active')`,
      [classId]
    );
    rows.forEach((r) => ids.add(Number(r.user_id)));
    label = `Class ${klass.name}`;
  } else {
    const targetUserId = Number(value);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new AppError(400, 'Select a valid recipient.');
    }
    const target = await db.get(
      `SELECT u.id, u.full_name, u.status,
              (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS role
       FROM users u WHERE u.id = ?`,
      [targetUserId]
    );
    if (!target) throw new AppError(404, 'Recipient account not found.');
    if (Number(target.id) === Number(user.id)) throw new AppError(400, 'You cannot message yourself.');
    if (user.role !== 'superadmin' && target.role === 'student' && user.role !== 'teacher') {
      throw new AppError(403, 'You cannot message that account.');
    }
    if (user.role === 'teacher' && target.role === 'student') {
      const teacher = await loadTeacher(user);
      const studentRow = await db.get(
        `SELECT se.id
         FROM students s
         INNER JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
         INNER JOIN teacher_assignments ta ON ta.class_id = se.class_id AND ta.teacher_id = ?
         WHERE s.user_id = ?
         LIMIT 1`,
        [teacher?.id || 0, target.id]
      );
      if (!studentRow) throw new AppError(403, 'That student is not in any of your classes.');
    }
    if (user.role === 'student') {
      const student = await loadStudent(user);
      const ok = await db.get(
        `SELECT ta.id
         FROM teacher_assignments ta
         INNER JOIN teachers t ON t.id = ta.teacher_id
         WHERE t.user_id = ? AND ta.class_id = ?
         LIMIT 1`,
        [target.id, student?.class_id || 0]
      );
      const isAdmin = target.role === 'superadmin';
      if (!ok && !isAdmin) throw new AppError(403, 'You can only message your teachers or the admin.');
    }
    ids.add(Number(target.id));
    label = target.full_name;
  }

  ids.delete(Number(user.id));
  const recipientIds = Array.from(ids).filter((id) => Number.isInteger(id) && id > 0);
  if (recipientIds.length === 0) {
    throw new AppError(400, 'No active recipients matched that audience.');
  }
  return { recipientIds, label, audienceType: type, audienceValue: value };
}

function formatAttachment(row) {
  return {
    id: Number(row.id),
    originalName: row.original_name,
    mimeType: row.mime_type,
    mediaKind: row.media_kind,
    sizeBytes: Number(row.size_bytes || 0),
    url: `/api/media/${row.id}`,
    downloadUrl: `/api/media/${row.id}?download=1`,
  };
}

async function loadAttachmentsFor(messageIds) {
  if (!messageIds.length) return new Map();
  const rows = await db.query(
    `SELECT * FROM media_attachments
     WHERE owner_type = 'message' AND owner_id IN (${messageIds.map(() => '?').join(', ')})`,
    messageIds
  );
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(Number(r.owner_id))) map.set(Number(r.owner_id), []);
    map.get(Number(r.owner_id)).push(formatAttachment(r));
  });
  return map;
}

async function listThreads(user, { search = '' } = {}) {
  // placeholders in order: inbound count sender, unread count sender, participant join
  const params = [user.id, user.id, user.id];
  let where = '';
  if (search) {
    where =
      ' AND (LOWER(t.subject) LIKE ? OR EXISTS (SELECT 1 FROM messages m2 WHERE m2.thread_id = t.id AND LOWER(m2.body) LIKE ?))';
    const q = `%${String(search).trim().toLowerCase()}%`;
    params.push(q, q);
  }
  const threads = await db.query(
    `SELECT t.id, t.subject, t.audience_type, t.audience_value, t.audience_label,
            t.created_by_user_id, t.last_message_at, t.created_at,
            p.last_read_at,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_user_id <> ?) AS total_inbound,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_user_id <> ? AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread_count,
            (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT u.full_name FROM messages m INNER JOIN users u ON u.id = m.sender_user_id WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
            (SELECT m.created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_at
     FROM message_threads t
     INNER JOIN message_participants p ON p.thread_id = t.id AND p.user_id = ?
     WHERE 1=1${where}
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
     LIMIT 200`,
    params
  );

  const unreadRow = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM message_threads t
     INNER JOIN message_participants p ON p.thread_id = t.id AND p.user_id = ?
     WHERE EXISTS (
       SELECT 1 FROM messages m
       WHERE m.thread_id = t.id AND m.sender_user_id <> ?
         AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
     )`,
    [user.id, user.id]
  );

  return {
    items: threads.map((t) => ({
      id: Number(t.id),
      subject: t.subject,
      audienceType: t.audience_type,
      audienceLabel: t.audience_label,
      lastBody: String(t.last_body || '').slice(0, 180),
      lastSender: t.last_sender || '',
      lastAt: t.last_at || t.last_message_at || t.created_at,
      unreadCount: Number(t.unread_count || 0),
      isMine: Number(t.created_by_user_id) === Number(user.id),
    })),
    unreadThreads: Number(unreadRow?.cnt || 0),
  };
}

async function getThread(user, threadId, { markRead = true } = {}) {
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid conversation.');
  const participant = await db.get(
    'SELECT * FROM message_participants WHERE thread_id = ? AND user_id = ?',
    [id, user.id]
  );
  if (!participant) throw new AppError(404, 'Conversation not found.');

  const thread = await db.get(
    `SELECT t.*, u.full_name AS created_by_name
     FROM message_threads t
     INNER JOIN users u ON u.id = t.created_by_user_id
     WHERE t.id = ?`,
    [id]
  );

  const messages = await db.query(
    `SELECT m.id, m.body, m.created_at, m.sender_user_id, u.full_name AS sender_name,
            (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS sender_role
     FROM messages m
     INNER JOIN users u ON u.id = m.sender_user_id
     WHERE m.thread_id = ?
     ORDER BY m.id ASC
     LIMIT 500`,
    [id]
  );

  const attachments = await loadAttachmentsFor(messages.map((m) => Number(m.id)));

  if (markRead) {
    await db.run(
      "UPDATE message_participants SET last_read_at = CURRENT_TIMESTAMP WHERE thread_id = ? AND user_id = ?",
      [id, user.id]
    );
  }

  return {
    thread: {
      id: Number(thread.id),
      subject: thread.subject,
      audienceType: thread.audience_type,
      audienceLabel: thread.audience_label,
      createdByName: thread.created_by_name,
      createdAt: thread.created_at,
    },
    messages: messages.map((m) => ({
      id: Number(m.id),
      body: m.body,
      createdAt: m.created_at,
      senderUserId: Number(m.sender_user_id),
      senderName: m.sender_name,
      senderRole: m.sender_role || '',
      isMine: Number(m.sender_user_id) === Number(user.id),
      attachments: attachments.get(Number(m.id)) || [],
    })),
  };
}

async function createThread(user, { subject, body, audienceType, audienceValue, files = [], ipAddress }) {
  const cleanBody = cleanText(body, { field: 'Message' });
  const cleanSub = cleanSubject(subject);
  const { recipientIds, label } = await resolveRecipients(user, audienceType, audienceValue);

  const threadId = await db.withTransaction(async (tx) => {
    const ins = await tx.run(
      `INSERT INTO message_threads (subject, audience_type, audience_value, audience_label, created_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [cleanSub, String(audienceType).trim(), String(audienceValue ?? '').trim(), label, user.id]
    );
    const threadId = ins.insertId;
    // The sender starts unstamped; unread counts ignore their own messages, so this
    // avoids same-second races where a reply would not register as unread.
    await tx.run(
      'INSERT INTO message_participants (thread_id, user_id) VALUES (?, ?)',
      [threadId, user.id]
    );
    for (const rid of recipientIds) {
      await tx.run('INSERT INTO message_participants (thread_id, user_id) VALUES (?, ?)', [threadId, rid]);
    }
    const msgIns = await tx.run('INSERT INTO messages (thread_id, sender_user_id, body) VALUES (?, ?, ?)', [
      threadId,
      user.id,
      cleanBody,
    ]);
    for (const file of files) {
      await tx.run(
        `INSERT INTO media_attachments
           (owner_type, owner_id, uploaded_by_user_id, original_name, stored_name, mime_type, media_kind, size_bytes)
         VALUES ('message', ?, ?, ?, ?, ?, ?, ?)`,
        [
          msgIns.insertId,
          user.id,
          String(file.originalname || 'attachment').slice(0, 255),
          file.filename,
          file.safeMimeType || file.mimetype || 'application/octet-stream',
          file.mediaKind || 'document',
          Number(file.size || 0),
        ]
      );
    }
    await tx.run('UPDATE message_threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [threadId]);
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'MESSAGE_SENT',
        targetType: 'message_thread',
        targetId: String(threadId),
        ipAddress,
        metadata: { audienceType, audienceValue, recipients: recipientIds.length, attachments: files.length },
      },
      tx
    );
    return threadId;
  });

  const created = await getThread(user, threadId, { markRead: false });
  return {
    threadId,
    thread: created.thread,
    recipients: recipientIds.length,
    message: `Message delivered to ${recipientIds.length} recipient${recipientIds.length === 1 ? '' : 's'}.`,
  };
}

async function replyToThread(user, threadId, { body, files = [], ipAddress }) {
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid conversation.');
  const participant = await db.get(
    'SELECT * FROM message_participants WHERE thread_id = ? AND user_id = ?',
    [id, user.id]
  );
  if (!participant) throw new AppError(404, 'Conversation not found.');
  const cleanBody = cleanText(body, { field: 'Reply' });

  await db.withTransaction(async (tx) => {
    const msgIns = await tx.run('INSERT INTO messages (thread_id, sender_user_id, body) VALUES (?, ?, ?)', [
      id,
      user.id,
      cleanBody,
    ]);
    for (const file of files) {
      await tx.run(
        `INSERT INTO media_attachments
           (owner_type, owner_id, uploaded_by_user_id, original_name, stored_name, mime_type, media_kind, size_bytes)
         VALUES ('message', ?, ?, ?, ?, ?, ?, ?)`,
        [
          msgIns.insertId,
          user.id,
          String(file.originalname || 'attachment').slice(0, 255),
          file.filename,
          file.safeMimeType || file.mimetype || 'application/octet-stream',
          file.mediaKind || 'document',
          Number(file.size || 0),
        ]
      );
    }
    await tx.run(
      "UPDATE message_threads SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
    await tx.run(
      'UPDATE message_participants SET last_read_at = CURRENT_TIMESTAMP WHERE thread_id = ? AND user_id = ?',
      [id, user.id]
    );
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'MESSAGE_REPLIED',
        targetType: 'message_thread',
        targetId: String(id),
        ipAddress,
        metadata: { attachments: files.length },
      },
      tx
    );
  });

  const updated = await getThread(user, id, { markRead: true });
  return { threadId: id, thread: updated.thread, messages: updated.messages, message: 'Reply sent.' };
}

async function markThreadRead(user, threadId) {
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid conversation.');
  const participant = await db.get(
    'SELECT * FROM message_participants WHERE thread_id = ? AND user_id = ?',
    [id, user.id]
  );
  if (!participant) throw new AppError(404, 'Conversation not found.');
  await db.run(
    'UPDATE message_participants SET last_read_at = CURRENT_TIMESTAMP WHERE thread_id = ? AND user_id = ?',
    [id, user.id]
  );
  return { message: 'Conversation marked as read.' };
}

async function markAllRead(user) {
  await db.run(
    `UPDATE message_participants
     SET last_read_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND last_read_at IS NULL`,
    [user.id]
  );
  return { message: 'All notifications marked as read.' };
}

async function getUnreadSummary(user) {
  const threads = await db.query(
    `SELECT t.id, t.subject, t.audience_label,
            (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT u.full_name FROM messages m INNER JOIN users u ON u.id = m.sender_user_id WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
            (SELECT m.created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_at,
            (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.sender_user_id <> ?
               AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread_count
     FROM message_threads t
     INNER JOIN message_participants p ON p.thread_id = t.id AND p.user_id = ?
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
     LIMIT 200`,
    [user.id, user.id]
  );
  const items = threads
    .filter((t) => Number(t.unread_count || 0) > 0)
    .slice(0, 6)
    .map((t) => ({
      id: Number(t.id),
      subject: t.subject || '(no subject)',
      audienceLabel: t.audience_label,
      lastBody: String(t.last_body || '').slice(0, 120),
      lastSender: t.last_sender || '',
      lastAt: t.last_at || '',
      unreadCount: Number(t.unread_count || 0),
    }));
  return { unreadThreads: items.length, items };
}

async function isThreadParticipant(userId, threadId) {
  const row = await db.get(
    'SELECT id FROM message_participants WHERE thread_id = ? AND user_id = ? LIMIT 1',
    [threadId, userId]
  );
  return Boolean(row);
}

module.exports = {
  getRecipientOptions,
  resolveRecipients,
  listThreads,
  getThread,
  createThread,
  replyToThread,
  markThreadRead,
  markAllRead,
  getUnreadSummary,
  isThreadParticipant,
};
