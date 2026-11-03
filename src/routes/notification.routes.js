const express = require('express');
const ctrl = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/authenticate');
const { verifyCsrfToken } = require('../middleware/csrfProtection');

const router = express.Router();

router.use(authenticate);

router.get('/', ctrl.listNotifications);
router.post('/read-all', verifyCsrfToken, ctrl.markAllRead);
router.post('/read', verifyCsrfToken, ctrl.markRead);

module.exports = router;
