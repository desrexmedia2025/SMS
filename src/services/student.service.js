const db = require('../config/database');
const systemModel = require('../models/system.model');
const academicModel = require('../models/academic.model');
const financeModel = require('../models/finance.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

async function requireOwnStudentRecord(user, requestedStudentId = null, ipAddress = '') {
  const student = await db.get(
    `SELECT
       s.*,
       u.email, u.username, u.phone, u.google_subject_id,
       se.class_id, se.stream_id, se.roll_number, se.academic_year_id, se.term_id,
       c.name AS class_name,
       st.name AS stream_name, st.room_number,
       ay.name AS academic_year_name
     FROM students s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     LEFT JOIN streams st ON st.id = se.stream_id
     LEFT JOIN academic_years ay ON ay.id = se.academic_year_id
     WHERE s.user_id = ?
     ORDER BY se.id DESC
     LIMIT 1`,
    [user.id]
  );

  if (!student) {
    throw new AppError(403, 'No student profile is linked to your account.');
  }

  // Strictly block any attempt to request another student's ID via query/path parameter
  if (requestedStudentId !== null && requestedStudentId !== undefined && requestedStudentId !== '') {
    if (Number(requestedStudentId) !== Number(student.id)) {
      await recordAudit({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'STUDENT_IDOR_ATTEMPT_BLOCKED',
        targetType: 'student',
        targetId: String(requestedStudentId),
        ipAddress,
        metadata: { ownStudentId: student.id },
      });
      throw new AppError(403, 'Access denied: you can only view your own student records.');
    }
  }

  return student;
}

async function getPortalData(user, query = {}, ipAddress = '') {
  const student = await requireOwnStudentRecord(user, query.studentId, ipAddress);
  // Least-privilege public context: never expose internal financial stat adjustments or treasury targets to students
  const context = await systemModel.getPublicSchoolContext();

  const [
    subjects,
    timetable,
    attendanceRecords,
    publishedResults,
    upcomingAssessments,
    announcements,
    profileRequests,
  ] = await Promise.all([
    student.class_id
      ? db.query(
          `SELECT DISTINCT
             sub.id, sub.code, sub.name, sub.department, sub.is_elective, sub.pass_mark,
             u.full_name AS teacher_name
           FROM teacher_assignments ta
           INNER JOIN subjects sub ON sub.id = ta.subject_id
           INNER JOIN teachers t ON t.id = ta.teacher_id
           INNER JOIN users u ON u.id = t.user_id
           WHERE ta.class_id = ? AND (ta.stream_id IS NULL OR ta.stream_id = ?)
           ORDER BY sub.code ASC`,
          [student.class_id, student.stream_id || 0]
        )
      : Promise.resolve([]),

    student.class_id
      ? db.query(
          `SELECT
             tt.*,
             sub.code AS subject_code, sub.name AS subject_name,
             u.full_name AS teacher_name
           FROM timetables tt
           INNER JOIN subjects sub ON sub.id = tt.subject_id
           INNER JOIN teachers t ON t.id = tt.teacher_id
           INNER JOIN users u ON u.id = t.user_id
           WHERE tt.class_id = ? AND (tt.stream_id IS NULL OR tt.stream_id = ?)
           ORDER BY tt.day_of_week ASC, tt.start_time ASC`,
          [student.class_id, student.stream_id || 0]
        )
      : Promise.resolve([]),

    db.query(
      `SELECT
         ar.status, ar.remarks, ar.remarks AS remark,
         s.session_date, s.notes AS session_notes,
         sub.name AS subject_name
       FROM attendance_records ar
       INNER JOIN attendance_sessions s ON s.id = ar.session_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       WHERE ar.student_id = ?
       ORDER BY s.session_date DESC, s.id DESC`,
      [student.id]
    ),

    // Strictly ONLY published assessments (`a.is_published = 1`)
    db.query(
      `SELECT
         m.score, m.percentage, m.grade, m.remark, m.remark AS remarks,
         a.id AS assessment_id, a.title AS assessment_title, a.assessment_type,
         a.max_score, a.weight_percent, a.scheduled_date,
         sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
         tr.id AS term_id, tr.name AS term_name,
         ay.name AS academic_year_name
       FROM marks m
       INNER JOIN assessments a ON a.id = m.assessment_id
       INNER JOIN subjects sub ON sub.id = a.subject_id
       INNER JOIN terms tr ON tr.id = a.term_id
       INNER JOIN academic_years ay ON ay.id = a.academic_year_id
       WHERE m.student_id = ? AND a.is_published = 1
       ORDER BY a.scheduled_date DESC, a.id DESC`,
      [student.id]
    ),

    // Strictly hide unpublished draft assessments from student API payloads
    student.class_id
      ? db.query(
          `SELECT a.id, a.title, a.assessment_type, a.max_score, a.scheduled_date, sub.name AS subject_name
           FROM assessments a
           INNER JOIN subjects sub ON sub.id = a.subject_id
           WHERE a.class_id = ?
             AND (a.stream_id IS NULL OR a.stream_id = ?)
             AND a.is_published = 1
           ORDER BY a.scheduled_date DESC`,
          [student.class_id, student.stream_id || 0]
        )
      : Promise.resolve([]),

    systemModel.listAnnouncementsForAudience(['all', 'students']),

    db.query(`SELECT * FROM profile_change_requests WHERE user_id = ? ORDER BY id DESC`, [user.id]),
  ]);

  // Build Report Card Aggregation per Subject
  const bySubject = new Map();
  for (const r of publishedResults) {
    if (!bySubject.has(r.subject_id)) {
      bySubject.set(r.subject_id, {
        subjectId: r.subject_id,
        subjectCode: r.subject_code,
        subjectName: r.subject_name,
        weightedSum: 0,
        weightTotal: 0,
        components: [],
      });
    }
    const bucket = bySubject.get(r.subject_id);
    const w = Number(r.weight_percent || 100);
    bucket.weightedSum += Number(r.percentage) * w;
    bucket.weightTotal += w;
    bucket.components.push({
      title: r.assessment_title,
      type: r.assessment_type,
      score: Number(r.score),
      maxScore: Number(r.max_score),
      percentage: Number(r.percentage),
      weightPercent: w,
    });
  }

  const reportCardRows = [];
  let sumSubjectPct = 0;
  let sumGpa = 0;
  for (const bucket of bySubject.values()) {
    const finalPct =
      bucket.weightTotal > 0
        ? Math.round((bucket.weightedSum / bucket.weightTotal) * 100) / 100
        : 0;
    const g = await academicModel.resolveGradeForPercentage(finalPct);
    sumSubjectPct += finalPct;
    sumGpa += g.gradePoint;
    reportCardRows.push({
      subjectCode: bucket.subjectCode,
      subjectName: bucket.subjectName,
      components: bucket.components,
      finalPercentage: finalPct,
      grade: g.grade,
      gradePoint: g.gradePoint,
      remark: g.remark,
    });
  }

  const overallAverage =
    reportCardRows.length > 0
      ? Math.round((sumSubjectPct / reportCardRows.length) * 100) / 100
      : 0;
  const gpa =
    reportCardRows.length > 0 ? Math.round((sumGpa / reportCardRows.length) * 100) / 100 : 0;

  // Attendance breakdown
  const totalSessions = attendanceRecords.length;
  const present = attendanceRecords.filter((a) => a.status === 'present').length;
  const late = attendanceRecords.filter((a) => a.status === 'late').length;
  const excused = attendanceRecords.filter((a) => a.status === 'excused').length;
  const absent = attendanceRecords.filter((a) => a.status === 'absent').length;
  const attendedCount = present + late;
  const attendancePercentage =
    totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 1000) / 10 : 100;

  // Fee statement if enabled by school settings
  const feePortalEnabled = Boolean(context.settings?.student_fee_portal_enabled);
  const rawFeeStatement = feePortalEnabled
    ? await financeModel.getStudentFeeLedger(student.id)
    : null;
  const feeStatement = rawFeeStatement
    ? {
        ...rawFeeStatement,
        summary: {
          ...rawFeeStatement.summary,
          balance: rawFeeStatement.summary.outstandingBalance,
        },
      }
    : null;

  return {
    ...context,
    student: {
      ...student,
      googleLinked: Boolean(student.google_subject_id),
      google_subject_id: undefined,
    },
    metrics: {
      attendancePercentage,
      totalSessions,
      attendedCount,
      overallAverage,
      gpa,
      subjectsCount: subjects.length,
      outstandingBalance: feeStatement ? feeStatement.summary.outstandingBalance : null,
    },
    attendanceSummary: {
      totalSessions,
      present,
      late,
      excused,
      absent,
      attendedCount,
      rate: totalSessions > 0 ? attendancePercentage : 100,
    },
    attendanceHistory: attendanceRecords,
    attendanceRecords,
    subjects,
    timetable,
    publishedResults,
    upcomingAssessments,
    reportCard: {
      rows: reportCardRows,
      overallAverage,
      gpa,
      attendanceSummary: `${attendedCount} / ${totalSessions} (${attendancePercentage}%)`,
    },
    feePortalEnabled,
    feeStatement,
    announcements,
    profileRequests,
  };
}

