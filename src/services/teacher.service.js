const db = require('../config/database');
const systemModel = require('../models/system.model');
const academicModel = require('../models/academic.model');
const courseworkService = require('./coursework.service');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

async function requireTeacherRecord(user) {
  const teacher = await db.get(
    `SELECT t.*, u.email, u.username, u.phone, u.full_name, u.google_subject_id
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

async function getOverview(user) {
  const teacher = await requireTeacherRecord(user);
  const context = await systemModel.getPublicSchoolContext();
  const assignments = await academicModel.getTeacherAssignments(teacher.id, context.activeYear?.id);
  const assignedClassIds = Array.from(new Set(assignments.map((a) => Number(a.class_id)).filter(Boolean)));
  const assignedClassMap = new Map();
  for (const a of assignments) {
    if (!assignedClassMap.has(Number(a.class_id))) {
      assignedClassMap.set(Number(a.class_id), {
        id: Number(a.class_id),
        name: a.class_name,
      });
    }
  }
  const assignedClasses = Array.from(assignedClassMap.values());

  const [registeredSubjects, timetable, assessments, recentSessions, announcements, myCorrectionRequests, courseworkData] = await Promise.all([
    db.query(
      `SELECT s.id, s.code, s.name, s.department
       FROM teacher_subjects ts
       INNER JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = ?
       ORDER BY s.code ASC, s.name ASC`,
      [teacher.id]
    ),
    db.query(
      `SELECT tt.*, c.name AS class_name, sub.code AS subject_code, sub.name AS subject_name
       FROM timetables tt
       INNER JOIN classes c ON c.id = tt.class_id
       INNER JOIN subjects sub ON sub.id = tt.subject_id
       WHERE tt.teacher_id = ?
       ORDER BY tt.day_of_week ASC, tt.start_time ASC`,
      [teacher.id]
    ),
    db.query(
      `SELECT
         a.*,
         c.name AS class_name,
         sub.code AS subject_code, sub.name AS subject_name,
         tr.name AS term_name,
         (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id) AS marks_count
       FROM assessments a
       INNER JOIN classes c ON c.id = a.class_id
       INNER JOIN subjects sub ON sub.id = a.subject_id
       INNER JOIN terms tr ON tr.id = a.term_id
       WHERE EXISTS (
         SELECT 1 FROM teacher_assignments ta
         WHERE ta.teacher_id = ? AND ta.class_id = a.class_id AND ta.subject_id = a.subject_id
       )
       ORDER BY a.id DESC`,
      [teacher.id]
    ),
    db.query(
      `SELECT
         s.*,
         c.name AS class_name, sub.name AS subject_name,
         COUNT(ar.id) AS records_count,
         SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
         SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count
       FROM attendance_sessions s
       INNER JOIN classes c ON c.id = s.class_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN attendance_records ar ON ar.session_id = s.id
       WHERE s.taken_by_user_id = ?
       GROUP BY s.id
       ORDER BY s.session_date DESC, s.id DESC
       LIMIT 20`,
      [user.id]
    ),
    systemModel.listAnnouncementsForTeacher(user.id, assignedClassIds),
    db.query(
      `SELECT mcr.*, a.title AS assessment_title, s.first_name, s.last_name, s.admission_number
       FROM mark_correction_requests mcr
       INNER JOIN assessments a ON a.id = mcr.assessment_id
       INNER JOIN students s ON s.id = mcr.student_id
       WHERE mcr.requested_by_user_id = ?
       ORDER BY mcr.id DESC`,
      [user.id]
    ),
    courseworkService.listTeacherCoursework(user),
  ]);

  const subjectMap = new Map();
  for (const sub of registeredSubjects) {
    subjectMap.set(Number(sub.id), sub);
  }
  for (const a of assignments) {
    const sid = Number(a.subject_id);
    if (!subjectMap.has(sid)) {
      subjectMap.set(sid, {
        id: sid,
        code: a.subject_code,
        name: a.subject_name,
        department: '',
      });
    }
  }
  const allSubjects = Array.from(subjectMap.values());
  const uniqueClasses = assignedClasses.length;
  const uniqueSubjects = allSubjects.length;
  const courseworkItems = courseworkData?.items || [];

  return {
    ...context,
    teacher: {
      ...teacher,
      subjects: allSubjects,
      googleLinked: Boolean(teacher.google_subject_id),
      google_subject_id: undefined,
    },
    metrics: {
      assignedClasses: uniqueClasses,
      assignedSubjects: uniqueSubjects,
      weeklyLessons: timetable.length,
      assessmentsCount: assessments.length + courseworkItems.length,
      courseworkCount: courseworkItems.length,
    },
    assignedClasses,
    registeredSubjects: allSubjects,
    assignments,
    coursework: courseworkItems,
    timetable,
    assessments,
    recentSessions,
    announcements,
    myCorrectionRequests,
  };
}

async function getClassList(user, { classId }) {
  const teacher = await requireTeacherRecord(user);
  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId,
  });
  if (!permitted) {
    throw new AppError(403, 'You are not assigned to this class.');
  }

  const context = await systemModel.getSchoolContext();
  const students = await academicModel.getStudentsInClass({
    classId,
    academicYearId: context.activeYear?.id,
  });

  return { students };
}

async function getAttendanceSessionDetails(user, { classId, subjectId, sessionDate }) {
  const teacher = await requireTeacherRecord(user);
  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId,
    subjectId,
  });
  if (!permitted) {
    throw new AppError(403, 'You are not assigned to record attendance for this class/subject.');
  }

  const context = await systemModel.getSchoolContext();
  const students = await academicModel.getStudentsInClass({
    classId,
    academicYearId: context.activeYear?.id,
  });

  const sessionKey = `${classId}:0:${subjectId || 0}:${sessionDate}`;
  const session = await db.get('SELECT * FROM attendance_sessions WHERE session_key = ?', [sessionKey]);
  const existingMap = new Map();
  if (session) {
    const rows = await db.query('SELECT * FROM attendance_records WHERE session_id = ?', [session.id]);
    for (const r of rows) existingMap.set(r.student_id, r);
  }

  return {
    session: session || null,
    roster: students.map((st) => ({
      ...st,
      attendance_status: existingMap.get(st.student_id)?.status || 'present',
      remarks: existingMap.get(st.student_id)?.remarks || '',
    })),
  };
}

async function submitAttendance(user, { classId, subjectId, sessionDate, notes, entries, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId,
    subjectId,
  });
  if (!permitted) {
    throw new AppError(403, 'Access denied: you can only record attendance for assigned classes/subjects.');
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError(400, 'Please include student attendance entries.');
  }

  const context = await systemModel.getSchoolContext();
  if (!context.activeYear) {
    throw new AppError(400, 'No active academic year configured.');
  }

  const validStatuses = new Set(['present', 'absent', 'late', 'excused']);
  const sessionKey = `${classId}:0:${subjectId || 0}:${sessionDate}`;

  return db.withTransaction(async (tx) => {
    let session = await tx.get('SELECT * FROM attendance_sessions WHERE session_key = ?', [sessionKey]);
    if (!session) {
      const ins = await tx.run(
        `INSERT INTO attendance_sessions
         (class_id, subject_id, academic_year_id, term_id, session_date, session_key, taken_by_user_id, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        [
          classId,
          subjectId || null,
          context.activeYear.id,
          context.activeTerm?.id || null,
          sessionDate,
          sessionKey,
          user.id,
          notes || '',
        ]
      );
      session = { id: ins.insertId };
    } else {
      await tx.run('UPDATE attendance_sessions SET notes = ? WHERE id = ?', [notes || '', session.id]);
    }

    const seenStudentIds = new Set();
    for (const item of entries) {
      const studentId = Number(item.studentId);
      const status = String(item.status || 'present').toLowerCase();
      if (!Number.isInteger(studentId) || studentId <= 0 || !validStatuses.has(status)) {
        throw new AppError(400, 'Invalid student attendance status supplied.');
      }
      if (seenStudentIds.has(studentId)) continue;
      seenStudentIds.add(studentId);

      const existingRec = await tx.get(
        'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?',
        [session.id, studentId]
      );
      if (existingRec) {
        await tx.run(
          `UPDATE attendance_records
           SET status = ?, remarks = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [status, String(item.remarks || '').slice(0, 200), user.id, existingRec.id]
        );
      } else {
        await tx.run(
          `INSERT INTO attendance_records (session_id, student_id, status, remarks, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?)`,
          [session.id, studentId, status, String(item.remarks || '').slice(0, 200), user.id]
        );
      }
    }

    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'ATTENDANCE_SUBMITTED',
        targetType: 'attendance_session',
        targetId: String(session.id),
        ipAddress,
        metadata: { classId, subjectId, sessionDate, count: seenStudentIds.size },
      },
      tx
    );

    return { sessionId: session.id, count: seenStudentIds.size };
  });
}

async function createAssessment(user, payload, ipAddress) {
  const teacher = await requireTeacherRecord(user);
  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId: payload.classId,
    subjectId: payload.subjectId,
  });
  if (!permitted) {
    throw new AppError(403, 'You can only create assessments for your assigned classes and subjects.');
  }

  const context = await systemModel.getSchoolContext();
  if (!context.activeYear || !context.activeTerm) {
    throw new AppError(400, 'An active academic year and term must be set before creating assessments.');
  }

  const ins = await db.run(
    `INSERT INTO assessments
     (title, assessment_type, class_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      payload.title,
      payload.assessmentType,
      payload.classId,
      payload.subjectId,
      context.activeYear.id,
      context.activeTerm.id,
      payload.maxScore || 100,
      payload.weightPercent || 100,
      payload.scheduledDate || new Date().toISOString().slice(0, 10),
      user.id,
    ]
  );

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ASSESSMENT_CREATED',
    targetType: 'assessment',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { title: payload.title, classId: payload.classId, subjectId: payload.subjectId },
  });

  return { id: ins.insertId };
}

