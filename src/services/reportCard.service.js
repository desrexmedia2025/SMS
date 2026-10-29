const db = require('../config/database');
const academicModel = require('../models/academic.model');
const systemModel = require('../models/system.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

function positiveInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `${fieldName} is required.`);
  return n;
}

function cleanRemark(value) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 500);
}

async function resolvePeriod({ academicYearId, termId }) {
  const context = await systemModel.getSchoolContext();
  const yearId = academicYearId ? Number(academicYearId) : context.activeYear?.id;
  const tId = termId ? Number(termId) : context.activeTerm?.id;
  if (!yearId) throw new AppError(400, 'No academic year is available yet.');
  if (!tId) throw new AppError(400, 'No term is available yet.');
  const year = await db.get('SELECT * FROM academic_years WHERE id = ?', [yearId]);
  const term = await db.get('SELECT * FROM terms WHERE id = ? AND academic_year_id = ?', [tId, yearId]);
  if (!year || !term) throw new AppError(404, 'The selected academic period was not found.');
  return { yearId, termId: tId, year, term, context };
}

// Weighted per-subject averages for one student in one term
async function computeSubjectRows(studentId, classId, yearId, termId) {
  const publishedMarks = await db.query(
    `SELECT a.id AS assessment_id, a.title, a.assessment_type, a.max_score, a.weight_percent,
            a.subject_id, sub.code AS subject_code, sub.name AS subject_name,
            m.score, m.percentage, m.remark
     FROM assessments a
     INNER JOIN subjects sub ON sub.id = a.subject_id
     INNER JOIN marks m ON m.assessment_id = a.id AND m.student_id = ?
     WHERE a.class_id = ? AND a.academic_year_id = ? AND a.term_id = ? AND a.is_published = 1
     ORDER BY sub.name ASC, a.id ASC`,
    [studentId, classId, yearId, termId]
  );

  const bySubject = new Map();
  for (const row of publishedMarks) {
    if (!bySubject.has(row.subject_id)) {
      bySubject.set(row.subject_id, {
        subjectId: row.subject_id,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        weightedSum: 0,
        weightTotal: 0,
        components: [],
      });
    }
    const bucket = bySubject.get(row.subject_id);
    const weight = Number(row.weight_percent || 100);
    bucket.weightedSum += Number(row.percentage) * weight;
    bucket.weightTotal += weight;
    bucket.components.push({
      title: row.title,
      type: row.assessment_type,
      score: Number(row.score),
      maxScore: Number(row.max_score),
      percentage: Number(row.percentage),
      weightPercent: weight,
      remark: row.remark || '',
    });
  }

  const rows = [];
  for (const bucket of bySubject.values()) {
    const finalPercentage =
      bucket.weightTotal > 0
        ? Math.round((bucket.weightedSum / bucket.weightTotal) * 100) / 100
        : 0;
    const grade = await academicModel.resolveGradeForPercentage(finalPercentage);
    rows.push({
      subjectCode: bucket.subjectCode,
      subjectName: bucket.subjectName,
      components: bucket.components,
      finalPercentage,
      grade: grade.grade,
      gradePoint: grade.gradePoint,
      remark: grade.remark,
    });
  }
  rows.sort((a, b) => (a.subjectName || '').localeCompare(b.subjectName || ''));
  return rows;
}

async function attendanceSummaryFor(studentId, classId, yearId, termId) {
  const row = await db.get(
    `SELECT COUNT(ar.id) AS total,
            SUM(CASE WHEN ar.status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended
     FROM attendance_sessions s
     INNER JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = ?
     WHERE s.class_id = ? AND s.academic_year_id = ? AND s.term_id = ?`,
    [studentId, classId, yearId, termId]
  );
  const total = Number(row?.total || 0);
  const attended = Number(row?.attended || 0);
  const rate = total > 0 ? Math.round((attended / total) * 1000) / 10 : null;
  return { total, attended, rate, summary: total > 0 ? `${attended} / ${total} (${rate}%)` : 'No sessions recorded' };
}

