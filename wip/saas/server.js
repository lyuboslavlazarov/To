'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { db, tx, DB_FILE } = require('./db');
const auth = require('./auth');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 14;

// ---------- планове ----------
const PLANS = {
  trial:    { label: 'Пробен период', price: 0,   cards: 1000,  games: 50,  users: 10 },
  free:     { label: 'Безплатен',     price: 0,   cards: 50,    games: 3,   users: 2 },
  pro:      { label: 'Про',           price: 49,  cards: 1000,  games: 50,  users: 20 },
  business: { label: 'Бизнес',        price: 129, cards: 10000, games: 500, users: 200 },
};

// ---------- помощни ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);

const tzFormatters = new Map();
function nowIn(tz) {
  let f = tzFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    tzFormatters.set(tz, f);
  }
  return f.format(new Date()).replace(',', '').replace('T', ' ');
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
const utcNow = () => nowIn('UTC');
const naiveMs = (ts) => Date.parse(ts.replace(' ', 'T') + 'Z');

function normCode(c) {
  const s = String(c ?? '').trim().toUpperCase();
  if (!s) throw bad('Липсва баркод');
  if (s.length > 64 || /[\x00-\x1f]/.test(s)) throw bad('Невалиден баркод');
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
function email(v) {
  const e = str(v, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Невалиден имейл');
  return e;
}
function password(v) {
  const p = String(v ?? '');
  if (p.length < 8) throw bad('Паролата трябва да е поне 8 символа');
  if (p.length > 200) throw bad('Паролата е твърде дълга');
  return p;
}

// ---------- настройки на парка ----------
const DEFAULT_SETTINGS = { entry_fee: '20', entry_points: '0', currency: '€', timezone: 'Europe/Sofia' };
function getSettings(T) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings WHERE tenant_id=?').all(T)) out[r.key] = r.value;
  out.park_name = db.prepare('SELECT name FROM tenants WHERE id=?').get(T)?.name || '';
  return out;
}

// ---------- план и лимити ----------
function effectivePlan(t) {
  if (t.plan === 'trial' && t.trial_ends && t.trial_ends < utcNow()) return 'free';
  return PLANS[t.plan] ? t.plan : 'free';
}
function usage(T) {
  return {
    cards: db.prepare('SELECT COUNT(*) AS n FROM cards WHERE tenant_id=?').get(T).n,
    games: db.prepare('SELECT COUNT(*) AS n FROM games WHERE tenant_id=? AND active=1').get(T).n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1').get(T).n,
  };
}
function checkLimit(ctx, kind, adding = 1) {
  const plan = PLANS[effectivePlan(ctx.tenant)];
  const used = usage(ctx.T)[kind];
  if (used + adding > plan[kind]) {
    const names = { cards: 'карти', games: 'активни игри', users: 'потребители' };
    throw new HttpError(402, `Лимитът на план „${plan.label}“ е ${plan[kind]} ${names[kind]} (използвани: ${used}). Надградете плана от Администрация → Абонамент.`);
  }
}

// ---------- точки и карти ----------
const qBalance = db.prepare(`
SELECT
   (SELECT COALESCE(SUM(points),0) FROM visits      WHERE tenant_id=?1 AND barcode=?2 AND voided=0)
 + (SELECT COALESCE(SUM(points),0) FROM plays       WHERE tenant_id=?1 AND barcode=?2 AND voided=0)
 + (SELECT COALESCE(SUM(points),0) FROM adjustments WHERE tenant_id=?1 AND barcode=?2)
 - (SELECT COALESCE(SUM(total),0)  FROM purchases   WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS balance`);
const balance = (T, code) => qBalance.get(T, code).balance;

const qCard = db.prepare('SELECT * FROM cards WHERE tenant_id=? AND barcode=?');
const qCardStats = db.prepare(`SELECT
    (SELECT COUNT(*) FROM visits WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS visits,
    (SELECT COUNT(*) FROM plays WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS plays,
    (SELECT COUNT(*) FROM purchases WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS purchases,
    (SELECT COALESCE(SUM(points),0) FROM plays WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS points_won,
    (SELECT COALESCE(SUM(total),0) FROM purchases WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS points_spent,
    (SELECT COALESCE(SUM(amount),0) FROM visits WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS entry_paid,
    (SELECT MAX(ts) FROM visits WHERE tenant_id=?1 AND barcode=?2 AND voided=0) AS last_visit,
    (SELECT COUNT(*) FROM visits WHERE tenant_id=?1 AND barcode=?2 AND voided=0 AND substr(ts,1,10)=?3) AS visits_today`);

function cardSummary(ctx, code) {
  const c = qCard.get(ctx.T, code);
  if (!c) return null;
  const s = qCardStats.get(ctx.T, code, ctx.now().slice(0, 10));
  delete c.tenant_id;
  return { ...c, ...s, entered_today: s.visits_today > 0, balance: balance(ctx.T, code) };
}
function requireCard(ctx, code) {
  const c = cardSummary(ctx, code);
  if (!c) throw notFound(`Картата ${code} не е регистрирана в системата`);
  if (c.blocked) throw new HttpError(403, `Картата ${code} е блокирана`);
  return c;
}

function cardHistory(ctx, code) {
  const T = ctx.T;
  const uname = '(SELECT name FROM users u WHERE u.id = x.user_id) AS user_name';
  const visits = db.prepare(`SELECT x.*, ${uname} FROM visits x WHERE tenant_id=? AND barcode=? ORDER BY ts DESC, id DESC`).all(T, code);
  const plays = db.prepare(`SELECT x.*, ${uname} FROM plays x WHERE tenant_id=? AND barcode=? ORDER BY ts DESC, id DESC`).all(T, code);
  const purchases = db.prepare(`SELECT x.*, ${uname} FROM purchases x WHERE tenant_id=? AND barcode=? ORDER BY ts DESC, id DESC`).all(T, code);
  const items = db.prepare('SELECT name, qty, points FROM purchase_items WHERE purchase_id=?');
  for (const p of purchases) p.items = items.all(p.id);
  const adjustments = db.prepare(`SELECT x.*, ${uname} FROM adjustments x WHERE tenant_id=? AND barcode=? ORDER BY ts DESC, id DESC`).all(T, code);
  const byGame = db.prepare(`SELECT game_name, COUNT(*) AS times, SUM(points) AS points, MAX(ts) AS last
      FROM plays WHERE tenant_id=? AND barcode=? AND voided=0 GROUP BY game_id ORDER BY times DESC`).all(T, code);
  const byProduct = db.prepare(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty*i.points) AS points
      FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
      WHERE p.tenant_id=? AND p.barcode=? AND p.voided=0 GROUP BY i.name ORDER BY qty DESC`).all(T, code);
  return { visits, plays, purchases, adjustments, byGame, byProduct };
}

// ---------- маршрутизация ----------
// access: public | staff (всеки служител) | admin (owner/admin) | owner | platform
const routes = [];
function route(method, pattern, access, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, access });
}
const ROLE_RANK = { staff: 1, admin: 2, owner: 3 };

// ====== Публични / вход ======
route('GET', '/api/ping', 'public', () => ({ ok: true }));
route('GET', '/api/plans', 'public', () => PLANS);

function createTenant({ parkName, ownerName, ownerEmail, ownerPassword, withSamples }) {
  const t = utcNow();
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  return tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(ownerEmail)) throw bad('Вече има акаунт с този имейл');
    const tid = Number(db.prepare('INSERT INTO tenants(name,plan,trial_ends,status,created_at) VALUES(?,?,?,?,?)')
      .run(parkName, 'trial', trialEnds, 'active', t).lastInsertRowid);
    const uid = Number(db.prepare('INSERT INTO users(tenant_id,email,name,pass_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(tid, ownerEmail, ownerName, auth.hashPassword(ownerPassword), 'owner', t).lastInsertRowid);
    if (withSamples) {
      const g = db.prepare('INSERT INTO games(tenant_id,name,points,active,created_at) VALUES(?,?,?,1,?)');
      for (const [n, p] of [['Стрелба с пушка', 10], ['Хвърляне на рингове', 10], ['Колелото на късмета', 5]]) g.run(tid, n, p, t);
      const p = db.prepare('INSERT INTO products(tenant_id,name,category,points,active,sort) VALUES(?,?,?,?,1,?)');
      [['Хот-дог', 'Храна', 30], ['Пуканки', 'Храна', 15], ['Захарен памук', 'Сладко', 20], ['Сладолед', 'Сладко', 20], ['Вода', 'Напитки', 10], ['Сок', 'Напитки', 15]]
        .forEach(([n, c, pts], i) => p.run(tid, n, c, pts, i));
    }
    return { tenantId: tid, userId: uid };
  });
}

route('POST', '/api/auth/signup', 'public', ({ body, req, ip, setCookie }) => {
  if (process.env.SIGNUP_DISABLED === '1') throw new HttpError(403, 'Регистрацията на нови паркове е спряна');
  if (!auth.rateLimit('signup:' + ip, 5, 3600e3)) throw new HttpError(429, 'Твърде много регистрации. Опитайте по-късно.');
  const parkName = str(body.park_name, 100);
  if (!parkName) throw bad('Въведете име на парка');
  const ownerName = str(body.name, 100);
  if (!ownerName) throw bad('Въведете вашето име');
  const { userId } = createTenant({ parkName, ownerName, ownerEmail: email(body.email), ownerPassword: password(body.password), withSamples: body.samples !== false });
  setCookie(auth.sessionCookie(req, auth.createSession(userId, req.headers['user-agent'])));
  return { ok: true };
});

route('POST', '/api/auth/login', 'public', ({ body, req, ip, setCookie }) => {
  const e = str(body.email, 200).toLowerCase();
  if (!auth.rateLimit('login:' + ip, 30, 900e3) || !auth.rateLimit('login:' + e, 10, 900e3)) {
    throw new HttpError(429, 'Твърде много опити. Опитайте след 15 минути.');
  }
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(e);
  const ok = auth.verifyPassword(String(body.password ?? ''), u ? u.pass_hash : auth.DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Грешен имейл или парола');
  if (!u.active) throw new HttpError(403, 'Акаунтът е деактивиран');
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(utcNow(), u.id);
  setCookie(auth.sessionCookie(req, auth.createSession(u.id, req.headers['user-agent'])));
  return { ok: true, role: u.role };
});

route('POST', '/api/auth/logout', 'public', ({ req, setCookie }) => {
  auth.destroySession(auth.getSessionToken(req));
  setCookie(auth.clearCookie(req));
  return { ok: true };
});

// ====== Текущ потребител ======
route('GET', '/api/me', 'staff', (ctx) => {
  const t = ctx.tenant;
  const planKey = effectivePlan(t);
  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, platform: auth.isPlatformAdmin(ctx.user.email) },
    tenant: { id: t.id, name: t.name, plan: planKey, plan_label: PLANS[planKey].label, trial_ends: t.plan === 'trial' ? t.trial_ends : null },
  };
});
route('PUT', '/api/me/password', 'staff', ({ body, user, req, setCookie }) => {
  const u = db.prepare('SELECT pass_hash FROM users WHERE id=?').get(user.id);
  if (!auth.verifyPassword(String(body.current ?? ''), u.pass_hash)) throw bad('Текущата парола е грешна');
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(auth.hashPassword(password(body.password)), user.id);
  auth.destroyUserSessions(user.id);
  setCookie(auth.sessionCookie(req, auth.createSession(user.id, req.headers['user-agent'])));
  return { ok: true };
});

// ====== Абонамент ======
route('GET', '/api/subscription', 'admin', (ctx) => {
  const key = effectivePlan(ctx.tenant);
  return { plan: key, stored_plan: ctx.tenant.plan, trial_ends: ctx.tenant.trial_ends, limits: PLANS[key], usage: usage(ctx.T), plans: PLANS };
});

// ====== Екип ======
route('GET', '/api/users', 'admin', ({ T }) =>
  db.prepare('SELECT id,email,name,role,active,created_at,last_login FROM users WHERE tenant_id=? ORDER BY role DESC, name').all(T));

route('POST', '/api/users', 'admin', (ctx) => {
  const { body, T, user } = ctx;
  const role = ['admin', 'staff'].includes(body.role) ? body.role : 'staff';
  if (role === 'admin' && user.role !== 'owner') throw new HttpError(403, 'Само собственикът може да добавя администратори');
  checkLimit(ctx, 'users');
  const e = email(body.email);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(e)) throw bad('Вече има потребител с този имейл');
  const r = db.prepare('INSERT INTO users(tenant_id,email,name,pass_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(T, e, str(body.name, 100), auth.hashPassword(password(body.password)), role, utcNow());
  return db.prepare('SELECT id,email,name,role,active,created_at FROM users WHERE id=?').get(r.lastInsertRowid);
});

route('PUT', '/api/users/:id', 'admin', (ctx) => {
  const { params, body, T, user } = ctx;
  const target = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(int(params.id, 'id'), T);
  if (!target) throw notFound('Няма такъв потребител');
  if (target.role === 'owner' && user.id !== target.id) throw new HttpError(403, 'Собственикът не може да се променя от друг потребител');
  if (user.role !== 'owner' && target.role === 'admin' && target.id !== user.id) throw new HttpError(403, 'Само собственикът може да променя администратори');
  let role = target.role;
  if (body.role !== undefined && target.role !== 'owner') {
    role = ['admin', 'staff'].includes(body.role) ? body.role : target.role;
    if (role === 'admin' && user.role !== 'owner') throw new HttpError(403, 'Само собственикът може да дава администраторски права');
  }
  let active = target.active;
  if (body.active !== undefined) {
    if (target.role === 'owner' || target.id === user.id) { if (!body.active) throw bad('Не можете да деактивирате този акаунт'); }
    active = body.active ? 1 : 0;
    if (active && !target.active) checkLimit(ctx, 'users');
  }
  db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?')
    .run(body.name !== undefined ? str(body.name, 100) : target.name, role, active, target.id);
  if (body.password) {
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(auth.hashPassword(password(body.password)), target.id);
    auth.destroyUserSessions(target.id);
  }
  if (!active) auth.destroyUserSessions(target.id);
  return db.prepare('SELECT id,email,name,role,active,created_at,last_login FROM users WHERE id=?').get(target.id);
});

// ====== Настройки ======
route('GET', '/api/settings', 'staff', ({ T }) => getSettings(T));
route('PUT', '/api/settings', 'admin', ({ body, T }) => {
  const up = db.prepare('INSERT INTO settings(tenant_id,key,value) VALUES(?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value');
  if (body.park_name !== undefined) {
    const n = str(body.park_name, 100);
    if (!n) throw bad('Въведете име на парка');
    db.prepare('UPDATE tenants SET name=? WHERE id=?').run(n, T);
  }
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (body[k] === undefined) continue;
    let v = str(body[k], 100);
    if (k === 'entry_fee') { const n = Number(v); if (!(n >= 0)) throw bad('Невалидна цена на вход'); v = String(n); }
    if (k === 'entry_points') v = String(int(v, 'начални точки', { min: 0, max: 100000 }));
    if (k === 'timezone' && !validTz(v)) throw bad('Невалидна часова зона');
    up.run(T, k, v);
  }
  return getSettings(T);
});

// Изтриване на парка и всички данни (GDPR)
route('DELETE', '/api/tenant', 'owner', ({ body, T, tenant, req, setCookie }) => {
  if (str(body.confirm, 100) !== tenant.name) throw bad('Въведете точното име на парка за потвърждение');
  tx(() => {
    db.prepare('DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE tenant_id=?)').run(T);
    for (const t of ['purchases', 'plays', 'visits', 'adjustments', 'products', 'games', 'cards', 'settings']) {
      db.prepare(`DELETE FROM ${t} WHERE tenant_id=?`).run(T);
    }
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id=?)').run(T);
    db.prepare('DELETE FROM users WHERE tenant_id=?').run(T);
    db.prepare('DELETE FROM tenants WHERE id=?').run(T);
  });
  setCookie(auth.clearCookie(req));
  return { ok: true };
});

// ====== Карти ======
route('GET', '/api/cards', 'staff', ({ query, T }) => {
  const q = `%${str(query.q, 64)}%`;
  const limit = Math.min(Number(query.limit) || 1000, 10000);
  const rows = db.prepare(`SELECT c.barcode, c.name, c.phone, c.age, c.blocked,
      (SELECT COUNT(*) FROM visits v WHERE v.tenant_id=c.tenant_id AND v.barcode=c.barcode AND v.voided=0) AS visits,
      (SELECT COUNT(*) FROM plays p WHERE p.tenant_id=c.tenant_id AND p.barcode=c.barcode AND p.voided=0) AS plays,
      (SELECT COUNT(*) FROM purchases u WHERE u.tenant_id=c.tenant_id AND u.barcode=c.barcode AND u.voided=0) AS purchases,
      (SELECT MAX(ts) FROM visits v WHERE v.tenant_id=c.tenant_id AND v.barcode=c.barcode AND v.voided=0) AS last_visit
    FROM cards c WHERE c.tenant_id=?1 AND (c.barcode LIKE ?2 OR c.name LIKE ?2 OR c.phone LIKE ?2)
    ORDER BY c.barcode LIMIT ?3`).all(T, q, limit);
  for (const r of rows) r.balance = balance(T, r.barcode);
  return rows;
});

route('GET', '/api/cards/:code', 'staff', (ctx) => {
  const code = normCode(ctx.params.code);
  const c = cardSummary(ctx, code);
  if (!c) throw notFound(`Картата ${code} не е регистрирана`);
  return c;
});

route('GET', '/api/cards/:code/history', 'staff', (ctx) => {
  const code = normCode(ctx.params.code);
  const c = cardSummary(ctx, code);
  if (!c) throw notFound(`Картата ${code} не е регистрирана`);
  return { card: c, ...cardHistory(ctx, code) };
});

// Въвеждане / редакция на информация за играещия (създава картата, ако не съществува)
route('PUT', '/api/cards/:code', 'staff', (ctx) => {
  const { params, body, T } = ctx;
  const code = normCode(params.code);
  const t = ctx.now();
  const age = body.age === '' || body.age == null ? null : int(body.age, 'възраст', { min: 0, max: 120 });
  if (qCard.get(T, code)) {
    db.prepare('UPDATE cards SET name=?, phone=?, age=?, note=?, updated_at=? WHERE tenant_id=? AND barcode=?')
      .run(str(body.name), str(body.phone, 40), age, str(body.note, 500), t, T, code);
  } else {
    checkLimit(ctx, 'cards');
    db.prepare('INSERT INTO cards(tenant_id,barcode,name,phone,age,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(T, code, str(body.name), str(body.phone, 40), age, str(body.note, 500), t, t);
  }
  return cardSummary(ctx, code);
});

route('POST', '/api/cards/:code/block', 'admin', (ctx) => {
  const code = normCode(ctx.params.code);
  if (!qCard.get(ctx.T, code)) throw notFound('Няма такава карта');
  db.prepare('UPDATE cards SET blocked=?, updated_at=? WHERE tenant_id=? AND barcode=?').run(ctx.body.blocked ? 1 : 0, ctx.now(), ctx.T, code);
  return cardSummary(ctx, code);
});

route('POST', '/api/cards/:code/adjust', 'admin', (ctx) => {
  const code = normCode(ctx.params.code);
  if (!qCard.get(ctx.T, code)) throw notFound('Няма такава карта');
  const pts = int(ctx.body.points, 'точки', { min: -1000000, max: 1000000 });
  if (pts === 0) throw bad('Въведете точки различни от 0');
  if (balance(ctx.T, code) + pts < 0) throw bad('Балансът не може да стане отрицателен');
  db.prepare('INSERT INTO adjustments(tenant_id,barcode,points,reason,user_id,ts) VALUES(?,?,?,?,?,?)')
    .run(ctx.T, code, pts, str(ctx.body.reason) || 'Ръчна корекция', ctx.user.id, ctx.now());
  return cardSummary(ctx, code);
});

// Генериране на карти (напр. 600 броя)
function codeRange(body) {
  const count = int(body.count, 'брой', { min: 1, max: 10000 });
  const start = int(body.start ?? 1, 'начален номер', { min: 0, max: 99999999 });
  const prefix = str(body.prefix ?? 'LP', 16).toUpperCase();
  const digits = int(body.digits ?? 4, 'цифри', { min: 1, max: 10 });
  return Array.from({ length: count }, (_, i) => prefix + String(start + i).padStart(digits, '0'));
}
route('POST', '/api/cards/generate', 'admin', (ctx) => {
  const codes = codeRange(ctx.body).map(normCode);
  const exists = db.prepare('SELECT 1 FROM cards WHERE tenant_id=? AND barcode=?');
  const fresh = codes.filter((c) => !exists.get(ctx.T, c));
  if (fresh.length) checkLimit(ctx, 'cards', fresh.length);
  const t = ctx.now();
  const ins = db.prepare('INSERT OR IGNORE INTO cards(tenant_id,barcode,created_at,updated_at) VALUES(?,?,?,?)');
  let created = 0;
  tx(() => { for (const c of fresh) created += Number(ins.run(ctx.T, c, t, t).changes); });
  return { created, skipped: codes.length - created, first: codes[0], last: codes[codes.length - 1] };
});

// ====== Вход (плащане – само за статистика) ======
route('POST', '/api/entry', 'staff', (ctx) => {
  const code = normCode(ctx.body.barcode);
  requireCard(ctx, code);
  const s = getSettings(ctx.T);
  const amount = ctx.body.amount != null && ctx.body.amount !== '' ? Number(ctx.body.amount) : Number(s.entry_fee);
  if (!(amount >= 0) || amount > 100000) throw bad('Невалидна сума');
  const points = Number(s.entry_points) || 0;
  const r = db.prepare('INSERT INTO visits(tenant_id,barcode,amount,points,station,user_id,ts) VALUES(?,?,?,?,?,?,?)')
    .run(ctx.T, code, amount, points, str(ctx.body.station, 60), ctx.user.id, ctx.now());
  return { visit_id: Number(r.lastInsertRowid), card: cardSummary(ctx, code) };
});

// ====== Игри ======
const qGame = db.prepare('SELECT * FROM games WHERE id=? AND tenant_id=?');
route('GET', '/api/games', 'staff', ({ query, T }) =>
  db.prepare(`SELECT id,name,points,active,created_at FROM games WHERE tenant_id=? ${query.all ? '' : 'AND active=1'} ORDER BY name`).all(T));
route('POST', '/api/games', 'admin', (ctx) => {
  const name = str(ctx.body.name, 80);
  if (!name) throw bad('Въведете име на играта');
  checkLimit(ctx, 'games');
  try {
    const r = db.prepare('INSERT INTO games(tenant_id,name,points,active,created_at) VALUES(?,?,?,1,?)')
      .run(ctx.T, name, int(ctx.body.points ?? 10, 'точки', { min: 0, max: 100000 }), ctx.now());
    return qGame.get(r.lastInsertRowid, ctx.T);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw bad('Вече има игра с това име');
    throw e;
  }
});
route('PUT', '/api/games/:id', 'admin', (ctx) => {
  const { params, body, T } = ctx;
  const g = qGame.get(int(params.id, 'id'), T);
  if (!g) throw notFound('Няма такава игра');
  const name = body.name !== undefined ? str(body.name, 80) : g.name;
  if (!name) throw bad('Въведете име на играта');
  const points = body.points !== undefined ? int(body.points, 'точки', { min: 0, max: 100000 }) : g.points;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : g.active;
  if (active && !g.active) checkLimit(ctx, 'games');
  try {
    db.prepare('UPDATE games SET name=?, points=?, active=? WHERE id=? AND tenant_id=?').run(name, points, active, g.id, T);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw bad('Вече има игра с това име');
    throw e;
  }
  return qGame.get(g.id, T);
});

// Изиграване на игра – добавяне на точки
route('POST', '/api/plays', 'staff', (ctx) => {
  const { body, T } = ctx;
  const code = normCode(body.barcode);
  const card = requireCard(ctx, code);
  const game = qGame.get(int(body.game_id, 'игра'), T);
  if (!game) throw notFound('Няма такава игра');
  if (!game.active) throw bad('Играта е деактивирана');
  const points = body.points != null && body.points !== '' ? int(body.points, 'точки', { min: 0, max: 100000 }) : game.points;
  const r = db.prepare('INSERT INTO plays(tenant_id,barcode,game_id,game_name,points,user_id,ts) VALUES(?,?,?,?,?,?,?)')
    .run(T, code, game.id, game.name, points, ctx.user.id, ctx.now());
  const times = db.prepare('SELECT COUNT(*) AS n FROM plays WHERE tenant_id=? AND barcode=? AND game_id=? AND voided=0').get(T, code, game.id).n;
  return { play_id: Number(r.lastInsertRowid), points, times_this_game: times, entered_today: card.entered_today, card: cardSummary(ctx, code) };
});

const VOID_WINDOW_MS = 5 * 60 * 1000;
const canStaffVoid = (ctx, ts) => naiveMs(ctx.now()) - naiveMs(ts) <= VOID_WINDOW_MS;

route('POST', '/api/plays/:id/void', 'staff', (ctx) => {
  const p = db.prepare('SELECT * FROM plays WHERE id=? AND tenant_id=?').get(int(ctx.params.id, 'id'), ctx.T);
  if (!p) throw notFound('Няма такъв запис');
  if (p.voided) throw bad('Записът вече е анулиран');
  // служителят може да анулира само до 5 минути; администраторът – винаги
  if (!ctx.isAdmin && !canStaffVoid(ctx, p.ts)) throw bad('Може да се анулира само до 5 минути след въвеждане');
  if (balance(ctx.T, p.barcode) - p.points < 0) throw bad('Точките вече са изхарчени – не може да се анулира');
  db.prepare('UPDATE plays SET voided=1 WHERE id=?').run(p.id);
  return { ok: true, card: cardSummary(ctx, p.barcode) };
});

// ====== Продукти ======
const qProduct = db.prepare('SELECT * FROM products WHERE id=? AND tenant_id=?');
route('GET', '/api/products', 'staff', ({ query, T }) =>
  db.prepare(`SELECT id,name,category,points,active,sort FROM products WHERE tenant_id=? ${query.all ? '' : 'AND active=1'} ORDER BY category, sort, name`).all(T));
route('POST', '/api/products', 'admin', ({ body, T }) => {
  const name = str(body.name, 80);
  if (!name) throw bad('Въведете име на продукта');
  const r = db.prepare('INSERT INTO products(tenant_id,name,category,points,active,sort) VALUES(?,?,?,?,1,?)')
    .run(T, name, str(body.category, 40), int(body.points, 'точки', { min: 0, max: 100000 }), int(body.sort ?? 0, 'подредба'));
  return qProduct.get(r.lastInsertRowid, T);
});
route('PUT', '/api/products/:id', 'admin', ({ params, body, T }) => {
  const p = qProduct.get(int(params.id, 'id'), T);
  if (!p) throw notFound('Няма такъв продукт');
  const name = body.name !== undefined ? str(body.name, 80) : p.name;
  if (!name) throw bad('Въведете име на продукта');
  db.prepare('UPDATE products SET name=?, category=?, points=?, active=?, sort=? WHERE id=? AND tenant_id=?').run(
    name,
    body.category !== undefined ? str(body.category, 40) : p.category,
    body.points !== undefined ? int(body.points, 'точки', { min: 0, max: 100000 }) : p.points,
    body.active !== undefined ? (body.active ? 1 : 0) : p.active,
    body.sort !== undefined ? int(body.sort, 'подредба') : p.sort,
    p.id, T);
  return qProduct.get(p.id, T);
});

// ====== Покупка в зоната за хранене ======
route('POST', '/api/purchases', 'staff', (ctx) => {
  const { body, T } = ctx;
  const code = normCode(body.barcode);
  if (!Array.isArray(body.items) || body.items.length === 0) throw bad('Количката е празна');
  if (body.items.length > 100) throw bad('Твърде много редове');
  return tx(() => {
    requireCard(ctx, code);
    const lines = [];
    let total = 0;
    for (const it of body.items) {
      const p = qProduct.get(int(it.product_id, 'продукт'), T);
      if (!p || !p.active) throw bad('Невалиден продукт в количката');
      const qty = int(it.qty, 'количество', { min: 1, max: 100 });
      lines.push({ p, qty });
      total += p.points * qty;
    }
    const bal = balance(T, code);
    if (bal < total) throw new HttpError(402, `Недостатъчно точки: има ${bal}, нужни ${total}`);
    const r = db.prepare('INSERT INTO purchases(tenant_id,barcode,total,station,user_id,ts) VALUES(?,?,?,?,?,?)')
      .run(T, code, total, str(body.station, 60), ctx.user.id, ctx.now());
    const pid = Number(r.lastInsertRowid);
    const insI = db.prepare('INSERT INTO purchase_items(purchase_id,product_id,name,qty,points) VALUES(?,?,?,?,?)');
    for (const { p, qty } of lines) insI.run(pid, p.id, p.name, qty, p.points);
    return { purchase_id: pid, total, card: cardSummary(ctx, code) };
  });
});
route('POST', '/api/purchases/:id/void', 'admin', (ctx) => {
  const p = db.prepare('SELECT * FROM purchases WHERE id=? AND tenant_id=?').get(int(ctx.params.id, 'id'), ctx.T);
  if (!p) throw notFound('Няма такава покупка');
  if (p.voided) throw bad('Покупката вече е анулирана');
  db.prepare('UPDATE purchases SET voided=1 WHERE id=?').run(p.id);
  return { ok: true, card: cardSummary(ctx, p.barcode) };
});
route('POST', '/api/visits/:id/void', 'admin', (ctx) => {
  const v = db.prepare('SELECT * FROM visits WHERE id=? AND tenant_id=?').get(int(ctx.params.id, 'id'), ctx.T);
  if (!v) throw notFound('Няма такъв вход');
  if (v.voided) throw bad('Входът вече е анулиран');
  if (balance(ctx.T, v.barcode) - v.points < 0) throw bad('Началните точки вече са изхарчени');
  db.prepare('UPDATE visits SET voided=1 WHERE id=?').run(v.id);
  return { ok: true, card: cardSummary(ctx, v.barcode) };
});

// ====== Последни действия (за мониторите) ======
route('GET', '/api/recent', 'staff', (ctx) => {
  const { query, T } = ctx;
  const limit = Math.min(Number(query.limit) || 15, 100);
  const J = 'LEFT JOIN cards c ON c.tenant_id=x.tenant_id AND c.barcode=x.barcode';
  if (query.game_id) {
    const rows = db.prepare(`SELECT x.id, x.barcode, x.points, x.ts, x.voided, c.name FROM plays x ${J}
      WHERE x.tenant_id=? AND x.game_id=? ORDER BY x.id DESC LIMIT ?`).all(T, int(query.game_id, 'игра'), limit);
    for (const r of rows) r.can_void = !r.voided && (ctx.isAdmin || canStaffVoid(ctx, r.ts));
    return rows;
  }
  if (query.type === 'purchases') {
    const rows = db.prepare(`SELECT x.id, x.barcode, x.total, x.ts, x.voided, c.name FROM purchases x ${J}
      WHERE x.tenant_id=? ORDER BY x.id DESC LIMIT ?`).all(T, limit);
    const items = db.prepare('SELECT name, qty, points FROM purchase_items WHERE purchase_id=?');
    for (const r of rows) r.items = items.all(r.id);
    return rows;
  }
  if (query.type === 'visits') {
    return db.prepare(`SELECT x.id, x.barcode, x.amount, x.ts, x.voided, c.name FROM visits x ${J}
      WHERE x.tenant_id=? ORDER BY x.id DESC LIMIT ?`).all(T, limit);
  }
  throw bad('Невалидна заявка');
});

// ====== Статистика ======
function range(ctx) {
  const today = ctx.now().slice(0, 10);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(ctx.query.from || '') ? ctx.query.from : today;
  const to = re.test(ctx.query.to || '') ? ctx.query.to : from;
  return [from + ' 00:00:00', to + ' 23:59:59', from, to];
}
route('GET', '/api/stats', 'admin', (ctx) => {
  const T = ctx.T;
  const [a, b, from, to] = range(ctx);
  const one = (sql) => db.prepare(sql).get(T, a, b);
  const all = (sql) => db.prepare(sql).all(T, a, b);
  const W = 'tenant_id=? AND voided=0 AND ts BETWEEN ? AND ?';
  return {
    from, to,
    totals: {
      cards_total: db.prepare('SELECT COUNT(*) AS n FROM cards WHERE tenant_id=?').get(T).n,
      cards_with_holder: db.prepare("SELECT COUNT(*) AS n FROM cards WHERE tenant_id=? AND name<>''").get(T).n,
      ...one(`SELECT COUNT(*) AS entries, COALESCE(SUM(amount),0) AS entry_amount, COUNT(DISTINCT barcode) AS unique_visitors FROM visits WHERE ${W}`),
      ...one(`SELECT COUNT(*) AS plays, COALESCE(SUM(points),0) AS points_won, COUNT(DISTINCT barcode) AS unique_players FROM plays WHERE ${W}`),
      ...one(`SELECT COUNT(*) AS purchases, COALESCE(SUM(total),0) AS points_spent FROM purchases WHERE ${W}`),
    },
    byGame: all(`SELECT game_name, COUNT(*) AS plays, COUNT(DISTINCT barcode) AS players, SUM(points) AS points
      FROM plays WHERE ${W} GROUP BY game_id ORDER BY plays DESC`),
    byProduct: all(`SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty*i.points) AS points
      FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
      WHERE p.tenant_id=? AND p.voided=0 AND p.ts BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC`),
    byHour: all(`SELECT substr(ts,12,2) AS hour, COUNT(*) AS plays FROM plays WHERE ${W} GROUP BY hour ORDER BY hour`),
    byDay: all(`SELECT substr(ts,1,10) AS day, COUNT(*) AS entries, SUM(amount) AS amount FROM visits WHERE ${W} GROUP BY day ORDER BY day`),
    byStaff: all(`SELECT COALESCE(u.name, u.email, '—') AS name, COUNT(*) AS plays FROM plays p LEFT JOIN users u ON u.id=p.user_id
      WHERE p.tenant_id=? AND p.voided=0 AND p.ts BETWEEN ? AND ? GROUP BY p.user_id ORDER BY plays DESC`),
    topPlayers: all(`SELECT p.barcode, c.name, COUNT(*) AS plays, SUM(p.points) AS points
      FROM plays p LEFT JOIN cards c ON c.tenant_id=p.tenant_id AND c.barcode=p.barcode
      WHERE p.tenant_id=? AND p.voided=0 AND p.ts BETWEEN ? AND ?
      GROUP BY p.barcode ORDER BY plays DESC LIMIT 20`),
  };
});

// ====== CSV експорт ======
function csv(rows, cols) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // защита от формули в Excel
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.map((c) => c[1]).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(';'))].join('\r\n');
}
route('GET', '/api/export/:kind', 'admin', (ctx) => {
  const T = ctx.T;
  const [a, b, from, to] = range(ctx);
  let rows, cols;
  const J = 'LEFT JOIN cards c ON c.tenant_id=x.tenant_id AND c.barcode=x.barcode LEFT JOIN users u ON u.id=x.user_id';
  switch (ctx.params.kind) {
    case 'activity':
      rows = db.prepare(`
        SELECT x.ts, 'Вход' AS type, x.barcode, c.name, '' AS item, x.points AS points, x.amount AS amount, u.name AS staff, x.voided FROM visits x ${J} WHERE x.tenant_id=?1 AND x.ts BETWEEN ?2 AND ?3
        UNION ALL SELECT x.ts, 'Игра', x.barcode, c.name, x.game_name, x.points, '', u.name, x.voided FROM plays x ${J} WHERE x.tenant_id=?1 AND x.ts BETWEEN ?2 AND ?3
        UNION ALL SELECT x.ts, 'Покупка', x.barcode, c.name,
          (SELECT GROUP_CONCAT(i.qty || 'x ' || i.name, ', ') FROM purchase_items i WHERE i.purchase_id=x.id), -x.total, '', u.name, x.voided
          FROM purchases x ${J} WHERE x.tenant_id=?1 AND x.ts BETWEEN ?2 AND ?3
        UNION ALL SELECT x.ts, 'Корекция', x.barcode, c.name, x.reason, x.points, '', u.name, 0 FROM adjustments x ${J} WHERE x.tenant_id=?1 AND x.ts BETWEEN ?2 AND ?3
        ORDER BY 1`).all(T, a, b);
      cols = [['ts', 'Дата и час'], ['type', 'Тип'], ['barcode', 'Баркод'], ['name', 'Име'], ['item', 'Игра/Продукти'], ['points', 'Точки'], ['amount', 'Вход'], ['staff', 'Служител'], ['voided', 'Анулирано']];
      break;
    case 'cards':
      rows = db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM visits v WHERE v.tenant_id=c.tenant_id AND v.barcode=c.barcode AND v.voided=0) AS visits,
          (SELECT COALESCE(SUM(amount),0) FROM visits v WHERE v.tenant_id=c.tenant_id AND v.barcode=c.barcode AND v.voided=0) AS entry_paid,
          (SELECT COUNT(*) FROM plays p WHERE p.tenant_id=c.tenant_id AND p.barcode=c.barcode AND p.voided=0) AS plays,
          (SELECT COUNT(*) FROM purchases u WHERE u.tenant_id=c.tenant_id AND u.barcode=c.barcode AND u.voided=0) AS purchases
        FROM cards c WHERE c.tenant_id=? ORDER BY barcode`).all(T);
      for (const r of rows) r.balance = balance(T, r.barcode);
      cols = [['barcode', 'Баркод'], ['name', 'Име'], ['phone', 'Телефон'], ['age', 'Възраст'], ['note', 'Бележка'], ['visits', 'Брой входове'], ['entry_paid', 'Платено за вход'], ['plays', 'Брой игри'], ['purchases', 'Брой покупки'], ['balance', 'Баланс точки'], ['blocked', 'Блокирана']];
      break;
    default:
      throw notFound('Непознат експорт');
  }
  return { __raw: csv(rows, cols), type: 'text/csv; charset=utf-8', filename: `${ctx.params.kind}_${from}_${to}.csv` };
});

