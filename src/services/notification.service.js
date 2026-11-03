const db = require('../config/database');
const systemModel = require('../models/system.model');
const messagingService = require('./messaging.service');

// -----------------------------------------------------------------------------
// The notification bell is the single place where everything that needs a user's
// attention shows up: unread messages, published announcements, new student
// registration proposals, coursework to submit, submissions waiting to be
// graded, mark correction requests and fee bills falling due.
// -----------------------------------------------------------------------------

const KIND_LABELS = {
  message: 'Message',
  announcement: 'Announcement',
  registration: 'New registration',
  profile: 'Profile request',
  correction: 'Mark correction',
  submission: 'Submission',
  coursework: 'Coursework',
  result: 'Result',
  fee: 'Fee due',
};

const MAX_ANNOUNCEMENTS = 8;
const MAX_ITEMS = 12;

async function announcementsForUser(user) {
  if (user.role === 'student') {
    const student = await db.get(
      `SELECT se.class_id
       FROM students s
       LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
       WHERE s.user_id = ?
       ORDER BY se.id DESC
       LIMIT 1`,
      [user.id]
    );
    return systemModel.listAnnouncementsForStudent(student ? student.class_id : null);
  }
  if (user.role === 'teacher') {
    const teacher = await db.get('SELECT id FROM teachers WHERE user_id = ?', [user.id]);
    if (!teacher) return systemModel.listAnnouncementsForAudience(['all', 'teachers']);
    const rows = await db.query(
      'SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = ?',
      [teacher.id]
    );
    return systemModel.listAnnouncementsForTeacher(
      user.id,
      rows.map((r) => Number(r.class_id))
    );
  }
  if (user.role === 'financial') {
    return systemModel.listAnnouncementsForAudience(['all', 'financial']);
  }
  return systemModel.listAnnouncementsForAudience([
    'all',
    'teachers',
    'students',
    'financial',
    'class',
  ]);
}

async function readAnnouncementIds(userId) {
  const rows = await db.query(
    'SELECT announcement_id FROM announcement_reads WHERE user_id = ?',
    [userId]
  );
  return new Set(rows.map((r) => Number(r.announcement_id)));
}

async function announcementNotifications(user) {
  const [announcements, readIds] = await Promise.all([
    announcementsForUser(user),
    readAnnouncementIds(user.id),
  ]);

  return announcements.slice(0, MAX_ANNOUNCEMENTS).map((a) => {
    // Everyone - including the person who published it - sees the announcement until it is read,
    // so the bell always reflects what has been posted.
    const unread = !readIds.has(Number(a.id));
    const audience =
      a.audience === 'class'
        ? `Classes: ${(a.target_classes || []).map((c) => c.name).join(', ') || 'selected classes'}`
        : {
            all: 'Everyone',
            teachers: 'Teachers',
            students: 'Students',
            financial: 'Financial staff',
          }[a.audience] || a.audience;

    return {
      key: `announcement:${a.id}`,
      kind: 'announcement',
      label: KIND_LABELS.announcement,
      title: a.title,
      body: String(a.body || '').slice(0, 140),
      meta: `${a.author_name ? `${a.author_name} · ` : ''}to ${audience}`,
      at: a.edited_at || a.created_at || a.publish_at || '',
      unread,
      target: { section: 'announcements', announcementId: Number(a.id) },
    };
  });
}

// -----------------------------------------------------------------------------
// Role-specific pending work (approvals, submissions, grading, fee deadlines)
// -----------------------------------------------------------------------------
async function pendingForSuperadmin() {
  const [registrations, profiles, corrections] = await Promise.all([
    db.query(
      `SELECT r.id, r.first_name, r.last_name, r.email, r.created_at, c.name AS class_name
       FROM student_registration_requests r
       LEFT JOIN classes c ON c.id = r.requested_class_id
       WHERE r.status = 'pending'
       ORDER BY r.id DESC
       LIMIT 5`
    ),
    db.query(
      `SELECT COUNT(*) AS cnt FROM profile_change_requests WHERE status = 'pending'`
    ),
    db.query(`SELECT COUNT(*) AS cnt FROM mark_correction_requests WHERE status = 'pending'`),
  ]);

  const items = registrations.map((r) => ({
    key: `registration:${r.id}`,
    kind: 'registration',
    label: KIND_LABELS.registration,
    title: `${r.first_name} ${r.last_name} applied to join`,
    body: `${r.email || 'No email provided'}${r.class_name ? ` · ${r.class_name}` : ''}`,
    meta: 'Student join proposal awaiting review',
    at: r.created_at || '',
    unread: true,
    target: { section: 'students', subtab: 'stu-proposals' },
  }));

  const profileCount = Number(profiles[0]?.cnt || 0);
  if (profileCount > 0) {
    items.push({
      key: 'profile:pending',
      kind: 'profile',
      label: KIND_LABELS.profile,
      title: `${profileCount} profile change request${profileCount === 1 ? '' : 's'}`,
      body: 'Students asked to update their personal records.',
      meta: 'Awaiting administrator review',
      at: '',
      unread: true,
      target: { section: 'students' },
    });
  }

  const correctionCount = Number(corrections[0]?.cnt || 0);
  if (correctionCount > 0) {
    items.push({
      key: 'correction:pending',
      kind: 'correction',
      label: KIND_LABELS.correction,
      title: `${correctionCount} mark correction request${correctionCount === 1 ? '' : 's'}`,
      body: 'Teachers asked for marks to be reviewed.',
      meta: 'Awaiting administrator review',
      at: '',
      unread: true,
      target: { section: 'students' },
    });
  }

  return items;
}

