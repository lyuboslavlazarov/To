'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { db, tx, DB_FILE } = require('./db');
const backup = require('./backup');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT === undefined ? 3443 : Number(process.env.HTTPS_PORT); // 0 = без https
let httpsActive = 0;
// Порт само за клиентското приложение (телефоните на посетителите). Само него пускайте към интернет.
const PUBLIC_PORT = process.env.PUBLIC_PORT === undefined ? 3080 : Number(process.env.PUBLIC_PORT); // 0 = изключено
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- помощни ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const today = () => now().slice(0, 10);

function normCode(c) {
  const s = String(c ?? '').trim().toUpperCase();
  if (!s) throw bad('Липсва баркод');
  if (s.length > 64) throw bad('Невалиден баркод');
  return s;
}
function int(v, name, { min = -1e9, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`Невалидна стойност: ${name}`);
  return n;
}
function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

const qBalance = db.prepare(`
SELECT
   (SELECT COALESCE(SUM(points),0) FROM visits      WHERE barcode = ?1 AND voided = 0)
 + (SELECT COALESCE(SUM(points),0) FROM plays       WHERE barcode = ?1 AND voided = 0)
 + (SELECT COALESCE(SUM(points),0) FROM adjustments WHERE barcode = ?1)
 - (SELECT COALESCE(SUM(total),0)  FROM purchases   WHERE barcode = ?1 AND voided = 0) AS balance`);
const balance = (code) => qBalance.get(code).balance;

const qCard = db.prepare('SELECT * FROM cards WHERE barcode = ?');

// Физическа карта, свързана към профил -> профилът. Така и телефонът (виртуалната карта),
// и физическата карта водят към едни и същи точки, игри и история.
function resolveCode(code) {
  const row = qCard.get(code);
  if (row && row.linked_to && !row.replaced_by) return row.linked_to;
  return code;
}
const cardCode = (c) => resolveCode(normCode(c));
const qLinked = db.prepare('SELECT barcode FROM cards WHERE linked_to=? AND replaced_by IS NULL ORDER BY barcode');

// Колко игри остават на картата: всеки платен вход дава plays_per_entry игри.
// При plays_expire_daily=1 се броят само днешните входове и игри (неизползваните изгарят).
function playsInfo(code, s = getSettings()) {
  const per = Number(s.plays_per_entry) || 0;
  if (per <= 0) return { limited: false, per: 0, remaining: null, allowed: null, used: null, entries: null, daily: false };
  const daily = s.plays_expire_daily !== '0';
  const day = daily ? today() : null;
  const W = daily ? 'AND substr(ts,1,10)=?2' : '';
  const r = db.prepare(`SELECT
      (SELECT COUNT(*) FROM visits WHERE barcode=?1 AND voided=0 ${W}) AS entries,
      (SELECT COUNT(*) FROM plays  WHERE barcode=?1 AND voided=0 ${W}) AS used`).get(...(daily ? [code, day] : [code]));
  const allowed = r.entries * per;
  return { limited: true, per, daily, entries: r.entries, allowed, used: r.used, remaining: Math.max(0, allowed - r.used) };
}
function cardSummary(code) {
  const c = qCard.get(code);
  if (!c) return null;
  const s = db.prepare(`SELECT
      (SELECT COUNT(*) FROM visits WHERE barcode=?1 AND voided=0) AS visits,
      (SELECT COUNT(*) FROM plays WHERE barcode=?1 AND voided=0) AS plays,
      (SELECT COUNT(*) FROM purchases WHERE barcode=?1 AND voided=0) AS purchases,
      (SELECT COALESCE(SUM(points),0) FROM plays WHERE barcode=?1 AND voided=0) AS points_won,
      (SELECT COALESCE(SUM(total),0) FROM purchases WHERE barcode=?1 AND voided=0) AS points_spent,
      (SELECT COALESCE(SUM(amount),0) FROM visits WHERE barcode=?1 AND voided=0) AS entry_paid,
      (SELECT MAX(ts) FROM visits WHERE barcode=?1 AND voided=0) AS last_visit,
      (SELECT COUNT(*) FROM visits WHERE barcode=?1 AND voided=0 AND substr(ts,1,10)=?2) AS visits_today`).get(code, today());
  return { ...c, ...s, entered_today: s.visits_today > 0, balance: balance(code), games: playsInfo(code), linked: qLinked.all(code).map((r) => r.barcode) };
}
function requireCard(code) {
  const c = cardSummary(code);
  if (!c) throw notFound(`Картата ${code} не е регистрирана в системата`);
  if (c.replaced_by) throw new HttpError(403, `Картата ${code} е обявена за изгубена и е заменена с ${c.replaced_by}`);
  if (c.blocked) throw new HttpError(403, `Картата ${code} е блокирана`);
  return c;
}

