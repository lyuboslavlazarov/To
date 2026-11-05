'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 60;
const COOKIE = 'cc_session';

// ---------------- помощни ----------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const pad = (n) => String(n).padStart(2, '0');
function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const today = () => now().slice(0, 10);
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const dt = new Date(y, m - 1 + n, Math.min(d, last));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 864e5);
}
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
function num(v, name, { min = 0, max = 1e7 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`Невалидна стойност: ${name}`);
  return n;
}
const int = (v, name, o) => { const n = num(v, name, o); if (!Number.isInteger(n)) throw bad(`Невалидна стойност: ${name}`); return n; };
const money = (n) => Math.round(n * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function dateArg(v, name) { const s = str(v, 10); if (!isDate(s)) throw bad(`Невалидна дата: ${name}`); return s; }
function timeArg(v, name, optional = false) {
  const s = str(v, 5);
  if (optional && !s) return '';
  if (!isTime(s)) throw bad(`Невалиден час: ${name}`);
  return s;
}
function youtubeId(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : '';
}

function getSettings() {
  const o = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) o[r.key] = r.value;
  return o;
}

// ---------------- пароли и сесии ----------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const exp = Buffer.from(h, 'hex');
  return crypto.timingSafeEqual(exp, crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), exp.length));
}
const DUMMY_HASH = hashPassword('x');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .run(sha256(token), userId, Date.now(), Date.now() + SESSION_DAYS * 864e5);
  return token;
}
function cookies(req) {
  const o = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return o;
}
const isSecure = (req) => process.env.COOKIE_SECURE === '1' || req.socket.encrypted ||
  String(req.headers['x-forwarded-proto'] || '').startsWith('https');
const sessionCookie = (req, token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;

const qSession = db.prepare('SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?');
function loadUser(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  const u = qSession.get(sha256(t));
  if (!u || u.expires_at < Date.now() || u.blocked) return null;
  return u;
}

const buckets = new Map();
function rateLimit(key, max, ms) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + ms }; buckets.set(key, b); }
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  return ++b.n <= max;
}

// ---------------- клуб ----------------
function clubInfo(u, s = getSettings()) {
  const t = today();
  const until = u.club_until || null;
  const expired = u.club_status === 'active' && !!until && until < t;
  const daysLeft = until ? daysBetween(t, until) : null;
  const autoExpire = s.club_auto_expire === '1';
  const member = u.club_status === 'active' && !(autoExpire && expired);
  const warn = Number(s.expiry_warn_days) || 5;
  return {
    status: u.club_status, since: u.club_since, until, expired, daysLeft, member,
    expiringSoon: u.club_status === 'active' && !expired && daysLeft !== null && daysLeft <= warn,
    requestedAt: u.club_requested_at,
    price: Number(s.club_price) || 10,
    discountPct: Number(s.club_discount_pct) || 0,
  };
}
const isMember = (u) => !!u && clubInfo(u).member;

// ---------------- известия и точки ----------------
const qNotify = db.prepare(`INSERT OR IGNORE INTO notifications(user_id,audience,title,body,link,dedupe,created_at) VALUES(?,?,?,?,?,?,?)`);
function notify(userId, title, body = '', link = '', dedupe = null) {
  qNotify.run(userId, 'user', title, body, link, dedupe, now());
}
const qAward = db.prepare('INSERT OR IGNORE INTO points_log(user_id,points,reason,key,ts) VALUES(?,?,?,?,?)');
function award(userId, points, reason, key) {
  const r = qAward.run(userId, points, reason, key, now());
  return r.changes > 0;
}
const userPoints = (id) => db.prepare('SELECT COALESCE(SUM(points),0) p FROM points_log WHERE user_id=?').get(id).p;

const LEVELS = [
  { min: 0, name: 'Начинаещ', icon: '🌱' },
  { min: 100, name: 'Чистофайник', icon: '🧽' },
  { min: 300, name: 'Еко герой', icon: '🌿' },
  { min: 700, name: 'Майстор на чистотата', icon: '✨' },
  { min: 1500, name: 'Легенда на зеления дом', icon: '🏆' },
];
function levelFor(p) {
  let i = 0;
  while (i + 1 < LEVELS.length && p >= LEVELS[i + 1].min) i++;
  const next = LEVELS[i + 1] || null;
  return { ...LEVELS[i], index: i + 1, next: next ? { ...next, need: next.min - p } : null };
}

const TIPS = [
  'Оцетът и содата бикарбонат разтварят котлен камък без агресивни химикали.',
  'Пръскайте препарата върху кърпата, а не върху повърхността – пестите до 30% препарат.',
  'Микрофибърна кърпа + малко вода махат до 99% от бактериите по гладки повърхности.',
  'Проветрявайте 10 минути след почистване – въздухът в дома е по-чист от този навън, само ако дишa.',
  'Почиствайте отгоре надолу: прахът пада и не се налага да миете два пъти.',
  'Оставете препарата да действа 3–5 минути – така търкате по-малко и пестите усилия.',
  'Концентратите в стъклена бутилка спестяват стотици пластмасови шишета годишно.',
  'Ръкавиците пазят кожата дори при натурални препарати – здравето е на първо място.',
  'Никога не смесвайте белина с оцет или амоняк – образуват се токсични газове.',
  'Една кърпа за всяка зона (баня, кухня, прах) предотвратява пренасянето на бактерии.',
  'Лимонената киселина е отличен заместител на препаратите за котлен камък в чайника.',
  'Сухото почистване с четка преди мокрото намалява разхода на вода и препарат наполовина.',
];
const tipOfDay = () => TIPS[(daysBetween('2024-01-01', today()) % TIPS.length + TIPS.length) % TIPS.length];

function ecoStats(userId) {
  const r = db.prepare(`SELECT COALESCE(SUM(i.qty*i.eco_money),0) money, COALESCE(SUM(i.qty*i.eco_plastic),0) plastic,
      COALESCE(SUM(i.qty*i.eco_chem),0) chem, COALESCE(SUM(i.qty),0) items
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.user_id=? AND o.status<>'cancelled'`).get(userId);
  const d = db.prepare(`SELECT COALESCE(SUM(discount),0) d FROM orders WHERE user_id=? AND status<>'cancelled'`).get(userId).d;
  return { money: money(r.money), plastic: r.plastic, chem: r.chem, items: r.items, clubSaved: money(d), bottles: Math.floor(r.plastic / 40) };
}

