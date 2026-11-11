/* ============================================================================
 *  VertGames · Casino V — клиентская логика
 *  Слоты, билеты, ежедневный бонус, rewarded-реклама, магазин монет.
 *  Балансы живут в window.VA (database.js) — этот файл их только читает/пишет,
 *  чтобы всё казино можно было позже перевести на серверные вызовы.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- helpers */
  const $ = (id) => document.getElementById(id);
  const LS = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
  const SS = (k, v) => { try { return v === undefined ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch (e) { return null; } };
  const SSR = (k) => { try { sessionStorage.removeItem(k); } catch (e) {} };
  const VA = window.VA;
  const isEn = () => (document.body.getAttribute('lang') || 'ru') === 'en';
  const L = (ru, en) => (isEn() ? en : ru);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rnd = (n) => Math.floor(Math.random() * n);

  /* ------------------------------------------------------- Конфиг монетизации
   *  Здесь всё, что владельцу сайта нужно менять под себя.
   * ---------------------------------------------------------------------- */
  const CONFIG = {
    // Rewarded ads
    adProvider: 'demo',                    // 'demo' | 'yandex' | 'h5games'
    adReward: 100,
    adDailyLimit: 5,
    adDemoSeconds: 5,
    // Yandex Advertising Network (РСЯ): два блока — десктоп и мобильный
    yandexLoader: 'https://yandex.ru/ads/system/context.js',
    yandexBlocks: { desktop: 'R-A-000000-01', touch: 'R-A-000000-02' },
    // Google H5 Games Ads: тег AdSense for games
    adsenseClient: 'ca-pub-0000000000000000',
    adsenseScript: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-0000000000000000',
    // Магазин монет
    currencyRate: 1,                       // V за 1 ₽ в демо-расчёте
    provider: 'demo',                      // 'demo' | 'yookassa' | 'stripe' | 'cryptobot'
    methods: [
      { id: 'cards', ru: 'Картой', en: 'Card', sub: 'ЮKassa', cur: '₽' },
      { id: 'sbp', ru: 'СБП', en: 'SBP', sub: 'ЮKassa', cur: '₽' },
      { id: 'crypto', ru: 'Крипта', en: 'Crypto', sub: 'CryptoBot', cur: 'USDT' }
    ],
    packs: [
      { id: 'start', ru: 'Старт', en: 'Start', coins: 1000, price: 99, usd: 1.5, bonus: 0, icon: 'coin' },
      { id: 'major', ru: 'Мажор', en: 'Major', coins: 5500, price: 449, usd: 5.9, bonus: 10, icon: 'gem', best: true },
      { id: 'whale', ru: 'Кит', en: 'Whale', coins: 15000, price: 990, usd: 12.9, bonus: 20, icon: 'crown' }
    ],
    promos: { VERT100: 100, START500: 500, CASINO250: 250 },
    ticketsPer: 100,                       // 1 билет за каждые 100 V ставки
    ticketConvert: 500,
    dailyRewards: [100, 150, 200, 300, 500]
  };

  /* ------------------------------------------------------------------ icons */
  const IC =
    (window.CASINO_ICONS || {});
  function ic(n, s) {
    const c = IC[n] || '';
    return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + c + '</svg>';
  }

  /* ------------------------------------------------------------- VA façade */
  function db() { return VA ? VA.getUsers() : {}; }
  function save(d) { if (VA) VA.saveUsers(d); }
  function current() { return VA ? VA.getCurrentUser() : null; }
  function balance() { const u = current(); return u ? VA.getUserBalance(u) : 0; }
  function credit(delta) {
    const u = current();
    if (!u) return 0;
    const next = VA.adjustUserBalance(u, delta);
    syncHeader();
    return next;
  }

  /* ------------------------------------------------------------- хранилище */
  const K = {
    adDay: 'vg_casino_ad_day', adLeft: 'vg_casino_ad_left',
    daily: 'vg_casino_daily', tickets: 'vg_casino_tickets',
    log: 'vg_casino_log', pays: 'vg_casino_pays', spin: 'vg_casino_spin'
  };
  function perUser(key) { const u = current() || 'guest'; return key + ':' + u.toLowerCase(); }
  function getNum(key) { return Number(LS(perUser(key)) || 0); }
  function setNum(key, v) { LS(perUser(key), String(v)); }
  function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* ------------------------------------------------------------------- лог */
  function pushLog(kindRu, kindEn, amount) {
    let list = [];
    try { list = JSON.parse(LS(perUser(K.log)) || '[]'); } catch (e) {}
    list.unshift({ k: kindRu, e: kindEn, a: amount, t: Date.now() });
    list = list.slice(0, 12);
    LS(perUser(K.log), JSON.stringify(list));
    renderLog();
  }
  function renderLog() {
    const box = $('logList');
    if (!box) return;
    let list = [];
    try { list = JSON.parse(LS(perUser(K.log)) || '[]'); } catch (e) {}
    if (!list.length) {
      box.innerHTML = '<div class="log-row"><span class="log-kind">' + L('Пока пусто — сделай первую ставку или бонус.', 'Empty for now — place a first bet or claim a bonus.') + '</span></div>';
      return;
    }
    box.innerHTML = list.map((r) => {
      const sign = r.a > 0 ? '+' : '−';
      const cls = r.a > 0 ? 'up' : 'down';
      const d = new Date(r.t);
      const time = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return '<div class="log-row"><span class="log-icon" style="color:var(--gold)">' + ic(r.a > 0 ? 'coin' : 'wheel', 15) + '</span><span class="log-kind">' + (isEn() ? r.e : r.k) + ' · ' + time + '</span><span class="log-val ' + cls + '">' + sign + Math.abs(r.a) + ' V</span></div>';
    }).join('');
  }

  /* --------------------------------------------------------------- header UI */
  function syncHeader() {
    const u = current();
    const bal = u ? VA.getUserBalance(u) : 0;
    const el = $('coinCounter'); if (el) el.textContent = bal;
    const hb = $('heroBalance'); if (hb) hb.textContent = bal + ' V';
    const hbe = $('heroBalanceEn'); if (hbe) hbe.textContent = bal + ' V';
    const sc = $('shopCoins'); if (sc) sc.textContent = bal;
    const pc = $('profCoins'); if (pc) pc.textContent = bal;
    const b = $('authButton');
    if (b && !u) b.innerHTML = '<span class="label-ru">Войти</span><span class="label-en">Sign In</span>';
    if (b && u) {
      const color = userColor(u);
      b.classList.add('profile-btn');
      b.innerHTML = '<span class="pavatar" style="color:' + color + '">' + ic(avatarIcon(u), 14) + '</span><span style="color:var(--text);font-weight:800">' + esc(u) + '</span><span style="color:var(--muted);font-size:10px;font-weight:600">' + esc(userTitle(u)) + '</span>';
    }
    const dot = document.querySelector('.header-actions .coin-icon');
    if (dot) dot.style.color = u ? userColor(u) : 'var(--teal)';
    renderTickets();
  }

  /* --------------------------------------------------------------- косметика
   *  На casino.html нет полного SHOP-модуля, поэтому читаем поля аккаунта
   *  напрямую и дублируем минимальную карту иконок. */
  const AV = { 'av:rocket': 'rocket', 'av:fox': 'fox', 'av:alien': 'alien', 'av:tiger': 'tiger', 'av:dragon': 'dragon', 'av:bot': 'bot', 'av:phoenix': 'phoenix', 'av:gem': 'gem' };
  const COLS = { 'col:teal': '#2b99a0', 'col:blue': '#2f63a8', 'col:indigo': '#3730a0', 'col:gold': '#e8b64c', 'col:pink': '#e05a9e', 'col:viper': '#57d364', 'col:crimson': '#e23a4f', 'col:violet': '#8a6bff' };
  const TITLES = { 't:new': ['Новичок', 'Rookie'], 't:vet': ['Ветеран', 'Veteran'], 't:ace': ['Ас', 'Ace'], 't:legend': ['Легенда', 'Legend'], 't:top': ['Гроза топов', 'Top Slayer'] };
  function rec(name) { const d = db(); return name && d[name] ? d[name] : null; }
  function userColor(name) { const r = rec(name); return (r && COLS[r.color]) || '#2b99a0'; }
  function avatarIcon(name) { const r = rec(name); return (r && AV[r.avatar]) || 'rocket'; }
  function userTitle(name) { const r = rec(name); const t = r && TITLES[r.title]; return t ? t[isEn() ? 1 : 0] : ''; }

  /* ------------------------------------------------------------------- toast */
  let toastTimer = 0;
  function showToast(text) {
    const e = $('toast');
    if (!e) return;
    e.textContent = text;
    e.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => e.classList.remove('show'), 2600);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function requireUser(actionRu, actionEn) {
    if (current()) return true;
    showToast(L((actionRu || 'Действие') + ' — войдите в аккаунт', (actionEn || 'This action') + ' needs an account'));
    toggleAuth(true);
    return false;
  }

  /* ==========================================================================
   *  СЛОТЫ
   * ====================================================================== */
  // m3 - выплата за три в ряд (множитель ставки), w - вес символа на барабане.
  // Меняя числа, смотрите на RTP: он считается автоматически в computeRtp().
  const SYMBOLS = [
    { id: 'v', icon: 'coin', name: 'V', m3: 12, w: 30, color: '#2b99a0' },
    { id: 'spark', icon: 'spark', name: 'Spark', m3: 23, w: 16, color: '#2f63a8' },
    { id: 'dice', icon: 'dice', name: 'Dice', m3: 29, w: 14, color: '#a7b7ca' },
    { id: 'star', icon: 'star', name: 'Star', m3: 35, w: 12, color: '#e8b64c' },
    { id: 'gem', icon: 'gem', name: 'Gem', m3: 47, w: 8, color: '#8a6bff' },
    { id: 'wheel', icon: 'wheel', name: 'Wheel', m3: 53, w: 8, color: '#57d364' },
    { id: 'crown', icon: 'crown', name: 'Crown', m3: 70, w: 6, color: '#e8b64c' }
  ];
  const TOTAL_W = SYMBOLS.reduce((a, s) => a + s.w, 0);
  const ROWS = 3;
  const CELL = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell') || 0) || 96;
  // Теоретическое возвращение игроку: считаем по весам, чтобы не врать в бейдже
  function computeRtp() {
    const p = SYMBOLS.map((s) => s.w / TOTAL_W);
    let three = 0, pair = 0;
    for (let i = 0; i < SYMBOLS.length; i++) {
      three += Math.pow(p[i], 3) * SYMBOLS[i].m3;
      // ровно два одинаковых символа: i дважды, любой другой — на третьей позиции
      pair += 3 * p[i] * p[i] * (1 - p[i]) * TWO_PAY;
    }
    return three + pair;
  }
  const STAKES = [5, 10, 25, 50, 100];
  const TWO_PAY = 0.4;   // пара: 40% ставки (выплата идёт часто, поэтому доля небольшая)

  let stake = Number(LS('vg_casino_stake') || 25);
  if (STAKES.indexOf(stake) < 0) stake = 10;
  let spinning = false;
  let grid = [[], [], []];

  function symbolById(id) { return SYMBOLS.find((s) => s.id === id); }
  function pickSymbol() {
    let r = Math.random() * TOTAL_W;
    for (const s of SYMBOLS) { r -= s.w; if (r <= 0) return s.id; }
    return SYMBOLS[0].id;
  }
  function symHTML(id, hot) {
    const s = symbolById(id);
    return '<div class="sym' + (hot ? ' hot' : '') + '" style="color:' + (hot ? '#fff' : s.color) + '">' + ic(s.icon, 46) + '</div>';
  }
  function buildStrip(idx, ids) {
    const strip = $('strip' + idx);
    if (!strip) return;
    // зацикленный набор: 3 прокрутки + видимые + резерв
    const all = [];
    for (let k = 0; k < 4; k++) ids.forEach((id) => all.push(id));
    strip.innerHTML = all.map((id) => symHTML(id, false)).join('');
    strip.style.transform = 'translateY(' + (-CELL() * ROWS) + 'px)';
  }
  function renderInitial() {
    for (let i = 0; i < 3; i++) {
      grid[i] = [pickSymbol(), pickSymbol(), pickSymbol()];
      buildStrip(i, grid[i]);
    }
  }
  function cellSize() {
    const reel = $('reel0');
    return reel ? reel.clientHeight / ROWS : CELL();
  }
  function animateReel(i, finalIds, delay, done) {
    const strip = $('strip' + i);
    const reel = $('reel' + i);
    if (!strip || !reel) { done(); return; }
    const c = cellSize();
    if (strip._raf) cancelAnimationFrame(strip._raf);
    const ids = [];
    for (let k = 0; k < 14; k++) ids.push(pickSymbol());
    finalIds.forEach((id) => ids.push(id));
    strip.innerHTML = ids.map((id) => symHTML(id, false)).join('');
    const startVisible = ROWS;                 // первый видимый кадр
    const endVisible = ids.length - ROWS;      // финальные три символа
    const distance = (endVisible - startVisible) * c;
    strip.style.transform = 'translateY(' + (-startVisible * c) + 'px)';
    reel.classList.add('spinning');
    const dur = 1150 + i * 420;
    const easeOutQuint = (p) => 1 - Math.pow(1 - p, 5);
    const begin = performance.now();
    const step = (now) => {
      const p = clamp((now - begin - delay) / dur, 0, 1);
      strip.style.transform = 'translateY(' + (-(startVisible * c + distance * easeOutQuint(p))) + 'px)';
      if (p < 1) { strip._raf = requestAnimationFrame(step); }
      else {
        reel.classList.remove('spinning');
        strip.style.transform = 'translateY(' + (-endVisible * c) + 'px)';
        strip._raf = 0;
        done();
      }
    };
    strip._raf = requestAnimationFrame(step);
  }
  function evalGrid() {
    const line = [grid[0][1], grid[1][1], grid[2][1]];
    if (line[0] === line[1] && line[1] === line[2]) {
      const s = symbolById(line[0]);
      return { mult: s.m3, type: 'three', line, win: Math.round(stake * s.m3) };
    }
    // пара: два любых одинаковых символа на линии — возврат ставки
    if (line[0] === line[1] || line[1] === line[2]) {
      return { mult: TWO_PAY, type: 'two', line, win: Math.round(stake * TWO_PAY) };
    }
    return { mult: 0, type: 'none', line, win: 0 };
  }
  function burst() {
    const card = $('slot');
    if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'burst';
    for (let i = 0; i < 16; i++) {
      const bit = document.createElement('i');
      bit.style.setProperty('--dx', (rnd(340) - 170) + 'px');
      bit.style.setProperty('--dy', (-rnd(220) - 20) + 'px');
      bit.style.setProperty('--rot', rnd(720) + 'deg');
      bit.style.animationDelay = (i * 16) + 'ms';
      bit.style.background = i % 3 === 0 ? '#f8d98d' : i % 3 === 1 ? '#e8b64c' : '#2b99a0';
      layer.appendChild(bit);
    }
    card.appendChild(layer);
    setTimeout(() => layer.remove(), 1400);
  }
  function paintLine(win) {
    document.querySelectorAll('.sym.hot').forEach((el) => { el.classList.remove('hot'); el.style.color = ''; });
    const pl = $('payline');
    if (pl) pl.classList.remove('win');
    if (!win) return;
    pl.classList.add('win');
    // finalIds идут последними тремя элементами ленты
    for (let i = 0; i < 3; i++) {
      const strip = $('strip' + i);
      if (!strip) continue;
      const isWinning = win.type === 'three' || win.line[i] === win.line[0] || win.line[i] === win.line[2] || win.line[0] === win.line[2];
      if (!isWinning) continue;
      const center = strip.children[strip.children.length - 2];
      if (center) { center.classList.add('hot'); center.style.color = '#fff'; }
    }
  }
  function renderStakes() {
    const box = $('stakeRow');
    if (!box) return;
    box.innerHTML = '';
    STAKES.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stake' + (s === stake ? ' on' : '');
      b.innerHTML = s + ' <svg class="coin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity=".12"/><path d="M8.5 8.5 12 16l3.5-7.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      b.onclick = () => {
        if (spinning) return;
        stake = s;
        LS('vg_casino_stake', String(s));
        renderStakes();
        say('Выбери ставку и жми «Крутить»', 'Pick a stake and hit Spin');
      };
      box.appendChild(b);
    });
  }
  function renderPaytable() {
    const box = $('paytable');
    if (!box) return;
    box.innerHTML = SYMBOLS.slice().sort((a, b) => b.m3 - a.m3).map((s) =>
      '<span class="pt" title="' + L('три в ряд', 'three of a kind') + '">' + ic(s.icon, 15) + ' <b>×' + s.m3 + '</b></span>'
    ).join('') + '<span class="pt"><span data-ic="coin" data-s="14"></span> <b>×2</b> ' + L('пара', 'pair') + '</span>';
    hydrateIcons();
  }
  function say(ru, en, cls) {
    const el = $('winLine');
    if (!el) return;
    el.className = 'win-line' + (cls || '');
    el.innerHTML = '<span>' + L(ru, en) + '</span>';
  }
  function addTickets(amount) {
    // 1 билет за каждые ticketsPer V ставки, остаток переносится на следующие ставки
    const wagered = getNum('vg_casino_wagered') + amount;
    const n = Math.floor(wagered / CONFIG.ticketsPer);
    setNum('vg_casino_wagered', wagered - n * CONFIG.ticketsPer);
    if (n <= 0) return;
    setNum(K.tickets, getNum(K.tickets) + n);
    renderTickets();
    showToast(L('+' + n + ' билет розыгрыша', '+' + n + ' draw ticket(s)'));
  }
  function renderTickets() {
    const t = getNum(K.tickets);
    ['ticketNum', 'heroTickets', 'heroTicketsEn'].forEach((id) => { const el = $(id); if (el) el.textContent = t; });
    const btn = $('convertBtn');
    if (btn) btn.disabled = t < CONFIG.ticketConvert || !current();
  }

  async function spin() {
    if (spinning) return;
    if (!requireUser('Крутить', 'Spinning')) return;
    const bal = balance();
    if (bal < stake) {
      showToast(L('Недостаточно V: нужно ' + stake + '. Заработай в играх, бонусом или в магазине.', 'Not enough V: ' + stake + ' needed. Earn in games, take a bonus or open the shop.'));
      $('adBtn') && $('adBtn').classList.add('ready');
      return;
    }
    spinning = true;
    $('spinBtn').disabled = true;
    credit(-stake);
    pushLog('Ставка в слотах', 'Slots stake', -stake);
    addTickets(stake);
    setNum(K.spin, getNum(K.spin) + 1);
    paintLine(null);
    $('payline') && $('payline').classList.remove('win');
    say('Барабаны крутятся…', 'Reels are spinning…');

    // результат определяем заранее — так начисление не зависит от анимации
    for (let i = 0; i < 3; i++) grid[i] = [pickSymbol(), pickSymbol(), pickSymbol()];

    let finished = 0;
    const total = 3;
    for (let i = 0; i < 3; i++) {
      animateReel(i, grid[i], i * 90, () => {
        finished++;
        if (finished === total) settle();
      });
    }
  }
  function settle() {
    const res = evalGrid();
    spinning = false;
    $('spinBtn').disabled = false;
    paintLine(res.type === 'none' ? null : res);
    if (res.win > 0) {
      credit(res.win);
      pushLog(res.type === 'three' ? 'Три в ряд' : 'Пара символов', res.type === 'three' ? 'Three of a kind' : 'Pair', res.win);
      say(res.type === 'three'
        ? L('×' + res.mult + ' — выигрыш ' + res.win + ' V', '×' + res.mult + ' — you won ' + res.win + ' V')
        : L('Пара — возврат ' + res.win + ' V', 'Pair — ' + res.win + ' V back'), '', 'win');
      burst();
      showToast('+' + res.win + ' V');
    } else {
      pushLog('Слоты — без выигрыша', 'Slots — no win', 0);
      say('Пусто. Ещё раз?', 'No match. Again?');
    }
    syncHeader();
  }

  /* ==========================================================================
   *  REWARDED ADS
   * ====================================================================== */
  function adState() {
    if (LS(K.adDay) !== today()) { LS(K.adDay, today()); LS(K.adLeft, String(CONFIG.adDailyLimit)); }
    const left = Number(LS(K.adLeft) || 0);
    return { left: left, max: CONFIG.adDailyLimit };
  }
  function renderAd() {
    const st = adState();
    const left = $('adDailyLeft');
    if (left) left.textContent = st.left + ' / ' + st.max;
    const track = $('adTrack');
    if (track) Array.prototype.forEach.call(track.children, (el, i) => el.classList.toggle('on', i < st.left));
    const btn = $('adBtn');
    if (btn) btn.disabled = st.left <= 0;
    const meta = $('adMetaL');
    if (meta) meta.textContent = st.left > 0 ? L('Осталось сегодня: ' + st.left, st.left + ' left today') : L('Лимит на сегодня', 'Daily limit reached');
    const r = $('adMetaR');
    if (r) r.textContent = '+' + CONFIG.adReward + ' V ' + L('за ролик', 'per ad');
    const label = $('adBtnText');
    if (label) label.innerHTML = st.left > 0
      ? '<span class="label-ru">Смотреть рекламу · +' + CONFIG.adReward + ' V</span><span class="label-en">Watch ad · +' + CONFIG.adReward + ' V</span>'
      : '<span class="label-ru">Лимит на сегодня</span><span class="label-en">Daily limit</span>';
  }
  function grantAdReward() {
    const st = adState();
    if (st.left <= 0) return;
    LS(K.adLeft, String(st.left - 1));
    credit(CONFIG.adReward);
    pushLog('Награда за рекламу', 'Rewarded ad', CONFIG.adReward);
    showToast('+' + CONFIG.adReward + ' V');
    renderAd();
    syncHeader();
  }

  /* --- интеграция с рекламными сетями: единая точка входа --------------- */
  function showRewardedAd(onReward, onSkip) {
    if (!requireUser('Реклама', 'Ads')) return;
    if (adState().left <= 0) { showToast(L('На сегодня лимит. Возвращайся завтра!', 'Daily ad limit reached. Come back tomorrow!')); return; }
    if (CONFIG.adProvider === 'yandex' && window.Ya && Ya.Context && Ya.Context.AdvManager) return yandexRewarded(onReward, onSkip);
    if (CONFIG.adProvider === 'h5games' && typeof window.adBreak === 'function') return h5Rewarded(onReward, onSkip);
    demoRewarded(onReward, onSkip);
  }
  // РСЯ: onRewarded(true) вызывается после полного просмотра
  function yandexRewarded(onReward, onSkip) {
    const touch = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    window.yaContextCb = window.yaContextCb || [];
    window.yaContextCb.push(function () {
      Ya.Context.AdvManager.render({
        blockId: touch ? CONFIG.yandexBlocks.touch : CONFIG.yandexBlocks.desktop,
        type: 'rewarded',
        platform: touch ? 'touch' : 'desktop',
        onRewarded: function (ok) { ok ? onReward() : onSkip(); }
      });
    });
  }
  // Google H5 Games Ads: награда только в adViewed
  function h5Rewarded(onReward, onSkip) {
    window.adBreak({
      type: 'reward',
      name: 'casino_bonus',
      beforeAd: function () {},
      afterAd: function () {},
      adViewed: function () { onReward(); },
      adDismissed: function () { onSkip(); },
      adBreakDone: function (info) {
        // если рекламы не было вовсе — не теряем лимит и подсказываем
        if (info && info.breakStatus !== 'viewed') { /* no reward */ }
      }
    });
  }
  // Демо-режим: показывает таймер внутри модалки, награда — по завершении
  let demoAdTimer = 0;
  function demoRewarded(onReward, onSkip) {
    const modal = $('adDemoModal');
    const bar = $('adProgress');
    const cd = $('adCountdown');
    if (!modal) return onReward();
    let left = CONFIG.adDemoSeconds;
    const draw = () => {
      if (bar) bar.style.width = Math.round(((CONFIG.adDemoSeconds - left) / CONFIG.adDemoSeconds) * 100) + '%';
      if (cd) cd.textContent = (CONFIG.adDemoSeconds - left) + ' / ' + CONFIG.adDemoSeconds;
    };
    modal.classList.add('open');
    modal._reward = onReward;
    modal._skip = onSkip;
    modal._done = false;
    draw();
    clearInterval(demoAdTimer);
    demoAdTimer = setInterval(() => {
      left--;
      draw();
      if (left <= 0) {
        clearInterval(demoAdTimer);
        modal._done = true;
        setTimeout(() => { closeAdDemo(true); }, 350);
      }
    }, 1000);
  }
  function closeAdDemo(viewed) {
    clearInterval(demoAdTimer);
    const modal = $('adDemoModal');
    if (!modal) return;
    modal.classList.remove('open');
    const bar = $('adProgress');
    if (bar) bar.style.width = '0%';
    const cb = viewed ? modal._reward : modal._skip;
    modal._reward = modal._skip = null;
    if (typeof cb === 'function') cb();
  }
  function onAdSkip() {
    showToast(L('Ролик не досмотрен — награды нет', 'Ad was not completed — no reward'));
  }
  function loadAdProvider() {
    if (CONFIG.adProvider === 'yandex' && !document.getElementById('yaContextLoader')) {
      const s = document.createElement('script');
      s.id = 'yaContextLoader';
      s.async = true;
      s.src = CONFIG.yandexLoader;
      document.head.appendChild(s);
    }
    if (CONFIG.adProvider === 'h5games' && !document.getElementById('h5Ads')) {
      const s = document.createElement('script');
      s.id = 'h5Ads';
      s.async = true;
      s.src = CONFIG.adsenseScript;
      s.setAttribute('data-ad-frequency-hint', '60s');
      document.head.appendChild(s);
      window.adsbygoogle = window.adsbygoogle || [];
      window.adConfig = function (o) { window.adsbygoogle.push(o); };
      window.adBreak = function (o) { window.adsbygoogle.push(o); };
    }
  }

  /* ==========================================================================
   *  ЕЖЕДНЕВНЫЙ БОНУС
   * ====================================================================== */
  function dailyInfo() {
    let d = null;
    try { d = JSON.parse(LS(perUser(K.daily)) || 'null'); } catch (e) {}
    if (!d || typeof d !== 'object') d = { day: '', streak: 0 };
    return d;
  }
  function dailyAvailable() {
    const d = dailyInfo();
    const y = new Date(Date.now() - 864e5);
    const yKey = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    if (d.day === today()) return { ok: false, streak: d.streak };
    const streak = d.day === yKey ? clamp((d.streak || 0) + 1, 1, CONFIG.dailyRewards.length) : 1;
    return { ok: true, streak: streak };
  }
  function renderDaily() {
    const info = dailyAvailable();
    const streak = info.ok ? info.streak : (dailyInfo().streak || 1);
    const amount = CONFIG.dailyRewards[clamp(streak - 1, 0, CONFIG.dailyRewards.length - 1)];
    const rw = $('dailyReward');
    if (rw) rw.textContent = '+' + amount + ' V';
    const st = $('dailyStreak');
    if (st) st.textContent = '×' + streak + ' ' + L('серия', 'streak');
    const dots = $('dailyDots');
    if (dots) Array.prototype.forEach.call(dots.children, (el, i) => el.classList.toggle('on', i < streak));
    const btn = $('dailyBtn');
    if (btn) {
      btn.disabled = !info.ok;
      btn.querySelector('#dailyBtnText') && (btn.querySelector('#dailyBtnText').innerHTML = info.ok
        ? '<span class="label-ru">Забрать бонус</span><span class="label-en">Claim bonus</span>'
        : '<span class="label-ru">Уже получен — приходи завтра</span><span class="label-en">Claimed — back tomorrow</span>');
    }
  }
  function claimDaily() {
    if (!requireUser('Бонус', 'Bonus')) return;
    const info = dailyAvailable();
    if (!info.ok) return;
    const amount = CONFIG.dailyRewards[clamp(info.streak - 1, 0, CONFIG.dailyRewards.length - 1)];
    LS(perUser(K.daily), JSON.stringify({ day: today(), streak: info.streak }));
    credit(amount);
    pushLog('Ежедневный бонус', 'Daily bonus', amount);
    showToast('+' + amount + ' V · ' + L('серия ' + info.streak, 'streak ' + info.streak));
    renderDaily();
    syncHeader();
  }

  /* ==========================================================================
   *  БИЛЕТЫ → V
   * ====================================================================== */
  function convertTickets() {
    if (!requireUser('Обмен билетов', 'Ticket swap')) return;
    const t = getNum(K.tickets);
    if (t < CONFIG.ticketConvert) return;
    setNum(K.tickets, t - CONFIG.ticketConvert);
    credit(CONFIG.ticketConvert);
    pushLog('Обмен билетов на V', 'Tickets swapped for V', CONFIG.ticketConvert);
    showToast('+' + CONFIG.ticketConvert + ' V');
    renderTickets();
    syncHeader();
  }

  /* ==========================================================================
   *  МАГАЗИН МОНЕТ
   * ====================================================================== */
  let packId = 'major';
  let methodId = 'cards';
  let discount = 0;

  function priceOf(pack) {
    if (methodId === 'crypto') return Math.round(pack.usd * (1 - discount / 100) * 100) / 100;
    return Math.round(pack.price * (1 - discount / 100));
  }
  function curOf() { return methodId === 'crypto' ? '$' : '₽'; }
  function coinsOf(pack) { return pack.coins + Math.round(pack.coins * (pack.bonus / 100)); }

  function renderPacks() {
    const box = $('packs');
    if (!box) return;
    box.innerHTML = CONFIG.packs.map((p) => {
      const total = coinsOf(p);
      return '<button type="button" class="pack' + (p.id === packId ? ' on' : '') + '" data-pack="' + p.id + '" style="position:relative">' +
        (p.best ? '<span class="pack-best">' + L('выгодно', 'best value') + '</span>' : '') +
        '<span class="pack-ico">' + ic(p.icon, 22) + '</span>' +
        '<span class="pack-main"><span class="pack-name">' + (isEn() ? p.en : p.ru) + '</span>' +
        '<span class="pack-sub">' + p.coins.toLocaleString('ru-RU') + ' V' + (p.bonus ? ' + ' + p.bonus + '% → <b style="color:var(--gold2)">' + total.toLocaleString('ru-RU') + ' V</b>' : '') + '</span></span>' +
        '<span class="pack-price">' + priceOf(p) + ' ' + curOf() + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(box.children, (el) => {
      el.onclick = () => { packId = el.getAttribute('data-pack'); renderPacks(); renderPayBtn(); };
    });
  }
  function renderMethods() {
    const box = $('payMethods');
    if (!box) return;
    box.innerHTML = CONFIG.methods.map((m) =>
      '<button type="button" class="pm' + (m.id === methodId ? ' on' : '') + '" data-method="' + m.id + '">' + ic(m.id === 'crypto' ? 'spark' : m.id === 'sbp' ? 'bolt' : 'cart', 18) + '<span>' + (isEn() ? m.en : m.ru) + '</span><small>' + m.sub + '</small></button>'
    ).join('');
    Array.prototype.forEach.call(box.children, (el) => {
      el.onclick = () => { methodId = el.getAttribute('data-method'); renderMethods(); renderPacks(); renderPayBtn(); };
    });
  }
  function packById(id) { return CONFIG.packs.find((p) => p.id === id) || CONFIG.packs[0]; }
  function renderPayBtn() {
    const p = packById(packId);
    const btn = $('payBtnText');
    if (btn) btn.innerHTML = '<span class="label-ru">Оплатить ' + priceOf(p) + ' ' + curOf() + ' · получить ' + coinsOf(p).toLocaleString('ru-RU') + ' V</span><span class="label-en">Pay ' + priceOf(p) + ' ' + curOf() + ' · get ' + coinsOf(p).toLocaleString('ru-RU') + ' V</span>';
  }
  function applyPromo() {
    const input = $('promoInput');
    const msg = $('shopMsg');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code) return;
    if (!Object.prototype.hasOwnProperty.call(CONFIG.promos, code)) {
      discount = 0;
      if (msg) { msg.className = 'msg err'; msg.textContent = L('Промокод не найден', 'Promo code not found'); }
      renderPacks(); renderPayBtn();
      return;
    }
    const p = CONFIG.promos[code];
    if (p > 0 && p <= 100) {
      discount = p;
      if (msg) { msg.className = 'msg ok'; msg.textContent = L('Скидка ' + p + '% на пакет', p + '% off the pack'); }
      renderPacks(); renderPayBtn();
    } else {
      // бонусные V без покупки — как награда за активность
      if (msg) { msg.className = 'msg ok'; msg.textContent = L('+' + p + ' V начислено', '+' + p + ' V credited'); }
      credit(p);
      pushLog('Промокод ' + code, 'Promo ' + code, p);
      showToast('+' + p + ' V');
      if (input) input.value = '';
    }
  }
  /* --- реальные платёжные провайдеры: одна точка входа ------------------ */
  // Сервер сам решает, какой шлюз использовать (SHOP_PROVIDER) и какую цену взять:
  // браузер присылает только id пакета. Начисление — после подтверждения оплаты.
  let shopMode = 'demo';   // 'demo' | 'server'

  function setShopMode(mode, note) {
    shopMode = mode === 'server' ? 'server' : 'demo';
    const strip = $('demoStrip');
    if (strip) strip.innerHTML = shopMode === 'server'
      ? '<b>SECURE</b> · ' + L('оплата через сервер: монеты начисляются после подтверждения платёжной системы (вебхук).', 'server-side checkout: coins are credited after the payment provider confirms the order (webhook).')
      : '<b>DEMO</b> · ' + L('платёжный шлюз не подключён: нажатие «Оплатить» показывает демо-оплату и начисляет монеты локально. Реальные списания не происходят.', 'no payment gateway connected: "Pay" runs a demo checkout and credits coins locally. Nothing is charged.');
    if (note) {
      const msg = $('shopMsg');
      if (msg) { msg.className = 'msg'; msg.textContent = note; }
    }
  }
  async function loadShopState() {
    try {
      const r = await fetch('/api/shop/packs', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('application/json')) throw new Error('no api');
      const data = await r.json();
      setShopMode(data.configured ? 'server' : 'demo');
    } catch (e) { setShopMode('demo'); }
    // после редиректа с оплаты: подтверждаем заказ и начисляем монеты ровно один раз
    const params = new URLSearchParams(location.search);
    const order = params.get('order');
    if (order && params.get('paid') === '1') { await claimOrder(order); }
    if (params.get('cancelled') === '1') {
      const msg = $('shopMsg');
      if (msg) { msg.className = 'msg err'; msg.textContent = L('Оплата отменена — монеты не начислены.', 'Checkout cancelled — no coins credited.'); }
    }
    if (order || params.get('cancelled')) {
      try { const clean = new URL(location.href); ['paid', 'order', 'cancelled'].forEach((k) => clean.searchParams.delete(k)); history.replaceState(null, '', clean.pathname + clean.search + clean.hash); } catch (e) {}
    }
  }
  async function claimOrder(orderId) {
    try {
      const r = await fetch('/api/shop/claim', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: orderId }) });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.msg || 'CLAIM_FAILED');
      if (!data.already) {
        credit(Number(data.coins) || 0);
        pushLog('Покупка монет', 'Coin purchase', Number(data.coins) || 0);
        showToast(L('+' + Number(data.coins).toLocaleString('ru-RU') + ' V зачислено', '+' + Number(data.coins).toLocaleString('ru-RU') + ' V credited'));
      }
      const msg = $('shopMsg');
      if (msg) { msg.className = 'msg ok'; msg.textContent = L('Оплата подтверждена, монеты на счёте.', 'Payment confirmed, coins credited.'); }
      syncHeader();
    } catch (e) {
      const msg = $('shopMsg');
      if (msg) { msg.className = 'msg err'; msg.textContent = L('Оплата ещё обрабатывается. Обновите страницу через минуту — монеты не потеряются.', 'Payment is still being processed. Reload in a minute — your coins are safe.'); }
    }
  }
  async function pay() {
    if (!requireUser('Покупка монет', 'Buying coins')) return;
    const pack = packById(packId);
    if (shopMode === 'demo') return openPayDemo(pack);
    const btn = $('payBtn');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/shop/order', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: pack.id, method: methodId }) });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.msg || 'ORDER_FAILED');
      if (typeof data.redirectUrl === 'string' && /^https:\/\//.test(data.redirectUrl)) { location.assign(data.redirectUrl); return; }
      throw new Error('NO_REDIRECT');
    } catch (e) {
      const msg = $('shopMsg');
      if (msg) { msg.className = 'msg err'; msg.textContent = (e && e.message && e.message !== 'ORDER_FAILED' && e.message !== 'NO_REDIRECT') ? e.message : L('Оплата недоступна: сервер платежей не ответил. Проверьте SHOP_PROVIDER и ключи (CASINO_SETUP.md).', 'Payment unavailable: the payment server did not respond. Check SHOP_PROVIDER and keys (CASINO_SETUP.md).'); }
    } finally { if (btn) btn.disabled = false; }
  }
  let payDemoPack = null;
  function openPayDemo(pack) {
    payDemoPack = pack;
    const box = $('payDemoModal');
    if (!box) return;
    $('payDemoPack') && ($('payDemoPack').textContent = (isEn() ? pack.en : pack.ru) + ' · ' + pack.coins.toLocaleString('ru-RU') + ' V');
    $('payDemoCoins') && ($('payDemoCoins').textContent = '+' + coinsOf(pack).toLocaleString('ru-RU') + ' V');
    const m = CONFIG.methods.find((x) => x.id === methodId) || CONFIG.methods[0];
    $('payDemoMethod') && ($('payDemoMethod').textContent = (isEn() ? m.en : m.ru) + ' · ' + m.sub);
    $('payDemoPrice') && ($('payDemoPrice').textContent = priceOf(pack) + ' ' + curOf());
    box.classList.add('open');
  }
  function togglePayDemo(open) {
    const box = $('payDemoModal');
    if (box) box.classList.toggle('open', !!open);
  }
  function confirmPayDemo() {
    if (!payDemoPack) return;
    const pack = payDemoPack;
    const coins = coinsOf(pack);
    let pays = [];
    try { pays = JSON.parse(LS(perUser(K.pays)) || '[]'); } catch (e) {}
    pays.unshift({ id: pack.id, coins: coins, amount: priceOf(pack), cur: curOf(), t: Date.now() });
    LS(perUser(K.pays), JSON.stringify(pays.slice(0, 20)));
    togglePayDemo(false);
    credit(coins);
    pushLog('Покупка пакета «' + (pack.ru) + '»', 'Pack "' + pack.en + '" purchase', coins);
    showToast(L('Зачислено ' + coins.toLocaleString('ru-RU') + ' V', '+' + coins.toLocaleString('ru-RU') + ' V credited'));
    const msg = $('shopMsg');
    if (msg) { msg.className = 'msg ok'; msg.textContent = L('Демо-оплата прошла, монеты начислены.', 'Demo checkout complete, coins credited.'); }
    syncHeader();
  }
  // Магазин — секция страницы: «открыть» = прокрутить и подсветить
  function toggleCoinShop(open) {
    const box = $('shop');
    if (!box) return;
    if (!open) return;
    renderPacks(); renderMethods(); renderPayBtn(); syncHeader();
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('pulse');
    void box.offsetWidth;
    box.classList.add('pulse');
    setTimeout(() => box.classList.remove('pulse'), 1300);
  }

  /* ==========================================================================
   *  ВИТРИНА (лидерборд) + лента
   * ====================================================================== */
  function renderShelf() {
    const box = $('exList');
    if (!box) return;
    const users = Object.values(db()).filter((u) => u && !u.banned).sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0)).slice(0, 5);
    if (!users.length) {
      box.innerHTML = '<div class="ex-row"><span class="ex-rank">1</span><span class="ex-name">' + L('Зарегистрируйся и стань первым', 'Sign up and lead the shelf') + '</span><span class="ex-val">0 V</span></div>';
      return;
    }
    box.innerHTML = users.map((u, i) =>
      '<div class="ex-row"><span class="ex-rank">' + (i + 1) + '</span><span class="ex-name" style="color:' + ((u.color && COLS[u.color]) || '#f3f7fb') + '">' + esc(u.username) + '</span><span class="ex-val">' + (Number(u.balance) || 0).toLocaleString('ru-RU') + ' V</span></div>'
    ).join('');
  }

  /* ==========================================================================
   *  AUTH (упрощённо; подробности — в auth-client-runtime на других страницах)
   * ====================================================================== */
  const authModal = $('authModal');
  let logged = current();

  function toggleAuth(open) {
    if (!authModal) return;
    authModal.classList.toggle('open', !!open);
    if (open) { openTab(logged ? 'acct' : 'login'); refreshAccount(); }
  }
  function openTab(t) {
    logged = current();
    $('tabLogin') && $('tabLogin').classList.toggle('on', t === 'login');
    $('tabReg') && $('tabReg').classList.toggle('on', t === 'reg');
    const fl = $('formLogin'), fr = $('formReg'), ap = $('accountPanel');
    if (fl) { fl.classList.toggle('hidden', t !== 'login'); fl.style.display = t === 'login' ? '' : 'none'; }
    if (fr) { fr.classList.toggle('hidden', t !== 'reg'); fr.style.display = t === 'reg' ? '' : 'none'; }
    if (ap) { ap.classList.toggle('hidden', t !== 'acct'); ap.style.display = t === 'acct' ? '' : 'none'; }
    if (t === 'reg') bindRegChecks();
  }
  function refreshAccount() {
    const u = current();
    logged = u;
    $('acctName') && ($('acctName').textContent = u || '');
    syncHeader();
    if (u) renderProfile();
  }
  function authMsg(text, error) {
    const m = $('authMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'msg' + (error ? ' err' : ' ok');
  }
  function doLogin(e) {
    e.preventDefault();
    const u = ($('lgUser') || {}).value || '';
    const p = ($('lgPass') || {}).value || '';
    const r = VA ? VA.loginCheck(u.trim(), p) : { ok: false, msg: 'Аккаунты недоступны' };
    if (!r.ok) { authMsg(r.msg, true); return; }
    VA.setCurrent(r.username || u.trim());
    authMsg('');
    toggleAuth(false);
    refreshAccount();
    renderDaily(); renderAd(); renderTickets(); renderLog();
    showToast('Welcome, ' + (r.username || u) + '!');
  }
  function doRegister(e) {
    e.preventDefault();
    const u = (($('rgUser') || {}).value || '').trim();
    const email = (($('rgEmail') || {}).value || '').trim();
    const p = ($('rgPass') || {}).value || '';
    const p2 = ($('rgPass2') || {}).value || '';
    if (!u) return authMsg(L('Введите ник', 'Enter a username'), true);
    if (p.length < 4) return authMsg(L('Пароль от 4 символов', 'Min 4 characters'), true);
    if (p !== p2) return authMsg(L('Пароли не совпадают', 'Passwords differ'), true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authMsg(L('Некорректный email', 'Invalid email'), true);
    const r = VA ? VA.register({ username: u, email: email, password: p }) : { ok: false, msg: '—' };
    if (!r.ok) return authMsg(r.msg, true);
    if (r.user && r.user.username) VA.setCurrent(r.user.username);
    else VA.setCurrent(u);
    authMsg('');
    toggleAuth(false);
    refreshAccount();
    showToast(L('Аккаунт создан! +100 V', 'Account created! +100 V'));
    pushLog('Стартовый баланс', 'Welcome bonus', 100);
  }
  function logout() {
    VA && VA.setCurrent(null);
    logged = null;
    refreshAccount();
    renderDaily(); renderAd(); renderTickets(); renderLog(); renderShelf();
  }
  function bindRegChecks() {
    ['rgUser', 'rgEmail'].forEach((id) => {
      const f = $(id);
      if (!f || f._bound) return;
      f._bound = 1;
      f.addEventListener('input', () => {
        const u = (($('rgUser') || {}).value || '').trim();
        const e = (($('rgEmail') || {}).value || '').trim();
        const h = $('regHint');
        if (!h) return;
        let text = '', bad = true;
        if (u && VA && VA.usernameTaken(u)) text = L('Этот ник уже занят', 'Username is taken');
        else if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) text = L('Некорректный email', 'Invalid email');
        else if (e && VA && VA.emailTaken(e)) text = L('Этот email уже используется', 'Email already used');
        else { bad = false; text = L('Можно регистрироваться', 'Looks good'); }
        h.textContent = text;
        h.className = 'reg-hint' + (bad ? ' bad' : ' good');
      });
    });
  }

  /* ----------------------------------------------------------------- профиль */
  function toggleProfile(open) {
    const box = $('profileModal');
    if (!box) return;
    box.classList.toggle('open', !!open);
    if (!open) return;
    const u = current();
    $('profLogged') && $('profLogged').classList.toggle('hidden', !u);
    $('profGuest') && $('profGuest').classList.toggle('hidden', !!u);
    if (u) renderProfile();
  }
  function renderProfile() {
    const u = current();
    if (!u) return;
    const r = rec(u) || {};
    const color = userColor(u);
    $('profAvatar') && ($('profAvatar').innerHTML = ic(avatarIcon(u), 26));
    $('profAvatar') && ($('profAvatar').style.color = color);
    $('profName') && ($('profName').textContent = u);
    $('profName') && ($('profName').style.color = color);
    $('profTitle') && ($('profTitle').textContent = userTitle(u));
    $('profCoins') && ($('profCoins').textContent = balance());
    // пикеры: показываем купленное, выбор сохраняется тем же способом, что и в магазине каталога
    const owned = Array.isArray(r.owned) ? r.owned : [];
    const mk = (host, items, sel, paint) => {
      const box = $(host);
      if (!box) return;
      box.innerHTML = '';
      items.forEach((it) => {
        const id = it[0];
        const has = owned.indexOf(id) >= 0 || it[2] === 0;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick' + (id === sel ? ' on' : '');
        b.disabled = !has;
        b.style.cssText = 'width:52px;height:52px;border-radius:11px;border:1px solid var(--line);background:var(--card2);color:var(--text);cursor:pointer;display:grid;place-items:center;font-size:11px;padding:0;' + (has ? '' : 'opacity:.35;');
        b.innerHTML = paint(it);
        b.onclick = () => {
          if (!has) return;
          const d = db();
          if (!d[u]) return;
          if (host === 'pickerAv') d[u].avatar = id;
          if (host === 'pickerCol') d[u].color = id;
          if (host === 'pickerTitle') d[u].title = id;
          save(d);
          renderProfile();
          syncHeader();
        };
        box.appendChild(b);
      });
    };
    mk('pickerAv', [['av:rocket', 'rocket', 0], ['av:fox', 'fox', 100], ['av:alien', 'alien', 120], ['av:tiger', 'tiger', 130], ['av:dragon', 'dragon', 160], ['av:bot', 'bot', 200], ['av:phoenix', 'phoenix', 250], ['av:gem', 'gem', 300]], r.avatar || 'av:rocket', (it) => ic(it[1], 22));
    mk('pickerCol', Object.keys(COLS).map((k) => [k, COLS[k], k === 'col:teal' ? 0 : 60]), r.color || 'col:teal', (it) => '<span style="width:22px;height:22px;border-radius:7px;background:' + it[1] + ';display:block;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)"></span>');
    mk('pickerTitle', Object.keys(TITLES).map((k, i) => [k, TITLES[k], i === 0 ? 0 : 80]), r.title || 't:new', (it) => '<span style="font-size:10.5px;line-height:1.15;text-align:center;padding:0 3px">' + (isEn() ? it[1][1] : it[1][0]) + '</span>');
  }

  /* ------------------------------------------------------------------- язык */
  function setLang(l) {
    document.body.setAttribute('lang', l);
    LS('nl_lang', l);
    $('langRu') && $('langRu').classList.toggle('on', l === 'ru');
    $('langEn') && $('langEn').classList.toggle('on', l === 'en');
    renderPaytable(); renderPacks(); renderPayBtn(); renderAd(); renderDaily(); renderLog(); renderShelf(); renderTickets();
    if (current()) renderProfile();
  }

  /* ---------------------------------------------------------------- иконки UI */
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/><circle cx="12" cy="12" r="2"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M9 9l3 6 3-6"/>',
    gem: '<path d="M6 4h12l4 5-10 11L2 9z"/><path d="M2 9h20M9.5 4l2.5 5-2.5 11L7 9zM14.5 4L12 9l2.5 11L17 9z"/>',
    crown: '<path d="M3 8l4 4 5-6 5 6 4-4-2 10H5z"/>',
    star: '<path d="M12 3l2.7 6 6.3.5-4.7 4.2 1.4 6.3-5.7-3.4-5.7 3.4 1.4-6.3L3 9.5 9.3 9z"/>',
    spark: '<path d="M13 3L5 13h5l-1 8 8-10h-5z"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.3"/>',
    cart: '<path d="M4 5h2l2.5 11h9l2.5-8H7"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
    bolt: '<path d="M13 3L6 13h5l-1 8 8-10h-5z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    shield: '<path d="M12 3l7 3v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V6z"/><path d="M9 12l2 2 4-4"/>',
    game: '<path d="M6 9h12a4 4 0 0 1 4 5l-1 3.5a2 2 0 0 1-3.6.6L15 16H9l-2.4 2.1a2 2 0 0 1-3.6-.6L2 14a4 4 0 0 1 4-5z"/><path d="M8 12v3M6.5 13.5h3"/><circle cx="16" cy="12" r=".9"/><circle cx="18" cy="14" r=".9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    rocket: '<path d="M12 3c3 2.5 4 6 4 9l-4 4-4-4c0-3 1-6.5 4-9z"/><path d="M8 12H5l-2-2v3l3 2M16 12h3l2-2v3l-3 2M12 16v5"/>',
    fox: '<path d="M4 5l4 3h8l4-3L19 13l-4 6H9l-4-6z"/><path d="M9.5 12h.01M14.5 12h.01"/>',
    alien: '<circle cx="12" cy="11" r="7"/><ellipse cx="9.5" cy="11" rx="1.7" ry="2.6" fill="currentColor" stroke="none"/><ellipse cx="14.5" cy="11" rx="1.7" ry="2.6" fill="currentColor" stroke="none"/><path d="M10 20l2-3 2 3"/>',
    tiger: '<path d="M4 6l4 3h8l4-3 1 4-2 8H5l-2-8z"/><path d="M9 15c2 1.5 4 1.5 6 0"/>',
    dragon: '<path d="M4 18c1-5 6-9 11-9 4 0 6 2 6 2-1 4-5 9-10 9-3 0-5-1-7-2z"/><path d="M9 12c2-1 5 0 6 2M7 15c2 0 3-1 4-2"/><path d="M8 19l-1 2M13 19l1 2"/>',
    bot: '<rect x="6" y="7" width="12" height="10" rx="3"/><circle cx="9.5" cy="11.5" r="1"/><circle cx="14.5" cy="11.5" r="1"/><path d="M9 14h6M12 4v3"/>',
    phoenix: '<path d="M6 17c6 2 11-1 12-7-2 2-4 1-5-1 1-4 6-4 8-4-1 7-5 13-12 15"/><path d="M5 17c-2 1-2 3-1 4"/>'
  };
  function hydrateIcons() {
    document.querySelectorAll('[data-ic]').forEach((el) => {
      el.innerHTML = ic(el.getAttribute('data-ic'), Number(el.getAttribute('data-s')) || 20);
    });
  }

  /* ================================================================ стартовая */
  function renderRtp() {
    const badge = $('rtpBadge');
    if (!badge) return;
    const rtp = Math.round(computeRtp() * 100) + '%';
    badge.textContent = 'RTP ' + rtp;
    const inline = $('rtpInline');
    if (inline) inline.textContent = rtp;
    badge.title = L('Средний возврат ставок на длинной дистанции', 'Average long-run return to player');
  }
  function renderAll() {
    renderRtp();
    renderStakes();
    renderPacks();
    renderMethods();
    renderPayBtn();
    renderPaytable();
    renderAd();
    renderDaily();
    renderTickets();
    renderLog();
    renderShelf();
    syncHeader();
  }

  function init() {
    Object.assign(IC, ICONS);
    hydrateIcons();
    renderInitial();
    renderAll();
    loadAdProvider();
    CONFIG.adProvider = (window.VG_CASINO_CONFIG && window.VG_CASINO_CONFIG.adProvider) || CONFIG.adProvider;
    loadShopState();

    $('spinBtn') && $('spinBtn').addEventListener('click', spin);
    $('adBtn') && $('adBtn').addEventListener('click', () => showRewardedAd(grantAdReward, onAdSkip));
    $('adSkipBtn') && $('adSkipBtn').addEventListener('click', () => closeAdDemo(false));
    $('dailyBtn') && $('dailyBtn').addEventListener('click', claimDaily);
    $('convertBtn') && $('convertBtn').addEventListener('click', convertTickets);
    $('promoBtn') && $('promoBtn').addEventListener('click', applyPromo);
    $('promoInput') && $('promoInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPromo(); });
    $('payBtn') && $('payBtn').addEventListener('click', pay);
    $('payDemoOk') && $('payDemoOk').addEventListener('click', confirmPayDemo);
    $('authButton') && $('authButton').addEventListener('click', () => { current() ? toggleProfile(true) : toggleAuth(true); });
    $('authModal') && $('authModal').addEventListener('click', (e) => { if (e.target === $('authModal')) toggleAuth(false); });
    $('profileModal') && $('profileModal').addEventListener('click', (e) => { if (e.target === $('profileModal')) toggleProfile(false); });
    $('payDemoModal') && $('payDemoModal').addEventListener('click', (e) => { if (e.target === $('payDemoModal')) togglePayDemo(false); });
    $('langRu') && $('langRu').addEventListener('click', () => setLang('ru'));
    $('langEn') && $('langEn').addEventListener('click', () => setLang('en'));

    const saved = LS('nl_lang');
    if (saved) setLang(saved);
    window.addEventListener('resize', () => { for (let i = 0; i < 3; i++) { const s = $('strip' + i); if (s && !spinning) buildStrip(i, grid[i]); } });

    // интерфейс для будущего серверного режима: window.CASINO.credit(n) и т.п.
    window.CASINO = {
      config: CONFIG, balance: balance, credit: credit, tickets: () => getNum(K.tickets),
      spin: spin, claimDaily: claimDaily, openShop: () => toggleCoinShop(true)
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // экспорт для отладки в консоли
  window.VG_CASINO = { get state() { return { stake: stake, spinning: spinning, pack: packId, method: methodId, left: adState().left }; } };
})();