async function buildStudentCard(studentId, classId, { yearId, termId, year, term }, context) {
  const student = await db.get(
    `SELECT s.id, s.admission_number, s.first_name, s.last_name, s.gender,
            se.roll_number, c.name AS class_name, c.id AS class_id
     FROM students s
     INNER JOIN student_enrolments se ON se.student_id = s.id
     INNER JOIN classes c ON c.id = se.class_id
     WHERE s.id = ? AND se.class_id = ? AND se.academic_year_id = ? AND se.status IN ('enrolled', 'active')`,
    [studentId, classId, yearId]
  );
  if (!student) throw new AppError(404, 'That student is not enrolled in the selected class.');

  const [rows, attendance] = await Promise.all([
    computeSubjectRows(studentId, classId, yearId, termId),
    attendanceSummaryFor(studentId, classId, yearId, termId),
  ]);

  const average =
    rows.length > 0
      ? Math.round((rows.reduce((sum, r) => sum + r.finalPercentage, 0) / rows.length) * 100) / 100
      : 0;
  const gpa =
    rows.length > 0
      ? Math.round((rows.reduce((sum, r) => sum + r.gradePoint, 0) / rows.length) * 100) / 100
      : 0;
  const overall = await academicModel.resolveGradeForPercentage(average);

  return {
    studentId,
    classId,
    student,
    year,
    term,
    subjects: rows,
    overallAverage: average,
    gpa,
    overallGrade: overall.grade,
    overallRemark: overall.remark,
    attendance,
    school: context?.settings || {},
  };
}

// Generates (or regenerates) every report card for one class in one term
async function generateClassReportCards({ classId, academicYearId, termId, actor, ipAddress }) {
  const classIdNum = positiveInt(classId, 'Class');
  const period = await resolvePeriod({ academicYearId, termId });
  const klass = await db.get('SELECT id, name FROM classes WHERE id = ?', [classIdNum]);
  if (!klass) throw new AppError(404, 'Class not found.');

  const students = await db.query(
    `SELECT s.id, s.first_name, s.last_name, se.roll_number
     FROM students s
     INNER JOIN student_enrolments se ON se.student_id = s.id
     WHERE se.class_id = ? AND se.academic_year_id = ? AND se.status IN ('enrolled', 'active')
     ORDER BY s.last_name ASC, s.first_name ASC`,
    [classIdNum, period.yearId]
  );
  if (!students.length) throw new AppError(400, 'No students are enrolled in that class.');

  const context = await systemModel.getSchoolContext();
  const computed = [];
  for (const s of students) {
    const card = await buildStudentCard(s.id, classIdNum, period, context);
    computed.push({ ...card, rollNumber: s.roll_number });
  }

  // Rank by average (ties share the best position, next rank skips ahead)
  const sorted = [...computed].sort((a, b) => b.overallAverage - a.overallAverage);
  const positionByStudent = new Map();
  let lastAverage = null;
  let lastPosition = 0;
  sorted.forEach((card, index) => {
    if (lastAverage !== null && Math.abs(card.overallAverage - lastAverage) < 0.0001) {
      positionByStudent.set(card.studentId, lastPosition);
    } else {
      lastPosition = index + 1;
      lastAverage = card.overallAverage;
      positionByStudent.set(card.studentId, lastPosition);
    }
  });

  await db.withTransaction(async (tx) => {
    for (const card of computed) {
      const position = positionByStudent.get(card.studentId) || 0;
      const existingCard = await tx.get(
        'SELECT id FROM report_cards WHERE student_id = ? AND academic_year_id = ? AND term_id = ?',
        [card.studentId, period.yearId, period.termId]
      );
      const values = [
        card.studentId,
        classIdNum,
        period.yearId,
        period.termId,
        card.overallAverage,
        card.gpa,
        card.overallGrade,
        position,
        computed.length,
        card.subjects.length,
        card.attendance.summary,
        actor.id,
      ];
      if (existingCard) {
        await tx.run(
          `UPDATE report_cards
           SET class_id = ?, overall_average = ?, gpa = ?, overall_grade = ?, class_position = ?,
               class_size = ?, subjects_count = ?, attendance_summary = ?, generated_by_user_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [...values.slice(1), existingCard.id]
        );
      } else {
        await tx.run(
          `INSERT INTO report_cards
             (student_id, class_id, academic_year_id, term_id, overall_average, gpa, overall_grade,
              class_position, class_size, subjects_count, attendance_summary, generated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          values
        );
      }
    }
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'REPORT_CARDS_GENERATED',
        targetType: 'class',
        targetId: String(classIdNum),
        ipAddress,
        metadata: { classId: classIdNum, yearId: period.yearId, termId: period.termId, count: computed.length },
      },
      tx
    );
  });

  return {
    classId: classIdNum,
    className: klass.name,
    academicYearId: period.yearId,
    termId: period.termId,
    generated: computed.length,
    message: `${computed.length} report card${computed.length === 1 ? '' : 's'} generated for ${klass.name}.`,
  };
}

