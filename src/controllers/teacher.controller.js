const teacherService = require('../services/teacher.service');
const reportCardService = require('../services/reportCard.service');
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const courseworkService = require('../services/coursework.service');
const {
  requireString,
  optionalString,
  requirePositiveInt,
  optionalPositiveInt,
  requireEnum,
} = require('../validators/schemas');

async function getOverview(req, res) {
  const data = await teacherService.getOverview(req.user);
  return res.json({ ok: true, ...data });
}

async function getClassList(req, res) {
  const classId = requirePositiveInt(req.query.classId, 'Class');
  const data = await teacherService.getClassList(req.user, { classId });
  return res.json({ ok: true, ...data });
}

async function getAttendanceSession(req, res) {
  const classId = requirePositiveInt(req.query.classId, 'Class');
  const subjectId = optionalPositiveInt(req.query.subjectId);
  const sessionDate = requireString(req.query.sessionDate, 'Session date', { min: 8, max: 20 });
  const data = await teacherService.getAttendanceSessionDetails(req.user, {
    classId,
    subjectId,
    sessionDate,
  });
  return res.json({ ok: true, ...data });
}

async function submitAttendance(req, res) {
  const result = await teacherService.submitAttendance(req.user, {
    classId: requirePositiveInt(req.body.classId, 'Class'),
    subjectId: optionalPositiveInt(req.body.subjectId),
    sessionDate: requireString(req.body.sessionDate, 'Session date', { min: 8, max: 20 }),
    notes: optionalString(req.body.notes, 255),
    entries: req.body.entries,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

// ---------------- COURSEWORK (CLASSWORK, HOMEWORK, TEST, EXAM) ----------------
async function listCoursework(req, res) {
  const data = await courseworkService.listTeacherCoursework(req.user, req.query);
  return res.json({ ok: true, ...data });
}

async function createCoursework(req, res) {
  const created = await courseworkService.createCoursework(req.user, {
    workType: req.body.workType,
    subjectId: req.body.subjectId,
    classIds: req.body.classIds,
    applyToAllClasses: req.body.applyToAllClasses,
    title: req.body.title,
    instructions: req.body.instructions,
    maxScore: req.body.maxScore,
    dueAt: req.body.dueAt,
    files: req.files || [],
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, coursework: created });
}

async function getCourseworkSubmissions(req, res) {
  const courseworkId = requirePositiveInt(req.params.id, 'Coursework ID');
  const data = await courseworkService.getCourseworkSubmissions(req.user, courseworkId);
  return res.json({ ok: true, ...data });
}

async function gradeCourseworkSubmission(req, res) {
  const submissionId = requirePositiveInt(req.params.submissionId, 'Submission ID');
  const updated = await courseworkService.gradeSubmission(req.user, {
    submissionId,
    score: req.body.score,
    feedback: req.body.feedback,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, submission: updated });
}

async function deleteCoursework(req, res) {
  const courseworkId = requirePositiveInt(req.params.id, 'Coursework ID');
  await courseworkService.deleteCoursework(req.user, {
    courseworkId,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Coursework deleted.' });
}

// ---------------- TEACHER CLASS ANNOUNCEMENTS ----------------
async function createClassAnnouncement(req, res) {
  const created = await courseworkService.createTeacherClassAnnouncement(req.user, {
    title: req.body.title,
    body: req.body.body,
    priority: req.body.priority,
    classIds: req.body.classIds,
    applyToAllClasses: req.body.applyToAllClasses,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    message: 'Announcement sent to selected class(es).',
  });
}

async function deleteClassAnnouncement(req, res) {
  const announcementId = requirePositiveInt(req.params.id, 'Announcement ID');
  await courseworkService.deleteTeacherClassAnnouncement(req.user, {
    announcementId,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Announcement deleted.' });
}

async function createAssessment(req, res) {
  const created = await teacherService.createAssessment(
    req.user,
    {
      title: requireString(req.body.title, 'Assessment title', { min: 3, max: 160 }),
      assessmentType: requireEnum(
        req.body.assessmentType,
        ['class_test', 'midterm', 'project', 'final_exam'],
        'Assessment type'
      ),
      classId: requirePositiveInt(req.body.classId, 'Class'),
      subjectId: requirePositiveInt(req.body.subjectId, 'Subject'),
      maxScore: Number(req.body.maxScore || 100),
      weightPercent: Number(req.body.weightPercent || 100),
      scheduledDate: optionalString(req.body.scheduledDate, 20),
    },
    req.ip
  );
  return res.status(201).json({ ok: true, ...created });
}

async function getMarksheet(req, res) {
  const assessmentId = requirePositiveInt(req.params.id, 'Assessment ID');
  const data = await teacherService.getAssessmentMarksheet(req.user, assessmentId);
  return res.json({ ok: true, ...data });
}

async function submitMarks(req, res) {
  const assessmentId = requirePositiveInt(req.params.id, 'Assessment ID');
  const result = await teacherService.submitMarks(req.user, {
    assessmentId,
    entries: req.body.entries,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

async function requestMarkCorrection(req, res) {
  const created = await teacherService.submitMarkCorrectionRequest(req.user, {
    markId: requirePositiveInt(req.body.markId, 'Mark ID'),
    proposedScore: Number(req.body.proposedScore),
    reason: requireString(req.body.reason, 'Correction reason', { min: 5, max: 255 }),
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function getProgressReports(req, res) {
  const data = await teacherService.getClassProgressReport(req.user);
  return res.json({ ok: true, ...data });
}

async function updateProfile(req, res) {
  await teacherService.updateOwnProfile(req.user, {
    phone: optionalString(req.body.phone, 50),
    qualification: optionalString(req.body.qualification, 120),
    specialization: optionalString(req.body.specialization, 120),
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Teacher profile updated.' });
}


// ---------------- REPORT CARDS (teacher: class cards + remarks) ----------------
async function listReportCards(req, res) {
  const teacher = await db.get('SELECT id FROM teachers WHERE user_id = ?', [req.user.id]);
  if (!teacher) throw new AppError(403, 'No teacher staff record is linked to your account.');
  const classId = Number(req.query.classId);
  if (!Number.isInteger(classId) || classId <= 0) {
    const periods = await reportCardService.listPeriods();
    return res.json({ ok: true, items: [], ...periods });
  }
  const assigned = await db.get(
    'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? LIMIT 1',
    [teacher.id, classId]
  );
  if (!assigned) throw new AppError(403, 'You can only view report cards for your assigned classes.');
  const data = await reportCardService.listClassReportCards({
    classId,
    academicYearId: req.query.academicYearId,
    termId: req.query.termId,
  });
  return res.json({ ok: true, ...data });
}

async function getReportCard(req, res) {
  const teacher = await db.get('SELECT id FROM teachers WHERE user_id = ?', [req.user.id]);
  if (!teacher) throw new AppError(403, 'No teacher staff record is linked to your account.');
  const studentId = Number(req.params.studentId);
  const student = await db.get(
    `SELECT se.class_id
     FROM student_enrolments se
     WHERE se.student_id = ? AND se.status IN ('enrolled', 'active')
     ORDER BY se.id DESC LIMIT 1`,
    [studentId]
  );
  if (!student) throw new AppError(404, 'Student not found.');
  const assigned = await db.get(
    'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? LIMIT 1',
    [teacher.id, student.class_id]
  );
  if (!assigned) throw new AppError(403, 'That student is not in any of your classes.');
  const data = await reportCardService.getStudentReportCard({
    studentId,
    academicYearId: req.query.academicYearId,
    termId: req.query.termId,
    viewer: req.user,
  });
  return res.json({ ok: true, ...data });
}

async function saveReportCardRemark(req, res) {
  const teacher = await db.get('SELECT id FROM teachers WHERE user_id = ?', [req.user.id]);
  if (!teacher) throw new AppError(403, 'No teacher staff record is linked to your account.');
  if (req.body.headteacherRemark !== undefined && req.body.headteacherRemark !== null) {
    throw new AppError(403, 'Only the Superadmin can sign the head teacher remark.');
  }
  const studentId = Number(req.body.studentId);
  const termId = req.body.termId ? Number(req.body.termId) : null;
  const period = termId ? null : await reportCardService.resolvePeriod({});
  const resolvedTerm = termId || (period && period.termId);
  const enrolment = await db.get(
    `SELECT se.class_id, se.academic_year_id
     FROM student_enrolments se
     WHERE se.student_id = ? AND se.status IN ('enrolled', 'active')
     ORDER BY se.id DESC LIMIT 1`,
    [studentId]
  );
  if (!enrolment) throw new AppError(404, 'Student not found.');
  const assigned = await db.get(
    'SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? LIMIT 1',
    [teacher.id, enrolment.class_id]
  );
  if (!assigned) throw new AppError(403, 'That student is not in any of your classes.');
  const result = await reportCardService.saveReportCardRemark({
    studentId,
    academicYearId: req.body.academicYearId || enrolment.academic_year_id,
    termId: resolvedTerm,
    teacherRemark: req.body.teacherRemark,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

module.exports = {
  getOverview,
  getClassList,
  getAttendanceSession,
  submitAttendance,
  listCoursework,
  createCoursework,
  getCourseworkSubmissions,
  gradeCourseworkSubmission,
  deleteCoursework,
  createClassAnnouncement,
  deleteClassAnnouncement,
  createAssessment,
  getMarksheet,
  submitMarks,
  requestMarkCorrection,
  getProgressReports,
  listReportCards,
  getReportCard,
  saveReportCardRemark,
  updateProfile,
};