function cardHistory(code) {
  const visits = db.prepare('SELECT * FROM visits WHERE barcode=? ORDER BY ts DESC, id DESC').all(code);
  const plays = db.prepare('SELECT * FROM plays WHERE barcode=? ORDER BY ts DESC, id DESC').all(code);
  const purchases = db.prepare('SELECT * FROM purchases WHERE barcode=? ORDER BY ts DESC, id DESC').all(code);
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id=?');
  const qRef = db.prepare('SELECT * FROM refunds WHERE purchase_id=? ORDER BY id');
  for (const p of purchases) { p.items = items.all(p.id); p.refunds = qRef.all(p.id); }
  const refunds = db.prepare('SELECT * FROM refunds WHERE barcode=? ORDER BY ts DESC, id DESC').all(code);
  const adjustments = db.prepare('SELECT * FROM adjustments WHERE barcode=? ORDER BY ts DESC, id DESC').all(code);
  const byGame = db.prepare(`SELECT game_name, COUNT(*) AS times, SUM(points) AS points, MAX(ts) AS last
      FROM plays WHERE barcode=? AND voided=0 GROUP BY game_id ORDER BY times DESC`).all(code);
  const byProduct = db.prepare(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty*i.points) AS points
      FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
      WHERE p.barcode=? AND p.voided=0 GROUP BY i.name ORDER BY qty DESC`).all(code);
  const replacements = db.prepare('SELECT * FROM card_replacements WHERE new_barcode=? OR old_barcode=? ORDER BY id DESC').all(code, code);
  const cardStays = stays('0000-01-01 00:00:00', '9999-12-31 23:59:59', code);
  const devices = db.prepare('SELECT COUNT(*) AS n FROM customer_sessions WHERE barcode=?').get(code).n;
  return { visits, plays, purchases, refunds, adjustments, byGame, byProduct, replacements, stays: cardStays, stay: staySummary(cardStays), devices };
}

// ---------- API ----------
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, admin: !!opts.admin });
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
  }
  return null;
}
route('GET', '/api/ping', () => ({ ok: true, time: now(), admin_pin: !!ADMIN_PIN, https_port: httpsActive || null, public_port: PUBLIC_PORT || null, lan_ip: lanIp() }));

// Настройки
route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', ({ body }) => {
  const allowed = ['park_name', 'entry_fee', 'entry_points', 'currency', 'backup_dir', 'backup_interval', 'plays_per_entry', 'plays_expire_daily', 'public_url', 'program'];
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    let v = str(body[k], 100);
    if (k === 'entry_fee') { const n = Number(v); if (!(n >= 0)) throw bad('Невалидна цена на вход'); v = String(n); }
    if (k === 'entry_points') v = String(int(v, 'начални точки', { min: 0, max: 100000 }));
    if (k === 'backup_interval') v = String(int(v, 'интервал', { min: 5, max: 1440 }));
    if (k === 'program') v = String(body[k] ?? '').replace(/\r/g, '').slice(0, 4000).trim();
    if (k === 'public_url') {
      v = str(body[k], 300).replace(/\/+$/, '');
      if (v && !/^https?:\/\/[^\s/]+/i.test(v)) throw bad('Адресът трябва да започва с https://');
    }
    if (k === 'plays_per_entry') v = String(int(v, 'игри за един вход', { min: 0, max: 10000 }));
    if (k === 'plays_expire_daily') v = body[k] === true || body[k] === '1' || body[k] === 1 ? '1' : '0';
    if (k === 'backup_dir') {
      v = str(body[k], 500);
      if (v) { try { backup.checkDir(backup.expandDir(v)); } catch (e) { throw bad(e.message); } }
    }
    up.run(k, v);
  }
  return getSettings();
}, { admin: true });

// Резервни копия
route('GET', '/api/backup', () => backup.status(), { admin: true });
route('POST', '/api/backup', () => {
  try { return { file: backup.runBackup(), ...backup.status() }; } catch (e) { throw bad('Неуспешно копие: ' + e.message); }
}, { admin: true });

// Карти
route('GET', '/api/cards', ({ query }) => {
  const q = `%${str(query.q, 64)}%`;
  const limit = Math.min(Number(query.limit) || 1000, 5000);
  const rows = db.prepare(`SELECT c.barcode, c.name, c.phone, c.age, c.blocked, c.replaced_by, c.kind, c.linked_to,
      (SELECT COUNT(*) FROM visits v WHERE v.barcode=c.barcode AND v.voided=0) AS visits,
      (SELECT COUNT(*) FROM plays p WHERE p.barcode=c.barcode AND p.voided=0) AS plays,
      (SELECT COUNT(*) FROM purchases u WHERE u.barcode=c.barcode AND u.voided=0) AS purchases,
      (SELECT MAX(ts) FROM visits v WHERE v.barcode=c.barcode AND v.voided=0) AS last_visit
    FROM cards c WHERE c.barcode LIKE ?1 OR c.name LIKE ?1 OR c.phone LIKE ?1
    ORDER BY c.barcode LIMIT ?2`).all(q, limit);
  const st = getSettings();
  for (const r of rows) { r.balance = balance(r.barcode); r.games_left = playsInfo(r.barcode, st).remaining; }
  return rows;
});

route('GET', '/api/cards/:code', ({ params }) => {
  const c = cardSummary(cardCode(params.code));
  if (!c) throw notFound(`Картата ${normCode(params.code)} не е регистрирана`);
  return c;
});

route('GET', '/api/cards/:code/history', ({ params }) => {
  const code = cardCode(params.code);
  const c = cardSummary(code);
  if (!c) throw notFound(`Картата ${code} не е регистрирана`);
  return { card: c, ...cardHistory(code) };
});

// Въвеждане / редакция на информация за играещия (създава картата, ако не съществува)
route('PUT', '/api/cards/:code', ({ params, body }) => {
  const code = cardCode(params.code);
  const t = now();
  const age = body.age === '' || body.age == null ? null : int(body.age, 'възраст', { min: 0, max: 120 });
  const exists = qCard.get(code);
  if (exists) {
    db.prepare('UPDATE cards SET name=?, phone=?, age=?, note=?, updated_at=? WHERE barcode=?')
      .run(str(body.name), str(body.phone, 40), age, str(body.note, 500), t, code);
  } else {
    db.prepare('INSERT INTO cards(barcode,name,phone,age,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(code, str(body.name), str(body.phone, 40), age, str(body.note, 500), t, t);
  }
  return cardSummary(code);
});

route('POST', '/api/cards/:code/block', ({ params, body }) => {
  const code = cardCode(params.code);
  if (!qCard.get(code)) throw notFound('Няма такава карта');
  db.prepare('UPDATE cards SET blocked=?, updated_at=? WHERE barcode=?').run(body.blocked ? 1 : 0, now(), code);
  return cardSummary(code);
}, { admin: true });

// Замяна на изгубена карта: старата не се сканира (намира се по име/телефон/номер),
// сканира се само новата. Данните, точките, игрите и цялата история минават на новата карта,
// а старата се блокира с отбелязване с коя карта е заменена.
function checkFreeCard(code) {
  const row = qCard.get(code);
  if (!row) return null;
  if (row.replaced_by) throw bad(`Картата ${code} е стара (изгубена) карта – не може да се използва`);
  if (row.linked_to) throw bad(`Картата ${code} вече е свързана с ${row.linked_to}`);
  if (row.blocked) throw bad(`Картата ${code} е блокирана`);
  if (row.kind === 'virtual') throw bad(`${code} е виртуална карта, не физическа`);
  const used = db.prepare(`SELECT
      (SELECT COUNT(*) FROM visits WHERE barcode=?1) + (SELECT COUNT(*) FROM plays WHERE barcode=?1)
    + (SELECT COUNT(*) FROM purchases WHERE barcode=?1) + (SELECT COUNT(*) FROM adjustments WHERE barcode=?1)
    + (SELECT COUNT(*) FROM cards WHERE linked_to=?1) AS n`).get(code).n;
  if (used > 0) throw bad(`Картата ${code} вече е използвана от друг посетител – вземете неизползвана карта`);
  return row;
}

// Свързване на физическа карта към профил (резервна карта за виртуален потребител
// или втора карта). Сканира се профилът (телефонът) и после физическата карта.
route('POST', '/api/cards/:code/link', ({ params, body }) => {
  const main = cardCode(params.code);
  const mainRow = qCard.get(main);
  if (!mainRow) throw notFound(`Няма карта ${main}`);
  if (mainRow.replaced_by || mainRow.blocked) throw bad(`Картата ${main} е блокирана`);
  const phys = normCode(body.card);
  if (phys === main) throw bad('Това е същата карта');
  const row = checkFreeCard(phys);
  const t = now();
  if (row) db.prepare('UPDATE cards SET linked_to=?, updated_at=? WHERE barcode=?').run(main, t, phys);
  else db.prepare("INSERT INTO cards(barcode,kind,linked_to,created_at,updated_at) VALUES(?, 'card', ?, ?, ?)").run(phys, main, t, t);
  return cardSummary(main);
});
route('POST', '/api/cards/:code/unlink', ({ params, body }) => {
  const main = cardCode(params.code);
  const phys = normCode(body.card);
  const r = db.prepare('UPDATE cards SET linked_to=NULL, updated_at=? WHERE barcode=? AND linked_to=?').run(now(), phys, main);
  if (!r.changes) throw notFound('Картата не е свързана с този профил');
  return cardSummary(main);
}, { admin: true });

route('POST', '/api/cards/:code/replace', ({ params, body }) => {
  const oldCode = cardCode(params.code);
  const newCode = normCode(body.new_barcode);
  const mainRow = qCard.get(oldCode);
  if (mainRow && mainRow.kind === 'virtual' && !mainRow.replaced_by) {
    // виртуален потребител: профилът остава, сменя се само физическата (резервна) карта
    if (newCode === oldCode) throw bad('Сканирайте новата физическа карта');
    const row = checkFreeCard(newCode);
    const t = now();
    tx(() => {
      for (const a of qLinked.all(oldCode)) {
        db.prepare('UPDATE cards SET blocked=1, replaced_by=?, updated_at=? WHERE barcode=?').run(newCode, t, a.barcode);
        db.prepare('INSERT INTO card_replacements(old_barcode,new_barcode,reason,ts) VALUES(?,?,?,?)').run(a.barcode, newCode, str(body.reason) || 'Изгубена карта', t);
      }
      if (row) db.prepare('UPDATE cards SET linked_to=?, updated_at=? WHERE barcode=?').run(oldCode, t, newCode);
      else db.prepare("INSERT INTO cards(barcode,kind,linked_to,created_at,updated_at) VALUES(?, 'card', ?, ?, ?)").run(newCode, oldCode, t, t);
    });
    return { old_barcode: oldCode, card: cardSummary(oldCode) };
  }
  if (oldCode === newCode) throw bad('Новата карта трябва да е различна от старата');
  const old = qCard.get(oldCode);
  if (!old) throw notFound(`Няма карта ${oldCode}`);
  if (old.replaced_by) throw bad(`Картата ${oldCode} вече е заменена с ${old.replaced_by}`);
  const fresh = qCard.get(newCode);
  if (fresh) {
    if (fresh.replaced_by) throw bad(`Картата ${newCode} е стара (изгубена) карта – не може да се използва`);
    if (fresh.blocked) throw bad(`Картата ${newCode} е блокирана`);
    const used = db.prepare(`SELECT
        (SELECT COUNT(*) FROM visits WHERE barcode=?1) + (SELECT COUNT(*) FROM plays WHERE barcode=?1)
      + (SELECT COUNT(*) FROM purchases WHERE barcode=?1) + (SELECT COUNT(*) FROM adjustments WHERE barcode=?1) AS n`).get(newCode).n;
    if (used > 0) throw bad(`Картата ${newCode} вече е използвана от друг посетител – вземете неизползвана карта`);
  }
  const t = now();
  tx(() => {
    if (fresh) {
      db.prepare('UPDATE cards SET name=?, phone=?, age=?, note=?, updated_at=? WHERE barcode=?').run(old.name, old.phone, old.age, old.note, t, newCode);
    } else {
      db.prepare('INSERT INTO cards(barcode,name,phone,age,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(newCode, old.name, old.phone, old.age, old.note, t, t);
    }
    db.prepare('UPDATE customer_sessions SET barcode=? WHERE barcode=?').run(newCode, oldCode);
    db.prepare('UPDATE cards SET linked_to=? WHERE linked_to=?').run(newCode, oldCode);
    for (const tbl of ['visits', 'plays', 'purchases', 'adjustments', 'refunds']) {
      db.prepare(`UPDATE ${tbl} SET barcode=? WHERE barcode=?`).run(newCode, oldCode);
    }
    // ако старата карта е била заменила друга по-рано, веригата води до новата
    db.prepare('UPDATE cards SET replaced_by=? WHERE replaced_by=?').run(newCode, oldCode);
    db.prepare('UPDATE cards SET blocked=1, replaced_by=?, updated_at=? WHERE barcode=?').run(newCode, t, oldCode);
    db.prepare('INSERT INTO card_replacements(old_barcode,new_barcode,reason,ts) VALUES(?,?,?,?)').run(oldCode, newCode, str(body.reason) || 'Изгубена карта', t);
  });
  return { old_barcode: oldCode, card: cardSummary(newCode) };
}, { admin: !!process.env.REPLACE_REQUIRES_PIN });

// Изключване на всички телефони, свързани с картата (напр. при спор или смяна на собственик)
route('POST', '/api/cards/:code/customer-logout', ({ params }) => {
  const code = cardCode(params.code);
  const r = db.prepare('DELETE FROM customer_sessions WHERE barcode=?').run(code);
  return { removed: Number(r.changes) };
}, { admin: true });

route('POST', '/api/cards/:code/adjust', ({ params, body }) => {
  const code = cardCode(params.code);
  if (!qCard.get(code)) throw notFound('Няма такава карта');
  const pts = int(body.points, 'точки', { min: -1000000, max: 1000000 });
  if (pts === 0) throw bad('Въведете точки различни от 0');
  if (balance(code) + pts < 0) throw bad('Балансът не може да стане отрицателен');
  db.prepare('INSERT INTO adjustments(barcode,points,reason,ts) VALUES(?,?,?,?)').run(code, pts, str(body.reason) || 'Ръчна корекция', now());
  return cardSummary(code);
}, { admin: true });

// Генериране на карти (напр. 600 броя)
route('POST', '/api/cards/generate', ({ body }) => {
  const count = int(body.count, 'брой', { min: 1, max: 10000 });
  const start = int(body.start ?? 1, 'начален номер', { min: 0, max: 99999999 });
  const prefix = str(body.prefix ?? 'LP', 16).toUpperCase();
  const digits = int(body.digits ?? 4, 'цифри', { min: 1, max: 10 });
  const t = now();
  const ins = db.prepare('INSERT OR IGNORE INTO cards(barcode,created_at,updated_at) VALUES(?,?,?)');
  let created = 0;
  const codes = [];
  tx(() => {
    for (let i = 0; i < count; i++) {
      const code = prefix + String(start + i).padStart(digits, '0');
      codes.push(code);
      created += Number(ins.run(code, t, t).changes);
    }
  });
  return { created, skipped: count - created, first: codes[0], last: codes[codes.length - 1] };
}, { admin: true });

// Вход (плащане 20€ – само за статистика)
route('POST', '/api/entry', ({ body }) => {
  const code = cardCode(body.barcode);
  requireCard(code);
  const s = getSettings();
  const amount = body.amount != null && body.amount !== '' ? Number(body.amount) : Number(s.entry_fee);
  if (!(amount >= 0)) throw bad('Невалидна сума');
  const points = Number(s.entry_points) || 0;
  const r = db.prepare('INSERT INTO visits(barcode,amount,points,station,ts) VALUES(?,?,?,?,?)')
    .run(code, amount, points, str(body.station, 60), now());
  return { visit_id: Number(r.lastInsertRowid), card: cardSummary(code) };
});

// Игри
route('GET', '/api/games', ({ query }) =>
  db.prepare(`SELECT * FROM games ${query.all ? '' : 'WHERE active=1'} ORDER BY name`).all());
route('POST', '/api/games', ({ body }) => {
  const name = str(body.name, 80);
  if (!name) throw bad('Въведете име на играта');
  try {
    const r = db.prepare('INSERT INTO games(name,points,active,created_at) VALUES(?,?,1,?)')
      .run(name, int(body.points ?? 10, 'точки', { min: 0, max: 100000 }), now());
    return db.prepare('SELECT * FROM games WHERE id=?').get(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw bad('Вече има игра с това име');
    throw e;
  }
}, { admin: true });
route('PUT', '/api/games/:id', ({ params, body }) => {
  const id = int(params.id, 'id');
  const g = db.prepare('SELECT * FROM games WHERE id=?').get(id);
  if (!g) throw notFound('Няма такава игра');
  const name = body.name !== undefined ? str(body.name, 80) : g.name;
  if (!name) throw bad('Въведете име на играта');
  const points = body.points !== undefined ? int(body.points, 'точки', { min: 0, max: 100000 }) : g.points;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : g.active;
  db.prepare('UPDATE games SET name=?, points=?, active=? WHERE id=?').run(name, points, active, id);
  return db.prepare('SELECT * FROM games WHERE id=?').get(id);
}, { admin: true });

// Изиграване на игра – добавяне на точки
route('POST', '/api/plays', ({ body }) => {
  const code = cardCode(body.barcode);
  const card = requireCard(code);
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(int(body.game_id, 'игра'));
  if (!game) throw notFound('Няма такава игра');
  if (!game.active) throw bad('Играта е деактивирана');
  const points = body.points != null && body.points !== '' ? int(body.points, 'точки', { min: 0, max: 100000 }) : game.points;
  const g = card.games;
  if (g.limited && g.remaining <= 0) {
    const when = g.daily ? ' днес' : '';
    throw new HttpError(403, g.entries === 0
      ? `Няма платен вход${when} – първо платете вход (${g.per} игри)`
      : `Изиграни са всички ${g.allowed} игри${when} (${g.entries} ${g.entries === 1 ? 'вход' : 'входа'}). Платете нов вход за още ${g.per} игри.`);
  }
  const r = db.prepare('INSERT INTO plays(barcode,game_id,game_name,points,ts) VALUES(?,?,?,?,?)')
    .run(code, game.id, game.name, points, now());
  const times = db.prepare('SELECT COUNT(*) AS n FROM plays WHERE barcode=? AND game_id=? AND voided=0').get(code, game.id).n;
  return { play_id: Number(r.lastInsertRowid), points, times_this_game: times, entered_today: card.entered_today, card: cardSummary(code) };
});
route('POST', '/api/plays/:id/void', ({ params, body, isAdmin }) => {
  const id = int(params.id, 'id');
  const p = db.prepare('SELECT * FROM plays WHERE id=?').get(id);
  if (!p) throw notFound('Няма такъв запис');
  if (p.voided) throw bad('Записът вече е анулиран');
  // Операторът на играта може да анулира само последните 5 минути; администраторът – винаги
  if (!(body.admin && isAdmin)) {
    const ageMs = Date.now() - new Date(p.ts.replace(' ', 'T')).getTime();
    if (ageMs > 5 * 60 * 1000) throw bad('Може да се анулира само до 5 минути след въвеждане');
  }
  if (balance(p.barcode) - p.points < 0) throw bad('Точките вече са изхарчени – не може да се анулира');
  db.prepare('UPDATE plays SET voided=1 WHERE id=?').run(id);
  return { ok: true, card: cardSummary(p.barcode) };
});

// Продукти
route('GET', '/api/products', ({ query }) =>
  db.prepare(`SELECT * FROM products ${query.all ? '' : 'WHERE active=1'} ORDER BY category, sort, name`).all());
route('POST', '/api/products', ({ body }) => {
  const name = str(body.name, 80);
  if (!name) throw bad('Въведете име на продукта');
  const r = db.prepare('INSERT INTO products(name,category,points,active,sort) VALUES(?,?,?,1,?)')
    .run(name, str(body.category, 40), int(body.points, 'точки', { min: 0, max: 100000 }), int(body.sort ?? 0, 'подредба'));
  return db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid);
}, { admin: true });
route('PUT', '/api/products/:id', ({ params, body }) => {
  const id = int(params.id, 'id');
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!p) throw notFound('Няма такъв продукт');
  const name = body.name !== undefined ? str(body.name, 80) : p.name;
  if (!name) throw bad('Въведете име на продукта');
  db.prepare('UPDATE products SET name=?, category=?, points=?, active=?, sort=? WHERE id=?').run(
    name,
    body.category !== undefined ? str(body.category, 40) : p.category,
    body.points !== undefined ? int(body.points, 'точки', { min: 0, max: 100000 }) : p.points,
    body.active !== undefined ? (body.active ? 1 : 0) : p.active,
    body.sort !== undefined ? int(body.sort, 'подредба') : p.sort,
    id);
  return db.prepare('SELECT * FROM products WHERE id=?').get(id);
}, { admin: true });

// Покупка в зоната за хранене – изваждане на точки
route('POST', '/api/purchases', ({ body }) => {
  const code = cardCode(body.barcode);
  if (!Array.isArray(body.items) || body.items.length === 0) throw bad('Количката е празна');
  return tx(() => {
    requireCard(code);
    const getP = db.prepare('SELECT * FROM products WHERE id=?');
    const lines = [];
    let total = 0;
    for (const it of body.items) {
      const p = getP.get(int(it.product_id, 'продукт'));
      if (!p || !p.active) throw bad('Невалиден продукт в количката');
      const qty = int(it.qty, 'количество', { min: 1, max: 100 });
      lines.push({ p, qty });
      total += p.points * qty;
    }
    const bal = balance(code);
    if (bal < total) throw new HttpError(402, `Недостатъчно точки: има ${bal}, нужни ${total}`);
    const t = now();
    const r = db.prepare('INSERT INTO purchases(barcode,total,station,ts) VALUES(?,?,?,?)').run(code, total, str(body.station, 60), t);
    const pid = Number(r.lastInsertRowid);
    const insI = db.prepare('INSERT INTO purchase_items(purchase_id,product_id,name,qty,points) VALUES(?,?,?,?,?)');
    for (const { p, qty } of lines) insI.run(pid, p.id, p.name, qty, p.points);
    return { purchase_id: pid, total, card: cardSummary(code) };
  });
});
// Връщане на точки от зоната за хранене: цялата поръчка или част от нея.
// Служителите могат да връщат поръчки от днешния ден, администраторът – винаги.
route('POST', '/api/purchases/:id/refund', ({ params, body, isAdmin }) => {
  const id = int(params.id, 'id');
  return tx(() => {
    const p = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
    if (!p) throw notFound('Няма такава поръчка');
    if (p.voided) throw bad('Тази поръчка вече е върната изцяло');
    if (!(body.admin && isAdmin) && p.ts.slice(0, 10) !== today()) throw bad('Може да се връщат само днешни поръчки. За по-стари – администратор.');
    const lines = db.prepare('SELECT * FROM purchase_items WHERE purchase_id=?').all(id);
    let want;
    if (Array.isArray(body.items) && body.items.length) {
      want = body.items.map((it) => ({ line: lines.find((l) => l.id === int(it.id, 'ред')), qty: int(it.qty, 'количество', { min: 0, max: 100 }) }))
        .filter((w) => w.qty > 0);
      for (const w of want) {
        if (!w.line) throw bad('Невалиден ред от поръчката');
        if (w.qty > w.line.qty) throw bad(`Може да се върнат най-много ${w.line.qty}× ${w.line.name}`);
      }
    } else {
      want = lines.map((l) => ({ line: l, qty: l.qty })); // цялата поръчка
    }
    if (!want.length) throw bad('Изберете какво се връща');
    const points = want.reduce((s, w) => s + w.qty * w.line.points, 0);
    const text = want.map((w) => `${w.qty}× ${w.line.name}`).join(', ');
    const full = want.reduce((s, w) => s + w.qty, 0) === lines.reduce((s, l) => s + l.qty, 0);
    if (full) {
      db.prepare('UPDATE purchases SET voided=1 WHERE id=?').run(id); // изцяло върната – редовете остават за историята
    } else {
      for (const w of want) {
        if (w.qty === w.line.qty) db.prepare('DELETE FROM purchase_items WHERE id=?').run(w.line.id);
        else db.prepare('UPDATE purchase_items SET qty=qty-? WHERE id=?').run(w.qty, w.line.id);
      }
      db.prepare('UPDATE purchases SET total=total-? WHERE id=?').run(points, id);
    }
    db.prepare('INSERT INTO refunds(purchase_id,barcode,points,items,reason,station,ts) VALUES(?,?,?,?,?,?,?)')
      .run(id, p.barcode, points, text, str(body.reason, 200) || 'Отказ от храната', str(body.station, 60), now());
    return { refunded: points, items: text, full, card: cardSummary(p.barcode) };
  });
});

route('POST', '/api/purchases/:id/void', ({ params }) => {
  const id = int(params.id, 'id');
  const p = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
  if (!p) throw notFound('Няма такава покупка');
  if (p.voided) throw bad('Покупката вече е анулирана');
  db.prepare('UPDATE purchases SET voided=1 WHERE id=?').run(id);
  return { ok: true, card: cardSummary(p.barcode) };
}, { admin: true });
route('POST', '/api/visits/:id/void', ({ params }) => {
  const id = int(params.id, 'id');
  const v = db.prepare('SELECT * FROM visits WHERE id=?').get(id);
  if (!v) throw notFound('Няма такъв вход');
  if (v.voided) throw bad('Входът вече е анулиран');
  if (balance(v.barcode) - v.points < 0) throw bad('Началните точки вече са изхарчени');
  db.prepare('UPDATE visits SET voided=1 WHERE id=?').run(id);
  return { ok: true, card: cardSummary(v.barcode) };
}, { admin: true });

// Последни действия (за мониторите)
route('GET', '/api/recent', ({ query }) => {
  const limit = Math.min(Number(query.limit) || 15, 100);
  if (query.game_id) {
    return db.prepare(`SELECT p.*, c.name FROM plays p JOIN cards c ON c.barcode=p.barcode
      WHERE p.game_id=? ORDER BY p.id DESC LIMIT ?`).all(int(query.game_id, 'игра'), limit);
  }
  if (query.type === 'purchases') {
    const rows = db.prepare(`SELECT p.*, c.name FROM purchases p JOIN cards c ON c.barcode=p.barcode
      ORDER BY p.id DESC LIMIT ?`).all(limit);
    const items = db.prepare('SELECT id, name, qty, points FROM purchase_items WHERE purchase_id=?');
    const refs = db.prepare('SELECT points, items, reason, ts FROM refunds WHERE purchase_id=? ORDER BY id');
    const T = today();
    for (const r of rows) { r.items = items.all(r.id); r.refunds = refs.all(r.id); r.can_refund = !r.voided && r.ts.slice(0, 10) === T; }
    return rows;
  }
  if (query.type === 'visits') {
    return db.prepare(`SELECT v.*, c.name FROM visits v JOIN cards c ON c.barcode=v.barcode
      ORDER BY v.id DESC LIMIT ?`).all(limit);
  }
  throw bad('Невалидна заявка');
});

// ---------- Престой в парка ----------
// Едно посещение = карта + ден с платен вход.
//   пристигане = първият платен вход за деня
//   тръгване   = последното харчене на точки в зоната за хранене; ако не е пазарувал – последната игра
//   престой    = тръгване − пристигане
const qStays = db.prepare(`
  WITH v AS (
    SELECT barcode, substr(ts,1,10) AS day, MIN(ts) AS arrived, COUNT(*) AS entries, SUM(amount) AS paid
    FROM visits WHERE voided=0 AND ts BETWEEN ?1 AND ?2 AND (?3 IS NULL OR barcode=?3)
    GROUP BY barcode, day)
  SELECT v.*, c.name,
    (SELECT MAX(ts) FROM plays p WHERE p.barcode=v.barcode AND p.voided=0 AND p.ts BETWEEN v.arrived AND v.day||' 23:59:59') AS last_play,
    (SELECT COUNT(*) FROM plays p WHERE p.barcode=v.barcode AND p.voided=0 AND p.ts BETWEEN v.arrived AND v.day||' 23:59:59') AS plays,
    (SELECT MAX(ts) FROM purchases u WHERE u.barcode=v.barcode AND u.voided=0 AND u.ts BETWEEN v.arrived AND v.day||' 23:59:59') AS last_purchase,
    (SELECT COALESCE(SUM(total),0) FROM purchases u WHERE u.barcode=v.barcode AND u.voided=0 AND u.ts BETWEEN v.arrived AND v.day||' 23:59:59') AS spent,
    (SELECT COALESCE(SUM(points),0) FROM visits x WHERE x.barcode=v.barcode AND x.voided=0 AND x.ts <= v.day||' 23:59:59')
  + (SELECT COALESCE(SUM(points),0) FROM plays x WHERE x.barcode=v.barcode AND x.voided=0 AND x.ts <= v.day||' 23:59:59')
  + (SELECT COALESCE(SUM(points),0) FROM adjustments x WHERE x.barcode=v.barcode AND x.ts <= v.day||' 23:59:59')
  - (SELECT COALESCE(SUM(total),0) FROM purchases x WHERE x.barcode=v.barcode AND x.voided=0 AND x.ts <= v.day||' 23:59:59') AS balance_end
  FROM v LEFT JOIN cards c ON c.barcode=v.barcode
  ORDER BY v.day DESC, v.arrived DESC`);

const tsMs = (ts) => Date.parse(ts.replace(' ', 'T') + 'Z');
function stays(from, to, barcode = null) {
  const day = today();
  return qStays.all(from, to, barcode).map((r) => {
    const left = r.last_purchase || r.last_play || null;
    const minutes = left ? Math.max(0, Math.round((tsMs(left) - tsMs(r.arrived)) / 60000)) : null;
    return {
      ...r,
      left,
      left_by: r.last_purchase ? 'purchase' : r.last_play ? 'play' : null,
      minutes,
      spent_all: !!r.last_purchase && r.balance_end <= 0,
      in_park: r.day === day && !(r.last_purchase && r.balance_end <= 0),
    };
  });
}
function staySummary(rows) {
  const m = rows.filter((r) => r.minutes != null).map((r) => r.minutes).sort((x, y) => x - y);
  const avgTime = (list) => {
    if (!list.length) return null;
    const mins = list.map((ts) => Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16)));
    const a = Math.round(mins.reduce((x, y) => x + y, 0) / mins.length);
    return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  };
  const hours = (list) => {
    const h = {};
    for (const ts of list) { const k = ts.slice(11, 13); h[k] = (h[k] || 0) + 1; }
    return Object.entries(h).sort().map(([hour, n]) => ({ hour, n }));
  };
  return {
    visits: rows.length,
    with_time: m.length,
    avg_minutes: m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null,
    median_minutes: m.length ? m[Math.floor((m.length - 1) / 2)] : null,
    max_minutes: m.length ? m[m.length - 1] : null,
    min_minutes: m.length ? m[0] : null,
    spent_all: rows.filter((r) => r.spent_all).length,
    avg_arrival: avgTime(rows.map((r) => r.arrived)),
    avg_left: avgTime(rows.filter((r) => r.left).map((r) => r.left)),
    arrivals_by_hour: hours(rows.map((r) => r.arrived)),
    departures_by_hour: hours(rows.filter((r) => r.left).map((r) => r.left)),
  };
}

// Статистика
function range(query) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : today();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : from;
  return [from + ' 00:00:00', to + ' 23:59:59', from, to];
}
route('GET', '/api/stats', ({ query }) => {
  const [a, b, from, to] = range(query);
  const one = (sql) => db.prepare(sql).get(a, b);
  const all = (sql) => db.prepare(sql).all(a, b);
  const W = 'voided=0 AND ts BETWEEN ? AND ?';
  return {
    from, to,
    totals: {
      cards_total: db.prepare('SELECT COUNT(*) AS n FROM cards').get().n,
      cards_with_holder: db.prepare("SELECT COUNT(*) AS n FROM cards WHERE name<>''").get().n,
      virtual_users: db.prepare("SELECT COUNT(*) AS n FROM cards WHERE kind='virtual'").get().n,
      app_users: db.prepare('SELECT COUNT(DISTINCT barcode) AS n FROM customer_sessions').get().n,
      ...one(`SELECT COUNT(*) AS entries, COALESCE(SUM(amount),0) AS entry_amount, COUNT(DISTINCT barcode) AS unique_visitors FROM visits WHERE ${W}`),
      ...one(`SELECT COUNT(*) AS plays, COALESCE(SUM(points),0) AS points_won, COUNT(DISTINCT barcode) AS unique_players FROM plays WHERE ${W}`),
      ...one(`SELECT COUNT(*) AS purchases, COALESCE(SUM(total),0) AS points_spent FROM purchases WHERE ${W}`),
      ...one('SELECT COUNT(*) AS refunds, COALESCE(SUM(points),0) AS points_refunded FROM refunds WHERE ts BETWEEN ? AND ?'),
      ...one('SELECT COALESCE(SUM(points),0) AS points_adjusted FROM adjustments WHERE ts BETWEEN ? AND ?'),
      ...one(`SELECT COALESCE(SUM(points),0) AS points_from_entry FROM visits WHERE ${W}`),
    },
    byGame: all(`SELECT game_name, COUNT(*) AS plays, COUNT(DISTINCT barcode) AS players, SUM(points) AS points
      FROM plays WHERE ${W} GROUP BY game_id ORDER BY plays DESC`),
    byProduct: all(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty*i.points) AS points
      FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
      WHERE p.voided=0 AND p.ts BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC`),
    byHour: all(`SELECT substr(ts,12,2) AS hour, COUNT(*) AS plays FROM plays WHERE ${W} GROUP BY hour ORDER BY hour`),
    byDay: all(`SELECT substr(ts,1,10) AS day, COUNT(*) AS entries, SUM(amount) AS amount FROM visits WHERE ${W} GROUP BY day ORDER BY day`),
    topPlayers: all(`SELECT p.barcode, c.name, COUNT(*) AS plays, SUM(p.points) AS points
      FROM plays p JOIN cards c ON c.barcode=p.barcode WHERE p.voided=0 AND p.ts BETWEEN ? AND ?
      GROUP BY p.barcode ORDER BY plays DESC LIMIT 20`),
    ...(() => { const st = stays(a, b); return { stays: st.slice(0, 1000), stay: staySummary(st) }; })(),
  };
}, { admin: true });

