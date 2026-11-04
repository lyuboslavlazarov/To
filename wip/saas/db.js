'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'lunapark.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Базата от първата (еднопотребителска) версия няма tenant_id – не я смесваме с новата схема.
const legacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cards'").get()
  && !db.prepare("SELECT 1 FROM pragma_table_info('cards') WHERE name='tenant_id'").get();
if (legacy) {
  throw new Error(`Базата ${DB_FILE} е от старата еднопотребителска версия. Преместете я или задайте нов DB_FILE.`);
}

db.exec(`
-- ===== Платформа (SaaS) =====
CREATE TABLE IF NOT EXISTS tenants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'trial',
  trial_ends  TEXT,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  pass_hash   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',     -- owner | admin | staff
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  last_login  TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ===== Данни на всеки парк (изолирани по tenant_id) =====
CREATE TABLE IF NOT EXISTS settings (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS cards (
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barcode    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  age        INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  blocked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, barcode)
);

-- Всяко плащане на вход (само за статистика, не е паричен оборот)
CREATE TABLE IF NOT EXISTS visits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barcode   TEXT NOT NULL,
  amount    REAL NOT NULL,
  points    INTEGER NOT NULL DEFAULT 0,
  station   TEXT NOT NULL DEFAULT '',
  user_id   INTEGER,
  ts        TEXT NOT NULL,
  voided    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visits_card ON visits(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(tenant_id, ts);

CREATE TABLE IF NOT EXISTS games (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  points     INTEGER NOT NULL DEFAULT 10,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

-- Всяко изиграване на игра и спечелени точки
CREATE TABLE IF NOT EXISTS plays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barcode   TEXT NOT NULL,
  game_id   INTEGER NOT NULL,
  game_name TEXT NOT NULL,
  points    INTEGER NOT NULL,
  user_id   INTEGER,
  ts        TEXT NOT NULL,
  voided    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plays_card ON plays(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_plays_ts ON plays(tenant_id, ts);
CREATE INDEX IF NOT EXISTS idx_plays_game ON plays(tenant_id, game_id);

CREATE TABLE IF NOT EXISTS products (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL DEFAULT '',
  points    INTEGER NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

-- Покупки в зоната за хранене (харчене на точки)
CREATE TABLE IF NOT EXISTS purchases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barcode   TEXT NOT NULL,
  total     INTEGER NOT NULL,
  station   TEXT NOT NULL DEFAULT '',
  user_id   INTEGER,
  ts        TEXT NOT NULL,
  voided    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchases_card ON purchases(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_purchases_ts ON purchases(tenant_id, ts);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER,
  name        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  points      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_purchase ON purchase_items(purchase_id);

-- Ръчни корекции на точки
CREATE TABLE IF NOT EXISTS adjustments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  barcode   TEXT NOT NULL,
  points    INTEGER NOT NULL,
  reason    TEXT NOT NULL DEFAULT '',
  user_id   INTEGER,
  ts        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adj_card ON adjustments(tenant_id, barcode);
`);

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
