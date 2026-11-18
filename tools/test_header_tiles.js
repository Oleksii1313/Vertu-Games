#!/usr/bin/env node
/*
 * Три плитки верхней панели: язык, монеты и профиль.
 *
 * Проверяется настоящий assets/vg/js/platform.js в jsdom на реальной странице
 * index.html: шапка сайта и панель игрового плеера.
 *
 *   1. RU/EN переключается и в шапке, и во время игры;
 *   2. монеты видны всегда (у гостя 0), обновляются по VG.updateCoins и
 *      попадают в панель плеера;
 *   3. профиль открывается по нажатию (меню гостя ведёт на вход/регистрацию);
 *   4. все три плитки на месте и в шапке, и в плеере — в том числе на телефоне
 *      (проверяем разметку и CSS-правила, которые не дают им разъехаться).
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_header_tiles.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PLATFORM = fs.readFileSync(path.join(ROOT, 'assets/vg/js/platform.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'assets/vg/css/platform.css'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ALICE = {
  user: {
    username: 'Tester', coins: 1234, avatar: 'av:fox', color: 'col:lime', title: 't:vet',
    isAdmin: false, id: 7,
  },
  csrf: 'csrf-token', achievements: 2, captcha: { enabled: false, siteKey: '' },
  games: [],
};

function makeEnv(session) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) errors.push('[jsdom] ' + e.message); });
  vc.on('error', (...args) => errors.push('[console] ' + args.join(' ')));
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/index.html', pretendToBeVisual: true, virtualConsole: vc,
    runScripts: 'outside-only',
    beforeParse(w) {
      w.matchMedia = w.matchMedia || ((query) => ({
        matches: false, media: query, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      }));
      w.fetch = (url) => {
        const pathname = String(url);
        let body = { ok: true };
        if (pathname.indexOf('/api/session') !== -1) body = session;
        else if (pathname.indexOf('/api/balance') !== -1) body = { ok: true, coins: session.user ? session.user.coins : 0 };
        else body = { ok: true, coins: session.user ? session.user.coins : 0 };
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve(body),
        });
      };
    },
  });
  const w = dom.window;
  w.eval(PLATFORM);
  return { dom, w, doc: w.document, errors };
}

function click(w, node) {
  node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
}

(async () => {
  /* ------------------------------------------------- подписанный игрок */
  const signed = makeEnv(ALICE);
  const w = signed.w;
  const doc = signed.doc;
  await wait(80);
  await w.VG.refreshSession();
  await wait(80);

  const header = doc.querySelector('.site-header');
  check('шапка отрисована', !!header, !!header);
  const langButtons = [...doc.querySelectorAll('.site-header .lang [data-lang]')].map((n) => n.getAttribute('data-lang'));
  check('плитка языка: RU и EN', langButtons.join(',') === 'ru,en', langButtons);
  const balance = doc.querySelector('.site-header .balance-pill');
  check('плитка монет есть в шапке', !!balance, !!balance);
  check('монеты показывают баланс игрока',
    balance && balance.textContent.replace(/\s/g, '').indexOf(String(w.VG.fmt(1234)).replace(/\s/g, '')) !== -1,
    balance && balance.textContent);
  const avatar = doc.querySelector('.site-header .avatar-btn');
  check('плитка профиля есть в шапке', !!avatar && !avatar.classList.contains('guest'), avatar && avatar.className);
  check('в профиле виден ник', !!avatar && /Tester/.test(avatar.textContent), avatar && avatar.textContent);
  check('в шапке ровно три плитки',
    doc.querySelectorAll('.site-header .header-right > .lang').length === 1 &&
    doc.querySelectorAll('.site-header .header-right > .balance-pill').length === 1 &&
    doc.querySelectorAll('.site-header .header-right > .avatar-btn').length === 1,
    doc.querySelector('.header-right') && doc.querySelector('.header-right').children.length);

  /* профиль открывается по нажатию */
  click(w, avatar);
  const menu = doc.getElementById('accountMenu');
  check('меню профиля открывается кликом', !!menu, !!menu);
  check('в меню есть ссылка на профиль', !!menu && /profile\.html/.test(menu.innerHTML), menu && menu.innerHTML.slice(0, 80));
  check('меню профиля поверх плеера (z-index)', !!menu && /z-index:\s*210/.test(menu.getAttribute('style') || ''),
    menu && menu.getAttribute('style'));
  click(w, avatar); // закрыть

  /* язык переключается */
  click(w, doc.querySelector('.site-header .lang [data-lang="en"]'));
  await wait(30);
  check('язык переключился на английский (VG.lang)', w.VG.lang() === 'en', w.VG.lang());
  check('кнопка EN отмечена нажатой',
    doc.querySelector('.site-header .lang [data-lang="en"]').getAttribute('aria-pressed') === 'true', null);
  check('тексты шапки стали английскими', /Shop|Profile|Home|Games/.test(header.textContent), header.textContent.slice(0, 80));
  click(w, doc.querySelector('.site-header .lang [data-lang="ru"]'));
  await wait(30);
  check('язык возвращается на русский', w.VG.lang() === 'ru', w.VG.lang());
  check('тексты шапки снова русские', /Магазин|Профиль|Главная|Каталог/.test(header.textContent), header.textContent.slice(0, 80));

  /* -------------------------------------------------- панель плеера */
  const game = { id: 'rover', name: 'Космокухня', name_en: 'Cosmic Kitchen', file: 'games/chefs-rover.html', reward: 5 };
  w.VG.openGame(game);
  await wait(60);
  const overlay = doc.getElementById('playOverlay');
  check('плеер открыт', !!overlay && overlay.classList.contains('open'), !!overlay);
  const playLang = [...overlay.querySelectorAll('.play-lang [data-lang]')].map((n) => n.getAttribute('data-lang'));
  check('в плеере есть плитка языка RU/EN', playLang.join(',') === 'ru,en', playLang);
  const playCoins = overlay.querySelector('.balance-pill [data-coins]');
  check('в плеере есть плитка монет', !!playCoins, !!playCoins);
  check('монеты плеера совпадают с шапкой', !!playCoins && playCoins.textContent === w.VG.fmt(w.VG.coins()),
    playCoins && playCoins.textContent);
  check('в плеере есть плитка профиля', !!overlay.querySelector('.play-account'), null);
  check('кнопки «Назад» и «Экран» сохранены',
    !!overlay.querySelector('[data-close]') && !!overlay.querySelector('[data-fullscreen]'), null);

  /* профиль из плеера */
  click(w, overlay.querySelector('.play-account'));
  check('профиль открывается из плеера', !!doc.getElementById('accountMenu'), !!doc.getElementById('accountMenu'));
  click(w, overlay.querySelector('.play-account'));

  /* монеты обновляются и в шапке, и в плеере */
  w.VG.updateCoins(4321);
  await wait(30);
  check('баланс шапки обновился', /4\s?321/.test(doc.querySelector('.site-header .balance-pill').textContent),
    doc.querySelector('.site-header .balance-pill').textContent);
  check('баланс плеера обновился', /4\s?321/.test(overlay.querySelector('.balance-pill [data-coins]').textContent),
    overlay.querySelector('.balance-pill [data-coins]').textContent);
  check('монеты сохраняются в сессии (VG.coins)', w.VG.coins() === 4321, w.VG.coins());

  /* язык внутри игры: перезапуск кадра с нужным ?lang */
  click(w, overlay.querySelector('.play-lang [data-lang="en"]'));
  await wait(60);
  const frame = overlay.querySelector('.play-frame');
  check('язык в плеере переключается', w.VG.lang() === 'en', w.VG.lang());
  check('игра перезапускается с ?lang=en', /chefs-rover\.html\?lang=en/.test(frame.getAttribute('src') || ''),
    frame.getAttribute('src'));
  check('кнопка EN в плеере отмечена',
    overlay.querySelector('.play-lang [data-lang="en"]').getAttribute('aria-pressed') === 'true', null);
  click(w, overlay.querySelector('.play-lang [data-lang="ru"]'));
  await wait(60);
  check('язык возвращается, кадр перезапускается с ?lang=ru', /chefs-rover\.html\?lang=ru/.test(frame.getAttribute('src') || ''),
    frame.getAttribute('src'));

  w.VG.closeGame();
  await wait(40);
  check('плеер закрывается', !overlay.classList.contains('open'), null);

  check('нет ошибок в консоли платформы', signed.errors.length === 0, signed.errors.slice(0, 4));

  /* ----------------------------------------------------------- гость */
  const guest = makeEnv({ user: null, csrf: 'anon', achievements: 0, captcha: { enabled: false, siteKey: '' }, games: [] });
  const g = guest.w;
  const gdoc = guest.doc;
  await wait(80);
  await g.VG.refreshSession();
  await wait(80);
  check('гость: плитка языка на месте', gdoc.querySelectorAll('.site-header .lang [data-lang]').length === 2, null);
  const guestBalance = gdoc.querySelector('.site-header .balance-pill');
  check('гость: плитка монет на месте', !!guestBalance, !!guestBalance);
  check('гость: монеты показывают 0', !!guestBalance && /(^|\D)0(\D|$)/.test(guestBalance.textContent), guestBalance && guestBalance.textContent);
  const guestAvatar = gdoc.querySelector('.site-header .avatar-btn');
  check('гость: плитка профиля на месте', !!guestAvatar && guestAvatar.classList.contains('guest'),
    guestAvatar && guestAvatar.className);
  click(g, guestAvatar);
  const guestMenu = gdoc.getElementById('accountMenu');
  check('гость: меню профиля открывается', !!guestMenu, !!guestMenu);
  check('гость: в меню есть вход и регистрация',
    !!guestMenu && /login\.html\?tab=login/.test(guestMenu.innerHTML) && /login\.html\?tab=register/.test(guestMenu.innerHTML),
    guestMenu && guestMenu.innerHTML.slice(0, 120));
  g.VG.openGame({ id: 'rover', name: 'Космокухня', name_en: 'Cosmic Kitchen', file: 'games/chefs-rover.html', reward: 5 });
  await wait(40);
  const gOverlay = gdoc.getElementById('playOverlay');
  check('гость: в плеере есть три плитки',
    gOverlay.querySelectorAll('.play-lang [data-lang]').length === 2 &&
    !!gOverlay.querySelector('.balance-pill [data-coins]') && !!gOverlay.querySelector('.play-account'), null);
  check('гость: нет ошибок в консоли', guest.errors.length === 0, guest.errors.slice(0, 4));

  /* ------------------------------------------------- CSS на телефоне */
  check('CSS: плитки не разъезжаются на узком экране',
    /\.play-bar \.play-lang button\{width:28px/.test(CSS) && /\.avatar-btn\.guest/.test(CSS),
    null);
  check('шапка сайта остаётся липкой и с тремя плитками',
    /\.header-right\{margin-left:auto;display:flex/.test(CSS), null);

  if (failures.length) console.log('ПРОВАЛЫ:\n  ' + failures.join('\n  '));
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.log('СБОЙ ТЕСТА: ' + (error && error.stack || error));
  process.exit(1);
});
