const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const systemModel = require('../models/system.model');
const { resolveUploadsDir, cleanupUploadedFiles } = require('../config/upload');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

const VALID_WORK_TYPES = new Set(['classwork', 'homework', 'test', 'exam']);

function parseIdArray(raw) {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseIdArray(parsed);
      } catch (_) {
        // fallback to comma split
      }
    }
    return Array.from(
      new Set(
        trimmed
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
  }
  const single = Number(raw);
  if (Number.isInteger(single) && single > 0) return [single];
  return [];
}

function isTruthyFlag(val) {
  return val === true || val === 1 || val === '1' || val === 'true' || val === 'on' || val === 'all';
}

function formatAttachmentDto(row) {
  return {
    id: Number(row.id),
    ownerType: row.owner_type,
    ownerId: Number(row.owner_id),
    originalName: row.original_name,
    mimeType: row.mime_type,
    mediaKind: row.media_kind,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at,
    url: `/api/media/${row.id}`,
    downloadUrl: `/api/media/${row.id}?download=1`,
  };
}

async function requireTeacherRecord(user) {
  const teacher = await db.get(
    `SELECT t.*, u.full_name, u.email
     FROM teachers t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.user_id = ?`,
    [user.id]
  );
  if (!teacher) {
    throw new AppError(403, 'No active teacher staff record is linked to your account.');
  }
  return teacher;
}

async function requireStudentRecord(user) {
  const student = await db.get(
    `SELECT
       s.*,
       se.class_id,
       se.academic_year_id,
       se.term_id,
       c.name AS class_name
     FROM students s
     LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.status IN ('enrolled', 'active')
     LEFT JOIN classes c ON c.id = se.class_id
     WHERE s.user_id = ?
     ORDER BY se.id DESC
     LIMIT 1`,
    [user.id]
  );
  if (!student) {
    throw new AppError(403, 'No active student profile is linked to your account.');
  }
  return student;
}

async function getTeacherAssignedClassesAndSubjects(teacherId) {
  const [assignmentRows, regSubjectRows] = await Promise.all([
    db.query(
      `SELECT DISTINCT
         ta.class_id,
         c.name AS class_name,
         c.level_order,
         ta.subject_id,
         sub.code AS subject_code,
         sub.name AS subject_name
       FROM teacher_assignments ta
       INNER JOIN classes c ON c.id = ta.class_id
       INNER JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.teacher_id = ?
       ORDER BY c.level_order ASC, c.name ASC, sub.code ASC`,
      [teacherId]
    ),
    db.query(
      `SELECT s.id AS subject_id, s.code AS subject_code, s.name AS subject_name
       FROM teacher_subjects ts
       INNER JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = ?
       ORDER BY s.code ASC`,
      [teacherId]
    ),
  ]);

  const classMap = new Map();
  const subjectMap = new Map();
  for (const r of assignmentRows) {
    classMap.set(Number(r.class_id), {
      id: Number(r.class_id),
      name: r.class_name,
    });
    subjectMap.set(Number(r.subject_id), {
      id: Number(r.subject_id),
      code: r.subject_code,
      name: r.subject_name,
    });
  }
  for (const rs of regSubjectRows) {
    if (!subjectMap.has(Number(rs.subject_id))) {
      subjectMap.set(Number(rs.subject_id), {
        id: Number(rs.subject_id),
        code: rs.subject_code,
        name: rs.subject_name,
      });
    }
  }

  return {
    assignedClasses: Array.from(classMap.values()),
    assignedClassIds: new Set(classMap.keys()),
    subjects: Array.from(subjectMap.values()),
    subjectIds: new Set(subjectMap.keys()),
  };
}

async function loadAttachmentsMap(ownerType, ownerIds = []) {
  const map = new Map();
  const cleanIds = Array.from(new Set(ownerIds.map((v) => Number(v)).filter(Boolean)));
  if (!cleanIds.length) return map;
  const ph = cleanIds.map(() => '?').join(', ');
  const rows = await db.query(
    `SELECT * FROM media_attachments
     WHERE owner_type = ? AND owner_id IN (${ph})
     ORDER BY id ASC`,
    [ownerType, ...cleanIds]
  );
  for (const row of rows) {
    const oid = Number(row.owner_id);
    if (!map.has(oid)) map.set(oid, []);
    map.get(oid).push(formatAttachmentDto(row));
  }
  return map;
}