function streak(userId) {
  const days = new Set(db.prepare(`SELECT substr(key,5) d FROM points_log WHERE user_id=? AND key LIKE 'tip:%'`).all(userId).map((r) => r.d));
  let n = 0; let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function badges(userId, u) {
  const c = (sql, ...a) => db.prepare(sql).get(userId, ...a).n;
  const orders = c(`SELECT COUNT(*) n FROM orders WHERE user_id=? AND status<>'cancelled'`);
  const videos = c(`SELECT COUNT(*) n FROM points_log WHERE user_id=? AND key LIKE 'video:%'`);
  const school = c(`SELECT COUNT(*) n FROM school_signups WHERE user_id=?`);
  const consults = c(`SELECT COUNT(*) n FROM consult_slots WHERE user_id=? AND status IN ('booked','done')`);
  const eco = ecoStats(userId);
  const st = streak(userId);
  return [
    { id: 'first_order', icon: '🛒', name: 'Първа поръчка', desc: 'Направихте първата си поръчка', ok: orders >= 1 },
    { id: 'loyal', icon: '💚', name: 'Верен клиент', desc: '5 поръчки', ok: orders >= 5, progress: [Math.min(orders, 5), 5] },
    { id: 'video1', icon: '🎬', name: 'Любопитко', desc: 'Изгледахте първото обучително видео', ok: videos >= 1 },
    { id: 'video5', icon: '🎓', name: 'Отличник', desc: '5 обучителни видеа', ok: videos >= 5, progress: [Math.min(videos, 5), 5] },
    { id: 'school', icon: '🏫', name: 'Ученик', desc: 'Записахте се за събитие от училището', ok: school >= 1 },
    { id: 'consult', icon: '🤝', name: 'Личен съвет', desc: 'Запазихте консултация', ok: consults >= 1 },
    { id: 'club', icon: '⭐', name: 'Член на клуба', desc: 'Активен клубен абонамент', ok: clubInfo(u).member },
    { id: 'plastic1k', icon: '🌍', name: 'Спасител на океана', desc: 'Спестихте 1 кг пластмаса', ok: eco.plastic >= 1000, progress: [Math.min(eco.plastic, 1000), 1000] },
    { id: 'streak7', icon: '🔥', name: 'Седмица навик', desc: '7 поредни дни със съвета на деня', ok: st >= 7, progress: [Math.min(st, 7), 7] },
  ];
}

// Лични автоматични известия (абонамент) – създават се при проверка, без дубликати
function personalReminders(u) {
  const ci = clubInfo(u);
  if (ci.status !== 'active' || !ci.until) return;
  if (ci.expired) notify(u.id, 'Абонаментът ви за клуба изтече', `Изтече на ${ci.until}. Подновете го, за да запазите отстъпката от ${ci.discountPct}% и достъпа до записите.`, '#/club', `exp:${ci.until}`);
  else if (ci.expiringSoon) notify(u.id, `Абонаментът ви изтича след ${ci.daysLeft} дни`, `Валиден е до ${ci.until}. Подновете го навреме.`, '#/club', `warn:${ci.until}`);
}

// ---------------- представяне ----------------
function publicUser(u) {
  if (!u) return null;
  const p = userPoints(u.id);
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, club: clubInfo(u), points: p, level: levelFor(p) };
}
const STATUS = { ordered: 'Поръчана', arrived: 'Пристигнала', delivered: 'Предадена', cancelled: 'Отказана' };

function productOut(p) {
  return { ...p, video_id: youtubeId(p.video_url) };
}
function priceFor(p, member, s) {
  return member ? money(p.price * (1 - (Number(s.club_discount_pct) || 0) / 100)) : p.price;
}
function slotTaken(id) {
  return db.prepare(`SELECT COUNT(*) n FROM orders WHERE pickup_slot_id=? AND status<>'cancelled'`).get(id).n;
}
function slotOut(s) {
  const taken = slotTaken(s.id);
  return { ...s, taken, left: s.capacity > 0 ? Math.max(0, s.capacity - taken) : null };
}
function orderOut(o, withUser = false) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(o.id);
  const out = { ...o, status_label: STATUS[o.status] || o.status, items };
  if (withUser) {
    const u = db.prepare('SELECT id,name,email,phone FROM users WHERE id=?').get(o.user_id);
    out.user = u;
    out.log = db.prepare('SELECT ts,change FROM order_log WHERE order_id=? ORDER BY id').all(o.id);
  }
  return out;
}
function schoolOut(it, u) {
  const signed = u ? !!db.prepare('SELECT 1 FROM school_signups WHERE item_id=? AND user_id=?').get(it.id, u.id) : false;
  const count = db.prepare('SELECT COUNT(*) n FROM school_signups WHERE item_id=?').get(it.id).n;
  const locked = it.club_only && !(u && (isMember(u) || u.role === 'admin'));
  return {
    ...it, signed, count, left: it.seats > 0 ? Math.max(0, it.seats - count) : null, locked,
    youtube_url: locked ? '' : it.youtube_url, link: locked || (!signed && u?.role !== 'admin' && it.type === 'presentation') ? '' : it.link,
    video_id: locked ? '' : youtubeId(it.youtube_url),
  };
}

// ---------------- маршрути ----------------
const routes = [];
function route(method, pattern, auth, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth, handler });
}
const PUB = 0, USER = 1, ADMIN = 2;

