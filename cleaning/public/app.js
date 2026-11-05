'use strict';
// Клиентско приложение (едностранично, с маршрути след #)
let ME = null;      // текущ потребител или null
let CFG = {};       // настройки на магазина
let PRODUCTS = null;
const view = $('#view');

// ---------- количка (пази се в браузъра) ----------
const Cart = {
  get() { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; } },
  set(c) { try { localStorage.setItem('cart', JSON.stringify(c)); } catch { /* частен режим */ } updateCartDot(); },
  add(id, qty = 1) { const c = this.get(); const it = c.find((x) => x.product_id === id); if (it) it.qty += qty; else c.push({ product_id: id, qty }); this.set(c); },
  qty(id, q) { this.set(this.get().map((x) => (x.product_id === id ? { ...x, qty: q } : x)).filter((x) => x.qty > 0)); },
  count() { return this.get().reduce((a, x) => a + x.qty, 0); },
};
function updateCartDot() { const n = Cart.count(); const d = $('#cartDot'); d.textContent = n; d.classList.toggle('hidden', !n); }

async function loadMe() {
  const r = await api('GET', '/api/me');
  ME = r.user; CFG = r.settings;
  $('#brandName').textContent = CFG.shop_name;
  document.title = CFG.shop_name;
  $('#adminLink').classList.toggle('hidden', ME?.role !== 'admin');
}
async function products(force) { if (!PRODUCTS || force) PRODUCTS = await api('GET', '/api/products'); return PRODUCTS; }

const needLogin = () => `<div class="card center"><h2>Влезте в акаунта си</h2><p class="muted">За тази страница е нужен акаунт.</p>
  <div class="row" style="justify-content:center"><a class="btn" href="#/login">Вход</a><a class="btn ghost" href="#/register">Регистрация</a></div></div>`;

// ---------- известия ----------
let lastNotifId = Number(sessionStorage.getItem('lastNotif') || 0);
async function pollNotifications() {
  if (!ME) { $('#notifDot').classList.add('hidden'); return; }
  try {
    const r = await api('GET', '/api/notifications');
    const d = $('#notifDot'); d.textContent = r.unread; d.classList.toggle('hidden', !r.unread);
    const fresh = r.list.filter((n) => !n.read && n.id > lastNotifId);
    if (lastNotifId && fresh.length) fresh.slice(0, 3).forEach((n) => browserNotify(n.title, n.body));
    if (r.list[0]) { lastNotifId = Math.max(lastNotifId, r.list[0].id); sessionStorage.setItem('lastNotif', lastNotifId); }
  } catch { /* офлайн */ }
}

// ---------- страници ----------
const pages = {};

