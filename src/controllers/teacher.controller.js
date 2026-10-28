const teacherService = require('../services/teacher.service');
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
  const streamId = optionalPositiveInt(req.query.streamId);
  const data = await teacherService.getClassList(req.user, { classId, streamId });
  return res.json({ ok: true, ...data });
}

async function getAttendanceSession(req, res) {
  const classId = requirePositiveInt(req.query.classId, 'Class');
  const streamId = optionalPositiveInt(req.query.streamId);
  const subjectId = optionalPositiveInt(req.query.subjectId);
  const sessionDate = requireString(req.query.sessionDate, 'Session date', { min: 8, max: 20 });
  const data = await teacherService.getAttendanceSessionDetails(req.user, {
    classId,
    streamId,
    subjectId,
    sessionDate,
  });
  return res.json({ ok: true, ...data });
}

async function submitAttendance(req, res) {
  const result = await teacherService.submitAttendance(req.user, {
    classId: requirePositiveInt(req.body.classId, 'Class'),
    streamId: optionalPositiveInt(req.body.streamId),
    subjectId: optionalPositiveInt(req.body.subjectId),
    sessionDate: requireString(req.body.sessionDate, 'Session date', { min: 8, max: 20 }),
    notes: optionalString(req.body.notes, 255),
    entries: req.body.entries,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
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
      streamId: optionalPositiveInt(req.body.streamId),
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

module.exports = {
  getOverview,
  getClassList,
  getAttendanceSession,
  submitAttendance,
  createAssessment,
  getMarksheet,
  submitMarks,
  requestMarkCorrection,
  getProgressReports,
  updateProfile,
};
