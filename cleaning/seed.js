'use strict';
// Примерни данни: продукти, дати за вземане, училище и часове за консултации.
// Стартира се с: npm run seed  (не трие нищо; добавя продукти само ако няма)
const { db, tx } = require('./db');
const { today } = require('./server');

const pad = (n) => String(n).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ts = `${today()} 09:00:00`;

const PRODUCTS = [
  { name: 'Универсален еко концентрат', category: 'Универсални', image: '🧴', price: 12.9, short: '1 бутилка = 10 литра готов препарат за всички повърхности.',
    description: 'Растителни повърхностно активни вещества, без фосфати и без силен парфюм. Подходящ за кухня, баня, подове и прозорци.',
    usage: '1. Разредете 1 капачка (20 мл) в 1 л вода в бутилка с пулверизатор.\n2. Напръскайте върху микрофибърна кърпа.\n3. Избършете и подсушете със суха кърпа.',
    technique: 'Работя по метода „от сухо към мокро, отгоре надолу“: първо махам праха със суха кърпа, после минавам с разтвора. Така кърпата не се зацапва и пестя половината препарат.',
    tips: 'Не смесвайте с белина. При чувствителна кожа – с ръкавици.', eco_money: 6.5, eco_plastic: 360, eco_chem: 45 },
  { name: 'Препарат против котлен камък', category: 'Баня', image: '🚿', price: 8.5, short: 'На основата на лимонена киселина – за душове, кранове и плочки.',
    description: 'Разтваря котления камък без хлор и без силни изпарения.',
    usage: '1. Напръскайте директно върху котления камък.\n2. Оставете 5 минути.\n3. Изтъркайте с мека четка и изплакнете с вода.',
    technique: 'За крановете увивам кърпа, напоена с препарата, и я оставям 15 минути – камъкът пада сам, без търкане.',
    tips: 'Не използвайте върху мрамор и естествен камък.', eco_money: 3.2, eco_plastic: 120, eco_chem: 60 },
  { name: 'Обезмаслител за кухня', category: 'Кухня', image: '🍳', price: 9.9, short: 'Премахва мазнина от котлони, абсорбатори и фурни.',
    description: 'Ензимна формула, която разгражда мазнината без агресивни основи.',
    usage: '1. Напръскайте и оставете 3–5 минути.\n2. Избършете с влажна гъба.\n3. За фурната – нанесете на топла (не гореща) повърхност.',
    technique: 'Филтрите на абсорбатора накисвам в гореща вода с 50 мл препарат за 20 минути – излизат като нови.',
    tips: 'Проветрявайте по време на работа.', eco_money: 4.1, eco_plastic: 150, eco_chem: 80 },
  { name: 'Еко гел за пране', category: 'Пране', image: '👕', price: 14.5, short: '40 пранета, хипоалергенен, подходящ за бебешки дрехи.',
    description: 'Без оптични избелители и без микропластмаси.',
    usage: '35 мл за нормално замърсено пране, 50 мл за силно замърсено. Перете на 30–40°C.',
    technique: 'Петната третирам предварително с капка гел и ги оставям 10 минути преди пералнята.',
    tips: 'Съхранявайте далеч от деца.', eco_money: 5, eco_plastic: 200, eco_chem: 70 },
  { name: 'Стъклена бутилка с пулверизатор', category: 'Аксесоари', image: '🍶', price: 7, short: 'Многократна бутилка за разредените концентрати.',
    description: 'Стъкло с предпазен силиконов слой. Служи години наред.',
    usage: 'Напълнете с разреден концентрат. Надпишете с маркер какво съдържа.',
    technique: 'Държа по една бутилка във всяка стая – така почиствам веднага, когато видя петно.',
    tips: '', eco_money: 0, eco_plastic: 400, eco_chem: 0 },
  { name: 'Микрофибърни кърпи (комплект 4)', category: 'Аксесоари', image: '🧽', price: 6.9, short: 'Цветове за всяка зона: кухня, баня, прах, стъкла.',
    description: 'Висококачествена микрофибра, издържа над 300 пранета.',
    usage: 'Използвайте влажна за почистване и суха за подсушаване. Перете без омекотител.',
    technique: 'Сгъвам кърпата на 4 – получавам 8 чисти страни и сменям страната при всяка нова повърхност.',
    tips: 'Омекотителят запушва влакната – не го използвайте.', eco_money: 2, eco_plastic: 50, eco_chem: 20 },
];

tx(() => {
  if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) {
    const ins = db.prepare(`INSERT INTO products(name,category,image,price,short,description,usage,technique,tips,eco_money,eco_plastic,eco_chem,sort,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    PRODUCTS.forEach((p, i) => ins.run(p.name, p.category, p.image, p.price, p.short, p.description, p.usage, p.technique, p.tips, p.eco_money, p.eco_plastic, p.eco_chem, i, ts));
    console.log(`Добавени продукти: ${PRODUCTS.length}`);
  }
  if (!db.prepare('SELECT COUNT(*) n FROM pickup_slots').get().n) {
    const ins = db.prepare(`INSERT INTO pickup_slots(date,time_from,time_to,location,capacity) VALUES(?,?,?,?,?)`);
    let n = 0;
    for (let i = 1; i <= 28; i++) {
      const d = day(i); const [y, m, dd] = d.split('-').map(Number);
      const wd = new Date(y, m - 1, dd).getDay();
      if (wd === 2 || wd === 4) { ins.run(d, '17:00', '19:00', 'Пункт за вземане (сменете от Админ → Дати)', 20); n++; }
      if (wd === 6) { ins.run(d, '10:00', '13:00', 'Пункт за вземане (сменете от Админ → Дати)', 30); n++; }
    }
    console.log(`Добавени дати за вземане: ${n}`);
  }
  if (!db.prepare('SELECT COUNT(*) n FROM school_items').get().n) {
    const ins = db.prepare(`INSERT INTO school_items(type,title,description,starts_at,location,seats,price,club_only,created_at) VALUES(?,?,?,?,?,?,?,?,?)`);
    ins.run('workshop', 'Основен курс: чиста баня за 20 минути', 'Практически уъркшоп – показвам техниките на живо, вие опитвате. Всеки получава мостри.', `${day(10)} 18:00`, 'Ще бъде обявено', 12, 15, 0, ts);
    ins.run('presentation', 'Онлайн: как да заменим химията у дома', 'Презентация за съставките на препаратите и как да четем етикетите.', `${day(5)} 19:30`, '', 0, 0, 0, ts);
    ins.run('live', 'На живо в YouTube: въпроси и отговори', 'Отговарям на вашите въпроси за петна, мухъл и котлен камък.', `${day(7)} 20:00`, '', 0, 0, 0, ts);
    ins.run('recording', 'Запис: генерално пролетно почистване', 'Пълен запис на уъркшопа – стъпка по стъпка.', '', '', 0, 0, 1, ts);
    console.log('Добавени събития в училището: 4');
  }
  if (!db.prepare('SELECT COUNT(*) n FROM consult_slots').get().n) {
    const ins = db.prepare(`INSERT OR IGNORE INTO consult_slots(starts_at,duration,mode) VALUES(?,30,'online')`);
    let n = 0;
    for (let i = 1; i <= 14; i++) {
      const d = day(i); const [y, m, dd] = d.split('-').map(Number);
      const wd = new Date(y, m - 1, dd).getDay();
      if (wd >= 1 && wd <= 5) for (const t of ['10:00', '11:00', '17:00']) n += ins.run(`${d} ${t}`).changes;
    }
    console.log(`Добавени часове за консултации: ${n}`);
  }
});
console.log('Готово. Стартирайте с: npm start');
