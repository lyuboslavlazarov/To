'use strict';
// Общи функции за клиентското приложение и админ панела.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => `${Number(n || 0).toFixed(2)} €`;
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
function fmtDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, dd).getDay();
  return `${WD[wd]}, ${dd} ${MON[m - 1]} ${y}` + (d.length > 10 ? ' ' + d.slice(11, 16) : '');
}
const STATUS = { ordered: 'Поръчана', arrived: 'Пристигнала', delivered: 'Предадена', cancelled: 'Отказана' };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Грешка'); e.status = res.status; throw e; }
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
// изпълнява действие и показва грешката, ако има
async function run(fn) { try { return await fn(); } catch (e) { toast(e.message, true); } }

function modal(html, onMount) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
  document.body.appendChild(m);
  onMount?.(m, () => m.remove());
  return m;
}

function ytEmbed(id) {
  return id ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}?rel=0" title="Видео" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : '';
}
const imgOrEmoji = (s) => /^(https?:)?\/\//.test(s || '') || /^\//.test(s || '') ? `<img src="${esc(s)}" alt="">` : esc(s || '🧴');

// Бутон за обратна връзка – на всяка страница
function mountFeedback(getUser) {
  const b = document.createElement('button');
  b.className = 'btn fab';
  b.type = 'button';
  b.innerHTML = '💬<span> Обратна връзка</span>';
  b.title = 'Обратна връзка';
  b.onclick = () => {
    const u = getUser();
    let rating = 0;
    modal(`<h2>💬 Обратна връзка</h2>
      <p class="muted small">Мнение, идея, проблем или въпрос – всичко ни помага да станем по-добри.</p>
      <div class="stars" aria-label="Оценка">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-r="${i}">⭐</button>`).join('')}</div>
      ${u ? '' : '<label>Име</label><input id="fbName"><label>Имейл или телефон (по желание)</label><input id="fbContact">'}
      <label>Съобщение</label><textarea id="fbMsg" required></textarea>
      <div class="row" style="margin-top:12px"><button class="btn" id="fbSend">Изпрати</button><button class="btn ghost" data-close>Затвори</button></div>`,
    (m, close) => {
      $$('.stars button', m).forEach((s) => s.onclick = () => { rating = Number(s.dataset.r); $$('.stars button', m).forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= rating)); });
      $('#fbSend', m).onclick = () => run(async () => {
        await api('POST', '/api/feedback', { message: $('#fbMsg', m).value, rating: rating || null, page: location.pathname + location.hash, name: $('#fbName', m)?.value, contact: $('#fbContact', m)?.value });
        close(); toast('Благодарим ви! 💚');
      });
      $('#fbMsg', m).focus();
    });
  };
  document.body.appendChild(b);
}

// Известия в браузъра (докато приложението е отворено)
function browserNotify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon.svg' }); } catch { /* не е поддържано */ }
}
