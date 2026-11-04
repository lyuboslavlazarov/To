'use strict';
/*
 * Сертификат за https (нужен е, за да разрешат браузърите камерата на таблети и телефони).
 * Генерира се автоматично веднъж (самоподписан, валиден 10 години) с командата openssl,
 * която е налична на всеки Mac и Linux. Може да се ползва и собствен сертификат
 * чрез TLS_CERT и TLS_KEY.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

function generate(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const host = os.hostname().replace(/\.local$/, '');
  const san = ['DNS:localhost', `DNS:${host}`, `DNS:${host}.local`, 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
  const base = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-keyout', key, '-out', cert, '-subj', '/CN=Lunapark'];
  try {
    execFileSync('openssl', [...base, '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  } catch {
    execFileSync('openssl', base, { stdio: 'ignore' }); // по-стари версии на openssl без -addext
  }
  try { fs.chmodSync(key, 0o600); } catch { /* Windows */ }
  return { key, cert };
}

/** Връща { key, cert } (съдържание) или хвърля грешка. */
function loadOrCreate(dataDir) {
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) };
  }
  const dir = path.join(dataDir, 'certs');
  let files = { key: path.join(dir, 'key.pem'), cert: path.join(dir, 'cert.pem') };
  if (!fs.existsSync(files.key) || !fs.existsSync(files.cert)) files = generate(dir);
  return { key: fs.readFileSync(files.key), cert: fs.readFileSync(files.cert) };
}

module.exports = { loadOrCreate, lanAddresses };
