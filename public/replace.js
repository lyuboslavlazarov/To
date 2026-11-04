'use strict';
/*
 * Замяна на изгубена карта.
 * 1) старата карта се намира по име, телефон или номер (не се сканира);
 * 2) сканира се само новата карта (скенер, камера или ръчно);
 * 3) данните, точките, оставащите игри и цялата история минават на новата карта,
 *    а старата се блокира.
 */
function openReplaceCard({ preselect = null, onDone = null } = {}) {
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="width:min(760px,100%)">
    <div class="row"><h2 class="grow" style="margin:0">🔁 Изгубена карта – замяна с нова</h2><button class="ghost" data-close>✕</button></div>
    <div data-step style="margin-top:14px"></div></div>`;
  document.body.appendChild(bg);
  const stepEl = bg.querySelector('[data-step]');
  let cam = null;
  const close = () => { if (cam) cam.close(); bg.remove(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.hasAttribute('data-close')) close(); });
  bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  const cardInfo = (c) => `
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="v">${esc(c.barcode)}</div><div class="l">Стара карта</div></div>
      <div class="stat"><div class="v" style="color:var(--accent)">${pts(c.balance)}</div><div class="l">Точки</div></div>
      <div class="stat"><div class="v" style="color:${gamesColor(c.games)}">${gamesLeft(c.games)}</div><div class="l">Оставащи игри</div></div>
      <div class="stat"><div class="v">${c.visits}</div><div class="l">Входове</div></div>
      <div class="stat"><div class="v">${c.plays}</div><div class="l">Изиграни игри</div></div>
    </div>`;

  // ---- стъпка 1: търсене на старата карта ----
  function stepSearch() {
    stepEl.innerHTML = `
      <p class="muted">Намерете картата на посетителя по <b>име</b>, <b>телефон</b> или <b>номер</b> – старата карта не е нужна.</p>
      <div class="scan" data-own-scan style="padding:6px 12px"><span class="icon">🔎</span>
        <input data-q placeholder="Име, телефон или номер на старата карта…" autocomplete="off"></div>
      <div class="scroll" style="max-height:45vh; margin-top:12px"><table>
        <thead><tr><th>Карта</th><th>Име</th><th>Телефон</th><th>Точки</th><th>Игри</th><th>Последен вход</th><th></th></tr></thead>
        <tbody data-res><tr><td colspan="7" class="muted">Започнете да пишете…</td></tr></tbody></table></div>`;
    const q = stepEl.querySelector('[data-q]');
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); search(); } });
    q.focus();
    async function search() {
      const text = q.value.trim();
      const res = stepEl.querySelector('[data-res]');
      if (text.length < 2) { res.innerHTML = '<tr><td colspan="7" class="muted">Въведете поне 2 символа</td></tr>'; return; }
      try {
        const rows = (await api('GET', `/api/cards?limit=40&q=${encodeURIComponent(text)}`)).filter((r) => !r.replaced_by);
        res.innerHTML = rows.map((r) => `<tr>
          <td><b>${esc(r.barcode)}</b>${r.blocked ? ' <span class="badge bad">блок.</span>' : ''}</td>
          <td>${esc(r.name || '—')}</td><td>${esc(r.phone || '')}</td><td>${r.balance}</td><td>${r.games_left ?? '—'}</td>
          <td>${fmtTs(r.last_visit)}</td>
          <td><button class="sm primary" data-pick="${esc(r.barcode)}">Избери</button></td></tr>`).join('')
          || '<tr><td colspan="7" class="muted">Няма намерени карти</td></tr>';
        res.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.pick)));
      } catch (e) { res.innerHTML = `<tr><td colspan="7" class="bad">${esc(e.message)}</td></tr>`; }
    }
  }

  async function pick(code) {
    try {
      const c = await api('GET', '/api/cards/' + encodeURIComponent(code));
      if (c.replaced_by) { toast(`Картата ${code} вече е заменена с ${c.replaced_by}`, 'bad', 5000); if (!stepEl.innerHTML.trim()) stepSearch(); return; }
      stepScanNew(c);
    } catch (e) { toast(e.message, 'bad', 4000); if (!stepEl.innerHTML.trim()) stepSearch(); }
  }

  // ---- стъпка 2: сканиране на новата карта ----
  function stepScanNew(old) {
    stepEl.innerHTML = `
      <div class="big">${esc(old.name || 'Без име')} ${old.phone ? `<span class="muted small">· ${esc(old.phone)}</span>` : ''}</div>
      ${cardInfo(old)}
      <h3 style="margin-top:18px">Сканирайте НОВАТА карта</h3>
      <div class="scan" data-own-scan><span class="icon">▥</span><input data-new placeholder="Сканирайте новата карта…" autocomplete="off"></div>
      <div data-confirm style="margin-top:14px"></div>
      <div class="row" style="margin-top:14px"><button class="ghost" data-back>← Друга карта</button></div>`;
    const input = stepEl.querySelector('[data-new]');
    const onNew = async (code) => {
      code = String(code || '').trim().toUpperCase();
      if (!code) return;
      input.value = code;
      if (code === old.barcode) { beep(false); toast('Това е старата карта – сканирайте нова', 'bad'); input.value = ''; return; }
      let existing = null;
      try { existing = await api('GET', '/api/cards/' + encodeURIComponent(code)); } catch (e) { if (e.status !== 404) { toast(e.message, 'bad'); return; } }
      if (existing && (existing.replaced_by || existing.visits || existing.plays || existing.purchases)) {
        beep(false);
        stepEl.querySelector('[data-confirm]').innerHTML = `<div class="result bad"><b>✖ Картата ${esc(code)} не може да се използва:</b>
          ${existing.replaced_by ? 'тя е стара (изгубена) карта.' : 'вече е използвана от друг посетител.'} Вземете неизползвана карта.</div>`;
        input.value = '';
        return;
      }
      beep(true);
      showConfirm(old, code);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onNew(input.value); } });
    if (typeof CameraScanner !== 'undefined') cam = CameraScanner.attach(input, onNew, { secondary: true });
    stepEl.querySelector('[data-back]').addEventListener('click', () => { if (cam) cam.close(); stepSearch(); });
    input.focus();
  }

  function showConfirm(old, newCode) {
    const box = stepEl.querySelector('[data-confirm]');
    box.innerHTML = `<div class="result ok">
      <div class="big"><b>${esc(old.barcode)}</b> → <b style="color:var(--ok)">${esc(newCode)}</b></div>
      <ul style="margin:10px 0">
        <li>Данните на играещия: <b>${esc(old.name || 'без име')}</b></li>
        <li>Точки: <b>${pts(old.balance)}</b> · оставащи игри: <b>${gamesLeft(old.games)}</b></li>
        <li>Цялата история: ${old.visits} входа, ${old.plays} игри, ${old.purchases} покупки</li>
        <li>Старата карта <b>${esc(old.barcode)}</b> ще бъде блокирана</li>
      </ul>
      <div class="row"><input data-reason placeholder="Причина (по желание)" class="grow" style="width:auto" value="Изгубена карта">
        <button class="primary xl" data-do>🔁 Замени картата</button></div></div>`;
    box.querySelector('[data-do]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('POST', `/api/cards/${encodeURIComponent(old.barcode)}/replace`, { new_barcode: newCode, reason: box.querySelector('[data-reason]').value });
        beep(true);
        if (cam) cam.close();
        stepEl.innerHTML = `<div class="result ok center">
          <div class="huge ok">✔</div>
          <div class="big">Картата е заменена: ${esc(old.barcode)} → ${esc(newCode)}</div>
          <p>${esc(r.card.name || 'Без име')} · ${pts(r.card.balance)} · оставащи игри: ${gamesLeft(r.card.games)}</p>
          <p class="muted">Старата карта ${esc(old.barcode)} е блокирана. Ако бъде намерена, не може да се използва.</p>
          <button class="primary" data-close>Готово</button></div>`;
        if (onDone) onDone(r.card, old.barcode);
      } catch (err) { e.target.disabled = false; beep(false); toast(err.message, 'bad', 5000); }
    });
  }

  if (preselect) pick(preselect); else stepSearch();
}
