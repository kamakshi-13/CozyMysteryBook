'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'cozymystrybook.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),
  coins INTEGER NOT NULL DEFAULT 0,
  room_layout TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS booklets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publish_date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','published','archived')),
  content_json TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '[]',
  generator TEXT NOT NULL DEFAULT 'built-in',
  youtube_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_booklets_date_status ON booklets(publish_date,status);
CREATE TABLE IF NOT EXISTS puzzle_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booklet_id INTEGER NOT NULL REFERENCES booklets(id) ON DELETE CASCADE,
  puzzle_key TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, booklet_id, puzzle_key)
);
CREATE TABLE IF NOT EXISTS case_solves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booklet_id INTEGER NOT NULL REFERENCES booklets(id) ON DELETE CASCADE,
  solved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, booklet_id)
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id,item_id)
);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${key}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, keyHex] = String(stored).split(':');
    if (!salt || !keyHex) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(keyHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
const adminUsername = process.env.ADMIN_USERNAME || 'keeper';
const admin = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(adminUsername);
if (!admin) {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (adminPassword.length < 16) {
    throw new Error('First run setup required: set ADMIN_PASSWORD in your local .env file to a unique password of at least 16 characters, then start the server again.');
  }
  db.prepare('INSERT INTO users(username,password_hash,role,coins) VALUES(?,?,?,?)')
    .run(adminUsername, hashPassword(adminPassword), 'admin', 50);
}

module.exports = { db, hashPassword, verifyPassword };
