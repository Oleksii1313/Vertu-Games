/* ============================================================================
   VERT GAMES · общий клиент платформы
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
  /* ------------------------------------------------------------- low-end ---
     «Лёгкий режим» для слабых машин: тяжёлые эффекты (backdrop-blur, большие
     тени, лишние слои композитинга) выключаются атрибутом на <html>, а игры
     получают ?perf=low и рисуют в меньшей плотности. Ничего не удаляется:
     на нормальном железе всё работает как раньше. Принудительно —
     ?perf=low / ?perf=high в адресе страницы.
     ------------------------------------------------------------------------ */
  function detectLowEnd() {
    var forced = '';
    try { forced = new URLSearchParams(location.search).get('perf') || ''; } catch (e) {}
    if (forced === 'high') return false;
    if (forced === 'low') return true;
    try {
      var memory = navigator.deviceMemory || 0;      // ГБ, только Chromium
      var cores = navigator.hardwareConcurrency || 0;
      var save = !!(navigator.connection && navigator.connection.saveData);
      return save || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 2);
    } catch (e) { return false; }
  }
  var LOW_END = detectLowEnd();
  try {
    var rootEl = document.documentElement;
    if (LOW_END) rootEl.setAttribute('data-lowend', '1');
    else rootEl.removeAttribute('data-lowend');
  } catch (e) {}
  VG.lowEnd = function () { return LOW_END; };

  /* Языки сайта: русский и английский. Значение хранится в атрибуте lang у
     <html>, поэтому его видят и вложенные страницы, и игры в iframe. */
  var LANGS = ['ru', 'en'];
  var LOCALE = { ru: 'ru-RU', en: 'en-US' };
  var DATE_LOCALE = { ru: 'ru-RU', en: 'en-GB' };
  function lang() {
    try {
      var value = document.documentElement.getAttribute('lang');
      return value === 'en' ? 'en' : 'ru';
    } catch (e) { return 'ru'; }
  }
  /* Перевод строки: русский и английский варианты; английский — запасной,
     чтобы на английской странице не появлялись русские подписи. */
  function T(ru, en) {
    return lang() === 'en' && en != null ? en : ru;
  }
  /* Результат ставки для истории. В старых базах остались множители, которых
     больше нет на колесе (x0.5, x0.25, x3, x4, x10): миграция помечает такие
     ставки как «past», а интерфейс показывает их как архив, чтобы на странице
     не было несуществующих секторов. */
  var SLOT_NAME_RU = {
    v: 'V', spark: 'искра', dice: 'кубик', star: 'звезда', gem: 'самоцвет',
    wheel: 'колесо', crown: 'корона'
  };
  function casinoOutcome(label) {
    var text = label == null ? '' : String(label);
    if (text === 'past') return T('архив', 'archived');
    // Исход слотов сервер пишет по-английски («triple star», «pair v»,
    // «no win») — на русской странице это выглядело как непереведённый текст.
    var match = /^(triple|pair)\s+(\w+)$/i.exec(text);
    if (match) {
      var symbol = match[2].toLowerCase();
      var ru = SLOT_NAME_RU[symbol] || symbol;
      return match[1].toLowerCase() === 'triple'
        ? T('три в ряд: ' + ru, 'triple ' + symbol)
        : T('пара: ' + ru, 'pair ' + symbol);
    }
    if (/^no win$/i.test(text)) return T('без выигрыша', 'no win');
    return text;
  }

  /* ------------------------------------------------------- история операций
     Сервер пишет причину операции по-русски в момент начисления («Игра: …»,
     «Достижение: …»), и эта строка уже лежит в базе — перевести её на сервере
     задним числом нельзя. Поэтому известные шаблоны переводим в интерфейсе:
     английская страница не должна показывать русские подписи. Ники и
     комментарии администратора — пользовательский текст, он остаётся как есть.
     Названия игр и предметов берём из каталога (у них уже есть name_en). */
  var KIND_LABELS = {
    game: ['Награда за игру', 'Game reward'],
    'game-units': ['Награда за игру', 'Game reward'],
    shop: ['Покупка в магазине', 'Shop purchase'],
    casino: ['Ставка в казино', 'Casino bet'],
    'casino-win': ['Выигрыш в казино', 'Casino win'],
    task: ['Награда за задание', 'Quest reward'],
    achievement: ['Достижение', 'Achievement'],
    welcome: ['Приветственный бонус', 'Welcome bonus'],
    admin: ['Изменение администратора', 'Admin adjustment'],
    other: ['Операция', 'Transaction']
  };
  function catalogLookup(list, key, ru, wanted) {
    var rows = (typeof window !== 'undefined' && window.VG_DATA && window.VG_DATA[list]) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][key] && String(rows[i][key]).toLowerCase() === String(ru).toLowerCase()) {
        return rows[i][wanted] || rows[i][key];
      }
    }
    return '';
  }
  /* Название игры: в каталоге есть пара name/name_en — на английской странице
     показываем то же имя, что и в каталоге игр. */
  function gameLabel(name) {
    var text = String(name == null ? '' : name).trim();
    if (!text) return '';
    if (lang() !== 'en') return text;
    return catalogLookup('games', 'name', text, 'name_en') || text;
  }
  function casinoGameLabel(name) {
    var key = String(name == null ? '' : name).trim().toLowerCase();
    if (key === 'slots' || key === 'slot') return T('Слоты', 'Slots');
    if (key === 'wheel' || key === 'roulette') return T('Колесо', 'Wheel');
    return gameLabel(name);
  }
  function ledgerReason(row) {
    if (!row) return '';
    var raw = row.reason == null ? '' : String(row.reason).trim();
    var kind = String(row.kind == null ? '' : row.kind).trim();
    var ru = lang() !== 'en';
    if (ru) return raw || (KIND_LABELS[kind] ? KIND_LABELS[kind][0] : '');
    if (!raw) return KIND_LABELS[kind] ? KIND_LABELS[kind][1] : KIND_LABELS.other[1];
    var m;
    // Причина совпадает с русской подписью категории — берём готовый перевод
    // («Приветственный бонус», «Изменение администратора» и т. п.).
    if (KIND_LABELS[kind] && raw === KIND_LABELS[kind][0]) return KIND_LABELS[kind][1];
    // «Игра: Космокухня»
    if ((m = raw.match(/^Игра:\s*(.+)$/i))) return 'Game: ' + gameLabel(m[1]);
    // «Космокухня: 12 ед. × 5 V» — награда за единицы события
    if ((m = raw.match(/^(.+?):\s*(\d+)\s*ед\.\s*×\s*(\d+)\s*V$/i))) {
      return gameLabel(m[1]) + ': ' + m[2] + ' units × ' + m[3] + ' V';
    }
    // «Snake: 3 обычных и 1 золотых яблок»
    if ((m = raw.match(/^Snake:\s*(\d+)\s*обычных и\s*(\d+)\s*золотых яблок$/i))) {
      return 'Snake: ' + m[1] + (m[1] === '1' ? ' apple' : ' apples') + ' and ' + m[2] +
        (m[2] === '1' ? ' golden apple' : ' golden apples');
    }
    // «С MiniCraft: 24 монет»
    if ((m = raw.match(/^С MiniCraft:\s*(\d+)\s*монет/i))) return 'From MiniCraft: ' + m[1] + ' coins';
    // «Ставка: slots» / «Выигрыш: wheel»
    if ((m = raw.match(/^Ставка:\s*(.+)$/i))) return 'Bet: ' + casinoGameLabel(m[1]);
    if ((m = raw.match(/^Выигрыш:\s*(.+)$/i))) return 'Win: ' + casinoGameLabel(m[1]);
    // «Достижение: Добро пожаловать» → имя из каталога на нужном языке
    if ((m = raw.match(/^Достижение:\s*(.+)$/i))) {
      var ach = catalogLookup('achievements', 'name_ru', m[1], 'name_en') || m[1];
      return 'Achievement: ' + ach;
    }
    // «Задание #3: награда»
    if ((m = raw.match(/^Задание\s*#(\d+):\s*награда$/i))) return 'Quest #' + m[1] + ': reward';
    // «Бонус: Ракета» — покупка с бонусными V
    if ((m = raw.match(/^Бонус:\s*(.+)$/i))) {
      var item = catalogLookup('shop', 'name_ru', m[1], 'name_en') || m[1];
      return 'Bonus: ' + item;
    }
    // Неизвестный шаблон (например, комментарий администратора) — как есть.
    return raw;
  }

  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString(LOCALE[lang()] || 'ru-RU');
  }
  function date(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts) * 1000);
    return d.toLocaleDateString(DATE_LOCALE[lang()] || 'ru-RU',
      { day: '2-digit', month: 'short', year: 'numeric' });
  }
  /* Склонение русских единиц: 1 минуту, 2 минуты, 5 минут. */
  function plural(n, one, few, many) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }
  /* Относительное время: «Только что», «5 минут назад», «2 часа назад»,
     «3 дня назад». Отсутствующая или испорченная метка — «Дата неизвестна»,
     а не «20775 дней назад» из 1970 года. Метка из будущего (рассинхрон
     часов клиента) тоже не превращается в отрицательное число. */
  function timeAgo(ts) {
    if (ts === null || ts === undefined || ts === '') return T('Дата неизвестна', 'Unknown date');
    var value = Number(ts);
    if (!isFinite(value) || value <= 0) return T('Дата неизвестна', 'Unknown date');
    var diff = Date.now() / 1000 - value;
    if (diff < -300) return T('Дата неизвестна', 'Unknown date');
    if (diff < 0) diff = 0;
    diff = Math.floor(diff);
    if (diff < 45) return T('Только что', 'Just now');
    if (diff < 60) return T('1 минуту назад', '1 minute ago');
    if (diff < 3600) {
      var m = Math.floor(diff / 60);
      return T(m + ' ' + plural(m, 'минуту', 'минуты', 'минут') + ' назад',
               m + (m === 1 ? ' minute ago' : ' minutes ago'));
    }
    if (diff < 86400) {
      var h = Math.floor(diff / 3600);
      return T(h + ' ' + plural(h, 'час', 'часа', 'часов') + ' назад',
               h + (h === 1 ? ' hour ago' : ' hours ago'));
    }
    if (diff < 7 * 86400) {
      var d = Math.floor(diff / 86400);
      return T(d + ' ' + plural(d, 'день', 'дня', 'дней') + ' назад',
               d + (d === 1 ? ' day ago' : ' days ago'));
    }
    if (diff < 30 * 86400) {
      var w = Math.floor(diff / (7 * 86400));
      return T(w + ' ' + plural(w, 'неделю', 'недели', 'недель') + ' назад',
               w + (w === 1 ? ' week ago' : ' weeks ago'));
    }
    if (diff < 365 * 86400) {
      var mo = Math.floor(diff / (30 * 86400));
      return T(mo + ' ' + plural(mo, 'месяц', 'месяца', 'месяцев') + ' назад',
               mo + (mo === 1 ? ' month ago' : ' months ago'));
    }
    var y = Math.floor(diff / (365 * 86400));
    return T(y + ' ' + plural(y, 'год', 'года', 'лет') + ' назад',
             y + (y === 1 ? ' year ago' : ' years ago'));
  }
  /* Абсолютная метка для подсказки: «11 нояб. 2026, 18:42» (локальное время). */
  function stamp(ts) {
    var value = Number(ts);
    if (!isFinite(value) || value <= 0) return T('Дата неизвестна', 'Unknown date');
    var d = new Date(value * 1000);
    var loc = DATE_LOCALE[lang()] || 'ru-RU';
    return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
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
    flag: '<path d="M5 21V4h9l-2 3 2 3H5"/><path d="M5 4H3"/>',
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
  /* Титулы: русский, английский и литовский варианты. */
  var TITLES = {
    't:new': ['Новичок', 'Beginner', 'Pradedantysis'],
    't:vet': ['Ветеран', 'Veteran', 'Veteranas'],
    't:ace': ['Ас', 'Ace', 'Asas'],
    't:legend': ['Легенда', 'Legend']
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
  /* Названия достижений: сервер хранит name_ru и name_en, клиент выбирает
     вариант по текущему языку. */
  function achievementName(item) {
    if (!item) return '';
    return lang() === 'en' ? (item.name_en || item.name_ru || '') : (item.name_ru || item.name_en || '');
  }
  VG.avatarHtml = avatarHtml;
  VG.titleLabel = titleLabel;
  VG.achievementName = achievementName;
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

  /* CSRF: сервер кладёт токен в куку vg_csrf, клиент возвращает его заголовком.
     Сторонняя страница не может прочитать куку этого домена, поэтому подделать
     POST-запрос из чужого origin не получится. */
  var csrfFromSession = '';
  function csrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)vg_csrf=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
    // Кука могла ещё не примениться в этом же тике (первый визит) — берём токен
    // из ответа /api/session: он ровно тот же, что сервер записал в куку.
    return csrfFromSession || '';
  }
  VG.csrfToken = csrfToken;

  function api(path, options) {
    var opts = options || {};
    var method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
    var config = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (opts.body !== undefined) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(opts.body);
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    var token = csrfToken();
    if (token && method !== 'GET' && method !== 'HEAD') config.headers['X-CSRF-Token'] = token;
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

  /* --------------------------------------------------- сообщения об ошибке */
  /* Игрок нажимает «Сообщить об ошибке» в плеере: текст уходит на сервер, где
     его видит админ. Никаких паролей и токенов в отчёте нет — только страница,
     игра и текст, который игрок сам написал. */
  var lastGameError = '';
  window.addEventListener('error', function (event) {
    if (!event) return;
    try {
      lastGameError = String((event.message || '') + ' @ ' +
        (event.filename || '') + ':' + (event.lineno || 0)).slice(0, 300);
    } catch (e) { /* не мешаем игре из-за собственного лога */ }
  });

  function reportError(message, detail) {
    var text = String(message || '').trim();
    if (text.length < 4) {
      return Promise.reject(new ApiError(T('Опишите ошибку подробнее.', 'Please describe the error.'), 'EMPTY', 0));
    }
    var payload = {
      message: text,
      page: (location.pathname || '/').slice(0, 120),
      kind: 'player',
      detail: String(detail || (VG.activeGame ? 'game: ' + VG.activeGame.id : '') ||
        lastGameError || '').slice(0, 500)
    };
    /* CSRF: кука читается только нашим JS, заголовок подставляет api(). */
    return api('/api/report/error', { body: payload });
  }
  VG.reportError = reportError;

  /* Небольшое окно «Сообщить об ошибке»: только текст игрока и контекст игры. */
  function openReportDialog() {
    var existing = document.querySelector('.vg-report');
    if (existing) { existing.remove(); return; }
    var wrap = el('div', 'vg-report');
    wrap.innerHTML =
      '<div class="vg-report-card panel" role="dialog" aria-modal="true" aria-label="' +
      T('Сообщить об ошибке', 'Report a problem') + '">' +
      '<h4>' + T('Что пошло не так?', 'What went wrong?') + '</h4>' +
      '<p class="vg-report-hint">' + T('Опишите шаги: что вы делали и что ожидали увидеть.',
        'Describe the steps: what you did and what you expected.') + '</p>' +
      '<textarea class="vg-report-text" maxlength="600" rows="4" placeholder="' +
      T('Например: поставил дом у реки — блоки появились со сдвигом', 'Example: built a house near the river and the blocks shifted') +
      '"></textarea><p class="vg-report-error"></p><div class="vg-report-actions">' +
      '<button type="button" class="btn btn-ghost" data-cancel>' + T('Отмена', 'Cancel') + '</button>' +
      '<button type="button" class="btn btn-primary" data-send>' + T('Отправить', 'Send') + '</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    var text = wrap.querySelector('.vg-report-text');
    var error = wrap.querySelector('.vg-report-error');
    text.focus();
    wrap.addEventListener('click', function (event) {
      if (event.target === wrap) wrap.remove();
    });
    wrap.querySelector('[data-cancel]').addEventListener('click', function () { wrap.remove(); });
    wrap.querySelector('[data-send]').addEventListener('click', function () {
      var button = wrap.querySelector('[data-send]');
      button.disabled = true;
      reportError(text.value, (VG.activeGame ? 'game: ' + VG.activeGame.id : '') +
        (lastGameError ? ' | ' + lastGameError : '')).then(function () {
        wrap.remove();
        toast(T('Спасибо! Сообщение отправлено администратору.',
          'Thanks! Your report was sent to the administrator.'), 'good');
      }).catch(function (err) {
        button.disabled = false;
        error.textContent = err && err.message ? err.message : T('Не удалось отправить.', 'Could not send.');
      });
    });
  }
  VG.openReportDialog = openReportDialog;
  VG.lastGameError = function () { return lastGameError; };

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
  var langListeners = [];
  /* Подписка на смену языка: страницы перерисовывают свои динамические блоки. */
  function onLangChange(fn) {
    if (typeof fn === 'function' && langListeners.indexOf(fn) === -1) langListeners.push(fn);
    return fn;
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
      csrfFromSession = data.csrf || '';
      state.csrf = csrfFromSession || csrfToken();
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
    // Тот же баланс виден на панели плеера, пока игра открыта.
    syncCoinBadges();
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
    { href: 'roulette.html', key: 'roulette', ru: 'Рулетка Vert', en: 'Vert Roulette', icon: 'spark' },
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
      '<a href="index.html" class="brand" aria-label="Vert Games">' + logoHtml() + '<span>VERT<b>GAMES</b></span></a>' +
      '<nav class="nav" aria-label="' + T('Навигация', 'Navigation') + '">' + links + adminLink + '</nav>' +
      '<div class="header-right">' +
      '<div class="lang" role="group" aria-label="Language">' +
      '<button type="button" data-lang="ru" aria-pressed="' + (langValue === 'ru') + '">RU</button>' +
      '<button type="button" data-lang="en" aria-pressed="' + (langValue === 'en') + '">EN</button>' +
      '</div>' +
      /*
       * Три плитки шапки есть всегда: язык, монеты и профиль. Раньше гостю
       * вместо баланса и профиля рисовались две кнопки «Вход»/«Регистрация»,
       * поэтому до входа панель выглядела «пустой» и не совпадала с игрой.
       * Теперь монеты показываются всегда (у гостя 0), а плитка профиля у
       * гостя открывает то же меню со входом и регистрацией.
       */
      '<button type="button" class="balance-pill" data-action="balance" title="' + T('Ваш баланс V-монет', 'Your V-coin balance') + '">' +
      icon('coin', 16) + '<span data-coins>' + fmt(u ? u.coins : 0) + '</span> V</button>' +
      (u
        ? '<button type="button" class="avatar-btn" data-action="account" aria-haspopup="menu">' +
          avatarHtml(u, 32) + '<span class="who"><b>' + escapeHtml(u.username) + '</b><small>' +
          escapeHtml(titleLabel(u)) + '</small></span></button>'
        : '<button type="button" class="avatar-btn guest" data-action="account" aria-haspopup="menu" title="' +
          T('Профиль: войти или создать аккаунт', 'Profile: sign in or create an account') + '">' +
          '<span class="avatar guest" style="width:32px;height:32px">' + icon('user', 18) + '</span>' +
          '<span class="who"><b>' + T('Профиль', 'Profile') + '</b><small>' + T('Войти', 'Sign in') + '</small></span></button>') +
      '<button type="button" class="burger" data-action="menu" aria-label="' + T('Меню', 'Menu') + '" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
      '</div>' +
      '<nav class="mobile-nav" id="vgMobileNav" aria-label="' + T('Мобильное меню', 'Mobile navigation') + '">' +
      links + adminLink +
      (u ? '' : '<a href="login.html" data-action="login">' + icon('lock', 16) + T('Вход / Регистрация', 'Sign in / Sign up') + '</a>') +
      '</nav>';
    // Панель открытой игры живёт отдельно от шапки: обновляем и её.
    var playAccount = $('#playOverlay .play-account');
    if (playAccount) {
      playAccount.innerHTML = u
        ? avatarHtml(u, 28)
        : '<span class="avatar guest" style="width:28px;height:28px">' + icon('user', 16) + '</span>';
      playAccount.setAttribute('title', T('Профиль', 'Profile'));
    }
    syncCoinBadges();
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
    /* z-index выше плеера (150): меню профиля должно открываться поверх
       запущенной игры, иначе кнопка в панели плеера выглядит «мёртвой». */
    panel.style.cssText = 'position:fixed;z-index:210;width:236px;padding:8px;top:auto';
    var links;
    if (state.user) {
      links = [
        { href: 'profile.html', icon: 'user', ru: 'Мой профиль', en: 'My profile' },
        { href: 'shop.html', icon: 'bag', ru: 'Магазин', en: 'Shop' },
        { href: 'casino.html', icon: 'wheel', ru: 'Казино', en: 'Casino' }
      ];
      if (state.user.isAdmin) links.push({ href: 'admin.html', icon: 'shield', ru: 'Админ-панель', en: 'Admin panel' });
    } else {
      /* Гость: плитка профиля ведёт себя как прежние кнопки входа. */
      links = [
        { href: 'login.html?tab=login', icon: 'lock', ru: 'Войти', en: 'Sign in' },
        { href: 'login.html?tab=register', icon: 'user', ru: 'Регистрация', en: 'Sign up' },
        { href: 'shop.html', icon: 'bag', ru: 'Магазин', en: 'Shop' }
      ];
    }
    panel.innerHTML = links.map(function (link) {
      return '<a href="' + link.href + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600">' +
        icon(link.icon, 16) + T(link.ru, link.en) + '</a>';
    }).join('') +
      (state.user
        ? '<div class="divider" style="margin:6px 0"></div>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-block" data-action="logout">' + icon('logout', 15) + T('Выйти', 'Sign out') + '</button>'
        : '');
    document.body.appendChild(panel);
    var rect = anchor.getBoundingClientRect();
    panel.style.top = Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 8) + 'px';
    panel.style.left = Math.max(12, Math.min(window.innerWidth - 248, rect.right - 236)) + 'px';
    var signOut = panel.querySelector('[data-action=logout]');
    if (signOut) signOut.addEventListener('click', logout);
    setTimeout(function () {
      document.addEventListener('click', function close(event) {
        if (!panel.contains(event.target) && event.target !== anchor) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  }

  /*
   * Переключение языка. Разметка приходит из сборщика с парами data-ru/data-en,
   * поэтому здесь достаточно подменить текст, подписи полей и атрибуты
   * доступности (aria-label, title, placeholder), а затем перерисовать
   * динамические блоки — шапку, счётчики, списки, страницы казино и профиля.
   */
  var TRANSLATABLE_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  var BASE_TITLE = '';

  /* Текст элемента на выбранном языке: собственный вариант (data-ru/data-en),
     затем английский как запасной, затем русский оригинал. */
  function langText(node, next) {
    var own = node.getAttribute('data-' + next);
    if (own != null) return own;
    if (next !== 'en') {
      var en = node.getAttribute('data-en');
      if (en != null) return en;
    }
    if (next !== 'ru') {
      var ru = node.getAttribute('data-ru');
      if (ru != null) return ru;
    }
    return null;
  }

  function applyLangToDom(next) {
    document.documentElement.setAttribute('lang', next);
    document.body.setAttribute('data-lang', next);

    // Текстовые узлы: сборщик положил рядом русский, английский и литовский варианты.
    $$('[data-ru]').forEach(function (node) {
      var text = langText(node, next);
      if (text != null) node.innerHTML = text;
      if (next !== 'ru') node.setAttribute('lang', next);
      else node.removeAttribute('lang');
    });

    // Подписи полей и подсказки доступности: data-placeholder-en, data-title-en и т. п.
    TRANSLATABLE_ATTRS.forEach(function (name) {
      var selector = '[data-' + name + '-en]';
      $$(selector).forEach(function (node) {
        // Запоминаем исходное значение атрибута, чтобы вернуть его при RU.
        var store = 'data-' + name + '-ru';
        if (!node.hasAttribute(store)) node.setAttribute(store, node.getAttribute(name) || '');
        if (next === 'ru') {
          node.setAttribute(name, node.getAttribute(store));
          return;
        }
        var value = node.getAttribute('data-' + name + '-' + next);
        if (value == null) value = node.getAttribute('data-' + name + '-en');
        if (value != null) node.setAttribute(name, value);
      });
    });

    // Заголовок вкладки: data-title-ru / data-title-en.
    if (!BASE_TITLE) BASE_TITLE = document.title;
    var root = document.documentElement;
    var title = root.getAttribute('data-title-' + next);
    if (title == null && next !== 'en') title = root.getAttribute('data-title-en');
    if (next === 'ru') document.title = BASE_TITLE;
    else if (title) document.title = title;
    else if (BASE_TITLE) document.title = BASE_TITLE;
  }

  function setLang(value) {
    var next = LANGS.indexOf(value) === -1 ? 'ru' : value;
    storage('vg_lang', next);
    applyLangToDom(next);
    paintHeader();
    emit();
    // Динамические списки (история, лидеры, каталог) перерисовываются на новом языке.
    var hooks = langListeners.slice();
    hooks.forEach(function (fn) {
      try { fn(next); } catch (e) {}
    });
    // Открытая игра тоже переключает язык: шлём ей сообщение в iframe.
    var frame = $('#gameFrame');
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'player:lang', lang: next }, location.origin); } catch (e) {}
    }
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
  /* Смена ника за V: списание и переименование делает сервер одной транзакцией. */
  function rename(name) {
    return api('/api/shop/rename', { body: { name: name } }).then(function (data) {
      if (data.user) setUser(data.user);
      if (data.balance != null) updateCoins(data.balance);
      (data.achievements || []).forEach(function (entry) {
        var ach = entry.achievement || entry;
        toast(T('Достижение: ' + (ach.name_ru || ach.name_en), 'Achievement: ' + (ach.name_en || ach.name_ru)));
      });
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

  /* Фокус в canvas игры.

     Двухступенчато: (1) фокус на iframe; (2) фокус внутрь документа игры на
     первом canvas/элементе с tabindex — некоторые браузеры оставляют фокус на
     iframe, но приложение внутри считает, что клавиатура не у него. Второй шаг
     безопасен: игры на том же origin, доступ к contentDocument разрешён. */
  function focusInsideGame(frame) {
    var doc = null;
    try { doc = frame.contentDocument; } catch (e) { doc = null; }
    if (!doc) return false;
    var target = doc.querySelector('canvas[tabindex], canvas, [data-game-focus], body');
    if (!target) return false;
    try {
      if (!target.hasAttribute('tabindex') && target.tagName === 'CANVAS') target.setAttribute('tabindex', '0');
      target.focus({ preventScroll: true });
    } catch (e) { return false; }
    // Игра может сама перехватить фокус (game-kit.js слушает этот запрос).
    try { frame.contentWindow.postMessage({ type: 'vg:focus' }, location.origin); } catch (e3) {}
    try { return doc.activeElement === target || doc.hasFocus(); } catch (e2) { return true; }
  }

  function ensureGameFocus(frame) {
    if (!frame || !VG.activeGame) return;
    try { frame.focus({ preventScroll: true }); } catch (e) { try { frame.focus(); } catch (e2) {} }
    var inside = focusInsideGame(frame);
    VG.gameFocus = document.activeElement === frame || inside;
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

  /*
   * Фоновая музыка каталога на время игры выключается полностью: игрок не
   * должен слышать аркадную петлю поверх звуков игры. Позиция петли
   * сохраняется, поэтому после выхода мелодия продолжается с того же места,
   * а не начинается заново. Если музыку выключили вручную — она останется
   * выключенной (VGMusic.setGameMode уважает преференс).
   */
  function musicGameMode(on) {
    if (!window.VGMusic) return;
    if (typeof window.VGMusic.setGameMode === 'function') window.VGMusic.setGameMode(on);
    else if (typeof window.VGMusic.duck === 'function') window.VGMusic.duck(on);
  }

  /* Баланс на панели плеера и в шапке — один и тот же счётчик. */
  function syncCoinBadges() {
    var text = fmt(coins());
    $$('[data-coins]').forEach(function (node) {
      if (node.textContent !== text) node.textContent = text;
    });
  }

  /*
   * Язык внутри плеера. Переключаем интерфейс платформы, обновляем подписи
   * панели и отдаём язык открытой игре: её i18n-рантайм слушает сообщение
   * player:lang и меняет тексты на лету. Перезагружать iframe не нужно —
   * прогресс и камера остаются на месте.
   */
  function switchGameLang(value) {
    setLang(value);
    var overlay = $('#playOverlay');
    if (!overlay) return;
    var next = lang();
    overlay.querySelectorAll('.play-lang [data-lang]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === next));
    });
    var close = overlay.querySelectorAll('[data-close]');
    close.forEach(function (button) {
      button.innerHTML = icon('chev', 15) + '<span>' + T('Выйти', 'Exit') + '</span>';
      button.setAttribute('aria-label', T('Выйти из игры', 'Exit game'));
    });
    var coins = overlay.querySelector('[data-action="play-coins"]');
    if (coins) coins.setAttribute('title', T('Баланс V-монет · нажмите, чтобы обновить', 'V-coin balance · tap to refresh'));
    var account = overlay.querySelector('[data-action="play-account"]');
    if (account) account.setAttribute('title', T('Профиль', 'Profile'));
    var title = overlay.querySelector('.play-bar h3');
    if (title && VG.activeGame) title.textContent = next === 'en' ? (VG.activeGame.name_en || VG.activeGame.name) : VG.activeGame.name;
    var chip = overlay.querySelector('.reward-chip');
    if (chip && VG.activeGame) chip.textContent = '+' + (VG.activeGame.reward || 0) + ' V ' + T('за событие', 'per event');
    /*
     * Кадр перезагружаем с новым ?lang: часть текстов игра собирает один раз
     * при запуске (названия рецептов, продуктов, станций), поэтому «на лету»
     * переводится только разметка. Перезапуск с нужным языком даёт полный
     * перевод, а прогресс не теряется — игра сохраняет его в localStorage на
     * pagehide и восстанавливает при старте.
     */
    var frame = overlay.querySelector('.play-frame');
    if (frame && VG.activeGame && VG.activeGame.file) {
      var wanted = VG.activeGame.file + '?lang=' + next + (LOW_END ? '&perf=low' : '');
      if (frame.getAttribute('src') !== wanted) frame.src = wanted;
    }
    syncFullscreenButton();
    syncCoinBadges();
    frameFocusSoon();
  }

  function openGame(game) {
    musicGameMode(true);
    var overlay = $('#playOverlay');
    // На части страниц оверлей уже есть (пустой контейнер из разметки) —
    // тогда его содержимое тоже нужно собрать.
    if (!overlay) {
      overlay = el('div', 'play-overlay');
      overlay.id = 'playOverlay';
      document.body.appendChild(overlay);
    }
    if (!overlay.querySelector('.play-bar')) {
      /*
       * Верхняя панель плеера повторяет шапку сайта: язык, монеты и профиль
       * стоят на своих местах и во время игры. Раньше здесь были только
       * «Назад», название, баланс и «Экран», поэтому в игре пропадали
       * переключатель языка и кнопка профиля.
       */
      overlay.innerHTML =
        '<button type="button" class="play-grip" data-grip aria-label="' +
        T('Панель игрока', 'Player panel') + '"></button>' +
        '<button type="button" class="play-fs-float" data-fs-float hidden aria-label="' +
        T('Игра на весь экран', 'Play fullscreen') + '" title="' +
        T('Игра на весь экран', 'Play fullscreen') + '">' + icon('expand', 16) + '</button>' +
        '<button type="button" class="play-exit-chip" data-close aria-label="' +
        T('Выйти из игры', 'Exit game') + '">' + icon('chev', 14) +
        '<span>' + T('Выйти', 'Exit') + '</span></button>' +
        '<div class="play-bar"><button type="button" class="btn btn-ghost btn-sm play-exit" data-close aria-label="' +
        T('Выйти из игры', 'Exit game') + '">' +
        icon('chev', 15) + '<span>' + T('Выйти', 'Exit') + '</span></button><h3></h3>' +
        '<div class="lang play-lang" role="group" aria-label="Language">' +
        '<button type="button" data-lang="ru" aria-pressed="' + (lang() === 'ru') + '">RU</button>' +
        '<button type="button" data-lang="en" aria-pressed="' + (lang() === 'en') + '">EN</button></div>' +
        '<button type="button" class="balance-pill" data-action="play-coins" title="' +
        T('Баланс V-монет · нажмите, чтобы обновить', 'V-coin balance · tap to refresh') + '">' +
        icon('coin', 15) + '<span data-coins>' + fmt(coins()) + '</span> V</button>' +
        '<button type="button" class="avatar-btn play-account" data-action="play-account" aria-haspopup="menu" title="' +
        T('Профиль', 'Profile') + '">' +
        (state.user ? avatarHtml(state.user, 28) : '<span class="avatar guest" style="width:28px;height:28px">' + icon('user', 16) + '</span>') +
        '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-fullscreen aria-pressed="false" title="' + T('На весь экран', 'Fullscreen') + '">' +
        icon('expand', 15) + '<span>' + T('Экран', 'Screen') + '</span></button></div>' +
        '<div class="play-frame-wrap"><iframe id="gameFrame" name="gameFrame" class="play-frame" allow="fullscreen; gamepad; autoplay" title="Game"></iframe></div>';
      overlay.querySelectorAll('[data-close]').forEach(function (button) {
        button.addEventListener('click', closeGame);
      });
      overlay.querySelector('[data-grip]').addEventListener('click', togglePlayerBar);
      overlay.querySelector('[data-fullscreen]').addEventListener('click', toggleFullscreen);
      overlay.querySelector('[data-fs-float]').addEventListener('click', function () {
        if (fullscreenElement()) { exitFullscreen(); return; }
        var pending = requestOn(overlay) || requestOn(document.documentElement);
        if (!pending) { pseudoFullscreen(); return; }
        pending.then(function () { syncFullscreenButton(); updateFsFloat(); },
          function () { pseudoFullscreen(); });
      });
      overlay.querySelector('[data-action="play-account"]').addEventListener('click', function (event) {
        event.stopPropagation();
        openAccountMenu(event.currentTarget);
      });
      overlay.querySelector('[data-action="play-coins"]').addEventListener('click', function () {
        if (state.user) { refreshCoins(); return; }
        location.href = 'login.html?tab=login';
      });
      overlay.querySelectorAll('.play-lang [data-lang]').forEach(function (button) {
        button.addEventListener('click', function () { switchGameLang(button.getAttribute('data-lang')); });
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
    /* Литовское название есть не у всех игр — тогда показываем английское. */
    overlay.querySelector('h3').textContent = lang() === 'en' ? (game.name_en || game.name) : game.name;
    overlay.querySelectorAll('[data-close]').forEach(function (button) {
      button.innerHTML = icon('chev', 15) + '<span>' + T('Выйти', 'Exit') + '</span>';
      button.setAttribute('aria-label', T('Выйти из игры', 'Exit game'));
    });
    var frame = overlay.querySelector('.play-frame');
    var langParam = lang();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('vg-playing');
    /* Телефон: сразу просим настоящий полный экран — тогда браузер убирает
       адресную строку и боковые кнопки, и игра занимает весь экран. Вызов
       идёт из обработчика клика, поэтому браузер считает его действием
       пользователя; если нельзя (iOS Safari) — мягко уходим в CSS-режим. */
    overlay.removeAttribute('data-fs-retry');
    if (touchLike()) enterFullscreenOnOpen();
    setupPlayerBar(overlay);
    updateFsFloat();
    VG.activeGame = game;
    // Автофокус: как только игра загрузилась — сразу отдаём ей клавиатуру.
    frame.onload = function () { ensureGameFocus(frame); };
    frame.src = game.file + '?lang=' + langParam + (LOW_END ? '&perf=low' : '');
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(function () { ensureGameFocus(frame); }, 260);
    bindGameKeyBridge();
    var ticket = null;   // подписанный сервером билет на эту игровую сессию
    VG.activeTicket = null;
    if (state.user) {
      api('/api/games/play', { body: { game: game.id } }).then(function (data) {
        if (data.coins != null) updateCoins(data.coins);
      }).catch(function () {});
      // Сумму награды задаёт сервер: клиент получает билет и лишь возвращает его.
      // Билет запрашивается сразу и перезапрашивается сам, если истёк (TTL 30 мин)
      // или пришёл отказ: игрок не должен видеть «сессия недействительна» из-за
      // того, что игра открыта дольше срока билета.
      function fetchTicket() {
        return api('/api/games/session?game=' + encodeURIComponent(game.id))
          .then(function (data) {
            if (data && data.sig) { ticket = data; VG.activeTicket = data; }
            return data;
          })
          .catch(function () { return null; });
      }
      VG.activeTicketRefresh = fetchTicket;
      fetchTicket();
    }
    /*
     * Мост к играм. Игры по-прежнему шлют те же сообщения, что и раньше, но
     * монеты начисляет сервер: сумма берётся из каталога, а суточный лимит и
     * квитанция проверяются на бэкенде. Клиент не может «нарисовать» баланс.
     */
    function acknowledge(source, payload) {
      try { source.postMessage(payload, location.origin); } catch (e) {}
    }
    function payout(amount, receipt, label, retry) {
      if (!VG.user() || !VG.activeGame) return Promise.resolve(null);
      if (!ticket) {   // билет ещё не пришёл (или не выдан) — награду не просим
        fetchTicket();
        return Promise.resolve(null);
      }
      return api('/api/games/reward', {
        body: { game: VG.activeGame.id, receipt: receipt, ticket: ticket }
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
        if (error.status === 403 && error.code === 'TICKET' && !retry) {
          // Билет истёк или сменился ключ подписи: один раз молча обновляем и
          // повторяем награду. Квитанция одна и та же, двойного начисления нет.
          return fetchTicket().then(function (fresh) {
            return fresh && fresh.sig ? payout(amount, receipt, label, true) : null;
          });
        }
        if (error.status === 403) toast(T('Сессия игры истекла — откройте игру заново.', 'Game session expired — reopen the game.'), 'bad');
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
      if (data.type === 'minicraftSession' && data.game === 'minicraft') {
        /*
         * Итог сессии MiniCraft. Клиент присылает только число собранных
         * зелёных монет: сумму (монеты × награда каталога) считает сервер, он же
         * проверяет лимит каталога, суточный лимит и одноразовость билета.
         */
        var sessionCoins = Math.max(0, Math.min(400, Math.floor(Number(data.coins) || 0)));
        var sessionTime = Math.max(0, Math.min(600, Math.floor(Number(data.time) || 0)));
        var sessionKills = Math.max(0, Math.min(999, Math.floor(Number(data.kills) || 0)));
        var sessionChests = Math.max(0, Math.min(999, Math.floor(Number(data.chests) || 0)));
        var sessionId = String(data.sessionId || '').slice(0, 60);
        var answer = function (result, error) {
          acknowledge(event.source, {
            type: 'minicraftSessionResult', game: 'minicraft', sessionId: sessionId,
            ok: !!(result && (result.awarded > 0 || result.claimed)),
            asked: sessionCoins,
            awarded: (result && result.awarded) || 0,
            coinsCount: (result && result.coinsCount != null) ? result.coinsCount : sessionCoins,
            rate: (result && result.rate) || known.reward || 3,
            capped: !!(result && result.capped),
            clamped: !!(result && result.clamped),
            balance: result && result.coins,
            dailyLeft: result && result.dailyLeft,
            error: error ? String(error.message || '').slice(0, 120) : ''
          });
        };
        var claimSession = function (retry) {
          if (!VG.user() || !VG.activeGame) { answer(null); return; }
          if (!ticket) {   // билет ещё не пришёл — повторно просим и отвечаем позже
            fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSession(false); });
            answer(null);
            return;
          }
          api('/api/games/session/claim', {
            body: {
              game: 'minicraft', coins: sessionCoins, time: sessionTime,
              kills: sessionKills, chests: sessionChests, sessionId: sessionId, ticket: ticket
            }
          }).then(function (result) {
            if (result.coins != null) updateCoins(result.coins);
            if (result.awarded > 0) {
              toast(T('+' + fmt(result.awarded) + ' V · итог MiniCraft', '+' + fmt(result.awarded) + ' V · MiniCraft session'));
            } else if (result.capped) {
              toast(T('Суточный лимит наград по этой игре исчерпан.', 'The daily reward cap for this game is reached.'), 'bad');
            }
            answer(result);
            return result;
          }).catch(function (error) {
            if (error.status === 429) toast(error.message, 'bad');
            if (error.status === 403 && error.code === 'TICKET' && !retry) {
              return fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSession(true); });
            }
            answer(null, error);
          });
        };
        claimSession(false);
        return;
      }
      if (data.type === 'snakeSession' && data.game === 'snake') {
        /*
         * Итог забега Snake. Клиент присылает только число обычных и золотых
         * яблок: сумму (яблоки × награда + бонусы за уровни и золото) считает
         * сервер, он же проверяет правдоподобность, суточный лимит каталога и
         * одноразовость сессии (ключ scs:<uid>:<sessionId>).
         */
        var snakeApples = Math.max(0, Math.min(400, Math.floor(Number(data.apples) || 0)));
        var snakeGold = Math.max(0, Math.min(200, Math.floor(Number(data.gold) || 0)));
        var snakeTime = Math.max(0, Math.min(3600, Math.floor(Number(data.time) || 0)));
        var snakeScore = Math.max(0, Math.min(999999, Math.floor(Number(data.score) || 0)));
        var snakeId = String(data.sessionId || '').slice(0, 60);
        var snakeAnswer = function (result, error, guest) {
          acknowledge(event.source, {
            type: 'snakeSessionResult', game: 'snake', sessionId: snakeId,
            ok: !!(result && (result.awarded > 0 || result.claimed)),
            askedApples: snakeApples, askedGold: snakeGold, score: snakeScore,
            apples: (result && result.applesCount != null) ? result.applesCount : snakeApples,
            gold: (result && result.goldCount != null) ? result.goldCount : snakeGold,
            awarded: (result && result.awarded) || 0,
            appleReward: (result && result.appleReward) || known.reward || 1,
            goldReward: (result && result.goldReward) || 10,
            clamped: !!(result && result.clamped),
            capped: !!(result && result.capped),
            zero: !!(result && result.zero),
            repeated: !!(result && result.repeated),
            balance: result && result.coins,
            dailyLeft: (result && result.dailyLeft != null) ? result.dailyLeft : null,
            guest: !!guest,
            error: error ? String(error.message || '').slice(0, 120) : ''
          });
        };
        var claimSnake = function (retry) {
          if (!VG.activeGame) { snakeAnswer(null); return; }
          // Без входа начислять некуда: игра покажет итог как локальный.
          if (!VG.user()) { snakeAnswer(null, null, true); return; }
          if (!ticket) {   // билет ещё не пришёл — молча повторяем, без «отказа»
            fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSnake(false); });
            return;
          }
          api('/api/games/session/claim', {
            body: {
              game: 'snake', apples: snakeApples, gold: snakeGold, time: snakeTime,
              score: snakeScore, sessionId: snakeId, ticket: ticket
            }
          }).then(function (result) {
            if (result.coins != null) updateCoins(result.coins);
            if (result.awarded > 0) {
              toast(T('+' + fmt(result.awarded) + ' V · итог Snake', '+' + fmt(result.awarded) + ' V · Snake run'));
            } else if (result.capped) {
              toast(T('Суточный лимит наград по этой игре исчерпан.', 'The daily reward cap for this game is reached.'), 'bad');
            }
            snakeAnswer(result);
            return result;
          }).catch(function (error) {
            if (error.status === 429) toast(error.message, 'bad');
            if (error.status === 403 && error.code === 'TICKET' && !retry) {
              return fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSnake(true); });
            }
            snakeAnswer(null, error);
          });
        };
        claimSnake(false);
        return;
      }
      if (data.type === 'gameSession') {
        /*
         * Универсальный итог забега (flappy, 2048, platformer, pong, shooter,
         * doodle, rover). Клиент присылает только «единицы» события — сколько
         * труб пройдено, волн закрыто, сотен очков набрано. Сумму V, проверку
         * правдоподобности по времени, суточный лимит и одноразовость сессии
         * делает сервер; клиент показывает то, что пришло в ответе.
         */
        var sessGame = String(data.game || '');
        if (sessGame !== gameName) return;
        var sessUnits = Math.max(0, Math.min(500, Math.floor(Number(data.units) || 0)));
        var sessTime = Math.max(0, Math.min(3600, Math.floor(Number(data.time) || 0)));
        var sessId = String(data.sessionId || '').slice(0, 60);
        var sessionAnswer = function (result, error) {
          acknowledge(event.source, {
            type: 'gameSessionResult', game: sessGame, sessionId: sessId,
            ok: !!(result && (result.awarded > 0 || result.claimed)),
            units: (result && result.unitsCount != null) ? result.unitsCount : sessUnits,
            asked: sessUnits,
            awarded: (result && result.awarded) || 0,
            rate: (result && result.rate) || known.reward || 1,
            clamped: !!(result && result.clamped),
            capped: !!(result && result.capped),
            zero: !!(result && result.zero),
            repeated: !!(result && result.repeated),
            balance: result && result.coins,
            dailyLeft: (result && result.dailyLeft != null) ? result.dailyLeft : null,
            error: error ? String(error.message || '').slice(0, 120) : ''
          });
        };
        var claimSessionRun = function (retry) {
          if (!VG.activeGame) { sessionAnswer(null); return; }
          // Без входа начислять некуда: игра покажет итог как локальный.
          if (!VG.user()) { sessionAnswer(null); return; }
          if (!ticket) {   // билет ещё не пришёл — молча повторяем
            fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSessionRun(false); });
            return;
          }
          api('/api/games/session/claim', {
            body: { game: sessGame, units: sessUnits, time: sessTime, sessionId: sessId, ticket: ticket }
          }).then(function (result) {
            if (result.coins != null) updateCoins(result.coins);
            if (result.awarded > 0) {
              toast(T('+' + fmt(result.awarded) + ' V · ' + (known.name || sessGame),
                '+' + fmt(result.awarded) + ' V · ' + (known.name_en || sessGame)));
            } else if (result.capped) {
              toast(T('Суточный лимит наград по этой игре исчерпан.',
                'The daily reward cap for this game is reached.'), 'bad');
            }
            sessionAnswer(result);
            return result;
          }).catch(function (error) {
            if (error.status === 429) toast(error.message, 'bad');
            if (error.status === 403 && error.code === 'TICKET' && !retry) {
              return fetchTicket().then(function (fresh) { fresh && fresh.sig && claimSessionRun(true); });
            }
            sessionAnswer(null, error);
          });
        };
        claimSessionRun(false);
        return;
      }
      if (data.type === 'addCoins' || data.type === 'gameOver') {
        // Игры с итоговой наградой сессии платят только через session/claim:
        // событие addCoins от них больше не начисляет V (иначе двойная выплата).
        if (known.sessionClaim) return;
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

  /* ------------------------------------------------------------------------
     Всплывающая панель плеера на телефоне.
     ------------------------------------------------------------------------
     На тач-устройстве панель наезжает на HUD игры (у Sky-Isle сверху своя
     строка с монетами, у MiniCraft — свой тулбар), и игрок видел две шапки
     друг на друге. Поэтому на телефоне панель живёт поверх игры, сама уходит
     через 3 секунды и возвращается по тапу на «язычок» сверху кадра.
     ---------------------------------------------------------------------- */
  var playerBarTimer = 0;
  function coarsePointer() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }
    catch (e) { return false; }
  }
  /*
   * «Как на телефоне»: грубый указатель ИЛИ узкий экран с сенсором. Часть
   * мобильных браузеров (в частности оболочки на Android) рапортуют
   * pointer:fine для сенсорного экрана — из-за этого не включался ни
   * всплывающий режим панели, ни полный экран, и над игрой оставалась
   * широкая чёрная полоса от скрытой панели.
   */
  function touchLike() {
    try {
      if (coarsePointer()) return true;
      var hasTouch = (navigator.maxTouchPoints || 0) > 0;
      var narrow = (window.innerWidth || 0) <= 900
        || !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
      if (hasTouch && narrow) return true;
    } catch (e) {}
    return false;
  }
  function hidePlayerBar() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    if (playerBarTimer) { clearTimeout(playerBarTimer); playerBarTimer = 0; }
    overlay.classList.add('bar-hidden');
  }
  function showPlayerBar(autoHide) {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    overlay.classList.remove('bar-hidden');
    if (playerBarTimer) { clearTimeout(playerBarTimer); playerBarTimer = 0; }
    if (autoHide !== false) playerBarTimer = setTimeout(hidePlayerBar, 4200);
  }
  function togglePlayerBar() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    if (overlay.classList.contains('bar-hidden')) showPlayerBar();
    else hidePlayerBar();
  }
  /* Один раз на открытие игры: включаем режим и через 3 с убираем панель. */
  function setupPlayerBar(overlay) {
    var touch = touchLike();
    if (playerBarTimer) { clearTimeout(playerBarTimer); playerBarTimer = 0; }
    overlay.classList.remove('bar-hidden');
    overlay.classList.toggle('immersive', touch);
    if (touch) playerBarTimer = setTimeout(hidePlayerBar, 3000);
  }

  /* Псевдополноэкранный режим: overlay уже position:fixed/inset:0, добавляем
     класс, который прячет полосу плеера на телефоне и просит браузер спрятать
     адресную строку (100dvh + safe-area). */
  function pseudoFullscreen() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    enterPseudoFullscreenClasses();
    showPlayerBar();
    /* Ориентацию НЕ фиксируем: Flappy Bird и остальные игры сами держат
       портретную сцену, а принудительный landscape выкидывал игрока из
       привычного положения телефона. */
    syncFullscreenButton();
    frameFocusSoon();
    toast(T('Полный экран включён. Кнопка «Экран» выключает его.',
      'Fullscreen on. Tap Screen again to exit.'), 'ok');
  }

  /* Настоящий полноэкранный режим: просим его у самого оверлея, а не у рамки,
     иначе вместе с рамкой с экрана уходит панель с кнопкой «Выйти» — на
     телефоне из такого режима не выбраться. Если браузер отказывает (iOS
     Safari умеет fullscreen только для видео, встроенные браузеры тоже), мягко
     переходим в CSS-режим: игра занимает 100dvh, интерфейс прячется. */
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement
      || document.mozFullScreenElement || document.msFullscreenElement || null;
  }
  /*
   * Запрос полного экрана «как умеет браузер».
   *
   * Сначала зовём requestFullscreen() БЕЗ аргументов: часть мобильных браузеров
   * (встроенные оболочки, старые Chromium) спотыкается на объекте опций и
   * молча отказывает — а это ровно то, из-за чего игра оставалась с адресной
   * строкой и боковыми кнопками браузера. Если без опций не вышло — пробуем с
   * navigationUI, затем с префиксами.
   */
  function requestOn(el) {
    if (!el) return null;
    var fns = [el.requestFullscreen, el.webkitRequestFullscreen,
      el.mozRequestFullScreen, el.msRequestFullscreen].filter(Boolean);
    if (!fns.length) return null;
    for (var i = 0; i < fns.length; i++) {
      try {
        var maybe = fns[i].call(el);
        return (maybe && typeof maybe.then === 'function') ? maybe : Promise.resolve();
      } catch (e) { /* пробуем следующий вариант */ }
      try {
        var withUi = fns[i].call(el, { navigationUI: 'hide' });
        return (withUi && typeof withUi.then === 'function') ? withUi : Promise.resolve();
      } catch (e2) { /* и следующий */ }
    }
    return Promise.reject(new Error('fullscreen-rejected'));
  }

  /* Просим полный экран у оверлея (или у документа). Если браузер отказал —
     включаем «псевдополный» режим: игра всё равно займёт 100dvh, а шапка и
     подвал сайта уже скрыты классом vg-playing. Плюс «взводим» повторную
     попытку: следующий тап по игре — снова действие пользователя. */
  function enterFullscreenOnOpen() {
    var overlay = $('#playOverlay');
    if (!overlay || fullscreenElement()) return;
    var targets = [overlay, document.documentElement];
    var index = 0;
    function attempt() {
      if (index >= targets.length) {
        enterPseudoFullscreenClasses();
        syncFullscreenButton();
        armFullscreenRetry();
        updateFsFloat();
        return;
      }
      var target = targets[index++];
      var pending = requestOn(target);
      if (!pending) { attempt(); return; }
      pending.then(function () {
        overlay.classList.remove('pseudo-full');
        document.body.classList.remove('vg-pseudo-full');
        syncFullscreenButton();
        updateFsFloat();
      }, function () { attempt(); });
    }
    attempt();
  }

  /* Браузер отказал на открытии (или запрос потерялся) — пробуем ещё раз на
     первом же тапе: он снова считается действием пользователя. */
  function armFullscreenRetry() {
    var overlay = $('#playOverlay');
    if (!overlay || overlay.getAttribute('data-fs-retry') === '1') return;
    overlay.setAttribute('data-fs-retry', '1');
    overlay.addEventListener('pointerdown', retryFullscreenOnce, { capture: true });
  }
  function retryFullscreenOnce(event) {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    /* Тап по «Назад» — это выход из игры, а не просьба развернуть её. */
    if (event && event.target && event.target.closest && event.target.closest('[data-close]')) return;
    overlay.removeEventListener('pointerdown', retryFullscreenOnce, { capture: true });
    overlay.removeAttribute('data-fs-retry');
    if (!overlay.classList.contains('open') || fullscreenElement()) return;
    var pending = requestOn(overlay) || requestOn(document.documentElement);
    if (!pending) return;
    pending.then(function () {
      overlay.classList.remove('pseudo-full');
      document.body.classList.remove('vg-pseudo-full');
      syncFullscreenButton();
      updateFsFloat();
    }, function () {});
  }

  /* Маленькая кнопка «⛶» рядом с «язычком» панели: панель на телефоне сама
     уезжает через 3 секунды, и до кнопки «Экран» было не добраться. Кнопка
     видна только пока полный экран не включён. */
  function updateFsFloat() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    var btn = overlay.querySelector('[data-fs-float]');
    if (!btn) return;
    var open = overlay.classList.contains('open');
    var active = !!fullscreenElement() || overlay.classList.contains('pseudo-full');
    btn.hidden = !(open && touchLike() && !active);
  }
  function exitFullscreen() {
    var call = document.exitFullscreen || document.webkitExitFullscreen
      || document.mozCancelFullScreen || document.msExitFullscreen;
    if (call) { try { call.call(document); } catch (e) {} }
  }
  function toggleFullscreen() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    if (fullscreenElement()) { exitFullscreen(); return; }
    if (overlay.classList.contains('pseudo-full')) { exitPseudoFullscreen(); return; }
    var wrap = overlay.querySelector('.play-frame-wrap') || overlay;
    var targets = [overlay, wrap, document.documentElement];
    var request = null;
    for (var i = 0; i < targets.length && !request; i++) {
      var t = targets[i];
      var fn = t.requestFullscreen || t.webkitRequestFullscreen
        || t.mozRequestFullScreen || t.msRequestFullscreen;
      if (fn) request = { fn: fn, el: t };
    }
    if (!request) { pseudoFullscreen(); return; }
    try {
      var maybe = request.fn.call(request.el, { navigationUI: 'hide' });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(function () { frameFocusSoon(); }, function () {
          if (!fullscreenElement()) pseudoFullscreen();
        });
      }
      frameFocusSoon();
    } catch (e) {
      try { request.fn.call(request.el); frameFocusSoon(); } catch (e2) { pseudoFullscreen(); }
    }
  }
  function enterPseudoFullscreenClasses() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    overlay.classList.add('pseudo-full');
    document.body.classList.add('vg-pseudo-full');
  }
  function exitPseudoFullscreen() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    overlay.classList.remove('pseudo-full');
    document.body.classList.remove('vg-pseudo-full');
    syncFullscreenButton();
    frameFocusSoon();
  }

  /* Esc выходит из «псевдополноэкранного» режима; настоящий fullscreen Esc
     закрывает сам браузер, поэтому дублировать не нужно. */
  if (!toggleFullscreen.keys) {
    toggleFullscreen.keys = true;
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var overlay = $('#playOverlay');
      if (!overlay || !overlay.classList.contains('open')) return;
      if (overlay.classList.contains('pseudo-full')) { exitPseudoFullscreen(); return; }
      if (!fullscreenElement() && overlay.classList.contains('bar-hidden')) { showPlayerBar(); return; }
      if (!fullscreenElement() && overlay.classList.contains('immersive')) {
        overlay.classList.remove('immersive');
      }
    });
  }

  function frameFocusSoon() {
    var overlay = $('#playOverlay');
    var frame = overlay && overlay.querySelector('.play-frame');
    if (!frame) return;
    setTimeout(function () { ensureGameFocus(frame); }, 120);
    setTimeout(function () { ensureGameFocus(frame); }, 420);
  }

  function currentGameReward() {
    return VG.activeGame ? VG.activeGame.reward : 0;
  }
  function syncFullscreenButton() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    var button = overlay.querySelector('[data-fullscreen]');
    if (!button) return;
    var active = !!fullscreenElement() || overlay.classList.contains('pseudo-full');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    updateFsFloat();
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
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(function (name) {
      document.addEventListener(name, syncFullscreenButton);
    });
  }

  function closeGame() {
    musicGameMode(false);
    var overlay = $('#playOverlay');
    if (!overlay) return;
    var frame = overlay.querySelector('.play-frame');
    /*
     * MiniCraft начисляет итог сессии в момент закрытия. Раньше кадр сразу
     * получал about:blank, и собранные монеты терялись — теперь игре даётся
     * короткий миг на отправку результата. Остальные игры закрываются как
     * прежде, без задержки.
     */
    var flushNeeded = VG.activeGame && (VG.activeGame.id === 'minicraft' || VG.activeGame.id === 'omnom');
    if (frame && flushNeeded && !VG._closingFlush) {
      VG._closingFlush = true;
      try { frame.contentWindow.postMessage({ type: 'vg:flush' }, location.origin); } catch (e) {}
      setTimeout(function () {
        VG._closingFlush = false;
        finishCloseGame();
      }, 600);
      return;
    }
    finishCloseGame();
  }
  function finishCloseGame() {
    var overlay = $('#playOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.classList.remove('immersive', 'bar-hidden', 'pseudo-full');
    overlay.removeAttribute('data-fs-retry');
    updateFsFloat();
    if (playerBarTimer) { clearTimeout(playerBarTimer); playerBarTimer = 0; }
    if (fullscreenElement()) exitFullscreen();
    var frame = overlay.querySelector('.play-frame');
    if (frame) frame.src = 'about:blank';
    document.body.style.overflow = '';
    document.body.classList.remove('vg-playing');
    VG.activeGame = null;
    VG.activeTicket = null;
    releaseGameFocus();
  }
  function refreshCoins() {
    if (!state.user) return Promise.resolve();
    return api('/api/balance').then(function (data) { updateCoins(data.coins); });
  }

  /* ------------------------------------------------------------------ export */
  VG.$ = $; VG.$$ = $$; VG.lookup = $; VG.lookupAll = $$; VG.el = el; VG.T = T; VG.fmt = fmt; VG.date = date; VG.timeAgo = timeAgo; VG.stamp = stamp; VG.plural = plural;
  VG.escapeHtml = escapeHtml; VG.debounce = debounce; VG.storage = storage;
  VG.user = user; VG.coins = coins; VG.setUser = setUser; VG.refreshSession = refreshSession;
  VG.updateCoins = updateCoins; VG.refreshCoins = refreshCoins; VG.onChange = onChange;
  VG.casinoOutcome = casinoOutcome; VG.ledgerReason = ledgerReason;
  VG.onSessionChange = onSessionChange; VG.onLangChange = onLangChange;
  VG.login = login; VG.register = register; VG.logout = logout; VG.changePassword = changePassword;
  VG.requireAuth = requireAuth; VG.renderTurnstile = renderTurnstile;
  VG.purchase = purchase; VG.equip = equip; VG.rename = rename; VG.openGame = openGame; VG.closeGame = closeGame;
  VG.setLang = setLang; VG.lang = currentLang; VG.LANGS = LANGS;
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
  /* Музыка вынесена в отдельный файл: он подключается на всех страницах и
     держит один плеер на вкладку. Если файл не загрузился (старый кэш),
     платформа работает как раньше — без ошибок в консоли. */
  function loadMusic() {
    if (window.VGMusic || document.getElementById('vg-music-script')) return;
    var script = document.createElement('script');
    script.id = 'vg-music-script';
    script.src = '/assets/vg/js/music.js';
    script.defer = true;
    script.onerror = function () {};
    (document.head || document.documentElement).appendChild(script);
  }

  /*
   * Поле поиска в каталоге. Разметку не меняем: тот же <label class="search">
   * и тот же input#gameSearch, поэтому фильтрация в home.js/catalog.js
   * продолжает работать как раньше. Скрипт только добавляет класс-обёртку
   * .search--lg (стили ограничены им), увеличивает иконку и вставляет кнопку
   * очистки. Страницы админки и поддержки используют .search без этого
   * класса, поэтому их внешний вид не меняется.
   */
  function enhanceGameSearch() {
    var input = document.getElementById('gameSearch');
    if (!input) return null;
    var field = input.closest ? input.closest('.search') : null;
    if (!field || field.classList.contains('search--lg')) return field;
    field.classList.add('search--lg');
    var holder = field.querySelector('span');
    var svg = holder && holder.querySelector('svg');
    if (holder) holder.classList.add('search-ico');
    if (svg) {
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      svg.style.width = '20px';
      svg.style.height = '20px';
    }
    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search-clear';
    clear.setAttribute('aria-label', T('Очистить поиск', 'Clear search'));
    clear.setAttribute('title', T('Очистить поиск', 'Clear search'));
    clear.innerHTML = icon('x', 14);
    field.appendChild(clear);
    if (VG.onLangChange) {
      VG.onLangChange(function () {
        var label = T('Очистить поиск', 'Clear search');
        clear.setAttribute('aria-label', label);
        clear.setAttribute('title', label);
      });
    }
    function sync() {
      var has = input.value.replace(/\s+/g, '') !== '';
      field.classList.toggle('has-value', has);
      clear.hidden = !has;
    }
    input.addEventListener('input', sync);
    clear.addEventListener('click', function (event) {
      // Клик по кнопке внутри label не должен сам открывать клавиатуру дважды.
      event.preventDefault();
      event.stopPropagation();
      if (!input.value) return;
      input.value = '';
      sync();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    sync();
    return field;
  }
  VG.enhanceGameSearch = enhanceGameSearch;

  function boot() {
    var saved = storage('vg_lang');
    if (saved === 'lt') {
      // Литовский язык убран с платформы: у таких игроков включаем русский.
      saved = 'ru';
      storage('vg_lang', saved);
      document.documentElement.setAttribute('lang', 'ru');
    }
    if (saved === 'en' || saved === 'ru') {
      // Разметка уже двуязычная: применяем сохранённый язык до первой отрисовки.
      applyLangToDom(saved);
    }
    paintHeader();
    hydrateIcons();
    enhanceGameSearch();
    applyGuestOnly();
    refreshSession();
    loadMusic();
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
