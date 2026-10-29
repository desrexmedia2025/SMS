const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 124;

const KIND_LABELS = {
  coursework: 'Classwork / Exam',
  announcement: 'Announcement',
  fee: 'Fee Due',
  payment: 'Payment',
};

function dateKeyOf(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normaliseRange(from, to) {
  const start = typeof from === 'string' && DATE_KEY_RE.test(from) ? from : '';
  const end = typeof to === 'string' && DATE_KEY_RE.test(to) ? to : '';
  if (!start || !end) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const key = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
    return { from: key(first), to: key(last) };
  }
  if (start > end) throw new AppError(400, 'The calendar start date must be before the end date.');
  const spanDays = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
  );
  if (spanDays > MAX_RANGE_DAYS) {
    throw new AppError(400, 'The requested calendar range is too wide.');
  }
  return { from: start, to: end };
}

async function loadTeacherRecord(userId) {
  return db.get('SELECT id FROM teachers WHERE user_id = ?', [userId]);
}

async function loadStudentRecord(userId) {
  return db.get(
    `SELECT s.id, se.class_id, c.name AS class_name
     FROM students s
     LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
     LEFT JOIN classes c ON c.id = se.class_id
     WHERE s.user_id = ?
     ORDER BY se.id DESC
     LIMIT 1`,
    [userId]
  );
}

function pushEvent(bucket, event) {
  const date = dateKeyOf(event.date);
  if (!date) return;
  bucket.push({
    id: String(event.id || `${event.kind}-${date}-${bucket.length}`),
    date,
    kind: event.kind,
    kindLabel: KIND_LABELS[event.kind] || 'Event',
    title: String(event.title || '').slice(0, 160),
    meta: String(event.meta || '').slice(0, 200),
    tone: event.tone || event.kind,
  });
}

async function superadminEvents(range) {
  const events = [];

  const coursework = await db.query(
    `SELECT ci.id, ci.title, ci.due_at, ci.work_type,
            sub.code AS subject_code, sub.name AS subject_name
     FROM coursework_items ci
     INNER JOIN subjects sub ON sub.id = ci.subject_id
     WHERE ci.status = 'published'
       AND ci.due_at IS NOT NULL AND ci.due_at <> ''
       AND ci.due_at >= ? AND ci.due_at <= ?
     ORDER BY ci.due_at ASC
     LIMIT 200`,
    [range.from, `${range.to}T23:59:59`]
  );
  coursework.forEach((row) =>
    pushEvent(events, {
      id: `cw-${row.id}`,
      date: row.due_at,
      kind: 'coursework',
      title: row.title,
      meta: `${row.subject_name || 'Subject'} - ${String(row.work_type || 'work')}`,
    })
  );

  const announcements = await db.query(
    `SELECT id, title, publish_at, audience
     FROM announcements
     WHERE status = 'published' AND publish_at >= ? AND publish_at <= ?
     ORDER BY publish_at ASC
     LIMIT 200`,
    [range.from, `${range.to}T23:59:59`]
  );
  announcements.forEach((row) =>
    pushEvent(events, {
      id: `ann-${row.id}`,
      date: row.publish_at,
      kind: 'announcement',
      title: row.title,
      meta: `Audience: ${String(row.audience || 'all')}`,
    })
  );

  const fees = await db.query(
    `SELECT due_date AS d, COUNT(*) AS total,
            SUM(CASE WHEN amount_due - discount_amount - amount_paid > 0
                     THEN amount_due - discount_amount - amount_paid ELSE 0 END) AS outstanding
     FROM fee_assignments
     WHERE due_date IS NOT NULL AND due_date <> ''
       AND due_date >= ? AND due_date <= ?
       AND status <> 'paid'
     GROUP BY due_date
     ORDER BY due_date ASC`,
    [range.from, range.to]
  );
  fees.forEach((row) =>
    pushEvent(events, {
      id: `fee-${row.d}`,
      date: row.d,
      kind: 'fee',
      title: `${row.total} fee ${Number(row.total) === 1 ? 'bill' : 'bills'} due`,
      meta: `Outstanding: ${Number(row.outstanding || 0).toFixed(2)}`,
    })
  );

  const payments = await db.query(
    `SELECT payment_date AS d, COUNT(*) AS total, SUM(amount) AS amount
     FROM payments
     WHERE status = 'completed' AND payment_date >= ? AND payment_date <= ?
     GROUP BY payment_date
     ORDER BY payment_date ASC`,
    [range.from, range.to]
  );
  payments.forEach((row) =>
    pushEvent(events, {
      id: `pay-${row.d}`,
      date: row.d,
      kind: 'payment',
      title: `${row.total} ${Number(row.total) === 1 ? 'payment' : 'payments'} received`,
      meta: `Collected: ${Number(row.amount || 0).toFixed(2)}`,
    })
  );

  return events;
}