async function getAssessmentMarksheet(user, assessmentId) {
  const teacher = await requireTeacherRecord(user);
  const assessment = await db.get(
    `SELECT a.*, c.name AS class_name, sub.name AS subject_name, sub.code AS subject_code
     FROM assessments a
     INNER JOIN classes c ON c.id = a.class_id
     INNER JOIN subjects sub ON sub.id = a.subject_id
     WHERE a.id = ?`,
    [assessmentId]
  );
  if (!assessment) throw new AppError(404, 'Assessment not found.');

  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId: assessment.class_id,
    subjectId: assessment.subject_id,
  });
  if (!permitted) {
    throw new AppError(403, 'You are not assigned to this assessment class/subject.');
  }

  const students = await academicModel.getStudentsInClass({
    classId: assessment.class_id,
    academicYearId: assessment.academic_year_id,
  });
  const marksRows = await db.query('SELECT * FROM marks WHERE assessment_id = ?', [assessment.id]);
  const marksMap = new Map(marksRows.map((m) => [m.student_id, m]));

  const context = await systemModel.getSchoolContext();
  const lockedForDirectEdit =
    Boolean(assessment.is_published) && !Boolean(context.settings?.allow_teacher_mark_edit_after_publish);

  return {
    assessment,
    lockedForDirectEdit,
    students: students.map((st) => {
      const m = marksMap.get(st.student_id);
      return {
        ...st,
        mark_id: m?.id || null,
        score: m ? Number(m.score) : '',
        percentage: m ? Number(m.percentage) : null,
        grade: m?.grade || '',
        remark: m?.remark || '',
      };
    }),
  };
}

