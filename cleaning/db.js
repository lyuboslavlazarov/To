'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'cleaning.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

-- Акаунти. club_status: none | pending (заявен) | active | restricted (ограничен ръчно)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer',
  blocked       INTEGER NOT NULL DEFAULT 0,
  club_status   TEXT NOT NULL DEFAULT 'none',
  club_since    TEXT,
  club_until    TEXT,
  club_requested_at TEXT,
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Плащания на клубния абонамент (въвеждат се ръчно от администратора)
CREATE TABLE IF NOT EXISTS club_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     REAL NOT NULL,
  months     INTEGER NOT NULL,
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  short       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  usage       TEXT NOT NULL DEFAULT '',   -- как се използва
  technique   TEXT NOT NULL DEFAULT '',   -- техника от опита
  tips        TEXT NOT NULL DEFAULT '',   -- съвети / предупреждения
  price       REAL NOT NULL DEFAULT 0,
  image       TEXT NOT NULL DEFAULT '🧴', -- емоджи или адрес на снимка
  video_url   TEXT NOT NULL DEFAULT '',   -- обучително видео (YouTube)
  eco_money   REAL NOT NULL DEFAULT 0,    -- спестени € спрямо обикновен препарат (на брой)
  eco_plastic INTEGER NOT NULL DEFAULT 0, -- спестена пластмаса, грамове (на брой)
  eco_chem    INTEGER NOT NULL DEFAULT 0, -- избегнати агресивни химикали, грамове (на брой)
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Дати и място за вземане на поръчките (настройват се от администратора)
CREATE TABLE IF NOT EXISTS pickup_slots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,
  time_from TEXT NOT NULL DEFAULT '',
  time_to   TEXT NOT NULL DEFAULT '',
  location  TEXT NOT NULL DEFAULT '',
  capacity  INTEGER NOT NULL DEFAULT 0,  -- 0 = без ограничение
  note      TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pickup_date ON pickup_slots(date);

-- status: ordered (поръчана) | arrived (пристигнала) | delivered (предадена) | cancelled; paid – отделно
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'ordered',
  paid           INTEGER NOT NULL DEFAULT 0,
  pickup_slot_id INTEGER REFERENCES pickup_slots(id),
  pickup_date    TEXT NOT NULL DEFAULT '',
  pickup_time    TEXT NOT NULL DEFAULT '',
  pickup_location TEXT NOT NULL DEFAULT '',
  subtotal       REAL NOT NULL,
  discount_pct   REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  admin_note     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  arrived_at     TEXT,
  delivered_at   TEXT,
  paid_at        TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name       TEXT NOT NULL,
  price      REAL NOT NULL,
  qty        INTEGER NOT NULL,
  eco_money  REAL NOT NULL DEFAULT 0,
  eco_plastic INTEGER NOT NULL DEFAULT 0,
  eco_chem   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ts       TEXT NOT NULL,
  change   TEXT NOT NULL
);

-- Училище: workshop (уъркшоп на живо) | presentation (онлайн презентация) | live (YouTube на живо) | recording (запис)
CREATE TABLE IF NOT EXISTS school_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',   -- линк към онлайн презентация (Zoom, Meet...)
  starts_at   TEXT NOT NULL DEFAULT '',   -- 'ГГГГ-ММ-ДД ЧЧ:ММ'
  location    TEXT NOT NULL DEFAULT '',
  seats       INTEGER NOT NULL DEFAULT 0, -- 0 = без ограничение
  price       REAL NOT NULL DEFAULT 0,
  club_only   INTEGER NOT NULL DEFAULT 0,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_signups (
  item_id    INTEGER NOT NULL REFERENCES school_items(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  attended   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, user_id)
);

-- Консултации: часовете се отварят от администратора, клиентът избира дата и час
CREATE TABLE IF NOT EXISTS consult_slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at  TEXT NOT NULL,                   -- 'ГГГГ-ММ-ДД ЧЧ:ММ'
  duration   INTEGER NOT NULL DEFAULT 30,
  mode       TEXT NOT NULL DEFAULT 'online',  -- online | onsite
  status     TEXT NOT NULL DEFAULT 'free',    -- free | booked | done | cancelled
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  topic      TEXT NOT NULL DEFAULT '',
  booked_at  TEXT,
  admin_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consult_start ON consult_slots(starts_at);

-- Известия: user_id NULL = до всички (audience: all | club)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  audience   TEXT NOT NULL DEFAULT 'user',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  dedupe     TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, dedupe);
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notif_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notif_id)
);

-- Точки (геймификация). key пази от двойно начисляване.
CREATE TABLE IF NOT EXISTS points_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points  INTEGER NOT NULL,
  reason  TEXT NOT NULL,
  key     TEXT NOT NULL,
  ts      TEXT NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  page       TEXT NOT NULL DEFAULT '',
  rating     INTEGER,
  message    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

const DEFAULTS = {
  shop_name: 'Чист Дом Клуб',
  owner_name: '',
  tagline: 'Почистване с опит, техника и грижа за природата',
  club_price: '10',
  club_discount_pct: '10',
  club_auto_expire: '0',   // 0 = достъпът се ограничава само ръчно; приложението само известява
  expiry_warn_days: '5',
  pickup_location: '',
  contact_phone: '',
  youtube_channel: '',
};
const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx, DB_FILE };
