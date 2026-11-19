#!/usr/bin/env node
/*
 * Плеер игр: мобильная раскладка и «страница не уезжает» во время игры.
 *
 * Проверяется настоящий assets/vg/js/platform.js на реальной странице
 * index.html в jsdom:
 *
 *   1. при открытии игры страница перестаёт прокручиваться (класс vg-playing,
 *      overflow:hidden), а при закрытии всё возвращается;
 *   2. оверлей и рамка кадра не дают «резинить» и зумиться — в CSS есть
 *      overscroll-behavior:none и touch-action:manipulation;
 *   3. кадр игры занимает всё оставшееся место (position:absolute;inset:0),
 *                 панель плеера не отнимает высоту на телефоне;
 *   4. в полноэкранном режиме (настоящем и псевдо) игра остаётся на весь экран,
 *      а кнопка выхода доступна;
 *   5. безопасные зоны (вырез/notch) учтены и у оверлея, и у панели.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_play_overlay.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PLATFORM = fs.readFileSync(path.join(ROOT, 'assets/vg/js/platform.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'assets/vg/css/platform.css'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rule = (selector) => {
  const pattern = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const match = CSS.match(pattern);
  return match ? match[1] : '';
};

const GUEST = { user: null, csrf: 'csrf', achievements: 0, captcha: { enabled: false, siteKey: '' }, games: [] };

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
      w.fetch = (url) => Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(String(url).indexOf('/api/session') !== -1 ? session : { ok: true }),
      });
    },
  });
  const w = dom.window;
  w.eval(PLATFORM);
  return { w, doc: w.document, errors };
}

(async () => {
  const signed = makeEnv(GUEST);
  const { w, doc } = signed;
  await wait(120);

  /* ------------------------------------------------------------- CSS */
  const overlayCss = rule('.play-overlay');
  check('оверлей не даёт странице «резинить»', /overscroll-behavior:\s*none/.test(overlayCss), overlayCss.slice(0, 90));
  check('оверлей не даёт зумиться двойным тапом', /touch-action:\s*manipulation/.test(overlayCss), null);
  check('оверлей учитывает вырез экрана', /safe-area-inset-top/.test(overlayCss) && /safe-area-inset-bottom/.test(overlayCss), null);
  const wrapCss = rule('.play-frame-wrap');
  check('рамка кадра держит прокрутку внутри себя', /overscroll-behavior:\s*contain/.test(wrapCss), wrapCss.slice(0, 90));
  const playingCss = rule('body.vg-playing');
  check('пока игра открыта, страница не скроллится',
    /overflow:\s*hidden/.test(playingCss) && /overscroll-behavior:\s*none/.test(playingCss), playingCss.slice(0, 90));
  const frameCss = rule('.play-frame-wrap iframe');
  check('кадр игры растянут на всю рамку без полей',
    /position:\s*absolute/.test(frameCss) && /inset:\s*0/.test(frameCss) && /width:\s*100%/.test(frameCss) &&
    /height:\s*100%/.test(frameCss), frameCss.slice(0, 110));
  check('в полноэкранном режиме панель остаётся тонкой полосой',
    /\.play-overlay:fullscreen \.play-bar/.test(CSS) && /opacity:\.35/.test(CSS), null);
  check('в ландшафте телефона панель не отнимает высоту у игры',
    /orientation:landscape\) and \(max-height:560px\)/.test(CSS) && /\.play-frame-wrap\{position:absolute;inset:0/.test(CSS), null);

  /* ------------------------------------------------------ открытие игры */
  const game = { id: 'flappy', name: 'Flappy Bird', name_en: 'Flappy Bird', file: 'games/flappy.html', reward: 2 };
  w.VG.openGame(game);
  await wait(80);
  const overlay = doc.getElementById('playOverlay');
  check('плеер открылся', !!overlay && overlay.classList.contains('open'), !!overlay);
  check('страница помечена как «идёт игра»', doc.body.classList.contains('vg-playing'), doc.body.className);
  check('прокрутка страницы выключена', doc.body.style.overflow === 'hidden', doc.body.style.overflow);
  const frame = overlay.querySelector('.play-frame');
  check('кадр получил игру с языком', /games\/flappy\.html\?lang=(ru|en)/.test(frame.getAttribute('src') || ''),
    frame.getAttribute('src'));
  check('у кадра есть разрешения для телефона',
    /allow="fullscreen; gamepad; autoplay"/.test(overlay.innerHTML), null);
  const bar = overlay.querySelector('.play-bar');
  check('панель плеера на месте и не перекрывает игру',
    !!bar && !/position:absolute/.test(bar.getAttribute('style') || ''), null);
  check('кнопка выхода из игры доступна', !!overlay.querySelector('[data-close]'), null);
  check('кнопка полного экрана доступна', !!overlay.querySelector('[data-fullscreen]'), null);

  /* --------------------------------------------------------- закрытие */
  w.VG.closeGame();
  await wait(120);
  check('плеер закрылся', !overlay.classList.contains('open'), null);
  check('страница снова прокручивается', !doc.body.classList.contains('vg-playing') && doc.body.style.overflow === '',
    [doc.body.className, doc.body.style.overflow]);
  check('кадр очищен', (frame.getAttribute('src') || '') === 'about:blank', frame.getAttribute('src'));

  /* -------------------------------------------------- повторное открытие */
  w.VG.openGame(game);
  await wait(60);
  check('игру можно открыть снова', overlay.classList.contains('open') && doc.body.classList.contains('vg-playing'), null);
  w.VG.closeGame();
  await wait(60);

  check('нет ошибок в консоли', signed.errors.length === 0, signed.errors.slice(0, 3));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.log(results.join('\n'));
  console.error('\nТЕСТ УПАЛ:', (error && error.stack) || error);
  process.exit(1);
});
