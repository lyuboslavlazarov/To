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

-- Замяна на изгубена карта: всичко от старата се прехвърля на новата
CREATE TABLE IF NOT EXISTS card_replacements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  old_barcode TEXT NOT NULL,
  new_barcode TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  ts          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repl_new ON card_replacements(new_barcode);
CREATE INDEX IF NOT EXISTS idx_repl_old ON card_replacements(old_barcode);
`);

// Миграция на по-стари бази: колона „заменена с“
// Телефони (клиентското приложение), свързани с карта
db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  barcode    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cs_barcode ON customer_sessions(barcode);`);

// Вид на потребителя: 'card' – напечатана карта, 'virtual' – регистриран в приложението (виртуална карта)
if (!db.prepare("SELECT 1 FROM pragma_table_info('cards') WHERE name='kind'").get()) {
  db.exec("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'card'");
}
// Физическа карта, свързана към профил (напр. резервна карта на виртуален потребител)
if (!db.prepare("SELECT 1 FROM pragma_table_info('cards') WHERE name='linked_to'").get()) {
  db.exec('ALTER TABLE cards ADD COLUMN linked_to TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_cards_linked ON cards(linked_to)');
if (!db.prepare("SELECT 1 FROM pragma_table_info('cards') WHERE name='replaced_by'").get()) {
  db.exec('ALTER TABLE cards ADD COLUMN replaced_by TEXT');
}

const DEFAULT_SETTINGS = {
  park_name: 'Лунапарк',
  entry_fee: '20',
  entry_points: '0',
  currency: '€',
  plays_per_entry: '10',     // игри за едно платено влизане (0 = без ограничение)
  plays_expire_daily: '1',   // 1 = неизползваните игри изгарят в края на деня
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