async function teacherEvents(user, range) {
  const teacher = await loadTeacherRecord(user.id);
  if (!teacher) return [];
  const events = [];

  const coursework = await db.query(
    `SELECT ci.id, ci.title, ci.due_at, ci.work_type,
            sub.code AS subject_code, sub.name AS subject_name
     FROM coursework_items ci
     INNER JOIN subjects sub ON sub.id = ci.subject_id
     WHERE ci.teacher_id = ?
       AND ci.due_at IS NOT NULL AND ci.due_at <> ''
       AND ci.due_at >= ? AND ci.due_at <= ?
     ORDER BY ci.due_at ASC
     LIMIT 200`,
    [teacher.id, range.from, `${range.to}T23:59:59`]
  );
  coursework.forEach((row) =>
    pushEvent(events, {
      id: `cw-${row.id}`,
      date: row.due_at,
      kind: 'coursework',
      title: row.title,
      meta: `${row.subject_name || 'Subject'} - ${String(row.work_type || 'work')}`,
    })
  );

  const announcements = await db.query(
    `SELECT id, title, publish_at
     FROM announcements
     WHERE author_user_id = ? AND publish_at >= ? AND publish_at <= ?
     ORDER BY publish_at ASC
     LIMIT 200`,
    [user.id, range.from, `${range.to}T23:59:59`]
  );
  announcements.forEach((row) =>
    pushEvent(events, {
      id: `ann-${row.id}`,
      date: row.publish_at,
      kind: 'announcement',
      title: row.title,
      meta: 'Your class announcement',
    })
  );

  return events;
}

async function studentEvents(user, range) {
  const student = await loadStudentRecord(user.id);
  if (!student) return [];
  const events = [];

  if (student.class_id) {
    const coursework = await db.query(
      `SELECT ci.id, ci.title, ci.due_at, ci.work_type,
              sub.code AS subject_code, sub.name AS subject_name,
              cs.status AS submission_status
       FROM coursework_items ci
       INNER JOIN subjects sub ON sub.id = ci.subject_id
       INNER JOIN coursework_classes cc ON cc.coursework_id = ci.id
       LEFT JOIN coursework_submissions cs
         ON cs.coursework_id = ci.id AND cs.student_id = ?
       WHERE ci.status = 'published'
         AND cc.class_id = ?
         AND ci.due_at IS NOT NULL AND ci.due_at <> ''
         AND ci.due_at >= ? AND ci.due_at <= ?
       ORDER BY ci.due_at ASC
       LIMIT 200`,
      [student.id, student.class_id, range.from, `${range.to}T23:59:59`]
    );
    coursework.forEach((row) =>
      pushEvent(events, {
        id: `cw-${row.id}`,
        date: row.due_at,
        kind: 'coursework',
        tone: row.submission_status === 'submitted' || row.submission_status === 'graded'
          ? 'payment'
          : 'coursework',
        title: row.title,
        meta: row.submission_status
          ? `${row.subject_name || 'Subject'} - ${row.submission_status}`
          : `${row.subject_name || 'Subject'} - not submitted`,
      })
    );

    const announcements = await db.query(
      `SELECT a.id, a.title, a.publish_at
       FROM announcements a
       WHERE a.status = 'published'
         AND (
           a.audience IN ('all', 'students')
           OR (
             a.audience = 'class'
             AND EXISTS (
               SELECT 1 FROM announcement_classes ac
               WHERE ac.announcement_id = a.id AND ac.class_id = ?
             )
           )
         )
         AND a.publish_at >= ? AND a.publish_at <= ?
       ORDER BY a.publish_at ASC
       LIMIT 200`,
      [student.class_id, range.from, `${range.to}T23:59:59`]
    );
    announcements.forEach((row) =>
      pushEvent(events, {
        id: `ann-${row.id}`,
        date: row.publish_at,
        kind: 'announcement',
        title: row.title,
        meta: 'School announcement',
      })
    );
  }

  const fees = await db.query(
    `SELECT fa.id, fa.due_date AS d, fa.amount_due, fa.discount_amount, fa.amount_paid,
            fc.name AS category_name
     FROM fee_assignments fa
     INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
     WHERE fa.student_id = ?
       AND fa.due_date IS NOT NULL AND fa.due_date <> ''
       AND fa.due_date >= ? AND fa.due_date <= ?
       AND fa.status <> 'paid'
     ORDER BY fa.due_date ASC
     LIMIT 100`,
    [student.id, range.from, range.to]
  );
  fees.forEach((row) => {
    const balance = Number(row.amount_due || 0) - Number(row.discount_amount || 0) - Number(row.amount_paid || 0);
    pushEvent(events, {
      id: `fee-${row.id}`,
      date: row.d,
      kind: 'fee',
      title: `${row.category_name || 'Fee'} due`,
      meta: balance > 0 ? `Balance: ${balance.toFixed(2)}` : 'Settled',
    });
  });

  return events;
}

