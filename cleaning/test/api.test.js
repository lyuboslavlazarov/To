'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaning-'));
process.env.DB_FILE = path.join(dir, 'test.db');
const { server, addMonths, today } = require('../server');
const { db } = require('../db');

let base;
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}
test.before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('addMonths пази края на месеца', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-05', 1), '2026-12-05');
  assert.equal(addMonths('2026-12-15', 2), '2027-02-15');
});

test('пълен поток: админ, продукт, дата, поръчка, клуб, масова смяна на статус', async () => {
  const admin = client(); const cust = client(); const anon = client();
  let r = await admin('POST', '/api/auth/register', { email: 'owner@x.bg', name: 'Собственик', password: 'secret1' });
  assert.equal(r.data.user.role, 'admin', 'първият акаунт е администратор');
  r = await cust('POST', '/api/auth/register', { email: 'ivan@x.bg', name: 'Иван Петров', password: 'secret2' });
  assert.equal(r.data.user.role, 'customer');
  assert.equal((await cust('GET', '/api/admin/dashboard')).status, 403);
  assert.equal((await anon('POST', '/api/orders', { items: [] })).status, 401);

  r = await admin('POST', '/api/admin/products', { name: 'Концентрат', price: 10, eco_plastic: 300, eco_money: 5, video_url: 'https://youtu.be/dQw4w9WgXcQ' });
  const pid = r.data.id;
  assert.equal(r.data.video_id, 'dQw4w9WgXcQ');

  const d = new Date(); d.setDate(d.getDate() + 3);
  const date = d.toISOString().slice(0, 10);
  r = await admin('POST', '/api/admin/pickup-slots', { date, time_from: '17:00', time_to: '19:00', location: 'Офис', capacity: 1 });
  const slot = r.data.id;
  r = await admin('POST', '/api/admin/pickup-slots/generate', { from: today(), to: addMonths(today(), 1), weekdays: [1, 3], time_from: '10:00' });
  assert.ok(r.data.created >= 6);

  // поръчка без клуб – без отстъпка
  r = await cust('POST', '/api/orders', { items: [{ product_id: pid, qty: 2 }], pickup_slot_id: slot });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 20);
  const o1 = r.data.id;
  // капацитетът е 1 – датата вече е запълнена
  r = await cust('POST', '/api/orders', { items: [{ product_id: pid, qty: 1 }], pickup_slot_id: slot });
  assert.equal(r.status, 400);

  // клуб: заявка -> активиране -> 10% отстъпка
  r = await cust('POST', '/api/club/request');
  assert.equal(r.data.user.club.status, 'pending');
  const uid = r.data.user.id;
  r = await admin('GET', '/api/admin/dashboard');
  assert.equal(r.data.pending.length, 1);
  r = await admin('POST', `/api/admin/users/${uid}/club`, { action: 'extend', months: 1 });
  assert.equal(r.data.club.member, true);
  assert.equal(r.data.club.until, addMonths(today(), 1));
  assert.equal(db.prepare('SELECT amount FROM club_payments WHERE user_id=?').get(uid).amount, 10);

  const slots = (await cust('GET', '/api/pickup-slots')).data;
  assert.ok(!slots.find((s) => s.id === slot), 'пълната дата не се показва');
  r = await cust('POST', '/api/orders', { items: [{ product_id: pid, qty: 1 }], pickup_slot_id: slots[0].id });
  assert.equal(r.data.discount_pct, 10);
  assert.equal(r.data.total, 9);
  const o2 = r.data.id;

  // масова смяна на статус и плащане
  r = await admin('POST', '/api/admin/orders/bulk', { ids: [o1, o2], status: 'arrived' });
  assert.equal(r.data.changed, 2);
  r = await admin('POST', '/api/admin/orders/bulk', { ids: [o1, o2], status: 'delivered', paid: true });
  assert.equal(r.data.changed, 2);
  r = await admin('GET', '/api/admin/orders?status=delivered&paid=1');
  assert.equal(r.data.length, 2);
  r = await cust('GET', '/api/orders');
  assert.ok(r.data.every((o) => o.status === 'delivered' && o.paid === 1));
  assert.equal((await cust('POST', `/api/orders/${o1}/cancel`)).status, 400);

  // известия към клиента
  r = await cust('GET', '/api/notifications');
  assert.ok(r.data.list.some((n) => n.title.includes('пристигна')));

  // изтекъл абонамент: достъпът остава (ръчно ограничаване), админът е известен
  db.prepare('UPDATE users SET club_until=? WHERE id=?').run('2020-01-01', uid);
  r = await admin('GET', '/api/admin/dashboard');
  assert.equal(r.data.expired.length, 1);
  r = await cust('GET', '/api/me');
  assert.equal(r.data.user.club.member, true);
  assert.equal(r.data.user.club.expired, true);
  r = await cust('GET', '/api/notifications');
  assert.ok(r.data.list.some((n) => n.title.includes('изтече')));
  r = await admin('POST', `/api/admin/users/${uid}/club`, { action: 'restrict' });
  assert.equal(r.data.club.member, false);
  // подновяване от днес
  r = await admin('POST', `/api/admin/users/${uid}/club`, { action: 'extend', months: 1 });
  assert.equal(r.data.club.until, addMonths(today(), 1));

  // геймификация
  r = await cust('POST', '/api/me/watched', { kind: 'product', id: pid });
  assert.equal(r.data.awarded, true);
  r = await cust('POST', '/api/me/watched', { kind: 'product', id: pid });
  assert.equal(r.data.awarded, false);
  r = await cust('GET', '/api/me/progress');
  assert.equal(r.data.eco.plastic, 900);
  assert.ok(r.data.badges.find((b) => b.id === 'first_order').ok);

  // обратна връзка без акаунт
  r = await anon('POST', '/api/feedback', { message: 'Супер!', rating: 5, page: '/#/shop' });
  assert.equal(r.status, 200);
  r = await admin('GET', '/api/admin/feedback');
  assert.equal(r.data.length, 1);
});

test('училище и консултации', async () => {
  const admin = client(); const cust = client();
  await admin('POST', '/api/auth/login', { email: 'owner@x.bg', password: 'secret1' });
  await cust('POST', '/api/auth/register', { email: 'maria@x.bg', name: 'Мария', password: 'secret3' });
  let r = await admin('POST', '/api/admin/school', { type: 'recording', title: 'Запис', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', club_only: true });
  r = await admin('POST', '/api/admin/school', { type: 'workshop', title: 'Уъркшоп', starts_at: '2099-01-01 18:00', seats: 1 });
  const ws = r.data.id;
  r = await cust('GET', '/api/school');
  const rec = r.data.find((s) => s.type === 'recording');
  assert.equal(rec.locked, true);
  assert.equal(rec.video_id, '', 'записът е скрит за нечленове');
  r = await cust('POST', `/api/school/${ws}/signup`);
  assert.equal(r.data.signed, true);
  r = await admin('POST', '/api/admin/consult/generate', { from: '2099-01-05', to: '2099-01-06', times: '10:00, 11:00' });
  assert.equal(r.data.created, 4);
  r = await cust('GET', '/api/consult/slots');
  const sid = r.data[0].id;
  r = await cust('POST', `/api/consult/slots/${sid}/book`, { topic: 'Мухъл' });
  assert.equal(r.data.status, 'booked');
  r = await cust('POST', `/api/consult/slots/${sid}/book`, { topic: 'пак' });
  assert.equal(r.status, 400);
  r = await admin('GET', '/api/admin/consult?past=1');
  assert.equal(r.data.find((c) => c.id === sid).name, 'Мария');
});