async function updateAllowedProfile(user, { phone, ipAddress }) {
  const student = await requireOwnStudentRecord(user, null, ipAddress);
  await db.run('UPDATE users SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
    phone || '',
    user.id,
  ]);
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'STUDENT_CONTACT_UPDATED',
    targetType: 'student',
    targetId: String(student.id),
    ipAddress,
  });
}

async function submitSensitiveProfileChangeRequest(user, { fieldName, requestedValue, reason, ipAddress }) {
  const student = await requireOwnStudentRecord(user, null, ipAddress);
  const allowedFields = [
    'first_name',
    'last_name',
    'date_of_birth',
    'guardian_name',
    'guardian_phone',
    'address',
  ];
  if (!allowedFields.includes(fieldName)) {
    throw new AppError(400, 'Invalid profile field selected.');
  }

  const currentVal = String(student[fieldName] || '');
  const ins = await db.run(
    `INSERT INTO profile_change_requests
     (user_id, student_id, field_name, current_value, requested_value, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [user.id, student.id, fieldName, currentVal, requestedValue, reason || '']
  );

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'STUDENT_PROFILE_CHANGE_REQUESTED',
    targetType: 'profile_change_request',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { fieldName, requestedValue },
  });

  return { id: ins.insertId };
}

module.exports = {
  requireOwnStudentRecord,
  getPortalData,
  updateAllowedProfile,
  submitSensitiveProfileChangeRequest,
};
