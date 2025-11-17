// migrate-employee-photo-pin.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./avian-time.db');

function addColumn(sql) {
  db.run(sql, err => {
    if (err && !/duplicate column name/.test(err.message)) {
      console.error('ERROR:', err.message);
    } else {
      console.log('OK:', sql);
    }
  });
}

db.serialize(() => {
  addColumn(`ALTER TABLE employees ADD COLUMN pin TEXT`);
  addColumn(`ALTER TABLE employees ADD COLUMN require_photo INTEGER DEFAULT 0`);
  addColumn(`ALTER TABLE time_punches ADD COLUMN clock_in_photo TEXT`);
});

db.close();
