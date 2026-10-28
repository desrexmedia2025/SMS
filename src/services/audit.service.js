const db = require('../config/database');
const logger = require('../utils/logger');

async function recordAudit(
  {
    actorUserId = null,
    actorRole = '',
    action,
    targetType = '',
    targetId = '',
    ipAddress = '',
    metadata = null,
  },
  runner = db
) {
  try {
    const cleanMeta = metadata ? JSON.stringify(logger.sanitize(metadata)) : null;
    await runner.run(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, ip_address, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        String(actorRole || ''),
        String(action),
        String(targetType || ''),
        String(targetId || ''),
        String(ipAddress || '').slice(0, 64),
        cleanMeta,
      ]
    );
  } catch (err) {
    logger.error('Failed to write audit log', { action, error: err.message });
  }
}

module.exports = { recordAudit };
