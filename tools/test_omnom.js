#!/usr/bin/env node
/*
 * Om Nom Паркур — новая игра каталога.
 *
 * Проверяем то, без чего игра не заработает внутри платформы:
 *
 *   1. файл игры на месте и целый (сборка в один HTML, крупный);
 *   2. game-kit подключён ДО кода игры и без defer — иначе VGReward не
 *      существует в момент старта, и игра падает с ReferenceError;
 *   3. мост награды работает по общему контракту (units = минуты забега),
 *      отправляет итог по vg:flush/pagehide и молчит вне плеера;
 *   4. запись в каталоге: id, файл, награда, суточный лимит, тексты ru/en;
 *   5. обложка-картинка существует и правильно указана в карточке каталога;
 *   6. у игры есть управление для телефона (стик и кнопки), игра не «только
 *      для клавиатуры».
 *
 *     node tools/test_omnom.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'games/om-nom-parkour.html');
const ART = path.join(ROOT, 'assets/vg/img/games/omnom.jpg');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DATA = fs.readFileSync(path.join(ROOT, 'assets/vg/js/catalog-data.js'), 'utf8');
const PLATFORM = fs.readFileSync(path.join(ROOT, 'assets/vg/js/platform.js'), 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) passed++;
  else failures.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

/* ------------------------------------------------------------------ 1. файл */
const exists = fs.existsSync(FILE);
check('игра лежит в games/om-nom-parkour.html', exists);
const html = exists ? fs.readFileSync(FILE, 'utf8') : '';
check('игра собрана в один файл (больше 400 КБ)', html.length > 400000, html.length);
check('в файле есть canvas и загрузчик', /id="scene"/.test(html) && /id="loader"/.test(html));
check('мобильный viewport с вырезом экрана',
  /name="viewport"[^>]*viewport-fit=cover/.test(html) && /maximum-scale=1/.test(html));

/* ------------------------------------------------------- 2. game-kit раньше */
const kit = html.indexOf('<script src="/assets/vg/js/game-kit.js"');
const firstInline = html.indexOf('<script>');
check('game-kit подключён', kit > 0, kit);
check('game-kit стоит до кода игры', kit > 0 && firstInline > kit, { kit, firstInline });
check('game-kit без defer', !/game-kit\.js" defer/.test(html));

/* --------------------------------------------------------- 3. мост награды */
const bridge = html.slice(html.lastIndexOf('<script>'));
check('мост инициализирует VGReward с id игры', /VGReward/.test(bridge) && /R\.init\('omnom', 5\)/.test(bridge), null);
check('единица награды — минута забега', /Math\.floor\(\(Date\.now\(\) - start\) \/ 60000\)/.test(bridge));
check('итог отправляется по vg:flush и pagehide',
  /data\.type === 'vg:flush'/.test(bridge) && /'pagehide'/.test(bridge) && /R\.finish\(/.test(bridge));
check('вне плеера награда не начисляется', /window\.parent === window\) return/.test(bridge));
check('мост не ломает игру без VGReward', /if \(!R \|\|/.test(bridge) || /if \(!R\)/.test(bridge));

/* -------------------------------------------------------------- 4. каталог */
const catalog = require('child_process');
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
import game_catalog as c
g = c.GAMES_BY_ID.get('omnom')
print(json.dumps(g or {}, ensure_ascii=False))
`;
let game = {};
try {
  game = JSON.parse(catalog.execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim());
} catch (e) {
  game = {};
}
check('игра описана в каталоге (game_catalog.py)', !!game.id, Object.keys(game).length);
check('id игры — omnom', game.id === 'omnom', game.id);
check('файл в каталоге совпадает с games/om-nom-parkour.html',
  game.file === 'games/om-nom-parkour.html', game.file);
check('награда и суточный лимит заданы', game.reward === 5 && game.daily === 300, [game.reward, game.daily]);
check('награда считается по единицам сессии (units), а не суммой V',
  game.session_claim === true && game.session_award === 'units', [game.session_claim, game.session_award]);
check('сервер ограничивает итог по времени забега',
  Number(game.session_max_units) > 0 && Number(game.session_units_per_sec) > 0,
  [game.session_max_units, game.session_units_per_sec]);
check('есть русское и английское название и описание',
  !!(game.name && game.name_en && game.desc && game.desc_en), null);
check('есть тексты «как играть», описание и управление на двух языках',
  !!(game.how_ru && game.how_en && game.long_ru && game.long_en && game.controls_ru && game.controls_en));

/* ------------------------------------------------------------- 5. обложка */
const artOk = fs.existsSync(ART) && fs.readFileSync(ART).slice(0, 3).toString('hex') === 'ffd8ff';
check('обложка игры — настоящий JPEG', artOk, fs.existsSync(ART) ? 'не JPEG' : 'файла нет');
const artSize = fs.existsSync(ART) ? fs.statSync(ART).size : 0;
check('обложка не пустая (больше 30 КБ)', artSize > 30000, artSize);
check('карточка в каталоге ссылается на обложку',
  INDEX.includes('src="assets/vg/img/games/omnom.jpg"'), null);
check('карточка игры есть на главной', /data-game="omnom"/.test(INDEX));
check('на карточке видна награда и суточный лимит',
  /data-game="omnom"[\s\S]{0,900}?\+5 V/.test(INDEX) && /data-game="omnom"[\s\S]{0,900}?до 300 V\/сутки/.test(INDEX));
check('игра попала в каталог каталог-данных (cards берут id оттуда)',
  /"id":"omnom"/.test(DATA) && /"file":"games\/om-nom-parkour.html"/.test(DATA));

/* -------------------------------------------- 6. телефон и выход на платформу */
check('в игре есть управление для телефона (стик и кнопки)',
  /joystick|joystickBase|stick/i.test(html) && /JUMP/i.test(html), null);
check('кнопки не уезжают под вырез (safe-area в игре)',
  /safe-area-inset/.test(html), null);
check('платформа при выходе просит у игры итог забега',
  /'minicraft' \|\| VG\.activeGame\.id === 'omnom'/.test(PLATFORM) || /id === 'omnom'/.test(PLATFORM));

/* ------------------------------------------------------------------ итог */
console.log(failures.length ? 'ПРОВАЛЫ:\n  ' + failures.join('\n  ') + '\n' : '');
console.log('ИТОГО: ' + passed + '/' + (passed + failures.length) + ' проверок пройдено');
process.exit(failures.length ? 1 : 0);