async function financialEvents(range) {
  const events = [];

  const fees = await db.query(
    `SELECT due_date AS d, COUNT(*) AS total,
            SUM(CASE WHEN amount_due - discount_amount - amount_paid > 0
                     THEN amount_due - discount_amount - amount_paid ELSE 0 END) AS outstanding
     FROM fee_assignments
     WHERE due_date IS NOT NULL AND due_date <> ''
       AND due_date >= ? AND due_date <= ?
       AND status <> 'paid'
     GROUP BY due_date
     ORDER BY due_date ASC`,
    [range.from, range.to]
  );
  fees.forEach((row) =>
    pushEvent(events, {
      id: `fee-${row.d}`,
      date: row.d,
      kind: 'fee',
      title: `${row.total} fee ${Number(row.total) === 1 ? 'bill' : 'bills'} due`,
      meta: `Outstanding: ${Number(row.outstanding || 0).toFixed(2)}`,
    })
  );

  const payments = await db.query(
    `SELECT payment_date AS d, COUNT(*) AS total, SUM(amount) AS amount
     FROM payments
     WHERE status = 'completed' AND payment_date >= ? AND payment_date <= ?
     GROUP BY payment_date
     ORDER BY payment_date ASC`,
    [range.from, range.to]
  );
  payments.forEach((row) =>
    pushEvent(events, {
      id: `pay-${row.d}`,
      date: row.d,
      kind: 'payment',
      title: `${row.total} ${Number(row.total) === 1 ? 'payment' : 'payments'} received`,
      meta: `Collected: ${Number(row.amount || 0).toFixed(2)}`,
    })
  );

  return events;
}

async function getCalendarEvents(user, query = {}) {
  const range = normaliseRange(query.from, query.to);
  let events = [];

  if (user.role === 'superadmin') {
    events = await superadminEvents(range);
  } else if (user.role === 'teacher') {
    events = await teacherEvents(user, range);
  } else if (user.role === 'student') {
    events = await studentEvents(user, range);
  } else if (user.role === 'financial') {
    events = await financialEvents(range);
  }

  const byDate = new Map();
  events.forEach((ev) => {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  });

  const days = Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, items]) => ({ date, count: items.length, items }));

  return {
    ok: true,
    role: user.role,
    range,
    today: new Date().toISOString().slice(0, 10),
    events,
    days,
  };
}

module.exports = { getCalendarEvents };
