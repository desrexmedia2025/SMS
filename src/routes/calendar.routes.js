const express = require('express');
const ctrl = require('../controllers/calendar.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// Every signed-in role gets a strictly scoped calendar feed for its own dashboard overview
router.use(authenticate);
router.get('/events', ctrl.getEvents);

module.exports = router;
