const express = require('express');
const ctrl = require('../controllers/message.controller');
const { authenticate } = require('../middleware/authenticate');
const { verifyCsrfToken } = require('../middleware/csrfProtection');
const { uploadAttachments } = require('../config/upload');

const router = express.Router();

router.use(authenticate);

// Internal messaging & notification bell - available to every signed-in role
router.get('/unread', ctrl.unread);
router.post('/read-all', verifyCsrfToken, ctrl.markAllRead);
router.get('/recipients', ctrl.getRecipients);
router.get('/threads', ctrl.listThreads);
router.post('/threads', verifyCsrfToken, uploadAttachments, ctrl.createThread);
router.get('/threads/:id', ctrl.getThread);
router.post('/threads/:id/reply', verifyCsrfToken, uploadAttachments, ctrl.reply);
router.post('/threads/:id/read', verifyCsrfToken, ctrl.markRead);

module.exports = router;