// --- акаунти ---
route('POST', '/api/auth/register', PUB, ({ req, body, res }) => {
  if (!rateLimit('reg:' + req.socket.remoteAddress, 10, 3600e3)) throw new HttpError(429, 'Твърде много опити. Опитайте по-късно.');
  const email = str(body.email, 120).toLowerCase();
  const name = str(body.name, 80);
  const pw = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Невалиден имейл');
  if (!name) throw bad('Въведете име');
  if (pw.length < 6) throw bad('Паролата трябва да е поне 6 символа');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('Вече има акаунт с този имейл');
  // Първият регистриран акаунт става администратор (собственикът), ако няма друг.
  const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE role='admin'`).get();
  const role = hasAdmin ? 'customer' : 'admin';
  const id = db.prepare('INSERT INTO users(email,name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(email, name, str(body.phone, 30), hashPassword(pw), role, now()).lastInsertRowid;
  award(Number(id), 20, 'Добре дошли!', 'welcome');
  notify(Number(id), 'Добре дошли! 🌱', 'Получихте 20 точки. Разгледайте обучителните видеа – за всяко изгледано получавате още точки.', '#/shop', 'welcome');
  res.setHeader('Set-Cookie', sessionCookie(req, createSession(Number(id)), SESSION_DAYS * 86400));
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
});

route('POST', '/api/auth/login', PUB, ({ req, body, res }) => {
  const email = str(body.email, 120).toLowerCase();
  if (!rateLimit('login:' + req.socket.remoteAddress, 20, 600e3) || !rateLimit('login:' + email, 10, 600e3)) throw new HttpError(429, 'Твърде много опити. Опитайте след 10 минути.');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = verifyPassword(body.password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Грешен имейл или парола');
  if (u.blocked) throw new HttpError(403, 'Акаунтът е спрян. Свържете се с нас.');
  res.setHeader('Set-Cookie', sessionCookie(req, createSession(u.id), SESSION_DAYS * 86400));
  return { user: publicUser(u) };
});

route('POST', '/api/auth/logout', PUB, ({ req, res }) => {
  const t = cookies(req)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(t));
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  return { ok: true };
});

route('GET', '/api/me', PUB, ({ user }) => {
  if (user) personalReminders(user);
  const s = getSettings();
  return {
    user: publicUser(user),
    settings: { shop_name: s.shop_name, owner_name: s.owner_name, tagline: s.tagline, club_price: Number(s.club_price), club_discount_pct: Number(s.club_discount_pct), pickup_location: s.pickup_location, contact_phone: s.contact_phone, youtube_channel: s.youtube_channel },
  };
});

route('PUT', '/api/me', USER, ({ user, body }) => {
  const name = str(body.name, 80) || user.name;
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, str(body.phone, 30), user.id);
  if (body.new_password) {
    if (!verifyPassword(body.password, user.password_hash)) throw bad('Текущата парола е грешна');
    if (String(body.new_password).length < 6) throw bad('Новата парола трябва да е поне 6 символа');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.new_password), user.id);
  }
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) };
});

// --- геймификация ---
route('GET', '/api/me/progress', USER, ({ user }) => {
  const p = userPoints(user.id);
  const t = today();
  return {
    points: p, level: levelFor(p), levels: LEVELS, eco: ecoStats(user.id), badges: badges(user.id, user),
    streak: streak(user.id), tip: tipOfDay(), tipDone: !!db.prepare('SELECT 1 FROM points_log WHERE user_id=? AND key=?').get(user.id, 'tip:' + t),
    history: db.prepare('SELECT points,reason,ts FROM points_log WHERE user_id=? ORDER BY id DESC LIMIT 15').all(user.id),
  };
});
route('POST', '/api/me/tip', USER, ({ user }) => {
  const got = award(user.id, 5, 'Съвет на деня', 'tip:' + today());
  const st = streak(user.id);
  if (got && st > 0 && st % 7 === 0) award(user.id, 30, `Бонус: ${st} поредни дни`, 'streak:' + today());
  return { awarded: got, streak: st };
});
route('POST', '/api/me/watched', USER, ({ user, body }) => {
  const kind = body.kind === 'school' ? 'school' : 'product';
  const id = int(body.id, 'id', { min: 1 });
  const exists = kind === 'product' ? db.prepare('SELECT name FROM products WHERE id=?').get(id) : db.prepare('SELECT title name FROM school_items WHERE id=?').get(id);
  if (!exists) throw new HttpError(404, 'Не е намерено');
  const got = award(user.id, 10, `Видео: ${exists.name}`, `video:${kind}:${id}`);
  return { awarded: got, points: userPoints(user.id) };
});
route('GET', '/api/leaderboard', PUB, () => ({
  top: db.prepare(`SELECT u.name, SUM(p.points) points FROM points_log p JOIN users u ON u.id=p.user_id
    WHERE u.role<>'admin' AND u.blocked=0 GROUP BY u.id ORDER BY points DESC LIMIT 10`).all()
    .map((r) => ({ name: r.name.split(' ')[0] + (r.name.split(' ')[1] ? ' ' + r.name.split(' ')[1][0] + '.' : ''), points: r.points, level: levelFor(r.points) })),
  community: (() => {
    const r = db.prepare(`SELECT COALESCE(SUM(i.qty*i.eco_plastic),0) plastic, COALESCE(SUM(i.qty*i.eco_chem),0) chem, COALESCE(SUM(i.qty*i.eco_money),0) money
      FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'cancelled'`).get();
    return { plastic: r.plastic, chem: r.chem, money: money(r.money), members: db.prepare(`SELECT COUNT(*) n FROM users WHERE club_status='active'`).get().n };
  })(),
}));

// --- известия ---
function myNotifications(user, limit = 30) {
  const audience = isMember(user) ? `('all','club')` : `('all')`;
  return db.prepare(`SELECT n.*, (r.notif_id IS NOT NULL) AS read FROM notifications n
    LEFT JOIN notification_reads r ON r.notif_id=n.id AND r.user_id=?1
    WHERE (n.user_id=?1 OR (n.user_id IS NULL AND n.audience IN ${audience} AND n.created_at >= ?2))
    ORDER BY n.id DESC LIMIT ${limit}`).all(user.id, user.created_at.slice(0, 10));
}
route('GET', '/api/notifications', USER, ({ user }) => {
  personalReminders(user);
  const list = myNotifications(user).map((n) => ({ ...n, read: !!n.read }));
  return { list, unread: list.filter((n) => !n.read).length };
});
route('POST', '/api/notifications/read', USER, ({ user, body }) => {
  const ids = Array.isArray(body.ids) ? body.ids : myNotifications(user, 200).map((n) => n.id);
  const st = db.prepare('INSERT OR IGNORE INTO notification_reads(user_id,notif_id) SELECT ?,id FROM notifications WHERE id=?');
  tx(() => { for (const id of ids) st.run(user.id, Number(id)); });
  return { ok: true };
});

// --- обратна връзка (бутонът е навсякъде) ---
route('POST', '/api/feedback', PUB, ({ req, user, body }) => {
  if (!rateLimit('fb:' + req.socket.remoteAddress, 20, 3600e3)) throw new HttpError(429, 'Твърде много съобщения. Опитайте по-късно.');
  const message = str(body.message, 3000);
  if (message.length < 2) throw bad('Напишете съобщение');
  const rating = body.rating ? int(body.rating, 'оценка', { min: 1, max: 5 }) : null;
  db.prepare('INSERT INTO feedback(user_id,name,contact,page,rating,message,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(user?.id ?? null, user ? user.name : str(body.name, 80), user ? user.email : str(body.contact, 120), str(body.page, 200), rating, message, now());
  if (user) award(user.id, 5, 'Благодарим за обратната връзка', 'fb:' + today());
  return { ok: true };
});

// --- продукти ---
route('GET', '/api/products', PUB, ({ user }) => {
  const s = getSettings(); const m = isMember(user);
  const watched = user ? new Set(db.prepare(`SELECT key FROM points_log WHERE user_id=? AND key LIKE 'video:product:%'`).all(user.id).map((r) => Number(r.key.split(':')[2]))) : new Set();
  return db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort, name').all().map((p) => ({
    ...productOut(p), club_price: priceFor(p, true, s), my_price: priceFor(p, m, s), watched: watched.has(p.id),
  }));
});
route('GET', '/api/products/:id', PUB, ({ params, user }) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(params.id));
  if (!p) throw new HttpError(404, 'Продуктът не е намерен');
  const s = getSettings();
  const related = db.prepare('SELECT id,type,title,starts_at FROM school_items WHERE product_id=? AND active=1').all(p.id);
  return { ...productOut(p), club_price: priceFor(p, true, s), my_price: priceFor(p, isMember(user), s), related };
});

// --- вземане на поръчки ---
route('GET', '/api/pickup-slots', PUB, () =>
  db.prepare('SELECT * FROM pickup_slots WHERE active=1 AND date>=? ORDER BY date, time_from').all(today())
    .map(slotOut).filter((s) => s.left === null || s.left > 0));

// --- поръчки ---
route('POST', '/api/orders', USER, ({ user, body }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('Количката е празна');
  if (items.length > 100) throw bad('Твърде много продукти');
  const s = getSettings();
  const slotId = int(body.pickup_slot_id, 'дата за вземане', { min: 1 });
  return tx(() => {
    const slot = db.prepare('SELECT * FROM pickup_slots WHERE id=? AND active=1').get(slotId);
    if (!slot || slot.date < today()) throw bad('Избраната дата за вземане вече не е налична');
    if (slot.capacity > 0 && slotTaken(slot.id) >= slot.capacity) throw bad('Избраната дата е запълнена. Изберете друга.');
    const lines = [];
    const qp = db.prepare('SELECT * FROM products WHERE id=? AND active=1');
    for (const it of items) {
      const p = qp.get(int(it.product_id, 'продукт', { min: 1 }));
      if (!p) throw bad('Някой от продуктите вече не се предлага');
      const qty = int(it.qty, 'количество', { min: 1, max: 99 });
      const ex = lines.find((l) => l.p.id === p.id);
      if (ex) ex.qty += qty; else lines.push({ p, qty });
    }
    const subtotal = money(lines.reduce((a, l) => a + l.p.price * l.qty, 0));
    const pct = isMember(user) ? Number(s.club_discount_pct) || 0 : 0;
    const discount = money(subtotal * pct / 100);
    const total = money(subtotal - discount);
    const ts = now();
    const id = Number(db.prepare(`INSERT INTO orders(user_id,status,pickup_slot_id,pickup_date,pickup_time,pickup_location,subtotal,discount_pct,discount,total,note,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, 'ordered', slot.id, slot.date, [slot.time_from, slot.time_to].filter(Boolean).join('–'),
      slot.location || s.pickup_location, subtotal, pct, discount, total, str(body.note, 500), ts, ts).lastInsertRowid);
    const qi = db.prepare('INSERT INTO order_items(order_id,product_id,name,price,qty,eco_money,eco_plastic,eco_chem) VALUES(?,?,?,?,?,?,?,?)');
    for (const l of lines) qi.run(id, l.p.id, l.p.name, l.p.price, l.qty, l.p.eco_money, l.p.eco_plastic, l.p.eco_chem);
    db.prepare('INSERT INTO order_log(order_id,ts,change) VALUES(?,?,?)').run(id, ts, 'Поръчана');
    award(user.id, Math.max(1, Math.round(total)), `Поръчка №${id}`, `order:${id}`);
    const eco = lines.reduce((a, l) => a + l.qty * l.p.eco_plastic, 0);
    notify(user.id, `Поръчка №${id} е приета ✅`, `Ще я вземете на ${slot.date} ${[slot.time_from, slot.time_to].filter(Boolean).join('–')}. С нея спестявате ${eco} г пластмаса!`, '#/orders');
    return orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  });
});
route('GET', '/api/orders', USER, ({ user }) =>
  db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(user.id).map((o) => orderOut(o)));
