/* Главная: живая шапка со статистикой, топ игроков, последние достижения,
   анимация барабанов в hero-блоке и фильтры каталога. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;

  /* --------------------------------------------------------------- hero reels */
  function heroReels() {
    var box = $('#heroReels');
    if (!box) return;
    var icons = ['coin', 'star', 'crown', 'gem', 'dice', 'wheel', 'spark'];
    var cells = $$('.reel-cell', box);
    if (!cells.length) return;
    setInterval(function () {
      cells.forEach(function (cell, index) {
        if (Math.random() > 0.55) return;
        var name = icons[Math.floor(Math.random() * icons.length)];
        cell.innerHTML = VG.icon(name, 26);
        cell.style.color = ['#2ee6c8', '#e8b64c', '#c6ff3d', '#8b5cf6', '#ff2d95'][Math.floor(Math.random() * 5)];
        cell.classList.remove('spin');
        void cell.offsetWidth;
        cell.classList.add('spin');
        if (index === 2) {
          var strip = document.querySelector('.win-strip');
          if (strip) strip.textContent = T('Выигрыш +' + (Math.floor(Math.random() * 9) + 1) * 50 + ' V',
            'Win +' + (Math.floor(Math.random() * 9) + 1) * 50 + ' V');
        }
      });
    }, 2400);
  }

  /* -------------------------------------------------------------- leaderboard */
  function renderLeaderboard(data) {
    var box = $('#leaderboard');
    if (!box) return;
    $$('[data-stat="games"]').forEach(function (node) { node.textContent = data.totals.games || 11; });
    $$('[data-stat="players"]').forEach(function (node) { node.textContent = fmt(data.totals.players); });
    $$('[data-stat="coins"]').forEach(function (node) { node.textContent = fmt(data.totals.coins); });
    $$('[data-stat="plays"]').forEach(function (node) { node.textContent = fmt(data.totals.plays); });
    if (!data.users.length) {
      box.innerHTML = '<div class="empty">Пока нет игроков — станьте первым.</div>';
      return;
    }
    box.innerHTML = data.users.slice(0, 6).map(function (user, index) {
      return '<a class="list-row" href="profile.html?u=' + encodeURIComponent(user.username) + '">' +
        '<span class="list-row-rank" style="width:22px;text-align:center;font-weight:800;color:' +
        (index < 3 ? '#c6ff3d' : 'var(--muted)') + '">' + (index + 1) + '</span>' +
        VG.avatarHtml(user, 30) +
        '<span class="meta"><b>' + escapeHtml(user.username) + '</b><small>' + escapeHtml(VG.titleLabel(user)) + '</small></span>' +
        '<span style="font-weight:800;color:#dcff8a">' + fmt(user.balance) + ' V</span></a>';
    }).join('');
  }

  function renderAchievements(list) {
    var box = $('#achievements');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="empty">Достижения появятся, когда игроки начнут играть.</div>';
      return;
    }
    box.innerHTML = list.slice(0, 6).map(function (item) {
      return '<div class="list-row"><span class="ico">' + VG.icon(item.icon || 'trophy', 17) + '</span>' +
        '<span class="meta"><b>' + escapeHtml(VG.lang() === 'en' ? item.name_en : item.name_ru) + '</b>' +
        '<small>' + escapeHtml(item.username) + ' · ' + VG.timeAgo(item.unlocked) + '</small></span>' +
        '<span style="font-weight:800;color:#dcff8a;font-size:12px">+' + fmt(item.coins) + ' V</span></div>';
    }).join('');
  }

  function loadBoard() {
    VG.api('/api/leaderboard').then(function (data) {
      renderLeaderboard(data);
      renderAchievements(data.achievements || []);
    }).catch(function () {
      var box = $('#leaderboard');
      if (box) box.innerHTML = '<div class="empty">Не удалось загрузить рейтинг.</div>';
    });
  }

  /* ------------------------------------------------------------- catalog ux */
  function gameCards() { return VG.$$('#gameGrid .game-card'); }

  function setupFilters() {
    var search = $('#gameSearch');
    var chips = $('#catChips');
    var grid = $('#gameGrid');
    if (!grid) return;
    var cats = [];
    gameCards().forEach(function (card) {
      (card.getAttribute('data-cats') || '').split('|').forEach(function (cat) {
        if (cat && cats.indexOf(cat) === -1) cats.push(cat);
      });
    });
    if (chips) {
      chips.innerHTML = '<button class="chip on" data-cat="">Все</button>' + cats.map(function (cat) {
        return '<button class="chip" data-cat="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</button>';
      }).join('');
    }
    var activeCat = '';
    function apply() {
      var query = (search ? search.value : '').trim().toLowerCase();
      var visible = 0;
      gameCards().forEach(function (card) {
        var text = card.textContent.toLowerCase();
        var cats = card.getAttribute('data-cats') || '';
        var ok = (!query || text.indexOf(query) !== -1) && (!activeCat || cats.indexOf(activeCat) !== -1);
        card.classList.toggle('hidden', !ok);
        if (ok) visible++;
      });
      var empty = $('#gameEmpty');
      if (empty) empty.classList.toggle('hidden', visible > 0);
    }
    if (search) search.addEventListener('input', VG.debounce(apply, 120));
    if (chips) chips.addEventListener('click', function (event) {
      var button = event.target.closest('[data-cat]');
      if (!button) return;
      activeCat = button.getAttribute('data-cat');
      VG.$$('[data-cat]', chips).forEach(function (node) { node.classList.toggle('on', node === button); });
      apply();
    });
  }

  function wireGameCards() {
    VG.$$('[data-game]').forEach(function (card) {
      var open = function () {
        var id = card.getAttribute('data-game');
        var game = (window.VG_DATA.games || []).filter(function (g) { return g.id === id; })[0];
        if (!game) return;
        if (!VG.user()) {
          VG.toast(T('Войдите, чтобы играть и получать V-монеты.', 'Sign in to play and earn V-coins.'), 'bad');
          setTimeout(function () { location.href = 'login.html?next=' + encodeURIComponent(card.getAttribute('data-game')); }, 600);
          return;
        }
        VG.openGame(game);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    heroReels();
    loadBoard();
    setupFilters();
    wireGameCards();
    if (VG.user()) VG.refreshCoins();
  });
})();