// ====== Платформа (оператор на SaaS) ======
route('GET', '/api/platform/tenants', 'platform', () => {
  const rows = db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) AS users,
      (SELECT email FROM users u WHERE u.tenant_id=t.id AND u.role='owner') AS owner_email,
      (SELECT COUNT(*) FROM cards c WHERE c.tenant_id=t.id) AS cards,
      (SELECT COUNT(*) FROM plays p WHERE p.tenant_id=t.id AND p.voided=0) AS plays,
      (SELECT COUNT(*) FROM visits v WHERE v.tenant_id=t.id AND v.voided=0) AS visits,
      (SELECT MAX(last_login) FROM users u WHERE u.tenant_id=t.id) AS last_login
    FROM tenants t ORDER BY t.id DESC`).all();
  for (const r of rows) r.effective_plan = effectivePlan(r);
  return { tenants: rows, plans: PLANS };
});
route('PUT', '/api/platform/tenants/:id', 'platform', ({ params, body }) => {
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(int(params.id, 'id'));
  if (!t) throw notFound('Няма такъв парк');
  const plan = body.plan !== undefined ? (PLANS[body.plan] ? body.plan : t.plan) : t.plan;
  const status = body.status !== undefined ? (['active', 'suspended'].includes(body.status) ? body.status : t.status) : t.status;
  let trialEnds = t.trial_ends;
  if (body.trial_ends !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.trial_ends)) throw bad('Невалидна дата');
    trialEnds = body.trial_ends + ' 23:59:59';
  }
  db.prepare('UPDATE tenants SET plan=?, status=?, trial_ends=? WHERE id=?').run(plan, status, trialEnds, t.id);
  return db.prepare('SELECT * FROM tenants WHERE id=?').get(t.id);
});

// ---------- HTTP сървър ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!path.extname(pathname)) pathname += '.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Няма такава страница'); return; }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(bad('Твърде голяма заявка')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(bad('Невалиден JSON')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || '';
}

// Защита от CSRF: заявките, които променят данни, трябва да идват от същия произход
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // не-браузърни клиенти; бисквитката е SameSite=Lax
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const cookies = [];
  const send = (status, obj) => {
    const h = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (cookies.length) h['Set-Cookie'] = cookies;
    res.writeHead(status, h);
    res.end(JSON.stringify(obj));
  };
  try {
    const r = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!r) throw notFound('Непознат адрес');
    if (req.method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Забранен произход на заявката');

    const ctx = { req, ip: clientIp(req), query: Object.fromEntries(url.searchParams), setCookie: (c) => cookies.push(c) };
    if (r.access !== 'public') {
      const a = auth.loadAuth(req);
      if (!a) throw new HttpError(401, 'Моля, влезте в профила си');
      const platform = auth.isPlatformAdmin(a.email);
      if (r.access === 'platform') {
        if (!platform) throw new HttpError(403, 'Нямате достъп');
      } else {
        if (a.tenant_status !== 'active') throw new HttpError(403, 'Акаунтът на парка е спрян. Свържете се с поддръжката.');
        const need = { staff: 1, admin: 2, owner: 3 }[r.access];
        if ((ROLE_RANK[a.role] || 0) < need) throw new HttpError(403, 'Нямате права за това действие');
      }
      ctx.user = { id: a.id, email: a.email, name: a.name, role: a.role };
      ctx.tenant = { id: a.tenant_id, name: a.tenant_name, plan: a.plan, trial_ends: a.trial_ends, status: a.tenant_status };
      ctx.T = a.tenant_id;
      ctx.isAdmin = ROLE_RANK[a.role] >= 2;
      const tz = db.prepare("SELECT value FROM settings WHERE tenant_id=? AND key='timezone'").get(a.tenant_id)?.value || DEFAULT_SETTINGS.timezone;
      ctx.now = () => nowIn(tz);
    }
    const m = pathname.match(r.re);
    ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    ctx.body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const out = await r.handler(ctx);
    if (out && out.__raw !== undefined) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"` });
      return res.end(out.__raw);
    }
    send(200, out);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Вътрешна грешка' });
  }
});

setInterval(() => auth.purgeExpired(), 3600e3).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎡 Лунапарк SaaS работи на порт ${PORT}`);
    console.log(`   База данни: ${DB_FILE}`);
    console.log(`   Локално:    http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`   В мрежата:  http://${n.address}:${PORT}`);
    }
    if (!process.env.PLATFORM_ADMINS) console.log('   ℹ  PLATFORM_ADMINS не е зададен – платформеният панел е недостъпен.');
    console.log('');
  });
}

module.exports = { server, createTenant, PLANS };
