#!/usr/bin/env node
/*
 * Капча на странице входа и регистрации — клиентская половина.
 *
 * Серверную половину проверяет tools/test_captcha.py (siteverify, одноразовость,
 * отказ при TURNSTILE_REQUIRED без ключей). Здесь проверяется то, чего там не
 * видно: появляется ли виджет на форме и уходит ли токен в запрос.
 *
 * С живой площадки приходит captcha.enabled=false — это не баг кода, а
 * отсутствие ключей в окружении сервера (см. docs/CAPTCHA.md). Тест держит оба
 * состояния: с ключами виджет монтируется и токен уходит; без ключей — виджет
 * не рисуется, а подпись нейтральная, без «владелец не настроил».
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_login_captcha.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('login.html');
const PLATFORM = read('assets/vg/js/platform.js');
const LOGIN = read('assets/vg/js/login.js');

const results = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS' : 'FAIL') + ' · ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeEnv(captcha) {
  const calls = [];
  const rendered = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|Not implemented|resource|canvas/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/login.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;

  const session = { ok: true, csrf: 'csrf-token', user: null, achievements: 0, games: [], captcha, turnstile: captcha };
  w.fetch = (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? String(opts.body) : '' });
    let payload = { ok: true };
    if (String(url).indexOf('/api/session') !== -1) payload = session;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(payload)
    });
  };
  /* Заглушка Cloudflare Turnstile: как настоящая, рисует себя и отдаёт токен. */
  if (captcha.enabled) {
    w.turnstile = {
      render(selector, options) {
        rendered.push({ selector, sitekey: options && options.sitekey });
        const host = w.document.querySelector(selector);
        if (host) host.innerHTML = '<div class="fake-turnstile">robot?</div>';
        setTimeout(() => { if (options && options.callback) options.callback('turnstile-token-123'); }, 0);
        return rendered.length;
      },
      remove() {},
      reset() {}
    };
  }
  w.eval(PLATFORM);
  w.eval(LOGIN);
  return { w, doc: w.document, calls, rendered, errors, dom };
}

(async () => {
  /* ------------------------------------------------ 1. ключи настроены */
  const on = makeEnv({ enabled: true, required: false, siteKey: 'site-key-test' });
  await wait(250);
  const slotLogin = on.doc.getElementById('captchaLogin');
  const slotRegister = on.doc.getElementById('captchaRegister');
  check('с ключами: виджет нарисован во вкладке «Вход»', /turnstile/.test(slotLogin.innerHTML), slotLogin.innerHTML.slice(0, 60));
  check('с ключами: виджет нарисован во вкладке «Регистрация»', /turnstile/.test(slotRegister.innerHTML), slotRegister.innerHTML.slice(0, 60));
  check('с ключами: в виджет передан siteKey из сессии',
    on.rendered.length >= 1 && on.rendered.every((r) => r.sitekey === 'site-key-test'), on.rendered);
  check('с ключами: секрет в клиент не попадает', !JSON.stringify(on.rendered).includes('secret'), null);

  /* отправка формы входа: токен должен уйти на сервер */
  const form = on.doc.getElementById('formLogin');
  form.querySelector('[name="username"]').value = 'SkyPilot';
  form.querySelector('[name="password"]').value = 'TestPass12345';
  form.dispatchEvent(new on.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(120);
  const loginCall = on.calls.filter((c) => c.url.indexOf('/api/auth/login') !== -1).pop();
  check('с ключами: токен Turnstile уходит в /api/auth/login',
    !!loginCall && loginCall.body.includes('"turnstileToken":"turnstile-token-123"'), loginCall && loginCall.body.slice(0, 140));
  check('с ключами: подпись «вход защищён попытками» не показывается',
    !on.doc.getElementById('captchaNote').textContent.trim(), on.doc.getElementById('captchaNote').textContent);
  check('с ключами: ошибок в консоли нет', on.errors.length === 0, on.errors.slice(0, 2));
  try { on.dom.window.close(); } catch (e) {}

  /* --------------------------------------------- 2. ключей на сервере нет */
  const off = makeEnv({ enabled: false, required: false, siteKey: '' });
  await wait(250);
  check('без ключей: виджет не рисуется', !off.doc.getElementById('captchaLogin').innerHTML.trim(), null);
  const note = off.doc.getElementById('captchaNote').textContent.trim();
  check('без ключей: подпись нейтральная, без внутренних формулировок',
    /ограничение попыток/i.test(note) && !/владел|not configured|настроена/i.test(note), note);
  const form2 = off.doc.getElementById('formLogin');
  form2.querySelector('[name="username"]').value = 'SkyPilot';
  form2.querySelector('[name="password"]').value = 'TestPass12345';
  form2.dispatchEvent(new off.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(120);
  const loginCall2 = off.calls.filter((c) => c.url.indexOf('/api/auth/login') !== -1).pop();
  check('без ключей: вход по-прежнему отправляется (не блокируется клиентом)',
    !!loginCall2 && loginCall2.body.includes('SkyPilot'), loginCall2 && loginCall2.body.slice(0, 120));
  check('без ключей: ошибок в консоли нет', off.errors.length === 0, off.errors.slice(0, 2));
  try { off.dom.window.close(); } catch (e) {}

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log('\nИТОГО: ' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('\nТЕСТ УПАЛ:', (e && e.stack) || e);
  process.exit(1);
});