async function submitMarks(user, { assessmentId, entries, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  const assessment = await db.get('SELECT * FROM assessments WHERE id = ?', [assessmentId]);
  if (!assessment) throw new AppError(404, 'Assessment not found.');

  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId: assessment.class_id,
    subjectId: assessment.subject_id,
  });
  if (!permitted) {
    throw new AppError(403, 'You cannot enter marks for another teacher’s unassigned class/subject.');
  }

  const context = await systemModel.getSchoolContext();
  if (assessment.is_published && !context.settings?.allow_teacher_mark_edit_after_publish) {
    throw new AppError(
      403,
      'This assessment is already published. Please submit a formal Mark Correction Request for Superadmin approval.'
    );
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError(400, 'No student marks provided.');
  }

  const maxScore = Number(assessment.max_score);
  return db.withTransaction(async (tx) => {
    let saved = 0;
    for (const item of entries) {
      if (item.score === '' || item.score === null || item.score === undefined) continue;
      const studentId = Number(item.studentId);
      const score = Number(item.score);
      if (!Number.isInteger(studentId) || studentId <= 0) continue;
      if (!Number.isFinite(score) || score < 0 || score > maxScore) {
        throw new AppError(400, `Scores must be between 0 and ${maxScore}.`);
      }

      const pct = Math.round((score / maxScore) * 10000) / 100;
      const gradeInfo = await academicModel.resolveGradeForPercentage(pct, tx);

      const existing = await tx.get(
        'SELECT id FROM marks WHERE assessment_id = ? AND student_id = ?',
        [assessment.id, studentId]
      );
      if (existing) {
        await tx.run(
          `UPDATE marks
           SET score = ?, percentage = ?, grade = ?, remark = ?, entered_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [score, pct, gradeInfo.grade, gradeInfo.remark, user.id, existing.id]
        );
      } else {
        await tx.run(
          `INSERT INTO marks (assessment_id, student_id, score, percentage, grade, remark, entered_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [assessment.id, studentId, score, pct, gradeInfo.grade, gradeInfo.remark, user.id]
        );
      }
      saved++;
    }

    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'MARKS_ENTERED',
        targetType: 'assessment',
        targetId: String(assessment.id),
        ipAddress,
        metadata: { savedCount: saved },
      },
      tx
    );

    return { savedCount: saved };
  });
}

