/* Казино: слоты и колесо. Результаты и выплаты приходят только с сервера,
   клиент лишь показывает анимацию по уже полученному результату. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var rules = (window.VG_DATA && window.VG_DATA.casino) || null;
  var stakes = (window.VG_DATA && window.VG_DATA.stakes) || [5, 10, 20, 25, 50, 100];
  var minStake = 5, maxStake = 100;
  var slotStake = 25, wheelStake = 25;
  var busy = false;
  var symbols = {};
  var wheelRotation = 0;
  var canvas, ctx;
  /* Звук: тики барабанов/колеса замедляются к остановке, выигрыш — трель. */
  var sfx = VG.sfx;

  /* ------------------------------------------------------------------ helpers */
  function symbolById(id) {
    var list = (rules && rules.slots && rules.slots.symbols) || [];
    return list.filter(function (s) { return s.id === id; })[0] || list[0];
  }

  function stakeButtons(rowId, value, onPick) {
    var row = $('#' + rowId);
    if (!row) return;
    row.innerHTML = stakes.map(function (stake) {
      return '<button class="stake' + (stake === value ? ' on' : '') + '" data-stake="' + stake + '">' + stake + ' V</button>';
    }).join('');
    row.addEventListener('click', function (event) {
      var button = event.target.closest('[data-stake]');
      if (!button) return;
      var stake = Number(button.getAttribute('data-stake'));
      $$('[data-stake]', row).forEach(function (node) { node.classList.toggle('on', node === button); });
      onPick(stake);
    });
  }

  function updateStats(stats) {
    if (stats) {
      setStat('bets', fmt(stats.bets), stats);
      setStat('staked', fmt(stats.staked) + ' V', stats);
      setStat('best', fmt(stats.best) + ' V', stats);
    }
    setStat('balance', fmt(VG.coins()) + ' V');
  }
  function setStat(name, value) {
    $$('[data-stat="' + name + '"]').forEach(function (node) { node.textContent = value; });
  }

  /* ------------------------------------------------------------------- slots */
  function renderSymbols(ids) {
    ids.forEach(function (id, index) {
      var symbol = symbolById(id);
      var cell = $('.slot-cell[data-cell="' + index + '"]');
      if (!cell) return;
      var sym = $('.sym', cell);
      sym.innerHTML = VG.icon(symbol.icon, 56);
      sym.style.color = symbol.color;
      sym.style.background = 'transparent';
    });
  }

  function spinSlots() {
    if (busy) return;
    if (!VG.user()) {
      VG.toast(T('Войдите, чтобы играть в казино.', 'Sign in to play the casino.'), 'bad');
      return;
    }
    if (VG.coins() < slotStake) {
      VG.toast(T('Недостаточно V-монет для ставки.', 'Not enough V-coins for this stake.'), 'bad');
      return;
    }
    busy = true;
    if (sfx) { sfx.unlock(); sfx.press(); }
    var button = $('#spinSlots');
    button.disabled = true;
    var banner = $('#slotResult');
    banner.className = 'result-banner';
    banner.textContent = T('Барабаны вращаются…', 'Reels are spinning…');
    var cells = $$('.slot-cell');
    cells.forEach(function (cell) { cell.classList.add('spinning'); cell.classList.remove('hot'); });
    var rollStep = 0;
    if (sfx) sfx.unlock();
    var rollTimer = setInterval(function () {
      rollStep++;
      if (sfx) sfx.reelTick(rollStep);
      cells.forEach(function (cell) {
        var sym = $('.sym', cell);
        var list = (rules.slots.symbols || []);
        var random = list[Math.floor(Math.random() * list.length)];
        sym.innerHTML = VG.icon(random.icon, 56);
        sym.style.color = random.color;
      });
    }, 90);

    VG.api('/api/casino/slots', { body: { stake: slotStake } }).then(function (data) {
      // Останавливаем барабаны по результату сервера — по одному, для эффекта.
      setTimeout(function () {
        clearInterval(rollTimer);
        var ids = data.reels || [];
        var reveal = 0;
        (function next() {
          var cell = cells[reveal];
          if (cell) cell.classList.remove('spinning');
          if (sfx) sfx.reelStop(reveal);
          renderSymbols(ids.slice(0, reveal + 1).concat(new Array(2 - reveal).fill(ids[0])));
          reveal++;
          if (reveal < 3) return setTimeout(next, 220);
          renderSymbols(ids);
          finishSlots(data);
        })();
      }, 520);
    }).catch(function (error) {
      clearInterval(rollTimer);
      cells.forEach(function (cell) { cell.classList.remove('spinning'); });
      banner.className = 'result-banner lose';
      banner.textContent = error.message;
      button.disabled = false;
      busy = false;
    });
  }

  function finishSlots(data) {
    var button = $('#spinSlots');
    button.disabled = false;
    busy = false;
    VG.updateCoins(data.balance);
    var ids = data.reels || [];
    $$('.slot-cell').forEach(function (cell, index) {
      var hot = ids[index] && (ids.filter(function (x) { return x === ids[index]; }).length >= 2);
      cell.classList.toggle('hot', !!hot);
    });
    var banner = $('#slotResult');
    if (sfx) { if (data.payout > 0) sfx.win(data.payout); else sfx.lose(); }
    if (data.payout > 0) {
      banner.className = 'result-banner win';
      banner.textContent = T('Выигрыш ' + fmt(data.payout) + ' V (' + T('ставка ', 'stake ') + fmt(data.stake) + ' V)',
        'You won ' + fmt(data.payout) + ' V (stake ' + fmt(data.stake) + ' V)');
      VG.toast('+' + fmt(data.payout) + ' V');
    } else {
      banner.className = 'result-banner lose';
      banner.textContent = T('Без выигрыша. Попробуйте ещё раз.', 'No win this time.');
    }
    (data.achievements || []).forEach(function (entry) {
      var ach = entry.achievement || entry;
      VG.toast(T('Достижение: ' + ach.name_ru, 'Achievement: ' + ach.name_en));
    });
    loadHistory(currentGame);
    loadStats();
  }

  /* ------------------------------------------------------------------- wheel */
  function segmentColors() {
    return ['#ff2d95', '#c6ff3d', '#8b5cf6', '#2ee6c8', '#3b82f6', '#e8b64c', '#5f6980'];
  }

  function drawWheel(rotation) {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = canvas.clientWidth || 360;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cx = size / 2, cy = size / 2, radius = size / 2 - 8;
    ctx.clearRect(0, 0, size, size);
    var segments = (rules.wheel.segments || []);
    var colors = segmentColors();
    var arc = (Math.PI * 2) / segments.length;
    segments.forEach(function (multiplier, index) {
      var start = rotation + index * arc;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + arc);
      ctx.closePath();
      var gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      gradient.addColorStop(0, colors[index % colors.length] + 'cc');
      gradient.addColorStop(1, colors[index % colors.length]);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,8,12,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      var mid = start + arc / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * radius * 0.66, cy + Math.sin(mid) * radius * 0.66);
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#08110a';
      ctx.font = '800 ' + Math.max(13, size * 0.052) + 'px Montserrat, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('x' + (multiplier % 1 === 0 ? multiplier : multiplier.toFixed(2).replace(/0$/, '')), 0, 0);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0e15';
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,255,61,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#c6ff3d';
    ctx.font = '900 ' + Math.max(11, size * 0.036) + 'px Montserrat, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VERTU', cx, cy);
  }

  function spinWheel() {
    if (busy) return;
    if (!VG.user()) {
      VG.toast(T('Войдите, чтобы крутить колесо.', 'Sign in to spin the wheel.'), 'bad');
      return;
    }
    var free = $('#freeSpinNote') && $('#freeSpinNote').textContent.indexOf('доступен') !== -1;
    if (!free && VG.coins() < wheelStake) {
      VG.toast(T('Недостаточно V-монет для ставки.', 'Not enough V-coins for this stake.'), 'bad');
      return;
    }
    busy = true;
    if (sfx) { sfx.unlock(); sfx.press(); }
    var button = $('#spinWheel');
    button.disabled = true;
    var banner = $('#wheelResult');
    banner.className = 'result-banner';
    banner.textContent = T('Колесо вращается…', 'The wheel is spinning…');

    VG.api('/api/casino/wheel', { body: { stake: wheelStake, free: free } }).then(function (data) {
      var segments = (rules.wheel.segments || []);
      var arc = (Math.PI * 2) / segments.length;
      var target = wheelRotation + Math.PI * 2 * 6 - (data.segment * arc + arc / 2) + Math.PI * 2;
      var start = performance.now();
      var duration = 3600;
      var from = wheelRotation;
      var lastTick = 0;
      var tickCount = 0;
      (function animate(now) {
        var elapsed = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - elapsed, 3.2);
        var current = from + (target - from) * eased;
        drawWheel(current);
        /* Тик на каждый сектор: поворот на сектор за N кадров — интервал растёт
         * квадратично, поэтому звук естественно замедляется к остановке. */
        var segmentSpan = (Math.PI * 2) / (segments.length || 1);
        if (sfx && Math.abs(current - lastTick) >= segmentSpan) {
          lastTick = current;
          sfx.tick(elapsed, 'wheel');
          tickCount++;
        }
        if (elapsed < 1) return requestAnimationFrame(animate);
        wheelRotation = target % (Math.PI * 2);
        finishWheel(data);
      })(start);
    }).catch(function (error) {
      banner.className = 'result-banner lose';
      banner.textContent = error.message;
      button.disabled = false;
      busy = false;
    });
  }

  function finishWheel(data) {
    var button = $('#spinWheel');
    button.disabled = false;
    busy = false;
    VG.updateCoins(data.balance);
    var banner = $('#wheelResult');
    var prefix = data.free ? T('Бесплатный спин: ', 'Free spin: ') : '';
    if (sfx) { if (data.payout > 0) sfx.win(data.payout); else sfx.lose(); }
    if (data.payout > 0) {
      banner.className = 'result-banner win';
      banner.textContent = prefix + T('сектор x' + data.multiplier + ' — выигрыш ' + fmt(data.payout) + ' V',
        'segment x' + data.multiplier + ' — you won ' + fmt(data.payout) + ' V');
      VG.toast('+' + fmt(data.payout) + ' V');
    } else {
      banner.className = 'result-banner lose';
      banner.textContent = prefix + T('сектор x0 — без выигрыша', 'segment x0 — no win');
    }
    (data.achievements || []).forEach(function (entry) {
      var ach = entry.achievement || entry;
      VG.toast(T('Достижение: ' + ach.name_ru, 'Achievement: ' + ach.name_en));
    });
    loadLimits();
    loadHistory(currentGame);
    loadStats();
  }

  /* ----------------------------------------------------------------- history */
  var currentGame = '';
  function loadHistory(game) {
    var box = $('#historyBody');
    if (!box) return;
    var panel = $('#panel-history');
    if (panel && panel.classList.contains('hidden')) return;   // грузим только когда вкладка видима
    if (!VG.user()) {
      box.innerHTML = '<div class="empty">' + T('Войдите, чтобы увидеть историю ставок.', 'Sign in to see your bet history.') + '</div>';
      return;
    }
    var query = '/api/casino/history?limit=30' + (game ? '&game=' + encodeURIComponent(game) : '');
    VG.api(query).then(function (data) {
      if (!data.items.length) {
        box.innerHTML = '<div class="empty">' + T('История пуста — сделайте первую ставку.', 'History is empty — place your first bet.') + '</div>';
        return;
      }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Игра</th><th>Ставка</th><th>Выигрыш</th>'
        + '<th>Результат</th><th>Время</th></tr></thead><tbody>' + data.items.map(function (row) {
          return '<tr><td>' + (row.game === 'slots' ? 'Слоты' : row.game === 'wheel' ? 'Колесо' : escapeHtml(row.game)) + '</td>' +
            '<td>' + fmt(row.stake) + ' V</td>' +
            '<td class="' + (row.payout > 0 ? 'pos' : 'muted') + '">' + (row.payout > 0 ? '+' : '') + fmt(row.payout) + ' V</td>' +
            '<td class="muted">' + escapeHtml(row.outcome) + '</td>' +
            '<td class="muted">' + VG.timeAgo(row.created) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (error) {
      box.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  }

  /* Потенциальный максимальный выигрыш: ставка × лучший коэффициент линии. */
  function updatePotentialWin() {
    var best = 70;
    if (rules && rules.slots && rules.slots.symbols && rules.slots.symbols.length) {
      best = rules.slots.symbols.reduce(function (top, symbol) {
        return Math.max(top, Number(symbol.m3) || 0);
      }, 0) || 70;
    }
    var max = $('#slotMax');
    if (max) max.textContent = fmt(slotStake * best) + ' V';
  }

  function loadStats() {
    if (!VG.user()) { updateStats(); return; }
    VG.api('/api/casino/history?limit=1').then(function (data) { updateStats(data.stats); }).catch(function () {});
  }

  function loadLimits() {
    VG.api('/api/casino/rules').then(function (data) {
      minStake = data.min_stake || 5;
      maxStake = data.max_stake || 100;
      var label = $('#limitText');
      if (label) {
        var parts = [];
        if (data.limits && data.limits.daily) parts.push('дневной лимит ' + fmt(data.limits.daily) + ' V');
        if (data.limits && data.limits.excludeUntil > Date.now() / 1000) {
          parts.push('пауза до ' + new Date(data.limits.excludeUntil * 1000).toLocaleString());
        }
        label.textContent = parts.length ? parts.join(' · ') : T('Не заданы', 'Not set');
      }
      var daily = $('#dailyLimit');
      if (daily && data.limits) daily.value = data.limits.daily || 0;
      var note = $('#freeSpinNote');
      if (note) note.textContent = data.freeSpin ? T('бесплатный спин доступен', 'free spin available') : '';
    }).catch(function () {});
  }

  /* --------------------------------------------------------------- bootstrap */
  function switchTab(name) {
    $$('.casino-tabs button').forEach(function (button) {
      var on = button.getAttribute('data-tab') === name;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
    });
    ['slots', 'wheel', 'history', 'rules'].forEach(function (panel) {
      var node = $('#panel-' + panel);
      if (node) node.classList.toggle('hidden', panel !== name);
    });
    if (name === 'history') loadHistory(currentGame);
  }

  document.addEventListener('DOMContentLoaded', function () {
    canvas = $('#wheelCanvas');
    if (canvas) ctx = canvas.getContext('2d');
    if (!rules) return;

    var tabs = $('#casinoTabs');
    if (tabs) tabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) switchTab(button.getAttribute('data-tab'));
    });

    stakeButtons('stakeRow', slotStake, function (stake) {
      slotStake = stake;
      updatePotentialWin();
    });
    stakeButtons('wheelStakes', wheelStake, function (stake) { wheelStake = stake; });

    var spinBtn = $('#spinSlots');
    if (spinBtn) spinBtn.addEventListener('click', spinSlots);
    var wheelBtn = $('#spinWheel');
    if (wheelBtn) wheelBtn.addEventListener('click', spinWheel);

    var filter = $('#historyFilter');
    if (filter) filter.addEventListener('click', function (event) {
      var button = event.target.closest('[data-game]');
      if (!button) return;
      currentGame = button.getAttribute('data-game');
      $$('[data-game]', filter).forEach(function (node) { node.classList.toggle('on', node === button); });
      loadHistory(currentGame);
    });

    $$('[data-limits]').forEach(function (button) {
      button.addEventListener('click', function () { $('#limitsModal').classList.add('open'); loadLimits(); });
    });
    $$('[data-close-limits]').forEach(function (button) {
      button.addEventListener('click', function () { $('#limitsModal').classList.remove('open'); });
    });
    var limitsModal = $('#limitsModal');
    if (limitsModal) limitsModal.addEventListener('click', function (event) {
      if (event.target === limitsModal) limitsModal.classList.remove('open');
    });
    var save = $('#saveLimits');
    if (save) save.addEventListener('click', function () {
      var message = $('#limitsMsg');
      if (!VG.user()) { message.textContent = T('Войдите в аккаунт.', 'Sign in first.'); return; }
      save.disabled = true;
      VG.api('/api/casino/limits', {
        body: {
          daily: Number($('#dailyLimit').value) || 0,
          excludeMinutes: Number($('#excludeSelect').value) || 0
        }
      }).then(function () {
        message.className = 'msg ok';
        message.textContent = T('Ограничения сохранены.', 'Limits saved.');
        $('#limitsModal').classList.remove('open');
        loadLimits();
      }).catch(function (error) {
        message.className = 'msg err';
        message.textContent = error.message;
      }).then(function () { save.disabled = false; });
    });

    // Колесо: первичная отрисовка + перерисовка при изменении размера
    function paint() { drawWheel(wheelRotation); }
    paint();
    window.addEventListener('resize', VG.debounce(paint, 150));
    if (window.ResizeObserver && canvas) new ResizeObserver(VG.debounce(paint, 120)).observe(canvas);

    VG.onChange(function (user) {
      updateStats();
      loadLimits();
      loadHistory(currentGame);
      loadStats();
    });
    loadStats();
    loadLimits();
    renderSymbols(['v', 'star', 'crown']);
    updatePotentialWin();
  });
})();