// ---------------- TEACHER COURSEWORK (CLASSWORK, HOMEWORK, TEST, EXAM) ----------------
async function listTeacherCoursework(user, query = {}) {
  const teacher = await requireTeacherRecord(user);
  const params = [teacher.id];
  let whereExtra = '';

  if (query.workType && VALID_WORK_TYPES.has(String(query.workType).toLowerCase())) {
    whereExtra += ' AND ci.work_type = ?';
    params.push(String(query.workType).toLowerCase());
  }
  if (query.classId && Number(query.classId) > 0) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM coursework_classes cc WHERE cc.coursework_id = ci.id AND cc.class_id = ?)';
    params.push(Number(query.classId));
  }

  const items = await db.query(
    `SELECT
       ci.*,
       sub.code AS subject_code,
       sub.name AS subject_name,
       (SELECT COUNT(*) FROM coursework_submissions cs WHERE cs.coursework_id = ci.id) AS submitted_count,
       (SELECT COUNT(*) FROM coursework_submissions cs WHERE cs.coursework_id = ci.id AND cs.status = 'graded') AS graded_count
     FROM coursework_items ci
     INNER JOIN subjects sub ON sub.id = ci.subject_id
     WHERE ci.teacher_id = ? ${whereExtra}
     ORDER BY ci.id DESC`,
    params
  );

  if (!items.length) return { items: [] };

  const cwIds = items.map((i) => Number(i.id));
  const ph = cwIds.map(() => '?').join(', ');
  const [classRows, attachmentsByCw] = await Promise.all([
    db.query(
      `SELECT cc.coursework_id, c.id AS class_id, c.name AS class_name
       FROM coursework_classes cc
       INNER JOIN classes c ON c.id = cc.class_id
       WHERE cc.coursework_id IN (${ph})
       ORDER BY c.level_order ASC, c.name ASC`,
      cwIds
    ),
    loadAttachmentsMap('coursework', cwIds),
  ]);

  const classesByCw = new Map();
  for (const r of classRows) {
    const cid = Number(r.coursework_id);
    if (!classesByCw.has(cid)) classesByCw.set(cid, []);
    classesByCw.get(cid).push({ id: Number(r.class_id), name: r.class_name });
  }

  return {
    items: items.map((item) => ({
      ...item,
      max_score: Number(item.max_score),
      submitted_count: Number(item.submitted_count || 0),
      graded_count: Number(item.graded_count || 0),
      target_classes: classesByCw.get(Number(item.id)) || [],
      attachments: attachmentsByCw.get(Number(item.id)) || [],
    })),
  };
}