// CSV експорт
function csv(rows, cols) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => c[1]).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(';'))].join('\r\n');
}
route('GET', '/api/export/:kind', ({ params, query }) => {
  const [a, b, from, to] = range(query);
  let rows, cols;
  switch (params.kind) {
    case 'activity':
      rows = db.prepare(`
        SELECT ts, 'Вход' AS type, v.barcode, c.name, '' AS item, v.points AS points, v.amount AS amount, v.voided FROM visits v JOIN cards c USING(barcode) WHERE v.ts BETWEEN ?1 AND ?2
        UNION ALL SELECT ts, 'Игра', p.barcode, c.name, p.game_name, p.points, '', p.voided FROM plays p JOIN cards c USING(barcode) WHERE p.ts BETWEEN ?1 AND ?2
        UNION ALL SELECT u.ts, 'Покупка', u.barcode, c.name,
          (SELECT GROUP_CONCAT(i.qty || 'x ' || i.name, ', ') FROM purchase_items i WHERE i.purchase_id=u.id), -u.total, '', u.voided
          FROM purchases u JOIN cards c USING(barcode) WHERE u.ts BETWEEN ?1 AND ?2
        UNION ALL SELECT r.ts, 'Връщане', r.barcode, c.name, r.items || ' – ' || r.reason, r.points, '', 0 FROM refunds r JOIN cards c USING(barcode) WHERE r.ts BETWEEN ?1 AND ?2
        UNION ALL SELECT ts, 'Корекция', a.barcode, c.name, a.reason, a.points, '', 0 FROM adjustments a JOIN cards c USING(barcode) WHERE a.ts BETWEEN ?1 AND ?2
        ORDER BY ts`).all(a, b);
      cols = [['ts', 'Дата и час'], ['type', 'Тип'], ['barcode', 'Баркод'], ['name', 'Име'], ['item', 'Игра/Продукти'], ['points', 'Точки'], ['amount', 'Вход (€)'], ['voided', 'Анулирано']];
      break;
    case 'cards':
      rows = db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM visits v WHERE v.barcode=c.barcode AND v.voided=0) AS visits,
          (SELECT COALESCE(SUM(amount),0) FROM visits v WHERE v.barcode=c.barcode AND v.voided=0) AS entry_paid,
          (SELECT COUNT(*) FROM plays p WHERE p.barcode=c.barcode AND p.voided=0) AS plays,
          (SELECT COUNT(*) FROM purchases u WHERE u.barcode=c.barcode AND u.voided=0) AS purchases
        FROM cards c ORDER BY barcode`).all();
      for (const r of rows) r.balance = balance(r.barcode);
      cols = [['barcode', 'Баркод'], ['name', 'Име'], ['phone', 'Телефон'], ['age', 'Възраст'], ['note', 'Бележка'], ['visits', 'Брой входове'], ['entry_paid', 'Платено за вход (€)'], ['plays', 'Брой игри'], ['purchases', 'Брой покупки'], ['balance', 'Баланс точки'], ['blocked', 'Блокирана'], ['kind', 'Вид'], ['linked_to', 'Свързана с']];
      break;
    case 'stays':
      rows = stays(a, b).map((r) => ({
        ...r,
        arrived_time: r.arrived.slice(11, 16),
        left_time: r.left ? r.left.slice(11, 16) : '',
        left_by_text: r.left_by === 'purchase' ? 'последна покупка' : r.left_by === 'play' ? 'последна игра' : '',
        duration: r.minutes == null ? '' : `${Math.floor(r.minutes / 60)}:${String(r.minutes % 60).padStart(2, '0')}`,
        spent_all_text: r.spent_all ? 'да' : 'не',
      }));
      cols = [['day', 'Дата'], ['barcode', 'Баркод'], ['name', 'Име'], ['arrived_time', 'Пристигане'], ['left_time', 'Тръгване'],
        ['left_by_text', 'Тръгване по'], ['duration', 'Престой (ч:мин)'], ['minutes', 'Престой (мин)'], ['plays', 'Игри'],
        ['spent', 'Изхарчени точки'], ['balance_end', 'Остатък точки'], ['spent_all_text', 'Изхарчил всичко']];
      break;
    default:
      throw notFound('Непознат експорт');
  }
  return { __raw: csv(rows, cols), type: 'text/csv; charset=utf-8', filename: `${params.kind}_${from}_${to}.csv` };
}, { admin: true });

// ---------- HTTP сървър ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Няма такава страница'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(bad('Твърде голяма заявка')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Невалиден JSON')); }
    });
    req.on('error', reject);
  });
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    const r = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!r) throw notFound('Непознат адрес');
    const pin = req.headers['x-admin-pin'] || url.searchParams.get('pin');
    const isAdmin = !ADMIN_PIN || pin === ADMIN_PIN;
    if (r.admin && !isAdmin) throw new HttpError(401, 'Нужен е администраторски ПИН');
    const m = pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const out = await r.handler({ params, body, query: Object.fromEntries(url.searchParams), isAdmin });
    if (out && out.__raw !== undefined) {
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"` });
      return res.end(out.__raw);
    }
    send(200, out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Вътрешна грешка: ' + e.message });
  }
};
const server = http.createServer(handler);

