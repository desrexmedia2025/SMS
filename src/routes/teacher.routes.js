const express = require('express');
const ctrl = require('../controllers/teacher.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorizeRole } = require('../middleware/authorizeRole');
const { verifyCsrfToken } = require('../middleware/csrfProtection');

const router = express.Router();

router.use(authenticate, authorizeRole('teacher'));

router.get('/overview', ctrl.getOverview);
router.get('/class-list', ctrl.getClassList);
router.get('/attendance/session', ctrl.getAttendanceSession);
router.post('/attendance/session', verifyCsrfToken, ctrl.submitAttendance);

router.post('/assessments', verifyCsrfToken, ctrl.createAssessment);
router.get('/assessments/:id/marksheet', ctrl.getMarksheet);
router.post('/assessments/:id/marks', verifyCsrfToken, ctrl.submitMarks);
router.post('/marks/correction-request', verifyCsrfToken, ctrl.requestMarkCorrection);

router.get('/reports', ctrl.getProgressReports);
router.patch('/profile', verifyCsrfToken, ctrl.updateProfile);

module.exports = router;
