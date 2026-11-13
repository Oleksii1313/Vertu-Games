/* Профиль: данные с сервера (/api/me или публичный /api/profile/<ник>),
   история операций, казино, покупки, смена пароля и оформление. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var catalog = null;

  function requestedUser() {
    var params = new URLSearchParams(location.search);
    return params.get('u') || '';
  }

  function kindBadges(data, areMine) {
    var ach = data.achievements || [];
    var stats = data.stats || {};
    var casino = data.casino || {};
    return '<div class="stat-card coins"><span>' + T('Баланс', 'Balance') + '</span>' +
      '<b id="profStatBalance">' + fmt(data.user.coins) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Уровень', 'Level') + '</span><b>' + (data.level ? data.level.level : 1) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Игр сыграно', 'Games played') + '</span><b>' + fmt(stats.games || 0) + '</b></div>' +
      '<div class="stat-card"><span>' + T('Достижений', 'Achievements') + '</span><b>' + fmt(ach.length) + '</b></div>' +
      (areMine ? '<div class="stat-card"><span>' + T('Ставок в казино', 'Casino bets') + '</span><b>' + fmt(casino.bets || 0) + '</b></div>' +
        '<div class="stat-card"><span>' + T('Лучший выигрыш', 'Best win') + '</span><b>' + fmt(casino.best || 0) + '</b></div>' : '');
  }

  function ledgerRows(items) {
    if (!items || !items.length) return '<div class="empty">Операций пока нет.</div>';
    return '<div class="table-wrap"><table><thead><tr><th>Операция</th><th>Сумма</th><th>Баланс</th><th>Когда</th></tr></thead><tbody>' +
      items.map(function (row) {
        return '<tr><td>' + escapeHtml(row.reason || row.kind) + '</td>' +
          '<td class="' + (row.delta > 0 ? 'pos' : 'neg') + '">' + (row.delta > 0 ? '+' : '') + fmt(row.delta) + ' V</td>' +
          '<td>' + fmt(row.balance) + ' V</td><td class="muted">' + VG.timeAgo(row.created) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function achievementRows(items) {
    if (!items || !items.length) return '<div class="empty">Достижений пока нет.</div>';
    return '<div class="list">' + items.map(function (item) {
      return '<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'trophy', 17) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? item.name_en : item.name_ru) + '</b>' +
        '<small>' + escapeHtml(VG.lang() === 'en' ? item.desc_en : item.desc_ru) + '</small></span>' +
        '<span style="font-weight:800;color:#dcff8a;font-size:12px">+' + fmt(item.coins) + ' V</span></div>';
    }).join('') + '</div>';
  }

  function casinoRows(items) {
    if (!items) return '<div class="empty">Войдите, чтобы увидеть историю казино.</div>';
    if (!items.length) return '<div class="empty">Ставок пока не было. <a href="casino.html" style="color:var(--lime)">В казино</a></div>';
    return '<div class="list">' + items.slice(0, 10).map(function (row) {
      return '<div class="list-row"><span class="ico">' + VG.icon(row.payout > 0 ? 'trophy' : 'dice', 16) + '</span>' +
        '<span class="meta"><b>' + (row.game === 'slots' ? T('Слоты', 'Slots') : T('Колесо', 'Wheel')) +
        ' · ' + escapeHtml(row.outcome) + '</b><small>' + VG.timeAgo(row.created) + ' · ' + T('ставка', 'stake') +
        ' ' + fmt(row.stake) + ' V</small></span>' +
        '<span style="font-weight:800;color:' + (row.payout > 0 ? '#dcff8a' : 'var(--muted)') + '">' +
        (row.payout > 0 ? '+' : '') + fmt(row.payout) + ' V</span></div>';
    }).join('') + '</div>';
  }

  function purchaseRows(items) {
    if (!items || !items.length) return '<div class="empty">Покупок пока нет. <a href="shop.html" style="color:var(--lime)">В магазин</a></div>';
    return '<div class="list">' + items.map(function (item) {
      return '<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'bag', 16) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? (item.name_en || item.item_id) : (item.name_ru || item.item_id)) +
        '</b><small>V · ' + VG.date(item.created) + '</small></span>' +
        '<span class="muted" style="font-size:12px">' + fmt(item.price) + ' V</span></div>';
    }).join('') + '</div>';
  }

  function render(data, areMine) {
    var user = data.user;
    document.title = user.username + ' — Vertu Games';
    $('#profAvatar').innerHTML = VG.avatarHtml(user, 52);
    $('#profAvatar').style.color = VG.colorHex(user.color);
    $('#profName').innerHTML = escapeHtml(user.username) +
      ' <span class="badge badge-line">' + escapeHtml(VG.titleLabel(user)) + '</span>';
    $('#profLevel').textContent = data.level ? data.level.level : 1;
    $('#profCreated').textContent = VG.date(user.created);
    $('#profPlays').textContent = fmt((data.stats || {}).games || 0);
    $('#accName').textContent = user.username;
    $('#profStats').innerHTML = kindBadges(data, areMine);
    $('#ledgerBody').innerHTML = areMine ? ledgerRows(data.ledger) : '<div class="empty">История операций видна только владельцу профиля.</div>';
    $('#achBody').innerHTML = achievementRows(data.achievements);
    $('#casinoBody').innerHTML = casinoRows(data.casino);
    $('#itemsBody').innerHTML = purchaseRows(data.purchases);
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
      render(data, !!areMine);
      $('#guestBlock').classList.add('hidden');
      $('#profileRoot').classList.add('hidden');
      if (areMine && VG.user()) VG.updateCoins(data.user.coins);   // шапка
    }).catch(function (error) {
      $('#profileRoot').innerHTML = '<div class="card panel"><h2 style="font-size:20px">Профиль недоступен</h2>' +
        '<p class="muted">' + escapeHtml(error.message) + '</p><a class="btn btn-ghost" href="top.html">В каталог</a></div>';
      if (error.status === 401) $('#guestBlock').classList.remove('hidden');
    });
  }

  function loadStylePicker() {
    var box = $('#stylePicker');
    if (!box) return;
    var apply = function () {
      ['avatar', 'color', 'title'].forEach(function (kind) {
        var group = $('#style-' + kind);
        if (!group) return;
        group.innerHTML = (catalog.items || []).filter(function (item) { return item.kind === kind; }).map(function (item) {
          var visual = kind === 'color'
            ? '<span class="swatch" style="background:' + item.payload + '"></span>'
            : kind === 'title'
              ? '<b style="font-size:13px">' + escapeHtml(VG.lang() === 'en' ? item.name_en : item.name_ru) + '</b>'
              : VG.icon(item.icon, 30);
          return '<button type="button" class="style-option' + (item.equipped ? ' on' : '') + '" data-style="' + item.id + '"' +
            (item.owned ? '' : ' disabled title="' + T('Сначала купите', 'Buy first') + '"') + '>' + visual + '</button>';
        }).join('');
      });
    };
    VG.api('/api/shop').then(function (data) {
      catalog = data;
      box.innerHTML = ['avatar', 'color', 'title'].map(function (kind) {
        return '<div style="margin-bottom:16px"><h4 style="font-size:13px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">' +
          { avatar: T('Аватар', 'Avatar'), color: T('Цвет', 'Color'), title: T('Титул', 'Title') }[kind] +
          '</h4><div id="style-' + kind + '" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>';
      }).join('');
      apply();
      box.addEventListener('click', function (event) {
        var button = event.target.closest('[data-style]');
        if (!button || button.disabled) return;
        var id = button.getAttribute('data-style');
        VG.equip(id).then(function () {
          catalog.items.forEach(function (item) { item.equipped = item.id === id; });
          apply();
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
    // Полная перезагрузка — только при входе/выходе. Изменение баланса
    // обновляет шапку (platform.js) и карточку баланса, без лишних запросов.
    VG.onSessionChange(load);
    VG.onChange(function (user) {
      if (!user) return;
      var stat = $('#profStatBalance');
      if (stat) stat.textContent = fmt(user.coins);
    });
  });
})();
