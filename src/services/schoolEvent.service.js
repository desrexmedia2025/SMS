const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('./audit.service');

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const EVENT_TYPES = ['holiday', 'meeting', 'exam', 'sports', 'other'];

const TYPE_LABELS = {
  holiday: 'Holiday',
  meeting: 'PTA Meeting',
  exam: 'Exam Week',
  sports: 'Sports Day',
  other: 'School Event',
};

const TYPE_COLORS = {
  holiday: '#0ea5e9',
  meeting: '#7c3aed',
  exam: '#dc2626',
  sports: '#059669',
  other: '#f59e0b',
};

const AUDIENCES = ['all', 'teachers', 'students', 'staff'];

const AUDIENCE_LABELS = {
  all: 'Everyone',
  teachers: 'Teachers only',
  students: 'Students only',
  staff: 'Staff only (teachers & finance)',
};

// Which audiences each dashboard role is allowed to see
const VISIBLE_AUDIENCES = {
  superadmin: ['all', 'teachers', 'students', 'staff'],
  teacher: ['all', 'teachers', 'staff'],
  student: ['all', 'students'],
  financial: ['all', 'staff'],
};

function requireDateKey(value, fieldName) {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!DATE_KEY_RE.test(raw)) {
    throw new AppError(400, `${fieldName} must be a valid date (YYYY-MM-DD).`);
  }
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new AppError(400, `${fieldName} must be a valid date (YYYY-MM-DD).`);
  }
  return raw;
}

function cleanTitle(value) {
  const title = String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (title.length < 3) throw new AppError(400, 'Event title must be at least 3 characters long.');
  return title.slice(0, 160);
}

function cleanDescription(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 500);
}

function cleanColor(value, eventType) {
  const raw = String(value ?? '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : '';
  return hex || TYPE_COLORS[eventType] || TYPE_COLORS.other;
}

function cleanType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return EVENT_TYPES.includes(type) ? type : 'other';
}

function cleanAudience(value) {
  const audience = String(value ?? '').trim().toLowerCase();
  return AUDIENCES.includes(audience) ? audience : 'all';
}

function normaliseEvent(row) {
  if (!row) return row;
  const start = String(row.start_date || '').slice(0, 10);
  const end = String(row.end_date || '').slice(0, 10);
  return {
    ...row,
    id: Number(row.id),
    start_date: start,
    end_date: end || start,
    event_type: cleanType(row.event_type),
    event_type_label: TYPE_LABELS[cleanType(row.event_type)] || TYPE_LABELS.other,
    audience: cleanAudience(row.audience),
    audience_label: AUDIENCE_LABELS[cleanAudience(row.audience)] || AUDIENCE_LABELS.all,
    color: cleanColor(row.color, cleanType(row.event_type)),
    multi_day: Boolean(start && end && start !== end),
  };
}

async function listSchoolEvents({ from = '', to = '' } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (from) {
    where += ' AND end_date >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND start_date <= ?';
    params.push(to);
  }
  const rows = await db.query(
    `SELECT se.*, u.full_name AS created_by_name
     FROM school_events se
     LEFT JOIN users u ON u.id = se.created_by_user_id
     ${where}
     ORDER BY se.start_date ASC, se.id ASC
     LIMIT 500`,
    params
  );
  return { items: rows.map(normaliseEvent), types: EVENT_TYPES, audiences: AUDIENCES };
}