async function submitMarkCorrectionRequest(user, { markId, proposedScore, reason, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  const markRow = await db.get(
    `SELECT m.*, a.class_id, a.subject_id, a.max_score
     FROM marks m
     INNER JOIN assessments a ON a.id = m.assessment_id
     WHERE m.id = ?`,
    [markId]
  );
  if (!markRow) throw new AppError(404, 'Mark record not found.');

  const permitted = await academicModel.isTeacherAssignedTo({
    teacherId: teacher.id,
    classId: markRow.class_id,
    subjectId: markRow.subject_id,
  });
  if (!permitted) throw new AppError(403, 'You are not assigned to this subject/class.');

  if (proposedScore < 0 || proposedScore > Number(markRow.max_score)) {
    throw new AppError(400, `Proposed score must be between 0 and ${markRow.max_score}.`);
  }

  const ins = await db.run(
    `INSERT INTO mark_correction_requests
     (mark_id, assessment_id, student_id, requested_by_user_id, previous_score, proposed_score, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [markRow.id, markRow.assessment_id, markRow.student_id, user.id, markRow.score, proposedScore, reason]
  );

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'MARK_CORRECTION_REQUESTED',
    targetType: 'mark_correction_request',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { markId: markRow.id, previousScore: markRow.score, proposedScore },
  });

  return { id: ins.insertId };
}

async function getClassProgressReport(user) {
  const teacher = await requireTeacherRecord(user);
  const rows = await db.query(
    `SELECT
       c.name AS class_name,
       sub.code AS subject_code,
       sub.name AS subject_name,
       sub.pass_mark,
       COUNT(m.id) AS entries_count,
       ROUND(AVG(m.percentage), 2) AS average_pct,
       ROUND(MAX(m.percentage), 2) AS highest_pct,
       ROUND(MIN(m.percentage), 2) AS lowest_pct,
       SUM(CASE WHEN m.percentage >= sub.pass_mark THEN 1 ELSE 0 END) AS pass_count
     FROM teacher_assignments ta
     INNER JOIN classes c ON c.id = ta.class_id
     INNER JOIN subjects sub ON sub.id = ta.subject_id
     LEFT JOIN assessments a ON a.class_id = ta.class_id AND a.subject_id = ta.subject_id
     LEFT JOIN marks m ON m.assessment_id = a.id
     WHERE ta.teacher_id = ?
     GROUP BY ta.id, c.name, sub.code, sub.name, sub.pass_mark
     ORDER BY c.level_order ASC, sub.name ASC`,
    [teacher.id]
  );
  return { reports: rows };
}

async function updateOwnProfile(user, { phone, qualification, specialization, ipAddress }) {
  const teacher = await requireTeacherRecord(user);
  await db.withTransaction(async (tx) => {
    await tx.run('UPDATE users SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      phone || '',
      user.id,
    ]);
    await tx.run(
      'UPDATE teachers SET qualification = ?, specialization = ? WHERE id = ?',
      [qualification || teacher.qualification, specialization || teacher.specialization, teacher.id]
    );
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'TEACHER_PROFILE_UPDATED',
        targetType: 'teacher',
        targetId: String(teacher.id),
        ipAddress,
      },
      tx
    );
  });
}

module.exports = {
  getOverview,
  getClassList,
  getAttendanceSessionDetails,
  submitAttendance,
  createAssessment,
  getAssessmentMarksheet,
  submitMarks,
  submitMarkCorrectionRequest,
  getClassProgressReport,
  updateOwnProfile,
};