async function createCoursework(user, {
  workType,
  subjectId,
  classIds,
  applyToAllClasses,
  title,
  instructions,
  maxScore,
  dueAt,
  files = [],
  ipAddress,
}) {
  try {
    const teacher = await requireTeacherRecord(user);
    const { assignedClasses, assignedClassIds, subjects, subjectIds } =
      await getTeacherAssignedClassesAndSubjects(teacher.id);

    if (!assignedClasses.length) {
      throw new AppError(
        400,
        'You do not have any assigned classes yet. Ask the Superadmin to assign your classes first.'
      );
    }

    const normalizedType = String(workType || '').toLowerCase().trim();
    if (!VALID_WORK_TYPES.has(normalizedType)) {
      throw new AppError(400, 'Work type must be classwork, homework, test, or exam.');
    }

    const cleanTitle = String(title || '').trim();
    if (cleanTitle.length < 2 || cleanTitle.length > 200) {
      throw new AppError(400, 'Title must be between 2 and 200 characters.');
    }
    const cleanInstructions = String(instructions || '').trim();
    if (cleanInstructions.length < 2) {
      throw new AppError(400, 'Please provide instructions or questions for the learners.');
    }

    const numericMax = maxScore !== undefined && maxScore !== '' ? Number(maxScore) : 100;
    if (!Number.isFinite(numericMax) || numericMax <= 0 || numericMax > 1000) {
      throw new AppError(400, 'Maximum score must be between 1 and 1000.');
    }

    let resolvedSubjectId = Number(subjectId || 0);
    if (!resolvedSubjectId && subjects.length === 1) {
      resolvedSubjectId = subjects[0].id;
    }
    if (!resolvedSubjectId || !subjectIds.has(resolvedSubjectId)) {
      throw new AppError(400, 'Please select a valid subject from your taught subjects.');
    }

    let targetClassIds = [];
    if (isTruthyFlag(applyToAllClasses)) {
      targetClassIds = assignedClasses.map((c) => c.id);
    } else {
      targetClassIds = parseIdArray(classIds);
    }
    if (!targetClassIds.length) {
      throw new AppError(400, 'Please select at least one assigned class or choose All Assigned Classes.');
    }
    for (const cid of targetClassIds) {
      if (!assignedClassIds.has(cid)) {
        throw new AppError(403, 'You can only publish coursework to classes assigned to you.');
      }
    }

    const context = await systemModel.getSchoolContext();
    const cleanDueAt = dueAt ? String(dueAt).trim().slice(0, 40) : null;

    const created = await db.withTransaction(async (tx) => {
      const ins = await tx.run(
        `INSERT INTO coursework_items
           (teacher_id, subject_id, academic_year_id, term_id, work_type, title, instructions, max_score, due_at, status, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
        [
          teacher.id,
          resolvedSubjectId,
          context.activeYear?.id || null,
          context.activeTerm?.id || null,
          normalizedType,
          cleanTitle,
          cleanInstructions,
          numericMax,
          cleanDueAt,
          user.id,
        ]
      );

      for (const cid of targetClassIds) {
        await tx.run(
          'INSERT INTO coursework_classes (coursework_id, class_id) VALUES (?, ?)',
          [ins.insertId, cid]
        );
      }

      const savedAttachments = [];
      for (const file of files || []) {
        const attIns = await tx.run(
          `INSERT INTO media_attachments
             (owner_type, owner_id, uploaded_by_user_id, original_name, stored_name, mime_type, media_kind, size_bytes)
           VALUES ('coursework', ?, ?, ?, ?, ?, ?, ?)`,
          [
            ins.insertId,
            user.id,
            String(file.originalname || 'attachment').slice(0, 255),
            file.filename,
            file.safeMimeType || file.mimetype || 'application/octet-stream',
            file.mediaKind || 'document',
            Number(file.size || 0),
          ]
        );
        savedAttachments.push({
          id: attIns.insertId,
          originalName: file.originalname,
          mediaKind: file.mediaKind || 'document',
          url: `/api/media/${attIns.insertId}`,
        });
      }

      await recordAudit(
        {
          actorUserId: user.id,
          actorRole: user.role,
          action: 'COURSEWORK_PUBLISHED',
          targetType: 'coursework',
          targetId: String(ins.insertId),
          ipAddress,
          metadata: {
            workType: normalizedType,
            title: cleanTitle,
            subjectId: resolvedSubjectId,
            classIds: targetClassIds,
            attachmentsCount: savedAttachments.length,
          },
        },
        tx
      );

      return {
        id: ins.insertId,
        workType: normalizedType,
        title: cleanTitle,
        targetClassIds,
        attachments: savedAttachments,
      };
    });

    return created;
  } catch (err) {
    cleanupUploadedFiles(files);
    throw err;
  }
}

async function getCourseworkSubmissions(user, courseworkId) {
  const teacher = await requireTeacherRecord(user);
  const cw = await db.get(
    `SELECT ci.*, sub.code AS subject_code, sub.name AS subject_name
     FROM coursework_items ci
     INNER JOIN subjects sub ON sub.id = ci.subject_id
     WHERE ci.id = ?`,
    [courseworkId]
  );
  if (!cw) throw new AppError(404, 'Coursework item not found.');
  if (Number(cw.teacher_id) !== Number(teacher.id)) {
    throw new AppError(403, 'You do not have permission to view submissions for this coursework.');
  }

  const classRows = await db.query(
    `SELECT c.id, c.name
     FROM coursework_classes cc
     INNER JOIN classes c ON c.id = cc.class_id
     WHERE cc.coursework_id = ?
     ORDER BY c.level_order ASC, c.name ASC`,
    [courseworkId]
  );
  const classIds = classRows.map((c) => Number(c.id));

  let students = [];
  if (classIds.length) {
    const ph = classIds.map(() => '?').join(', ');
    students = await db.query(
      `SELECT
         s.id AS student_id,
         s.admission_number,
         s.first_name,
         s.last_name,
         c.id AS class_id,
         c.name AS class_name
       FROM student_enrolments se
       INNER JOIN students s ON s.id = se.student_id
       INNER JOIN classes c ON c.id = se.class_id
       WHERE se.status IN ('enrolled', 'active') AND s.status = 'active' AND se.class_id IN (${ph})
       ORDER BY c.level_order ASC, s.last_name ASC, s.first_name ASC`,
      classIds
    );
  }

  const subRows = await db.query(
    `SELECT
       cs.*,
       s.admission_number,
       s.first_name,
       s.last_name,
       c.name AS class_name
     FROM coursework_submissions cs
     INNER JOIN students s ON s.id = cs.student_id
     INNER JOIN classes c ON c.id = cs.class_id
     WHERE cs.coursework_id = ?
     ORDER BY cs.submitted_at DESC`,
    [courseworkId]
  );

  const [cwAttMap, subAttMap] = await Promise.all([
    loadAttachmentsMap('coursework', [courseworkId]),
    loadAttachmentsMap('submission', subRows.map((r) => r.id)),
  ]);

  const subByStudent = new Map();
  for (const r of subRows) {
    subByStudent.set(Number(r.student_id), {
      id: Number(r.id),
      studentId: Number(r.student_id),
      admissionNumber: r.admission_number,
      firstName: r.first_name,
      lastName: r.last_name,
      classId: Number(r.class_id),
      className: r.class_name,
      answerText: r.answer_text || '',
      status: r.status,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      feedback: r.feedback || '',
      submittedAt: r.submitted_at,
      gradedAt: r.graded_at,
      attachments: subAttMap.get(Number(r.id)) || [],
    });
  }

  // Merge enrolled learners + any submission rows so teachers see both who submitted and who hasn't yet
  const seenStudentIds = new Set();
  const rosterSubmissions = [];
  for (const stu of students) {
    const sid = Number(stu.student_id);
    seenStudentIds.add(sid);
    const existing = subByStudent.get(sid);
    rosterSubmissions.push({
      studentId: sid,
      admissionNumber: stu.admission_number,
      firstName: stu.first_name,
      lastName: stu.last_name,
      classId: Number(stu.class_id),
      className: stu.class_name,
      submitted: Boolean(existing),
      submission: existing || null,
    });
  }
  for (const [sid, sub] of subByStudent.entries()) {
    if (!seenStudentIds.has(sid)) {
      rosterSubmissions.push({
        studentId: sid,
        admissionNumber: sub.admissionNumber,
        firstName: sub.firstName,
        lastName: sub.lastName,
        classId: sub.classId,
        className: sub.className,
        submitted: true,
        submission: sub,
      });
    }
  }

  return {
    coursework: {
      ...cw,
      max_score: Number(cw.max_score),
      target_classes: classRows,
      attachments: cwAttMap.get(Number(courseworkId)) || [],
    },
    learners: rosterSubmissions,
  };
}

async function gradeSubmission(user, { submissionId, score, feedback, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  const sub = await db.get(
    `SELECT cs.*, ci.teacher_id, ci.max_score, ci.title AS coursework_title
     FROM coursework_submissions cs
     INNER JOIN coursework_items ci ON ci.id = cs.coursework_id
     WHERE cs.id = ?`,
    [submissionId]
  );
  if (!sub) throw new AppError(404, 'Student submission not found.');
  if (Number(sub.teacher_id) !== Number(teacher.id)) {
    throw new AppError(403, 'You can only grade submissions for your own coursework.');
  }

  const numScore = Number(score);
  const maxScore = Number(sub.max_score);
  if (!Number.isFinite(numScore) || numScore < 0 || numScore > maxScore) {
    throw new AppError(400, `Score must be between 0 and ${maxScore}.`);
  }

  const cleanFeedback = String(feedback || '').trim().slice(0, 1000);
  await db.run(
    `UPDATE coursework_submissions
     SET score = ?, feedback = ?, status = 'graded', graded_by_user_id = ?, graded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [numScore, cleanFeedback, user.id, submissionId]
  );

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'COURSEWORK_SUBMISSION_GRADED',
    targetType: 'coursework_submission',
    targetId: String(submissionId),
    ipAddress,
    metadata: { courseworkId: sub.coursework_id, studentId: sub.student_id, score: numScore },
  });

  return { id: Number(submissionId), score: numScore, feedback: cleanFeedback, status: 'graded' };
}

async function deleteCoursework(user, { courseworkId, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  const cw = await db.get('SELECT * FROM coursework_items WHERE id = ?', [courseworkId]);
  if (!cw) throw new AppError(404, 'Coursework item not found.');
  if (Number(cw.teacher_id) !== Number(teacher.id) && user.role !== 'superadmin') {
    throw new AppError(403, 'You can only delete coursework created by you.');
  }

  const subRows = await db.query('SELECT id FROM coursework_submissions WHERE coursework_id = ?', [
    courseworkId,
  ]);
  const subIds = subRows.map((s) => Number(s.id));
  const attRows = await db.query(
    `SELECT * FROM media_attachments
     WHERE (owner_type = 'coursework' AND owner_id = ?)
        ${subIds.length ? `OR (owner_type = 'submission' AND owner_id IN (${subIds.map(() => '?').join(', ')}))` : ''}`,
    [courseworkId, ...subIds]
  );

  await db.withTransaction(async (tx) => {
    if (attRows.length) {
      const attIds = attRows.map((a) => Number(a.id));
      await tx.run(
        `DELETE FROM media_attachments WHERE id IN (${attIds.map(() => '?').join(', ')})`,
        attIds
      );
    }
    await tx.run('DELETE FROM coursework_items WHERE id = ?', [courseworkId]);
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'COURSEWORK_DELETED',
        targetType: 'coursework',
        targetId: String(courseworkId),
        ipAddress,
        metadata: { title: cw.title, workType: cw.work_type },
      },
      tx
    );
  });

  const dir = resolveUploadsDir();
  for (const att of attRows) {
    try {
      fs.unlinkSync(path.join(dir, path.basename(att.stored_name)));
    } catch (_) {
      // ignore missing file
    }
  }
}

