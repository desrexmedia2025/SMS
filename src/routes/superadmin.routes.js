const express = require('express');
const ctrl = require('../controllers/superadmin.controller');
const profileCtrl = require('../controllers/profile.controller');
const { uploadAvatar } = require('../config/upload');
const { authenticate } = require('../middleware/authenticate');
const { authorizeRole } = require('../middleware/authorizeRole');
const { verifyCsrfToken } = require('../middleware/csrfProtection');

const router = express.Router();

router.use(authenticate, authorizeRole('superadmin'));

router.get('/overview', ctrl.getOverview);
router.get('/analytics', ctrl.getAnalytics);
router.get('/users', ctrl.listUsers);
router.post('/users', verifyCsrfToken, ctrl.createUser);
router.patch('/users/:id', verifyCsrfToken, ctrl.updateUser);
// Centralised record editing: staff accounts, teacher records and student records.
router.patch('/users/:id/profile', verifyCsrfToken, ctrl.updateStaff);
router.post('/users/:id/unlock', verifyCsrfToken, ctrl.unlockUser);
router.post('/users/:id/avatar', verifyCsrfToken, uploadAvatar, profileCtrl.setUserAvatar);
router.delete('/users/:id/avatar', verifyCsrfToken, profileCtrl.clearUserAvatar);

// Report cards & end-of-term / end-of-year rollover
router.post('/reports/report-cards/generate', verifyCsrfToken, ctrl.generateReportCards);
router.get('/reports/report-cards', ctrl.listReportCards);
router.get('/reports/report-cards/student/:studentId', ctrl.getReportCard);
router.post('/reports/report-cards/remark', verifyCsrfToken, ctrl.saveReportCardRemark);
router.post('/reports/promote-class', verifyCsrfToken, ctrl.promoteClass);

// School-wide calendar events (holidays, PTA meetings, exam weeks, sports day, ...)
router.get('/events', ctrl.listSchoolEvents);
router.post('/events', verifyCsrfToken, ctrl.createSchoolEvent);
router.patch('/events/:id', verifyCsrfToken, ctrl.updateSchoolEvent);
router.delete('/events/:id', verifyCsrfToken, ctrl.deleteSchoolEvent);

router.get('/academic', ctrl.getAcademicSetup);
router.post('/academic/years', verifyCsrfToken, ctrl.createAcademicYear);
router.post('/academic/terms', verifyCsrfToken, ctrl.createTerm);
router.post('/academic/activate', verifyCsrfToken, ctrl.activatePeriod);
router.post('/academic/classes', verifyCsrfToken, ctrl.createClass);
router.post('/academic/subjects', verifyCsrfToken, ctrl.createSubject);

router.get('/teachers', ctrl.listTeachers);
router.post('/teachers', verifyCsrfToken, ctrl.createTeacher);
router.put('/teachers/:id/subjects', verifyCsrfToken, ctrl.updateTeacherSubjects);
router.patch('/teachers/:id', verifyCsrfToken, ctrl.updateTeacher);
router.post('/teachers/assign', verifyCsrfToken, ctrl.assignTeacher);

router.get('/students', ctrl.listStudents);
router.post('/students', verifyCsrfToken, ctrl.enrolStudent);
router.patch('/students/:id', verifyCsrfToken, ctrl.updateStudent);
router.get('/student-requests', ctrl.listStudentRequests);
router.post('/student-requests/:id/review', verifyCsrfToken, ctrl.reviewStudentRequest);

router.get('/timetables', ctrl.listTimetables);
router.post('/timetables', verifyCsrfToken, ctrl.createTimetable);

router.get('/attendance', ctrl.getAttendanceOverview);
router.get('/exams', ctrl.getExamsGovernance);
router.post('/exams/grading-scales', verifyCsrfToken, ctrl.createGradingScale);
router.delete('/exams/grading-scales/:id', verifyCsrfToken, ctrl.deleteGradingScale);
router.patch('/exams/assessments/:id/publish', verifyCsrfToken, ctrl.togglePublication);
router.post('/exams/corrections/:id/review', verifyCsrfToken, ctrl.reviewMarkCorrection);
router.post('/profile-requests/:id/review', verifyCsrfToken, ctrl.reviewProfileChange);

router.post('/announcements', verifyCsrfToken, ctrl.createAnnouncement);

router.get('/settings', ctrl.getSettings);
router.put('/settings', verifyCsrfToken, ctrl.updateSettings);
router.patch('/settings/currency', verifyCsrfToken, ctrl.switchCurrency);

router.get('/reports', ctrl.getReports);
router.get('/audit-logs', ctrl.listAuditLogs);
router.get('/backups', ctrl.getBackups);
router.post('/backups', verifyCsrfToken, ctrl.createBackup);
router.get('/backups/:filename', ctrl.downloadBackup);

// Superadmin Financial Stats & Ledger Controls
router.get('/finance/stats', ctrl.getFinancialStats);
router.put('/finance/stats-config', verifyCsrfToken, ctrl.updateFinancialStatsConfig);
router.patch('/finance/assignments/:id', verifyCsrfToken, ctrl.updateFeeAssignment);
router.delete('/finance/assignments/:id', verifyCsrfToken, ctrl.deleteFeeAssignment);
router.post('/finance/payments/:id/reverse', verifyCsrfToken, ctrl.reversePayment);

module.exports = router;
