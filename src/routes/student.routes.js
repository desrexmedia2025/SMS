const express = require('express');
const ctrl = require('../controllers/student.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorizeRole } = require('../middleware/authorizeRole');
const { verifyCsrfToken } = require('../middleware/csrfProtection');
const { uploadAttachments } = require('../config/upload');

const router = express.Router();

router.use(authenticate, authorizeRole('student'));

router.get('/overview', ctrl.getOverview);
router.get('/records/:studentId', ctrl.getSpecificStudentGuard);
router.patch('/profile/contact', verifyCsrfToken, ctrl.updateContact);
router.post('/profile/change-request', verifyCsrfToken, ctrl.requestProfileCorrection);

// Student Classwork, Homework, Tests & Exams (Answer & Multimedia Upload Space)
router.get('/coursework', ctrl.listCoursework);
router.post('/coursework/:id/submit', verifyCsrfToken, uploadAttachments, ctrl.submitCoursework);

// Student self-service Paystack fee payment & own receipt access
router.post('/paystack/initialize', verifyCsrfToken, ctrl.initializeOwnPaystackPayment);
router.post('/paystack/verify', verifyCsrfToken, ctrl.verifyOwnPaystackPayment);
router.get('/receipts/:identifier', ctrl.getOwnReceipt);

module.exports = router;
