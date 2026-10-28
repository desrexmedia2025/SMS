const db = require('../config/database');

async function resolveGradeForPercentage(percentage, runner = db) {
  const pct = Math.max(0, Math.min(100, Number(percentage || 0)));
  const scales = await runner.query('SELECT * FROM grading_scales ORDER BY min_score DESC');
  for (const s of scales) {
    if (pct >= Number(s.min_score) && pct <= Number(s.max_score) + 0.009) {
      return { grade: s.grade, remark: s.remark, gradePoint: Number(s.grade_point) };
    }
  }
  const fallback = scales[scales.length - 1];
  return fallback
    ? { grade: fallback.grade, remark: fallback.remark, gradePoint: Number(fallback.grade_point) }
    : { grade: 'N/A', remark: '', gradePoint: 0 };
}

async function getTeacherAssignments(teacherId, academicYearId = null) {
  const params = [teacherId];
  let whereYear = '';
  if (academicYearId) {
    whereYear = 'AND ta.academic_year_id = ?';
    params.push(academicYearId);
  }
  return db.query(
    `SELECT
       ta.*,
       c.name AS class_name,
       sub.code AS subject_code,
       sub.name AS subject_name,
       sub.pass_mark,
       sub.max_mark,
       ay.name AS academic_year_name,
       tr.name AS term_name
     FROM teacher_assignments ta
     INNER JOIN classes c ON c.id = ta.class_id
     INNER JOIN subjects sub ON sub.id = ta.subject_id
     INNER JOIN academic_years ay ON ay.id = ta.academic_year_id
     LEFT JOIN terms tr ON tr.id = ta.term_id
     WHERE ta.teacher_id = ? ${whereYear}
     ORDER BY c.level_order ASC, sub.name ASC`,
    params
  );
}

async function isTeacherAssignedTo({ teacherId, classId, subjectId = null }) {
  const params = [teacherId, classId];
  let extra = '';
  if (subjectId) {
    extra += ' AND ta.subject_id = ?';
    params.push(subjectId);
  }
  const row = await db.get(
    `SELECT ta.id
     FROM teacher_assignments ta
     WHERE ta.teacher_id = ? AND ta.class_id = ? ${extra}
     LIMIT 1`,
    params
  );
  return Boolean(row);
}

async function getStudentsInClass({ classId, academicYearId = null }) {
  const params = [classId];
  let filters = '';
  if (academicYearId) {
    filters += ' AND se.academic_year_id = ?';
    params.push(academicYearId);
  }
  return db.query(
    `SELECT
       s.id AS student_id,
       s.admission_number,
       s.first_name,
       s.last_name,
       s.gender,
       s.date_of_birth,
       s.guardian_name,
       s.guardian_phone,
       s.status AS student_status,
       se.roll_number,
       se.class_id,
       c.name AS class_name
     FROM student_enrolments se
     INNER JOIN students s ON s.id = se.student_id
     INNER JOIN classes c ON c.id = se.class_id
     WHERE se.class_id = ? AND se.status IN ('enrolled', 'active') AND s.status = 'active' ${filters}
     ORDER BY s.last_name ASC, s.first_name ASC`,
    params
  );
}

module.exports = {
  resolveGradeForPercentage,
  getTeacherAssignments,
  isTeacherAssignedTo,
  getStudentsInClass,
};
