// Simple persistent session store backed by SQLite.
// Keeps "remember me" logins working across server restarts.
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

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

  const deriveKey = () => {
    const raw =
      process.env.SESSION_ENCRYPTION_KEY ||
      process.env.SESSION_SECRET;
    if (!raw) return null;
    // Derive a 32-byte key
    return crypto.createHash('sha256').update(String(raw)).digest();
  };

  const ENC_PREFIX = 'enc:v1:';
  const encryptValue = (plain) => {
    const key = deriveKey();
    if (!key) return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(String(plain), 'utf8', 'base64');
    enc += cipher.final('base64');
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc}`;
  };

  const decryptValue = (val) => {
    const key = deriveKey();
    if (!key || !val || !val.startsWith(ENC_PREFIX)) return val;
    try {
      const body = val.slice(ENC_PREFIX.length);
      const [ivB64, tagB64, dataB64] = body.split(':');
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      let dec = decipher.update(dataB64, 'base64', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch {
      return null;
    }
  };

  function serializeSession(sess) {
    const cookie = sess && sess.cookie;
    const exp = cookie ? cookie.expires || cookie._expires : null;
    const expires = exp ? new Date(exp).getTime() : null;
    return { sess: encryptValue(JSON.stringify(sess || {})), expires };
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
            const raw = decryptValue(row.sess) || row.sess;
            const sess = JSON.parse(raw);
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
