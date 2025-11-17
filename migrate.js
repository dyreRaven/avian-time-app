const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'avian-time.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log("Running migrations...");

  db.run(`ALTER TABLE employees ADD COLUMN nickname TEXT;`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding nickname column:", err.message);
    } else {
      console.log("nickname column added or already exists.");
    }
  });

  db.run(`ALTER TABLE employees ADD COLUMN name_on_checks TEXT;`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding name_on_checks column:", err.message);
    } else {
      console.log("name_on_checks column added or already exists.");
    }
  });
});

db.run(
  `ALTER TABLE employees ADD COLUMN active INTEGER DEFAULT 1;`,
  (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding active column:", err.message);
    } else {
      console.log("active column added or already exists.");
    }
  }
);

db.close(() => {
  console.log("Migration finished.");
});