// ---------- Клиентско приложение (отделен порт) ----------
const publicHandler = require('./customer').createPublicHandler({
  db, HttpError, normCode, resolveCode, str, int, getSettings, cardSummary, today, now, readBody, stays, publicDir: PUBLIC_DIR,
});
const publicServer = http.createServer(publicHandler);

function startHttps() {
  if (!HTTPS_PORT) return Promise.resolve(null);
  let creds;
  try {
    creds = require('./tls').loadOrCreate(path.dirname(DB_FILE));
  } catch (e) {
    console.log(`   ⚠  https не е включен (няма openssl или сертификат): ${e.message}`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const s = https.createServer(creds, handler);
    s.on('error', (e) => { console.log(`   ⚠  https не може да стартира на порт ${HTTPS_PORT}: ${e.message}`); resolve(null); });
    s.listen(HTTPS_PORT, '0.0.0.0', () => { httpsActive = HTTPS_PORT; resolve(s); });
  });
}

if (require.main === module) {
  backup.start();
  server.listen(PORT, '0.0.0.0', async () => {
    await startHttps();
    const lan = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
    console.log(`\n🎡 Лунапарк сървърът работи на порт ${PORT}`);
    console.log(`   База данни: ${DB_FILE}`);
    console.log(`   Локално:    http://localhost:${PORT}`);
    for (const ip of lan) console.log(`   В мрежата:  http://${ip}:${PORT}`);
    if (httpsActive) {
      console.log(`\n   📷 За сканиране с камера на таблети и телефони отворете защитения адрес:`);
      for (const ip of lan) console.log(`   В мрежата:  https://${ip}:${httpsActive}`);
      console.log('   (първия път браузърът показва предупреждение – изберете „Продължи“)\n');
    }
    if (PUBLIC_PORT) {
      await new Promise((resolve) => {
        publicServer.on('error', (e) => { console.log(`   ⚠  клиентското приложение не може да стартира на порт ${PUBLIC_PORT}: ${e.message}`); resolve(); });
        publicServer.listen(PUBLIC_PORT, '0.0.0.0', resolve);
      });
      const pub = getSettings().public_url;
      console.log(`   📱 Клиентско приложение (телефоните на посетителите): порт ${PUBLIC_PORT}`);
      console.log(pub ? `      Публичен адрес: ${pub}/app` : `      В мрежата: http://${lan[0] || 'localhost'}:${PUBLIC_PORT}/app  (за мобилен интернет – вижте README „Клиентско приложение“)`);
      console.log('      ⚠  Към интернет пускайте САМО този порт, не порт ' + PORT + '.');
    }
    console.log(`   Резервни копия: ${backup.status().effective_dir} (на всеки ${backup.status().interval} мин.)`);
    if (!ADMIN_PIN) console.log('   ⚠  ADMIN_PIN не е зададен – администрацията е без парола.');
    console.log('');
  });
}

module.exports = { server, publicServer };
