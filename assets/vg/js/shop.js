/* Магазин: покупка и экипировка через серверные API.
   Баланс и владение приходят с сервера, локальных "монет" больше нет. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var catalog = null;

  function kindName(kind) {
    return {
      avatar: T('Аватар', 'Avatar'), color: T('Цвет', 'Color'), title: T('Титул', 'Title'),
      boost: T('Бонус', 'Boost'), service: T('Услуга', 'Service')
    }[kind] || kind;
  }

  function paintItem(item) {
    var card = $('[data-item="' + item.id + '"]');
    if (!card) return;
    /* Услуга (смена ника): её нельзя «купить навсегда» и нельзя надеть —
       кнопка просто открывает окно смены ника, платит сервер при подтверждении. */
    if (item.kind === 'service') {
      var serviceButton = $('[data-rename]', card);
      if (serviceButton) {
        serviceButton.disabled = false;
        serviceButton.textContent = T('Сменить ник', 'Change username');
      }
      return;
    }
    var button = $('[data-buy]', card);
    card.classList.toggle('owned', item.owned);
    var flag = $('.flag', card);
    if (item.owned && !flag) {
      flag = VG.el('span', 'badge badge-new flag', T('Куплено', 'Owned'));
      card.appendChild(flag);
    }
    if (!item.owned) {
      button.disabled = false;
      button.textContent = item.price ? T('Купить', 'Buy') : T('Получить', 'Get');
      button.className = 'btn btn-sm btn-primary btn-block';
      return;
    }
    if (item.kind === 'boost') {
      button.disabled = true;
      button.textContent = T('Использован', 'Used');
      button.className = 'btn btn-sm btn-ghost btn-block';
      return;
    }
    if (item.equipped) {
      button.disabled = true;
      button.textContent = T('Надето', 'Equipped');
      button.className = 'btn btn-sm btn-ghost btn-block';
    } else {
      button.disabled = false;
      button.textContent = T('Надеть', 'Equip');
      button.className = 'btn btn-sm btn-ghost btn-block';
      button.setAttribute('data-equip', item.id);
    }
  }

  function findItem(id) {
    return catalog && catalog.items.filter(function (item) { return item.id === id; })[0];
  }

  function loadOwned() {
    var box = $('#ownedList');
    if (!box) return;
    if (!VG.user()) {
      box.innerHTML = '<div class="empty">' +
        T('Войдите, чтобы увидеть покупки.', 'Sign in to see your purchases.') +
        ' <a href="login.html" style="color:var(--lime)">' + T('Войти', 'Sign in') + '</a></div>';
      return;
    }
    VG.api('/api/me').then(function (data) {
      var rows = [];
      (data.achievements || []).forEach(function (ach) {
        rows.push('<div class="list-row"><span class="ico">' + VG.icon(ach.icon || 'trophy', 17) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(VG.achievementName(ach)) + '</b>' +
          '<small>' + T('Достижение', 'Achievement') + ' · ' + VG.date(ach.unlocked) + '</small></span>' +
          '<span style="color:#dcff8a;font-weight:800;font-size:12px">+' + fmt(ach.coins) + ' V</span></div>');
      });
      (data.purchases || []).forEach(function (item) {
        rows.push('<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'bag', 17) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? item.name_en : item.name_ru) + '</b>' +
          '<small>' + escapeHtml(kindName(item.kind)) + ' · ' + VG.date(item.created) + '</small></span>' +
          '<span class="muted" style="font-size:12px">' + fmt(item.price) + ' V</span></div>');
      });
      if (!rows.length) rows.push('<div class="empty">' +
        T('Покупок пока нет. Аватары и цвета доступны в разделах выше.',
          'No purchases yet. Avatars and colours are available in the sections above.') + '</div>');
      var stats = data.stats || {};
      rows.unshift('<div class="stat-grid" style="margin-bottom:12px">' +
        '<div class="stat-card coins"><span>' + escapeHtml(T('Баланс', 'Balance')) + '</span><b>' + fmt(data.user.coins) + '</b></div>' +
        '<div class="stat-card"><span>' + escapeHtml(T('Игр сыграно', 'Games played')) + '</span><b>' + fmt(stats.games || 0) + '</b></div>' +
        '<div class="stat-card"><span>' + escapeHtml(T('Достижений', 'Achievements')) + '</span><b>' + fmt((data.achievements || []).length) + '</b></div></div>');
      box.innerHTML = rows.join('');
    }).catch(function (error) {
      box.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  }

  function load() {
    VG.api('/api/shop').then(function (data) {
      catalog = data;
      (data.items || []).forEach(paintItem);
      var note = $('#paymentsNote');
      if (note) {
        note.textContent = data.payments && data.payments.configured
          ? T('Платёжный провайдер подключён. Пакеты V покупаются за деньги и начисляются на серверный баланс.',
            'A payment provider is configured. V packs can be purchased and are credited on the server.')
          : T('Покупка монет за деньги отключена: V зарабатываются в играх и казино.',
            'Buying coins for money is disabled: V is earned in games and the casino.');
      }
      loadOwned();
    }).catch(function (error) {
      VG.toast(error.message, 'bad');
    });
  }

  function buy(id) {
    if (!VG.user()) {
      VG.toast(T('Войдите, чтобы покупать.', 'Sign in to buy.'), 'bad');
      setTimeout(function () { location.href = 'login.html?next=shop'; }, 600);
      return;
    }
    var item = findItem(id);
    if (!item) return;
    var button = $('[data-item="' + id + '"] [data-buy]');
    if (button) { button.disabled = true; button.textContent = T('Покупаем…', 'Buying…'); }
    VG.purchase(id).then(function (data) {
      item.owned = true;
      if (item.kind !== 'boost') {
        VG.equip(id).then(function (result) {
          if (result.user) item.equipped = true;
          catalog.items.forEach(function (other) {
            if (other.kind === item.kind && other.id !== item.id) other.equipped = false;
            if (other.kind === item.kind && other.id === item.id) other.equipped = true;
          });
          (catalog.items || []).forEach(paintItem);
          loadOwned();
        });
      } else {
        (catalog.items || []).forEach(paintItem);
        loadOwned();
      }
    }).catch(function (error) {
      VG.toast(error.message, 'bad');
      if (button) { button.disabled = false; button.textContent = T('Купить', 'Buy'); }
    });
  }

  /* ------------------------------------------------------------------ смена ника */
  /* Подсказка и все подписи окна читаются через T() при каждой отрисовке:
     смена языка обновляет фичу сразу, без перезагрузки страницы. */
  function nameHint() {
    return T('3–24 символа: латиница, цифры, пробел, точка, дефис и _. Начинается и заканчивается буквой или цифрой.',
      '3–24 characters: Latin letters, digits, space, dot, dash and _. Must start and end with a letter or digit.');
  }
  var renamePaint = null;

  function nameError(name) {
    var value = String(name || '').trim();
    if (!value) return T('Введите новый ник.', 'Enter a new username.');
    if (value.length < 3 || value.length > 24) return T('Ник должен быть от 3 до 24 символов.', 'The username must be 3–24 characters long.');
    if (!/^[A-Za-z0-9]/.test(value) || !/[A-Za-z0-9_.]$/.test(value)) {
      return T('Ник должен начинаться и заканчиваться буквой или цифрой.', 'The username must start and end with a letter or digit.');
    }
    if (!/^[A-Za-z0-9 _.-]+$/.test(value)) {
      return T('Можно использовать только латиницу, цифры, пробел, точку, дефис и _.', 'Only Latin letters, digits, space, dot, dash and _ are allowed.');
    }
    if (value.indexOf('  ') >= 0) return T('Двойные пробелы не разрешены.', 'Double spaces are not allowed.');
    return '';
  }

  function codeMessage(error) {
    var code = error && error.code;
    var map = {
      NO_FUNDS: T('Недостаточно V-монет: смена ника стоит 1000 V.', 'Not enough V coins: a username change costs 1000 V.'),
      NAME_TAKEN: T('Этот ник уже занят.', 'That username is already taken.'),
      SAME_NAME: T('Это ваш текущий ник.', 'That is your current username.'),
      BAD_NAME: T('Некорректный ник.', 'Invalid username.'),
      RATE_LIMIT: T('Слишком много попыток. Попробуйте позже.', 'Too many attempts. Try again later.'),
      AUTH: T('Войдите в аккаунт.', 'Please sign in.')
    };
    return map[code] || (error && error.message) || T('Не удалось сменить ник.', 'Could not change the username.');
  }

  function closeRename() {
    var overlay = $('#vgRenameOverlay');
    if (overlay) overlay.remove();
    renamePaint = null;
    document.removeEventListener('keydown', onRenameKey);
  }

  function onRenameKey(event) {
    if (event.key === 'Escape') closeRename();
  }

  function openRename(item) {
    if (!VG.user()) {
      VG.toast(T('Войдите, чтобы сменить ник.', 'Sign in to change your username.'), 'bad');
      setTimeout(function () { location.href = 'login.html?next=shop'; }, 600);
      return;
    }
    closeRename();
    var price = item && item.price ? fmt(item.price) : '1000';
    var changing = false;
    function okLabel() {
      return changing ? T('Меняем…', 'Changing…') : T('Сменить за ' + price + ' V', 'Change for ' + price + ' V');
    }
    var overlay = VG.el('div', 'vg-rename-overlay');
    overlay.id = 'vgRenameOverlay';
    overlay.innerHTML =
      '<div class="vg-rename-card panel" role="dialog" aria-modal="true" aria-labelledby="vgRenameTitle">' +
        '<h3 id="vgRenameTitle">' + escapeHtml(T('Смена ника', 'Change username')) + '</h3>' +
        '<p class="muted" id="vgRenameDesc">' + escapeHtml(T('Услуга стоит ' + price + ' V. Монеты спишутся один раз при подтверждении, ник изменится сразу и сохранится на аккаунте.',
          'The service costs ' + price + ' V. Coins are charged once on confirmation, the username changes immediately and is stored on your account.')) + '</p>' +
        '<label class="vg-rename-label" id="vgRenameLabel" for="vgRenameInput">' + escapeHtml(T('Новый ник', 'New username')) + '</label>' +
        '<input id="vgRenameInput" class="vg-rename-input" type="text" maxlength="24" autocomplete="off" spellcheck="false" value="">' +
        '<p class="vg-rename-hint" id="vgRenameHint">' + escapeHtml(nameHint()) + '</p>' +
        '<p class="vg-rename-error" id="vgRenameError" role="alert"></p>' +
        '<div class="vg-rename-actions">' +
          '<button type="button" class="btn btn-ghost" id="vgRenameCancel">' + escapeHtml(T('Отмена', 'Cancel')) + '</button>' +
          '<button type="button" class="btn btn-primary" id="vgRenameOk">' + escapeHtml(okLabel()) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onRenameKey);
    var input = $('#vgRenameInput'), errorBox = $('#vgRenameError');
    var ok = $('#vgRenameOk');
    var errorCode = null;
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
    function showError(text, code) {
      errorCode = code || null;
      errorBox.textContent = text;
    }
    /* Перерисовка подписей окна: вызывается и при открытии, и при смене языка. */
    function paintTexts() {
      var set = function (id, text) { var node = $('#' + id); if (node) node.textContent = text; };
      set('vgRenameTitle', T('Смена ника', 'Change username'));
      set('vgRenameDesc', T('Услуга стоит ' + price + ' V. Монеты спишутся один раз при подтверждении, ник изменится сразу и сохранится на аккаунте.',
        'The service costs ' + price + ' V. Coins are charged once on confirmation, the username changes immediately and is stored on your account.'));
      set('vgRenameLabel', T('Новый ник', 'New username'));
      set('vgRenameHint', nameHint());
      set('vgRenameCancel', T('Отмена', 'Cancel'));
      set('vgRenameOk', okLabel());
      /* Текст ошибки тоже переводится: серверную ошибку узнаём по коду,
         локальную — перепроверяем по текущему значению поля. */
      var box = $('#vgRenameError'), field = $('#vgRenameInput');
      if (!box) return;
      if (errorCode) box.textContent = codeMessage({ code: errorCode });
      else if (field && field.value.trim()) box.textContent = nameError(field.value);
    }
    renamePaint = paintTexts;
    paintTexts();
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeRename();
    });
    $('#vgRenameCancel').addEventListener('click', closeRename);
    input.addEventListener('input', function () { showError(''); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); ok.click(); }
    });
    ok.addEventListener('click', function () {
      var value = input.value.trim();
      var problem = nameError(value);
      if (problem) { showError(problem); return; }
      /* Двойной клик не должен списать монеты дважды: кнопка блокируется сразу,
         а сервер всё равно проверяет баланс и текущий ник в одной транзакции. */
      if (ok.disabled) return;
      ok.disabled = true;
      changing = true;
      ok.textContent = okLabel();
      VG.rename(value).then(function (data) {
        closeRename();
        VG.toast(T('Ник изменён: ' + data.name, 'Username changed: ' + data.name));
        load();
      }).catch(function (error) {
        ok.disabled = false;
        changing = false;
        ok.textContent = okLabel();
        errorCode = (error && error.code) || null;
        showError(codeMessage(error), errorCode);
      });
    });
  }

  function equip(id) {
    var button = $('[data-item="' + id + '"] [data-buy]');
    if (button) { button.disabled = true; button.textContent = T('Надеваем…', 'Equipping…'); }
    VG.equip(id).then(function () {
      var item = findItem(id);
      (catalog.items || []).forEach(function (other) {
        if (other.kind === (item && item.kind)) other.equipped = other.id === id;
      });
      (catalog.items || []).forEach(paintItem);
      VG.toast(T('Оформление обновлено.', 'Appearance updated.'));
    }).catch(function (error) {
      VG.toast(error.message, 'bad');
      if (button) { button.disabled = false; button.textContent = T('Надеть', 'Equip'); }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();
    document.addEventListener('click', function (event) {
      var renameBtn = event.target.closest('[data-rename]');
      if (renameBtn) {
        event.preventDefault();
        openRename(findItem(renameBtn.getAttribute('data-rename')) || { price: 1000 });
        return;
      }
      var buyBtn = event.target.closest('[data-buy]');
      if (buyBtn) {
        event.preventDefault();
        var id = buyBtn.getAttribute('data-buy');
        if (buyBtn.getAttribute('data-equip') || (findItem(id) || {}).owned) equip(id);
        else buy(id);
        return;
      }
      var jump = event.target.closest('[data-jump]');
      if (jump) {
        var target = $('#' + jump.getAttribute('data-jump'));
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $$('#shopTabs .chip').forEach(function (chip) { chip.classList.toggle('on', chip === jump); });
      }
    });
    VG.onChange(function () { loadOwned(); });
    /* Смена языка обновляет фичу сразу: кнопки карточек, подписи окна смены
       ника и подсказку. Перезагружать магазин для этого не нужно. */
    if (VG.onLangChange) {
      VG.onLangChange(function () {
        if (catalog && catalog.items) catalog.items.forEach(paintItem);
        if (renamePaint && $('#vgRenameOverlay')) renamePaint();
      });
    }
  });
})();
