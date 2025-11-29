// Simple persistent session store backed by SQLite.
// Keeps "remember me" logins working across server restarts.
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

module.exports = function createSQLiteStore(session, opts = {}) {
  const Store = session.Store;
  const dbPath = opts.dbPath || path.join(__dirname, 'sessions.db');
  const tableName = opts.tableName || 'sessions';

  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER
      )`
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_expires ON ${tableName}(expires)`
    );
  });

  function serializeSession(sess) {
    const cookie = sess && sess.cookie;
    const exp = cookie ? cookie.expires || cookie._expires : null;
    const expires = exp ? new Date(exp).getTime() : null;
    return { sess: JSON.stringify(sess || {}), expires };
  }

  function pruneExpired(cb) {
    db.run(
      `DELETE FROM ${tableName} WHERE expires IS NOT NULL AND expires < ?`,
      [Date.now()],
      () => cb && cb()
    );
  }

  class SQLiteStore extends Store {
    get(sid, cb = () => {}) {
      db.get(
        `SELECT sess, expires FROM ${tableName} WHERE sid = ?`,
        [sid],
        (err, row) => {
          if (err) return cb(err);
          if (!row) return cb();

          if (row.expires && row.expires < Date.now()) {
            this.destroy(sid, () => cb());
            return;
          }

          try {
            const sess = JSON.parse(row.sess);
            return cb(null, sess);
          } catch (e) {
            return cb(e);
          }
        }
      );
    }

    set(sid, sess, cb = () => {}) {
      pruneExpired();
      const payload = serializeSession(sess);

      db.run(
        `INSERT INTO ${tableName} (sid, sess, expires)
         VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET
           sess = excluded.sess,
           expires = excluded.expires`,
        [sid, payload.sess, payload.expires],
        cb
      );
    }

    destroy(sid, cb = () => {}) {
      db.run(`DELETE FROM ${tableName} WHERE sid = ?`, [sid], cb);
    }

    touch(sid, sess, cb = () => {}) {
      const payload = serializeSession(sess);
      db.run(
        `UPDATE ${tableName}
         SET sess = ?, expires = ?
         WHERE sid = ?`,
        [payload.sess, payload.expires, sid],
        cb
      );
    }
  }

  return new SQLiteStore();
};
