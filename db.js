'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'lunapark.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  barcode    TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  age        INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  blocked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Всяко плащане на вход (само за статистика, не е паричен оборот)
CREATE TABLE IF NOT EXISTS visits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT NOT NULL REFERENCES cards(barcode),
  amount  REAL NOT NULL,
  points  INTEGER NOT NULL DEFAULT 0,
  station TEXT NOT NULL DEFAULT '',
  ts      TEXT NOT NULL,
  voided  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visits_barcode ON visits(barcode);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);

CREATE TABLE IF NOT EXISTS games (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  points     INTEGER NOT NULL DEFAULT 10,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Всяко изиграване на игра и спечелени точки
CREATE TABLE IF NOT EXISTS plays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode   TEXT NOT NULL REFERENCES cards(barcode),
  game_id   INTEGER NOT NULL REFERENCES games(id),
  game_name TEXT NOT NULL,
  points    INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  voided    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plays_barcode ON plays(barcode);
CREATE INDEX IF NOT EXISTS idx_plays_ts ON plays(ts);

CREATE TABLE IF NOT EXISTS products (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  points   INTEGER NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1,
  sort     INTEGER NOT NULL DEFAULT 0
);

-- Покупки в зоната за хранене (харчене на точки)
CREATE TABLE IF NOT EXISTS purchases (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT NOT NULL REFERENCES cards(barcode),
  total   INTEGER NOT NULL,
  station TEXT NOT NULL DEFAULT '',
  ts      TEXT NOT NULL,
  voided  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchases_barcode ON purchases(barcode);
CREATE INDEX IF NOT EXISTS idx_purchases_ts ON purchases(ts);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  product_id  INTEGER,
  name        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  points      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_purchase ON purchase_items(purchase_id);

-- Ръчни корекции на точки от администратор
CREATE TABLE IF NOT EXISTS adjustments (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT NOT NULL REFERENCES cards(barcode),
  points  INTEGER NOT NULL,
  reason  TEXT NOT NULL DEFAULT '',
  ts      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adj_barcode ON adjustments(barcode);
`);

const DEFAULT_SETTINGS = {
  park_name: 'Лунапарк',
  entry_fee: '20',
  entry_points: '0',
  currency: '€',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, DB_FILE };
