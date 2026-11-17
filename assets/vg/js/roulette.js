/* Отдельная страница рулетки. Логика результатов — только на сервере
   (/api/casino/wheel); здесь анимация, история и бесплатный спин. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var rules = (window.VG_DATA && window.VG_DATA.casino) || null;
  var stake = 20;
  var rotation = 0;
  var busy = false;
  var canvas, ctx;
  /* Суточные лимиты: 1 бесплатное вращение + 5 платных. Состояние приходит с
     сервера и дублируется в localStorage, чтобы кнопка оставалась заблокированной
     и после перезагрузки страницы. */
  var limits = null;
  var countdownTimer = null;
  var LIMIT_CACHE = 'vg.wheelLimits';
  var sfx = VG.sfx;

  function colors() { return ['#ff2d95', '#c6ff3d', '#8b5cf6', '#2ee6c8', '#3b82f6', '#e8b64c', '#5f6980']; }

  function draw(current) {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = canvas.clientWidth || 360;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Секторы пропорциональны вероятностям (x0 — 48 %, x10 — 0.5 %);
    // отрисовка живёт в wheel-math.js, чтобы обе страницы рисовали одинаково.
    VGWheel.draw(ctx, {
      size: size, rotation: current,
      segments: rules.wheel.segments, weights: rules.wheel.weights,
      colors: colors(), center: 'VERTU'
    });
  }

  function cacheLimits(data) {
    try { localStorage.setItem(LIMIT_CACHE, JSON.stringify(data)); } catch (e) {}
  }
  function cachedLimits() {
    try {
      var raw = localStorage.getItem(LIMIT_CACHE);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && data.resetAt > Date.now() / 1000 ? data : null;
    } catch (e) { return null; }
  }
  function clearLimitCache() {
    try { localStorage.removeItem(LIMIT_CACHE); } catch (e) {}
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function formatLeft(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    return two(h) + ':' + two(m) + ':' + two(sec);
  }

  /* Кнопка, баннер и чип лимитов: блокировка до полуночи UTC с обратным отсчётом. */
  function renderLimits(data) {
    var button = $('#spinWheel');
    var banner = $('#wheelResult');
    var chip = $('#wheelLimits');
    var freeBox = $('#useFree');
    if (!data) return;
    limits = data;
    var left = Math.max(0, (data.resetAt - (data.serverNow || Date.now() / 1000)) * 1000);
    var blocked = data.freeLeft <= 0 && data.paidLeft <= 0;
    if (!blocked) clearLimitCache(); else cacheLimits(data);
    if (chip) {
      chip.classList.toggle('blocked', blocked);
      chip.textContent = T('Бесплатно: ' + data.freeLeft + '/' + data.freeLimit,
        'Free: ' + data.freeLeft + '/' + data.freeLimit) +
        T(' · Платных: ' + data.paidLeft + '/' + data.paidLimit,
          ' · Paid: ' + data.paidLeft + '/' + data.paidLimit);
    }
    if (freeBox) {
      freeBox.disabled = data.freeLeft <= 0;
      if (data.freeLeft <= 0) freeBox.checked = false; else freeBox.checked = true;
    }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (!button) return;
    if (!blocked) {
      button.disabled = busy;
      button.removeAttribute('data-blocked');
      button.innerHTML = VG.icon('wheel', 16) + ' ' + T('Крутить', 'Spin');
      if (banner && !busy) {
        banner.className = 'result-banner';
        banner.textContent = data.freeLeft > 0
          ? T('Доступен бесплатный спин. Ставка ' + stake + ' V.', 'A free spin is available. Stake ' + stake + ' V.')
          : T('Осталось платных вращений: ' + data.paidLeft + '. Ставка ' + stake + ' V.',
              'Paid spins left: ' + data.paidLeft + '. Stake ' + stake + ' V.');
      }
      return;
    }
    // Лимит исчерпан: блокируем кнопку и показываем обратный отсчёт до сброса.
    button.disabled = true;
    button.setAttribute('data-blocked', '1');
    var tick = function () {
      var now = Date.now();
      var remaining = Math.max(0, (data.resetAt * 1000) - now);
      button.innerHTML = VG.icon('clock', 16) + ' ' +
        T('Следующее вращение через ' + formatLeft(remaining), 'Next spin in ' + formatLeft(remaining));
      if (banner && !busy) {
        banner.className = 'result-banner lose';
        banner.textContent = T(
          'Лимит на сегодня исчерпан (1 бесплатное + 5 платных). Новые вращения — через ' +
          formatLeft(remaining) + ' (00:00 UTC).',
          'Daily limit reached (1 free + 5 paid). New spins in ' + formatLeft(remaining) + ' (00:00 UTC).');
      }
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        clearLimitCache();
        loadFreeState();
      }
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function loadFreeState() {
    if (!VG.user()) {
      var note = $('#useFree');
      if (note) { note.checked = false; note.disabled = true; }
      return;
    }
    VG.api('/api/casino/rules').then(function (data) {
      var box = $('#useFree');
      var label = box && box.parentElement.querySelector('span');
      if (label) label.textContent = (data.freeSpin)
        ? T('Использовать бесплатный спин (доступен сегодня)', 'Use the free spin (available today)')
        : T('Бесплатный спин уже использован — спинов за V', 'Free spin used — spins cost V');
      if (data.wheelLimits) renderLimits(data.wheelLimits);
      else if (box) box.disabled = !data.freeSpin;
    }).catch(function () {});
  }

  function spin() {
    if (busy) return;
    if (!VG.user()) {
      VG.toast(T('Войдите, чтобы крутить колесо.', 'Sign in to spin.'), 'bad');
      setTimeout(function () { location.href = 'login.html?next=roulette'; }, 600);
      return;
    }
    var free = $('#useFree') && $('#useFree').checked && !$('#useFree').disabled;
    if (limits && limits.freeLeft <= 0 && limits.paidLeft <= 0) {
      VG.toast(T('Лимит вращений на сегодня исчерпан. Подождите до 00:00 UTC.',
        'Daily spin limit reached. Please wait until 00:00 UTC.'), 'bad');
      return;
    }
    if (!free && VG.coins() < stake) {
      VG.toast(T('Недостаточно V-монет для этой ставки.', 'Not enough V-coins for this stake.'), 'bad');
      return;
    }
    busy = true;
    if (sfx) { sfx.unlock(); sfx.press(); }
    var button = $('#spinWheel');
    button.disabled = true;
    var banner = $('#wheelResult');
    banner.className = 'result-banner';
    // Явно показываем, что ставка уже списана, — а выплата будет в конце.
    banner.textContent = free
      ? T('Бесплатный спин · колесо вращается…', 'Free spin · spinning…')
      : T('Ставка ' + fmt(stake) + ' V списана · колесо вращается…',
          'Stake ' + fmt(stake) + ' V charged · spinning…');

    // Ставка списывается в момент старта: показываем это сразу, не дожидаясь
    // конца анимации. Итог (зачисление payout) придёт от сервера ниже.
    if (!free) VG.updateCoins(Math.max(0, VG.coins() - stake));

    VG.api('/api/casino/wheel', { body: { stake: stake, free: free } }).then(function (data) {
      var weights = rules.wheel.weights || [];
      // Геометрия — из единственной реализации (wheel-math.js): колесо обязано
      // встать именно на сектор data.segment, который оплатил сервер. Ширина
      // сектора равна его вероятности, поэтому «дорога» до x10 короче, чем до x0.
      var target = VGWheel.target(rotation, data.segment, weights, 6);
      var from = rotation;
      var start = performance.now();
      var lastIndex = VGWheel.segmentAt(from, weights);
      (function animate(now) {
        var elapsed = Math.min((now - start) / 3400, 1);
        var eased = 1 - Math.pow(1 - elapsed, 3.2);
        var current = from + (target - from) * eased;
        draw(current);
        // Тик при переходе границы сектора — звук замедляется вместе с колесом.
        var tickIndex = VGWheel.segmentAt(current, weights);
        if (sfx && tickIndex !== lastIndex) {
          lastIndex = tickIndex;
          sfx.tick(elapsed, 'wheel');
        }
        if (elapsed < 1) return requestAnimationFrame(animate);
        rotation = VGWheel.normalize(target);
        busy = false;
        VG.updateCoins(data.balance);
        if (sfx) { if (data.payout > 0) sfx.win(data.payout); else sfx.lose(); }
        if (data.limits) renderLimits(data.limits); else button.disabled = false;
        // Общая сумма выплаты и чистое изменение баланса — разные числа:
        // x1 -> выплата равна ставке (баланс не изменился), x2 -> выплата
        // двойная (чистый плюс равен ставке), x0 -> выплаты нет.
        var net = (data.net != null) ? Number(data.net) : (Number(data.payout) - (data.free ? 0 : stake));
        // Показываем саму арифметику: ставка × множитель = выплата. Так игрок
        // видит, что «×2 при ставке 20» — это ровно 40, а не 5 и не 10.
        var rule = fmt(data.stake) + ' × ' + data.multiplier + ' = ' + fmt(data.payout) + ' V';
        if (data.payout > 0) {
          banner.className = 'result-banner ' + (net > 0 ? 'win' : 'even');
          banner.textContent = (data.free ? T('Бесплатный спин! ', 'Free spin! ') : '') +
            'x' + data.multiplier + ' · ' + rule +
            ' · ' + T('итог ' + (net >= 0 ? '+' : '') + fmt(net) + ' V',
              'net ' + (net >= 0 ? '+' : '') + fmt(net) + ' V');
          // Тост — только про чистый плюс: «+5 V» при потере 15 монет путал.
          if (net > 0) VG.toast('+' + fmt(net) + ' V');
        } else {
          banner.className = 'result-banner lose';
          banner.textContent = data.free
            ? T('Сектор x0 · бесплатный спин, выплаты нет',
                'x0 · free spin, no payout')
            : T('Сектор x0 · ставка ' + fmt(stake) + ' V списана, выплаты нет',
                'x0 · stake ' + fmt(stake) + ' V charged, no payout');
        }
        loadFreeState();
        loadHistory();
        loadStats();
      })(start);
    }).catch(function (error) {
      busy = false;
      // Ставка не принята сервером — возвращаем показанный баланс к реальному.
      VG.refreshCoins();
      if (error.limits) {
        // Сервер вернул состояние лимитов вместе с ошибкой — включаем отсчёт.
        renderLimits(error.limits);
        VG.toast(error.message, 'bad');
        return;
      }
      banner.className = 'result-banner lose';
      banner.textContent = error.message;
      button.disabled = false;
    });
  }

  function loadHistory() {
    var box = $('#wheelHistory');
    if (!box) return;
    if (!VG.user()) {
      box.innerHTML = '<div class="empty">' + T('Войдите, чтобы увидеть историю.', 'Sign in to see your history.') + '</div>';
      return;
    }
    VG.api('/api/casino/history?limit=8&game=wheel').then(function (data) {
      if (!data.items.length) {
        box.innerHTML = '<div class="empty">' + T('Пока нет вращений.', 'No spins yet.') + '</div>';
        return;
      }
      box.innerHTML = data.items.map(function (row) {
        // Списывается ставка, зачисляется выплата; справа — итог за спин.
        var rowNet = Number(row.payout) - Number(row.stake);
        return '<div class="list-row"><span class="ico">' + VG.icon(row.payout > 0 ? 'trophy' : 'dice', 16) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(VG.casinoOutcome(row.outcome)) + '</b><small>' + VG.timeAgo(row.created) +
          ' · ' + T('ставка ', 'stake ') + '−' + fmt(row.stake) + ' V' +
          ' · ' + T('выплата ', 'payout ') + '+' + fmt(row.payout) + ' V</small></span>' +
          '<span style="font-weight:800;color:' + (rowNet > 0 ? '#dcff8a' : rowNet < 0 ? '#ff8fa3' : 'var(--muted)') + '">' +
          (rowNet > 0 ? '+' : '') + fmt(rowNet) + ' V</span></div>';
      }).join('');
    }).catch(function () {});
  }

  /* Статистика колеса: сервер отдаёт её вместе с историей вращений. */
  function loadStats() {
    if (!VG.user()) return;
    VG.api('/api/casino/history?limit=1&game=wheel').then(function (data) {
      var stats = data.stats || {};
      var spins = $('#wheelSpins');
      var profit = $('#wheelNet');
      if (spins) spins.textContent = fmt(stats.spins || 0);
      if (profit) {
        var net = Number(stats.net || 0);
        profit.textContent = (net > 0 ? '+' : '') + fmt(net) + ' V';
        profit.style.color = net > 0 ? '#dcff8a' : net < 0 ? '#ff8fa3' : 'var(--muted)';
      }
    }).catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!rules) return;
    canvas = $('#wheelCanvas');
    ctx = canvas && canvas.getContext('2d');
    draw(rotation);
    window.addEventListener('resize', VG.debounce(function () { draw(rotation); }, 150));

    var row = $('#wheelStakes');
    if (row) {
      row.addEventListener('click', function (event) {
        var button = event.target.closest('[data-stake]');
        if (!button) return;
        stake = Number(button.getAttribute('data-stake'));
        $$('[data-stake]', row).forEach(function (node) { node.classList.toggle('on', node === button); });
        var banner = $('#wheelResult');
        if (banner && !busy) {
          banner.className = 'result-banner';
          banner.textContent = T('Ставка ' + stake + ' V · возможный выигрыш до ' + stake * 5 + ' V',
            'Stake ' + stake + ' V · max win ' + stake * 5 + ' V');
        }
      });
    }
    var button = $('#spinWheel');
    if (button) button.addEventListener('click', spin);
    if (VG.user()) {
      var cached = cachedLimits();
      if (cached) renderLimits(cached);
    }
    loadFreeState();
    loadHistory();
    VG.onChange(function () {
      loadFreeState();
      loadHistory();
      loadStats();
    });
  });
})();