route('POST', '/api/orders/:id/cancel', USER, ({ user, params }) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(params.id), user.id);
  if (!o) throw new HttpError(404, 'Поръчката не е намерена');
  if (o.status !== 'ordered') throw bad('Поръчката вече е обработена и не може да се откаже');
  db.prepare(`UPDATE orders SET status='cancelled', updated_at=? WHERE id=?`).run(now(), o.id);
  db.prepare('INSERT INTO order_log(order_id,ts,change) VALUES(?,?,?)').run(o.id, now(), 'Отказана от клиента');
  db.prepare('DELETE FROM points_log WHERE user_id=? AND key=?').run(user.id, `order:${o.id}`);
  return { ok: true };
});

// --- клуб ---
route('POST', '/api/club/request', USER, ({ user }) => {
  const ci = clubInfo(user);
  if (ci.status === 'restricted') throw bad('Достъпът до клуба е ограничен. Свържете се с нас.');
  if (ci.status === 'active' && !ci.expired && !ci.expiringSoon) throw bad('Вече сте член на клуба');
  db.prepare('UPDATE users SET club_requested_at=?, club_status=CASE WHEN club_status=\'active\' THEN club_status ELSE \'pending\' END WHERE id=?').run(now(), user.id);
  notify(user.id, 'Заявката ви за клуба е получена', `Абонаментът е ${ci.price}€ на месец. Ще го активираме веднага след плащане при вземане на поръчка или по договорен начин.`, '#/club', 'clubreq:' + today());
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) };
});

// --- училище ---
route('GET', '/api/school', PUB, ({ user }) =>
  db.prepare(`SELECT * FROM school_items WHERE active=1 ORDER BY CASE WHEN type='recording' THEN 1 ELSE 0 END, starts_at, id DESC`).all().map((i) => schoolOut(i, user)));
route('POST', '/api/school/:id/signup', USER, ({ user, params }) => tx(() => {
  const it = db.prepare('SELECT * FROM school_items WHERE id=? AND active=1').get(Number(params.id));
  if (!it) throw new HttpError(404, 'Събитието не е намерено');
  if (it.type === 'recording') throw bad('За записите не е нужно записване');
  if (it.club_only && !isMember(user)) throw bad('Събитието е само за членове на клуба');
  const o = schoolOut(it, user);
  if (o.signed) return o;
  if (o.left === 0) throw bad('Няма свободни места');
  db.prepare('INSERT INTO school_signups(item_id,user_id,created_at) VALUES(?,?,?)').run(it.id, user.id, now());
  award(user.id, 20, `Записване: ${it.title}`, `school:${it.id}`);
  notify(user.id, `Записахте се: ${it.title}`, it.starts_at ? `Очакваме ви на ${it.starts_at}${it.location ? ', ' + it.location : ''}.` : '', '#/school');
  return schoolOut(it, user);
}));
route('DELETE', '/api/school/:id/signup', USER, ({ user, params }) => {
  db.prepare('DELETE FROM school_signups WHERE item_id=? AND user_id=?').run(Number(params.id), user.id);
  db.prepare('DELETE FROM points_log WHERE user_id=? AND key=?').run(user.id, `school:${Number(params.id)}`);
  return { ok: true };
});

// --- консултации ---
route('GET', '/api/consult/slots', PUB, () =>
  db.prepare(`SELECT id,starts_at,duration,mode FROM consult_slots WHERE status='free' AND starts_at>? ORDER BY starts_at`).all(now().slice(0, 16)));
route('GET', '/api/consult/mine', USER, ({ user }) =>
  db.prepare(`SELECT * FROM consult_slots WHERE user_id=? ORDER BY starts_at DESC`).all(user.id));
route('POST', '/api/consult/slots/:id/book', USER, ({ user, params, body }) => tx(() => {
  const sl = db.prepare('SELECT * FROM consult_slots WHERE id=?').get(Number(params.id));
  if (!sl || sl.status !== 'free' || sl.starts_at <= now().slice(0, 16)) throw bad('Часът вече е зает. Изберете друг.');
  const open = db.prepare(`SELECT COUNT(*) n FROM consult_slots WHERE user_id=? AND status='booked' AND starts_at>?`).get(user.id, now().slice(0, 16)).n;
  if (open >= 3) throw bad('Имате вече 3 предстоящи консултации');
  db.prepare(`UPDATE consult_slots SET status='booked', user_id=?, topic=?, booked_at=? WHERE id=?`).run(user.id, str(body.topic, 500), now(), sl.id);
  award(user.id, 15, 'Записана консултация', `consult:${sl.id}`);
  notify(user.id, 'Консултацията е запазена 🤝', `${sl.starts_at} (${sl.duration} мин, ${sl.mode === 'online' ? 'онлайн' : 'на място'}).`, '#/consult');
  return db.prepare('SELECT * FROM consult_slots WHERE id=?').get(sl.id);
}));
route('POST', '/api/consult/slots/:id/cancel', USER, ({ user, params }) => {
  const sl = db.prepare(`SELECT * FROM consult_slots WHERE id=? AND user_id=? AND status='booked'`).get(Number(params.id), user.id);
  if (!sl) throw new HttpError(404, 'Не е намерена');
  db.prepare(`UPDATE consult_slots SET status='free', user_id=NULL, topic='', booked_at=NULL WHERE id=?`).run(sl.id);
  db.prepare('DELETE FROM points_log WHERE user_id=? AND key=?').run(user.id, `consult:${sl.id}`);
  return { ok: true };
});

