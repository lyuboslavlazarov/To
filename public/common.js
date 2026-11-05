'use strict';
/* Общи помощни функции за всички екрани */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getPin() { try { return sessionStorage.getItem('admin_pin') || ''; } catch { return ''; } }
function setPin(p) { try { sessionStorage.setItem('admin_pin', p); } catch { /* ignore */ } }

async function api(method, url, body, _retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  const pin = getPin();
  if (pin) headers['x-admin-pin'] = pin;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Няма връзка със сървъра');
  }
  if (res.status === 401 && _retry) {
    const p = prompt('Администраторски ПИН:');
    if (p !== null) { setPin(p); return api(method, url, body, false); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Грешка ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, type = 'info', ms = 2500) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = type; }, ms);
}

let audioCtx;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.4));
  } catch { /* без звук */ }
}

/**
 * Свързва поле за сканиране. Баркод скенерите работят като клавиатура:
 * изписват кода и натискат Enter. Полето автоматично си връща фокуса.
 * Добавя и бутон 📷 за сканиране с камерата (camera.js).
 */
function bindScanner(input, onScan, cameraOptions = {}) {
  const wrap = input.closest('.scan');
  let busy = false;
  const run = async (code) => {
    if (!code || busy) return;
    busy = true;
    try { await onScan(code); } finally { busy = false; }
  };
  input.addEventListener('focus', () => wrap && wrap.classList.add('focused'));
  input.addEventListener('blur', () => wrap && wrap.classList.remove('focused'));
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    input.value = '';
    await run(code);
  });
  // Бутон 📷 – сканиране с камерата на устройството
  if (typeof CameraScanner !== 'undefined' && cameraOptions !== false) CameraScanner.attach(input, run, cameraOptions);

  // Скенер, докато курсорът е в друго поле (напр. „Име“): скенерът „пише“ много по-бързо
  // от човек. Бърза поредица от символи + Enter се приема за сканиране – текстът се
  // маха от полето и картата се обработва нормално.
  const SCAN_GAP_MS = 45;
  let burst = null;
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el === input || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (el.closest('[data-own-scan], .modal-bg')) return; // полета със собствено сканиране (напр. „нова карта“)
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'date'].includes(el.type)) return;
    const t = performance.now();
    if (e.key === 'Enter') {
      const isScan = burst && burst.el === el && burst.chars.length >= 4 && t - burst.last < 100;
      if (isScan) {
        e.preventDefault();
        e.stopImmediatePropagation();
        el.value = burst.before;
        const code = burst.chars.trim().toUpperCase();
        burst = null;
        run(code);
      }
      burst = null;
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) { burst = null; return; }
    if (!burst || burst.el !== el || t - burst.last > SCAN_GAP_MS) burst = { el, chars: '', before: el.value, last: t };
    burst.chars += e.key;
    burst.last = t;
  }, true);
  // Връщане на фокуса, ако потребителят не пише в друго поле
  const refocus = () => {
    const a = document.activeElement;
    const textual = a && ((a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(a.type)) || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    const typing = a && a !== input && textual;
    if (!typing && !document.querySelector('.modal-bg')) input.focus({ preventScroll: true });
  };
  setInterval(refocus, 800);
  document.addEventListener('click', () => setTimeout(refocus, 50));
  input.focus();
}