async function listPeriods() {
  const [years, terms] = await Promise.all([
    db.query('SELECT id, name, is_active FROM academic_years ORDER BY id DESC'),
    db.query('SELECT id, name, academic_year_id, is_active FROM terms ORDER BY academic_year_id DESC, id ASC'),
  ]);
  return {
    years: years.map((y) => ({ id: Number(y.id), name: y.name, isActive: Boolean(y.is_active) })),
    terms: terms.map((t) => ({
      id: Number(t.id),
      name: t.name,
      academicYearId: Number(t.academic_year_id),
      isActive: Boolean(t.is_active),
    })),
  };
}

async function listClassReportCards({ classId, academicYearId, termId }) {
  const classIdNum = positiveInt(classId, 'Class');
  const period = await resolvePeriod({ academicYearId, termId });
  const rows = await db.query(
    `SELECT rc.*, s.first_name, s.last_name, s.admission_number, se.roll_number, c.name AS class_name
     FROM report_cards rc
     INNER JOIN students s ON s.id = rc.student_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id AND se.academic_year_id = rc.academic_year_id
     LEFT JOIN classes c ON c.id = rc.class_id
     WHERE rc.class_id = ? AND rc.academic_year_id = ? AND rc.term_id = ?
     ORDER BY rc.class_position ASC, s.last_name ASC`,
    [classIdNum, period.yearId, period.termId]
  );
  const { years, terms } = await listPeriods();

  return {
    years: years.map((y) => ({ id: Number(y.id), name: y.name, isActive: Boolean(y.is_active) })),
    terms: terms.map((t) => ({
      id: Number(t.id),
      name: t.name,
      academicYearId: Number(t.academic_year_id),
      isActive: Boolean(t.is_active),
    })),
    items: rows.map((r) => ({
      id: Number(r.id),
      studentId: Number(r.student_id),
      admissionNumber: r.admission_number,
      rollNumber: r.roll_number || '',
      studentName: `${r.first_name} ${r.last_name}`,
      className: r.class_name || '',
      overallAverage: Number(r.overall_average || 0),
      gpa: Number(r.gpa || 0),
      overallGrade: r.overall_grade || '',
      classPosition: r.class_position === null ? null : Number(r.class_position),
      classSize: Number(r.class_size || 0),
      subjectsCount: Number(r.subjects_count || 0),
      attendanceSummary: r.attendance_summary || '',
      teacherRemark: r.teacher_remark || '',
      headteacherRemark: r.headteacher_remark || '',
      generatedAt: r.generated_at,
    })),
    academicYearId: period.yearId,
    termId: period.termId,
    academicYearName: period.year.name,
    termName: period.term.name,
  };
}

async function getStudentReportCard({ studentId, academicYearId, termId, viewer }) {
  const studentIdNum = positiveInt(studentId, 'Student');
  const period = await resolvePeriod({ academicYearId, termId });
  const stored = await db.get(
    `SELECT rc.*, c.name AS class_name
     FROM report_cards rc
     LEFT JOIN classes c ON c.id = rc.class_id
     WHERE rc.student_id = ? AND rc.academic_year_id = ? AND rc.term_id = ?`,
    [studentIdNum, period.yearId, period.termId]
  );
  if (!stored) {
    throw new AppError(404, 'No report card has been generated for that term yet.');
  }
  const context = await systemModel.getSchoolContext();
  const card = await buildStudentCard(
    studentIdNum,
    stored.class_id,
    period,
    context
  );

  const gradingScales = await db.query('SELECT grade, min_score, max_score, grade_point, remark FROM grading_scales ORDER BY min_score DESC');

  return {
    reportCard: {
      id: Number(stored.id),
      studentId: studentIdNum,
      student: card.student,
      classId: Number(stored.class_id),
      className: stored.class_name || card.student.class_name,
      academicYear: period.year,
      term: period.term,
      subjects: card.subjects,
      overallAverage: Number(stored.overall_average || 0),
      gpa: Number(stored.gpa || 0),
      overallGrade: stored.overall_grade || card.overallGrade,
      overallRemark: card.overallRemark,
      classPosition: stored.class_position === null ? null : Number(stored.class_position),
      classSize: Number(stored.class_size || 0),
      attendanceSummary: stored.attendance_summary || '',
      teacherRemark: stored.teacher_remark || '',
      headteacherRemark: stored.headteacher_remark || '',
      generatedAt: stored.generated_at,
      school: context.settings || {},
      viewerRole: viewer?.role || '',
    },
    gradingScales,
  };
}

