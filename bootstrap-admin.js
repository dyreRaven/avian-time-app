// bootstrap-admin.js
// One-time script to create the first admin user

const bcrypt = require('bcryptjs');       // same lib used in server.js
const db = require('./db');              // same SQLite db as the app

// TODO: change these to whatever you want
const ADMIN_EMAIL = 'lisett.r@aviangp.com';
const ADMIN_PASSWORD = '123123';

const normEmail = (ADMIN_EMAIL || '').trim().toLowerCase();

if (!normEmail || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD inside bootstrap-admin.js first.');
  process.exit(1);
}

const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

db.run(
  `
    INSERT INTO users (email, password_hash, employee_id)
    VALUES (?, ?, NULL)
  `,
  [normEmail, password_hash],
  function (err) {
    if (err) {
      console.error('Error inserting bootstrap admin:', err.message);
      process.exit(1);
    }

    console.log('✅ Bootstrap admin created.');
    console.log('   id:     ', this.lastID);
    console.log('   email:  ', normEmail);
    console.log('   password (plaintext you chose):', ADMIN_PASSWORD);

    process.exit(0);
  }
);
