'use strict';
/*
 * Сканиране на баркод с камерата на устройството.
 * - Използва вградения BarcodeDetector на браузъра (Chrome/Android/Mac), а където го няма
 *   (Safari на iPhone/iPad, Firefox) – библиотеката ZXing от /vendor (работи и без интернет).
 * - Камерата изисква защитена връзка (https) или localhost.
 */
const CameraScanner = (() => {
  const FORMATS_NATIVE = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix'];
  const page = location.pathname;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`cam:${page}:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`cam:${page}:${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  let panel, video, statusEl, stream, timer, detector, zx, canvas, ctx;
  let onScanCb = null, opts = {}, busy = false, devices = [], deviceIdx = -1;
  // Последната прочетена карта и кога е видяна за последно. Същата карта се приема отново
  // само след като е излязла от кадъра поне GONE_MS – иначе карта, държана пред камерата,
  // би се отчела многократно (напр. многократно добавяне на точки).
  const GONE_MS = 4000;
  let readyText = 'Насочете баркода в рамката';
  let last = { code: '', seen: 0 };

  function css() {
    if (document.getElementById('cam-css')) return;
    const s = document.createElement('style');
    s.id = 'cam-css';
    s.textContent = `
      .cam-btn { flex: none; font-size: 1.2em; padding: 8px 14px; background: var(--accent2, #8ecae6); color: #0a2230; }
      #camPanel { position: fixed; right: 12px; bottom: 12px; width: 220px; z-index: 950; touch-action: none;
        background: var(--card, #1f2448); border: 2px solid var(--accent2, #8ecae6); border-radius: 16px; overflow: hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,.6); }
      #camPanel.large { width: min(420px, calc(100vw - 24px)); }
      #camPanel .cam-head { display: flex; align-items: center; gap: 4px; padding: 4px 6px; cursor: move; user-select: none; }
      #camPanel .cam-head b { flex: 1; font-size: .85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #camPanel .cam-head button { padding: 3px 8px; font-size: .8em; cursor: pointer; }
      #camPanel.large .cam-head { padding: 8px 10px; gap: 6px; }
      #camPanel.large .cam-head b { font-size: 1em; }
      #camPanel.large .cam-head button { padding: 6px 10px; font-size: .9em; }
      #camPanel.dragging { opacity: .85; }
      #camPanel .cam-view { position: relative; background: #000; aspect-ratio: 4 / 3; }
      #camPanel video { width: 100%; height: 100%; object-fit: cover; display: block; }
      #camPanel video.mirror { transform: scaleX(-1); }
      #camPanel .cam-frame { position: absolute; left: 6%; right: 6%; top: 25%; bottom: 25%; border: 2px solid rgba(255,255,255,.85);
        border-radius: 10px; box-shadow: 0 0 0 999px rgba(0,0,0,.35); pointer-events: none; transition: border-color .15s; }
      #camPanel .cam-frame::after { content: ''; position: absolute; left: 4%; right: 4%; top: 50%; height: 2px; background: #ff5d73;
        animation: camline 1.6s ease-in-out infinite; }
      #camPanel .cam-frame.hit { border-color: #2ecc71; box-shadow: 0 0 0 999px rgba(46,204,113,.35); }
      @keyframes camline { 0%,100% { transform: translateY(-30px); } 50% { transform: translateY(30px); } }
      #camPanel .cam-foot { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: .75em; }
      #camPanel.large .cam-foot { gap: 10px; padding: 8px 10px; font-size: .85em; }
      #camPanel .cam-foot label { margin: 0; display: flex; align-items: center; gap: 6px; color: inherit; font-size: 1em; }
      #camPanel .cam-foot input { width: auto; }
      #camPanel .cam-status { flex: 1; min-width: 0; color: var(--muted, #9aa0c8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #camPanel .cam-msg { padding: 10px; line-height: 1.4; font-size: .8em; }
      #camPanel.large .cam-msg { padding: 16px; line-height: 1.5; font-size: 1em; }
      #camPanel .cam-msg a.btn { margin-top: 10px; }
      @media (max-width: 600px) { #camPanel { width: 170px; } #camPanel.large { width: calc(100vw - 16px); } }
    `;
    document.head.appendChild(s);
  }

  function buildPanel() {
    if (panel) return;
    css();
    panel = document.createElement('div');
    panel.id = 'camPanel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="cam-head" title="Преместете прозореца, като го хванете оттук"><b>📷 Камера</b>
        <button class="ghost" data-act="switch" title="Смени камерата">🔄</button>
        <button class="ghost" data-act="size" title="По-голям / по-малък">⤢</button>
        <button class="ghost" data-act="close" title="Затвори">✕</button></div>
      <div class="cam-body"></div>
      <div class="cam-foot"><span class="cam-status"></span>
        <label title="Камерата остава включена между сканиранията"><input type="checkbox" data-act="keep"> Включена</label></div>`;
    document.body.appendChild(panel);
    statusEl = panel.querySelector('.cam-status');
    panel.querySelector('[data-act=close]').addEventListener('click', () => {
      const secondary = opts.secondary;
      close(!secondary);
      if (secondary && mainTarget) use(mainTarget);
    });
    panel.querySelector('[data-act=switch]').addEventListener('click', switchCamera);
    const keep = panel.querySelector('[data-act=keep]');
    keep.addEventListener('change', () => { opts.keepOpen = keep.checked; if (!opts.secondary) store.set('keep', keep.checked); });
    panel.classList.toggle('large', !!store.get('large', false));
    panel.querySelector('[data-act=size]').addEventListener('click', () => {
      panel.classList.toggle('large');
      store.set('large', panel.classList.contains('large'));
      clampPosition();
    });
    enableDrag();
  }

  // ---- местене на прозореца (мишка или пръст); позицията се помни ----
  function applyPosition(pos) {
    if (!pos) return;
    panel.style.left = pos.x + 'px';
    panel.style.top = pos.y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
  function clampPosition() {
    if (!panel || panel.hidden || !panel.style.left) return;
    const r = panel.getBoundingClientRect();
    const x = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width));
    const y = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - r.height));
    applyPosition({ x, y });
    store.set('pos', { x, y });
  }
  function enableDrag() {
    const head = panel.querySelector('.cam-head');
    let start = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
      head.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
    });
    head.addEventListener('pointermove', (e) => {
      if (!start) return;
      applyPosition({ x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py });
    });
    const end = () => { if (!start) return; start = null; panel.classList.remove('dragging'); clampPosition(); };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', () => { // двоен клик – обратно в ъгъла
      store.set('pos', null);
      panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
    });
    addEventListener('resize', clampPosition);
  }

  function body(html) { panel.querySelector('.cam-body').innerHTML = html; }
  function status(t) { if (statusEl) statusEl.textContent = t; }

  async function httpsUrl() {
    try {
      const p = await fetch('/api/ping').then((r) => r.json());
      if (p.https_port) return `https://${location.hostname}:${p.https_port}${location.pathname}${location.search}`;
    } catch { /* ignore */ }
    return null;
  }

  async function loadZXing() {
    if (window.ZXing) return window.ZXing;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/vendor/zxing.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('Не може да се зареди модулът за баркодове'));
      document.head.appendChild(s);
    });
    return window.ZXing;
  }

  async function makeDetector() {
    if (detector || zx) return;
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS_NATIVE.filter((f) => supported.includes(f));
        if (formats.includes('code_128')) { detector = new window.BarcodeDetector({ formats }); return; }
      } catch { /* ще ползваме ZXing */ }
    }
    const Z = await loadZXing();
    const reader = new Z.MultiFormatReader();
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
      Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR, Z.BarcodeFormat.QR_CODE,
    ]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    zx = { Z, reader };
  }

  // ZXing: изрязваме централната ивица на кадъра (там е рамката) и я декодираме
  function decodeZX() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const sx = Math.round(vw * 0.04), sw = vw - 2 * sx;
    const sy = Math.round(vh * 0.22), sh = vh - 2 * sy;
    const scale = Math.min(1, 1000 / sw);
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    const { Z, reader } = zx;
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, w, h)));
      return reader.decodeWithState(bmp).getText();
    } catch {
      return null; // няма баркод в този кадър
    } finally {
      reader.reset();
    }
  }

  async function detectOnce() {
    if (!video || video.readyState < 2) return null;
    if (detector) {
      const r = await detector.detect(video);
      return r.length ? r[0].rawValue : null;
    }
    return decodeZX();
  }

  function loop() {
    clearTimeout(timer);
    if (!stream) return;
    timer = setTimeout(async () => {
      if (!stream) return;
      if (!busy) {
        let code = null;
        try { code = await detectOnce(); } catch { /* ignore */ }
        code = code && String(code).trim().toUpperCase();
        if (!code && last.code && Date.now() - last.seen > GONE_MS && statusEl && statusEl.dataset.remove) {
          delete statusEl.dataset.remove;
          status(readyText);
        }
        if (code) {
          const nowMs = Date.now();
          const stillInView = code === last.code && nowMs - last.seen < GONE_MS;
          last = { code, seen: nowMs };
          if (stillInView) { status('Махнете картата'); statusEl.dataset.remove = '1'; }
          else await hit(code);
          last.seen = Date.now();
        }
      }
      loop();
    }, detector ? 120 : 180);
  }

  async function hit(code) {
    const frame = panel.querySelector('.cam-frame');
    if (frame) { frame.classList.add('hit'); setTimeout(() => frame.classList.remove('hit'), 600); }
    if (navigator.vibrate) navigator.vibrate(80);
    status('Сканирано: ' + code);
    busy = true;
    try { await onScanCb(code); } finally { busy = false; }
    if (!opts.keepOpen) { close(false); if (opts.secondary && mainTarget) use(mainTarget); }
  }

  async function listDevices() {
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { devices = []; }
    panel.querySelector('[data-act=switch]').hidden = devices.length < 2;
  }

  async function startStream() {
    stopStream();
    const savedId = store.get('device', null);
    const video_c = savedId
      ? { deviceId: { exact: savedId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: opts.facing || 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
    } catch (e) {
      if (savedId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        store.set('device', null);
        return startStream();
      }
      throw e;
    }
    body('<div class="cam-view"><video playsinline muted autoplay></video><div class="cam-frame"></div></div>');
    video = panel.querySelector('video');
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    const facing = track.getSettings ? track.getSettings().facingMode : undefined;
    video.classList.toggle('mirror', facing === 'user' || (!facing && opts.facing === 'user'));
    await video.play().catch(() => {});
    await listDevices();
    deviceIdx = devices.findIndex((d) => d.deviceId === (track.getSettings ? track.getSettings().deviceId : ''));
  }

  function stopStream() {
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function switchCamera() {
    if (devices.length < 2) return;
    deviceIdx = (deviceIdx + 1) % devices.length;
    store.set('device', devices[deviceIdx].deviceId);
    await open();
  }

  function errorText(e) {
    switch (e && e.name) {
      case 'NotAllowedError': return 'Достъпът до камерата е отказан. Разрешете камерата за този сайт от настройките на браузъра и опитайте отново.';
      case 'NotFoundError': return 'Не е открита камера на това устройство.';
      case 'NotReadableError': return 'Камерата се използва от друго приложение.';
      default: return 'Камерата не може да се стартира: ' + ((e && e.message) || e);
    }
  }

  async function open() {
    buildPanel();
    panel.hidden = false;
    applyPosition(store.get('pos', null));
    clampPosition();
    panel.querySelector('[data-act=keep]').checked = !!opts.keepOpen;
    status('');
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      panel.querySelector('[data-act=switch]').hidden = true;
      const url = await httpsUrl();
      body(`<div class="cam-msg">🔒 Браузърът позволява камерата само през <b>защитена връзка (https)</b>.
        ${url ? `<br>Отворете защитената версия на тази страница. Първия път браузърът ще покаже предупреждение – изберете
          <i>„Разширени“ → „Продължи“</i> (Chrome) или <i>„Покажи подробности“ → „посети този уебсайт“</i> (Safari).
          <br><a class="btn primary" href="${url}">🔒 Отвори защитената версия</a>`
        : '<br>На сървъра не е включен https. Вижте README – раздел „Камера“.'}</div>`);
      return;
    }
    body('<div class="cam-msg">Стартиране на камерата…</div>');
    try {
      await makeDetector();
      await startStream();
      store.set('open', true);
      readyText = detector ? 'Насочете баркода в рамката' : 'Баркодът – хоризонтално в рамката';
      status(readyText);
      loop();
    } catch (e) {
      stopStream();
      body(`<div class="cam-msg">⚠ ${errorText(e)}</div>`);
    }
  }

  function close(byUser) {
    stopStream();
    if (panel) panel.hidden = true;
    if (byUser) store.set('open', false);
  }

  /** Добавя бутон „📷“ към полето за сканиране. */
  let mainTarget = null; // основното поле на екрана
  let visibilityBound = false;

  /**
   * Добавя бутон „📷“ към поле за сканиране. Всяко поле има собствен получател –
   * напр. полето за новата карта в прозореца „Изгубена карта“ не пречи на основното.
   * options.secondary = true: еднократно сканиране, не се помни като „включена“.
   */
  function attach(input, onScan, options = {}) {
    css();
    const target = options.secondary
      ? { onScan, opts: { ...options, keepOpen: false } }
      : { onScan, opts: { ...options, keepOpen: store.get('keep', !!options.keepOpen) } };
    if (!options.secondary && !mainTarget) mainTarget = target;
    const wrap = input.closest('.scan') || input.parentElement;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cam-btn';
    btn.title = 'Сканирай с камерата';
    btn.textContent = '📷';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel && !panel.hidden && onScanCb === target.onScan) { close(!options.secondary); return; }
      use(target);
      open();
    });
    wrap.appendChild(btn);
    if (target === mainTarget) {
      use(target);
      // ако камерата е била оставена включена (монитор на игра, киоск) – включва се отново
      if (opts.keepOpen && store.get('open', false) && window.isSecureContext) open();
    }
    if (!visibilityBound) {
      visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopStream();
        else if (panel && !panel.hidden && !stream && window.isSecureContext) open();
      });
    }
    return { close: () => { if (onScanCb === target.onScan) { close(false); if (mainTarget) use(mainTarget); } } };
  }

  function use(target) {
    onScanCb = target.onScan;
    opts = target.opts;
    if (panel) panel.querySelector('[data-act=keep]').checked = !!opts.keepOpen;
  }

  return { attach, open, close };
})();
