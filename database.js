/* ============================================================================
 *  VertGames — база данных аккаунтов (accounts / database)
 *  ----------------------------------------------------------------------------
 *  ЕДИНЫЙ модуль хранения аккаунтов для всех страниц сайта.
 *
 *  Как устроено.
 *  - В браузере модуль публикует глобальный объект `VA` (VertGames Accounts)
 *    и все страницы обращаются к нему через `VA.*` (или через страничные
 *    функции db()/save()/register()..., которые делегируют сюда).
 *  - Данные хранятся в `window.VA` объекте и персистятся через слой
 *    `VA._store` (по умолчанию — localStorage).
 *
 *  ДЛЯ СЕРВЕРА В БУДУЩЕМ.
 *  Этот же файл можно `require('../database.js')` внутри Node-сервера:
 *    - в Node экспортируется то же хранилище через `module.exports`;
 *    - серверу достаточно заменить `VA._store` на объект с методами
 *      `load()` / `save(data)` (чтение и запись в свой файл/БД) — и весь
 *      остальной код (регистрация, вход, баланс, топ) продолжит работать
 *      без правок, но уже через сервер.
 *  HTML-страницы обращаются к этому файлу как к источнику правды об аккаунтах.
 *
 *  Поля аккаунта: username, email, salt, pass, balance, banned, created,
 *                 owned, avatar, color, title.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node / будущий сервер
    module.exports = factory();
  } else {
    // Браузер: глобальный VA (VertGames Accounts)
    root.VA = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORE_KEY = 'nl_users';
  var SESSION_KEY = 'nl_current';

  /* ---------- слой хранения ----------
   *  В браузере работаем через localStorage.
   *  Если localStorage недоступен (например, внутри Node-модуля), используем
   *  in-memory карту — так этот файл работает и как автономная база.
   *  Для будущего сервера: подмените VA._store на объект с методами
   *  load()/save(data) поверх своего файла/БД — остальной код не меняется. */
  var mem = {}, memorySession = null;
  var isBrowser = typeof window !== 'undefined';
  var storageError = '';
  var hasLS = (function () {
    try { if (typeof localStorage === 'undefined') return false;
      var key='vg_storage_probe_'+Math.random();localStorage.setItem(key,'1');localStorage.removeItem(key);return true;
    } catch(e) { storageError='Хранилище браузера недоступно';return false; }
  })();
  var store = {
    load: function () {
      if (hasLS) { try {var raw=localStorage.getItem(STORE_KEY),d=raw?JSON.parse(raw):{};
        if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Invalid accounts');
        mem=d;return d;
      } catch(e) {storageError='Не удалось прочитать сохранённые аккаунты';return Object.assign({},mem);} }
      return Object.assign({},mem);
    },
    save: function(data) {
      if(storageError&&hasLS)return false; // Never overwrite unreadable legacy data.
      mem=Object.assign({},data);
      if(hasLS){try{localStorage.setItem(STORE_KEY,JSON.stringify(data));return true}catch(e){hasLS=false;storageError='Не удалось сохранить аккаунт';return false}}
      return !isBrowser;
    }
  };
  function storageStatus(){return {persistent:hasLS&&!storageError,error:storageError};}

  /* ---------- утилиты ---------- */
  function now() { return Date.now(); }

  // pure-JS SHA-256 (работает и на file://, где crypto.subtle недоступен)
  function sha256(ascii) {
    function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '', words = [],
        asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [],
        primeCounter = k.length, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] +
            (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] +
            (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }
  function passHash(s) { return sha256(unescape(encodeURIComponent(s))); }
  function randSalt() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

  /* ---------- данные ---------- */
  function getUsers() { return store.load(); }

  function saveUsers(data) { return store.save(data); }

  function getUser(name) {
    if (!name) return null;
    var d = getUsers();
    return Object.prototype.hasOwnProperty.call(d,name)?d[name]:null;
  }

  function findByEmail(email) {
    if (!email) return null;
    email = String(email).toLowerCase().trim();
    var d = getUsers();
    for (var k in d) {
      if (d[k] && d[k].email && String(d[k].email).toLowerCase().trim() === email) return d[k];
    }
    return null;
  }

  /* ---------- валидация ---------- */
  function isValidEmail(e) {
    if(typeof e!=='string'||e.length>254||e.split('@').length!==2)return false;
    var parts=e.split('@'),local=parts[0],domain=parts[1];
    return local.length>0&&local.length<=64&&local[0]!=='.'&&local[local.length-1]!=='.'&&local.indexOf('..')<0&&
      /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)&&
      /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain);
  }
  // занят ли ник (без учёта регистра)
  function usernameTaken(name) {
    name = String(name || '').trim().toLowerCase();
    if (!name) return false;
    var d = getUsers();
    for (var k in d) {
      if (String(k).toLowerCase() === name) return d[k];
    }
    return null;
  }
  // занят ли email (без учёта регистра)
  function emailTaken(email) {
    return findByEmail(email) || null;
  }

  /* ---------- регистрация (с email) ---------- */
  // опции: { username, email, password }
  function register(opt) {
    var u = String((opt && opt.username) || '').trim();
    var e = String((opt && opt.email) || '').trim();
    var p = String((opt && opt.password) || '');
    if (!u) return { ok: false, msg: 'Введите имя / enter name' };
    if (['__proto__','prototype','constructor'].indexOf(u.toLowerCase())>=0)return {ok:false,msg:'Выберите другой ник / choose another username'};
    if(isBrowser&&!storageStatus().persistent)return {ok:false,code:'STORAGE_UNAVAILABLE',msg:'Браузер не разрешает сохранять аккаунты. Откройте сайт по постоянному адресу, не в предпросмотре.'};
    if (!e) return { ok: false, msg: 'Введите email / enter email' };
    if (!isValidEmail(e)) return { ok: false, msg: 'Некорректный email / invalid email' };
    if (p.length < 4) return { ok: false, msg: 'Пароль от 4 символов / min 4 chars' };
    var d = getUsers();
    if (usernameTaken(u)) return { ok: false, msg: 'Имя занято / name taken' };
    if (findByEmail(e)) return { ok: false, msg: 'Этот email уже зарегистрирован / email already used' };
    var salt = randSalt();
    d[u] = {
      username: u,
      email: e,
      salt: salt,
      pass: passHash(salt + p),
      balance: 100,
      banned: false,
      created: now(),
      owned: ['av:rocket', 'col:teal', 't:new'],
      avatar: 'av:rocket',
      color: 'col:teal',
      title: 't:new'
    };
    if(!saveUsers(d)){delete mem[u];return {ok:false,code:'STORAGE_UNAVAILABLE',msg:'Не удалось сохранить аккаунт. Регистрация не завершена.'};}
    return { ok: true, username:u };
  }

  /* ---------- вход (по имени или email + пароль) ---------- */
  function loginCheck(u, p) {
    u = String(u || '').trim();
    var d = getUsers();
    var x = Object.prototype.hasOwnProperty.call(d,u)?d[u]:null;
    var name = u;
    if(!x){for(var key in d){if(key.toLowerCase()===u.toLowerCase()){x=d[key];name=key;break}}}
    if(x&&x.authSource==='server')return {ok:false,code:'SERVER_LOGIN_REQUIRED',msg:'Для этого аккаунта нужен вход через сервер.',username:name};
    // разрешаем вход по email, если ввели не логин.
    // Сканируем сам объект d (не полагаясь на равенство ссылок — в браузере
    // каждый load() возвращает свежераспарсенный объект).
    if (!x && u.indexOf('@') >= 0) {
      var mail = u.toLowerCase().trim();
      for (var k in d) {
        if (d[k] && d[k].email && String(d[k].email).toLowerCase().trim() === mail) {
          x = d[k]; name = k; break;
        }
      }
    }
    if (!x) return { ok: false, msg: 'Аккаунт не найден в этом браузере. Проверьте ник/email и адрес сайта.', username: u };
    if(x.authSource==='server')return {ok:false,code:'SERVER_LOGIN_REQUIRED',msg:'Для этого аккаунта нужен вход через сервер.',username:name};
    if (x.salt) {
      if (passHash(x.salt + p) !== x.pass) return { ok: false, msg: 'Неверный пароль / wrong password', username: name };
    } else {
      // апгрейд старых аккаунтов без соли
      if (x.pass !== p) return { ok: false, msg: 'Неверный пароль / wrong password', username: name };
      var salt = randSalt();
      x.salt = salt; x.pass = passHash(salt + p); saveUsers(d);
    }
    if (x.banned) return { ok: false, msg: 'Аккаунт заблокирован / account banned', username: name };
    return { ok: true, username: name };
  }

  /* ---------- баланс ---------- */
  function getUserBalance(name) {
    var u = getUser(name);
    return u ? Number(u.balance) || 0 : 0;
  }
  function setUserBalance(name, v) {
    var d = getUsers();
    if (!d[name]) return null;
    d[name].balance = Math.max(0, Number(v) || 0);
    saveUsers(d);
    return d[name].balance;
  }
  function adjustUserBalance(name, delta) {
    var d = getUsers();
    if (!d[name]) return 0;
    d[name].balance = Math.max(0, (Number(d[name].balance) || 0) + Number(delta || 0));
    saveUsers(d);
    return d[name].balance;
  }
  function topUsers(n) {
    return Object.values(getUsers()).filter(function (u) { return u && !u.banned; })
      .sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); })
      .slice(0, n || 0);
  }

  /* ---------- метаданные (профиль) ---------- */
  function ensureMeta() {
    var d = getUsers(); var ch = false;
    for (var nm in d) {
      var u = d[nm];
      if (!Array.isArray(u.owned)) { u.owned = ['av:rocket', 'col:teal', 't:new']; ch = true; }
      if (!u.avatar) { u.avatar = 'av:rocket'; ch = true; }
      if (!u.color) { u.color = 'col:teal'; ch = true; }
      if (!u.title) { u.title = 't:new'; ch = true; }
    }
    if (ch) saveUsers(d);
  }

  /* ---------- очистка фейков/сидов ---------- */
  function cleanFakes() {
    var d = getUsers(); var ch = false;
    for (var n in d) {
      var u = d[n];
      if (u && !u.salt && u.pass === 'x' && !Array.isArray(u.owned)) { delete d[n]; ch = true; }
    }
    if (ch) saveUsers(d);
    return ch;
  }

  /* ---------- сессия ---------- */
  function getCurrentUser() {
    var name=memorySession;
    try{name=localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||name}catch(e){}
    if(!name)return null;
    var users=getUsers(),found=Object.prototype.hasOwnProperty.call(users,name)?name:null;
    if(!found)for(var k in users){if(k.toLowerCase()===String(name).toLowerCase()||(users[k].email&&users[k].email.toLowerCase()===String(name).toLowerCase())){found=k;break}}
    if(!found||users[found].banned)return null;
    if(found!==name)setCurrent(found);
    return found;
  }
  function setCurrent(name) {
    memorySession=name||null;
    try{name?sessionStorage.setItem(SESSION_KEY,name):sessionStorage.removeItem(SESSION_KEY)}catch(e){}
    try{name?localStorage.setItem(SESSION_KEY,name):localStorage.removeItem(SESSION_KEY)}catch(e){}
  }

  /* ---------- публичный API ---------- */
  return {
    // хранение
    storageStatus: storageStatus,
    STORE_KEY: STORE_KEY,
    SESSION_KEY: SESSION_KEY,
    getUsers: getUsers,
    saveUsers: saveUsers,
    getUser: getUser,
    findByEmail: findByEmail,
    // хеши / проверка
    sha256: sha256,
    passHash: passHash,
    randSalt: randSalt,
    isValidEmail: isValidEmail,
    usernameTaken: usernameTaken,
    emailTaken: emailTaken,
    // аккаунты
    register: register,
    loginCheck: loginCheck,
    // баланс
    getUserBalance: getUserBalance,
    setUserBalance: setUserBalance,
    adjustUserBalance: adjustUserBalance,
    topUsers: topUsers,
    // профиль / очистка
    ensureMeta: ensureMeta,
    cleanFakes: cleanFakes,
    // сессия
    getCurrentUser: getCurrentUser,
    setCurrent: setCurrent,
    // слой хранения (для будущего сервера — переопределяемый)
    _store: store
  };
});