// ---------------- TEACHER CLASS ANNOUNCEMENTS ----------------
async function createTeacherClassAnnouncement(user, {
  title,
  body,
  priority,
  classIds,
  applyToAllClasses,
  ipAddress,
}) {
  const teacher = await requireTeacherRecord(user);
  const { assignedClasses, assignedClassIds } = await getTeacherAssignedClassesAndSubjects(teacher.id);

  if (!assignedClasses.length) {
    throw new AppError(
      400,
      'You do not have any assigned classes yet. Ask the Superadmin to assign your classes first.'
    );
  }

  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();
  if (cleanTitle.length < 3 || cleanTitle.length > 180) {
    throw new AppError(400, 'Announcement title must be between 3 and 180 characters.');
  }
  if (cleanBody.length < 3) {
    throw new AppError(400, 'Announcement message must be at least 3 characters.');
  }

  const allowedPriorities = new Set(['normal', 'important', 'urgent']);
  const resolvedPriority = allowedPriorities.has(String(priority || '').toLowerCase())
    ? String(priority).toLowerCase()
    : 'normal';

  let targetClassIds = [];
  if (isTruthyFlag(applyToAllClasses)) {
    targetClassIds = assignedClasses.map((c) => c.id);
  } else {
    targetClassIds = parseIdArray(classIds);
  }
  if (!targetClassIds.length) {
    throw new AppError(400, 'Please select at least one assigned class or choose All Assigned Classes.');
  }
  for (const cid of targetClassIds) {
    if (!assignedClassIds.has(cid)) {
      throw new AppError(403, 'You can only send announcements to classes assigned to you.');
    }
  }

  return db.withTransaction(async (tx) => {
    const ins = await tx.run(
      `INSERT INTO announcements (title, body, audience, priority, author_user_id, status)
       VALUES (?, ?, 'class', ?, ?, 'published')`,
      [cleanTitle, cleanBody, resolvedPriority, user.id]
    );
    for (const cid of targetClassIds) {
      await tx.run('INSERT INTO announcement_classes (announcement_id, class_id) VALUES (?, ?)', [
        ins.insertId,
        cid,
      ]);
    }
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'TEACHER_CLASS_ANNOUNCEMENT_PUBLISHED',
        targetType: 'announcement',
        targetId: String(ins.insertId),
        ipAddress,
        metadata: { title: cleanTitle, classIds: targetClassIds, priority: resolvedPriority },
      },
      tx
    );
    return {
      id: ins.insertId,
      targetClassIds,
    };
  });
}