async function createSchoolEvent({
  title,
  description,
  eventType,
  startDate,
  endDate,
  color,
  audience,
  actor,
  ipAddress,
}) {
  const cleanTitleValue = cleanTitle(title);
  const type = cleanType(eventType);
  const start = requireDateKey(startDate, 'Start date');
  const end = requireDateKey(endDate || startDate, 'End date');
  if (end < start) throw new AppError(400, 'The end date cannot be before the start date.');
  const resolvedColor = cleanColor(color, type);
  const resolvedAudience = cleanAudience(audience);
  const cleanDesc = cleanDescription(description);

  const insert = await db.run(
    `INSERT INTO school_events
       (title, description, event_type, start_date, end_date, color, audience, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [cleanTitleValue, cleanDesc, type, start, end, resolvedColor, resolvedAudience, actor.id]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'SCHOOL_EVENT_CREATED',
    targetType: 'school_event',
    targetId: String(insert.insertId),
    ipAddress,
    metadata: { title: cleanTitleValue, eventType: type, start, end },
  });

  const row = await db.get('SELECT * FROM school_events WHERE id = ?', [insert.insertId]);
  return { event: normaliseEvent(row), message: 'School event added to every dashboard calendar.' };
}

async function updateSchoolEvent({
  eventId,
  title,
  description,
  eventType,
  startDate,
  endDate,
  color,
  audience,
  actor,
  ipAddress,
}) {
  const existing = await db.get('SELECT * FROM school_events WHERE id = ?', [eventId]);
  if (!existing) throw new AppError(404, 'School event not found.');

  const nextTitle = title === undefined ? existing.title : cleanTitle(title);
  const nextType = eventType === undefined ? existing.event_type : cleanType(eventType);
  const start = startDate === undefined ? String(existing.start_date).slice(0, 10) : requireDateKey(startDate, 'Start date');
  const end =
    endDate === undefined
      ? String(existing.end_date).slice(0, 10) || start
      : requireDateKey(endDate || startDate, 'End date');
  if (end < start) throw new AppError(400, 'The end date cannot be before the start date.');
  const nextColor = color === undefined ? existing.color : cleanColor(color, nextType);
  const nextAudience = audience === undefined ? existing.audience : cleanAudience(audience);
  const nextDescription = description === undefined ? existing.description : cleanDescription(description);

  await db.run(
    `UPDATE school_events
     SET title = ?, description = ?, event_type = ?, start_date = ?, end_date = ?,
         color = ?, audience = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextTitle, nextDescription, nextType, start, end, nextColor, nextAudience, eventId]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'SCHOOL_EVENT_UPDATED',
    targetType: 'school_event',
    targetId: String(eventId),
    ipAddress,
    metadata: { title: nextTitle, eventType: nextType, start, end },
  });

  const row = await db.get('SELECT * FROM school_events WHERE id = ?', [eventId]);
  return { event: normaliseEvent(row), message: 'School event updated.' };
}

async function deleteSchoolEvent({ eventId, actor, ipAddress }) {
  const existing = await db.get('SELECT * FROM school_events WHERE id = ?', [eventId]);
  if (!existing) throw new AppError(404, 'School event not found.');
  await db.run('DELETE FROM school_events WHERE id = ?', [eventId]);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'SCHOOL_EVENT_DELETED',
    targetType: 'school_event',
    targetId: String(eventId),
    ipAddress,
    metadata: { title: existing.title },
  });
  return { message: 'School event removed from the calendars.' };
}

// Builds the per-day calendar entries a given role may see inside [range.from, range.to]
async function getSchoolEventsForRole(role, range) {
  const audiences = VISIBLE_AUDIENCES[role] || ['all'];
  const placeholders = audiences.map(() => '?').join(', ');
  const rows = await db.query(
    `SELECT *
     FROM school_events
     WHERE audience IN (${placeholders})
       AND end_date >= ? AND start_date <= ?
     ORDER BY start_date ASC, id ASC
     LIMIT 200`,
    [...audiences, range.from, range.to]
  );

  const events = [];
  const cursorLimit = 400; // safety cap on expanded multi-day entries
  rows.forEach((row) => {
    const event = normaliseEvent(row);
    const start = event.start_date;
    const end = event.end_date;
    if (!start) return;
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end || start}T00:00:00Z`);
    let guard = 0;
    while (cursor <= last && guard < cursorLimit) {
      const key = cursor.toISOString().slice(0, 10);
      if (key >= range.from && key <= range.to) {
        events.push({
          id: `school-${event.id}-${key}`,
          date: key,
          kind: 'school_event',
          kindLabel: event.event_type_label,
          title: event.title,
          meta:
            start === end
              ? event.event_type_label
              : `${event.event_type_label} (day ${guard + 1})`,
          tone: 'school_event',
          color: event.color,
          schoolEventId: event.id,
          audience: event.audience,
          description: event.description || '',
          start_date: start,
          end_date: end,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard += 1;
    }
  });
  return events;
}

module.exports = {
  EVENT_TYPES,
  AUDIENCES,
  TYPE_LABELS,
  TYPE_COLORS,
  listSchoolEvents,
  createSchoolEvent,
  updateSchoolEvent,
  deleteSchoolEvent,
  getSchoolEventsForRole,
};
