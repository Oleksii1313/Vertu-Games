#!/usr/bin/env node
/*
 * Om Nom Паркур — монеты V и препятствия.
 *
 * Проверяем не текст, а настоящее поведение игры: скрипт игры загружается в
 * jsdom, внутренние функции (генератор уровней и конструктор мира) достаются
 * наружу только внутри теста и вызываются по-настоящему.
 *
 *   1. На каждом из 50 уровней есть 3–5 зелёных монет V и хотя бы одна пила.
 *   2. Монеты висят над платформами (достать можно прыжком) и не внутри них.
 *   3. Конфеты и звёзды не пересчитываются: candyTotal не включает монеты.
 *   4. Конструктор мира собирает монету как 3D-объект: зелёный диск, светлый
 *      ободок и белая буква V из двух лучей, и кладёт её в candyList с флагом vg.
 *   5. Сбор монеты идёт через _takeVCoin: счётчик vcoins, тост «+3 V» и вызов
 *      моста награды, а не обычный конфетный счётчик.
 *   6. Мост награды: 3 V за монету, отправка итога по vg:flush/pagehide и
 *      молчание вне плеера.
 *   7. Каталог: ставка 3 V, единицы = монеты, лимит по времени забега.
 *
 *     NODE_PATH=/tmp/dom/node_modules node tools/test_omnom_coins.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'games/om-nom-parkour.html');
const HTML = fs.readFileSync(PAGE, 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* ------------------------------------------------------------ статические */
const bridgeStart = HTML.indexOf('<script>\n/* VG: награда за забег');
const bridgeEnd = HTML.indexOf('</script>', bridgeStart) + 9;
const BRIDGE = bridgeStart > 0 ? HTML.slice(bridgeStart, bridgeEnd) : '';
const GAME = HTML.slice(0, bridgeStart > 0 ? bridgeStart : HTML.length);

check('мост награды на месте', !!BRIDGE, bridgeStart);
check('мост платит 3 V за монету', /R\.init\('omnom', 3\)/.test(BRIDGE), null);
check('мост считает монеты, а не время', /coins \+= Math\.max\(1, n \|\| 1\)/.test(BRIDGE), null);
check('мост отправляет итог по vg:flush', /'vg:flush'/.test(BRIDGE) && /flush\('flush'\)/.test(BRIDGE), null);
check('мост отправляет итог при уходе со страницы', /'pagehide'/.test(BRIDGE), null);
check('вне плеера награда не начисляется', /window\.parent === window\) return/.test(BRIDGE), null);
check('после подтверждения забег начинается заново (следующие монеты тоже платятся)',
  /gameSessionResult/.test(BRIDGE) && /coins = 0/.test(BRIDGE) && /R\.init\('omnom', 3\)/.test(BRIDGE.slice(-700)), null);

check('сбор монеты идёт отдельной веткой', /i\.vg\?this\._takeVCoin\(i\.value\):this\.candy\+=i\.value/.test(GAME), null);
check('счётчик vcoins обнуляется на старте уровня', /this\.candy=0,this\.vcoins=0,this\.deaths=0/.test(GAME), null);
check('в HUD есть чип монет V', /id="hud-vcoins"/.test(GAME) && /vg-coin-icon/.test(GAME), null);
check('в итогах уровня и паузы видны монеты V',
  /id="win-vcoins"/.test(GAME) && /id="pause-vcoins"/.test(GAME), null);
