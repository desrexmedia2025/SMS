const express = require('express');
const ctrl = require('../controllers/superadmin.controller');
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
router.post('/users/:id/unlock', verifyCsrfToken, ctrl.unlockUser);

router.get('/academic', ctrl.getAcademicSetup);
router.post('/academic/years', verifyCsrfToken, ctrl.createAcademicYear);
router.post('/academic/terms', verifyCsrfToken, ctrl.createTerm);
router.post('/academic/activate', verifyCsrfToken, ctrl.activatePeriod);
router.post('/academic/classes', verifyCsrfToken, ctrl.createClass);
router.post('/academic/subjects', verifyCsrfToken, ctrl.createSubject);

router.get('/teachers', ctrl.listTeachers);
router.post('/teachers', verifyCsrfToken, ctrl.createTeacher);
router.put('/teachers/:id/subjects', verifyCsrfToken, ctrl.updateTeacherSubjects);
router.post('/teachers/assign', verifyCsrfToken, ctrl.assignTeacher);

router.get('/students', ctrl.listStudents);
router.post('/students', verifyCsrfToken, ctrl.enrolStudent);
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
