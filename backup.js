'use strict';
/*
 * Автоматично резервно копие на базата данни.
 * Прави копие на всеки N минути (и при спиране на приложението) в избрана папка –
 * например папка в Google Drive или iCloud, които се синхронизират сами.
 * Пази по едно копие на ден: lunapark-ГГГГ-ММ-ДД.db, за последните KEEP_DAYS дни.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { db, DB_FILE } = require('./db');

const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 30;
const DEFAULT_DIR = path.join(path.dirname(DB_FILE), 'backups');
const FILE_RE = /^lunapark-\d{4}-\d{2}-\d{2}\.db$/;

const state = { last: null, lastFile: null, error: null, running: false };

function setting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
}

function expandDir(p) {
  let s = String(p || '').trim();
  if (!s) return '';
  if (s === '~' || s.startsWith('~/')) s = path.join(os.homedir(), s.slice(1));
  return path.resolve(s);
}

function backupDir() {
  return expandDir(setting('backup_dir')) || DEFAULT_DIR;
}
function intervalMin() {
  const n = Number(setting('backup_interval'));
  return Number.isFinite(n) && n >= 5 ? n : 60;
}

/** Проверява, че в папката може да се пише. Хвърля грешка на български. */
function checkDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.lunapark-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error(`Не може да се пише в папката „${dir}“ (${e.code || e.message})`);
  }
}

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${localDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Прави копие сега. Връща пътя до файла. */
function runBackup() {
  if (state.running) throw new Error('В момента се прави копие');
  state.running = true;
  const dir = backupDir();
  try {
    checkDir(dir);
    const name = `lunapark-${localDate()}.db`;
    const final = path.join(dir, name);
    // Първо във временен файл и после преименуване – облачната синхронизация
    // никога не вижда наполовина записан файл.
    const tmp = path.join(dir, `.${name}.tmp`);
    try { fs.unlinkSync(tmp); } catch { /* няма */ }
    db.prepare('VACUUM INTO ?').run(tmp); // консистентно копие, безопасно докато приложението работи
    fs.renameSync(tmp, final);
    cleanup(dir);
    state.last = localStamp();
    state.lastFile = final;
    state.error = null;
    return final;
  } catch (e) {
    state.error = `${localStamp()}: ${e.message}`;
    throw e;
  } finally {
    state.running = false;
  }
}

function cleanup(dir) {
  const limit = new Date();
  limit.setDate(limit.getDate() - KEEP_DAYS);
  const p = (n) => String(n).padStart(2, '0');
  const cutoff = `lunapark-${limit.getFullYear()}-${p(limit.getMonth() + 1)}-${p(limit.getDate())}.db`;
  for (const f of fs.readdirSync(dir)) {
    if (FILE_RE.test(f) && f < cutoff) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}

function listBackups() {
  const dir = backupDir();
  try {
    return fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort().reverse().map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, modified: st.mtime.toISOString() };
    });
  } catch { return []; }
}

/** Открива папки на Google Drive / iCloud / Dropbox / OneDrive на този компютър. */
function suggestions() {
  const home = os.homedir();
  const out = [];
  const add = (label, base) => {
    if (base && fs.existsSync(base)) out.push({ label, path: path.join(base, 'Lunapark backup') });
  };
  const cloud = path.join(home, 'Library', 'CloudStorage');
  try {
    for (const d of fs.readdirSync(cloud)) {
      const full = path.join(cloud, d);
      if (d.startsWith('GoogleDrive-')) {
        const my = ['My Drive', 'Моят диск'].map((x) => path.join(full, x)).find((x) => fs.existsSync(x));
        add(`Google Drive (${d.slice(12)})`, my || full);
      } else if (d.startsWith('Dropbox')) add('Dropbox', full);
      else if (d.startsWith('OneDrive')) add('OneDrive', full);
    }
  } catch { /* не е Mac или няма облачни папки */ }
  add('iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  add('Google Drive', path.join(home, 'Google Drive', 'My Drive'));
  add('Google Drive', 'G:\\My Drive');
  add('Dropbox', path.join(home, 'Dropbox'));
  add('OneDrive', path.join(home, 'OneDrive'));
  const seen = new Set();
  return out.filter((s) => !seen.has(s.path) && seen.add(s.path));
}

function status() {
  return {
    dir: setting('backup_dir'),
    effective_dir: backupDir(),
    default_dir: DEFAULT_DIR,
    interval: intervalMin(),
    keep_days: KEEP_DAYS,
    last: state.last,
    last_file: state.lastFile,
    error: state.error,
    files: listBackups(),
    suggestions: suggestions(),
  };
}

let timer = null;
function start() {
  if (process.env.BACKUP_DISABLED === '1' || timer) return;
  let lastRun = 0;
  const tick = () => {
    if (Date.now() - lastRun < intervalMin() * 60e3) return;
    lastRun = Date.now();
    try { runBackup(); } catch (e) { console.error('Резервно копие:', e.message); }
  };
  setTimeout(tick, 5000).unref();
  timer = setInterval(tick, 60e3);
  timer.unref();

  // Копие и при спиране с Control+C
  let stopping = false;
  const onStop = () => {
    if (stopping) return;
    stopping = true;
    try { console.log('\nПравя резервно копие преди спиране…'); console.log('Записано: ' + runBackup()); }
    catch (e) { console.error('Резервно копие:', e.message); }
    process.exit(0);
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
}

module.exports = { start, runBackup, status, checkDir, expandDir };