function fmtTs(ts) {
  if (!ts) return '—';
  const [d, t] = ts.split(' ');
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y} ${t.slice(0, 5)}`;
}
function fmtTime(ts) { return ts ? ts.slice(11, 16) : ''; }
function fmtDate(d) { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}.${m}.${y}`; }
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
function weekday(ts) { return ts ? WEEKDAYS[new Date(ts.slice(0, 10) + 'T12:00:00').getDay()] : ''; }
function todayStr() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Оставащи игри: „7 от 10“ или „без ограничение“ */
function gamesLeft(g) { return !g || !g.limited ? 'без ограничение' : `${g.remaining} от ${g.allowed}`; }
function gamesColor(g) { return !g || !g.limited ? 'var(--muted)' : g.remaining === 0 ? 'var(--bad)' : g.remaining <= 2 ? 'var(--warn)' : 'var(--ok)'; }
/** Продължителност в минути -> „2 ч 15 мин“ */
function fmtDuration(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}
/** Час на тръгване + откъде е взет */
function leftText(r) {
  if (!r.left) return r.in_park ? '<span class="badge ok">в парка</span>' : '—';
  const how = r.left_by === 'purchase' ? 'последна покупка' : 'последна игра';
  return `${fmtTime(r.left)} <span class="muted small">(${how})</span>`;
}
/** Адрес на клиентското приложение: публичният (от настройките) или в мрежата на парка */
async function appUrl() {
  const [s, p] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/ping')]);
  if (s.public_url) return s.public_url.replace(/\/+$/, '') + '/app';
  // отворено на самия сървър (localhost) – телефоните трябва адреса му в мрежата
  const host = /^(localhost|127\.|\[?::1)/.test(location.hostname) && p.lan_ip ? p.lan_ip : location.hostname;
  return `http://${host}:${p.public_port || 3080}/app`;
}
/** „Тайните на звездата“: оставащите игри като златни звезди */
function starsHtml(g, size = 26) {
  if (!g || !g.limited || !g.allowed || g.allowed > 30) return '';
  return `<div class="stars" style="font-size:${size}px">${'<b>★</b>'.repeat(g.remaining)}${'<i>☆</i>'.repeat(Math.max(0, g.allowed - g.remaining))}</div>`;
}
/** Програма от настройките: „12.12 17:00 | 🎭 Театрална постановка“ -> [{date, time, when, title}] */
function parseProgram(text) {
  const year = new Date().getFullYear();
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf('|');
    let when = i >= 0 ? line.slice(0, i).trim() : '';
    const title = (i >= 0 ? line.slice(i + 1) : line).trim();
    let date = null;
    const m = when.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?\s*(.*)$/);
    if (m) { date = `${m[3] || year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; when = m[4] || 'цял ден'; }
    const t = when.match(/^(\d{1,2}):(\d{2})/);
    return { date, time: t ? `${t[1].padStart(2, '0')}:${t[2]}` : null, when, title };
  });
}
/** Днешната програма като червена завеса с панделка (празно, ако няма) */
function programTodayHtml(text, ribbon = 'Очакват ви днес') {
  const T = todayStr();
  const d = new Date(); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const list = parseProgram(text).filter((p) => !p.date || p.date === T);
  if (!list.length) return '';
  const next = list.findIndex((p) => p.time && p.time >= hm);
  return `<div class="velvet"><div class="ribbon">${esc(ribbon)}</div>${list.map((p, i) =>
    `<div class="prog-item ${i === next ? 'now' : ''}"><span class="w">${esc(p.when)}</span><span>${esc(p.title)}</span></div>`).join('')}</div>`;
}
function pts(n) { return `${Number(n || 0).toLocaleString('bg-BG')} т.`; }
function money(n, cur = '€') { return `${Number(n || 0).toLocaleString('bg-BG', { maximumFractionDigits: 2 })} ${cur}`; }

function startClock(el) {
  const tick = () => { el.textContent = new Date().toLocaleString('bg-BG', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick(); setInterval(tick, 1000);
}

function station(defaultName) {
  const q = new URLSearchParams(location.search).get('station');
  if (q) { try { localStorage.setItem('station:' + location.pathname, q); } catch { /* ignore */ } return q; }
  try { return localStorage.getItem('station:' + location.pathname) || defaultName; } catch { return defaultName; }
}

document.addEventListener('DOMContentLoaded', () => {
  const c = $('header.top .clock');
  if (c) startClock(c);
  staffAppButtons();
});

// ---------- приложение за служителите ----------
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = $('#appInstall'); if (b) b.classList.remove('hidden'); });
if ('serviceWorker' in navigator && window.isSecureContext && document.querySelector('link[rel="manifest"][href="/staff.webmanifest"]')) {
  navigator.serviceWorker.register('/sw-staff.js').catch(() => { /* напр. самоподписан сертификат – приложението работи и без него */ });
}
function staffAppButtons() {
  const header = $('header.top');
  if (!header || $('#appFull')) return;
  const clock = $('.clock', header);
  const mk = (id, text, title, cls = '') => {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.className = `ghost sm ${cls}`; b.textContent = text; b.title = title;
    header.insertBefore(b, clock || null);
    return b;
  };
  const inst = mk('appInstall', '⬇ Инсталирай', 'Инсталирай като приложение на това устройство', 'hidden');
  inst.addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; inst.classList.add('hidden'); });
  if (installEvt) inst.classList.remove('hidden');
  if (document.fullscreenEnabled && !isStandalone()) {
    const full = mk('appFull', '⛶', 'Цял екран');
    full.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  }
  if (clock) clock.style.marginLeft = '0';
  const spacer = document.createElement('span'); spacer.style.marginLeft = 'auto';
  header.insertBefore(spacer, inst);
}
addEventListener('offline', () => toast('📡 Няма връзка със сървъра – действията няма да се запишат', 'bad', 8000));
addEventListener('online', () => toast('Връзката е възстановена ✔', 'ok'));
