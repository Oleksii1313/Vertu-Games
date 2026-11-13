/* ============================================================================
   VERTU GAMES · общий клиент платформы
   - единый API-хелпер (cookie-сессии, ошибки, CSRF-заголовок)
   - шапка: баланс, аккаунт, язык, мобильное меню
   - авторизация через сервер (ник + пароль + Cloudflare Turnstile)
   - магазин, профиль, тосты, скелетоны
   Баланс НИКОГДА не хранится в браузере: он приходит с сервера.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var VG = window.VG || {};
  window.VG = VG;

  /* ------------------------------------------------------------------ utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }
  function lang() {
    try { return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ru'; } catch (e) { return 'ru'; }
  }
  function T(ru, en) { return lang() === 'en' ? en : ru; }
  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString(lang() === 'en' ? 'en-US' : 'ru-RU');
  }
  function date(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts) * 1000);
    return d.toLocaleDateString(lang() === 'en' ? 'en-GB' : 'ru-RU',
      { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function timeAgo(ts) {
    var diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts || 0));
    if (diff < 60) return T('только что', 'just now');
    if (diff < 3600) return T(Math.floor(diff / 60) + ' мин назад', Math.floor(diff / 60) + ' min ago');
    if (diff < 86400) return T(Math.floor(diff / 3600) + ' ч назад', Math.floor(diff / 3600) + ' h ago');
    return T(Math.floor(diff / 86400) + ' дн назад', Math.floor(diff / 86400) + ' d ago');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) {
    var timer = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms || 250);
    };
  }
  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, value);
      return value;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ icons */
  var ICONS = {
    coin: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5 12 16l3.5-7.5"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/><circle cx="12" cy="12" r="2"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/>',
    spark: '<path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3"/><path d="M12 13v4M9 20h6"/>',
    crown: '<path d="M4 17h16l-1.2-6.5-3.8 3-3-4.5-3 4.5-3.8-3L4 17Z"/>',
    star: '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z"/>',
    gem: '<path d="m6 4 6 2 6-2 3 6-9 10L3 10l3-6Z"/>',
    rocket: '<path d="M5 15c-1 2-1 5-1 5s3 0 5-1"/><path d="M9 14c-2 0-4-1-4-1 1-5 5-9 10-9 2 0 3 1 3 3 0 5-4 9-9 10 0 0-1-2 0-3Z"/><circle cx="14.5" cy="9.5" r="1.6"/>',
    fox: '<path d="M7 19 5 7l5 3h4l5-3-2 12-3-2h-4l-3 2Z"/><path d="M3 4l4 3M21 4l-4 3"/>',
    tiger: '<path d="M4 5l4 3M20 5l-4 3"/><ellipse cx="12" cy="13.5" rx="7" ry="6"/><path d="M9 11h.01M15 11h.01M12 14.5v2"/>',
    alien: '<ellipse cx="12" cy="12" rx="6.5" ry="8"/><path d="M10 10h.01M14 10h.01M9 15c2 1.5 4 1.5 6 0"/>',
    dragon: '<path d="M5 8c2 0 4 1 4 4 0 3 2 5 5 5 3 0 5-2 5-4 0-3-2-5-4-5-1 0-2 .5-2 1.5"/><path d="M4 20 7 16"/><circle cx="15" cy="10" r="1"/>',
    bot: '<rect x="4" y="7" width="16" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01"/><path d="M9 16h6"/>',
    phoenix: '<path d="M12 20c3 0 6-2 6-5 0-4-6-10-6-10S6 11 6 15c0 3 3 5 6 5Z"/><path d="M10 15h4"/>',
    gamepad: '<rect x="3" y="8" width="18" height="9" rx="4"/><path d="M8 12h3M9.5 10.5v3M15.5 12h.01M18 13.5h.01"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    platforms: '<path d="M3 16h6v4H3zM10 11h6v4h-6zM17 6h4v4h-4z"/>',
    ball: '<circle cx="12" cy="12" r="8"/><path d="M6 12h12M12 4v16"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    snake: '<path d="M4 7h8a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h8"/><circle cx="18" cy="19" r="1.4"/>',
    cube: '<path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z"/><path d="m5 7 7 4 7-4M12 11v10"/>',
    doodle: '<path d="M12 3v6M12 15v6M4.5 7.5 8 11M16 13l3.5 3.5M19.5 7.5 16 11M8 13l-3.5 3.5"/><circle cx="12" cy="12" r="2.5"/>',
    racecar: '<path d="M4 15h16l-1.5-4a3 3 0 0 0-3-2h-5L8 6H5l1 3"/><circle cx="7.5" cy="15.5" r="2"/><circle cx="16.5" cy="15.5" r="2"/>',
    drone: '<circle cx="12" cy="12" r="2.5"/><path d="M9.5 9.5 6 6M14.5 9.5 18 6M9.5 14.5 6 18M14.5 14.5 18 18"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>',
    rover: '<rect x="5" y="8" width="14" height="7" rx="2"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/><path d="M9 8V5h6v3"/>',
    bag: '<path d="M5 8h14l-1.5 11h-11L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    play: '<path d="M8 5v14l11-7-11-7Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1"/>',
    logout: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M9 12h10"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    fire: '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3s1-1 1-2c0-2-1-4-2-6Z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    bolt: '<path d="M13 3 5 14h5l-1 7 8-11h-5l1-7Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
    expand: '<path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/>',
    compress: '<path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/>'
  };
  function icon(name, size) {
    var path = ICONS[name] || ICONS.spark;
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + '</svg>';
  }
  VG.icon = icon;
  VG.icons = ICONS;

  var AVATAR_ICONS = {
    'av:rocket': 'rocket', 'av:fox': 'fox', 'av:tiger': 'tiger', 'av:alien': 'alien',
    'av:dragon': 'dragon', 'av:bot': 'bot', 'av:phoenix': 'phoenix', 'av:gem': 'gem'
  };
  var COLOR_HEX = {
    'col:teal': '#2ee6c8', 'col:lime': '#c6ff3d', 'col:violet': '#8b5cf6',
    'col:magenta': '#ff2d95', 'col:gold': '#e8b64c', 'col:cyan': '#22d3ee',
    'col:blue': '#3b82f6', 'col:indigo': '#6366f1', 'col:pink': '#ff5fb0',
    'col:crimson': '#ef4444', 'col:viper': '#37d67a'
  };
  var TITLES = {
    't:new': ['Новичок', 'Rookie'], 't:vet': ['Ветеран', 'Veteran'],
    't:ace': ['Ас', 'Ace'], 't:legend': ['Легенда', 'Legend']
  };
  function avatarHtml(user, size) {
    var s = size || 32;
    var ic = AVATAR_ICONS[(user && user.avatar) || 'av:rocket'] || 'rocket';
    var col = COLOR_HEX[(user && user.color) || 'col:teal'] || '#2ee6c8';
    return '<span class="avatar" style="width:' + s + 'px;height:' + s + 'px;color:' + col +
      ';border-color:' + col + '55;background:' + col + '1a">' + icon(ic, Math.round(s * 0.58)) + '</span>';
  }
  function titleLabel(user) {
    var pair = TITLES[(user && user.title) || 't:new'] || TITLES['t:new'];
    return lang() === 'en' ? pair[1] : pair[0];
  }
  VG.avatarHtml = avatarHtml;
  VG.titleLabel = titleLabel;
  VG.colorHex = function (id) { return COLOR_HEX[id] || '#2ee6c8'; };

  /* -------------------------------------------------------------------- api */
  function ApiError(message, code, status, data) {
    this.name = 'ApiError';
    this.message = message;
    this.code = code || 'ERROR';
    this.status = status || 0;
    // Дополнительные поля ответа (например, лимиты колеса для обратного отсчёта).
    this.data = data || null;
    if (data && data.limits) this.limits = data.limits;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function api(path, options) {
    var opts = options || {};
    var config = {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (opts.body !== undefined) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(opts.body);
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    if (opts.signal) config.signal = opts.signal;
    return fetch(path, config).then(function (response) {
      var type = response.headers.get('Content-Type') || '';
      if (type.indexOf('application/json') === -1) {
        throw new ApiError(T('Сервер недоступен. Откройте сайт через серверный адрес.',
          'The server is unavailable. Open the site through its server URL.'), 'BACKEND', response.status);
      }
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) {
          throw new ApiError(data.msg || T('Не удалось выполнить запрос.', 'Request failed.'),
            data.code, response.status, data);
        }
        return data;
      });
    }, function (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new ApiError(T('Нет соединения с сервером.', 'Cannot reach the server.'), 'NETWORK', 0);
    });
  }
  VG.api = api;
  VG.ApiError = ApiError;

  /* ----------------------------------------------------------------- toasts */
  function toast(message, kind) {
    var stack = $('.toast-stack');
    if (!stack) {
      stack = el('div', 'toast-stack');
      document.body.appendChild(stack);
    }
    var node = el('div', 'toast' + (kind === 'bad' ? ' bad' : ''), icon(kind === 'bad' ? 'x' : 'check', 18) +
      '<span>' + escapeHtml(message) + '</span>');
    stack.appendChild(node);
    setTimeout(function () {
      node.classList.add('leave');
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'bad' ? 4200 : 2800);
  }
  VG.toast = toast;

  /* ------------------------------------------------------------------ state */
  var state = { user: null, captcha: { enabled: false, siteKey: '' }, sessionReady: null,
    listeners: [], sessionListeners: [] };

  /* Подписка на изменения. fire(user, kind), где kind — 'coins' | 'identity'.
     kind='coins' — изменился только баланс (шапка, карточки), полную
     перерисовку делать не нужно. */
  function onChange(fn) {
    state.listeners.push(fn);
    if (state.sessionReady) fn(state.user, 'coins');
  }
  function onSessionChange(fn) {
    state.sessionListeners.push(fn);
    if (state.sessionReady) fn(state.user, 'identity');
  }
  function emit() {
    state.listeners.forEach(function (fn) { try { fn(state.user, 'coins'); } catch (e) {} });
  }
  function emitSession() {
    state.sessionListeners.forEach(function (fn) { try { fn(state.user, 'identity'); } catch (e) {} });
  }

  function setUser(user) {
    var previous = state.user;
    state.user = user || null;
    paintHeader();
    if (user && previous && user.coins !== previous.coins) bumpBalance();
    var identityChanged = (previous && previous.id) !== (user && user.id);
    applyGuestOnly();
    emit();
    if (identityChanged) emitSession();
  }

  /* Блоки с data-guest-only показываем только гостям: авторизованному игроку
     регистрационный баннер на главной не нужен и мешает. */
  function applyGuestOnly() {
    var signedIn = !!state.user;
    $$('[data-guest-only]').forEach(function (node) {
      node.classList.toggle('hidden', signedIn);
    });
  }
  function user() { return state.user; }
  function coins() { return state.user ? Number(state.user.coins) || 0 : 0; }

  function refreshSession() {
    state.sessionReady = api('/api/session').then(function (data) {
      state.captcha = data.captcha || { enabled: false, siteKey: '' };
      VG.session = data;
      state.achievementCount = data.achievements || 0;
      state.games = data.games || [];
      setUser(data.user);
      return data;
    }).catch(function (error) {
      state.sessionReady = Promise.resolve(null);
      if (error.code !== 'BACKEND') console.warn('session', error.message);
      paintHeader();
      return null;
    });
    return state.sessionReady;
  }
  function updateCoins(value) {
    if (!state.user) return;
    value = Number(value) || 0;
    if (state.user.coins === value) return;
    state.user.coins = value;
    paintHeader();
    bumpBalance();
    emit();
  }
  function bumpBalance() {
    var pill = $('.balance-pill');
    if (!pill) return;
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }

  /* ----------------------------------------------------------------- header */
  var NAV = [
    { href: 'index.html', key: 'home', ru: 'Главная', en: 'Home', icon: 'gamepad' },
    { href: 'top.html', key: 'catalog', ru: 'Каталог игр', en: 'Games', icon: 'grid' },
    { href: 'casino.html', key: 'casino', ru: 'Казино', en: 'Casino', icon: 'wheel' },
    { href: 'roulette.html', key: 'roulette', ru: 'Рулетка', en: 'Roulette', icon: 'spark' },
    { href: 'shop.html', key: 'shop', ru: 'Магазин', en: 'Shop', icon: 'bag' },
    { href: 'profile.html', key: 'profile', ru: 'Профиль', en: 'Profile', icon: 'user' }
  ];

  function logoHtml() {
    return '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true">' +
      '<rect x=".5" y=".5" width="39" height="39" rx="11" fill="url(#vgLogoBg)"/>' +
      '<rect x="1" y="1" width="38" height="38" rx="10.5" stroke="url(#vgLogoEdge)" stroke-opacity=".55"/>' +
      '<path d="M11 13 20 28 29 13h-5l-4 7-4-7h-5Z" fill="url(#vgLogoFg)"/>' +
      '<circle cx="20" cy="9.5" r="2.1" fill="#C6FF3D"/>' +
      '<defs><linearGradient id="vgLogoBg" x1="0" y1="0" x2="40" y2="40"><stop stop-color="#1D1533"/><stop offset="1" stop-color="#0B0E14"/></linearGradient>' +
      '<linearGradient id="vgLogoEdge" x1="0" y1="0" x2="40" y2="40"><stop stop-color="#C6FF3D"/><stop offset=".5" stop-color="#A855F7"/><stop offset="1" stop-color="#FF2D95"/></linearGradient>' +
      '<linearGradient id="vgLogoFg" x1="11" y1="13" x2="29" y2="28"><stop stop-color="#C6FF3D"/><stop offset=".55" stop-color="#F0FF7A"/><stop offset="1" stop-color="#2EE6C8"/></linearGradient></defs></svg>';
  }

  function paintHeader() {
    var header = $('.site-header');
    if (!header) return;
    var active = header.getAttribute('data-page') || '';
    var links = NAV.map(function (item) {
      return '<a href="' + item.href + '" class="' + (item.key === active ? 'active' : '') + '">' +
        icon(item.icon, 16) + T(item.ru, item.en) + '</a>';
    }).join('');
    var adminLink = state.user && state.user.isAdmin
      ? '<a href="admin.html" class="' + (active === 'admin' ? 'active' : '') + '">' + icon('shield', 16) + T('Админ', 'Admin') + '</a>'
      : '';
    var langValue = lang();
    var u = state.user;
    header.innerHTML =
      '<a href="index.html" class="brand" aria-label="Vertu Games">' + logoHtml() + '<span>VERT<b>GAMES</b></span></a>' +
      '<nav class="nav" aria-label="' + T('Навигация', 'Navigation') + '">' + links + adminLink + '</nav>' +
      '<div class="header-right">' +
      '<div class="lang" role="group" aria-label="Language">' +
      '<button type="button" data-lang="ru" aria-pressed="' + (langValue === 'ru') + '">RU</button>' +
      '<button type="button" data-lang="en" aria-pressed="' + (langValue === 'en') + '">EN</button></div>' +
      (u
        ? '<button type="button" class="balance-pill" data-action="balance" title="' + T('Ваш баланс V-монет', 'Your V-coin balance') + '">' +
          icon('coin', 16) + '<span data-coins>' + fmt(u.coins) + '</span> V</button>' +
          '<button type="button" class="avatar-btn" data-action="account" aria-haspopup="menu">' +
          avatarHtml(u, 32) + '<span class="who"><b>' + escapeHtml(u.username) + '</b><small>' +
          escapeHtml(titleLabel(u)) + '</small></span></button>'
        : '<button type="button" class="btn btn-ghost btn-sm" data-action="login">' + T('Вход', 'Sign in') + '</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="register">' + T('Регистрация', 'Sign up') + '</button>') +
      '<button type="button" class="burger" data-action="menu" aria-label="' + T('Меню', 'Menu') + '" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
      '</div>' +
      '<nav class="mobile-nav" id="vgMobileNav" aria-label="' + T('Мобильное меню', 'Mobile navigation') + '">' +
      links + adminLink +
      (u ? '' : '<a href="login.html" data-action="login">' + icon('lock', 16) + T('Вход / Регистрация', 'Sign in / Sign up') + '</a>') +
      '</nav>';
    wireHeader();
  }

  function wireHeader() {
    $$('.site-header [data-lang]').forEach(function (button) {
      button.addEventListener('click', function () { setLang(button.getAttribute('data-lang')); });
    });
    $$('.site-header [data-action]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        var action = button.getAttribute('data-action');
        if (action === 'menu') {
          var nav = $('#vgMobileNav');
          var open = nav.classList.toggle('open');
          button.setAttribute('aria-expanded', String(open));
          return;
        }
        closeMobileNav();
        if (action === 'balance' || action === 'account') {
          if (action === 'balance') { location.href = 'shop.html'; return; }
          openAccountMenu(button);
          return;
        }
        if (action === 'login') { location.href = 'login.html?tab=login'; return; }
        if (action === 'register') { location.href = 'login.html?tab=register'; return; }
      });
    });
  }

  function closeMobileNav() {
    var nav = $('#vgMobileNav');
    if (nav) nav.classList.remove('open');
    var burger = $('.burger');
    if (burger) burger.setAttribute('aria-expanded', 'false');
  }

  function openAccountMenu(anchor) {
    var panel = $('#accountMenu');
    if (panel) { panel.remove(); return; }
    panel = el('div', 'card', '');
    panel.id = 'accountMenu';
    panel.style.cssText = 'position:fixed;z-index:130;width:236px;padding:8px;top:auto';
    var links = [
      { href: 'profile.html', icon: 'user', ru: 'Мой профиль', en: 'My profile' },
      { href: 'shop.html', icon: 'bag', ru: 'Магазин', en: 'Shop' },
      { href: 'casino.html', icon: 'wheel', ru: 'Казино', en: 'Casino' }
    ];
    if (state.user && state.user.isAdmin) links.push({ href: 'admin.html', icon: 'shield', ru: 'Админ-панель', en: 'Admin panel' });
    panel.innerHTML = links.map(function (link) {
      return '<a href="' + link.href + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600">' +
        icon(link.icon, 16) + T(link.ru, link.en) + '</a>';
    }).join('') +
      '<div class="divider" style="margin:6px 0"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-block" data-action="logout">' + icon('logout', 15) + T('Выйти', 'Sign out') + '</button>';
    document.body.appendChild(panel);
    var rect = anchor.getBoundingClientRect();
    panel.style.top = Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 8) + 'px';
    panel.style.left = Math.max(12, Math.min(window.innerWidth - 248, rect.right - 236)) + 'px';
    panel.querySelector('[data-action=logout]').addEventListener('click', logout);
    setTimeout(function () {
      document.addEventListener('click', function close(event) {
        if (!panel.contains(event.target) && event.target !== anchor) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  }

  function setLang(value) {
    var next = value === 'en' ? 'en' : 'ru';
    document.documentElement.setAttribute('lang', next);
    document.body.setAttribute('data-lang', next);
    storage('vg_lang', next);
    $$('[data-ru]').forEach(function (node) {
      var text = next === 'en' ? node.getAttribute('data-en') : node.getAttribute('data-ru');
      if (text != null) node.innerHTML = text;
    });
    paintHeader();
    emit();
    if (typeof VG.onLangChange === 'function') VG.onLangChange(next);
  }
  function currentLang() { return lang(); }

  /* ------------------------------------------------------------------- auth */
  var turnstileWidgets = {};
  function renderTurnstile(container, onToken) {
    var cfg = state.captcha || {};
    if (!cfg.enabled || !container) {
      container.innerHTML = '';
      return;
    }
    var id = 'ts-' + Math.random().toString(36).slice(2);
    container.innerHTML = '<div id="' + id + '"></div>';
    var attempts = 0;
    (function mount() {
      if (!window.turnstile) {
        if (attempts++ > 40) {
          container.innerHTML = '<p class="hint bad">' + T('Не удалось загрузить CAPTCHA. Обновите страницу.',
            'Could not load CAPTCHA. Reload the page.') + '</p>';
          return;
        }
        return setTimeout(mount, 250);
      }
      turnstileWidgets[id] = window.turnstile.render('#' + id, {
        sitekey: cfg.siteKey,
        theme: 'dark',
        language: lang(),
        callback: function (token) { onToken(token); },
        'expired-callback': function () { onToken(''); },
        'error-callback': function () { onToken(''); }
      });
    })();
    return function () {
      if (window.turnstile && turnstileWidgets[id] != null) {
        try { window.turnstile.remove(turnstileWidgets[id]); } catch (e) {}
      }
      container.innerHTML = '';
    };
  }

  function login(username, password, turnstileToken) {
    return api('/api/auth/login', { body: { username: username, password: password, turnstileToken: turnstileToken || '' } })
      .then(function (data) {
        setUser(data.user);
        toast(T('С возвращением, ' + data.user.username + '!', 'Welcome back, ' + data.user.username + '!'));
        return data;
      });
  }
  function register(username, password, turnstileToken, startedAt) {
    return api('/api/auth/register', {
      body: { username: username, password: password, turnstileToken: turnstileToken || '', startedAt: startedAt || 0 }
    }).then(function (data) {
      setUser(data.user);
      toast(T('Аккаунт создан. Добро пожаловать!', 'Account created. Welcome!'));
      return data;
    });
  }
  function logout() {
    return api('/api/auth/logout', { body: {} }).then(function () {
      setUser(null);
      toast(T('Вы вышли из аккаунта.', 'You have signed out.'));
      if (/profile|admin|login/i.test(location.pathname)) location.href = 'index.html';
    }).catch(function () {
      setUser(null);
      toast(T('Вы вышли из аккаунта.', 'You have signed out.'));
    });
  }
  function changePassword(current, password) {
    return api('/api/auth/password', { body: { current: current, password: password } });
  }
  function requireAuth(reason) {
    if (state.user) return true;
    toast(reason || T('Войдите в аккаунт, чтобы продолжить.', 'Sign in to continue.'), 'bad');
    setTimeout(function () { location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search); }, 700);
    return false;
  }

  /* ------------------------------------------------------------------- shop */
  function purchase(itemId) {
    return api('/api/shop/buy', { body: { item: itemId } }).then(function (data) {
      if (data.user) setUser(data.user);
      // Достижения могут изменить баланс уже после покупки — берём итог с сервера.
      if (data.balance != null) updateCoins(data.balance);
      (data.achievements || []).forEach(function (entry) {
        var ach = entry.achievement || entry;
        toast(T('Достижение: ' + (ach.name_ru || ach.name_en), 'Achievement: ' + (ach.name_en || ach.name_ru)) +
          (ach.coins ? ' +' + ach.coins + ' V' : ''));
      });
      toast(data.already ? T('Этот предмет уже куплен.', 'You already own this item.')
        : T('Покупка совершена!', 'Purchase complete!'));
      return data;
    });
  }
  function equip(itemId) {
    return api('/api/shop/equip', { body: { item: itemId } }).then(function (data) {
      if (data.user) setUser(data.user);
      return data;
    });
  }

  /* -------------------------------------------------------------- game play */
  /*
   * Клавиатура без клика. Игра живёт в iframe, и браузер отдаёт нажатия
   * только документу в фокусе. Поэтому после входа в игру ставим фокус на
   * iframe и повторяем попытку на pointermove/visibilitychange; если браузер
   * фокус не отдал — показываем аккуратную подсказку «кликните по игре».
   */
  var KEY_FOCUS_CODES = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1,
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyE: 1, KeyR: 1
  };
  var focusHint = null;
  var focusTimer = null;

  function ensureGameFocus(frame) {
    if (!frame || !VG.activeGame) return;
    try { frame.focus({ preventScroll: true }); } catch (e) { try { frame.focus(); } catch (e2) {} }
    VG.gameFocus = document.activeElement === frame;
    if (!VG.gameFocus) showFocusHint();
    else hideFocusHint();
  }
  function showFocusHint() {
    showFocusHint.armed = true;
    if (focusHint && focusHint.parentNode) { focusHint.classList.add('show'); return; }
    var overlay = $('#playOverlay');
    if (!overlay) return;
    focusHint = el('div', 'play-focus-hint');
    focusHint.innerHTML = icon('gamepad', 16) + '<span></span>';
    focusHint.firstChild && focusHint.firstChild.setAttribute('aria-hidden', 'true');
    focusHint.querySelector('span').textContent =
      T('Нажмите на игру, чтобы управлять с клавиатуры', 'Click the game to control it with the keyboard');
    focusHint.setAttribute('role', 'status');
    overlay.querySelector('.play-frame-wrap').appendChild(focusHint);
    // Клик по подсказке переводит фокус в игру.
    focusHint.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      var frame = overlay.querySelector('.play-frame');
      ensureGameFocus(frame);
    });
    setTimeout(function () { focusHint && focusHint.classList.add('show'); }, 10);
  }
  function hideFocusHint() {
    if (focusHint) {
      focusHint.classList.remove('show');
      focusHint.style.pointerEvents = 'none';
      setTimeout(function () { if (focusHint && !focusHint.classList.contains('show')) { focusHint.remove(); focusHint = null; } }, 220);
    }
  }
  function releaseGameFocus() {
    VG.gameFocus = false;
    hideFocusHint();
    if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
  }

  /*
   * Проброс клавиш. Игры лежат на том же origin, поэтому родитель может
   * продублировать нажатие прямо в окно игры: первая же стрелка/WASD/Space
   * работает без клика, а фокус переезжает в iframe на этом же событии.
   */
  function inEditableField(node) {
    if (!node || !node.tagName) return false;
    var tag = node.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
  }
  function forwardKeyToGame(event) {
    if (!VG.activeGame || inEditableField(event.target)) return false;
    var overlay = $('#playOverlay');
    var frame = overlay && overlay.querySelector('.play-frame');
    if (!frame || !frame.contentWindow) return false;
    var win = frame.contentWindow;
    var doc = null;
    try { doc = win.document; } catch (e) { doc = null; }
    if (!doc) return false;
    var init = {
      key: event.key, code: event.code, keyCode: event.keyCode, which: event.which,
      altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      metaKey: event.metaKey, repeat: event.repeat, bubbles: true, cancelable: true
    };
    // Одно событие на document: всплывая, оно доходит и до window-обработчиков игры.
    var Ctor = (win.KeyboardEvent || KeyboardEvent);
    try { doc.dispatchEvent(new Ctor(event.type, init)); } catch (e) {}
    ensureGameFocus(frame);
    if (event.cancelable) event.preventDefault();
    return true;
  }
  function onGameKey(event) {
    if (!VG.activeGame || !KEY_FOCUS_CODES[event.code]) return;
    if (document.activeElement === $('#gameFrame')) return; // игра уже получает клавиши сама
    forwardKeyToGame(event);
  }
  function bindGameKeyBridge() {
    if (bindGameKeyBridge.done) return;
    bindGameKeyBridge.done = true;
    document.addEventListener('keydown', onGameKey);
    document.addEventListener('keyup', onGameKey);
    // Любое движение мышью по игре тоже возвращает фокус, без лишних кликов.
    document.addEventListener('pointerup', function () {
      if (!VG.activeGame) return;
      var frame = $('#gameFrame');
      if (frame && document.activeElement !== frame) ensureGameFocus(frame);
    });
  }

  function openGame(game) {
    var overlay = $('#playOverlay');
    // На части страниц оверлей уже есть (пустой контейнер из разметки) —
    // тогда его содержимое тоже нужно собрать.
    if (!overlay) {
      overlay = el('div', 'play-overlay');
      overlay.id = 'playOverlay';
      document.body.appendChild(overlay);
    }
    if (!overlay.querySelector('.play-bar')) {
      overlay.innerHTML =
        '<div class="play-bar"><button type="button" class="btn btn-ghost btn-sm" data-close>' +
        icon('chev', 15) + T('Назад', 'Back') + '</button><h3></h3>' +
        '<span class="balance-pill" style="cursor:default">' + icon('coin', 15) + '<span data-coins>' + fmt(coins()) + '</span> V</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-fullscreen aria-pressed="false" title="' + T('На весь экран', 'Fullscreen') + '">' +
        icon('expand', 15) + '<span>' + T('Экран', 'Screen') + '</span></button></div>' +
        '<div class="play-frame-wrap"><iframe id="gameFrame" name="gameFrame" class="play-frame" allow="fullscreen; gamepad; autoplay" title="Game"></iframe></div>';
      overlay.querySelector('[data-close]').addEventListener('click', closeGame);
      overlay.querySelector('[data-fullscreen]').addEventListener('click', function () {
        var wrap = overlay.querySelector('.play-frame-wrap');
        if (document.fullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
          return;
        }
        // Полноэкранный режим: рамка плеера, а с ней и игра, занимает весь экран.
        var request = wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.msRequestFullscreen;
        if (!request) { toast(T('Браузер не поддерживает полноэкранный режим.', 'This browser does not support fullscreen.'), 'bad'); return; }
        try { request.call(wrap, { navigationUI: 'hide' }); } catch (e) { try { request.call(wrap); } catch (e2) {} }
      });
    }
    syncFullscreenButton();
    if (!overlay.querySelector('.reward-chip')) {
      var chip = el('span', 'badge badge-new reward-chip');
      chip.style.marginLeft = 'auto';
      overlay.querySelector('.play-bar h3').after(chip);
    }
    var rewardChip = overlay.querySelector('.reward-chip');
    rewardChip.textContent = '+' + (game.reward || 0) + ' V ' + T('за событие', 'per event');
    overlay.querySelector('h3').textContent = lang() === 'en' ? (game.name_en || game.name) : game.name;
    overlay.querySelector('[data-close]').innerHTML = icon('chev', 15) + '<span>' + T('Назад', 'Back') + '</span>';
    var frame = overlay.querySelector('.play-frame');
    var langParam = lang();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    VG.activeGame = game;
    // Автофокус: как только игра загрузилась — сразу отдаём ей клавиатуру.
    frame.onload = function () { ensureGameFocus(frame); };
    frame.src = game.file + '?lang=' + langParam;
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(function () { ensureGameFocus(frame); }, 260);
    bindGameKeyBridge();
    if (state.user) api('/api/games/play', { body: { game: game.id } }).then(function (data) {
      if (data.coins != null) updateCoins(data.coins);
    }).catch(function () {});
    /*
     * Мост к играм. Игры по-прежнему шлют те же сообщения, что и раньше, но
     * монеты начисляет сервер: сумма берётся из каталога, а суточный лимит и
     * квитанция проверяются на бэкенде. Клиент не может «нарисовать» баланс.
     */
    function acknowledge(source, payload) {
      try { source.postMessage(payload, location.origin); } catch (e) {}
    }
    function payout(amount, receipt, label) {
      if (!VG.user() || !VG.activeGame) return Promise.resolve(null);
      return api('/api/games/reward', {
        body: { game: VG.activeGame.id, receipt: receipt, amount: amount }
      }).then(function (data) {
        if (data.coins != null) updateCoins(data.coins);
        if (data.awarded > 0) {
          toast(T('+' + fmt(data.awarded) + ' V · ' + label, '+' + fmt(data.awarded) + ' V · ' + label));
        } else if (data.dailyLeft === 0) {
          toast(T('Суточный лимит наград по этой игре исчерпан.', 'The daily reward cap for this game is reached.'), 'bad');
        }
        return data;
      }).catch(function (error) {
        if (error.status === 429) toast(error.message, 'bad');
        return null;
      });
    }
    function receipt(prefix) {
      var random = (window.crypto && window.crypto.getRandomValues)
        ? Array.prototype.map.call(window.crypto.getRandomValues(new Uint8Array(8)), function (n) {
            return n.toString(16).padStart(2, '0');
          }).join('')
        : Math.random().toString(16).slice(2, 10);
      return prefix + '-' + Date.now().toString(36) + '-' + random;
    }
    function handleGameMessage(event) {
      var data = event.data;
      if (!data || typeof data !== 'object' || !VG.activeGame) return;
      var spec = VG.activeGame;
      var gameName = spec.id;
      var known = (state.games || []).filter(function (g) { return g.id === spec.id; })[0];
      if (!known) return;
      if (data.type === 'home') { closeGame(); return; }
      if ((data.game && data.game !== gameName) && data.type !== 'addCoins' && data.type !== 'gameOver') return;

      if (data.type === 'skyDeliveryReward' && data.game === 'skyisle' && data.deliveryId) {
        payout(known.reward, 'sky-' + String(data.deliveryId).slice(0, 40), T('доставка', 'delivery'))
          .then(function (result) {
            acknowledge(event.source, {
              type: 'skyDeliveryAck', game: 'skyisle', amount: 5,
              account: data.account, deliveryId: data.deliveryId, ok: !!(result && result.awarded)
            });
          });
        return;
      }
      if (data.type === 'redlineExchange' && data.game === 'redline') {
        if (data.credits !== 1000 || data.coins !== 100 || typeof data.id !== 'string') return;
        payout(known.reward, 'redline-' + String(data.id).slice(0, 60), T('обмен кредитов', 'credit exchange'))
          .then(function (result) {
            acknowledge(event.source, {
              type: 'redlineExchangeAck', id: data.id, game: 'redline',
              account: data.account, ok: !!(result && (result.awarded > 0 || result.repeated))
            });
          });
        return;
      }
      if (data.type === 'redlineExchangeHello') {
        acknowledge(event.source, { type: 'redlineExchangeReady', ready: !!VG.user(), game: 'redline',
          account: data.account });
        return;
      }
      if (data.type === 'roverPenalty' && data.game === 'rover') {
        // Штраф применяется только если на сервере у игрока есть монеты.
        acknowledge(event.source, { type: 'roverPenaltyResult', charged: 0 });
        return;
      }
      if (data.type === 'addCoins' || data.type === 'gameOver') {
        // Событие без собственной квитанции: начисляем одну награду за серию.
        if (data.type === 'gameOver') { toast(T('Игра окончена', 'Game over')); return; }
        if (window.__vgRewardLock && Date.now() - window.__vgRewardLock < 12000) return;
        window.__vgRewardLock = Date.now();
        payout(known.reward, receipt(gameName + '-event'), T('награда', 'reward'));
      }
    }
    window.removeEventListener('message', VG._gameHandler || function () {});
    VG._gameHandler = function (event) {
      if (event.origin !== location.origin) return;
      if (!overlay.classList.contains('open')) return;
      handleGameMessage(event);
    };
    window.addEventListener('message', VG._gameHandler);
  }

  function currentGameReward() {
    return VG.activeGame ? VG.activeGame.reward : 0;
  }
  function syncFullscreenButton() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    var button = overlay.querySelector('[data-fullscreen]');
    if (!button) return;
    var active = !!document.fullscreenElement;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    var label = button.querySelector('span');
    if (label) label.textContent = active ? T('Выйти', 'Exit') : T('Экран', 'Screen');
    // Иконка меняется между «развернуть» и «свернуть» вместе с состоянием.
    var glyph = button.querySelector('svg') && button.querySelector('svg').parentNode;
    if (glyph && glyph !== button) glyph.innerHTML = icon(active ? 'compress' : 'expand', 15);
    if (active) {
      var frame = overlay.querySelector('.play-frame');
      if (frame) setTimeout(function () { ensureGameFocus(frame); }, 120);
    }
  }
  if (!syncFullscreenButton.bound) {
    syncFullscreenButton.bound = true;
    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(function (name) {
      document.addEventListener(name, syncFullscreenButton);
    });
  }

  function closeGame() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    var frame = overlay.querySelector('.play-frame');
    if (frame) frame.src = 'about:blank';
    document.body.style.overflow = '';
    VG.activeGame = null;
    releaseGameFocus();
  }
  function refreshCoins() {
    if (!state.user) return Promise.resolve();
    return api('/api/balance').then(function (data) { updateCoins(data.coins); });
  }

  /* ------------------------------------------------------------------ export */
  VG.$ = $; VG.$$ = $$; VG.lookup = $; VG.lookupAll = $$; VG.el = el; VG.T = T; VG.fmt = fmt; VG.date = date; VG.timeAgo = timeAgo;
  VG.escapeHtml = escapeHtml; VG.debounce = debounce; VG.storage = storage;
  VG.user = user; VG.coins = coins; VG.setUser = setUser; VG.refreshSession = refreshSession;
  VG.updateCoins = updateCoins; VG.refreshCoins = refreshCoins; VG.onChange = onChange;
  VG.onSessionChange = onSessionChange;
  VG.login = login; VG.register = register; VG.logout = logout; VG.changePassword = changePassword;
  VG.requireAuth = requireAuth; VG.renderTurnstile = renderTurnstile;
  VG.purchase = purchase; VG.equip = equip; VG.openGame = openGame; VG.closeGame = closeGame;
  VG.setLang = setLang; VG.lang = currentLang;
  VG.currentGameReward = currentGameReward;
  /*
   * Совместимость с существующими играми: они читают ник через
   * parent.getCurrentUser() и ищут родительский #gameFrame. Ник берётся из
   * серверной сессии, локальный localStorage-пользователь больше не нужен.
   */
  window.getCurrentUser = function () {
    var user = VG.user();
    if (!user) return null;
    return { username: user.username, coins: user.coins, avatar: user.avatar };
  };
  VG.NAV = NAV;

  /* ---------------------------------------------------------- icon hydration */
  function hydrateIcons(root) {
    $$('[data-ico]', root || document).forEach(function (node) {
      var size = Number(node.getAttribute('data-size')) || 18;
      node.innerHTML = icon(node.getAttribute('data-ico'), size);
      node.removeAttribute('data-ico');
      node.style.display = 'inline-flex';
      node.style.alignItems = 'center';
      node.style.justifyContent = 'center';
    });
  }
  VG.hydrateIcons = hydrateIcons; VG.applyGuestOnly = applyGuestOnly;
  VG.iconHtml = function (name, size) { return '<span class="ico-inline">' + icon(name, size) + '</span>'; };

  /* -------------------------------------------------------------- bootstrap */
  function boot() {
    var saved = storage('vg_lang');
    if (saved === 'en' || saved === 'ru') {
      document.documentElement.setAttribute('lang', saved);
      document.body.setAttribute('data-lang', saved);
    }
    paintHeader();
    hydrateIcons();
    applyGuestOnly();
    refreshSession();
    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('[data-require-auth]');
      if (link && !state.user) {
        event.preventDefault();
        requireAuth();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
