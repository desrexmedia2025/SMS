const express = require('express');
const ctrl = require('../controllers/teacher.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorizeRole } = require('../middleware/authorizeRole');
const { verifyCsrfToken } = require('../middleware/csrfProtection');
const { uploadAttachments } = require('../config/upload');

const router = express.Router();

router.use(authenticate, authorizeRole('teacher'));

router.get('/overview', ctrl.getOverview);
router.get('/class-list', ctrl.getClassList);
router.get('/attendance/session', ctrl.getAttendanceSession);
router.post('/attendance/session', verifyCsrfToken, ctrl.submitAttendance);

// Coursework: Classwork, Homework, Tests & Exams (with PDF, Image, Video & Document uploads)
router.get('/coursework', ctrl.listCoursework);
router.post('/coursework', verifyCsrfToken, uploadAttachments, ctrl.createCoursework);
router.get('/coursework/:id/submissions', ctrl.getCourseworkSubmissions);
router.post('/coursework/submissions/:submissionId/grade', verifyCsrfToken, ctrl.gradeCourseworkSubmission);
router.delete('/coursework/:id', verifyCsrfToken, ctrl.deleteCoursework);

// Teacher Class Announcements (to any assigned class or all assigned classes)
router.post('/announcements', verifyCsrfToken, ctrl.createClassAnnouncement);
router.delete('/announcements/:id', verifyCsrfToken, ctrl.deleteClassAnnouncement);

router.post('/assessments', verifyCsrfToken, ctrl.createAssessment);
router.get('/assessments/:id/marksheet', ctrl.getMarksheet);
router.post('/assessments/:id/marks', verifyCsrfToken, ctrl.submitMarks);
router.post('/marks/correction-request', verifyCsrfToken, ctrl.requestMarkCorrection);

router.get('/reports', ctrl.getProgressReports);

// Report cards for the teacher's assigned classes (view + teacher remarks)
router.get('/report-cards', ctrl.listReportCards);
router.get('/report-cards/student/:studentId', ctrl.getReportCard);
router.post('/report-cards/remark', verifyCsrfToken, ctrl.saveReportCardRemark);
router.patch('/profile', verifyCsrfToken, ctrl.updateProfile);

module.exports = router;