async function deleteTeacherClassAnnouncement(user, { announcementId, ipAddress }) {
  await requireTeacherRecord(user);
  const ann = await db.get('SELECT * FROM announcements WHERE id = ?', [announcementId]);
  if (!ann) throw new AppError(404, 'Announcement not found.');
  if (Number(ann.author_user_id) !== Number(user.id)) {
    throw new AppError(403, 'You can only delete announcements created by you.');
  }
  await db.withTransaction(async (tx) => {
    await tx.run('DELETE FROM announcement_classes WHERE announcement_id = ?', [announcementId]);
    await tx.run('DELETE FROM announcements WHERE id = ?', [announcementId]);
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'TEACHER_CLASS_ANNOUNCEMENT_DELETED',
        targetType: 'announcement',
        targetId: String(announcementId),
        ipAddress,
      },
      tx
    );
  });
  return { deleted: true };
}

// ---------------- STUDENT COURSEWORK & ANSWER SUBMISSION ----------------
async function listStudentCoursework(user, query = {}) {
  const student = await requireStudentRecord(user);
  if (!student.class_id) {
    return { items: [] };
  }

  const params = [student.class_id];
  let extra = '';
  if (query.workType && VALID_WORK_TYPES.has(String(query.workType).toLowerCase())) {
    extra += ' AND ci.work_type = ?';
    params.push(String(query.workType).toLowerCase());
  }

  const items = await db.query(
    `SELECT
       ci.*,
       sub.code AS subject_code,
       sub.name AS subject_name,
       u.full_name AS teacher_name
     FROM coursework_items ci
     INNER JOIN subjects sub ON sub.id = ci.subject_id
     INNER JOIN teachers t ON t.id = ci.teacher_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE ci.status = 'published'
       AND EXISTS (
         SELECT 1 FROM coursework_classes cc
         WHERE cc.coursework_id = ci.id AND cc.class_id = ?
       )
       ${extra}
     ORDER BY ci.id DESC`,
    params
  );

  if (!items.length) return { items: [] };

  const cwIds = items.map((i) => Number(i.id));
  const ph = cwIds.map(() => '?').join(', ');

  const [cwAttMap, mySubs] = await Promise.all([
    loadAttachmentsMap('coursework', cwIds),
    db.query(
      `SELECT * FROM coursework_submissions
       WHERE student_id = ? AND coursework_id IN (${ph})`,
      [student.id, ...cwIds]
    ),
  ]);

  const subAttMap = await loadAttachmentsMap(
    'submission',
    mySubs.map((s) => s.id)
  );
  const subByCw = new Map();
  for (const s of mySubs) {
    subByCw.set(Number(s.coursework_id), {
      id: Number(s.id),
      answerText: s.answer_text || '',
      status: s.status,
      score: s.score !== null && s.score !== undefined ? Number(s.score) : null,
      feedback: s.feedback || '',
      submittedAt: s.submitted_at,
      gradedAt: s.graded_at,
      attachments: subAttMap.get(Number(s.id)) || [],
    });
  }

  return {
    items: items.map((item) => {
      const subObj = subByCw.get(Number(item.id)) || null;
      return {
        ...item,
        max_score: Number(item.max_score),
        attachments: cwAttMap.get(Number(item.id)) || [],
        submission: subObj,
        mySubmission: subObj,
      };
    }),
  };
}

