/* Профиль: данные с сервера (/api/me или публичный /api/profile/<ник>),
   история операций, казино, покупки, смена пароля и оформление.

   Страница двуязычная: статическая разметка переводится атрибутами data-ru /
   data-en (platform.js), а всё, что собирается здесь из ответа API, зависит от
   языка в момент отрисовки. Поэтому последний ответ API запоминается (view), а
   при смене языка блоки перерисовываются из него — без запроса к серверу и без
   перезагрузки страницы. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var catalog = null;
  /* Последний ответ API: источник для перерисовки при смене языка.
     casinoItems — история ставок из /api/casino/history (undefined — ещё не
     загружена, null — запрос не удался, массив — сами ставки). */
  var view = { data: null, areMine: false, casinoItems: undefined };

  function requestedUser() {
    var params = new URLSearchParams(location.search);
    return params.get('u') || '';
  }

  function kindBadges(data, areMine) {
    var ach = data.achievements || [];
    var stats = data.stats || {};
    // Счётчики казино сервер присылает в stats.casino; в старом ответе они
    // лежали в data.casino — поддерживаем оба варианта, но не путаем их со
    // списком ставок.
    var casino = (stats.casino && typeof stats.casino === 'object') ? stats.casino
      : (data.casino && !Array.isArray(data.casino) ? data.casino : {});
    return '<div class="stat-card coins"><span>' + T('Баланс', 'Balance') + '</span>' +
      '<b id="profStatBalance">' + fmt(data.user.coins) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Уровень', 'Level') + '</span><b>' + (data.level ? data.level.level : 1) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Игр сыграно', 'Games played') + '</span><b>' + fmt(stats.games || 0) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Достижений', 'Achievements') + '</span><b>' + fmt(ach.length) + '</b></div>' +
      (areMine ? '<div class="stat-card"><span>' + T('Ставок в казино', 'Casino bets') + '</span><b>' + fmt(casino.bets || 0) + '</b></div>' +
        '<div class="stat-card"><span>' + T('Лучший выигрыш', 'Best win') + '</span><b>' + fmt(casino.best || 0) + '</b></div>' : '');
  }

  /* Причина операции приходит с сервера по-русски; известные шаблоны
     переводит VG.ledgerReason, ники и заметки администратора не трогаем. */
  function ledgerReason(row) {
    if (VG.ledgerReason) return VG.ledgerReason(row);
    return row.reason || row.kind || '';
  }

  function ledgerRows(items) {
    if (!items || !items.length) return '<div class="empty">' + T('Операций пока нет.', 'No transactions yet.') + '</div>';
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>' + T('Операция', 'Operation') + '</th>' +
      '<th>' + T('Сумма', 'Amount') + '</th>' +
      '<th>' + T('Баланс', 'Balance') + '</th>' +
      '<th>' + T('Когда', 'When') + '</th>' +
      '</tr></thead><tbody>' +
      items.map(function (row) {
        return '<tr><td>' + escapeHtml(ledgerReason(row)) + '</td>' +
          '<td class="' + (row.delta > 0 ? 'pos' : 'neg') + '">' + (row.delta > 0 ? '+' : '') + fmt(row.delta) + ' V</td>' +
          '<td>' + fmt(row.balance) + ' V</td><td class="muted">' + VG.timeAgo(row.created) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function achievementRows(items) {
    if (!items || !items.length) return '<div class="empty">' + T('Достижений пока нет.', 'No achievements yet.') + '</div>';
    return '<div class="list">' + items.map(function (item) {
      // Дата открытия приходит с сервера (unix-секунды, UTC). Показываем
      // относительное время, полную дату — в подсказке.
      var when = item.unlocked ? VG.timeAgo(item.unlocked) : T('Дата неизвестна', 'Unknown date');
      return '<div class="list-row" title="' + escapeHtml(VG.stamp(item.unlocked)) + '">' +
        '<span class="ico">' + VG.icon(item.icon || 'trophy', 17) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.achievementName(item)) + '</b>' +
        '<small>' + escapeHtml(VG.lang() === 'en' ? (item.desc_en || item.desc_ru) : (item.desc_ru || item.desc_en)) +
        ' · ' + escapeHtml(when) + '</small></span>' +
        '<span style="font-weight:800;color:#dcff8a;font-size:12px">+' + fmt(item.coins) + ' V</span></div>';
    }).join('') + '</div>';
  }

  function casinoCard(items) {
    if (!view.areMine) {
      return '<div class="empty">' + T('История ставок видна только владельцу профиля.', 'The bet history is visible only to the profile owner.') + '</div>';
    }
    if (!items || !items.length) {
      return '<div class="empty">' + T('Ставок пока не было.', 'No bets yet.') + ' <a href="casino.html" style="color:var(--lime)">' +
        T('В казино', 'Go to the casino') + '</a></div>';
    }
    return '<div class="list">' + items.slice(0, 10).map(function (row) {
      // Ставка и выплата — отдельно, справа чистый итог: при x1 выплата равна
      // ставке, и «+20 V» не должно выглядеть выигрышем (net = 0).
      var rowNet = Number(row.payout) - Number(row.stake);
      return '<div class="list-row"><span class="ico">' + VG.icon(rowNet > 0 ? 'trophy' : 'dice', 16) + '</span>' +
        '<span class="meta"><b>' + (row.game === 'slots' ? T('Слоты', 'Slots') : T('Колесо', 'Wheel')) +
        ' · ' + escapeHtml(VG.casinoOutcome(row.outcome)) + '</b><small>' + VG.timeAgo(row.created) + ' · ' + T('ставка', 'stake') +
        ' −' + fmt(row.stake) + ' V · ' + T('выплата', 'payout') + ' +' + fmt(row.payout) + ' V</small></span>' +
        '<span style="font-weight:800;color:' + (rowNet > 0 ? '#dcff8a' : rowNet < 0 ? '#ff8fa3' : 'var(--muted)') + '">' +
        (rowNet > 0 ? '+' : '') + fmt(rowNet) + ' V</span></div>';
    }).join('') + '</div>';
  }

  function paintCasino() {
    var box = $('#casinoBody');
    if (!box || !view.data) return;
    var items = Array.isArray(view.data.casino) ? view.data.casino
      : (Array.isArray(view.casinoItems) ? view.casinoItems : null);
    box.innerHTML = casinoCard(items);
  }

  /* Ежедневные задания: прогресс и кнопка «Забрать» (награду выдаёт сервер). */
  function taskRows(items) {
    if (!items || !items.length) {
      return '<div class="empty">' + T('На сегодня заданий нет.', 'No tasks for today.') + '</div>';
    }
    return '<div class="list">' + items.map(function (task) {
      var target = Math.max(1, Number(task.target_value) || 1);
      var progress = Math.min(target, Number(task.progress) || 0);
      var pct = Math.round((progress / target) * 100);
      var done = progress >= target;
      var action = task.claimed
        ? '<span class="badge badge-line">' + T('Получено', 'Claimed') + '</span>'
        : (done
          ? '<button class="btn btn-sm btn-primary" data-task-claim="' + Number(task.id) + '">' +
            T('Забрать +', 'Claim +') + fmt(task.reward) + ' V</button>'
          : '<span class="muted" style="font-size:12px">' + progress + '/' + target + '</span>');
      return '<div class="list-row"><span class="ico">' + VG.icon('target', 16) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? (task.title_en || task.title) : (task.title || task.title_en)) + '</b>' +
        '<small>' + escapeHtml(VG.lang() === 'en' ? (task.desc_en || '') : (task.description || '')) + '</small>' +
        '<span class="progress" style="display:block;height:4px;border-radius:3px;margin-top:6px;background:rgba(255,255,255,.12)">' +
        '<span style="display:block;height:100%;border-radius:3px;width:' + pct + '%;background:var(--grad)"></span></span>' +
        '</span>' + action + '</div>';
    }).join('') + '</div>';
  }

  function purchaseRows(items) {
    if (!items || !items.length) {
      return '<div class="empty">' + T('Покупок пока нет.', 'No purchases yet.') + ' <a href="shop.html" style="color:var(--lime)">' +
        T('В магазин', 'Go to the shop') + '</a></div>';
    }
    return '<div class="list">' + items.map(function (item) {
      return '<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'bag', 16) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? (item.name_en || item.name_ru || item.item_id) : (item.name_ru || item.name_en || item.item_id)) +
        '</b><small>V · ' + VG.date(item.created) + '</small></span>' +
        '<span class="muted" style="font-size:12px">' + fmt(item.price) + ' V</span></div>';
    }).join('') + '</div>';
  }

  /* Отрисовка всего динамического содержимого из последнего ответа API.
     Вызывается и после загрузки, и при смене языка. */
  function paint() {
    var data = view.data, areMine = view.areMine;
    if (!data) return;
    var user = data.user;
    document.title = user.username + ' — Vert Games';
    $('#profAvatar').innerHTML = VG.avatarHtml(user, 52);
    $('#profAvatar').style.color = VG.colorHex(user.color);
    $('#profName').innerHTML = escapeHtml(user.username) +
      ' <span class="badge badge-line">' + escapeHtml(VG.titleLabel(user)) + '</span>';
    $('#profLevel').textContent = data.level ? data.level.level : 1;
    $('#profCreated').textContent = VG.date(user.created);
    $('#profPlays').textContent = fmt((data.stats || {}).games || 0);
    $('#accName').textContent = user.username;
    $('#profStats').innerHTML = kindBadges(data, areMine);
    $('#ledgerBody').innerHTML = areMine ? ledgerRows(data.ledger) : '<div class="empty">' + T('История операций видна только владельцу профиля.', 'The transaction history is visible only to the profile owner.') + '</div>';
    $('#achBody').innerHTML = achievementRows(data.achievements);
    paintCasino();
    $('#itemsBody').innerHTML = purchaseRows(data.purchases);
    if ($('#tasksBody')) $('#tasksBody').innerHTML = taskRows(data.tasks);
    var body = $('#profileBody');
    body.classList.remove('hidden');
    if (areMine) {
      $('#editProfile').classList.remove('hidden');
      $('#logoutBtn').classList.remove('hidden');
      $('#security').classList.remove('hidden');
      $('#profAdminBadge').innerHTML = user.isAdmin
        ? '<a class="badge badge-new" href="admin.html">' + T('Администратор', 'Administrator') + '</a>' : '';
    } else {
      $('#editProfile').classList.add('hidden');
      $('#logoutBtn').classList.add('hidden');
      $('#security').classList.add('hidden');
    }
  }

  function render(data, areMine) {
    view.data = data;
    view.areMine = !!areMine;
    view.casinoItems = Array.isArray(data.casino) ? data.casino : undefined;
    paint();
  }

  /* История ставок: сервер отдаёт её отдельным запросом. Без него карточка
     казино показывала владельцу профиля «войдите, чтобы увидеть историю». */
  function loadCasinoHistory() {
    if (!view.areMine) return;
    VG.api('/api/casino/history?limit=10').then(function (data) {
      view.casinoItems = Array.isArray(data.items) ? data.items : [];
      paintCasino();
    }).catch(function () {
      view.casinoItems = null;
      paintCasino();
    });
  }

  function bindTaskClaims() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-task-claim]');
      if (!button) return;
      button.disabled = true;
      VG.api('/api/tasks/claim', { body: { task: Number(button.getAttribute('data-task-claim')) } })
        .then(function (data) {
          if (data.already) {
            VG.toast(T('Награда уже получена', 'Reward already claimed'), 'bad');
          } else if (data.reward > 0) {
            VG.toast(T('+' + fmt(data.reward) + ' V за задание', '+' + fmt(data.reward) + ' V for the task'));
          }
          if (data.user) VG.setUser(data.user);
          if (data.tasks && view.data) view.data.tasks = data.tasks;
          if ($('#tasksBody')) $('#tasksBody').innerHTML = taskRows(data.tasks);
        })
        .catch(function (error) { VG.toast(error.message, 'bad'); })
        .then(function () { button.disabled = false; });
    });
  }

  /* Состояние ошибки: текст переводится при смене языка так же, как данные. */
  var failState = null;
  function paintError() {
    var root = $('#profileRoot');
    if (!root || !failState) return;
    var error = failState;
    root.classList.remove('hidden');
    root.innerHTML = '<div class="card panel"><h2 style="font-size:20px">' +
      T('Профиль недоступен', 'Profile unavailable') + '</h2>' +
      '<p class="muted">' + escapeHtml(failMessage(error)) + '</p>' +
      '<a class="btn btn-ghost" href="top.html">' + T('В каталог', 'Back to the catalog') + '</a></div>';
  }

  function failMessage(error) {
    if (error.status === 404) return T('Такого игрока нет.', 'No such player.');
    if (error.status === 401) return T('Войдите в аккаунт, чтобы открыть профиль.', 'Sign in to open your profile.');
    return error.message;
  }

  function load() {
    var mine = requestedUser();
    if (!mine && !VG.user()) {
      $('#guestBlock').classList.remove('hidden');
      $('#profileRoot').innerHTML = '';
      return;
    }
    var url = mine ? '/api/profile/' + encodeURIComponent(mine) : '/api/me';
    VG.api(url).then(function (data) {
      var areMine = !mine || (VG.user() && VG.user().username.toLowerCase() === mine.toLowerCase());
      failState = null;
      render(data, !!areMine);
      loadCasinoHistory();
      $('#guestBlock').classList.add('hidden');
      $('#profileRoot').classList.add('hidden');
      if (areMine && VG.user()) VG.updateCoins(data.user.coins);   // шапка
    }).catch(function (error) {
      failState = error;
      paintError();
      if (error.status === 401) $('#guestBlock').classList.remove('hidden');
    });
  }

  /* ------------------------------------------------------------- оформление */
  var STYLE_KINDS = {
    avatar: function () { return T('Аватар', 'Avatar'); },
    color: function () { return T('Цвет', 'Color'); },
    title: function () { return T('Титул', 'Title'); }
  };

  function styleOptionHtml(item, kind) {
    var visual = kind === 'color'
      ? '<span class="swatch" style="background:' + item.payload + '"></span>'
      : kind === 'title'
        ? '<b style="font-size:13px">' + escapeHtml(VG.lang() === 'en' ? (item.name_en || item.name_ru) : (item.name_ru || item.name_en)) + '</b>'
        : VG.icon(item.icon, 30);
    return '<button type="button" class="style-option' + (item.equipped ? ' on' : '') + '" data-style="' + item.id + '"' +
      (item.owned ? '' : ' disabled title="' + T('Сначала купите', 'Buy first') + '"') + '>' + visual + '</button>';
  }

  /* Перерисовка выбора оформления из уже загруженного каталога. */
  function paintStylePicker() {
    var box = $('#stylePicker');
    if (!box || !catalog) return;
    var groups = ['avatar', 'color', 'title'];
    // Оболочка строится один раз, дальше обновляются только сами варианты:
    // обработчик клика висит на #stylePicker и не дублируется.
    if (!box.querySelector('[data-style-group]')) {
      box.innerHTML = groups.map(function (kind) {
        return '<div data-style-group="' + kind + '" style="margin-bottom:16px">' +
          '<h4 style="font-size:13px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)" ' +
          'data-style-title="' + kind + '"></h4>' +
          '<div id="style-' + kind + '" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>';
      }).join('');
    }
    groups.forEach(function (kind) {
      var caption = box.querySelector('[data-style-title="' + kind + '"]');
      if (caption) caption.textContent = STYLE_KINDS[kind]();
      var group = $('#style-' + kind);
      if (group) {
        group.innerHTML = (catalog.items || []).filter(function (item) { return item.kind === kind; })
          .map(function (item) { return styleOptionHtml(item, kind); }).join('');
      }
    });
  }

  function loadStylePicker() {
    var box = $('#stylePicker');
    if (!box) return;
    VG.api('/api/shop').then(function (data) {
      catalog = data;
      paintStylePicker();
      box.addEventListener('click', function (event) {
        var button = event.target.closest('[data-style]');
        if (!button || button.disabled) return;
        var id = button.getAttribute('data-style');
        VG.equip(id).then(function () {
          (catalog.items || []).forEach(function (item) { item.equipped = item.id === id; });
          paintStylePicker();
          VG.toast(T('Оформление обновлено.', 'Appearance updated.'));
        }).catch(function (error) { VG.toast(error.message, 'bad'); });
      });
    }).catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();
    var form = $('#passwordForm');
    if (form) form.addEventListener('submit', function (event) {
      event.preventDefault();
      var message = $('#passwordMsg');
      var data = new FormData(form);
      if (data.get('password') !== data.get('confirm')) {
        message.className = 'msg err';
        message.textContent = T('Пароли не совпадают.', 'Passwords do not match.');
        return;
      }
      var button = form.querySelector('button[type=submit]');
      button.disabled = true;
      VG.changePassword(data.get('current'), data.get('password')).then(function () {
        message.className = 'msg ok';
        message.textContent = T('Пароль обновлён. Другие сессии закрыты.', 'Password updated. Other sessions closed.');
        form.reset();
      }).catch(function (error) {
        message.className = 'msg err';
        message.textContent = error.message;
      }).then(function () { button.disabled = false; });
    });
    var logout = $('#logoutBtn');
    if (logout) logout.addEventListener('click', function () { VG.logout(); });
    var modal = $('#styleModal');
    var edit = $('#editProfile');
    if (edit) edit.addEventListener('click', function () {
      modal.classList.add('open');
      if (!catalog) loadStylePicker();
    });
    if (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === modal || event.target.closest('[data-close-style]')) modal.classList.remove('open');
      });
    }
    bindTaskClaims();
    // Смена языка без перезагрузки: статику переводит platform.js, а списки и
    // подписи, собранные из ответа API, перерисовываем здесь.
    VG.onLangChange(function () {
      paint();
      paintError();
      paintStylePicker();
    });
    // Полная перезагрузка — только при входе/выходе. Изменение баланса
    // обновляет шапку (platform.js) и карточку баланса, без лишних запросов.
    VG.onSessionChange(load);
    VG.onChange(function (user) {
      if (!user) return;
      var stat = $('#profStatBalance');
      if (stat) stat.textContent = fmt(user.coins);
      if (view.data && view.data.user) view.data.user.coins = user.coins;
    });
  });
})();
