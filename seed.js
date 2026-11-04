'use strict';
// Примерни данни: 600 карти, няколко игри и продукти. Безопасно е да се пусне повторно.
const { db, tx } = require('./db');

const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
const games = [['Стрелба с пушка', 10], ['Хвърляне на рингове', 10], ['Колелото на късмета', 5], ['Баскетбол', 15], ['Риболов с магнит', 5], ['Дартс', 10]];
const products = [
  ['Хот-дог', 'Храна', 30], ['Пица (парче)', 'Храна', 35], ['Пуканки', 'Храна', 15], ['Захарен памук', 'Сладко', 20],
  ['Сладолед', 'Сладко', 20], ['Гофрета', 'Сладко', 25], ['Вода', 'Напитки', 10], ['Сок', 'Напитки', 15], ['Лимонада', 'Напитки', 20],
];

tx(() => {
  const g = db.prepare('INSERT OR IGNORE INTO games(name, points, active, created_at) VALUES(?,?,1,?)');
  for (const [n, p] of games) g.run(n, p, now);
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
    const p = db.prepare('INSERT INTO products(name, category, points, active, sort) VALUES(?,?,?,1,?)');
    products.forEach(([n, c, pts], i) => p.run(n, c, pts, i));
  }
  const c = db.prepare('INSERT OR IGNORE INTO cards(barcode, created_at, updated_at) VALUES(?,?,?)');
  for (let i = 1; i <= 600; i++) c.run('LP' + String(i).padStart(4, '0'), now, now);
});

console.log('Готово: 600 карти (LP0001–LP0600), игри и продукти.');
