const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const superadminService = require('../services/superadmin.service');
const financialService = require('../services/financial.service');
const systemModel = require('../models/system.model');
const { recordAudit } = require('../services/audit.service');
const { AppError } = require('../middleware/errorHandler');
const {
  requireString,
  optionalString,
  requireEmail,
  requireStrongPassword,
  requirePositiveInt,
  optionalPositiveInt,
  requireMoney,
  requireSignedMoney,
  requireEnum,
} = require('../validators/schemas');

function generateTemporaryPassword() {
  return `Sms#${crypto.randomBytes(6).toString('hex')}9A!`;
}

async function getOverview(_req, res) {
  const data = await superadminService.getOverview();
  return res.json({ ok: true, ...data });
}

async function getAnalytics(req, res) {
  const data = await superadminService.getSiteAnalytics(req.query);
  return res.json({ ok: true, analytics: data });
}

async function listUsers(req, res) {
  const data = await superadminService.listUsers(req.query);
  return res.json({ ok: true, ...data });
}

async function createUser(req, res) {
  const username = requireString(req.body.username, 'Username', { min: 3, max: 60 });
  const email = requireEmail(req.body.email);
  const fullName = requireString(req.body.fullName, 'Full name', { min: 2, max: 140 });
  const rawPw = optionalString(req.body.password, 160);
  const password = rawPw ? requireStrongPassword(rawPw, 'Password') : generateTemporaryPassword();
  const roleSlug = requireEnum(req.body.role, ['superadmin', 'teacher', 'student', 'financial'], 'Role');
  const phone = optionalString(req.body.phone, 50);

  const created = await superadminService.createUserAccount({
    username,
    email,
    fullName,
    phone,
    password,
    roleSlug,
    staffNumber: optionalString(req.body.staffNumber, 40),
    department: optionalString(req.body.department, 100),
    qualification: optionalString(req.body.qualification, 120),
    subjectIds: req.body.subjectIds,
    customSubjects: req.body.customSubjects,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    issuedCredentials: {
      fullName,
      role: roleSlug,
      email: created.email,
      username: created.username,
      initialPassword: password,
    },
  });
}

async function updateUser(req, res) {
  const targetUserId = requirePositiveInt(req.params.id, 'User ID');
  const roleSlug = req.body.role
    ? requireEnum(req.body.role, ['superadmin', 'teacher', 'student', 'financial'], 'Role')
    : null;
  const status = req.body.status
    ? requireEnum(req.body.status, ['active', 'inactive', 'suspended'], 'Status')
    : null;
  const newPassword = req.body.newPassword
    ? requireStrongPassword(req.body.newPassword, 'New password')
    : null;

  await superadminService.updateUserRoleOrStatus({
    targetUserId,
    roleSlug,
    status,
    newPassword,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'User access updated.' });
}