pages[''] = async () => {
  const [lb, prods, school] = await Promise.all([api('GET', '/api/leaderboard'), products(), api('GET', '/api/school')]);
  const prog = ME ? await api('GET', '/api/me/progress') : null;
  const upcoming = school.filter((s) => s.type !== 'recording' && s.starts_at).slice(0, 3);
  view.innerHTML = `
  <section class="card hero">
    <h1>${esc(CFG.shop_name)}</h1>
    <p>${esc(CFG.tagline)}</p>
    ${ME ? `<p>Здравейте, <b>${esc(ME.name)}</b>! ${ME.level.icon} ${esc(ME.level.name)} · <b>${ME.points}</b> точки</p>
      <div class="stats">
        <div class="stat"><b>${eur(prog.eco.money)}</b>спестени</div>
        <div class="stat"><b>${(prog.eco.plastic / 1000).toFixed(2)} кг</b>по-малко пластмаса</div>
        <div class="stat"><b>${prog.eco.chem} г</b>избегнати химикали</div>
        <div class="stat"><b>🔥 ${prog.streak}</b>дни поред</div>
      </div>` : `<div class="row"><a class="btn warn" href="#/register">Създай акаунт – получаваш 20 точки</a><a class="btn ghost" style="color:#fff;border-color:#fff" href="#/login">Вход</a></div>`}
  </section>

  <section class="card">
    <h2>💡 Съвет на деня</h2>
    <p>${esc(prog ? prog.tip : 'Пръскайте препарата върху кърпата, а не върху повърхността – пестите до 30% препарат.')}</p>
    ${prog ? (prog.tipDone ? '<span class="tag">✓ Прочетено днес · +5 точки</span>' : '<button class="btn sm" id="tipBtn">Прочетох – вземи 5 точки</button>') : ''}
  </section>

  <section class="card">
    <div class="row"><h2 class="grow">🧴 Продукти</h2><a href="#/shop">Всички →</a></div>
    <div class="grid">${prods.slice(0, 4).map(productCard).join('')}</div>
  </section>

  <div class="grid two" style="margin-top:14px">
    <section class="card">
      <h2>🏫 Предстои в училището</h2>
      ${upcoming.length ? upcoming.map((s) => `<p><b>${esc(s.title)}</b><br><span class="muted small">${TYPES[s.type].icon} ${TYPES[s.type].name} · ${fmtDate(s.starts_at)}</span></p>`).join('') : '<p class="muted">Скоро ще обявим нови събития.</p>'}
      <a class="btn light sm" href="#/school">Към училището</a>
    </section>
    <section class="card">
      <h2>🌍 Заедно спестихме</h2>
      <div class="stats">
        <div class="stat"><b>${(lb.community.plastic / 1000).toFixed(1)} кг</b>пластмаса</div>
        <div class="stat"><b>${(lb.community.chem / 1000).toFixed(1)} кг</b>химикали</div>
        <div class="stat"><b>${eur(lb.community.money)}</b>пари</div>
      </div>
      <h3 style="margin-top:14px">🏆 Класация</h3>
      ${lb.top.length ? `<ol>${lb.top.map((t) => `<li>${esc(t.name)} – <b>${t.points}</b> т. ${t.level.icon}</li>`).join('')}</ol>` : '<p class="muted">Бъдете първи!</p>'}
    </section>
  </div>
  <section class="card" style="margin-top:14px">
    <div class="row"><div class="grow"><h2>⭐ Клуб – ${eur(CFG.club_price)} на месец</h2><p class="muted">${CFG.club_discount_pct}% отстъпка за всички продукти, всички записи от училището, събития само за членове.</p></div><a class="btn warn" href="#/club">Научи повече</a></div>
  </section>`;
  $('#tipBtn')?.addEventListener('click', () => run(async () => { await api('POST', '/api/me/tip'); toast('+5 точки! 🌱'); render(); }));
};

function productCard(p) {
  const member = ME?.club?.member;
  return `<a class="card" href="#/product/${p.id}" style="text-decoration:none;color:inherit;display:block">
    <div class="pimg">${imgOrEmoji(p.image)}</div>
    <div class="small muted">${esc(p.category)}</div>
    <h3>${esc(p.name)}</h3>
    <p class="small muted">${esc(p.short)}</p>
    <div class="row">
      <span class="price">${eur(p.my_price)}</span>${member && p.my_price !== p.price ? `<span class="old">${eur(p.price)}</span>` : ''}
      ${p.video_id ? `<span class="tag">${p.watched ? '✓ ' : '🎬 '}видео</span>` : ''}
    </div>
    ${!member && CFG.club_discount_pct ? `<div class="clubprice">⭐ ${eur(p.club_price)} за членове на клуба</div>` : ''}
    ${p.eco_plastic ? `<div class="small" style="margin-top:6px">🌍 −${p.eco_plastic} г пластмаса</div>` : ''}
  </a>`;
}

