/* Админ-панель. Все проверки прав — на сервере (админ-сессия в HttpOnly cookie).
   В браузере не хранится ни пароль, ни признак администратора. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var adminToken = '';
  var currentUser = null;
  var view = 'overview';

  function msg(node, text, kind) {
    if (!node) return;
    node.className = 'msg' + (kind ? ' ' + kind : '');
    node.textContent = text || '';
  }

  function esc(value) { return escapeHtml(value == null ? '' : value); }

  /* ------------------------------------------------------------------ login */
  function bindLogin() {
    var form = $('#adminForm');
    var captchaReset = null;
    function mount() {
      var cfg = (VG.session && VG.session.captcha) || null;
      if (cfg && cfg.enabled) {
        captchaReset = VG.renderTurnstile($('#captchaAdmin'), function (token) { adminToken = token; });
      }
    }
    if (VG.session) mount();
    else if (VG.sessionReady) VG.sessionReady.then(mount);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = $('#adminSubmit');
      button.disabled = true;
      button.textContent = T('Проверяем…', 'Checking…');
      var passwordInput = form.querySelector('[name="password"]');
      VG.api('/api/admin/login', { body: { password: passwordInput.value, turnstileToken: adminToken } })
        .then(function () {
          passwordInput.value = '';
          msg($('#adminMsg'), '');
          openApp();
        })
        .catch(function (error) {
          msg($('#adminMsg'), error.message, 'err');
          if (captchaReset) { captchaReset(); mount(); }
        })
        .then(function () {
          button.disabled = false;
          button.textContent = T('Войти', 'Sign in');
        });
    });
  }

  function api(path, options) {
    return VG.api(path, options).catch(function (error) {
      if (error.status === 401) {
        lock();
        throw error;
      }
      throw error;
    });
  }

  function lock() {
    $('#adminApp').classList.add('hidden');
    $('#adminLock').classList.remove('hidden');
  }

  function openApp() {
    $('#adminLock').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    switchView('overview');
  }

  /* --------------------------------------------------------------- overview */
  function loadOverview() {
    api('/api/admin/stats').then(function (data) {
      var stats = data.stats || {};
      $('#adminStats').innerHTML = [
        ['Пользователей', fmt(stats.users)], ['Активных за 24 ч', fmt(stats.active24)],
        ['Новых за 24 ч', fmt(stats.new24)], ['V в экономике', fmt(stats.coins)],
        ['Ставок в казино', fmt(stats.bets)], ['Оборот ставок', fmt(stats.staked) + ' V'],
        ['Выплачено', fmt(stats.paid) + ' V'], ['Запусков игр', fmt(stats.plays)],
        ['Заблокировано', fmt(stats.banned)], ['Операций с V', fmt(stats.ledger)]
      ].map(function (pair) {
        return '<div class="stat-card"><span>' + pair[0] + '</span><b>' + pair[1] + '</b></div>';
      }).join('') + '<div class="stat-card"><span>База данных</span><b style="font-size:16px">' + esc(stats.backend) + '</b></div>';
    }).catch(function (error) { VG.toast(error.message, 'bad'); });

    VG.api('/api/leaderboard').then(function (data) {
      $('#adminTop').innerHTML = (data.users || []).slice(0, 8).map(function (user) {
        return '<div class="list-row"><span class="ico">' + VG.icon('user', 16) + '</span>' +
          '<span class="meta"><b>' + esc(user.username) + '</b><small>' + esc(VG.titleLabel(user)) + '</small></span>' +
          '<span style="font-weight:800;color:#dcff8a">' + fmt(user.balance) + ' V</span></div>';
      }).join('') || '<div class="empty">Пользователей пока нет.</div>';
    }).catch(function () {});

    api('/api/admin/log').then(function (data) {
      renderLog($('#adminRecent'), (data.items || []).slice(0, 8));
    }).catch(function () {});
  }

  function renderLog(box, items) {
    if (!box) return;
    if (!items.length) { box.innerHTML = '<div class="empty">Журнал пуст.</div>'; return; }
    box.innerHTML = '<div class="list">' + items.map(function (row) {
      return '<div class="list-row"><span class="ico">' + VG.icon('clock', 16) + '</span>' +
        '<span class="meta"><b>' + esc(row.action) + (row.target ? ' · ' + esc(row.target) : '') + '</b>' +
        '<small>' + esc(row.admin) + ' · ' + VG.timeAgo(row.created) + (row.detail ? ' · ' + esc(row.detail) : '') + '</small></span></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ users */
  function loadUsers(query) {
    var box = $('#adminUsers');
    box.innerHTML = '<div class="loading-row"><span class="spinner"></span> Загрузка…</div>';
    api('/api/admin/users?limit=40&q=' + encodeURIComponent(query || '')).then(function (data) {
      $('#userTotal').textContent = T('Всего: ' + data.total, 'Total: ' + data.total);
      if (!data.users.length) { box.innerHTML = '<div class="empty">Никого не найдено.</div>'; return; }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Ник</th><th>Баланс</th><th>Статус</th>' +
        '<th>Регистрация</th><th>Активность</th><th></th></tr></thead><tbody>' + data.users.map(function (user) {
          return '<tr><td><b>' + esc(user.username) + '</b>' + (user.is_admin ? ' <span class="badge badge-new">admin</span>' : '') + '</td>' +
            '<td>' + fmt(user.coins) + ' V</td>' +
            '<td>' + (user.banned ? '<span class="badge badge-hot">бан</span>' : '<span class="muted">активен</span>') + '</td>' +
            '<td class="muted">' + VG.date(user.created) + '</td>' +
            '<td class="muted">' + (user.last_seen ? VG.timeAgo(user.last_seen) : '—') + '</td>' +
            '<td><button class="btn btn-sm btn-ghost" data-user="' + esc(user.username) + '">Открыть</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (error) {
      box.innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
    });
  }

  function loadUser(username) {
    var box = $('#userDetail');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="loading-row"><span class="spinner"></span> Загрузка профиля…</div>';
    api('/api/admin/user/' + encodeURIComponent(username)).then(function (data) {
      currentUser = data.user;
      var user = data.user;
      var stats = data.stats || {};
      var casino = stats.casino || {};
      box.innerHTML =
        '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:16px">' +
        VG.avatarHtml(user, 48) + '<div style="flex:1;min-width:180px"><h2 style="font-size:20px">' + esc(user.username) + '</h2>' +
        '<p class="muted" style="margin:2px 0 0;font-size:12.5px">ID ' + user.id + ' · регистрация ' + VG.date(user.created) +
        ' · последняя активность ' + (user.last_seen ? VG.timeAgo(user.last_seen) : '—') + '</p></div>' +
        '<button class="btn btn-sm btn-ghost" data-close-user>Закрыть</button></div>' +
        '<div class="stat-grid" style="margin-bottom:16px">' +
        '<div class="stat-card coins"><span>Баланс</span><b>' + fmt(user.coins) + '</b></div>' +
        '<div class="stat-card"><span>Игр</span><b>' + fmt(stats.games || 0) + '</b></div>' +
        '<div class="stat-card"><span>Ставок</span><b>' + fmt(casino.bets || 0) + '</b></div>' +
        '<div class="stat-card"><span>Выигрыши</span><b>' + fmt(casino.won || 0) + '</b></div>' +
        '<div class="stat-card"><span>Статус</span><b style="font-size:16px">' + (user.banned ? 'Бан' : 'Активен') + '</b></div>' +
        '<div class="stat-card"><span>Права</span><b style="font-size:16px">' + (user.is_admin ? 'Админ' : 'Игрок') + '</b></div></div>' +
        '<div class="grid grid-2" style="gap:14px">' +
        '<div><h4 style="font-size:13px;margin-bottom:8px">Изменить баланс</h4>' +
        '<div class="row" style="margin-bottom:8px"><input type="number" id="balanceDelta" placeholder="Например, 500 или -100" style="flex:2">' +
        '<input type="text" id="balanceReason" placeholder="Причина" style="flex:2"></div>' +
        '<div class="row"><button class="btn btn-sm btn-primary" data-balance="delta">Начислить / списать</button>' +
        '<button class="btn btn-sm btn-ghost" data-balance="set">Установить точное значение</button></div>' +
        '<p class="msg" id="balanceMsg"></p>' +
        '<div class="divider"></div><h4 style="font-size:13px;margin-bottom:8px">Доступ</h4>' +
        '<div class="row"><button class="btn btn-sm ' + (user.banned ? 'btn-ghost' : 'btn-danger') + '" data-ban>' +
        (user.banned ? 'Разблокировать' : 'Заблокировать') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-grant-admin>' + (user.is_admin ? 'Снять админа' : 'Выдать админа') + '</button></div>' +
        '<p class="msg" id="accessMsg"></p></div>' +
        '<div><h4 style="font-size:13px;margin-bottom:8px">Последние операции</h4>' +
        '<div style="max-height:280px;overflow:auto">' + (data.ledger || []).map(function (row) {
          return '<div class="list-row" style="margin-bottom:6px"><span class="meta"><b>' + esc(row.reason) + '</b>' +
            '<small>' + VG.timeAgo(row.created) + ' · баланс ' + fmt(row.balance) + ' V</small></span>' +
            '<span class="' + (row.delta > 0 ? 'pos' : 'neg') + '" style="font-weight:800">' +
            (row.delta > 0 ? '+' : '') + fmt(row.delta) + '</span></div>';
        }).join('') + '</div></div></div>' +
        '<div class="divider"></div><h4 style="font-size:13px;margin-bottom:8px">История казино</h4>' +
        '<div class="table-wrap"><table><thead><tr><th>Игра</th><th>Ставка</th><th>Выигрыш</th><th>Результат</th><th>Время</th></tr></thead><tbody>' +
        ((data.casinoHistory || []).map(function (row) {
          return '<tr><td>' + esc(row.game) + '</td><td>' + fmt(row.stake) + '</td><td>' + fmt(row.payout) + '</td>' +
            '<td class="muted">' + esc(row.outcome) + '</td><td class="muted">' + VG.timeAgo(row.created) + '</td></tr>';
        }).join('') || '<tr><td colspan="5" class="muted">Ставок не было</td></tr>') + '</tbody></table></div>' +
        '<div class="divider"></div><h4 style="font-size:13px;margin-bottom:8px">Достижения и покупки</h4>' +
        '<div class="muted" style="font-size:12.5px">' + ((data.achievements || []).length) + ' достижений · ' +
        ((data.purchases || []).length) + ' покупок</div>';
      if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (error) {
      box.innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
    });
  }

  /* ------------------------------------------------------------------ games */
  function loadGames() {
    var box = $('#adminGames');
    api('/api/admin/games').then(function (data) {
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Игра</th><th>Награда</th><th>Игроки</th>' +
        '<th>Запуски</th><th>Начислено</th><th>Статус</th></tr></thead><tbody>' + data.games.map(function (game) {
          return '<tr><td><b>' + esc(game.name) + '</b></td><td>+' + game.reward + ' V</td><td>' + fmt(game.players) + '</td>' +
            '<td>' + fmt(game.plays) + '</td><td>' + fmt(game.earned) + ' V</td>' +
            '<td><button class="btn btn-sm ' + (game.enabled ? 'btn-ghost' : 'btn-primary') + '" data-game-toggle="' +
            esc(game.id) + '" data-enabled="' + (game.enabled ? '1' : '0') + '">' +
            (game.enabled ? 'Отключить' : 'Включить') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (error) { box.innerHTML = '<div class="empty">' + esc(error.message) + '</div>'; });
  }

  /* ----------------------------------------------------------------- casino */
  function loadCasino() {
    var box = $('#adminCasino');
    api('/api/admin/settings').then(function (data) {
      var settings = data.settings || {};
      function toggle(key, label) {
        return '<label class="checkbox" style="margin-bottom:10px"><input type="checkbox" data-setting="' + key + '"' +
          (settings[key] === '1' ? ' checked' : '') + '><span>' + label + '</span></label>';
      }
      box.innerHTML = toggle('casino_enabled', 'Казино включено') +
        toggle('wheel_enabled', 'Колесо включено') + toggle('slots_enabled', 'Слоты включены') +
        '<div class="row" style="margin-top:12px">' +
        '<label class="field"><span>Мин. ставка, V</span><input type="number" id="minStake" value="' + esc(settings.min_stake || 5) + '" min="1"></label>' +
        '<label class="field"><span>Макс. ставка, V</span><input type="number" id="maxStake" value="' + esc(settings.max_stake || 100) + '" min="1"></label>' +
        '</div>' +
        '<p class="muted" style="font-size:12.5px">RTP слотов: ' + ((data.rules.slots.rtp * 100).toFixed(1)) +
        '% · RTP колеса: ' + ((data.rules.wheel.rtp * 100).toFixed(1)) + '%. Значения заданы в game_catalog.py.</p>' +
        '<button class="btn btn-primary" id="saveCasino">Сохранить настройки</button><p class="msg" id="casinoMsg"></p>';
    }).catch(function (error) { box.innerHTML = '<div class="empty">' + esc(error.message) + '</div>'; });
  }

  /* ------------------------------------------------------------------- view */
  function switchView(name) {
    view = name;
    $$('.admin-side [data-view]').forEach(function (button) {
      button.classList.toggle('on', button.getAttribute('data-view') === name);
    });
    ['overview', 'users', 'games', 'casino', 'log'].forEach(function (panel) {
      var node = $('#view-' + panel);
      if (node) node.classList.toggle('hidden', panel !== name);
    });
    if (name === 'overview') loadOverview();
    if (name === 'users') loadUsers('');
    if (name === 'games') loadGames();
    if (name === 'casino') loadCasino();
    if (name === 'log') api('/api/admin/log').then(function (data) {
      renderLog($('#adminLog'), data.items || []);
    }).catch(function (error) {
      renderLog($('#adminLog'), []);
      msg($('#adminLog'), error.message, 'err');
    });
  }

  /* ----------------------------------------------------------------- events */
  document.addEventListener('DOMContentLoaded', function () {
    bindLogin();
    document.addEventListener('click', function (event) {
      var viewButton = event.target.closest('[data-view]');
      if (viewButton) { switchView(viewButton.getAttribute('data-view')); return; }
      if (event.target.closest('#adminLogout')) {
        VG.api('/api/admin/logout', { body: {} }).then(lock).catch(lock);
        return;
      }
      if (event.target.closest('#userRefresh')) { loadUsers($('#userSearch').value); return; }
      var openUser = event.target.closest('[data-user]');
      if (openUser) { loadUser(openUser.getAttribute('data-user')); return; }
      if (event.target.closest('[data-close-user]')) { $('#userDetail').classList.add('hidden'); return; }

      var balanceButton = event.target.closest('[data-balance]');
      if (balanceButton && currentUser) {
        var value = Number($('#balanceDelta').value);
        var reason = $('#balanceReason').value || 'Изменение администратора';
        if (!Number.isFinite(value) || (balanceButton.getAttribute('data-balance') === 'delta' && !value)) {
          msg($('#balanceMsg'), 'Введите сумму.', 'err');
          return;
        }
        var payload = { username: currentUser.username, reason: reason };
        if (balanceButton.getAttribute('data-balance') === 'set') payload.set = value;
        else payload.delta = value;
        balanceButton.disabled = true;
        api('/api/admin/balance', { body: payload }).then(function (data) {
          msg($('#balanceMsg'), 'Новый баланс: ' + fmt(data.coins) + ' V', 'ok');
          currentUser.coins = data.coins;
          loadUser(currentUser.username);
        }).catch(function (error) {
          msg($('#balanceMsg'), error.message, 'err');
        }).then(function () { balanceButton.disabled = false; });
        return;
      }
      if (event.target.closest('[data-ban]') && currentUser) {
        var banButton = event.target.closest('[data-ban]');
        var nextBanned = !currentUser.banned;
        api('/api/admin/banned', { body: { username: currentUser.username, banned: nextBanned, reason: 'Действие администратора' } })
          .then(function () {
            VG.toast(nextBanned ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
            loadUser(currentUser.username);
            loadUsers($('#userSearch').value);
          }).catch(function (error) { msg($('#accessMsg'), error.message, 'err'); });
        return;
      }
      if (event.target.closest('[data-grant-admin]') && currentUser) {
        var grant = !currentUser.is_admin;
        api('/api/admin/is_admin', { body: { username: currentUser.username, isAdmin: grant } })
          .then(function () { loadUser(currentUser.username); })
          .catch(function (error) { msg($('#accessMsg'), error.message, 'err'); });
        return;
      }
      var gameToggle = event.target.closest('[data-game-toggle]');
      if (gameToggle) {
        var enabled = gameToggle.getAttribute('data-enabled') !== '1';
        api('/api/admin/games', { body: { id: gameToggle.getAttribute('data-game-toggle'), enabled: enabled } })
          .then(loadGames).catch(function (error) { VG.toast(error.message, 'bad'); });
        return;
      }
      if (event.target.closest('#saveCasino')) {
        var payloadSettings = {};
        $$('[data-setting]').forEach(function (input) {
          payloadSettings[input.getAttribute('data-setting')] = input.checked ? '1' : '0';
        });
        payloadSettings.min_stake = Number($('#minStake').value) || 5;
        payloadSettings.max_stake = Number($('#maxStake').value) || 100;
        api('/api/admin/settings', { body: { settings: payloadSettings } }).then(function () {
          msg($('#casinoMsg'), 'Настройки сохранены.', 'ok');
        }).catch(function (error) { msg($('#casinoMsg'), error.message, 'err'); });
      }
    });
    var search = $('#userSearch');
    if (search) search.addEventListener('input', VG.debounce(function () { loadUsers(search.value); }, 300));

    // Проверяем существующую админ-сессию, чтобы не вводить пароль повторно.
    api('/api/admin/stats').then(openApp).catch(lock);
  });
})();
