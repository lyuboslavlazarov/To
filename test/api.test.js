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
  await call('POST', '/api/entry', { barcode: 'LP0003' });
  const p = (await call('POST', '/api/plays', { barcode: 'LP0003', game_id: 1, points: 7 })).data;
  r = await call('POST', `/api/plays/${p.play_id}/void`, {});
  assert.equal(r.data.card.balance, 50);
});

test('резервно копие в избрана папка', async () => {
  const bdir = path.join(dir, 'Google Drive', 'Lunapark backup');
  let r = await call('PUT', '/api/settings', { backup_dir: bdir, backup_interval: 30 });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/backup');
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(r.data.file));
  assert.equal(r.data.files.length, 1);
  assert.equal(r.data.interval, 30);
  // копието е валидна база със същите карти
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync(r.data.file, { readOnly: true });
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM cards').get().n >= 600);
  copy.close();
  // невалидна папка се отказва
  r = await call('PUT', '/api/settings', { backup_dir: path.join(process.env.DB_FILE, 'x') });
  assert.equal(r.status, 400);
});

test('един платен вход = 10 игри', async () => {
  let r = await call('POST', '/api/plays', { barcode: 'LP0010', game_id: 1 });
  assert.equal(r.status, 403, 'без вход не може да се играе');
  assert.match(r.data.error, /Няма платен вход/);
  r = await call('POST', '/api/entry', { barcode: 'LP0010' });
  assert.equal(r.data.card.games.remaining, 10);
  for (let i = 1; i <= 10; i++) {
    r = await call('POST', '/api/plays', { barcode: 'LP0010', game_id: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.data.card.games.remaining, 10 - i);
  }
  r = await call('POST', '/api/plays', { barcode: 'LP0010', game_id: 1 });
  assert.equal(r.status, 403, '11-тата игра се отказва');
  assert.match(r.data.error, /Изиграни са всички 10 игри/);
  // анулирана игра връща една игра
  const last = (await call('GET', '/api/cards/LP0010/history')).data.plays[0];
  r = await call('POST', `/api/plays/${last.id}/void`, {});
  assert.equal(r.data.card.games.remaining, 1);
  // нов платен вход -> още 10
  r = await call('POST', '/api/entry', { barcode: 'LP0010' });
  assert.equal(r.data.card.games.remaining, 11);
  assert.equal((await call('GET', '/api/cards?q=LP0010')).data[0].games_left, 11);
  // 0 = без ограничение
  await call('PUT', '/api/settings', { plays_per_entry: 0 });
  r = await call('POST', '/api/plays', { barcode: 'LP0011', game_id: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.card.games.limited, false);
  await call('PUT', '/api/settings', { plays_per_entry: 10 });
});

test('замяна на изгубена карта', async () => {
  await call('PUT', '/api/cards/LP0050', { name: 'Иво Тодоров', phone: '0887111222', age: 11 });
  await call('POST', '/api/entry', { barcode: 'LP0050' });
  for (let i = 0; i < 3; i++) await call('POST', '/api/plays', { barcode: 'LP0050', game_id: 1, points: 10 });
  const before = (await call('GET', '/api/cards/LP0050')).data;
  assert.equal(before.balance, 30);
  assert.equal(before.games.remaining, 7);

  // използвана карта не може да е нова
  let r = await call('POST', '/api/cards/LP0050/replace', { new_barcode: 'LP0001' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /вече е използвана/);
  // същата карта
  r = await call('POST', '/api/cards/LP0050/replace', { new_barcode: 'lp0050' });
  assert.equal(r.status, 400);

  // замяна с неизползвана карта (съществуваща празна)
  r = await call('POST', '/api/cards/LP0050/replace', { new_barcode: 'LP0051', reason: 'Изгубена' });
  assert.equal(r.status, 200);
  const c = r.data.card;
  assert.equal(c.barcode, 'LP0051');
  assert.equal(c.name, 'Иво Тодоров');
  assert.equal(c.phone, '0887111222');
  assert.equal(c.balance, 30);
  assert.equal(c.games.remaining, 7);
  assert.equal(c.visits, 1);
  assert.equal(c.plays, 3);

  // старата е блокирана и казва с коя е заменена
  const old = (await call('GET', '/api/cards/LP0050')).data;
  assert.equal(old.blocked, 1);
  assert.equal(old.replaced_by, 'LP0051');
  r = await call('POST', '/api/plays', { barcode: 'LP0050', game_id: 1 });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /заменена с LP0051/);
  // новата работи
  r = await call('POST', '/api/plays', { barcode: 'LP0051', game_id: 1, points: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.data.card.games.remaining, 6);

  // повторна замяна на старата не е позволена; на новата – да (чисто нова карта, несъществуваща в базата)
  r = await call('POST', '/api/cards/LP0050/replace', { new_barcode: 'LP0052' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/cards/LP0051/replace', { new_barcode: 'NEWCARD9' });
  assert.equal(r.status, 200);
  assert.equal(r.data.card.balance, 35);
  assert.equal((await call('GET', '/api/cards/LP0050')).data.replaced_by, 'NEWCARD9', 'веригата води до последната карта');
  const h = (await call('GET', '/api/cards/NEWCARD9/history')).data;
  assert.equal(h.replacements.length, 1);
  assert.equal(h.plays.length, 4);
});

test('престой в парка: пристигане, тръгване, продължителност', async () => {
  const { db } = require('../db');
  const D = '2026-01-10';
  await call('PUT', '/api/cards/LP0200', { name: 'Стоян' });
  await call('PUT', '/api/cards/LP0201', { name: 'Вера' });
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  // Стоян: вход 10:05, игри 10:30 и 11:40 (+30 т.), покупка 12:50 за 30 т. -> изхарчил всичко
  ins('INSERT INTO visits(barcode,amount,points,ts) VALUES(?,?,?,?)', 'LP0200', 20, 0, `${D} 10:05:00`);
  ins('INSERT INTO plays(barcode,game_id,game_name,points,ts) VALUES(?,?,?,?,?)', 'LP0200', 1, 'Стрелба', 10, `${D} 10:30:00`);
  ins('INSERT INTO plays(barcode,game_id,game_name,points,ts) VALUES(?,?,?,?,?)', 'LP0200', 1, 'Стрелба', 20, `${D} 11:40:00`);
  ins('INSERT INTO purchases(barcode,total,ts) VALUES(?,?,?)', 'LP0200', 30, `${D} 12:50:00`);
  // Вера: вход 14:00, игра 15:15, без покупка -> тръгване по последна игра
  ins('INSERT INTO visits(barcode,amount,points,ts) VALUES(?,?,?,?)', 'LP0201', 20, 0, `${D} 14:00:00`);
  ins('INSERT INTO plays(barcode,game_id,game_name,points,ts) VALUES(?,?,?,?,?)', 'LP0201', 1, 'Стрелба', 10, `${D} 15:15:00`);

  const s = (await call('GET', `/api/stats?from=${D}&to=${D}`)).data;
  const st = Object.fromEntries(s.stays.map((r) => [r.barcode, r]));
  assert.equal(st.LP0200.arrived, `${D} 10:05:00`);
  assert.equal(st.LP0200.left, `${D} 12:50:00`);
  assert.equal(st.LP0200.left_by, 'purchase');
  assert.equal(st.LP0200.minutes, 165);
  assert.equal(st.LP0200.spent_all, true);
  assert.equal(st.LP0200.plays, 2);
  assert.equal(st.LP0201.left_by, 'play');
  assert.equal(st.LP0201.minutes, 75);
  assert.equal(st.LP0201.spent_all, false);
  assert.equal(st.LP0201.balance_end, 10);
  assert.equal(s.stay.visits, 2);
  assert.equal(s.stay.avg_minutes, 120);
  assert.equal(s.stay.max_minutes, 165);
  assert.equal(s.stay.spent_all, 1);
  assert.equal(s.stay.avg_arrival, '12:03');
  // в картата на посетителя
  const h = (await call('GET', '/api/cards/LP0200/history')).data;
  assert.equal(h.stays.length, 1);
  assert.equal(h.stay.avg_minutes, 165);
  // CSV
  const c = (await call('GET', `/api/export/stays?from=${D}&to=${D}`)).data;
  assert.match(c, /LP0200;Стоян;10:05;12:50;последна покупка;2:45;165/);
});