async function pendingForTeacher(user) {
  const teacher = await db.get('SELECT id FROM teachers WHERE user_id = ?', [user.id]);
  if (!teacher) return [];

  const [submissions, corrections] = await Promise.all([
    db.query(
      `SELECT cs.id, cs.submitted_at, cw.title,
              s.first_name, s.last_name, c.name AS class_name
       FROM coursework_submissions cs
       INNER JOIN coursework_items cw ON cw.id = cs.coursework_id
       INNER JOIN students s ON s.id = cs.student_id
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cw.teacher_id = ? AND cs.score IS NULL
       ORDER BY cs.submitted_at DESC, cs.id DESC
       LIMIT 5`,
      [teacher.id]
    ),
    db.query(
      `SELECT COUNT(*) AS cnt
       FROM mark_correction_requests mcr
       INNER JOIN assessments a ON a.id = mcr.assessment_id
       WHERE mcr.status = 'pending'
         AND EXISTS (
           SELECT 1 FROM teacher_assignments ta
           WHERE ta.teacher_id = ? AND ta.class_id = a.class_id AND ta.subject_id = a.subject_id
         )`,
      [teacher.id]
    ),
  ]);

  const items = submissions.map((s) => ({
    key: `submission:${s.id}`,
    kind: 'submission',
    label: KIND_LABELS.submission,
    title: `${s.first_name} ${s.last_name} submitted work`,
    body: `${s.title}${s.class_name ? ` · ${s.class_name}` : ''}`,
    meta: 'Waiting to be graded',
    at: s.submitted_at || '',
    unread: true,
    target: { section: 'coursework' },
  }));

  const correctionCount = Number(corrections[0]?.cnt || 0);
  if (correctionCount > 0) {
    items.push({
      key: 'correction:pending',
      kind: 'correction',
      label: KIND_LABELS.correction,
      title: `${correctionCount} mark correction request${correctionCount === 1 ? '' : 's'}`,
      body: 'Requests raised on assessments for your classes.',
      meta: 'Awaiting review',
      at: '',
      unread: true,
      target: { section: 'classes' },
    });
  }

  return items;
}

async function pendingForStudent(user) {
  const student = await db.get(
    `SELECT s.id, se.class_id
     FROM students s
     LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
     WHERE s.user_id = ?
     ORDER BY se.id DESC
     LIMIT 1`,
    [user.id]
  );
  if (!student || !student.class_id) return [];

  const [pending, graded] = await Promise.all([
    db.query(
      `SELECT cw.id, cw.title, cw.work_type, cw.due_at, cw.created_at, subj.name AS subject_name
       FROM coursework_items cw
       INNER JOIN coursework_classes cc ON cc.coursework_id = cw.id
       INNER JOIN subjects subj ON subj.id = cw.subject_id
       LEFT JOIN coursework_submissions cs
         ON cs.coursework_id = cw.id AND cs.student_id = ?
       WHERE cc.class_id = ? AND cs.id IS NULL
       ORDER BY cw.id DESC
       LIMIT 5`,
      [student.id, student.class_id]
    ),
    db.query(
      `SELECT cs.id, cs.graded_at, cs.score, cw.title
       FROM coursework_submissions cs
       INNER JOIN coursework_items cw ON cw.id = cs.coursework_id
       WHERE cs.student_id = ? AND cs.score IS NOT NULL
       ORDER BY cs.graded_at DESC, cs.id DESC
       LIMIT 3`,
      [student.id]
    ),
  ]);

  const items = pending.map((cw) => ({
    key: `coursework:${cw.id}`,
    kind: 'coursework',
    label: KIND_LABELS.coursework,
    title: `New ${String(cw.work_type || 'work')}: ${cw.title}`,
    body: `${cw.subject_name || 'Subject'}${cw.due_at ? ` · due ${cw.due_at}` : ''}`,
    meta: 'You have not submitted this yet',
    at: cw.created_at || '',
    unread: true,
    target: { section: 'coursework' },
  }));

  for (const row of graded) {
    items.push({
      key: `result:${row.id}`,
      kind: 'result',
      label: KIND_LABELS.result,
      title: `${row.title} has been graded`,
      body: `Score: ${row.score}`,
      meta: 'Teacher feedback is available',
      at: row.graded_at || '',
      unread: true,
      target: { section: 'results' },
    });
  }

  return items;
}