async function unlockUser(req, res) {
  const targetUserId = requirePositiveInt(req.params.id, 'User ID');
  await superadminService.unlockUserAndRevokeSessions({
    targetUserId,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Account unlocked and active sessions revoked.' });
}

async function getAcademicSetup(_req, res) {
  const data = await superadminService.getAcademicSetup();
  return res.json({ ok: true, ...data });
}

async function createAcademicYear(req, res) {
  const created = await superadminService.createAcademicYear({
    name: requireString(req.body.name, 'Academic year name', { min: 4, max: 50 }),
    startDate: requireString(req.body.startDate, 'Start date', { min: 8, max: 20 }),
    endDate: requireString(req.body.endDate, 'End date', { min: 8, max: 20 }),
    isActive: Boolean(req.body.isActive),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function createTerm(req, res) {
  const created = await superadminService.createTerm({
    academicYearId: requirePositiveInt(req.body.academicYearId, 'Academic Year'),
    name: requireString(req.body.name, 'Term name', { min: 2, max: 50 }),
    startDate: requireString(req.body.startDate, 'Start date', { min: 8, max: 20 }),
    endDate: requireString(req.body.endDate, 'End date', { min: 8, max: 20 }),
    isActive: Boolean(req.body.isActive),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function activatePeriod(req, res) {
  await superadminService.activatePeriod({
    academicYearId: optionalPositiveInt(req.body.academicYearId),
    termId: optionalPositiveInt(req.body.termId),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Active academic period updated.' });
}

async function createClass(req, res) {
  const created = await superadminService.createClass({
    name: requireString(req.body.name, 'Class name', { min: 2, max: 60 }),
    levelOrder: Number(req.body.levelOrder || 1),
    capacity: Number(req.body.capacity || 40),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function createSubject(req, res) {
  const created = await superadminService.createSubject({
    code: optionalString(req.body.code, 20),
    name: requireString(req.body.name, 'Subject name', { min: 2, max: 120 }),
    department: optionalString(req.body.department, 100),
    isElective: Boolean(req.body.isElective),
    passMark: Number(req.body.passMark ?? 50),
    maxMark: Number(req.body.maxMark ?? 100),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function listTeachers(req, res) {
  const data = await superadminService.listTeachers(req.query);
  return res.json({ ok: true, ...data });
}

async function createTeacher(req, res) {
  const rawPw = optionalString(req.body.password, 160);
  const password = rawPw ? requireStrongPassword(rawPw, 'Initial password') : generateTemporaryPassword();
  const firstName = requireString(req.body.firstName, 'First name', { min: 2, max: 80 });
  const lastName = requireString(req.body.lastName, 'Last name', { min: 2, max: 80 });
  const created = await superadminService.createTeacher({
    staffNumber: optionalString(req.body.staffNumber, 40),
    firstName,
    lastName,
    email: requireEmail(req.body.email),
    phone: optionalString(req.body.phone, 50),
    password,
    qualification: optionalString(req.body.qualification, 120),
    specialization: optionalString(req.body.specialization, 250),
    department: optionalString(req.body.department, 100),
    hireDate: optionalString(req.body.hireDate, 20),
    subjectIds: req.body.subjectIds,
    customSubjects: req.body.customSubjects,
    classIds: req.body.classIds,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    issuedCredentials: {
      fullName: `${firstName} ${lastName}`,
      role: 'teacher',
      email: created.email,
      username: created.username,
      initialPassword: password,
    },
  });
}

async function updateTeacherSubjects(req, res) {
  const updated = await superadminService.updateTeacherSubjects({
    teacherId: requirePositiveInt(req.params.id, 'Teacher'),
    subjectIds: req.body.subjectIds,
    customSubjects: req.body.customSubjects,
    specialization:
      req.body.specialization !== undefined
        ? optionalString(req.body.specialization, 250)
        : undefined,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...updated });
}

async function assignTeacher(req, res) {
  const hasSubjectIds = Array.isArray(req.body.subjectIds) && req.body.subjectIds.length > 0;
  const hasClassIds = Array.isArray(req.body.classIds) && req.body.classIds.length > 0;
  const allClasses =
    req.body.applyToAllClasses === true ||
    req.body.applyToAllClasses === 'true' ||
    req.body.applyToAllClasses === '1' ||
    req.body.applyToAllClasses === 1;
  const created = await superadminService.assignTeacher({
    teacherId: requirePositiveInt(req.body.teacherId, 'Teacher'),
    classId: !hasClassIds && !allClasses ? requirePositiveInt(req.body.classId, 'Class') : null,
    classIds: hasClassIds ? req.body.classIds : undefined,
    applyToAllClasses: allClasses,
    subjectId: !hasSubjectIds ? requirePositiveInt(req.body.subjectId, 'Subject') : null,
    subjectIds: hasSubjectIds ? req.body.subjectIds : undefined,
    academicYearId: optionalPositiveInt(req.body.academicYearId),
    termId: optionalPositiveInt(req.body.termId),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function listStudents(req, res) {
  const data = await superadminService.listStudents(req.query);
  return res.json({ ok: true, ...data });
}

async function enrolStudent(req, res) {
  const rawPw = optionalString(req.body.password, 160);
  const password = rawPw ? requireStrongPassword(rawPw, 'Initial password') : generateTemporaryPassword();
  const firstName = requireString(req.body.firstName, 'First name', { min: 2, max: 80 });
  const lastName = requireString(req.body.lastName, 'Last name', { min: 2, max: 80 });
  const created = await superadminService.enrolStudent({
    admissionNumber: optionalString(req.body.admissionNumber, 40),
    firstName,
    lastName,
    email: requireEmail(req.body.email),
    password,
    gender: optionalString(req.body.gender, 20),
    dateOfBirth: optionalString(req.body.dateOfBirth, 20),
    guardianName: optionalString(req.body.guardianName, 140),
    guardianPhone: optionalString(req.body.guardianPhone, 50),
    guardianEmail: optionalString(req.body.guardianEmail, 160),
    address: optionalString(req.body.address, 255),
    classId: optionalPositiveInt(req.body.classId),
    academicYearId: optionalPositiveInt(req.body.academicYearId),
    termId: optionalPositiveInt(req.body.termId),
    rollNumber: optionalString(req.body.rollNumber, 30),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    issuedCredentials: {
      fullName: `${firstName} ${lastName}`,
      role: 'student',
      email: created.email,
      username: created.username,
      initialPassword: password,
    },
  });
}

// ---------------- CENTRALISED RECORD EDITING (Students, Teachers & Staff) ----------------
async function updateStudent(req, res) {
  const studentId = requirePositiveInt(req.params.id, 'Student ID');
  const rawPw = optionalString(req.body.password, 160);
  const updated = await superadminService.updateStudentRecord({
    studentId,
    admissionNumber: optionalString(req.body.admissionNumber, 40),
    firstName: req.body.firstName
      ? requireString(req.body.firstName, 'First name', { min: 2, max: 80 })
      : '',
    lastName: req.body.lastName
      ? requireString(req.body.lastName, 'Last name', { min: 2, max: 80 })
      : '',
    email: req.body.email ? requireEmail(req.body.email) : '',
    phone: req.body.phone === undefined ? undefined : optionalString(req.body.phone, 50),
    gender: req.body.gender === undefined ? undefined : optionalString(req.body.gender, 20),
    dateOfBirth:
      req.body.dateOfBirth === undefined ? undefined : optionalString(req.body.dateOfBirth, 20),
    guardianName:
      req.body.guardianName === undefined ? undefined : optionalString(req.body.guardianName, 140),
    guardianPhone:
      req.body.guardianPhone === undefined ? undefined : optionalString(req.body.guardianPhone, 50),
    guardianEmail:
      req.body.guardianEmail === undefined ? undefined : optionalString(req.body.guardianEmail, 160),
    address: req.body.address === undefined ? undefined : optionalString(req.body.address, 255),
    medicalNotes:
      req.body.medicalNotes === undefined ? undefined : optionalString(req.body.medicalNotes, 255),
    status: req.body.status
      ? requireEnum(req.body.status, ['active', 'inactive', 'suspended', 'graduated'], 'Status')
      : '',
    classId: req.body.classId === undefined ? undefined : optionalPositiveInt(req.body.classId),
    newPassword: rawPw ? requireStrongPassword(rawPw, 'New password') : '',
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...updated });
}

async function updateTeacher(req, res) {
  const teacherId = requirePositiveInt(req.params.id, 'Teacher ID');
  const rawPw = optionalString(req.body.password, 160);
  const updated = await superadminService.updateTeacherRecord({
    teacherId,
    staffNumber: optionalString(req.body.staffNumber, 50),
    firstName: req.body.firstName
      ? requireString(req.body.firstName, 'First name', { min: 2, max: 80 })
      : '',
    lastName: req.body.lastName
      ? requireString(req.body.lastName, 'Last name', { min: 2, max: 80 })
      : '',
    email: req.body.email ? requireEmail(req.body.email) : '',
    phone: req.body.phone === undefined ? undefined : optionalString(req.body.phone, 50),
    qualification:
      req.body.qualification === undefined ? undefined : optionalString(req.body.qualification, 120),
    specialization:
      req.body.specialization === undefined
        ? undefined
        : optionalString(req.body.specialization, 120),
    department:
      req.body.department === undefined ? undefined : optionalString(req.body.department, 100),
    hireDate: req.body.hireDate === undefined ? undefined : optionalString(req.body.hireDate, 20),
    status: req.body.status
      ? requireEnum(req.body.status, ['active', 'inactive', 'suspended'], 'Status')
      : '',
    newPassword: rawPw ? requireStrongPassword(rawPw, 'New password') : '',
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...updated });
}

async function updateStaff(req, res) {
  const targetUserId = requirePositiveInt(req.params.id, 'User ID');
  const rawPw = optionalString(req.body.password, 160);
  const updated = await superadminService.updateStaffAccount({
    targetUserId,
    fullName: req.body.fullName
      ? requireString(req.body.fullName, 'Full name', { min: 2, max: 160 })
      : '',
    email: req.body.email ? requireEmail(req.body.email) : '',
    username: req.body.username ? optionalString(req.body.username, 80) : '',
    phone: req.body.phone === undefined ? undefined : optionalString(req.body.phone, 50),
    roleSlug: req.body.role
      ? requireEnum(req.body.role, ['superadmin', 'teacher', 'student', 'financial'], 'Role')
      : '',
    status: req.body.status
      ? requireEnum(req.body.status, ['active', 'inactive', 'suspended'], 'Status')
      : '',
    newPassword: rawPw ? requireStrongPassword(rawPw, 'New password') : '',
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...updated });
}

async function listTimetables(req, res) {
  const items = await superadminService.listTimetables(req.query);
  return res.json({ ok: true, items });
}

async function createTimetable(req, res) {
  const created = await superadminService.createTimetableSlot({
    academicYearId: optionalPositiveInt(req.body.academicYearId),
    termId: optionalPositiveInt(req.body.termId),
    classId: requirePositiveInt(req.body.classId, 'Class'),
    subjectId: requirePositiveInt(req.body.subjectId, 'Subject'),
    teacherId: requirePositiveInt(req.body.teacherId, 'Teacher'),
    dayOfWeek: requireEnum(
      req.body.dayOfWeek,
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      'Day of week'
    ),
    startTime: requireString(req.body.startTime, 'Start time', { min: 4, max: 10 }),
    endTime: requireString(req.body.endTime, 'End time', { min: 4, max: 10 }),
    room: optionalString(req.body.room, 50),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function getAttendanceOverview(_req, res) {
  const data = await superadminService.getAttendanceOverview();
  return res.json({ ok: true, ...data });
}

async function getExamsGovernance(_req, res) {
  const data = await superadminService.getExamsGovernance();
  return res.json({ ok: true, ...data });
}

async function createGradingScale(req, res) {
  const created = await superadminService.createGradingScale({
    grade: requireString(req.body.grade, 'Grade label', { min: 1, max: 10 }),
    minScore: Number(req.body.minScore),
    maxScore: Number(req.body.maxScore),
    gradePoint: Number(req.body.gradePoint ?? 0),
    remark: optionalString(req.body.remark, 80),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function deleteGradingScale(req, res) {
  await superadminService.deleteGradingScale({
    scaleId: requirePositiveInt(req.params.id, 'Grading band ID'),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Grading band removed.' });
}

async function togglePublication(req, res) {
  await superadminService.toggleAssessmentPublication({
    assessmentId: requirePositiveInt(req.params.id, 'Assessment ID'),
    isPublished: Boolean(req.body.isPublished),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Assessment publication updated.' });
}

async function reviewMarkCorrection(req, res) {
  await superadminService.reviewMarkCorrection({
    requestId: requirePositiveInt(req.params.id, 'Request ID'),
    decision: requireEnum(req.body.decision, ['approved', 'rejected'], 'Decision'),
    reviewNote: optionalString(req.body.reviewNote, 255),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Mark correction request processed.' });
}

async function reviewProfileChange(req, res) {
  await superadminService.reviewProfileChangeRequest({
    requestId: requirePositiveInt(req.params.id, 'Request ID'),
    decision: requireEnum(req.body.decision, ['approved', 'rejected'], 'Decision'),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Profile change request processed.' });
}

async function createAnnouncement(req, res) {
  const created = await superadminService.createAnnouncement({
    title: requireString(req.body.title, 'Title', { min: 3, max: 180 }),
    body: requireString(req.body.body, 'Message body', { min: 4, max: 3000 }),
    audience: requireEnum(req.body.audience || 'all', ['all', 'teachers', 'students', 'financial'], 'Audience'),
    priority: requireEnum(req.body.priority || 'normal', ['normal', 'important', 'urgent'], 'Priority'),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function getSettings(_req, res) {
  const data = await systemModel.getSchoolContext();
  return res.json({ ok: true, ...data });
}

async function updateSettings(req, res) {
  const rawGoogleEnabled =
    req.body.googleOauthEnabled !== undefined
      ? req.body.googleOauthEnabled
      : req.body.googleOAuthEnabled;

  const data = await superadminService.updateSchoolSettings(
    {
      schoolName: requireString(req.body.schoolName, 'School name', { min: 2, max: 180 }),
      schoolCode: optionalString(req.body.schoolCode, 40) || 'SMS',
      motto: optionalString(req.body.motto, 255),
      email: optionalString(req.body.email, 160),
      phone: optionalString(req.body.phone, 60),
      address: optionalString(req.body.address, 255),
      timezone: optionalString(req.body.timezone, 80) || 'Africa/Accra',
      currencyCode: requireString(req.body.currencyCode, 'Currency code', { min: 2, max: 10 }),
      currencySymbol: optionalString(req.body.currencySymbol, 16),
      studentFeePortalEnabled: Boolean(req.body.studentFeePortalEnabled),
      attendanceCutoffTime: optionalString(req.body.attendanceCutoffTime, 10) || '08:30',
      allowTeacherMarkEditAfterPublish: Boolean(req.body.allowTeacherMarkEditAfterPublish),
      googleOauthEnabled:
        rawGoogleEnabled === undefined ? undefined : Boolean(rawGoogleEnabled),
      googleClientId:
        req.body.googleClientId === undefined ? undefined : optionalString(req.body.googleClientId, 255),
      googleClientSecret: optionalString(req.body.googleClientSecret, 255),
      clearGoogleSecret: Boolean(req.body.clearGoogleSecret),
      paystackEnabled:
        req.body.paystackEnabled === undefined ? undefined : Boolean(req.body.paystackEnabled),
      paystackTransfersEnabled:
        req.body.paystackTransfersEnabled === undefined
          ? undefined
          : Boolean(req.body.paystackTransfersEnabled),
      paystackRefundsEnabled:
        req.body.paystackRefundsEnabled === undefined
          ? undefined
          : Boolean(req.body.paystackRefundsEnabled),
      paystackPublicKey:
        req.body.paystackPublicKey === undefined
          ? undefined
          : optionalString(req.body.paystackPublicKey, 255),
      paystackSecretKey: optionalString(req.body.paystackSecretKey, 255),
      paystackWebhookSecret: optionalString(req.body.paystackWebhookSecret, 255),
      clearPaystackSecret: Boolean(req.body.clearPaystackSecret),
    },
    req.user,
    req.ip
  );
  return res.json({ ok: true, ...data });
}

async function switchCurrency(req, res) {
  const currencyCode = requireString(req.body.currencyCode, 'Currency code', { min: 2, max: 10 });
  const currencySymbol = optionalString(req.body.currencySymbol, 16);
  const resolved = await systemModel.updateCurrency({ currencyCode, currencySymbol });
  await recordAudit({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'CURRENCY_CHANGED',
    targetType: 'school_settings',
    targetId: '1',
    ipAddress: req.ip,
    metadata: resolved,
  });
  return res.json({ ok: true, currency: resolved });
}

async function getReports(_req, res) {
  const data = await superadminService.getSchoolWideReports();
  return res.json({ ok: true, ...data });
}

async function listAuditLogs(req, res) {
  const data = await superadminService.listAuditLogs(req.query);
  return res.json({ ok: true, ...data });
}

async function getBackups(_req, res) {
  const data = await superadminService.getBackupStatus();
  return res.json({ ok: true, ...data });
}

async function createBackup(req, res) {
  const backup = await superadminService.triggerBackup(req.user, req.ip);
  return res.status(201).json({ ok: true, backup });
}

async function downloadBackup(req, res) {
  const safeName = path.basename(String(req.params.filename || ''));
  if (!safeName.startsWith('sms_backup_') || !safeName.endsWith('.json')) {
    throw new AppError(400, 'Invalid backup filename.');
  }
  const env = require('../config/environment');
  const fullPath = path.resolve(env.backupsDir || path.resolve(process.cwd(), 'backups'), safeName);
  if (!fs.existsSync(fullPath)) {
    throw new AppError(404, 'Backup snapshot file not found on disk.');
  }
  return res.download(fullPath, safeName);
}

// ---------------- SUPERADMIN FINANCIAL STATS & CONTROLS ----------------
async function getFinancialStats(_req, res) {
  const data = await financialService.getOverview();
  return res.json({ ok: true, ...data });
}

async function updateFinancialStatsConfig(req, res) {
  const updated = await financialService.updateFinancialStatsConfig({
    termRevenueTarget: requireMoney(req.body.termRevenueTarget ?? 0, 'Term revenue target', {
      allowZero: true,
    }),
    openingBalanceAdjustment: requireSignedMoney(
      req.body.openingBalanceAdjustment ?? 0,
      'Opening balance adjustment'
    ),
    billedStatAdjustment: requireSignedMoney(
      req.body.billedStatAdjustment ?? 0,
      'Billed stat adjustment'
    ),
    collectedStatAdjustment: requireSignedMoney(
      req.body.collectedStatAdjustment ?? 0,
      'Collected stat adjustment'
    ),
    paystackEnabled: req.body.paystackEnabled !== false,
    paystackChannels: req.body.paystackChannels || 'card,mobile_money,bank_transfer,ussd',
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...updated });
}

async function updateFeeAssignment(req, res) {
  await financialService.updateFeeAssignmentByAdmin({
    assignmentId: requirePositiveInt(req.params.id, 'Fee assignment ID'),
    amountDue:
      req.body.amountDue !== undefined
        ? requireMoney(req.body.amountDue, 'Amount due', { allowZero: true })
        : undefined,
    discountAmount:
      req.body.discountAmount !== undefined
        ? requireMoney(req.body.discountAmount, 'Discount amount', { allowZero: true })
        : undefined,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Student fee assignment updated.' });
}

async function deleteFeeAssignment(req, res) {
  await financialService.deleteUnpaidFeeAssignmentByAdmin({
    assignmentId: requirePositiveInt(req.params.id, 'Fee assignment ID'),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Unpaid fee assignment removed.' });
}

async function reversePayment(req, res) {
  await financialService.reversePaymentByAdmin({
    paymentId: requirePositiveInt(req.params.id, 'Payment ID'),
    reason: requireString(req.body.reason, 'Reversal reason', { min: 4, max: 255 }),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Payment reversed and student balances recalculated.' });
}

async function listStudentRequests(req, res) {
  const data = await superadminService.listStudentRegistrationRequests(req.query);
  return res.json({ ok: true, ...data });
}

async function reviewStudentRequest(req, res) {
  const requestId = requirePositiveInt(req.params.id, 'Request ID');
  const decision = requireEnum(req.body.decision, ['approved', 'rejected'], 'Decision');
  const admissionNumber = optionalString(req.body.admissionNumber, 40);
  const classId = optionalPositiveInt(req.body.classId);
  const reviewNote = optionalString(req.body.reviewNote, 250);

  const outcome = await superadminService.reviewStudentRegistrationRequest({
    requestId,
    decision,
    admissionNumber,
    classId,
    reviewNote,
    actor: req.user,
    ipAddress: req.ip,
  });

  return res.json({
    ok: true,
    ...outcome,
    message:
      decision === 'approved'
        ? `Student proposal accepted (${outcome.admissionNumber}). Student login is now active.`
        : 'Student join proposal rejected.',
  });
}

module.exports = {
  getOverview,
  getAnalytics,
  listUsers,
  createUser,
  updateUser,
  unlockUser,
  getAcademicSetup,
  createAcademicYear,
  createTerm,
  activatePeriod,
  createClass,
  createSubject,
  listTeachers,
  createTeacher,
  updateTeacherSubjects,
  assignTeacher,
  listStudents,
  enrolStudent,
  updateStudent,
  updateTeacher,
  updateStaff,
  listStudentRequests,
  reviewStudentRequest,
  listTimetables,
  createTimetable,
  getAttendanceOverview,
  getExamsGovernance,
  createGradingScale,
  deleteGradingScale,
  togglePublication,
  reviewMarkCorrection,
  reviewProfileChange,
  createAnnouncement,
  getSettings,
  updateSettings,
  switchCurrency,
  getReports,
  listAuditLogs,
  getBackups,
  createBackup,
  downloadBackup,
  getFinancialStats,
  updateFinancialStatsConfig,
  updateFeeAssignment,
  deleteFeeAssignment,
  reversePayment,
};