// =================== АДМИНИСТРАЦИЯ ===================
function memberRow(u, s) {
  const ci = clubInfo(u, s);
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, blocked: u.blocked, created_at: u.created_at, admin_note: u.admin_note, club: ci };
}
function alerts() {
  const s = getSettings();
  const users = db.prepare(`SELECT * FROM users WHERE club_status IN ('active','pending')`).all();
  const expired = [], expiring = [], pending = [];
  for (const u of users) {
    const r = memberRow(u, s);
    if (u.club_status === 'pending' || (u.club_requested_at && u.club_status === 'active' && (r.club.expired || r.club.expiringSoon))) pending.push(r);
    if (r.club.expired) expired.push(r); else if (r.club.expiringSoon) expiring.push(r);
  }
  expired.sort((a, b) => (a.club.until < b.club.until ? -1 : 1));
  expiring.sort((a, b) => a.club.daysLeft - b.club.daysLeft);
  return { expired, expiring, pending };
}

route('GET', '/api/admin/dashboard', ADMIN, () => {
  const t = today();
  const st = {};
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all()) st[r.status] = r.n;
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    orders: st,
    unpaid: g(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE paid=0 AND status<>'cancelled'`),
    unpaidDelivered: g(`SELECT COUNT(*) n FROM orders WHERE paid=0 AND status='delivered'`).n,
    paidMonth: money(g(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE paid=1 AND substr(paid_at,1,7)=?`, t.slice(0, 7)).s),
    clubMonth: money(g(`SELECT COALESCE(SUM(amount),0) s FROM club_payments WHERE substr(created_at,1,7)=?`, t.slice(0, 7)).s),
    users: g(`SELECT COUNT(*) n FROM users WHERE role<>'admin'`).n,
    members: db.prepare(`SELECT * FROM users WHERE club_status='active'`).all().filter((u) => clubInfo(u).member && !clubInfo(u).expired).length,
    feedbackNew: g('SELECT COUNT(*) n FROM feedback WHERE handled=0').n,
    todayPickups: db.prepare(`SELECT * FROM orders WHERE pickup_date=? AND status IN ('ordered','arrived') ORDER BY pickup_time`).all(t).map((o) => orderOut(o, true)),
    consults: db.prepare(`SELECT c.*, u.name, u.email, u.phone FROM consult_slots c LEFT JOIN users u ON u.id=c.user_id WHERE c.status='booked' AND c.starts_at>=? ORDER BY c.starts_at LIMIT 10`).all(t),
    school: db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM school_signups WHERE item_id=s.id) cnt FROM school_items s WHERE active=1 AND type<>'recording' AND starts_at>=? ORDER BY starts_at LIMIT 5`).all(t),
    ...alerts(),
  };
});
route('GET', '/api/admin/alerts', ADMIN, () => {
  const a = alerts();
  return {
    expired: a.expired.length, expiring: a.expiring.length, pending: a.pending.length,
    newOrders: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='ordered'`).get().n,
    lastOrderId: db.prepare('SELECT COALESCE(MAX(id),0) m FROM orders').get().m,
    feedbackNew: db.prepare('SELECT COUNT(*) n FROM feedback WHERE handled=0').get().n,
  };
});

// --- поръчки (админ) ---
route('GET', '/api/admin/orders', ADMIN, ({ query }) => {
  const w = []; const a = [];
  if (query.status) { w.push('o.status=?'); a.push(query.status); }
  if (query.paid === '1' || query.paid === '0') { w.push('o.paid=?'); a.push(Number(query.paid)); }
  if (query.date) { w.push('o.pickup_date=?'); a.push(query.date); }
  if (query.q) { w.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR o.id=?)'); const q = `%${query.q}%`; a.push(q, q, q, Number(query.q) || -1); }
  const sql = `SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 500`;
  return db.prepare(sql).all(...a).map((o) => orderOut(o, true));
});
route('POST', '/api/admin/orders/bulk', ADMIN, ({ body }) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw bad('Не са избрани поръчки');
  const status = body.status ? String(body.status) : null;
  if (status && !STATUS[status]) throw bad('Невалиден статус');
  const paid = body.paid === undefined || body.paid === null ? null : (body.paid ? 1 : 0);
  if (!status && paid === null) throw bad('Изберете действие');
  const ts = now();
  let changed = 0;
  tx(() => {
    for (const id of ids) {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!o) continue;
      const parts = [];
      if (status && o.status !== status) {
        db.prepare(`UPDATE orders SET status=?, updated_at=?,
          arrived_at=CASE WHEN ?='arrived' THEN ? ELSE arrived_at END,
          delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END WHERE id=?`).run(status, ts, status, ts, status, ts, id);
        parts.push(STATUS[status]);
        if (status === 'arrived') notify(o.user_id, `Поръчка №${id} пристигна 📦`, `Можете да я вземете на ${o.pickup_date} ${o.pickup_time}${o.pickup_location ? ', ' + o.pickup_location : ''}.`, '#/orders');
        if (status === 'delivered') { notify(o.user_id, `Поръчка №${id} е предадена 💚`, 'Благодарим ви! Изгледайте видеата за продуктите, за да ги използвате най-ефективно.', '#/orders'); award(o.user_id, 10, `Взета поръчка №${id}`, `picked:${id}`); }
        if (status === 'cancelled') { notify(o.user_id, `Поръчка №${id} е отказана`, 'Свържете се с нас при въпроси.', '#/orders'); db.prepare('DELETE FROM points_log WHERE user_id=? AND key IN (?,?)').run(o.user_id, `order:${id}`, `picked:${id}`); }
      }
      if (paid !== null && o.paid !== paid) {
        db.prepare('UPDATE orders SET paid=?, paid_at=?, updated_at=? WHERE id=?').run(paid, paid ? ts : null, ts, id);
        parts.push(paid ? 'Платена' : 'Неплатена');
      }
      if (parts.length) { db.prepare('INSERT INTO order_log(order_id,ts,change) VALUES(?,?,?)').run(id, ts, parts.join(', ')); changed++; }
    }
  });
  return { changed };
});
route('PUT', '/api/admin/orders/:id', ADMIN, ({ params, body }) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(params.id));
  if (!o) throw new HttpError(404, 'Не е намерена');
  if (body.pickup_slot_id && Number(body.pickup_slot_id) !== o.pickup_slot_id) {
    const sl = db.prepare('SELECT * FROM pickup_slots WHERE id=?').get(Number(body.pickup_slot_id));
    if (!sl) throw bad('Няма такава дата');
    const time = [sl.time_from, sl.time_to].filter(Boolean).join('–');
    db.prepare('UPDATE orders SET pickup_slot_id=?, pickup_date=?, pickup_time=?, pickup_location=? WHERE id=?').run(sl.id, sl.date, time, sl.location || getSettings().pickup_location, o.id);
    db.prepare('INSERT INTO order_log(order_id,ts,change) VALUES(?,?,?)').run(o.id, now(), `Нова дата за вземане: ${sl.date} ${time}`);
    notify(o.user_id, `Нова дата за поръчка №${o.id}`, `${sl.date} ${time}`, '#/orders');
  }
  if (body.admin_note !== undefined) db.prepare('UPDATE orders SET admin_note=? WHERE id=?').run(str(body.admin_note, 1000), o.id);
  db.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(now(), o.id);
  return orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id), true);
});

