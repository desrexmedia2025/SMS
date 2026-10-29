const calendarService = require('../services/calendar.service');

async function getEvents(req, res) {
  const data = await calendarService.getCalendarEvents(req.user, req.query);
  return res.json({ ok: true, ...data });
}

module.exports = { getEvents };
