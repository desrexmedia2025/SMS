const express = require('express');
const ctrl = require('../controllers/financial.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorizeRole } = require('../middleware/authorizeRole');
const { verifyCsrfToken } = require('../middleware/csrfProtection');

const router = express.Router();

// Authorised financial staff + Superadmin financial oversight per Blueprint Role Matrix
router.use(authenticate, authorizeRole('financial', 'superadmin'));

router.get('/overview', ctrl.getOverview);
router.get('/categories', ctrl.listFeeCategories);
router.post('/categories', verifyCsrfToken, ctrl.createFeeCategory);
router.patch('/categories/:id', verifyCsrfToken, ctrl.updateFeeCategory);
router.post('/assignments', verifyCsrfToken, ctrl.assignFee);

router.get('/accounts', ctrl.listStudentAccounts);
router.get('/accounts/:studentId', ctrl.getStudentAccount);

// Paystack Payment Gateway endpoints
router.post('/paystack/initialize', verifyCsrfToken, ctrl.initializePaystack);
router.post('/paystack/verify', verifyCsrfToken, ctrl.verifyPaystack);
router.post('/paystack/abandon', verifyCsrfToken, ctrl.abandonPaystack);
router.get('/paystack/transactions', ctrl.listPaystackTransactions);
router.get('/paystack/transfers', ctrl.listPaystackTransfers);
router.post('/paystack/transfers', verifyCsrfToken, ctrl.sendPaystackTransfer);

// Counter / offline fallback payment, reversals & adjustments
router.post('/payments', verifyCsrfToken, ctrl.recordPayment);
router.post('/payments/:id/reverse', verifyCsrfToken, ctrl.reversePayment);
router.post('/adjustments', verifyCsrfToken, ctrl.applyAdjustment);
router.get('/receipts/:identifier', ctrl.getReceipt);

router.get('/timetable', ctrl.getSchoolTimetable);

router.get('/reports', ctrl.getReports);
router.get('/reconciliations', ctrl.listReconciliations);
router.post('/reconciliations', verifyCsrfToken, ctrl.createReconciliation);
router.get('/audit-logs', ctrl.listAuditLogs);
router.patch('/currency', verifyCsrfToken, ctrl.switchCurrency);

module.exports = router;
