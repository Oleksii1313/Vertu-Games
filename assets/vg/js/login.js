/* Вход и регистрация: ник + пароль, Cloudflare Turnstile (проверка на сервере),
   автоопределение вкладки, проверка доступности ника, ограничения клиента. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, escapeHtml = VG.escapeHtml;
  var tab = 'login';
  var tokens = { login: '', register: '' };
  var resets = { login: null, register: null };
  var startedAt = Date.now();
  var busy = false;

  function msg(node, text, kind) {
    node.className = 'msg' + (kind ? ' ' + kind : '');
    node.textContent = text || '';
  }

  function switchTab(next, syncUrl) {
    tab = next === 'register' ? 'register' : 'login';
    $('#tabLogin').classList.toggle('on', tab === 'login');
    $('#tabRegister').classList.toggle('on', tab === 'register');
    $('#tabLogin').setAttribute('aria-selected', String(tab === 'login'));
    $('#tabRegister').setAttribute('aria-selected', String(tab === 'register'));
    $('#formLogin').classList.toggle('hidden', tab !== 'login');
    $('#formRegister').classList.toggle('hidden', tab !== 'register');
    if (syncUrl === false) return;
    var url = new URL(location.href);
    url.searchParams.set('tab', tab);
    history.replaceState(null, '', url);
  }

  function mountCaptcha() {
    var cfg = VG.session ? VG.session.captcha : null;
    if (!cfg || !cfg.enabled) {
      var note = $('#captchaNote');
      if (note) note.textContent = T('CAPTCHA не настроена владельцем — вход защищён ограничением попыток на сервере.',
        'CAPTCHA is not configured — sign-in is still protected by server-side rate limits.');
      return;
    }
    resets.login = VG.renderTurnstile($('#captchaLogin'), function (token) { tokens.login = token; });
    resets.register = VG.renderTurnstile($('#captchaRegister'), function (token) { tokens.register = token; });
  }

  function afterAuth(data) {
    var next = new URLSearchParams(location.search).get('next');
    var target = 'index.html';
    if (next && /^[a-z0-9_-]+\.html$/i.test(next)) target = next;
    else if (next === 'catalog') target = 'top.html';
    else if (next === 'shop') target = 'shop.html';
    else if (next === 'roulette') target = 'roulette.html';
    else if (next !== null && /^[a-z0-9]+$/i.test(next)) target = 'top.html';
    location.href = target;
  }

  function field(form, name) {
    return form.querySelector('[name="' + name + '"]');
  }

  function bindLogin() {
    var form = $('#formLogin');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      var message = $('#loginMsg');
      var username = field(form, 'username').value.trim();
      var password = field(form, 'password').value;
      if (!username || !password) {
        msg(message, T('Введите ник и пароль.', 'Enter your username and password.'), 'err');
        return;
      }
      busy = true;
      var button = $('#loginSubmit');
      button.disabled = true;
      button.textContent = T('Проверяем…', 'Checking…');
      msg(message, '');
      VG.login(username, password, tokens.login).then(function (data) {
        afterAuth(data);
      }).catch(function (error) {
        msg(message, error.message, 'err');
        if (resets.login) { resets.login(); mountCaptcha(); }
        button.disabled = false;
        button.textContent = T('Войти', 'Sign in');
        busy = false;
      });
    });
  }

  function bindRegister() {
    var form = $('#formRegister');
    var hint = $('#regHint');
    var answer = null;
    var check = VG.debounce(function () {
      var value = field(form, 'username').value.trim();
      if (value.length < 3) {
        if (!hint) return;
        hint.className = 'hint';
        hint.textContent = value ? T('Минимум 3 символа.', 'At least 3 characters.') : '';
        return;
      }
      VG.api('/api/auth/availability?username=' + encodeURIComponent(value)).then(function (data) {
        answer = data;
        if (!hint) return;
        hint.className = 'hint ' + (data.usernameTaken || data.valid === false ? 'bad' : 'good');
        hint.textContent = data.valid === false
          ? T('Недопустимый ник: 3–24 символа, буквы, цифры, пробел, точка, дефис.', 'Invalid nickname: 3–24 characters, letters, digits, space, dot, hyphen.')
          : data.usernameTaken ? T('Этот ник уже занят.', 'This nickname is taken.')
            : T('Ник свободен.', 'Nickname is available.');
      }).catch(function () {
        hint.textContent = '';
      });
    }, 350);
    if (hint) field(form, 'username').addEventListener('input', function () { hint.textContent = ''; check(); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      var message = $('#registerMsg');
      var username = field(form, 'username').value.trim();
      var password = field(form, 'password').value;
      if (username.length < 3) { msg(message, T('Ник должен быть не короче 3 символов.', 'Nickname must be at least 3 characters.'), 'err'); return; }
      if (password.length < 8) { msg(message, T('Пароль должен быть не короче 8 символов.', 'Password must be at least 8 characters.'), 'err'); return; }
      if (password !== field(form, 'confirm').value) { msg(message, T('Пароли не совпадают.', 'Passwords do not match.'), 'err'); return; }
      if (field(form, 'website') && field(form, 'website').value) { msg(message, T('Регистрация отклонена.', 'Registration rejected.'), 'err'); return; }
      if (answer && answer.usernameTaken) { msg(message, T('Этот ник уже занят.', 'This nickname is taken.'), 'err'); return; }
      busy = true;
      var button = $('#registerSubmit');
      button.disabled = true;
      button.textContent = T('Создаём аккаунт…', 'Creating account…');
      msg(message, '');
      VG.register(username, password, tokens.register, startedAt).then(function (data) {
        afterAuth(data);
      }).catch(function (error) {
        msg(message, error.message, 'err');
        if (resets.register) { resets.register(); mountCaptcha(); }
        button.disabled = false;
        button.textContent = T('Зарегистрироваться', 'Sign up');
        busy = false;
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var initial = new URLSearchParams(location.search).get('tab');
    switchTab(initial === 'register' ? 'register' : 'login', false);
    $$('.tabs button').forEach(function (button) {
      button.addEventListener('click', function () { switchTab(button.getAttribute('data-tab')); });
    });
    bindLogin();
    bindRegister();
    if (VG.session) mountCaptcha();
    else if (VG.sessionReady) VG.sessionReady.then(function () { mountCaptcha(); });
    if (VG.user()) {
      // Уже вошли — предлагаем перейти в профиль.
      var card = document.querySelector('.auth-card');
      if (card) {
        var box = VG.el('div', 'msg ok');
        box.innerHTML = T('Вы уже вошли как <b>' + escapeHtml(VG.user().username) + '</b>. ',
          'You are signed in as <b>' + escapeHtml(VG.user().username) + '</b>. ') +
          '<a href="profile.html" style="color:var(--lime)">' + T('Открыть профиль', 'Open profile') + '</a>';
        card.insertBefore(box, card.firstChild.nextSibling);
      }
    }
  });
})();
