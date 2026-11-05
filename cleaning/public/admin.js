'use strict';
// Админ панел
let ME = null;
const view = $('#view');
const pages = {};
const TYPES = { workshop: '🧑‍🏫 Уъркшоп на живо', presentation: '💻 Онлайн презентация', live: '🔴 На живо в YouTube', recording: '🎞️ Запис' };
const WDAYS = [[1, 'пн'], [2, 'вт'], [3, 'ср'], [4, 'чт'], [5, 'пт'], [6, 'сб'], [0, 'нд']];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const wdPicker = (sel = [2, 4, 6]) => `<div class="row">${WDAYS.map(([v, n]) => `<label class="check"><input type="checkbox" name="wd" value="${v}" ${sel.includes(v) ? 'checked' : ''}> ${n}</label>`).join('')}</div>`;
const formData = (f) => Object.fromEntries(new FormData(f));
const clubTag = (c) => c.status === 'active' ? (c.expired ? '<span class="tag cancelled">Изтекъл</span>' : c.expiringSoon ? `<span class="tag arrived">Изтича след ${c.daysLeft} д.</span>` : '<span class="tag club">⭐ Член</span>')
  : c.status === 'pending' ? '<span class="tag ordered">Заявка</span>' : c.status === 'restricted' ? '<span class="tag gray">Ограничен</span>' : '<span class="tag gray">—</span>';

// ---------- сигнали (известия за администратора) ----------
let lastAlert = null;
async function pollAlerts() {
  try {
    const a = await api('GET', '/api/admin/alerts');
    const n = a.expired + a.expiring + a.pending + a.newOrders + a.feedbackNew;
    const d = $('#alertDot'); d.textContent = n; d.classList.toggle('hidden', !n);
    if (lastAlert) {
      if (a.lastOrderId > lastAlert.lastOrderId) browserNotify('Нова поръчка 🛒', `Поръчка №${a.lastOrderId}`);
      if (a.expired > lastAlert.expired) browserNotify('Изтекъл абонамент', `${a.expired} членове трябва да подновят абонамента си`);
      if (a.pending > lastAlert.pending) browserNotify('Нова заявка за клуба ⭐', 'Вижте „Членове и клуб“');
      if (a.feedbackNew > lastAlert.feedbackNew) browserNotify('Нова обратна връзка 💬', '');
    }
    lastAlert = a;
  } catch { /* офлайн */ }
}

// ---------- табло ----------
pages[''] = async () => {
  const d = await api('GET', '/api/admin/dashboard');
  const mrow = (r, extra = '') => `<div class="row notif"><div class="grow"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.email)} ${esc(r.phone)}</span><br>
    <span class="small">${r.club.until ? 'До ' + fmtDate(r.club.until) : 'Няма абонамент'}</span> ${clubTag(r.club)}</div>
    <button class="btn sm" data-ext="${r.id}">+1 месец (${eur(r.club.price)})</button>${extra}</div>`;
  view.innerHTML = `<h1>Табло</h1>
  <div class="stats">
    <a class="stat" href="#/orders?status=ordered" style="text-decoration:none;color:inherit"><b>${d.orders.ordered || 0}</b>Поръчани</a>
    <a class="stat" href="#/orders?status=arrived" style="text-decoration:none;color:inherit"><b>${d.orders.arrived || 0}</b>Пристигнали</a>
    <a class="stat" href="#/orders?status=delivered" style="text-decoration:none;color:inherit"><b>${d.orders.delivered || 0}</b>Предадени</a>
    <a class="stat" href="#/orders?paid=0" style="text-decoration:none;color:inherit"><b>${d.unpaid.n}</b>Неплатени (${eur(d.unpaid.s)})</a>
    <div class="stat"><b>${eur(d.paidMonth)}</b>Платени поръчки този месец</div>
    <div class="stat"><b>${eur(d.clubMonth)}</b>Клуб този месец</div>
    <div class="stat"><b>${d.members}</b>Активни членове</div>
    <div class="stat"><b>${d.users}</b>Клиенти</div>
  </div>
  ${d.unpaidDelivered ? `<section class="card alert red" style="margin-top:14px">⚠️ <b>${d.unpaidDelivered}</b> предадени поръчки не са отбелязани като платени. <a href="#/orders?status=delivered&paid=0">Виж</a></section>` : ''}

  <section class="card alert red" style="margin-top:14px">
    <div class="row"><h2 class="grow">⏰ Изтекли абонаменти – трябва да се подновят (${d.expired.length})</h2>
      ${d.expired.length ? '<button class="btn light sm" id="remindAll">📣 Напомни на всички</button><button class="btn ghost sm" id="restrictAll">🔒 Ограничи всички изтекли</button>' : ''}</div>
    ${d.expired.length ? d.expired.map((r) => mrow(r, `<button class="btn light sm" data-rem="${r.id}">Напомни</button><button class="btn ghost sm" data-res="${r.id}">Ограничи</button>`)).join('') : '<p class="muted">Няма изтекли абонаменти 👍</p>'}
  </section>
  <section class="card alert">
    <h2>⌛ Изтичат скоро (${d.expiring.length})</h2>
    ${d.expiring.length ? d.expiring.map((r) => mrow(r, `<button class="btn light sm" data-rem="${r.id}">Напомни</button>`)).join('') : '<p class="muted">Няма.</p>'}
  </section>
  <section class="card">
    <h2>⭐ Заявки за клуба (${d.pending.length})</h2>
    ${d.pending.length ? d.pending.map((r) => mrow(r, `<button class="btn ghost sm" data-cancel="${r.id}">Откажи</button>`)).join('') : '<p class="muted">Няма нови заявки.</p>'}
  </section>
  <div class="grid two" style="margin-top:14px">
    <section class="card"><h2>📦 За вземане днес</h2>${d.todayPickups.length ? d.todayPickups.map((o) => `<div class="notif"><b>№${o.id}</b> ${esc(o.user.name)} · ${esc(o.pickup_time)} · ${eur(o.total)} <span class="tag ${o.status}">${STATUS[o.status]}</span></div>`).join('') : '<p class="muted">Няма.</p>'}<a href="#/orders?date=${todayStr()}">Всички за днес →</a></section>
    <section class="card"><h2>🤝 Предстоящи консултации</h2>${d.consults.length ? d.consults.map((c) => `<div class="notif"><b>${fmtDate(c.starts_at)}</b> · ${esc(c.name)} <span class="small muted">${esc(c.phone || c.email)}</span><br><span class="small">${esc(c.topic)}</span></div>`).join('') : '<p class="muted">Няма.</p>'}</section>
    <section class="card"><h2>🏫 Предстоящи събития</h2>${d.school.length ? d.school.map((s) => `<div class="notif"><b>${esc(s.title)}</b><br><span class="small">${fmtDate(s.starts_at)} · ${s.cnt} записани${s.seats ? ' от ' + s.seats : ''}</span></div>`).join('') : '<p class="muted">Няма.</p>'}</section>
    <section class="card"><h2>💬 Нова обратна връзка</h2><p><b>${d.feedbackNew}</b> непрочетени</p><a href="#/feedback">Към обратната връзка →</a></section>
  </div>
  <p class="small muted" style="margin-top:14px"><button class="btn light sm" id="bnBtn">🔔 Включи известията в браузъра</button> – ще ви известяваме за нови поръчки, заявки и изтекли абонаменти, докато панелът е отворен.</p>`;
  bindClubButtons(() => render());
  $('#remindAll')?.addEventListener('click', () => run(async () => { const r = await api('POST', '/api/admin/club/remind-expired'); toast(`Изпратени напомняния: ${r.sent}`); }));
  $('#restrictAll')?.addEventListener('click', () => run(async () => { if (!confirm('Да ограничим ли достъпа на всички с изтекъл абонамент?')) return; const r = await api('POST', '/api/admin/club/restrict-expired'); toast(`Ограничени: ${r.restricted}`); render(); }));
  $('#bnBtn').onclick = async () => { if ('Notification' in window) toast((await Notification.requestPermission()) === 'granted' ? 'Включено 🔔' : 'Не е разрешено'); };
};