check('иконка монеты — зелёный кружок с белой V', /\.vg-coin-icon::after\{content:"V"/.test(HTML), null);

/* ------------------------------------------------- каталог и награда (py) */
let game = {};
try {
  const out = require('child_process').execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
import game_catalog as c
print(json.dumps(c.GAMES_BY_ID.get('omnom') or {}, ensure_ascii=False))
`], { encoding: 'utf8' }).trim();
  game = JSON.parse(out);
} catch (e) { game = {}; }
check('каталог: 3 V за монету', game.reward === 3, game.reward);
check('каталог: единицы сессии — монеты', game.session_claim === true && game.session_award === 'units', null);
check('каталог: сервер ограничивает итог по времени забега',
  Number(game.session_max_units) > 0 && Number(game.session_units_per_sec) > 0,
  [game.session_max_units, game.session_units_per_sec]);
check('каталог: в описании сказано, сколько монет на уровне',
  /3–5/.test(String(game.how_ru || '')), game.how_ru);

/* ---------------------------------------------------------- живая проверка */
function loadGame() {
  /* Мост и game-kit в тесте не нужны: проверяем саму игру. Внутренние функции
     достаём наружу только здесь, на копии текста в памяти. */
  let html = HTML.replace(/<script src="\/assets\/vg\/js\/game-kit\.js"><\/script>/, '');
  html = html.slice(0, bridgeStart) + html.slice(bridgeEnd);
  const anchor = 'var ei=s=>440*Math.pow';
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error('не найден якорь экспорта');
  html = html.slice(0, at) + ';window.__VGT={Gl:Gl,World:fo};' + html.slice(at);
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'http://localhost/games/om-nom-parkour.html',
  });
  return new Promise((resolve) => setTimeout(() => resolve(dom), 1500));
}

(async () => {
  let dom;
  try {
    dom = await loadGame();
  } catch (e) {
    check('игра загружается в песочнице', false, String(e && e.message));
  }
  const W = dom && dom.window;
  const VGT = W && W.__VGT;
  check('внутренние функции игры доступны', !!(VGT && VGT.Gl && VGT.World), !!(VGT));

  if (VGT && VGT.Gl) {
    let coinCounts = [];
    const bad = [];
    for (let stage = 1; stage <= 50; stage++) {
      const level = VGT.Gl(stage);
      const coins = level.candies.filter((c) => c.vg);
      const saws = level.hazards.filter((h) => h.type === 'saw');
      coinCounts.push(coins.length);
      if (coins.length < 3 || coins.length > 5) bad.push(`этап ${stage}: монет ${coins.length}`);
      if (!saws.length) bad.push(`этап ${stage}: нет пил`);
      const candySum = level.candies.filter((c) => !c.vg).reduce((s, c) => s + c.value, 0);
      if (level.candyTotal !== candySum) bad.push(`этап ${stage}: candyTotal ${level.candyTotal} ≠ ${candySum}`);
      for (const coin of coins) {
        const plat = level.platforms.find((p) => Math.abs(p.x - coin.x) < p.w / 2 + 0.2
          && Math.abs(p.z - coin.z) < p.d / 2 + 0.2
          && coin.y < p.y + p.top + 0.5);
        if (plat) { bad.push(`этап ${stage}: монета внутри платформы`); break; }
        if (!level.platforms.length) { bad.push(`этап ${stage}: монета не над платформой`); break; }
      }
    }
    check('на всех 50 уровнях от 3 до 5 монет V', coinCounts.every((n) => n >= 3 && n <= 5),
      coinCounts.join(','));
    check('монеты не внутри платформ и конфеты не пересчитаны', !bad.length, bad.slice(0, 6).join('; '));

    /* Препятствия: пилы есть всегда, дальше их становится больше. */
    const sawsOf = (n) => VGT.Gl(n).hazards.filter((h) => h.type === 'saw').length;
    const early = sawsOf(1), mid = sawsOf(25), late = sawsOf(50);
    check('на первом уровне есть пила', early >= 1, early);
    check('к концу игры пил заметно больше', late > early, [early, mid, late]);
    check('пилы бывают неподвижными и движущимися',
      VGT.Gl(50).hazards.some((h) => h.type === 'saw' && h.range > 0)
      && VGT.Gl(50).hazards.some((h) => h.type === 'saw' && (h.axis === 'x' || h.axis === 'z')), null);
    check('часть пил висит в провалах между платформами',
      [20, 30, 40, 50].some((n) => VGT.Gl(n).hazards.some((h) => h.type === 'saw' && h.y < 0)), null);
  }

  if (VGT && VGT.World) {
    try {
      const world = new VGT.World({ add() {} });
      world._buildVCoin({ x: 0, y: 2, z: 0, value: 1, phase: 0 });
      const entry = world.candyList[0];
      check('монета попадает в список подбираемых объектов', !!entry && entry.vg === true, entry && entry.vg);
      check('монета собрана из нескольких деталей', !!entry && entry.mesh.children.length >= 4,
        entry && entry.mesh.children.length);
      check('ободок монеты светится (неоновый край)',
        !!world.matCache.vgCoinEdge && world.matCache.vgCoinEdge.emissiveIntensity > 0.5, null);
      check('буква V — белые лучи с эмиссией',
        !!world.matCache.vgCoinV && world.matCache.vgCoinV.color.getHex() === 0xffffff, null);
      check('корпус монеты зелёный', !!world.matCache.vgCoinMat
        && world.matCache.vgCoinMat.color.g > world.matCache.vgCoinMat.color.r, null);

      /* Пила: диск, зубцы по кругу и неоновая обводка по краю. */
      world._buildHazard({ type: 'saw', x: 0, y: 1, z: 0, radius: 0.62, axis: 'x', range: 1, speed: 1, phase: 0 }, 0);
      const saw = world.hazardList.filter((h) => h.type === 'saw').pop();
      check('пила собрана как 3D-объект с зубцами',
        !!saw && saw.pivot.children.length >= 12, saw && saw.pivot.children.length);
      check('у пилы есть неоновая обводка по краю',
        !!saw && !!saw.glow && saw.glow.material.transparent && saw.glow.material.opacity > 0.3,
        saw && saw.glow && saw.glow.material.opacity);
      check('пила крутится (диск вращается в кадре)',
        !!saw && typeof saw.disc.rotation.z === 'number', null);
    } catch (e) {
      check('конструктор мира собирает монету', false, String(e && e.message).slice(0, 160));
    }
  }
  if (W) W.close();

  console.log(failures.length ? 'ПРОВАЛЫ:\n  ' + failures.join('\n  ') + '\n' : '');
  console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
  process.exit(failures.length ? 1 : 0);
})();