pages.shop = async () => {
  const prods = await products(true);
  const cats = [...new Set(prods.map((p) => p.category).filter(Boolean))];
  let cat = '';
  const draw = () => {
    $('#plist').innerHTML = prods.filter((p) => !cat || p.category === cat).map(productCard).join('') || '<div class="empty">Няма продукти</div>';
    $$('.tabs button', view).forEach((b) => b.classList.toggle('on', b.dataset.c === cat));
  };
  view.innerHTML = `<h1>🧴 Магазин</h1>
    <p class="muted">Поръчвате онлайн, плащате при вземане. Изберете удобен ден в количката.</p>
    <div class="tabs"><button data-c="">Всички</button>${cats.map((c) => `<button data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="grid" id="plist"></div>`;
  $$('.tabs button', view).forEach((b) => b.onclick = () => { cat = b.dataset.c; draw(); });
  draw();
};

pages.product = async (id) => {
  const p = await api('GET', '/api/products/' + id);
  const member = ME?.club?.member;
  const sec = (title, txt) => (txt ? `<section class="card"><h2>${title}</h2><div class="prose">${esc(txt)}</div></section>` : '');
  view.innerHTML = `<p><a href="#/shop">← Магазин</a></p>
  <div class="grid two">
    <section class="card">
      <div class="pimg" style="height:200px;font-size:5rem">${imgOrEmoji(p.image)}</div>
      <div class="small muted">${esc(p.category)}</div>
      <h1>${esc(p.name)}</h1>
      <p>${esc(p.short)}</p>
      <div class="row"><span class="price" style="font-size:1.5rem">${eur(p.my_price)}</span>${member && p.my_price !== p.price ? `<span class="old">${eur(p.price)}</span> <span class="tag club">⭐ клубна цена</span>` : ''}</div>
      ${!member && CFG.club_discount_pct ? `<p class="clubprice">⭐ ${eur(p.club_price)} за членове на клуба – <a href="#/club">абонирай се</a></p>` : ''}
      <div class="row" style="margin-top:12px">
        <input type="number" id="qty" value="1" min="1" max="99" style="width:80px">
        <button class="btn" id="addBtn">🛒 Добави в количката</button>
      </div>
    </section>
    <section class="card">
      <h2>🎬 Обучително видео</h2>
      ${p.video_id ? `${ytEmbed(p.video_id)}<div class="row" style="margin-top:10px">${ME ? '<button class="btn light sm" id="watchedBtn">✅ Изгледах видеото (+10 точки)</button>' : '<span class="muted small">Влезте, за да получавате точки за изгледаните видеа.</span>'}</div>` : '<p class="muted">Видеото предстои.</p>'}
      ${p.eco_money || p.eco_plastic || p.eco_chem ? `<h3 style="margin-top:16px">🌍 С всяка бутилка</h3>
        <div class="stats">
          ${p.eco_money ? `<div class="stat"><b>${eur(p.eco_money)}</b>спестени</div>` : ''}
          ${p.eco_plastic ? `<div class="stat"><b>${p.eco_plastic} г</b>по-малко пластмаса</div>` : ''}
          ${p.eco_chem ? `<div class="stat"><b>${p.eco_chem} г</b>по-малко химикали</div>` : ''}
        </div>` : ''}
    </section>
  </div>
  ${sec('📖 За продукта', p.description)}
  ${sec('🧽 Как се използва', p.usage)}
  ${sec('✨ Моята техника', p.technique)}
  ${sec('⚠️ Съвети и безопасност', p.tips)}
  ${p.related.length ? `<section class="card"><h2>🏫 Свързано в училището</h2>${p.related.map((r) => `<p><a href="#/school">${esc(r.title)}</a> <span class="muted small">${r.starts_at ? fmtDate(r.starts_at) : ''}</span></p>`).join('')}</section>` : ''}`;
  $('#addBtn').onclick = () => { Cart.add(p.id, Math.max(1, Number($('#qty').value) || 1)); toast('Добавено в количката 🛒'); };
  $('#watchedBtn')?.addEventListener('click', () => run(async () => {
    const r = await api('POST', '/api/me/watched', { kind: 'product', id: p.id });
    toast(r.awarded ? '+10 точки! 🎉' : 'Вече сте получили точки за това видео');
    await loadMe();
  }));
};

pages.cart = async () => {
  const prods = await products(true);
  const items = Cart.get().map((c) => ({ ...c, p: prods.find((p) => p.id === c.product_id) })).filter((c) => c.p);
  if (!items.length) { view.innerHTML = '<h1>🛒 Количка</h1><div class="card empty">Количката е празна. <a href="#/shop">Към магазина</a></div>'; return; }
  const slots = await api('GET', '/api/pickup-slots');
  const member = ME?.club?.member;
  const pct = member ? CFG.club_discount_pct : 0;
  const subtotal = items.reduce((a, c) => a + c.p.price * c.qty, 0);
  const discount = Math.round(subtotal * pct) / 100;
  const eco = items.reduce((a, c) => a + c.qty * c.p.eco_plastic, 0);
  const potential = Math.round(subtotal * CFG.club_discount_pct) / 100;
  let chosen = null;
  view.innerHTML = `<h1>🛒 Количка</h1>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Продукт</th><th>Цена</th><th>Брой</th><th class="right">Общо</th></tr></thead>
    <tbody>${items.map((c) => `<tr><td>${esc(c.p.name)}</td><td>${eur(c.p.price)}</td>
      <td><input type="number" min="0" max="99" value="${c.qty}" data-q="${c.p.id}" style="width:70px"></td><td class="right">${eur(c.p.price * c.qty)}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="right">Сума: <b>${eur(subtotal)}</b><br>
    ${member ? `⭐ Клубна отстъпка ${pct}%: <b>−${eur(discount)}</b><br>` : (CFG.club_discount_pct ? `<span class="clubprice">С клуба бихте спестили ${eur(potential)} – <a href="#/club">абонирай се</a></span><br>` : '')}
    <span class="price">За плащане при вземане: ${eur(subtotal - discount)}</span><br>
    <span class="small">🌍 С тази поръчка спестявате ${eco} г пластмаса</span></p>
  </section>
  <section class="card">
    <h2>📅 Кога ви е най-удобно да вземете поръчката?</h2>
    ${slots.length ? `<div class="slots">${slots.map((s) => `<button type="button" class="slot" data-s="${s.id}"><b>${fmtDate(s.date)}</b>
      <small>${esc([s.time_from, s.time_to].filter(Boolean).join('–') || 'по всяко време')}${s.left !== null ? ` · ${s.left} свободни` : ''}</small>
      <small>📍 ${esc(s.location || CFG.pickup_location || '')}</small>${s.note ? `<small>${esc(s.note)}</small>` : ''}</button>`).join('')}</div>`
      : '<p class="muted">В момента няма отворени дати за вземане. Моля, опитайте по-късно или се свържете с нас.</p>'}
    <label>Бележка (по желание)</label><textarea id="note" placeholder="Напр. ще дойде съпругът ми"></textarea>
    <p class="muted small">Плащането е при вземане на поръчката. Онлайн плащане няма.</p>
    ${ME ? `<button class="btn" id="orderBtn" ${slots.length ? '' : 'disabled'}>✅ Изпрати поръчката</button>` : needLogin()}
  </section>`;
  $$('[data-q]', view).forEach((i) => i.onchange = () => { Cart.qty(Number(i.dataset.q), Math.max(0, Math.min(99, Number(i.value) || 0))); render(); });
  $$('.slot', view).forEach((b) => b.onclick = () => { chosen = Number(b.dataset.s); $$('.slot', view).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#orderBtn')?.addEventListener('click', () => run(async () => {
    if (!chosen) throw new Error('Изберете ден за вземане');
    const o = await api('POST', '/api/orders', { items: Cart.get(), pickup_slot_id: chosen, note: $('#note').value });
    Cart.set([]);
    toast(`Поръчка №${o.id} е изпратена! 🎉`);
    location.hash = '#/orders';
  }));
};

const STEPS = ['ordered', 'arrived', 'delivered'];
pages.orders = async () => {
  if (!ME) { view.innerHTML = needLogin(); return; }
  const list = await api('GET', '/api/orders');
  view.innerHTML = `<h1>📦 Моите поръчки</h1>${list.length ? list.map((o) => `<section class="card">
    <div class="row"><h3 class="grow">Поръчка №${o.id}</h3><span class="tag ${o.status}">${o.status_label}</span><span class="tag ${o.paid ? 'paid' : 'unpaid'}">${o.paid ? 'Платена' : 'Неплатена'}</span></div>
    ${o.status !== 'cancelled' ? `<div class="timeline">${STEPS.map((s, i) => `<span class="${STEPS.indexOf(o.status) >= i ? 'on' : ''}">${STATUS[s]}</span>`).join('')}<span class="${o.paid ? 'on' : ''}">Платена</span></div>` : ''}
    <p class="small">📅 Вземане: <b>${fmtDate(o.pickup_date)} ${esc(o.pickup_time)}</b>${o.pickup_location ? ` · 📍 ${esc(o.pickup_location)}` : ''}</p>
    <ul class="small">${o.items.map((i) => `<li>${esc(i.name)} × ${i.qty} – ${eur(i.price * i.qty)}</li>`).join('')}</ul>
    <p class="right">${o.discount ? `<span class="small">Отстъпка ${o.discount_pct}%: −${eur(o.discount)}</span><br>` : ''}<b>${eur(o.total)}</b></p>
    ${o.status === 'ordered' ? `<button class="btn ghost sm" data-cancel="${o.id}">Откажи поръчката</button>` : ''}
  </section>`).join('') : '<div class="card empty">Нямате поръчки. <a href="#/shop">Към магазина</a></div>'}`;
  $$('[data-cancel]', view).forEach((b) => b.onclick = () => run(async () => {
    if (!confirm('Да откажем ли поръчката?')) return;
    await api('POST', `/api/orders/${b.dataset.cancel}/cancel`); toast('Поръчката е отказана'); render();
  }));
};

pages.club = async () => {
  const c = ME?.club;
  const statusBox = !ME ? needLogin()
    : c.status === 'active' ? `<section class="card ${c.expired ? 'alert red' : c.expiringSoon ? 'alert' : ''}">
        <h2>${c.expired ? '⚠️ Абонаментът ви изтече' : '⭐ Вие сте член на клуба'}</h2>
        <p>Валиден до: <b>${fmtDate(c.until)}</b>${!c.expired ? ` (още ${c.daysLeft} дни)` : ''}</p>
        ${c.expired || c.expiringSoon ? (c.requestedAt ? '<p class="tag">Заявката за подновяване е изпратена</p>' : '<button class="btn warn" id="reqBtn">Поднови абонамента</button>') : ''}
      </section>`
    : c.status === 'pending' ? `<section class="card alert"><h2>⏳ Заявката ви е получена</h2><p>Ще активираме абонамента веднага след плащане (${eur(c.price)}) – напр. при вземане на поръчка.</p></section>`
    : c.status === 'restricted' ? `<section class="card alert red"><h2>Достъпът до клуба е спрян</h2><p>Свържете се с нас, за да го възстановим.</p></section>`
    : `<section class="card"><h2>Присъедини се</h2><p>Абонаментът е <b>${eur(c.price)} на месец</b>. Заплащате при вземане на поръчка или по договорен начин – тук само заявявате.</p><button class="btn warn" id="reqBtn">⭐ Заяви абонамент</button></section>`;
  view.innerHTML = `<h1>⭐ Клуб</h1>
  <section class="card hero">
    <h2>${eur(CFG.club_price)} на месец</h2>
    <div class="stats">
      <div class="stat"><b>${CFG.club_discount_pct}%</b>отстъпка за всеки продукт</div>
      <div class="stat"><b>🎬</b>всички записи и уроци</div>
      <div class="stat"><b>🏫</b>уъркшопи само за членове</div>
      <div class="stat"><b>+50</b>точки за всеки месец</div>
    </div>
  </section>
  ${statusBox}`;
  $('#reqBtn')?.addEventListener('click', () => run(async () => { await api('POST', '/api/club/request'); await loadMe(); toast('Заявката е изпратена ⭐'); render(); }));
};

const TYPES = {
  workshop: { name: 'Уъркшоп на живо', icon: '🧑‍🏫' },
  presentation: { name: 'Онлайн презентация', icon: '💻' },
  live: { name: 'На живо в YouTube', icon: '🔴' },
  recording: { name: 'Запис', icon: '🎞️' },
};
pages.school = async () => {
  const items = await api('GET', '/api/school');
  let tab = sessionStorage.getItem('schoolTab') || '';
  const card = (s) => `<section class="card">
    <div class="row"><span class="tag">${TYPES[s.type].icon} ${TYPES[s.type].name}</span>${s.club_only ? '<span class="tag club">⭐ само за клуба</span>' : ''}${s.price ? `<span class="tag gray">${eur(s.price)}</span>` : ''}</div>
    <h3 style="margin-top:8px">${esc(s.title)}</h3>
    ${s.starts_at ? `<p class="small">📅 ${fmtDate(s.starts_at)}${s.location ? ` · 📍 ${esc(s.location)}` : ''}</p>` : ''}
    <p class="prose small">${esc(s.description)}</p>
    ${s.locked ? `<p class="clubprice">🔒 Достъпно за членове на клуба. <a href="#/club">Абонирай се</a></p>` : ''}
    ${s.video_id ? ytEmbed(s.video_id) : ''}
    ${s.link ? `<p><a class="btn light sm" href="${esc(s.link)}" target="_blank" rel="noopener">🔗 Влез в презентацията</a></p>` : ''}
    <div class="row" style="margin-top:10px">
      ${s.type !== 'recording' && !s.locked ? (s.signed ? `<span class="tag">✓ Записани сте</span><button class="btn ghost sm" data-un="${s.id}">Отпиши ме</button>`
        : s.left === 0 ? '<span class="tag gray">Няма места</span>' : `<button class="btn sm" data-sign="${s.id}">Запиши ме (+20 т.)</button>${s.left !== null ? `<span class="small muted">${s.left} свободни места</span>` : ''}`) : ''}
      ${s.video_id && ME ? `<button class="btn light sm" data-w="${s.id}">✅ Изгледах (+10 т.)</button>` : ''}
    </div>
  </section>`;
  const draw = () => {
    const list = items.filter((s) => !tab || s.type === tab);
    $('#slist').innerHTML = list.length ? list.map(card).join('') : '<div class="card empty">Няма събития в тази категория.</div>';
    $$('.tabs button', view).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    bind();
  };
  view.innerHTML = `<h1>🏫 Училище за почистване</h1>
    <p class="muted">Уъркшопи на място, онлайн презентации и излъчвания в YouTube – на живо и на запис.${CFG.youtube_channel ? ` <a href="${esc(CFG.youtube_channel)}" target="_blank" rel="noopener">▶ Нашият канал</a>` : ''}</p>
    <div class="tabs"><button data-t="">Всички</button>${Object.entries(TYPES).map(([k, t]) => `<button data-t="${k}">${t.icon} ${t.name}</button>`).join('')}</div>
    <div id="slist"></div>`;
  $$('.tabs button', view).forEach((b) => b.onclick = () => { tab = b.dataset.t; sessionStorage.setItem('schoolTab', tab); draw(); });
  function bind() {
    $$('[data-sign]', view).forEach((b) => b.onclick = () => run(async () => { if (!ME) { location.hash = '#/login'; return; } await api('POST', `/api/school/${b.dataset.sign}/signup`); toast('Записахте се! +20 точки 🎉'); render(); }));
    $$('[data-un]', view).forEach((b) => b.onclick = () => run(async () => { await api('DELETE', `/api/school/${b.dataset.un}/signup`, {}); toast('Отписахте се'); render(); }));
    $$('[data-w]', view).forEach((b) => b.onclick = () => run(async () => { const r = await api('POST', '/api/me/watched', { kind: 'school', id: Number(b.dataset.w) }); toast(r.awarded ? '+10 точки! 🎉' : 'Вече сте получили точки за това видео'); }));
  }
  draw();
};

pages.consult = async () => {
  const slots = await api('GET', '/api/consult/slots');
  const mine = ME ? await api('GET', '/api/consult/mine') : [];
  const byDate = {};
  for (const s of slots) (byDate[s.starts_at.slice(0, 10)] ||= []).push(s);
  const dates = Object.keys(byDate);
  let date = dates[0]; let chosen = null;
  const upcoming = mine.filter((m) => m.status === 'booked');
  view.innerHTML = `<h1>🤝 Консултация с мен</h1>
  <p class="muted">Изберете дата и час. Ще разгледаме вашия дом, петна и проблеми и ще ви кажа кой продукт и техника да използвате.</p>
  ${upcoming.length ? `<section class="card"><h2>Моите консултации</h2>${upcoming.map((m) => `<div class="row notif"><div class="grow"><b>${fmtDate(m.starts_at)}</b> · ${m.duration} мин · ${m.mode === 'online' ? '💻 онлайн' : '📍 на място'}<br><span class="small muted">${esc(m.topic)}</span></div><button class="btn ghost sm" data-cc="${m.id}">Откажи</button></div>`).join('')}</section>` : ''}
  <section class="card">
    ${dates.length ? `<h2>1. Изберете дата</h2><div class="slots" id="dates">${dates.map((d) => `<button type="button" class="slot" data-d="${d}"><b>${fmtDate(d)}</b><small>${byDate[d].length} свободни часа</small></button>`).join('')}</div>
      <h2 style="margin-top:16px">2. Изберете час</h2><div class="slots" id="times"></div>
      <label>3. С какво да ви помогна?</label><textarea id="topic" placeholder="Напр. котлен камък в банята, петна по дивана..."></textarea>
      ${ME ? '<button class="btn" id="bookBtn" style="margin-top:10px">Запази час</button>' : needLogin()}`
      : '<div class="empty">В момента няма свободни часове. Опитайте пак скоро.</div>'}
  </section>`;
  const drawTimes = () => {
    $$('#dates .slot').forEach((b) => b.classList.toggle('on', b.dataset.d === date));
    $('#times').innerHTML = byDate[date].map((s) => `<button type="button" class="slot ${chosen === s.id ? 'on' : ''}" data-t="${s.id}"><b>${s.starts_at.slice(11)}</b><small>${s.duration} мин · ${s.mode === 'online' ? 'онлайн' : 'на място'}</small></button>`).join('');
    $$('#times .slot').forEach((b) => b.onclick = () => { chosen = Number(b.dataset.t); drawTimes(); });
  };
  if (dates.length) { $$('#dates .slot').forEach((b) => b.onclick = () => { date = b.dataset.d; chosen = null; drawTimes(); }); drawTimes(); }
  $('#bookBtn')?.addEventListener('click', () => run(async () => {
    if (!chosen) throw new Error('Изберете час');
    await api('POST', `/api/consult/slots/${chosen}/book`, { topic: $('#topic').value }); toast('Часът е запазен! 🤝'); render();
  }));
  $$('[data-cc]', view).forEach((b) => b.onclick = () => run(async () => { if (!confirm('Да откажем ли консултацията?')) return; await api('POST', `/api/consult/slots/${b.dataset.cc}/cancel`); render(); }));
};

pages.me = async () => {
  if (!ME) { view.innerHTML = needLogin(); return; }
  const p = await api('GET', '/api/me/progress');
  const lv = p.level;
  const pctNext = lv.next ? Math.round(100 * (p.points - lv.min) / (lv.next.min - lv.min)) : 100;
  view.innerHTML = `<h1>👤 ${esc(ME.name)}</h1>
  <section class="card hero">
    <div class="row"><div style="font-size:3rem">${lv.icon}</div><div class="grow"><h2 style="margin:0">${esc(lv.name)}</h2><div>Ниво ${lv.index} · <b>${p.points}</b> точки</div></div></div>
    <div class="bar" style="margin-top:10px;background:rgba(255,255,255,.25)"><i style="width:${pctNext}%"></i></div>
    <p class="small">${lv.next ? `Още ${lv.next.need} точки до „${esc(lv.next.name)}“ ${lv.next.icon}` : 'Достигнахте най-високото ниво!'}</p>
  </section>
  <section class="card">
    <h2>🌍 Вашият принос</h2>
    <div class="stats">
      <div class="stat"><b>${eur(p.eco.money)}</b>спестени спрямо обикновени препарати</div>
      <div class="stat"><b>${eur(p.eco.clubSaved)}</b>спестени от клуба</div>
      <div class="stat"><b>${p.eco.bottles}</b>пластмасови бутилки по-малко</div>
      <div class="stat"><b>${p.eco.chem} г</b>агресивни химикали, които не дишате</div>
    </div>
    <p class="small muted">По-малко химия у дома означава по-чист въздух, по-здрава кожа и по-малко алергии.</p>
  </section>
  <section class="card"><h2>🏅 Значки</h2><div class="badges">${p.badges.map((b) => `<div class="badge ${b.ok ? 'ok' : ''}"><div class="i">${b.icon}</div><b class="small">${esc(b.name)}</b><div class="small muted">${esc(b.desc)}</div>
    ${!b.ok && b.progress ? `<div class="bar" style="margin-top:6px"><i style="width:${Math.round(100 * b.progress[0] / b.progress[1])}%"></i></div><div class="small muted">${b.progress[0]}/${b.progress[1]}</div>` : ''}</div>`).join('')}</div></section>
  <section class="card"><h2>Как се печелят точки</h2>
    <ul class="small"><li>🎬 Изгледано обучително видео – 10 т.</li><li>🛒 Поръчка – 1 т. за всяко евро, +10 при вземане</li><li>💡 Съвет на деня – 5 т. (бонус 30 т. на всеки 7 поредни дни)</li>
    <li>🏫 Записване в училището – 20 т., присъствие – 30 т.</li><li>🤝 Консултация – 15 т.</li><li>⭐ Месец в клуба – 50 т.</li><li>💬 Обратна връзка – 5 т. на ден</li></ul>
    <h3>Последни точки</h3>${p.history.map((h) => `<div class="small">+${h.points} · ${esc(h.reason)} <span class="muted">${fmtDate(h.ts)}</span></div>`).join('')}
  </section>
  <section class="card"><h2>⚙️ Профил</h2>
    <label>Име</label><input id="pName" value="${esc(ME.name)}">
    <label>Телефон</label><input id="pPhone" value="${esc(ME.phone)}">
    <label>Имейл</label><input value="${esc(ME.email)}" disabled>
    <details style="margin-top:10px"><summary>Смяна на парола</summary><label>Текуща парола</label><input type="password" id="pOld"><label>Нова парола</label><input type="password" id="pNew"></details>
    <div class="row" style="margin-top:12px"><button class="btn" id="saveBtn">Запази</button><button class="btn light" id="notifBtn">🔔 Включи известията в браузъра</button><button class="btn ghost" id="logoutBtn">Изход</button></div>
  </section>`;
  $('#saveBtn').onclick = () => run(async () => { await api('PUT', '/api/me', { name: $('#pName').value, phone: $('#pPhone').value, password: $('#pOld').value, new_password: $('#pNew').value }); await loadMe(); toast('Запазено'); });
  $('#logoutBtn').onclick = () => run(async () => { await api('POST', '/api/auth/logout'); ME = null; location.hash = '#/'; await loadMe(); render(); });
  $('#notifBtn').onclick = async () => {
    if (!('Notification' in window)) return toast('Браузърът не поддържа известия', true);
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Известията са включени 🔔' : 'Известията не са разрешени', r !== 'granted');
  };
};

pages.notifications = async () => {
  if (!ME) { view.innerHTML = needLogin(); return; }
  const r = await api('GET', '/api/notifications');
  view.innerHTML = `<div class="row"><h1 class="grow">🔔 Известия</h1>${r.unread ? '<button class="btn light sm" id="readAll">Маркирай всички като прочетени</button>' : ''}</div>
  <section class="card">${r.list.length ? r.list.map((n) => `<div class="notif ${n.read ? '' : 'unread'}"><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div>
    <div class="small muted">${fmtDate(n.created_at)} ${n.link ? `· <a href="${esc(n.link)}">Отвори</a>` : ''}</div></div>`).join('') : '<div class="empty">Нямате известия</div>'}</section>`;
  $('#readAll')?.addEventListener('click', () => run(async () => { await api('POST', '/api/notifications/read', {}); pollNotifications(); render(); }));
};

function authPage(isReg) {
  view.innerHTML = `<section class="card" style="max-width:440px;margin:20px auto">
    <h1>${isReg ? 'Регистрация' : 'Вход'}</h1>
    <form id="f">
      ${isReg ? '<label>Име и фамилия</label><input name="name" required autocomplete="name"><label>Телефон</label><input name="phone" autocomplete="tel">' : ''}
      <label>Имейл</label><input name="email" type="email" required autocomplete="email">
      <label>Парола</label><input name="password" type="password" required minlength="6" autocomplete="${isReg ? 'new-password' : 'current-password'}">
      <button class="btn" style="margin-top:14px;width:100%">${isReg ? 'Създай акаунт' : 'Влез'}</button>
    </form>
    <p class="center small">${isReg ? 'Имате акаунт? <a href="#/login">Вход</a>' : 'Нямате акаунт? <a href="#/register">Регистрация</a>'}</p>
  </section>`;
  $('#f').onsubmit = (e) => { e.preventDefault(); run(async () => {
    await api('POST', isReg ? '/api/auth/register' : '/api/auth/login', Object.fromEntries(new FormData(e.target)));
    await loadMe(); PRODUCTS = null; toast(isReg ? 'Добре дошли! +20 точки 🌱' : 'Здравейте!'); location.hash = '#/'; pollNotifications();
  }); };
}
pages.login = () => authPage(false);
pages.register = () => authPage(true);

// ---------- маршрутизатор ----------
async function render() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const page = pages[name] || pages[''];
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + (name || '')));
  try { await page(arg); } catch (e) { view.innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
(async () => {
  mountFeedback(() => ME);
  updateCartDot();
  try { await loadMe(); } catch { /* сървърът не отговаря */ }
  await render();
  pollNotifications();
  setInterval(pollNotifications, 60000);
})();