function bindClubButtons(after) {
  const act = (id, body, msg) => run(async () => { await api('POST', `/api/admin/users/${id}/club`, body); toast(msg); after(); pollAlerts(); });
  $$('[data-ext]', view).forEach((b) => b.onclick = () => extendDialog(Number(b.dataset.ext), after));
  $$('[data-rem]', view).forEach((b) => b.onclick = () => act(b.dataset.rem, { action: 'remind' }, 'Напомнянето е изпратено'));
  $$('[data-res]', view).forEach((b) => b.onclick = () => act(b.dataset.res, { action: 'restrict' }, 'Достъпът е ограничен'));
  $$('[data-restore]', view).forEach((b) => b.onclick = () => act(b.dataset.restore, { action: 'restore' }, 'Достъпът е възстановен'));
  $$('[data-cancel]', view).forEach((b) => b.onclick = () => act(b.dataset.cancel, { action: 'cancel' }, 'Заявката е отказана'));
}
function extendDialog(id, after) {
  modal(`<h2>Подновяване / активиране на абонамент</h2>
    <form id="ef"><label>Месеци</label><input name="months" type="number" min="1" max="24" value="1">
    <label>Платена сума (€) – празно = по цената на клуба</label><input name="amount" type="number" step="0.01" min="0">
    <label>Бележка</label><input name="note" placeholder="напр. платено в брой">
    <div class="row" style="margin-top:12px"><button class="btn">Потвърди плащането</button><button type="button" class="btn ghost" data-close>Отказ</button></div></form>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <form id="uf"><label>…или задай ръчно „валиден до“</label><div class="row"><input name="until" type="date" class="grow" required><button class="btn light">Задай</button></div></form>`,
  (m, close) => {
    $('#ef', m).onsubmit = (e) => { e.preventDefault(); run(async () => { await api('POST', `/api/admin/users/${id}/club`, { action: 'extend', ...formData(e.target) }); close(); toast('Абонаментът е активен ⭐'); after(); pollAlerts(); }); };
    $('#uf', m).onsubmit = (e) => { e.preventDefault(); run(async () => { await api('POST', `/api/admin/users/${id}/club`, { action: 'set_until', ...formData(e.target) }); close(); toast('Запазено'); after(); pollAlerts(); }); };
  });
}

