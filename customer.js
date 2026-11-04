'use strict';
/*
 * Клиентско приложение (телефонът на посетителя).
 *
 * Работи на ОТДЕЛЕН порт (PUBLIC_PORT, по подразбиране 3080). Само този порт се пуска
 * към интернет (напр. с Tailscale Funnel или Cloudflare Tunnel), за да може клиентът да
 * ползва собствения си мобилен интернет. Екраните на персонала (игри, каса, вход,
 * администрация) НЕ са достъпни през този порт.
 *
 * Достъп до карта:
 *  - клиентът сканира общия QR код от плаката -> отваря се /app;
 *  - сканира баркода на картата си с камерата на телефона (или въвежда номера);
 *  - ако към картата има телефон – въвежда последните 4 цифри от него;
 *    ако няма – може да попълни данните си и картата се защитава с неговия телефон;
 *  - получава ключ за устройството (пази се в телефона), с който вижда картата си.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_DAYS = 60;
const STATIC = {
  '/': 'customer.html',
  '/app': 'customer.html',
  '/customer.html': 'customer.html',
  '/style.css': 'style.css',
  '/camera.js': 'camera.js',
  '/vendor/zxing.min.js': 'vendor/zxing.min.js',
  '/vendor/qrcode.js': 'vendor/qrcode.js',
  '/code128.js': 'code128.js',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/sw.js': 'sw.js',
  '/icons/icon-192.png': 'icons/icon-192.png',
  '/icons/icon-512.png': 'icons/icon-512.png',
  '/icons/apple-touch-icon.png': 'icons/apple-touch-icon.png',
  '/theme/star.css': 'theme/star.css',
  '/theme/header.jpg': 'theme/header.jpg',
  '/fonts/fonts.css': 'fonts/fonts.css',
};
for (const f of ['MarckScript-400-cyrillic', 'MarckScript-400-latin', 'PoiretOne-400-cyrillic', 'PoiretOne-400-latin', 'Lobster-400-cyrillic', 'Lobster-400-latin']) {
  STATIC[`/fonts/${f}.woff2`] = `fonts/${f}.woff2`;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self)',
};

const digits = (s) => String(s || '').replace(/\D/g, '');

// „12.12 17:00 | 🎭 Театрална постановка“ -> { date, time, when, title }
function parseProgram(text) {
  const year = new Date().getFullYear();
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf('|');
    let when = i >= 0 ? line.slice(0, i).trim() : '';
    const title = (i >= 0 ? line.slice(i + 1) : line).trim();
    let date = null;
    const m = when.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?\s*(.*)$/);
    if (m) {
      date = `${m[3] || year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      when = m[4] || 'цял ден';
    }
    const t = when.match(/^(\d{1,2}):(\d{2})/);
    return { date, time: t ? `${t[1].padStart(2, '0')}:${t[2]}` : null, when, title };
  }).slice(0, 60);
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ограничаване на опитите (в паметта)
const buckets = new Map();
function allow(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  return b.n <= max;
}

function createPublicHandler(d) {
  const { db, HttpError, normCode, resolveCode, str, int, getSettings, cardSummary, today, publicDir, readBody, stays } = d;

  const clientIp = (req) => {
    const remote = req.socket.remoteAddress || '';
    // зад тунел (Tailscale/Cloudflare) заявките идват от localhost – истинският адрес е в заглавката
    if (/^(::1|127\.|::ffff:127\.)/.test(remote)) {
      const f = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (f) return f;
    }
    return remote;
  };

  function sessionCard(req) {
    const token = String(req.headers['x-customer-token'] || '');
    if (!token || token.length > 100) throw new HttpError(401, 'Свържете картата си отново');
    const s = db.prepare('SELECT * FROM customer_sessions WHERE token_hash=?').get(sha256(token));
    if (!s || s.last_seen < Date.now() - SESSION_DAYS * 864e5) throw new HttpError(401, 'Свържете картата си отново');
    db.prepare('UPDATE customer_sessions SET last_seen=? WHERE token_hash=?').run(Date.now(), s.token_hash);
    const c = cardSummary(s.barcode);
    if (!c) throw new HttpError(401, 'Картата не е намерена');
    return c;
  }

  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const maskPhone = (p) => { const x = digits(p); return x.length >= 4 ? '••• ' + x.slice(-4) : ''; };

  function cardView(c) {
    const T = today();
    const plays = db.prepare('SELECT ts, game_name, points FROM plays WHERE barcode=? AND voided=0 ORDER BY ts DESC, id DESC LIMIT 50').all(c.barcode);
    const purchases = db.prepare('SELECT id, ts, total FROM purchases WHERE barcode=? AND voided=0 ORDER BY ts DESC, id DESC LIMIT 30').all(c.barcode);
    const items = db.prepare('SELECT name, qty, points FROM purchase_items WHERE purchase_id=?');
    for (const p of purchases) { p.items = items.all(p.id); delete p.id; }
    const todayStay = stays(T + ' 00:00:00', T + ' 23:59:59', c.barcode)[0] || null;
    return {
      barcode: c.barcode,
      kind: c.kind || 'card',
      linked: c.linked || [],
      name: c.name,
      first_name: firstName(c.name),
      phone_masked: maskPhone(c.phone),
      has_phone: digits(c.phone).length >= 4,
      age: c.age,
      balance: c.balance,
      games: c.games,
      visits: c.visits,
      plays_total: c.plays,
      entered_today: c.entered_today,
      replaced_by: c.replaced_by || null,
      blocked: !!c.blocked,
      today: {
        arrived: todayStay ? todayStay.arrived : null,
        minutes: todayStay ? todayStay.minutes : null,
        plays: plays.filter((p) => p.ts.startsWith(T)),
        purchases: purchases.filter((p) => p.ts.startsWith(T)),
      },
      plays,
      purchases,
    };
  }

  const routes = [];
  const route = (method, p, fn) => routes.push({ method, p, fn });

  route('GET', '/api/ping', () => ({ ok: true, public: true, https_port: null }));

  route('GET', '/api/public/info', () => {
    const s = getSettings();
    return {
      park_name: s.park_name,
      currency: s.currency,
      plays_per_entry: Number(s.plays_per_entry) || 0,
      virtual_signup: process.env.VIRTUAL_SIGNUP === '1',
      program: parseProgram(s.program),
      games: db.prepare('SELECT name, points FROM games WHERE active=1 ORDER BY name').all(),
      products: db.prepare('SELECT name, category, points FROM products WHERE active=1 ORDER BY category, sort, name').all(),
    };
  });

  // Свързване на карта към телефона
  route('POST', '/api/public/login', ({ body, ip, req }) => {
    if (!allow('ip:' + ip, 30, 10 * 60e3)) throw new HttpError(429, 'Твърде много опити. Опитайте след няколко минути.');
    const code = resolveCode(normCode(body.barcode));
    if (!allow('card:' + code, 8, 10 * 60e3)) throw new HttpError(429, 'Твърде много опити за тази карта. Опитайте след 10 минути или се обърнете към касата.');
    const c = cardSummary(code);
    const fail = () => new HttpError(404, 'Картата не е намерена или данните не съвпадат');
    if (!c) throw fail();
    if (c.replaced_by) throw new HttpError(403, `Тази карта е заменена с ${c.replaced_by}. Сканирайте новата карта.`);
    if (c.blocked) throw new HttpError(403, 'Картата е блокирана. Обърнете се към касата.');
    const ph = digits(c.phone);
    if (ph.length >= 4) {
      const given = digits(body.phone4);
      if (!given) return { need_phone: true };
      if (given.slice(-4) !== ph.slice(-4)) throw fail();
    } else if (!c.visits) {
      // неизползвана карта без данни – не позволяваме „заемане“ на чужди/непродадени карти
      throw new HttpError(403, 'Картата още не е активирана. Платете вход на касата и опитайте отново.');
    }
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO customer_sessions(token_hash,barcode,created_at,last_seen,user_agent) VALUES(?,?,?,?,?)')
      .run(sha256(token), code, Date.now(), Date.now(), str(req.headers['user-agent'], 200));
    return { token, card: cardView(c) };
  });

  // Регистрация в приложението: нов виртуален потребител с виртуална карта (V + 6 цифри)
  route('POST', '/api/public/register', ({ body, ip, req }) => {
    // по подразбиране клиентите получават физическа карта на касата; регистрация само с карта
    // в приложението се включва с VIRTUAL_SIGNUP=1
    if (process.env.VIRTUAL_SIGNUP !== '1') throw new HttpError(403, 'Вземете карта от касата и я сканирайте в приложението');
    if (!allow('reg:' + ip, 5, 60 * 60e3)) throw new HttpError(429, 'Твърде много регистрации от тази мрежа. Опитайте по-късно.');
    const name = str(body.name, 200);
    const phone = str(body.phone, 40);
    if (!name) throw new HttpError(400, 'Въведете име');
    if (digits(phone).length < 6) throw new HttpError(400, 'Въведете валиден телефон – с него ще защитим картата ви');
    const age = body.age === '' || body.age == null ? null : int(body.age, 'възраст', { min: 0, max: 120 });
    if (!body.consent) throw new HttpError(400, 'Нужно е съгласие за обработка на данните');
    let code;
    for (let i = 0; i < 20 && !code; i++) {
      const c = 'V' + crypto.randomInt(100000, 1000000);
      if (!db.prepare('SELECT 1 FROM cards WHERE barcode=?').get(c)) code = c;
    }
    if (!code) throw new HttpError(500, 'Опитайте отново');
    const t = d.now();
    db.prepare("INSERT INTO cards(barcode,kind,name,phone,age,note,created_at,updated_at) VALUES(?, 'virtual', ?, ?, ?, 'Регистрация от приложението', ?, ?)")
      .run(code, name, phone, age, t, t);
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO customer_sessions(token_hash,barcode,created_at,last_seen,user_agent) VALUES(?,?,?,?,?)')
      .run(sha256(token), code, Date.now(), Date.now(), str(req.headers['user-agent'], 200));
    return { token, card: cardView(cardSummary(code)) };
  });

  route('GET', '/api/public/me', ({ req }) => cardView(sessionCard(req)));

  // Данните на играещия се въвеждат от служителя на входа. Клиентът може да ги променя от
  // приложението само ако е включено с CUSTOMER_EDIT=1.
  route('PUT', '/api/public/me', ({ req, body, ip }) => {
    if (process.env.CUSTOMER_EDIT !== '1') throw new HttpError(403, 'Данните се въвеждат от служителя на входа');
    if (!allow('upd:' + ip, 20, 10 * 60e3)) throw new HttpError(429, 'Твърде много промени. Опитайте по-късно.');
    const c = sessionCard(req);
    const name = str(body.name, 200);
    const phone = str(body.phone, 40);
    if (!name) throw new HttpError(400, 'Въведете име');
    if (digits(phone).length < 6) throw new HttpError(400, 'Въведете валиден телефон – с него картата ще бъде защитена');
    const age = body.age === '' || body.age == null ? null : int(body.age, 'възраст', { min: 0, max: 120 });
    db.prepare('UPDATE cards SET name=?, phone=?, age=?, updated_at=? WHERE barcode=?').run(name, phone, age, d.now(), c.barcode);
    return cardView(cardSummary(c.barcode));
  });

  route('POST', '/api/public/logout', ({ req }) => {
    const token = String(req.headers['x-customer-token'] || '');
    if (token) db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(sha256(token));
    return { ok: true };
  });

  return async function publicHandler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }

    if (!pathname.startsWith('/api/')) {
      const f = STATIC[pathname];
      if (!f || req.method !== 'GET') { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Няма такава страница'); return; }
      fs.readFile(path.join(publicDir, f), (err, data) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'no-cache' });
        res.end(data);
      });
      return;
    }

    const send = (status, obj) => {
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      const ip = clientIp(req);
      if (!allow('all:' + ip, 600, 60e3)) throw new HttpError(429, 'Твърде много заявки');
      const r = routes.find((x) => x.method === req.method && x.p === pathname);
      if (!r) throw new HttpError(404, 'Непознат адрес');
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      send(200, await r.fn({ req, body, ip, query: Object.fromEntries(url.searchParams) }));
    } catch (e) {
      if (!(e instanceof HttpError) && !e.status) console.error(e);
      send(e.status || 500, { error: e.status ? e.message : 'Вътрешна грешка' });
    }
  };
}

module.exports = { createPublicHandler };