async function submitStudentCoursework(user, { courseworkId, answerText, files = [], ipAddress }) {
  try {
    const student = await requireStudentRecord(user);
    if (!student.class_id) {
      throw new AppError(400, 'You are not assigned to an active class yet.');
    }

    const cw = await db.get(
      `SELECT ci.*
       FROM coursework_items ci
       WHERE ci.id = ?
         AND ci.status = 'published'
         AND EXISTS (
           SELECT 1 FROM coursework_classes cc
           WHERE cc.coursework_id = ci.id AND cc.class_id = ?
         )`,
      [courseworkId, student.class_id]
    );
    if (!cw) {
      throw new AppError(403, 'This coursework item is not assigned to your class.');
    }

    const existingSub = await db.get(
      'SELECT * FROM coursework_submissions WHERE coursework_id = ? AND student_id = ?',
      [courseworkId, student.id]
    );
    if (existingSub && existingSub.status === 'graded') {
      throw new AppError(
        403,
        'Your submission has already been graded by your teacher and is locked.'
      );
    }

    const cleanAnswer = String(answerText ?? '').trim();
    const existingAttCount = existingSub
      ? Number(
          (
            await db.get(
              "SELECT COUNT(*) AS cnt FROM media_attachments WHERE owner_type = 'submission' AND owner_id = ?",
              [existingSub.id]
            )
          )?.cnt || 0
        )
      : 0;

    if (!cleanAnswer && (!files || files.length === 0) && existingAttCount === 0) {
      throw new AppError(
        400,
        'Please write an answer or upload at least one image, document, or video before submitting.'
      );
    }

    const saved = await db.withTransaction(async (tx) => {
      let submissionId;
      if (existingSub) {
        submissionId = Number(existingSub.id);
        await tx.run(
          `UPDATE coursework_submissions
           SET answer_text = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [cleanAnswer, submissionId]
        );
      } else {
        const ins = await tx.run(
          `INSERT INTO coursework_submissions
             (coursework_id, student_id, class_id, answer_text, status)
           VALUES (?, ?, ?, ?, 'submitted')`,
          [courseworkId, student.id, student.class_id, cleanAnswer]
        );
        submissionId = Number(ins.insertId);
      }

      for (const file of files || []) {
        await tx.run(
          `INSERT INTO media_attachments
             (owner_type, owner_id, uploaded_by_user_id, original_name, stored_name, mime_type, media_kind, size_bytes)
           VALUES ('submission', ?, ?, ?, ?, ?, ?, ?)`,
          [
            submissionId,
            user.id,
            String(file.originalname || 'submission_file').slice(0, 255),
            file.filename,
            file.safeMimeType || file.mimetype || 'application/octet-stream',
            file.mediaKind || 'document',
            Number(file.size || 0),
          ]
        );
      }

      await recordAudit(
        {
          actorUserId: user.id,
          actorRole: user.role,
          action: 'COURSEWORK_SUBMITTED',
          targetType: 'coursework_submission',
          targetId: String(submissionId),
          ipAddress,
          metadata: {
            courseworkId: Number(courseworkId),
            filesUploaded: (files || []).length,
          },
        },
        tx
      );

      return submissionId;
    });

    const attMap = await loadAttachmentsMap('submission', [saved]);
    return {
      submissionId: saved,
      status: 'submitted',
      answerText: cleanAnswer,
      attachments: attMap.get(saved) || [],
    };
  } catch (err) {
    cleanupUploadedFiles(files);
    throw err;
  }
}

// ---------------- AUTHENTICATED MEDIA AUTHORIZATION & STREAMING ----------------
async function getAuthorizedMediaAttachment(user, attachmentId) {
  const att = await db.get('SELECT * FROM media_attachments WHERE id = ?', [attachmentId]);
  if (!att) throw new AppError(404, 'Media attachment not found.');

  if (user.role === 'superadmin') {
    return att;
  }

  // Message attachments: only participants of the owning conversation may stream them
  if (att.owner_type === 'message') {
    const message = await db.get('SELECT id, thread_id FROM messages WHERE id = ?', [att.owner_id]);
    const messagingService = require('./messaging.service');
    if (message && (await messagingService.isThreadParticipant(user.id, message.thread_id))) {
      return att;
    }
    throw new AppError(403, 'You do not have permission to access this file.');
  }

  if (user.role === 'teacher') {
    const teacher = await requireTeacherRecord(user);
    if (att.owner_type === 'coursework') {
      const cw = await db.get('SELECT id, teacher_id FROM coursework_items WHERE id = ?', [
        att.owner_id,
      ]);
      if (cw && Number(cw.teacher_id) === Number(teacher.id)) return att;
    } else if (att.owner_type === 'submission') {
      const sub = await db.get(
        `SELECT cs.id, ci.teacher_id
         FROM coursework_submissions cs
         INNER JOIN coursework_items ci ON ci.id = cs.coursework_id
         WHERE cs.id = ?`,
        [att.owner_id]
      );
      if (sub && Number(sub.teacher_id) === Number(teacher.id)) return att;
    }
    throw new AppError(403, 'You do not have permission to access this file.');
  }

  if (user.role === 'student') {
    const student = await requireStudentRecord(user);
    if (att.owner_type === 'coursework') {
      if (!student.class_id) throw new AppError(403, 'Access denied.');
      const allowed = await db.get(
        `SELECT cc.id
         FROM coursework_classes cc
         INNER JOIN coursework_items ci ON ci.id = cc.coursework_id
         WHERE cc.coursework_id = ? AND cc.class_id = ? AND ci.status = 'published'`,
        [att.owner_id, student.class_id]
      );
      if (allowed) return att;
    } else if (att.owner_type === 'submission') {
      const ownSub = await db.get(
        'SELECT id FROM coursework_submissions WHERE id = ? AND student_id = ?',
        [att.owner_id, student.id]
      );
      if (ownSub) return att;
    }
    throw new AppError(403, 'You do not have permission to access this file.');
  }

  throw new AppError(403, 'You do not have permission to access this file.');
}

async function streamMediaFile(req, res) {
  const attachmentId = Number(req.params.id);
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    throw new AppError(400, 'Invalid attachment ID.');
  }

  const att = await getAuthorizedMediaAttachment(req.user, attachmentId);
  const fullPath = path.join(resolveUploadsDir(), path.basename(att.stored_name));

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch (_) {
    throw new AppError(404, 'Stored media file is no longer available on disk.');
  }

  const safeFilename = String(att.original_name || 'attachment')
    .replace(/["\r\n\\]/g, '_')
    .slice(0, 200);
  const forceDownload = req.query.download === '1' || att.media_kind === 'document';
  const dispositionType = forceDownload ? 'attachment' : 'inline';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${encodeURIComponent(safeFilename)}"`
  );
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range && att.media_kind === 'video') {
    const parts = String(range).replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (!Number.isNaN(start) && start >= 0 && start < stat.size && end >= start && end < stat.size) {
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', chunkSize);
      fs.createReadStream(fullPath, { start, end }).pipe(res);
      return;
    }
  }

  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(fullPath).pipe(res);
}

module.exports = {
  listTeacherCoursework,
  createCoursework,
  getCourseworkSubmissions,
  gradeSubmission,
  deleteCoursework,
  createTeacherClassAnnouncement,
  deleteTeacherClassAnnouncement,
  listStudentCoursework,
  submitStudentCoursework,
  getAuthorizedMediaAttachment,
  streamMediaFile,
};