// ---------- поръчки ----------
pages.orders = async (_, q) => {
  const f = { status: q.get('status') || '', paid: q.get('paid') || '', date: q.get('date') || '', q: q.get('q') || '' };
  const list = await api('GET', '/api/admin/orders?' + new URLSearchParams(f));
  const slots = await api('GET', '/api/admin/pickup-slots');
  const sel = new Set();
  const totals = list.reduce((a, o) => { a[o.status] = (a[o.status] || 0) + 1; if (!o.paid && o.status !== 'cancelled') a.unpaid++; return a; }, { unpaid: 0 });
  view.innerHTML = `<h1>📦 Поръчки</h1>
  <section class="card">
    <form class="row" id="flt">
      <select name="status" style="width:auto"><option value="">Всички статуси</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select name="paid" style="width:auto"><option value="">Платени и неплатени</option><option value="1" ${f.paid === '1' ? 'selected' : ''}>Платени</option><option value="0" ${f.paid === '0' ? 'selected' : ''}>Неплатени</option></select>
      <select name="date" style="width:auto"><option value="">Всички дати за вземане</option>${[...new Set(slots.map((s) => s.date))].map((d) => `<option value="${d}" ${f.date === d ? 'selected' : ''}>${fmtDate(d)}</option>`).join('')}</select>
      <input name="q" placeholder="Име, телефон, №" value="${esc(f.q)}" style="width:auto" class="grow">
      <button class="btn sm">Филтрирай</button>
    </form>
    <p class="small muted">Показани: ${list.length} · Поръчани ${totals.ordered || 0} · Пристигнали ${totals.arrived || 0} · Предадени ${totals.delivered || 0} · Неплатени ${totals.unpaid}</p>
  </section>
  <section class="card">
    <div class="tablewrap"><table>
      <thead><tr><th><input type="checkbox" id="all" title="Избери всички"></th><th>№</th><th>Клиент</th><th>Вземане</th><th>Продукти</th><th class="right">Сума</th><th>Статус</th><th>Плащане</th><th></th></tr></thead>
      <tbody>${list.map((o) => `<tr data-id="${o.id}">
        <td><input type="checkbox" class="ck" value="${o.id}"></td>
        <td><b>${o.id}</b><div class="small muted">${fmtDate(o.created_at.slice(0, 10))}</div></td>
        <td>${esc(o.user.name)}<div class="small muted">${esc(o.user.phone || o.user.email)}</div></td>
        <td>${fmtDate(o.pickup_date)}<div class="small muted">${esc(o.pickup_time)}</div></td>
        <td class="small">${o.items.map((i) => `${esc(i.name)} ×${i.qty}`).join('<br>')}${o.note ? `<div class="muted">📝 ${esc(o.note)}</div>` : ''}</td>
        <td class="right"><b>${eur(o.total)}</b>${o.discount ? `<div class="small clubprice">⭐ −${o.discount_pct}%</div>` : ''}</td>
        <td><span class="tag ${o.status}">${STATUS[o.status]}</span></td>
        <td><span class="tag ${o.paid ? 'paid' : 'unpaid'}">${o.paid ? 'Платена' : 'Неплатена'}</span></td>
        <td><button class="btn light sm" data-open="${o.id}">⋯</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Няма поръчки</td></tr>'}</tbody>
    </table></div>
    <div class="sticky-actions row">
      <b id="selN">Избрани: 0</b>
      <span class="small muted">Смени на:</span>
      <button class="btn sm" data-bulk="ordered">Поръчана</button>
      <button class="btn sm warn" data-bulk="arrived">📦 Пристигнала</button>
      <button class="btn sm" data-bulk="delivered">🤝 Предадена</button>
      <button class="btn sm light" data-paid="1">💶 Платена</button>
      <button class="btn sm ghost" data-paid="0">Неплатена</button>
      <button class="btn sm danger" data-bulk="cancelled">Отказана</button>
    </div>
  </section>`;
  const upd = () => { $('#selN').textContent = `Избрани: ${sel.size}`; $$('tr[data-id]', view).forEach((tr) => tr.classList.toggle('sel', sel.has(Number(tr.dataset.id)))); };
  $$('.ck', view).forEach((c) => c.onchange = () => { c.checked ? sel.add(Number(c.value)) : sel.delete(Number(c.value)); upd(); });
  $('#all').onchange = (e) => { $$('.ck', view).forEach((c) => { c.checked = e.target.checked; c.checked ? sel.add(Number(c.value)) : sel.delete(Number(c.value)); }); upd(); };
  const bulk = (body, label) => run(async () => {
    if (!sel.size) throw new Error('Изберете поръчки с отметките отляво');
    if (body.status === 'cancelled' && !confirm(`Да откажем ли ${sel.size} поръчки?`)) return;
    const r = await api('POST', '/api/admin/orders/bulk', { ids: [...sel], ...body });
    toast(`${label}: променени ${r.changed}`); render();
  });
  $$('[data-bulk]', view).forEach((b) => b.onclick = () => bulk({ status: b.dataset.bulk }, STATUS[b.dataset.bulk]));
  $$('[data-paid]', view).forEach((b) => b.onclick = () => bulk({ paid: b.dataset.paid === '1' }, b.dataset.paid === '1' ? 'Платени' : 'Неплатени'));
  $('#flt').onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(Object.entries(formData(e.target)).filter(([, v]) => v)); location.hash = '#/orders' + (p.toString() ? '?' + p : ''); };
  $$('[data-open]', view).forEach((b) => b.onclick = () => {
    const o = list.find((x) => x.id === Number(b.dataset.open));
    modal(`<h2>Поръчка №${o.id}</h2>
      <p><b>${esc(o.user.name)}</b> · ${esc(o.user.email)} · ${esc(o.user.phone)}</p>
      <ul>${o.items.map((i) => `<li>${esc(i.name)} × ${i.qty} – ${eur(i.price * i.qty)}</li>`).join('')}</ul>
      <p>Сума ${eur(o.subtotal)}${o.discount ? ` − отстъпка ${eur(o.discount)}` : ''} = <b>${eur(o.total)}</b></p>
      ${o.note ? `<p>📝 ${esc(o.note)}</p>` : ''}
      <label>Дата за вземане</label><select id="oslot">${slots.map((s) => `<option value="${s.id}" ${s.id === o.pickup_slot_id ? 'selected' : ''}>${fmtDate(s.date)} ${esc([s.time_from, s.time_to].filter(Boolean).join('–'))}${s.active ? '' : ' (неактивна)'}</option>`).join('')}</select>
      <label>Вътрешна бележка</label><textarea id="onote">${esc(o.admin_note)}</textarea>
      <h3>История</h3>${o.log.map((l) => `<div class="small">${fmtDate(l.ts)} – ${esc(l.change)}</div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="btn" id="osave">Запази</button><button class="btn ghost" data-close>Затвори</button></div>`,
    (m, close) => { $('#osave', m).onclick = () => run(async () => { await api('PUT', `/api/admin/orders/${o.id}`, { pickup_slot_id: Number($('#oslot', m).value), admin_note: $('#onote', m).value }); close(); toast('Запазено'); render(); }); });
  });
};

