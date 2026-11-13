/* Магазин: покупка и экипировка через серверные API.
   Баланс и владение приходят с сервера, локальных "монет" больше нет. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var catalog = null;

  function kindName(kind) {
    return { avatar: T('Аватар', 'Avatar'), color: T('Цвет', 'Color'), title: T('Титул', 'Title'), boost: T('Бонус', 'Boost') }[kind] || kind;
  }

  function paintItem(item) {
    var card = $('[data-item="' + item.id + '"]');
    if (!card) return;
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
      box.innerHTML = '<div class="empty">Войдите, чтобы увидеть покупки. <a href="login.html" style="color:var(--lime)">Войти</a></div>';
      return;
    }
    VG.api('/api/me').then(function (data) {
      var rows = [];
      (data.achievements || []).forEach(function (ach) {
        rows.push('<div class="list-row"><span class="ico">' + VG.icon(ach.icon || 'trophy', 17) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? ach.name_en : ach.name_ru) + '</b>' +
          '<small>' + T('Достижение', 'Achievement') + ' · ' + VG.date(ach.unlocked) + '</small></span>' +
          '<span style="color:#dcff8a;font-weight:800;font-size:12px">+' + fmt(ach.coins) + ' V</span></div>');
      });
      (data.purchases || []).forEach(function (item) {
        rows.push('<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'bag', 17) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? item.name_en : item.name_ru) + '</b>' +
          '<small>' + escapeHtml(kindName(item.kind)) + ' · ' + VG.date(item.created) + '</small></span>' +
          '<span class="muted" style="font-size:12px">' + fmt(item.price) + ' V</span></div>');
      });
      if (!rows.length) rows.push('<div class="empty">Покупок пока нет. Аватары и цвета доступны в разделах выше.</div>');
      var stats = data.stats || {};
      rows.unshift('<div class="stat-grid" style="margin-bottom:12px">' +
        '<div class="stat-card coins"><span>Баланс</span><b>' + fmt(data.user.coins) + '</b></div>' +
        '<div class="stat-card"><span>Игр сыграно</span><b>' + fmt(stats.games || 0) + '</b></div>' +
        '<div class="stat-card"><span>Достижений</span><b>' + fmt((data.achievements || []).length) + '</b></div></div>');
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
  });
})();
