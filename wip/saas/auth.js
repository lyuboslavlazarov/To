'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = 'lp_session';

// ---------- пароли (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
// за изравняване на времето при несъществуващ потребител
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

// ---------- сесии ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const nowMs = Date.now();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)')
    .run(sha256(token), userId, nowMs, nowMs + SESSION_DAYS * 864e5, String(userAgent).slice(0, 200));
  return token;
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}
function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}
function purgeExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

const qSession = db.prepare(`
  SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.active,
         t.name AS tenant_name, t.plan, t.trial_ends, t.status AS tenant_status, t.created_at AS tenant_created,
         s.expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id
  WHERE s.token_hash = ?`);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE] || null;
}

function loadAuth(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const row = qSession.get(sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}

function isSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function sessionCookie(req, token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isSecure(req) ? '; Secure' : ''}`;
}
function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
}

// ---------- ограничаване на опитите (в паметта) ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const nowMs = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < nowMs) { b = { n: 0, reset: nowMs + windowMs }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset < nowMs) buckets.delete(k);
  return b.n <= max;
}

const PLATFORM_ADMINS = new Set(String(process.env.PLATFORM_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isPlatformAdmin = (email) => PLATFORM_ADMINS.has(String(email || '').toLowerCase());

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH,
  createSession, destroySession, destroyUserSessions, purgeExpired,
  loadAuth, getSessionToken, sessionCookie, clearCookie,
  rateLimit, isPlatformAdmin,
};
