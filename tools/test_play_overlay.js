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

function makeEnv(session, opts) {
  const coarse = !!(opts && opts.coarse);
  /* narrow — экран телефона, но браузер рапортует pointer:fine (так делают
     некоторые оболочки на Android). */
  const narrow = !!(opts && opts.narrow);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented/.test(e.message)) errors.push('[jsdom] ' + e.message); });
  vc.on('error', (...args) => errors.push('[console] ' + args.join(' ')));
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/index.html', pretendToBeVisual: true, virtualConsole: vc,
    runScripts: 'outside-only',
    beforeParse(w) {
      w.matchMedia = (query) => ({
        matches: /pointer:\s*coarse/.test(query) ? coarse
          : (/max-width:\s*900px/.test(query) ? narrow : false),
        media: query, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      });
      try { Object.defineProperty(w.navigator, 'maxTouchPoints', { value: (coarse || narrow) ? 5 : 0, configurable: true }); } catch (e) {}
      w.fetch = (url) => Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(String(url).indexOf('/api/session') !== -1 ? session : { ok: true }),
      });
    },
  });
  const w = dom.window;
  /* Заглушка Fullscreen API: запоминаем, просил ли плеер настоящий полный экран.
     opts.failFs — сколько первых запросов «браузер» отклоняет (как встроенные
     оболочки и iOS), чтобы проверить мягкий откат и повтор по тапу. */
  const fsCalls = [];
  let failLeft = (opts && opts.failFs) || 0;
  w.Element.prototype.requestFullscreen = function () {
    fsCalls.push(this.className || this.tagName);
    if (failLeft > 0) { failLeft--; return Promise.reject(new Error('denied')); }
    /* Как настоящий браузер: заявляем документу текущий fullscreen-элемент. */
    Object.defineProperty(w.document, 'fullscreenElement', { value: this, configurable: true });
    return Promise.resolve();
  };
  w.document.exitFullscreen = function () {
    fsCalls.push('exit');
    Object.defineProperty(w.document, 'fullscreenElement', { value: null, configurable: true });
    return Promise.resolve();
  };
  w.eval(PLATFORM);
  return { w, doc: w.document, errors, fsCalls };
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
  /* Пока игра открыта, сайта на экране быть не должно ни в каком режиме. */
  check('во время игры шапка и подвал сайта скрыты',
    /body\.vg-playing \.site-header/.test(CSS) && /body\.vg-playing \.site-footer/.test(CSS) &&
    /body\.vg-playing \.mobile-nav\{display:none!important\}/.test(CSS), null);
  check('скрытая панель отдаёт своё место игре (нет чёрной полосы сверху)',
    /\.play-overlay\.bar-hidden \.play-frame-wrap\{position:absolute;inset:0/.test(CSS) &&
    /\.play-overlay\.bar-hidden \.play-bar\{position:absolute/.test(CSS), null);
  check('на телефоне панель плеера всплывающая, а игра — на весь кадр',
    /\.play-overlay\.immersive \.play-frame-wrap\{position:absolute;inset:0/.test(CSS) &&
    /\.play-overlay\.immersive\.bar-hidden \.play-bar/.test(CSS), null);
  /* Полный экран на телефоне: игра должна занимать весь экран, поэтому у плеера
     есть своя кнопка «⛶» — панель игрока сама уезжает через 3 секунды. */
  check('есть кнопка «на весь экран» рядом с «язычком»',
    /\.play-fs-float\{/.test(CSS) && /\.play-overlay\.open \.play-fs-float:not\(\[hidden\]\)\{display:inline-flex\}/.test(CSS), null);
  check('кнопка не перекрывает HUD игры: живёт в полосе над кадром',
    /\.play-fs-float\{[^}]*top:calc\(env\(safe-area-inset-top/.test(CSS) &&
    /\.play-fs-float\{[^}]*z-index:9/.test(CSS), null);
  check('запрос полного экрана не передаёт объект опций первым (совместимость)',
    /var maybe = fns\[i\]\.call\(el\);/.test(PLATFORM), null);
  check('есть «язычок», возвращающий панель',
    /\.play-grip\{/.test(CSS) && /\.play-overlay\.immersive \.play-grip\{display:block\}/.test(CSS), null);

  /* ------------------------------------------------------ открытие игры */
  const game = { id: 'flappy', name: 'Flappy Bird', name_en: 'Flappy Bird', file: 'games/flappy.html', reward: 2 };
  w.VG.openGame(game);
  await wait(80);
  const overlay = doc.getElementById('playOverlay');
  /* Компьютер: игра тоже открывается как приложение — клик по карточке уже
     является действием пользователя, поэтому полный экран просим сразу, а не
     только по кнопке «Экран». */
  check('десктоп: игра открывается сразу в полный экран',
    signed.fsCalls.some((c) => /play-overlay/.test(c)), signed.fsCalls);
  check('плеер открылся', !!overlay && overlay.classList.contains('open'), !!overlay);
  check('страница помечена как «идёт игра»', doc.body.classList.contains('vg-playing'), doc.body.className);
  check('прокрутка страницы выключена', doc.body.style.overflow === 'hidden', doc.body.style.overflow);
  /* position:fixed на body и инлайн-геометрия оверлея: вокруг игры не должно
     оставаться ни шапки сайта, ни адресной строки в кадре. */
  check('страница зафиксирована под игрой (не уезжает и не прокручивается)',
    doc.body.style.position === 'fixed', doc.body.style.position);
  check('оверлей прибит к экрану инлайном, а не только классом',
    overlay.style.position === 'fixed' && overlay.style.width === '100%' && overlay.style.height === '100%',
    overlay.getAttribute('style'));
  check('в истории появилась запись игры (кнопка «Назад» вернёт на платформу)',
    typeof signed.w.history.length === 'number' && signed.w.history.length >= 2, signed.w.history.length);
  const frame = overlay.querySelector('.play-frame');
  check('кадр получил игру с языком', /games\/flappy\.html\?lang=(ru|en)/.test(frame.getAttribute('src') || ''),
    frame.getAttribute('src'));
  check('у кадра есть разрешения для телефона',
    /allow="fullscreen; gamepad; autoplay"/.test(overlay.innerHTML), null);
  const bar = overlay.querySelector('.play-bar');
  check('панель плеера на месте и не перекрывает игру',
    !!bar && !/position:absolute/.test(bar.getAttribute('style') || ''), null);
  const exitBtn = bar.querySelector('[data-close]');
  check('кнопка выхода из игры доступна', !!exitBtn, null);
  check('кнопка выхода подписана «Выйти» и лежит в панели плеера',
    !!exitBtn && /Выйти|Exit/.test(exitBtn.textContent || ''), exitBtn && exitBtn.textContent);
  check('у кнопки выхода есть подпись для скринридера',
    !!exitBtn && /Выйти|Exit/.test(exitBtn.getAttribute('aria-label') || ''),
    exitBtn && exitBtn.getAttribute('aria-label'));
  /* Вторая кнопка выхода — поверх игры: панель уезжает через 3 секунды, и
     без неё выйти можно было только угадав «язычок». */
  const exitChip = overlay.querySelector('.play-exit-chip');
  check('поверх игры есть отдельная кнопка «Выйти»', !!exitChip, null);
  check('кнопка «Выйти» не дублируется: она появляется только без панели',
    /\.play-exit-chip\{display:none/.test(CSS) &&
    /\.play-overlay\.bar-hidden \.play-exit-chip\{display:inline-flex\}/.test(CSS), null);
  /* Индикатор загрузки: без него медленный старт выглядит как зависание. */
  const loader = overlay.querySelector('[data-loader]');
  check('пока игра грузится, показан индикатор загрузки', !!loader, null);
  check('индикатор не висит вечно: есть кнопка «Обновить»',
    !!loader && !!loader.querySelector('[data-loader-retry]'), null);
  check('у индикатора есть название игры и подсказка',
    !!loader && !!loader.querySelector('[data-loader-title]') &&
    !!loader.querySelector('[data-loader-hint]'), null);
  /* Кнопку жалобы из игрового интерфейса убрали полностью. */
  check('кнопки «Ошибка» в плеере больше нет', !overlay.querySelector('[data-report]'), null);
  check('кнопка полного экрана доступна', !!overlay.querySelector('[data-fullscreen]'), null);

  /* --------------------------------------------------------- закрытие */
  w.VG.closeGame();
  await wait(120);
  check('плеер закрылся', !overlay.classList.contains('open'), null);
  check('страница снова прокручивается', !doc.body.classList.contains('vg-playing') && doc.body.style.overflow === '',
    [doc.body.className, doc.body.style.overflow]);
  check('после выхода страница расфиксирована', doc.body.style.position === '', doc.body.style.position);
  check('после выхода инлайн-геометрия оверлея снята', overlay.style.position === '', overlay.getAttribute('style'));
  check('кадр очищен', (frame.getAttribute('src') || '') === 'about:blank', frame.getAttribute('src'));

  /* -------------------------------------------------- повторное открытие */
  w.VG.openGame(game);
  await wait(60);
  check('игру можно открыть снова', overlay.classList.contains('open') && doc.body.classList.contains('vg-playing'), null);
  w.VG.closeGame();
  await wait(60);

  check('нет ошибок в консоли', signed.errors.length === 0, signed.errors.slice(0, 3));

  /* ---------------------------------------------- телефон: панель уезжает */
  const phone = makeEnv(GUEST, { coarse: true });
  await wait(120);
  phone.w.VG.openGame(game);
  await wait(80);
  const phoneOverlay = phone.doc.getElementById('playOverlay');
  check('телефон: включён всплывающий режим панели',
    phoneOverlay.classList.contains('immersive'), phoneOverlay.className);
  check('телефон: панель сначала видна', !phoneOverlay.classList.contains('bar-hidden'), null);
  const grip = phoneOverlay.querySelector('[data-grip]');
  check('телефон: «язычок» панели есть в разметке', !!grip, null);
  /* Полный экран: браузер убирает адресную строку и боковые кнопки. */
  check('телефон: при открытии игры плеер просит настоящий полный экран',
    phone.fsCalls.some((c) => /play-overlay/.test(c)), phone.fsCalls);
  /* Панель уходит сама через 3 секунды — ждём реального таймера. */
  await wait(3400);
  check('телефон: панель сама уходит с экрана, чтобы не закрывать HUD игры',
    phoneOverlay.classList.contains('bar-hidden'), phoneOverlay.className);
  grip.dispatchEvent(new phone.w.Event('click'));
  check('телефон: тап по «язычку» возвращает панель',
    !phoneOverlay.classList.contains('bar-hidden'), phoneOverlay.className);
  grip.dispatchEvent(new phone.w.Event('click'));
  check('телефон: повторный тап снова её прячет',
    phoneOverlay.classList.contains('bar-hidden'), null);
  phone.w.VG.closeGame();
  await wait(80);
  check('телефон: при выходе из игры полный экран снимается',
    phone.fsCalls.includes('exit'), phone.fsCalls);
  check('телефон: после выхода режим и таймер убраны',
    !phoneOverlay.classList.contains('immersive') && !phoneOverlay.classList.contains('bar-hidden'),
    phoneOverlay.className);
  check('телефон: ошибок в консоли нет', phone.errors.length === 0, phone.errors.slice(0, 3));

  /* ------------------------------------- кнопка «на весь экран» и повтор */
  const phoneFs = makeEnv(GUEST, { coarse: true });
  await wait(120);
  phoneFs.w.VG.openGame(game);
  await wait(80);
  const fsOverlay = phoneFs.doc.getElementById('playOverlay');
  const fsBtn = fsOverlay.querySelector('[data-fs-float]');
  check('телефон: кнопка «⛶» есть в плеере', !!fsBtn, null);
  check('телефон: когда полный экран включён, кнопка спрятана',
    !!fsBtn && fsBtn.hidden === true, fsBtn && fsBtn.hidden);
  /* Выходим из настоящего полного экрана — кнопка обязана появиться снова. */
  Object.defineProperty(phoneFs.doc, 'fullscreenElement', { value: null, configurable: true });
  phoneFs.doc.dispatchEvent(new phoneFs.w.Event('fullscreenchange'));
  check('телефон: без полного экрана кнопка «⛶» снова видна',
    !!fsBtn && fsBtn.hidden === false, fsBtn && fsBtn.hidden);
  const beforeClicks = phoneFs.fsCalls.length;
  fsBtn.dispatchEvent(new phoneFs.w.Event('click'));
  await wait(60);
  check('телефон: тап по «⛶» просит настоящий полный экран',
    phoneFs.fsCalls.length > beforeClicks, phoneFs.fsCalls);
  phoneFs.w.VG.closeGame();
  await wait(80);
  check('телефон: после выхода кнопка «⛶» скрыта вместе с плеером',
    !!fsBtn && fsBtn.hidden === true, fsBtn && fsBtn.hidden);
  check('телефон: ошибок после кнопки «⛶» нет', phoneFs.errors.length === 0, phoneFs.errors.slice(0, 3));

  /* Браузер отказал в полном экране на открытии (встроенные оболочки, iOS):
     плеер уходит в CSS-режим, а первый тап по игре пробует ещё раз и — если
     браузер передумал — возвращает настоящий полноэкранный режим. */
  const denied = makeEnv(GUEST, { coarse: true, failFs: 2 });
  await wait(120);
  denied.w.VG.openGame(game);
  await wait(120);
  const deniedOverlay = denied.doc.getElementById('playOverlay');
  check('отказ браузера: включается запасной режим на весь экран',
    deniedOverlay.classList.contains('pseudo-full') && denied.doc.body.classList.contains('vg-pseudo-full'),
    deniedOverlay.className);
  check('отказ браузера: попытка была у оверлея и у <html>',
    denied.fsCalls.length >= 2, denied.fsCalls);
  check('отказ браузера: игра всё равно открылась',
    deniedOverlay.classList.contains('open') && /games\/flappy\.html/.test(
      deniedOverlay.querySelector('.play-frame').getAttribute('src') || ''), null);
  const tap = new denied.w.Event('pointerdown', { bubbles: true, cancelable: true });
  Object.assign(tap, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
  deniedOverlay.querySelector('.play-frame').dispatchEvent(tap);
  await wait(80);
  check('отказ браузера: тап по игре повторяет запрос полного экрана',
    denied.fsCalls.length >= 3, denied.fsCalls);
  check('отказ браузера: настоящий полный экран включается со второй попытки',
    !!denied.doc.fullscreenElement && !deniedOverlay.classList.contains('pseudo-full'),
    [!!denied.doc.fullscreenElement, deniedOverlay.className]);
  check('отказ браузера: ошибок в консоли нет', denied.errors.length === 0, denied.errors.slice(0, 3));

  /* --------------------------------- узкий экран, но pointer:fine (оболочки) */
  /* Половина мобильных оболочек сообщает pointer:fine. Тогда не включался ни
     всплывающий режим, ни полный экран, и над игрой висела чёрная полоса. */
  const narrowEnv = makeEnv(GUEST, { narrow: true });
  await wait(120);
  narrowEnv.w.VG.openGame(game);
  await wait(120);
  const narrowOverlay = narrowEnv.doc.getElementById('playOverlay');
  check('узкий сенсорный экран: включается всплывающий режим панели',
    narrowOverlay.classList.contains('immersive'), narrowOverlay.className);
  check('узкий сенсорный экран: просится настоящий полный экран',
    narrowEnv.fsCalls.some((c) => /play-overlay/.test(c)), narrowEnv.fsCalls);
  const narrowGrip = narrowOverlay.querySelector('[data-grip]');
  check('узкий сенсорный экран: «язычок» доступен', !!narrowGrip, null);
  narrowEnv.w.VG.closeGame();
  await wait(80);
  check('узкий сенсорный экран: ошибок нет', narrowEnv.errors.length === 0, narrowEnv.errors.slice(0, 3));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.log(results.join('\n'));
  console.error('\nТЕСТ УПАЛ:', (error && error.stack) || error);
  process.exit(1);
});