async function saveReportCardRemark({ studentId, academicYearId, termId, teacherRemark, headteacherRemark, actor, ipAddress }) {
  const studentIdNum = positiveInt(studentId, 'Student');
  const period = await resolvePeriod({ academicYearId, termId });
  const existing = await db.get(
    'SELECT * FROM report_cards WHERE student_id = ? AND academic_year_id = ? AND term_id = ?',
    [studentIdNum, period.yearId, period.termId]
  );
  if (!existing) throw new AppError(404, 'No report card has been generated for that term yet.');

  const nextTeacher = cleanRemark(teacherRemark);
  const nextHead = cleanRemark(headteacherRemark);
  if (nextTeacher === undefined && nextHead === undefined) {
    throw new AppError(400, 'Enter a remark to save.');
  }
  if (nextHead !== undefined && actor.role !== 'superadmin') {
    throw new AppError(403, 'Only the Superadmin can sign the head teacher remark.');
  }

  await db.run(
    `UPDATE report_cards
     SET teacher_remark = COALESCE(?, teacher_remark),
         headteacher_remark = COALESCE(?, headteacher_remark),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextTeacher === undefined ? null : nextTeacher, nextHead === undefined ? null : nextHead, existing.id]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'REPORT_CARD_REMARK_SAVED',
    targetType: 'report_card',
    targetId: String(existing.id),
    ipAddress,
    metadata: { studentId: studentIdNum, termId: period.termId, kind: nextHead !== undefined ? 'headteacher' : 'teacher' },
  });

  const fresh = await db.get('SELECT * FROM report_cards WHERE id = ?', [existing.id]);
  return {
    teacherRemark: fresh.teacher_remark || '',
    headteacherRemark: fresh.headteacher_remark || '',
    message: 'Remark saved on the report card.',
  };
}

async function listStudentReportCards({ studentId }) {
  const studentIdNum = positiveInt(studentId, 'Student');
  const rows = await db.query(
    `SELECT rc.id, rc.academic_year_id, rc.term_id, rc.overall_average, rc.gpa, rc.overall_grade,
            rc.class_position, rc.class_size, rc.attendance_summary, rc.generated_at,
            ay.name AS academic_year_name, t.name AS term_name, c.name AS class_name
     FROM report_cards rc
     INNER JOIN academic_years ay ON ay.id = rc.academic_year_id
     INNER JOIN terms t ON t.id = rc.term_id
     LEFT JOIN classes c ON c.id = rc.class_id
     WHERE rc.student_id = ?
     ORDER BY rc.academic_year_id DESC, rc.term_id DESC`,
    [studentIdNum]
  );
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      academicYearId: Number(r.academic_year_id),
      termId: Number(r.term_id),
      academicYearName: r.academic_year_name,
      termName: r.term_name,
      className: r.class_name || '',
      overallAverage: Number(r.overall_average || 0),
      gpa: Number(r.gpa || 0),
      overallGrade: r.overall_grade || '',
      classPosition: r.class_position === null ? null : Number(r.class_position),
      classSize: Number(r.class_size || 0),
      attendanceSummary: r.attendance_summary || '',
      generatedAt: r.generated_at,
    })),
  };
}

// One-click end-of-term / end-of-year class rollover
async function promoteClass({ classId, fromAcademicYearId, fromTermId, toAcademicYearId, toTermId, promoteToNextClass, actor, ipAddress }) {
  const classIdNum = positiveInt(classId, 'Class');
  const fromYear = fromAcademicYearId ? Number(fromAcademicYearId) : null;
  const fromTerm = fromTermId ? Number(fromTermId) : null;
  const toYear = positiveInt(toAcademicYearId, 'Target academic year');
  const toTerm = positiveInt(toTermId, 'Target term');

  const klass = await db.get('SELECT * FROM classes WHERE id = ?', [classIdNum]);
  if (!klass) throw new AppError(404, 'Class not found.');
  const targetYear = await db.get('SELECT * FROM academic_years WHERE id = ?', [toYear]);
  const targetTerm = await db.get('SELECT * FROM terms WHERE id = ? AND academic_year_id = ?', [toTerm, toYear]);
  if (!targetYear || !targetTerm) throw new AppError(404, 'The target academic period was not found.');

  const sourcePeriod = await resolvePeriod({ academicYearId: fromYear, termId: fromTerm });

  let nextClassId = classIdNum;
  let nextClassName = klass.name;
  if (promoteToNextClass) {
    const next = await db.get(
      `SELECT id, name FROM classes
       WHERE level_order > ?
       ORDER BY level_order ASC
       LIMIT 1`,
      [Number(klass.level_order || 0)]
    );
    if (!next) {
      throw new AppError(400, `${klass.name} is already the highest class, so it cannot be promoted further.`);
    }
    nextClassId = next.id;
    nextClassName = next.name;
  }

  const students = await db.query(
    `SELECT se.id AS enrolment_id, s.id AS student_id, s.first_name, s.last_name
     FROM student_enrolments se
     INNER JOIN students s ON s.id = se.student_id
     WHERE se.class_id = ? AND se.academic_year_id = ? AND se.status IN ('enrolled', 'active')
     ORDER BY s.last_name ASC`,
    [classIdNum, sourcePeriod.yearId]
  );
  if (!students.length) throw new AppError(400, 'No students are enrolled in that class for the selected period.');

  let moved = 0;
  let graduated = 0;

  await db.withTransaction(async (tx) => {
    for (const s of students) {
      const existingTarget = await tx.get(
        'SELECT id FROM student_enrolments WHERE student_id = ? AND academic_year_id = ?',
        [s.student_id, toYear]
      );
      if (existingTarget) {
        await tx.run(
          `UPDATE student_enrolments
           SET class_id = ?, term_id = ?, status = 'enrolled', enrolled_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [nextClassId, toTerm, existingTarget.id]
        );
      } else {
        await tx.run(
          `INSERT INTO student_enrolments (student_id, class_id, academic_year_id, term_id, status)
           VALUES (?, ?, ?, ?, 'enrolled')`,
          [s.student_id, nextClassId, toYear, toTerm]
        );
      }
      moved += 1;
    }

    if (promoteToNextClass && nextClassId !== classIdNum) {
      // Leave the outgoing year's enrolment rows intact as history
      await tx.run(
        `UPDATE student_enrolments
         SET status = 'completed'
         WHERE class_id = ? AND academic_year_id = ? AND status IN ('enrolled', 'active')`,
        [classIdNum, sourcePeriod.yearId]
      );
      graduated = moved;
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'CLASS_PROMOTED',
        targetType: 'class',
        targetId: String(classIdNum),
        ipAddress,
        metadata: {
          fromClassId: classIdNum,
          toClassId: nextClassId,
          fromYearId: sourcePeriod.yearId,
          fromTermId: sourcePeriod.termId,
          toYearId: toYear,
          toTermId: toTerm,
          students: moved,
        },
      },
      tx
    );
  });

  return {
    message:
      nextClassId === classIdNum
        ? `${moved} students rolled into ${targetYear.name} - ${targetTerm.name}.`
        : `${moved} students promoted from ${klass.name} to ${nextClassName} for ${targetYear.name} - ${targetTerm.name}.`,
    moved,
    graduated,
    fromClassId: classIdNum,
    toClassId: nextClassId,
    toClassName: nextClassName,
    academicYearId: toYear,
    termId: toTerm,
  };
}

module.exports = {
  generateClassReportCards,
  listClassReportCards,
  getStudentReportCard,
  saveReportCardRemark,
  listStudentReportCards,
  promoteClass,
  resolvePeriod,
  listPeriods,
};