// --- дати за вземане (админ) ---
route('GET', '/api/admin/pickup-slots', ADMIN, ({ query }) =>
  db.prepare(`SELECT * FROM pickup_slots WHERE date>=? ORDER BY date, time_from`).all(query.all ? '0000' : addDays(today(), -14)).map(slotOut));
function slotFields(b) {
  return {
    date: dateArg(b.date, 'дата'), time_from: timeArg(b.time_from, 'от', true), time_to: timeArg(b.time_to, 'до', true),
    location: str(b.location, 200), capacity: int(b.capacity || 0, 'капацитет', { min: 0, max: 10000 }), note: str(b.note, 300), active: b.active === false || b.active === 0 ? 0 : 1,
  };
}
route('POST', '/api/admin/pickup-slots', ADMIN, ({ body }) => {
  const f = slotFields(body);
  const id = db.prepare('INSERT INTO pickup_slots(date,time_from,time_to,location,capacity,note,active) VALUES(?,?,?,?,?,?,?)').run(f.date, f.time_from, f.time_to, f.location, f.capacity, f.note, f.active).lastInsertRowid;
  return slotOut(db.prepare('SELECT * FROM pickup_slots WHERE id=?').get(id));
});
route('POST', '/api/admin/pickup-slots/generate', ADMIN, ({ body }) => {
  const from = dateArg(body.from, 'от дата'); const to = dateArg(body.to, 'до дата');
  const wd = new Set((body.weekdays || []).map(Number));
  if (!wd.size) throw bad('Изберете дни от седмицата');
  if (daysBetween(from, to) < 0 || daysBetween(from, to) > 366) throw bad('Невалиден период');
  const f = slotFields({ ...body, date: from });
  let n = 0;
  const exists = db.prepare('SELECT 1 FROM pickup_slots WHERE date=? AND time_from=?');
  const ins = db.prepare('INSERT INTO pickup_slots(date,time_from,time_to,location,capacity,note,active) VALUES(?,?,?,?,?,?,1)');
  tx(() => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const [y, m, dd] = d.split('-').map(Number);
      if (!wd.has(new Date(y, m - 1, dd).getDay())) continue;
      if (exists.get(d, f.time_from)) continue;
      ins.run(d, f.time_from, f.time_to, f.location, f.capacity, f.note); n++;
    }
  });
  return { created: n };
});
route('PUT', '/api/admin/pickup-slots/:id', ADMIN, ({ params, body }) => {
  const f = slotFields(body);
  db.prepare('UPDATE pickup_slots SET date=?,time_from=?,time_to=?,location=?,capacity=?,note=?,active=? WHERE id=?').run(f.date, f.time_from, f.time_to, f.location, f.capacity, f.note, f.active, Number(params.id));
  return slotOut(db.prepare('SELECT * FROM pickup_slots WHERE id=?').get(Number(params.id)));
});
route('DELETE', '/api/admin/pickup-slots/:id', ADMIN, ({ params }) => {
  const id = Number(params.id);
  if (db.prepare('SELECT 1 FROM orders WHERE pickup_slot_id=?').get(id)) {
    db.prepare('UPDATE pickup_slots SET active=0 WHERE id=?').run(id);
    return { deactivated: true };
  }
  db.prepare('DELETE FROM pickup_slots WHERE id=?').run(id);
  return { deleted: true };
});

// --- продукти (админ) ---
function productFields(b) {
  const name = str(b.name, 120); if (!name) throw bad('Въведете име на продукта');
  return {
    name, category: str(b.category, 60), short: str(b.short, 300), description: str(b.description, 5000), usage: str(b.usage, 5000),
    technique: str(b.technique, 5000), tips: str(b.tips, 3000), price: num(b.price || 0, 'цена'), image: str(b.image, 500) || '🧴',
    video_url: str(b.video_url, 300), eco_money: num(b.eco_money || 0, 'спестени €'), eco_plastic: int(b.eco_plastic || 0, 'пластмаса'),
    eco_chem: int(b.eco_chem || 0, 'химикали'), active: b.active === false || b.active === 0 ? 0 : 1, sort: int(b.sort || 0, 'ред', { min: -1e6 }),
  };
}
const PF = ['name', 'category', 'short', 'description', 'usage', 'technique', 'tips', 'price', 'image', 'video_url', 'eco_money', 'eco_plastic', 'eco_chem', 'active', 'sort'];
route('GET', '/api/admin/products', ADMIN, () => db.prepare('SELECT * FROM products ORDER BY active DESC, sort, name').all().map(productOut));
route('POST', '/api/admin/products', ADMIN, ({ body }) => {
  const f = productFields(body);
  const id = db.prepare(`INSERT INTO products(${PF.join(',')},created_at) VALUES(${PF.map(() => '?').join(',')},?)`).run(...PF.map((k) => f[k]), now()).lastInsertRowid;
  return productOut(db.prepare('SELECT * FROM products WHERE id=?').get(id));
});
route('PUT', '/api/admin/products/:id', ADMIN, ({ params, body }) => {
  const f = productFields(body);
  db.prepare(`UPDATE products SET ${PF.map((k) => k + '=?').join(',')} WHERE id=?`).run(...PF.map((k) => f[k]), Number(params.id));
  return productOut(db.prepare('SELECT * FROM products WHERE id=?').get(Number(params.id)));
});
route('DELETE', '/api/admin/products/:id', ADMIN, ({ params }) => {
  const id = Number(params.id);
  if (db.prepare('SELECT 1 FROM order_items WHERE product_id=?').get(id)) { db.prepare('UPDATE products SET active=0 WHERE id=?').run(id); return { deactivated: true }; }
  db.prepare('DELETE FROM products WHERE id=?').run(id); return { deleted: true };
});

