'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunapark-'));
process.env.DB_FILE = path.join(dir, 'test.db');
const { server } = require('../server');

let base;
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}

test.before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('пълен поток: карта, вход, игри, покупка, статистика', async () => {
  let r = await call('POST', '/api/cards/generate', { prefix: 'LP', start: 1, count: 600, digits: 4 });
  assert.equal(r.data.created, 600);
  r = await call('POST', '/api/cards/generate', { prefix: 'LP', start: 1, count: 600, digits: 4 });
  assert.equal(r.data.skipped, 600);

  r = await call('PUT', '/api/cards/lp0001', { name: 'Иван Петров', phone: '0888', age: 10 });
  assert.equal(r.data.barcode, 'LP0001');
  assert.equal(r.data.name, 'Иван Петров');

  r = await call('POST', '/api/entry', { barcode: 'LP0001' });
  assert.equal(r.status, 200);
  assert.equal(r.data.card.visits, 1);
  assert.equal(r.data.card.entry_paid, 20);
  assert.equal(r.data.card.balance, 0, 'входът не се превръща в точки');
  await call('POST', '/api/entry', { barcode: 'LP0001' });

  const g = (await call('POST', '/api/games', { name: 'Стрелба', points: 10 })).data;
  const g2 = (await call('POST', '/api/games', { name: 'Дартс', points: 5 })).data;
  assert.equal((await call('POST', '/api/games', { name: 'Стрелба' })).status, 400);

  r = await call('POST', '/api/plays', { barcode: 'LP0001', game_id: g.id });
  assert.equal(r.data.points, 10);
  r = await call('POST', '/api/plays', { barcode: 'LP0001', game_id: g.id, points: 30 });
  assert.equal(r.data.times_this_game, 2);
  r = await call('POST', '/api/plays', { barcode: 'LP0001', game_id: g2.id });
  assert.equal(r.data.card.balance, 45);

  const hot = (await call('POST', '/api/products', { name: 'Хот-дог', category: 'Храна', points: 20 })).data;
  const water = (await call('POST', '/api/products', { name: 'Вода', category: 'Напитки', points: 5 })).data;

  r = await call('POST', '/api/purchases', { barcode: 'LP0001', items: [{ product_id: hot.id, qty: 3 }] });
  assert.equal(r.status, 402, 'недостатъчно точки');
  r = await call('POST', '/api/purchases', { barcode: 'LP0001', items: [{ product_id: hot.id, qty: 2 }, { product_id: water.id, qty: 1 }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 45);
  assert.equal(r.data.card.balance, 0);

  // анулиране на покупка връща точките
  r = await call('POST', `/api/purchases/${r.data.purchase_id}/void`);
  assert.equal(r.data.card.balance, 45);

  r = await call('GET', '/api/cards/LP0001/history');
  assert.equal(r.data.card.visits, 2);
  assert.equal(r.data.plays.length, 3);
  assert.equal(r.data.byGame.find((x) => x.game_name === 'Стрелба').times, 2);
  assert.equal(r.data.purchases[0].items.length, 2);

  r = await call('GET', '/api/stats');
  assert.equal(r.data.totals.entries, 2);
  assert.equal(r.data.totals.entry_amount, 40);
  assert.equal(r.data.totals.plays, 3);
  assert.equal(r.data.totals.cards_total, 600);

  r = await call('GET', '/api/export/activity');
  assert.match(r.data, /Стрелба/);
});

test('непозната и блокирана карта', async () => {
  let r = await call('POST', '/api/plays', { barcode: 'XXX999', game_id: 1 });
  assert.equal(r.status, 404);
  await call('POST', '/api/cards/LP0002/block', { blocked: true });
  r = await call('POST', '/api/entry', { barcode: 'LP0002' });
  assert.equal(r.status, 403);
  // нова карта се създава на поста за вход
  r = await call('PUT', '/api/cards/NEW1', { name: 'Мария' });
  assert.equal(r.status, 200);
});

test('корекция и анулиране на игра', async () => {
  let r = await call('POST', '/api/cards/LP0003/adjust', { points: -5 });
  assert.equal(r.status, 400, 'не може под нула');
  r = await call('POST', '/api/cards/LP0003/adjust', { points: 50, reason: 'подарък' });
  assert.equal(r.data.balance, 50);
  const p = (await call('POST', '/api/plays', { barcode: 'LP0003', game_id: 1, points: 7 })).data;
  r = await call('POST', `/api/plays/${p.play_id}/void`, {});
  assert.equal(r.data.card.balance, 50);
});