async function pendingForFinancial() {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.query(
    `SELECT fa.id, fa.due_date, (fa.amount_due - fa.amount_paid - fa.discount_amount) AS balance,
            s.first_name, s.last_name, s.admission_number
     FROM fee_assignments fa
     INNER JOIN students s ON s.id = fa.student_id
     WHERE fa.status <> 'paid' AND fa.due_date <> '' AND fa.due_date <= ?
     ORDER BY fa.due_date ASC
     LIMIT 5`,
    [soon]
  );

  return rows.map((r) => ({
    key: `fee:${r.id}`,
    kind: 'fee',
    label: KIND_LABELS.fee,
    title: `${r.first_name} ${r.last_name} — bill due ${r.due_date}`,
    body: `${r.admission_number} · balance ${Number(r.balance || 0).toFixed(2)}`,
    meta: 'Fee deadline within 7 days',
    at: r.due_date || '',
    unread: true,
    target: { section: 'billing' },
  }));
}

async function pendingForRole(user) {
  if (user.role === 'superadmin') return pendingForSuperadmin();
  if (user.role === 'teacher') return pendingForTeacher(user);
  if (user.role === 'student') return pendingForStudent(user);
  if (user.role === 'financial') return pendingForFinancial();
  return [];
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
async function listNotifications(user) {
  const [messages, announcements, pending] = await Promise.all([
    messagingService.getUnreadSummary(user),
    announcementNotifications(user),
    pendingForRole(user),
  ]);

  const messageItems = (messages.items || []).map((m) => ({
    key: `message:${m.id}`,
    kind: 'message',
    label: KIND_LABELS.message,
    title: m.subject,
    body: m.lastBody || '',
    meta: `${m.lastSender || ''}${m.audienceLabel ? ` · ${m.audienceLabel}` : ''}`,
    at: m.lastAt || '',
    unread: true,
    target: { section: 'messages', threadId: Number(m.id) },
  }));

  const items = [...messageItems, ...announcements, ...pending]
    .sort((a, b) => {
      if (Boolean(a.unread) !== Boolean(b.unread)) return a.unread ? -1 : 1;
      return String(b.at || '').localeCompare(String(a.at || ''));
    })
    .slice(0, MAX_ITEMS);

  const unread =
    Number(messages.unreadThreads || 0) +
    announcements.filter((a) => a.unread).length +
    pending.length;

  return { unread, unreadThreads: Number(messages.unreadThreads || 0), items };
}

async function markAnnouncementRead(user, announcementId) {
  const id = Number(announcementId);
  // id 0 is the "everything of this kind" shortcut used when the Announcements tab is opened.
  if (id === 0) return markAllAnnouncementsRead(user);
  if (!Number.isInteger(id) || id <= 0) return { read: false };
  const existing = await db.get(
    'SELECT id FROM announcement_reads WHERE user_id = ? AND announcement_id = ?',
    [user.id, id]
  );
  if (!existing) {
    await db.run(
      'INSERT INTO announcement_reads (user_id, announcement_id) VALUES (?, ?)',
      [user.id, id]
    );
  }
  return { read: true };
}

async function markAllAnnouncementsRead(user) {
  const announcements = await announcementsForUser(user);
  const readIds = await readAnnouncementIds(user.id);
  let marked = 0;
  for (const ann of announcements) {
    const id = Number(ann.id);
    if (!id || readIds.has(id)) continue;
    await db.run('INSERT INTO announcement_reads (user_id, announcement_id) VALUES (?, ?)', [
      user.id,
      id,
    ]);
    marked += 1;
  }
  return { read: marked > 0, marked };
}

async function markAllRead(user) {
  const [, announcements] = await Promise.all([
    messagingService.markAllRead(user),
    announcementsForUser(user),
  ]);

  const readIds = await readAnnouncementIds(user.id);
  for (const ann of announcements) {
    const id = Number(ann.id);
    if (!readIds.has(id)) {
      await db.run('INSERT INTO announcement_reads (user_id, announcement_id) VALUES (?, ?)', [
        user.id,
        id,
      ]);
    }
  }
  return { message: 'All notifications marked as read.' };
}

async function markRead(user, { kind, id }) {
  if (kind === 'message') {
    await messagingService.markThreadRead(user, Number(id));
    return { read: true };
  }
  if (kind === 'announcement') {
    return markAnnouncementRead(user, id);
  }
  // Pending approvals stay in the bell until they are acted on.
  return { read: false };
}

module.exports = {
  listNotifications,
  markAllRead,
  markRead,
};
