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
    var cx = size / 2, cy = size / 2, radius = size / 2 - 8;
    ctx.clearRect(0, 0, size, size);
    var segments = rules.wheel.segments || [];
    var arc = (Math.PI * 2) / segments.length;
    segments.forEach(function (mult, index) {
      var start = current + index * arc;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + arc);
      ctx.closePath();
      var gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      gradient.addColorStop(0, colors()[index % 7] + 'cc');
      gradient.addColorStop(1, colors()[index % 7]);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(7,8,12,.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      var mid = start + arc / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * radius * 0.64, cy + Math.sin(mid) * radius * 0.64);
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#08110a';
      ctx.font = '800 ' + Math.max(13, size * 0.052) + 'px Montserrat, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('x' + (mult % 1 === 0 ? mult : mult.toFixed(2).replace(/0$/, '')), 0, 0);
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

  function loadFreeState() {
    if (!VG.user()) {
      var note = $('#useFree');
      if (note) { note.checked = false; note.disabled = true; }
      return;
    }
    VG.api('/api/casino/rules').then(function (data) {
      var box = $('#useFree');
      if (!box) return;
      box.disabled = !data.freeSpin;
      box.checked = !!data.freeSpin;
      var label = box.parentElement.querySelector('span');
      if (label) label.textContent = data.freeSpin
        ? T('Использовать бесплатный спин (доступен сегодня)', 'Use the free spin (available today)')
        : T('Бесплатный спин уже использован — спинов за V', 'Free spin used — spins cost V');
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
    if (!free && VG.coins() < stake) {
      VG.toast(T('Недостаточно V-монет для этой ставки.', 'Not enough V-coins for this stake.'), 'bad');
      return;
    }
    busy = true;
    var button = $('#spinWheel');
    button.disabled = true;
    var banner = $('#wheelResult');
    banner.className = 'result-banner';
    banner.textContent = T('Колесо вращается…', 'Spinning…');

    VG.api('/api/casino/wheel', { body: { stake: stake, free: free } }).then(function (data) {
      var segments = rules.wheel.segments || [];
      var arc = (Math.PI * 2) / segments.length;
      var target = rotation + Math.PI * 2 * 6 - (data.segment * arc + arc / 2) + Math.PI * 2;
      var from = rotation;
      var start = performance.now();
      (function animate(now) {
        var elapsed = Math.min((now - start) / 3400, 1);
        var eased = 1 - Math.pow(1 - elapsed, 3.2);
        draw(from + (target - from) * eased);
        if (elapsed < 1) return requestAnimationFrame(animate);
        rotation = target % (Math.PI * 2);
        button.disabled = false;
        busy = false;
        VG.updateCoins(data.balance);
        if (data.payout > 0) {
          banner.className = 'result-banner win';
          banner.textContent = (data.free ? T('Бесплатный спин! ', 'Free spin! ') : '') +
            T('x' + data.multiplier + ' · +' + fmt(data.payout) + ' V', 'x' + data.multiplier + ' · +' + fmt(data.payout) + ' V');
          VG.toast('+' + fmt(data.payout) + ' V');
        } else {
          banner.className = 'result-banner lose';
          banner.textContent = T('Сектор x0 — без выигрыша', 'x0 — no win');
        }
        loadFreeState();
        loadHistory();
        loadStats();
      })(start);
    }).catch(function (error) {
      banner.className = 'result-banner lose';
      banner.textContent = error.message;
      button.disabled = false;
      busy = false;
    });
  }

  function loadHistory() {
    var box = $('#wheelHistory');
    if (!box) return;
    if (!VG.user()) {
      box.innerHTML = '<div class="empty">Войдите, чтобы увидеть историю.</div>';
      return;
    }
    VG.api('/api/casino/history?limit=8&game=wheel').then(function (data) {
      if (!data.items.length) {
        box.innerHTML = '<div class="empty">Пока нет вращений.</div>';
        return;
      }
      box.innerHTML = data.items.map(function (row) {
        return '<div class="list-row"><span class="ico">' + VG.icon(row.payout > 0 ? 'trophy' : 'dice', 16) + '</span>' +
          '<span class="meta"><b>' + escapeHtml(row.outcome) + '</b><small>' + VG.timeAgo(row.created) +
          ' · ставка ' + fmt(row.stake) + ' V</small></span>' +
          '<span style="font-weight:800;color:' + (row.payout > 0 ? '#dcff8a' : 'var(--muted)') + '">' +
          (row.payout > 0 ? '+' : '') + fmt(row.payout) + ' V</span></div>';
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
    loadFreeState();
    loadHistory();
    VG.onChange(function () {
      loadFreeState();
      loadHistory();
      loadStats();
    });
  });
})();
