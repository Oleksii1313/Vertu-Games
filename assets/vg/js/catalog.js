/* Каталог: фильтры по жанру, сортировка, карточка игры с правилами награды
   и запуск через общий оверлей (награды и статистика — на сервере). */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, fmt = VG.fmt, escapeHtml = VG.escapeHtml;
  var games = (window.VG_DATA && window.VG_DATA.games) || [];
  var grid = $('#gameGrid');
  var activeCat = '';
  var sort = 'default';

  function cards() { return $$('.game-card', grid); }

  /* Язык карточек: английский текст берём из *_en, иначе русский оригинал. */
  function gameName(game) {
    return VG.lang() === 'en' ? (game.name_en || game.name) : game.name;
  }
  function gameText(game, enKey, ruKey) {
    return VG.lang() === 'en' ? (game[enKey] || game[ruKey] || '') : (game[ruKey] || '');
  }
  function catName(game, index) {
    var list = (VG.lang() === 'en' ? game.cat_en : game.cat) || game.cat || [];
    return list[index] || (game.cat_en || [])[index] || (game.cat || [])[index] || '';
  }
  var CATEGORIES = {};
  ((window.VG_DATA && window.VG_DATA.categories) || []).forEach(function (cat) { CATEGORIES[cat.ru] = cat; });

  function catLabel(cat) {
    var value = VG.lang();
    if (value === 'ru') return cat;
    var known = CATEGORIES[cat];
    if (known) return known.en || cat;
    for (var i = 0; i < games.length; i++) {
      var index = (games[i].cat || []).indexOf(cat);
      if (index === -1) continue;
      var translated = catName(games[i], index);
      if (translated) return translated;
    }
    return cat;
  }

  function sortCards() {
    if (!grid) return;
    var sorted = cards().slice().sort(function (a, b) {
      if (sort === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'), 'ru');
      if (sort === 'reward') return Number(b.getAttribute('data-reward')) - Number(a.getAttribute('data-reward'));
      return Number(a.getAttribute('data-order')) - Number(b.getAttribute('data-order'));
    });
    sorted.forEach(function (card) { grid.appendChild(card); });
  }

  function applyFilter() {
    if (!grid) return;
    var query = ($('#gameSearch') || {}).value || '';
    query = query.trim().toLowerCase();
    var visible = 0;
    cards().forEach(function (card) {
      var ok = (!query || card.textContent.toLowerCase().indexOf(query) !== -1) &&
        (!activeCat || (card.getAttribute('data-cats') || '').indexOf(activeCat) !== -1);
      card.classList.toggle('hidden', !ok);
      if (ok) visible++;
    });
    var empty = $('#gameEmpty');
    if (empty) empty.classList.toggle('hidden', visible > 0);
  }

  function buildChips() {
    var box = $('#catChips');
    if (!box) return;
    renderChips(box);
    if (box.getAttribute('data-bound')) return;
    box.setAttribute('data-bound', '1');
    box.addEventListener('click', function (event) {
      var button = event.target.closest('[data-cat]');
      if (!button) return;
      activeCat = button.getAttribute('data-cat');
      $$('[data-cat]', box).forEach(function (node) { node.classList.toggle('on', node === button); });
      applyFilter();
    });
  }

  /* Подписи чипов зависят от языка, поэтому перерисовываем их отдельно:
     значение data-cat остаётся русским и совпадает с data-cats карточек. */
  function renderChips(box) {
    var cats = [];
    games.forEach(function (game) {
      (game.cat || []).forEach(function (cat) { if (cats.indexOf(cat) === -1) cats.push(cat); });
    });
    /* Карточки не из списка игр (рулетка казино) тоже добавляют свои жанры,
       иначе фильтр «Казино» не смог бы её показать. */
    cards().forEach(function (card) {
      (card.getAttribute('data-cats') || '').split('|').forEach(function (cat) {
        if (cat && cats.indexOf(cat) === -1) cats.push(cat);
      });
    });
    box.innerHTML = '<button class="chip' + (activeCat ? '' : ' on') + '" data-cat="">' +
      escapeHtml(T('Все', 'All')) + '</button>' +
      cats.map(function (cat) {
        return '<button class="chip' + (cat === activeCat ? ' on' : '') + '" data-cat="' + escapeHtml(cat) + '">' +
          escapeHtml(catLabel(cat)) + '</button>';
      }).join('');
  }

  function decorate() {
    cards().forEach(function (card, index) {
      var id = card.getAttribute('data-game');
      var game = games.filter(function (g) { return g.id === id; })[0];
      if (!game) return;
      card.setAttribute('data-name', game.name);
      card.setAttribute('data-reward', game.reward);
      card.setAttribute('data-order', index);
    });
  }

  function openDetails(game) {
    var modal = $('#gameModal');
    if (!modal) {
      modal = VG.el('div', 'modal');
      modal.id = 'gameModal';
      modal.innerHTML = '<div class="panel card">' +
        '<button class="close" aria-label="' + escapeHtml(T('Закрыть', 'Close')) + '">×</button>' +
        '<div class="detail-head"></div><div class="detail-body"></div>' +
        '<div class="row" style="margin-top:16px"><button class="btn btn-primary" data-play></button>' +
        '<button class="btn btn-ghost" data-close>' + escapeHtml(T('Закрыть', 'Close')) + '</button></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (event) {
        if (event.target === modal || event.target.closest('[data-close]') || event.target.closest('.close')) {
          modal.classList.remove('open');
        }
      });
    }
    modal.querySelector('.detail-head').innerHTML =
      '<div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">' +
      '<span style="width:62px;height:62px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(140deg,rgba(139,92,246,.35),rgba(255,45,149,.25));border:1px solid var(--line-2)">' +
      VG.icon(game.icon, 34) + '</span><div><span class="eyebrow">' + escapeHtml(catName(game, 0)) +
      '</span><h2 style="font-size:22px;margin:4px 0 0">' + escapeHtml(gameName(game)) + '</h2></div></div>';
    var longer = gameText(game, 'long_en', 'long_ru');
    modal.querySelector('.detail-body').innerHTML =
      '<p class="muted" style="font-size:13.5px;white-space:pre-line">' + escapeHtml(longer) + '</p>' +
      '<div class="grid grid-2" style="gap:10px;margin-top:14px">' +
      '<div class="stat-card"><span>' + escapeHtml(T('Награда', 'Reward')) + '</span>' +
      '<b style="font-size:19px">+' + game.reward + ' V</b>' +
      '<small class="muted" style="font-size:11.5px">' + escapeHtml(gameText(game, 'how_en', 'how_ru')) + '</small></div>' +
      '<div class="stat-card"><span>' + escapeHtml(T('Управление', 'Controls')) + '</span>' +
      '<b style="font-size:13px;font-family:var(--body)">' +
      escapeHtml(gameText(game, 'controls_en', 'controls_ru')) + '</b>' +
      '<small class="muted" style="font-size:11.5px">' + escapeHtml(T('Суточный лимит: ', 'Daily limit: ')) +
      fmt(game.daily) + ' V</small></div></div>';
    var playBtn = modal.querySelector('[data-play]');
    playBtn.innerHTML = VG.icon('play', 17) + ' ' + T('Играть', 'Play');
    playBtn.onclick = function () {
      modal.classList.remove('open');
      if (!VG.user()) {
        VG.toast(T('Войдите, чтобы играть и получать V-монеты.',
          'Sign in to play and earn V-coins.'), 'bad');
        setTimeout(function () { location.href = 'login.html?next=catalog'; }, 600);
        return;
      }
      VG.openGame(game);
    };
    modal.classList.add('open');
  }

  document.addEventListener('DOMContentLoaded', function () {
    decorate();
    buildChips();
    sortCards();
    if (VG.onLangChange) {
      VG.onLangChange(function () {
        var box = $('#catChips');
        if (box) renderChips(box);
        applyFilter();
      });
    }
    var search = $('#gameSearch');
    if (search) search.addEventListener('input', VG.debounce(applyFilter, 120));
    var sortBox = $('#sortChips');
    if (sortBox) {
      sortBox.addEventListener('click', function (event) {
        var button = event.target.closest('[data-sort]');
        if (!button) return;
        sort = button.getAttribute('data-sort');
        $$('[data-sort]', sortBox).forEach(function (node) { node.classList.toggle('on', node === button); });
        sortCards();
        applyFilter();
      });
    }
    if (grid) {
      grid.addEventListener('click', function (event) {
        var card = event.target.closest('.game-card');
        if (!card) return;
        var id = card.getAttribute('data-game');
        var game = games.filter(function (g) { return g.id === id; })[0];
        if (game) return openDetails(game);
        /* Своя страница (рулетка) открывается сразу, без модалки правил. */
        var href = card.getAttribute('data-href');
        if (href) location.href = href;
      });
      grid.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var card = event.target.closest('.game-card');
        if (!card) return;
        event.preventDefault();
        var game = games.filter(function (g) { return g.id === card.getAttribute('data-game'); })[0];
        if (game) return openDetails(game);
        var href = card.getAttribute('data-href');
        if (href) location.href = href;
      });
    }
    if (VG.user()) VG.refreshCoins();
  });
})();