// --- членове / акаунти / клуб (админ) ---
route('GET', '/api/admin/users', ADMIN, ({ query }) => {
  const s = getSettings();
  let rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all().map((u) => memberRow(u, s));
  const q = String(query.q || '').toLowerCase();
  if (q) rows = rows.filter((r) => [r.name, r.email, r.phone].some((v) => String(v).toLowerCase().includes(q)));
  const f = query.filter;
  if (f === 'members') rows = rows.filter((r) => r.club.status === 'active' && !r.club.expired);
  if (f === 'expired') rows = rows.filter((r) => r.club.expired);
  if (f === 'expiring') rows = rows.filter((r) => r.club.expiringSoon);
  if (f === 'pending') rows = rows.filter((r) => r.club.status === 'pending' || (r.club.requestedAt && (r.club.expired || r.club.expiringSoon)));
  if (f === 'restricted') rows = rows.filter((r) => r.club.status === 'restricted');
  for (const r of rows) {
    r.points = userPoints(r.id);
    r.orders = db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id=? AND status<>'cancelled'`).get(r.id).n;
  }
  return rows;
});
route('GET', '/api/admin/users/:id', ADMIN, ({ params }) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'Не е намерен');
  return {
    ...memberRow(u), points: userPoints(u.id), eco: ecoStats(u.id),
    payments: db.prepare('SELECT * FROM club_payments WHERE user_id=? ORDER BY id DESC').all(u.id),
    orders: db.prepare('SELECT id,status,paid,total,created_at,pickup_date FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id),
  };
});
route('PUT', '/api/admin/users/:id', ADMIN, ({ params, body, user }) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'Не е намерен');
  const role = body.role === 'admin' ? 'admin' : 'customer';
  if (u.id === user.id && role !== 'admin') throw bad('Не можете да премахнете собствените си права');
  const blocked = body.blocked ? 1 : 0;
  if (u.id === user.id && blocked) throw bad('Не можете да спрете собствения си акаунт');
  db.prepare('UPDATE users SET name=?, phone=?, role=?, blocked=?, admin_note=? WHERE id=?')
    .run(str(body.name, 80) || u.name, str(body.phone, 30), role, blocked, str(body.admin_note, 1000), u.id);
  if (blocked) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  if (body.password) {
    if (String(body.password).length < 6) throw bad('Паролата трябва да е поне 6 символа');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password), u.id);
  }
  return memberRow(db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
});
route('POST', '/api/admin/users/:id/club', ADMIN, ({ params, body }) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'Не е намерен');
  const s = getSettings(); const t = today();
  const a = body.action;
  return tx(() => {
    if (a === 'extend') {
      const months = int(body.months || 1, 'месеци', { min: 1, max: 24 });
      const amount = body.amount === undefined || body.amount === '' ? months * (Number(s.club_price) || 10) : num(body.amount, 'сума');
      const base = u.club_status === 'active' && u.club_until && u.club_until >= t ? u.club_until : t;
      const until = addMonths(base, months);
      db.prepare(`UPDATE users SET club_status='active', club_since=COALESCE(club_since,?), club_until=?, club_requested_at=NULL WHERE id=?`).run(t, until, u.id);
      db.prepare('INSERT INTO club_payments(user_id,amount,months,from_date,to_date,note,created_at) VALUES(?,?,?,?,?,?,?)').run(u.id, amount, months, base, until, str(body.note, 300), now());
      award(u.id, 50, 'Абонамент за клуба', `club:${until}`);
      notify(u.id, 'Абонаментът ви за клуба е активен ⭐', `Валиден до ${until}. Получавате ${s.club_discount_pct}% отстъпка за всички продукти и достъп до всички записи.`, '#/club');
    } else if (a === 'set_until') {
      const until = dateArg(body.until, 'валиден до');
      db.prepare(`UPDATE users SET club_status='active', club_since=COALESCE(club_since,?), club_until=? WHERE id=?`).run(t, until, u.id);
    } else if (a === 'restrict') {
      db.prepare(`UPDATE users SET club_status='restricted' WHERE id=?`).run(u.id);
      notify(u.id, 'Достъпът ви до клуба е спрян', 'Подновете абонамента си, за да го възстановите.', '#/club');
    } else if (a === 'restore') {
      db.prepare(`UPDATE users SET club_status=CASE WHEN club_until IS NOT NULL THEN 'active' ELSE 'none' END WHERE id=?`).run(u.id);
    } else if (a === 'cancel') {
      db.prepare(`UPDATE users SET club_status='none', club_requested_at=NULL WHERE id=?`).run(u.id);
    } else if (a === 'remind') {
      const ci = clubInfo(u, s);
      notify(u.id, 'Напомняне: подновете абонамента си за клуба', ci.until ? `Абонаментът ${ci.expired ? 'изтече' : 'изтича'} на ${ci.until}. Цена: ${ci.price}€ на месец.` : `Цена: ${ci.price}€ на месец.`, '#/club', `remind:${t}`);
    } else throw bad('Невалидно действие');
    return memberRow(db.prepare('SELECT * FROM users WHERE id=?').get(u.id), s);
  });
});
route('POST', '/api/admin/club/remind-expired', ADMIN, () => {
  const a = alerts(); let n = 0; const t = today();
  for (const r of [...a.expired, ...a.expiring]) {
    notify(r.id, 'Напомняне: подновете абонамента си за клуба', `Абонаментът ${r.club.expired ? 'изтече' : 'изтича'} на ${r.club.until}. Цена: ${r.club.price}€ на месец.`, '#/club', `remind:${t}`);
    n++;
  }
  return { sent: n };
});
route('POST', '/api/admin/club/restrict-expired', ADMIN, () => {
  const a = alerts();
  tx(() => { for (const r of a.expired) db.prepare(`UPDATE users SET club_status='restricted' WHERE id=?`).run(r.id); });
  return { restricted: a.expired.length };
});

// --- училище (админ) ---
const SF = ['type', 'title', 'description', 'youtube_url', 'link', 'starts_at', 'location', 'seats', 'price', 'club_only', 'product_id', 'active'];
function schoolFields(b) {
  const type = ['workshop', 'presentation', 'live', 'recording'].includes(b.type) ? b.type : null;
  if (!type) throw bad('Изберете вид');
  const title = str(b.title, 200); if (!title) throw bad('Въведете заглавие');
  const starts = str(b.starts_at, 16).replace('T', ' ');
  if (starts && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(starts)) throw bad('Невалидна дата и час');
  return {
    type, title, description: str(b.description, 5000), youtube_url: str(b.youtube_url, 300), link: str(b.link, 500), starts_at: starts,
    location: str(b.location, 200), seats: int(b.seats || 0, 'места', { min: 0, max: 100000 }), price: num(b.price || 0, 'цена'),
    club_only: b.club_only ? 1 : 0, product_id: b.product_id ? Number(b.product_id) : null, active: b.active === false || b.active === 0 ? 0 : 1,
  };
}
route('GET', '/api/admin/school', ADMIN, () => db.prepare('SELECT * FROM school_items ORDER BY starts_at DESC, id DESC').all().map((i) => ({
  ...i, signups: db.prepare('SELECT s.created_at, s.attended, u.id user_id, u.name, u.email, u.phone FROM school_signups s JOIN users u ON u.id=s.user_id WHERE s.item_id=? ORDER BY s.created_at').all(i.id),
})));
route('POST', '/api/admin/school', ADMIN, ({ body }) => {
  const f = schoolFields(body);
  const id = db.prepare(`INSERT INTO school_items(${SF.join(',')},created_at) VALUES(${SF.map(() => '?').join(',')},?)`).run(...SF.map((k) => f[k]), now()).lastInsertRowid;
  if (body.announce) {
    const audience = f.club_only ? 'club' : 'all';
    db.prepare('INSERT INTO notifications(user_id,audience,title,body,link,created_at) VALUES(NULL,?,?,?,?,?)').run(audience, `Ново в училището: ${f.title}`, f.starts_at ? `На ${f.starts_at}` : 'Вижте го сега!', '#/school', now());
  }
  return db.prepare('SELECT * FROM school_items WHERE id=?').get(id);
});
route('PUT', '/api/admin/school/:id', ADMIN, ({ params, body }) => {
  const f = schoolFields(body);
  db.prepare(`UPDATE school_items SET ${SF.map((k) => k + '=?').join(',')} WHERE id=?`).run(...SF.map((k) => f[k]), Number(params.id));
  return db.prepare('SELECT * FROM school_items WHERE id=?').get(Number(params.id));
});
route('DELETE', '/api/admin/school/:id', ADMIN, ({ params }) => { db.prepare('DELETE FROM school_items WHERE id=?').run(Number(params.id)); return { ok: true }; });
route('POST', '/api/admin/school/:id/attended', ADMIN, ({ params, body }) => {
  const id = Number(params.id); const uid = Number(body.user_id);
  db.prepare('UPDATE school_signups SET attended=? WHERE item_id=? AND user_id=?').run(body.attended ? 1 : 0, id, uid);
  if (body.attended) award(uid, 30, 'Присъствие на събитие', `attend:${id}`);
  return { ok: true };
});

// --- консултации (админ) ---
route('GET', '/api/admin/consult', ADMIN, ({ query }) =>
  db.prepare(`SELECT c.*, u.name, u.email, u.phone FROM consult_slots c LEFT JOIN users u ON u.id=c.user_id WHERE c.starts_at>=? ORDER BY c.starts_at`).all(query.past ? '0000' : today()));
route('POST', '/api/admin/consult/generate', ADMIN, ({ body }) => {
  const from = dateArg(body.from, 'от дата'); const to = dateArg(body.to || body.from, 'до дата');
  const wd = new Set((body.weekdays || [0, 1, 2, 3, 4, 5, 6]).map(Number));
  const times = String(body.times || '').split(/[\s,;]+/).filter(Boolean);
  if (!times.length || times.some((x) => !isTime(x))) throw bad('Въведете часове във формат ЧЧ:ММ, разделени със запетая');
  if (daysBetween(from, to) < 0 || daysBetween(from, to) > 366) throw bad('Невалиден период');
  const duration = int(body.duration || 30, 'продължителност', { min: 5, max: 480 });
  const mode = body.mode === 'onsite' ? 'onsite' : 'online';
  let n = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO consult_slots(starts_at,duration,mode) VALUES(?,?,?)');
  tx(() => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const [y, m, dd] = d.split('-').map(Number);
      if (!wd.has(new Date(y, m - 1, dd).getDay())) continue;
      for (const t of times) n += ins.run(`${d} ${t}`, duration, mode).changes;
    }
  });
  return { created: n };
});
route('PUT', '/api/admin/consult/:id', ADMIN, ({ params, body }) => {
  const sl = db.prepare('SELECT * FROM consult_slots WHERE id=?').get(Number(params.id));
  if (!sl) throw new HttpError(404, 'Не е намерен');
  const status = ['free', 'booked', 'done', 'cancelled'].includes(body.status) ? body.status : sl.status;
  if (status === 'cancelled' && sl.user_id && sl.status === 'booked') notify(sl.user_id, 'Консултацията ви е отменена', `${sl.starts_at}. ${str(body.admin_note, 300) || 'Моля, изберете друг час.'}`, '#/consult');
  if (status === 'done' && sl.user_id) award(sl.user_id, 20, 'Проведена консултация', `consultdone:${sl.id}`);
  const free = status === 'free';
  db.prepare('UPDATE consult_slots SET status=?, admin_note=?, user_id=?, topic=? WHERE id=?')
    .run(status, str(body.admin_note ?? sl.admin_note, 1000), free ? null : sl.user_id, free ? '' : sl.topic, sl.id);
  return db.prepare('SELECT * FROM consult_slots WHERE id=?').get(sl.id);
});
route('DELETE', '/api/admin/consult/:id', ADMIN, ({ params }) => {
  const sl = db.prepare('SELECT * FROM consult_slots WHERE id=?').get(Number(params.id));
  if (sl && sl.status === 'booked') throw bad('Часът е запазен – първо го отменете');
  db.prepare('DELETE FROM consult_slots WHERE id=?').run(Number(params.id));
  return { ok: true };
});

// --- известия (админ) ---
route('POST', '/api/admin/notify', ADMIN, ({ body }) => {
  const title = str(body.title, 150); if (!title) throw bad('Въведете заглавие');
  const audience = body.audience === 'club' ? 'club' : 'all';
  db.prepare('INSERT INTO notifications(user_id,audience,title,body,link,created_at) VALUES(NULL,?,?,?,?,?)').run(audience, title, str(body.body, 1000), str(body.link, 200), now());
  return { ok: true };
});
route('GET', '/api/admin/notify', ADMIN, () => db.prepare('SELECT * FROM notifications WHERE user_id IS NULL ORDER BY id DESC LIMIT 50').all());

// --- обратна връзка (админ) ---
route('GET', '/api/admin/feedback', ADMIN, () => db.prepare('SELECT * FROM feedback ORDER BY handled, id DESC LIMIT 300').all());
route('PUT', '/api/admin/feedback/:id', ADMIN, ({ params, body }) => { db.prepare('UPDATE feedback SET handled=? WHERE id=?').run(body.handled ? 1 : 0, Number(params.id)); return { ok: true }; });

// --- настройки ---
route('GET', '/api/admin/settings', ADMIN, () => getSettings());
route('PUT', '/api/admin/settings', ADMIN, ({ body }) => {
  const allowed = ['shop_name', 'owner_name', 'tagline', 'club_price', 'club_discount_pct', 'club_auto_expire', 'expiry_warn_days', 'pickup_location', 'contact_phone', 'youtube_channel'];
  if (body.club_price !== undefined) num(body.club_price, 'цена на клуба');
  if (body.club_discount_pct !== undefined) num(body.club_discount_pct, 'отстъпка', { max: 90 });
  if (body.expiry_warn_days !== undefined) int(body.expiry_warn_days, 'дни предупреждение', { max: 60 });
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const k of allowed) if (body[k] !== undefined) st.run(k, str(body[k], 500)); });
  return getSettings();
});

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не е намерено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Твърде голяма заявка')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Невалиден JSON')); }
    });
    req.on('error', reject);
  });
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Няма такъв адрес');
    // защита от CSRF: заявките, които променят данни, трябва да са JSON (кръстосан сайт не може да ги изпрати без разрешение)
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Очаква се JSON');
    const m = url.pathname.match(r.re);
    const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const user = loadUser(req);
    if (r.auth >= USER && !user) throw new HttpError(401, 'Влезте в акаунта си');
    if (r.auth === ADMIN && user.role !== 'admin') throw new HttpError(403, 'Нямате достъп');
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const out = await r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, user });
    send(res, 200, out ?? { ok: true });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Вътрешна грешка' });
  }
});

// Администратор от променливи на средата (по желание)
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) db.prepare(`UPDATE users SET role='admin', blocked=0 WHERE id=?`).run(u.id);
  else db.prepare(`INSERT INTO users(email,name,password_hash,role,created_at) VALUES(?,?,?,'admin',?)`).run(email, 'Администратор', hashPassword(process.env.ADMIN_PASSWORD), now());
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()), 3600e3).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`🧴 ${getSettings().shop_name}: http://localhost:${PORT}  (админ панел: /admin)`));
}
module.exports = { server, hashPassword, addMonths, today };
