const express = require('express');
const ctrl = require('../controllers/notes.controller');
const { authenticate } = require('../middleware/authenticate');
const { verifyCsrfToken } = require('../middleware/csrfProtection');
const { uploadAttachments } = require('../config/upload');

const router = express.Router();

// Personal notes: every signed-in role gets the same private notebook
router.use(authenticate);

router.get('/', ctrl.listNotes);
router.post('/', verifyCsrfToken, ctrl.createNote);
router.patch('/:id', verifyCsrfToken, ctrl.updateNote);
router.delete('/:id', verifyCsrfToken, ctrl.deleteNote);
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', verifyCsrfToken, uploadAttachments, ctrl.addAttachments);
router.delete('/:id/attachments/:attachmentId', verifyCsrfToken, ctrl.deleteAttachment);

module.exports = router;