// ---------- дати за вземане ----------
pages.pickup = async () => {
  const list = await api('GET', '/api/admin/pickup-slots');
  const s = await api('GET', '/api/admin/settings');
  view.innerHTML = `<h1>📅 Дати за вземане на поръчки</h1>
  <p class="muted">Клиентите избират от тези дати в количката. Капацитет 0 = без ограничение.</p>
  <div class="grid two">
    <section class="card"><h2>Добави дата</h2><form id="one">
      <label>Дата</label><input type="date" name="date" required min="${todayStr()}">
      <div class="row"><div class="grow"><label>От</label><input type="time" name="time_from" value="17:00"></div><div class="grow"><label>До</label><input type="time" name="time_to" value="19:00"></div></div>
      <label>Място</label><input name="location" value="${esc(s.pickup_location)}">
      <label>Максимум поръчки</label><input type="number" name="capacity" value="0" min="0">
      <label>Бележка</label><input name="note">
      <button class="btn" style="margin-top:10px">Добави</button></form></section>
    <section class="card"><h2>Добави много дати наведнъж</h2><form id="gen">
      <div class="row"><div class="grow"><label>От дата</label><input type="date" name="from" value="${todayStr()}" required></div><div class="grow"><label>До дата</label><input type="date" name="to" value="${plusDays(30)}" required></div></div>
      <label>Дни от седмицата</label>${wdPicker()}
      <div class="row"><div class="grow"><label>От</label><input type="time" name="time_from" value="17:00"></div><div class="grow"><label>До</label><input type="time" name="time_to" value="19:00"></div></div>
      <label>Място</label><input name="location" value="${esc(s.pickup_location)}">
      <label>Максимум поръчки на дата</label><input type="number" name="capacity" value="0" min="0">
      <button class="btn" style="margin-top:10px">Създай датите</button></form></section>
  </div>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Дата</th><th>Час</th><th>Място</th><th>Поръчки</th><th>Активна</th><th></th></tr></thead>
    <tbody>${list.map((x) => `<tr><td><b>${fmtDate(x.date)}</b>${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</td><td>${esc([x.time_from, x.time_to].filter(Boolean).join('–'))}</td><td class="small">${esc(x.location)}</td>
      <td>${x.taken}${x.capacity ? ' / ' + x.capacity : ''} ${x.taken ? `<a class="small" href="#/orders?date=${x.date}">виж</a>` : ''}</td>
      <td><input type="checkbox" data-act="${x.id}" ${x.active ? 'checked' : ''}></td>
      <td class="row"><button class="btn light sm" data-edit="${x.id}">Редакция</button><button class="btn ghost sm" data-del="${x.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Няма дати</td></tr>'}</tbody>
  </table></div></section>`;
  $('#one').onsubmit = (e) => { e.preventDefault(); run(async () => { await api('POST', '/api/admin/pickup-slots', formData(e.target)); toast('Добавено'); render(); }); };
  $('#gen').onsubmit = (e) => { e.preventDefault(); run(async () => {
    const r = await api('POST', '/api/admin/pickup-slots/generate', { ...formData(e.target), weekdays: $$('[name=wd]:checked', e.target).map((c) => Number(c.value)) });
    toast(`Създадени дати: ${r.created}`); render();
  }); };
  $$('[data-act]', view).forEach((c) => c.onchange = () => run(async () => { const x = list.find((y) => y.id === Number(c.dataset.act)); await api('PUT', `/api/admin/pickup-slots/${x.id}`, { ...x, active: c.checked ? 1 : 0 }); toast('Запазено'); }));
  $$('[data-del]', view).forEach((b) => b.onclick = () => run(async () => { if (!confirm('Да изтрием ли датата?')) return; const r = await api('DELETE', `/api/admin/pickup-slots/${b.dataset.del}`, {}); toast(r.deactivated ? 'Има поръчки за тази дата – само я скрихме' : 'Изтрита'); render(); }));
  $$('[data-edit]', view).forEach((b) => b.onclick = () => {
    const x = list.find((y) => y.id === Number(b.dataset.edit));
    modal(`<h2>Редакция на дата</h2><form id="ed">
      <label>Дата</label><input type="date" name="date" value="${x.date}" required>
      <div class="row"><div class="grow"><label>От</label><input type="time" name="time_from" value="${x.time_from}"></div><div class="grow"><label>До</label><input type="time" name="time_to" value="${x.time_to}"></div></div>
      <label>Място</label><input name="location" value="${esc(x.location)}"><label>Максимум поръчки</label><input type="number" name="capacity" value="${x.capacity}" min="0">
      <label>Бележка</label><input name="note" value="${esc(x.note)}"><label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Активна</label>
      <div class="row"><button class="btn">Запази</button><button type="button" class="btn ghost" data-close>Отказ</button></div></form>`,
    (m, close) => { $('#ed', m).onsubmit = (e) => { e.preventDefault(); run(async () => { const d = formData(e.target); await api('PUT', `/api/admin/pickup-slots/${x.id}`, { ...d, active: d.active ? 1 : 0 }); close(); toast('Запазено'); render(); }); }; });
  });
};

// ---------- членове / акаунти ----------
pages.members = async (_, q) => {
  const filter = q.get('filter') || ''; const search = q.get('q') || '';
  const list = await api('GET', '/api/admin/users?' + new URLSearchParams({ filter, q: search }));
  const F = [['', 'Всички'], ['members', '⭐ Членове'], ['pending', 'Заявки'], ['expiring', 'Изтичат скоро'], ['expired', 'Изтекли'], ['restricted', 'Ограничени']];
  view.innerHTML = `<h1>👥 Членове и клуб</h1>
  <div class="tabs">${F.map(([k, n]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <section class="card"><form class="row" id="sf"><input name="q" placeholder="Търси по име, имейл, телефон" value="${esc(search)}" class="grow"><button class="btn sm">Търси</button></form></section>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Клиент</th><th>Клуб</th><th>Валиден до</th><th>Точки</th><th>Поръчки</th><th>Действия</th></tr></thead>
    <tbody>${list.map((u) => `<tr><td><b>${esc(u.name)}</b> ${u.role === 'admin' ? '<span class="tag">админ</span>' : ''}${u.blocked ? '<span class="tag cancelled">спрян</span>' : ''}<div class="small muted">${esc(u.email)} ${esc(u.phone)}</div></td>
      <td>${clubTag(u.club)}</td><td>${u.club.until ? fmtDate(u.club.until) : '—'}</td><td>${u.points}</td><td>${u.orders}</td>
      <td><div class="row">
        <button class="btn sm" data-ext="${u.id}">+ месец</button>
        ${u.club.status === 'active' ? `<button class="btn light sm" data-rem="${u.id}">Напомни</button><button class="btn ghost sm" data-res="${u.id}">🔒 Ограничи</button>` : ''}
        ${u.club.status === 'restricted' ? `<button class="btn light sm" data-restore="${u.id}">🔓 Възстанови</button>` : ''}
        ${u.club.status === 'pending' ? `<button class="btn ghost sm" data-cancel="${u.id}">Откажи заявката</button>` : ''}
        <button class="btn light sm" data-user="${u.id}">Акаунт</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Няма резултати</td></tr>'}</tbody>
  </table></div></section>`;
  const go = (p) => { const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v)); location.hash = '#/members' + (s.toString() ? '?' + s : ''); };
  $$('[data-f]', view).forEach((b) => b.onclick = () => go({ filter: b.dataset.f, q: search }));
  $('#sf').onsubmit = (e) => { e.preventDefault(); go({ filter, q: formData(e.target).q }); };
  bindClubButtons(() => render());
  $$('[data-user]', view).forEach((b) => b.onclick = () => run(async () => {
    const u = await api('GET', `/api/admin/users/${b.dataset.user}`);
    modal(`<h2>${esc(u.name)}</h2><p class="small muted">Регистриран: ${fmtDate(u.created_at.slice(0, 10))} · ${u.points} точки · спестил ${eur(u.eco.money)}, ${u.eco.plastic} г пластмаса</p>
      <form id="uf"><label>Име</label><input name="name" value="${esc(u.name)}"><label>Телефон</label><input name="phone" value="${esc(u.phone)}">
      <label>Роля</label><select name="role"><option value="customer">Клиент</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Администратор</option></select>
      <label class="check"><input type="checkbox" name="blocked" ${u.blocked ? 'checked' : ''}> Спрян акаунт (не може да влиза)</label>
      <label>Нова парола (по желание)</label><input name="password" type="text" autocomplete="off">
      <label>Бележка (вижда се само от вас)</label><textarea name="admin_note">${esc(u.admin_note)}</textarea>
      <div class="row"><button class="btn">Запази</button><button type="button" class="btn ghost" data-close>Затвори</button></div></form>
      <h3 style="margin-top:16px">Плащания за клуба</h3>${u.payments.length ? u.payments.map((p) => `<div class="small">${fmtDate(p.created_at.slice(0, 10))} – ${eur(p.amount)} за ${p.months} мес. (${fmtDate(p.from_date)} → ${fmtDate(p.to_date)}) ${esc(p.note)}</div>`).join('') : '<p class="small muted">Няма</p>'}
      <h3>Поръчки</h3>${u.orders.map((o) => `<div class="small">№${o.id} · ${eur(o.total)} · <span class="tag ${o.status}">${STATUS[o.status]}</span> ${o.paid ? '<span class="tag paid">Платена</span>' : ''}</div>`).join('') || '<p class="small muted">Няма</p>'}`,
    (m, close) => { $('#uf', m).onsubmit = (e) => { e.preventDefault(); run(async () => { const d = formData(e.target); await api('PUT', `/api/admin/users/${u.id}`, { ...d, blocked: !!d.blocked }); close(); toast('Запазено'); render(); }); }; });
  }));
};

// ---------- продукти ----------
pages.products = async () => {
  const list = await api('GET', '/api/admin/products');
  view.innerHTML = `<div class="row"><h1 class="grow">🧴 Продукти</h1><button class="btn" id="newP">+ Нов продукт</button></div>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th></th><th>Продукт</th><th>Категория</th><th>Цена</th><th>Видео</th><th>Еко</th><th>Активен</th><th></th></tr></thead>
    <tbody>${list.map((p) => `<tr><td style="font-size:1.6rem">${/^(https?:|\/)/.test(p.image) ? '🖼️' : esc(p.image)}</td><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.short)}</div></td><td>${esc(p.category)}</td><td>${eur(p.price)}</td>
      <td>${p.video_id ? '✅' : '—'}</td><td class="small">${eur(p.eco_money)} · ${p.eco_plastic} г · ${p.eco_chem} г</td><td>${p.active ? '✅' : '—'}</td>
      <td class="row"><button class="btn light sm" data-edit="${p.id}">Редакция</button><button class="btn ghost sm" data-del="${p.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Няма продукти</td></tr>'}</tbody>
  </table></div></section>`;
  const form = (p = { active: 1, image: '🧴' }) => modal(`<h2>${p.id ? 'Редакция' : 'Нов продукт'}</h2><form id="pf">
    <label>Име</label><input name="name" value="${esc(p.name)}" required>
    <div class="row"><div class="grow"><label>Категория</label><input name="category" value="${esc(p.category)}" placeholder="Кухня, Баня, Пране..."></div><div style="width:130px"><label>Цена (€)</label><input name="price" type="number" step="0.01" min="0" value="${p.price ?? ''}" required></div></div>
    <label>Снимка: емоджи или адрес на изображение</label><input name="image" value="${esc(p.image)}">
    <label>Кратко описание</label><input name="short" value="${esc(p.short)}">
    <label>Описание</label><textarea name="description">${esc(p.description)}</textarea>
    <label>🧽 Как се използва</label><textarea name="usage">${esc(p.usage)}</textarea>
    <label>✨ Моята техника (от опита ми)</label><textarea name="technique">${esc(p.technique)}</textarea>
    <label>⚠️ Съвети и безопасност</label><textarea name="tips">${esc(p.tips)}</textarea>
    <label>🎬 Обучително видео (линк от YouTube)</label><input name="video_url" value="${esc(p.video_url)}" placeholder="https://youtu.be/...">
    <p class="small muted">Еко ефект на 1 брой спрямо обикновен препарат – показва се на клиентите като спестявания:</p>
    <div class="row"><div class="grow"><label>Спестени €</label><input name="eco_money" type="number" step="0.01" min="0" value="${p.eco_money ?? 0}"></div><div class="grow"><label>Пластмаса (г)</label><input name="eco_plastic" type="number" min="0" value="${p.eco_plastic ?? 0}"></div><div class="grow"><label>Химикали (г)</label><input name="eco_chem" type="number" min="0" value="${p.eco_chem ?? 0}"></div></div>
    <div class="row"><div style="width:120px"><label>Ред</label><input name="sort" type="number" value="${p.sort ?? 0}"></div><label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Показва се в магазина</label></div>
    <div class="row" style="margin-top:12px"><button class="btn">Запази</button><button type="button" class="btn ghost" data-close>Отказ</button></div></form>`,
  (m, close) => { $('#pf', m).onsubmit = (e) => { e.preventDefault(); run(async () => { const d = formData(e.target); d.active = d.active ? 1 : 0; await api(p.id ? 'PUT' : 'POST', '/api/admin/products' + (p.id ? '/' + p.id : ''), d); close(); toast('Запазено'); render(); }); }; });
  $('#newP').onclick = () => form();
  $$('[data-edit]', view).forEach((b) => b.onclick = () => form(list.find((p) => p.id === Number(b.dataset.edit))));
  $$('[data-del]', view).forEach((b) => b.onclick = () => run(async () => { if (!confirm('Да изтрием ли продукта?')) return; const r = await api('DELETE', '/api/admin/products/' + b.dataset.del, {}); toast(r.deactivated ? 'Има поръчки с продукта – само го скрихме' : 'Изтрит'); render(); }));
};

// ---------- училище ----------
pages.school = async () => {
  const [list, prods] = await Promise.all([api('GET', '/api/admin/school'), api('GET', '/api/admin/products')]);
  view.innerHTML = `<div class="row"><h1 class="grow">🏫 Училище</h1><button class="btn" id="newS">+ Ново</button></div>
  <p class="muted">Уъркшопи на място, онлайн презентации, излъчвания на живо и записи в YouTube.</p>
  ${list.map((s) => `<section class="card"><div class="row"><span class="tag">${TYPES[s.type]}</span>${s.club_only ? '<span class="tag club">⭐ само клуб</span>' : ''}${s.active ? '' : '<span class="tag gray">скрито</span>'}
    <h3 class="grow" style="margin:0">${esc(s.title)}</h3><button class="btn light sm" data-edit="${s.id}">Редакция</button><button class="btn ghost sm" data-del="${s.id}">✕</button></div>
    <p class="small">${s.starts_at ? fmtDate(s.starts_at) : ''} ${esc(s.location)} · ${s.signups.length} записани${s.seats ? ' от ' + s.seats : ''}</p>
    ${s.signups.length ? `<details><summary>Записани</summary>${s.signups.map((x) => `<label class="check"><input type="checkbox" data-att="${s.id}" data-u="${x.user_id}" ${x.attended ? 'checked' : ''}> ${esc(x.name)} <span class="small muted">${esc(x.phone || x.email)}</span></label>`).join('')}<p class="small muted">Отметнете присъствалите – получават 30 точки.</p></details>` : ''}
  </section>`).join('') || '<div class="card empty">Още няма събития</div>'}`;
  const form = (s = { type: 'workshop', active: 1 }) => modal(`<h2>${s.id ? 'Редакция' : 'Ново в училището'}</h2><form id="sf">
    <label>Вид</label><select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label>Заглавие</label><input name="title" value="${esc(s.title)}" required>
    <label>Описание</label><textarea name="description">${esc(s.description)}</textarea>
    <label>Дата и час (за запис – по желание)</label><input type="datetime-local" name="starts_at" value="${esc((s.starts_at || '').replace(' ', 'T'))}">
    <label>Място (за уъркшоп)</label><input name="location" value="${esc(s.location)}">
    <label>YouTube линк (на живо или запис)</label><input name="youtube_url" value="${esc(s.youtube_url)}" placeholder="https://youtube.com/live/...">
    <label>Линк за онлайн презентация (Zoom, Meet…) – вижда се само от записаните</label><input name="link" value="${esc(s.link)}">
    <div class="row"><div class="grow"><label>Места (0 = без ограничение)</label><input type="number" name="seats" min="0" value="${s.seats ?? 0}"></div><div class="grow"><label>Цена (€, плаща се на място)</label><input type="number" name="price" step="0.01" min="0" value="${s.price ?? 0}"></div></div>
    <label>Свързан продукт</label><select name="product_id"><option value="">—</option>${prods.map((p) => `<option value="${p.id}" ${s.product_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" name="club_only" ${s.club_only ? 'checked' : ''}> ⭐ Само за членове на клуба</label>
    <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Показва се</label>
    ${s.id ? '' : '<label class="check"><input type="checkbox" name="announce" checked> 📣 Изпрати известие до клиентите</label>'}
    <div class="row"><button class="btn">Запази</button><button type="button" class="btn ghost" data-close>Отказ</button></div></form>`,
  (m, close) => { $('#sf', m).onsubmit = (e) => { e.preventDefault(); run(async () => {
    const d = formData(e.target); d.club_only = !!d.club_only; d.active = d.active ? 1 : 0; d.announce = !!d.announce;
    await api(s.id ? 'PUT' : 'POST', '/api/admin/school' + (s.id ? '/' + s.id : ''), d); close(); toast('Запазено'); render();
  }); }; });
  $('#newS').onclick = () => form();
  $$('[data-edit]', view).forEach((b) => b.onclick = () => form(list.find((s) => s.id === Number(b.dataset.edit))));
  $$('[data-del]', view).forEach((b) => b.onclick = () => run(async () => { if (!confirm('Да изтрием ли?')) return; await api('DELETE', '/api/admin/school/' + b.dataset.del, {}); render(); }));
  $$('[data-att]', view).forEach((c) => c.onchange = () => run(async () => { await api('POST', `/api/admin/school/${c.dataset.att}/attended`, { user_id: Number(c.dataset.u), attended: c.checked }); toast('Запазено'); }));
};

// ---------- консултации ----------
pages.consult = async () => {
  const list = await api('GET', '/api/admin/consult');
  const ST = { free: 'Свободен', booked: 'Запазен', done: 'Проведена', cancelled: 'Отменена' };
  const CL = { free: 'gray', booked: 'ordered', done: 'delivered', cancelled: 'cancelled' };
  view.innerHTML = `<h1>🤝 Консултации</h1>
  <section class="card"><h2>Отвори свободни часове</h2><form id="gen">
    <div class="row"><div class="grow"><label>От дата</label><input type="date" name="from" value="${todayStr()}" required></div><div class="grow"><label>До дата</label><input type="date" name="to" value="${plusDays(14)}" required></div></div>
    <label>Дни от седмицата</label>${wdPicker([1, 2, 3, 4, 5])}
    <label>Часове (разделени със запетая)</label><input name="times" value="10:00, 11:00, 16:00, 17:00">
    <div class="row"><div class="grow"><label>Продължителност (мин)</label><input type="number" name="duration" value="30" min="5"></div>
    <div class="grow"><label>Начин</label><select name="mode"><option value="online">Онлайн</option><option value="onsite">На място</option></select></div></div>
    <button class="btn" style="margin-top:10px">Създай часовете</button></form></section>
  <section class="card"><div class="tablewrap"><table>
    <thead><tr><th>Дата и час</th><th>Начин</th><th>Статус</th><th>Клиент</th><th>Тема</th><th></th></tr></thead>
    <tbody>${list.map((c) => `<tr><td><b>${fmtDate(c.starts_at)}</b><div class="small muted">${c.duration} мин</div></td><td>${c.mode === 'online' ? '💻 онлайн' : '📍 на място'}</td>
      <td><span class="tag ${CL[c.status]}">${ST[c.status]}</span></td><td>${c.name ? `${esc(c.name)}<div class="small muted">${esc(c.phone || '')} ${esc(c.email || '')}</div>` : '—'}</td><td class="small">${esc(c.topic)}</td>
      <td class="row">${c.status === 'booked' ? `<button class="btn sm" data-st="done" data-id="${c.id}">Проведена</button><button class="btn ghost sm" data-st="cancelled" data-id="${c.id}">Отмени</button>` : ''}
      ${c.status === 'free' ? `<button class="btn ghost sm" data-del="${c.id}">✕</button>` : ''}${c.status === 'cancelled' ? `<button class="btn light sm" data-st="free" data-id="${c.id}">Освободи</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Няма часове</td></tr>'}</tbody>
  </table></div></section>`;
  $('#gen').onsubmit = (e) => { e.preventDefault(); run(async () => { const r = await api('POST', '/api/admin/consult/generate', { ...formData(e.target), weekdays: $$('[name=wd]:checked', e.target).map((c) => Number(c.value)) }); toast(`Създадени часове: ${r.created}`); render(); }); };
  $$('[data-st]', view).forEach((b) => b.onclick = () => run(async () => {
    let note;
    if (b.dataset.st === 'cancelled') { note = prompt('Причина (ще я види клиентът):', ''); if (note === null) return; }
    await api('PUT', `/api/admin/consult/${b.dataset.id}`, { status: b.dataset.st, admin_note: note }); render();
  }));
  $$('[data-del]', view).forEach((b) => b.onclick = () => run(async () => { await api('DELETE', `/api/admin/consult/${b.dataset.del}`, {}); render(); }));
};

// ---------- известия ----------
pages.notify = async () => {
  const list = await api('GET', '/api/admin/notify');
  view.innerHTML = `<h1>📣 Известия до клиентите</h1>
  <section class="card"><form id="nf">
    <label>До</label><select name="audience"><option value="all">Всички клиенти</option><option value="club">Само членовете на клуба</option></select>
    <label>Заглавие</label><input name="title" required placeholder="Напр. Нов продукт: еко препарат за баня 🌿">
    <label>Текст</label><textarea name="body" placeholder="Напр. Със сменяемата бутилка спестявате 120 г пластмаса всеки месец!"></textarea>
    <label>Връзка в приложението (по желание)</label><select name="link"><option value="">—</option><option value="#/shop">Магазин</option><option value="#/school">Училище</option><option value="#/club">Клуб</option><option value="#/consult">Консултации</option><option value="#/me">Профил</option></select>
    <button class="btn" style="margin-top:10px">Изпрати</button></form>
    <p class="small muted">Автоматично се изпращат и: потвърждение на поръчка, „поръчката пристигна“, „предадена“, изтичащ/изтекъл абонамент, записване в училището, консултации, нови нива.</p></section>
  <section class="card"><h2>Изпратени</h2>${list.map((n) => `<div class="notif"><b>${esc(n.title)}</b> <span class="tag ${n.audience === 'club' ? 'club' : 'gray'}">${n.audience === 'club' ? 'клуб' : 'всички'}</span><div class="small">${esc(n.body)}</div><div class="small muted">${fmtDate(n.created_at)}</div></div>`).join('') || '<p class="muted">Няма</p>'}</section>`;
  $('#nf').onsubmit = (e) => { e.preventDefault(); run(async () => { await api('POST', '/api/admin/notify', formData(e.target)); toast('Изпратено 📣'); render(); }); };
};

// ---------- обратна връзка ----------
pages.feedback = async () => {
  const list = await api('GET', '/api/admin/feedback');
  view.innerHTML = `<h1>💬 Обратна връзка</h1>${list.map((f) => `<section class="card ${f.handled ? '' : 'alert'}">
    <div class="row"><b class="grow">${esc(f.name || 'Анонимен')} <span class="small muted">${esc(f.contact)}</span></b>${f.rating ? '⭐'.repeat(f.rating) : ''}</div>
    <p class="prose">${esc(f.message)}</p>
    <div class="row small muted"><span class="grow">${fmtDate(f.created_at)} · от страница ${esc(f.page)}</span>
    <label class="check"><input type="checkbox" data-h="${f.id}" ${f.handled ? 'checked' : ''}> Обработено</label></div></section>`).join('') || '<div class="card empty">Няма обратна връзка</div>'}`;
  $$('[data-h]', view).forEach((c) => c.onchange = () => run(async () => { await api('PUT', `/api/admin/feedback/${c.dataset.h}`, { handled: c.checked }); pollAlerts(); render(); }));
};

// ---------- настройки ----------
pages.settings = async () => {
  const s = await api('GET', '/api/admin/settings');
  view.innerHTML = `<h1>⚙️ Настройки</h1><section class="card"><form id="sf">
    <label>Име на магазина</label><input name="shop_name" value="${esc(s.shop_name)}">
    <label>Вашето име</label><input name="owner_name" value="${esc(s.owner_name)}">
    <label>Мото</label><input name="tagline" value="${esc(s.tagline)}">
    <div class="row"><div class="grow"><label>Цена на клуба (€ на месец)</label><input type="number" step="0.01" min="0" name="club_price" value="${esc(s.club_price)}"></div>
    <div class="grow"><label>Отстъпка за членове (%)</label><input type="number" min="0" max="90" name="club_discount_pct" value="${esc(s.club_discount_pct)}"></div>
    <div class="grow"><label>Предупреждение преди изтичане (дни)</label><input type="number" min="0" max="60" name="expiry_warn_days" value="${esc(s.expiry_warn_days)}"></div></div>
    <label>При изтичане на абонамента</label><select name="club_auto_expire">
      <option value="0" ${s.club_auto_expire !== '1' ? 'selected' : ''}>Само ме извести – аз ограничавам достъпа ръчно</option>
      <option value="1" ${s.club_auto_expire === '1' ? 'selected' : ''}>Спри отстъпката и достъпа автоматично</option></select>
    <label>Място за вземане по подразбиране</label><input name="pickup_location" value="${esc(s.pickup_location)}" placeholder="гр. ..., ул. ...">
    <label>Телефон за връзка</label><input name="contact_phone" value="${esc(s.contact_phone)}">
    <label>YouTube канал</label><input name="youtube_channel" value="${esc(s.youtube_channel)}" placeholder="https://youtube.com/@...">
    <button class="btn" style="margin-top:12px">Запази</button></form></section>`;
  $('#sf').onsubmit = (e) => { e.preventDefault(); run(async () => { await api('PUT', '/api/admin/settings', formData(e.target)); toast('Запазено'); }); };
};

// ---------- вход и маршрутизатор ----------
function loginPage(msg) {
  view.innerHTML = `<section class="card" style="max-width:420px;margin:30px auto"><h1>Вход за администратор</h1>${msg ? `<p class="muted">${esc(msg)}</p>` : ''}
    <form id="lf"><label>Имейл</label><input name="email" type="email" required><label>Парола</label><input name="password" type="password" required>
    <button class="btn" style="margin-top:12px;width:100%">Влез</button></form>
    <p class="small muted">Първият регистриран акаунт в приложението автоматично става администратор.</p></section>`;
  $('#lf').onsubmit = (e) => { e.preventDefault(); run(async () => { await api('POST', '/api/auth/login', formData(e.target)); boot(); }); };
}
async function render() {
  if (ME?.role !== 'admin') return;
  const [p, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const name = p.split('/')[0];
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + name));
  try { await (pages[name] || pages[''])(null, new URLSearchParams(qs || '')); } catch (e) { view.innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}</div>`; }
}
async function boot() {
  const r = await api('GET', '/api/me');
  ME = r.user;
  if (!ME) return loginPage();
  if (ME.role !== 'admin') return loginPage('Този акаунт няма администраторски права.');
  await render();
  pollAlerts();
}
window.addEventListener('hashchange', render);
mountFeedback(() => ME);
setInterval(() => { if (ME?.role === 'admin') pollAlerts(); }, 60000);
boot();
