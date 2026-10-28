const session = require('express-session');
const db = require('./database');

class SqlSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.ttlMs = options.ttlMs || 8 * 60 * 60 * 1000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 15 * 60 * 1000;
    this.timer = setInterval(() => {
      this.pruneExpired().catch(() => {});
    }, this.cleanupIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  async pruneExpired() {
    if (!db.getActiveDriver()) return;
    await db.run('DELETE FROM user_sessions WHERE expires_at < ?', [Date.now()]);
  }

  get(sid, callback) {
    db.get('SELECT sess, expires_at FROM user_sessions WHERE sid = ?', [sid])
      .then((row) => {
        if (!row) return callback(null, null);
        if (Number(row.expires_at) < Date.now()) {
          return this.destroy(sid, () => callback(null, null));
        }
        try {
          const parsed = JSON.parse(row.sess);
          return callback(null, parsed);
        } catch (err) {
          return callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback) {
    const expiresAt =
      sess && sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + this.ttlMs;
    const userId = sess && sess.user ? sess.user.id : null;
    const payload = JSON.stringify(sess);

    const driver = db.getActiveDriver();
    const sql =
      driver === 'mysql'
        ? `INSERT INTO user_sessions (sid, user_id, sess, expires_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), sess = VALUES(sess), expires_at = VALUES(expires_at)`
        : `INSERT INTO user_sessions (sid, user_id, sess, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id, sess = excluded.sess, expires_at = excluded.expires_at`;

    db.run(sql, [sid, userId, payload, expiresAt])
      .then(() => callback && callback(null))
      .catch((err) => callback && callback(err));
  }

  destroy(sid, callback) {
    db.run('DELETE FROM user_sessions WHERE sid = ?', [sid])
      .then(() => callback && callback(null))
      .catch((err) => callback && callback(err));
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

module.exports = SqlSessionStore;
