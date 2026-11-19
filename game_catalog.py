#!/usr/bin/env python3
"""Единый каталог Vert Games: игры, награды, магазин, достижения, казино.

Этот модуль — единственный источник правды. Из него берут данные:

* сервер (``server.py``) — список игр, лимиты наград, товары, достижения;
* генератор страниц (``tools/build_platform.py``) — карточки игр, магазин, тексты.

Награды за игры ограничены суточным лимитом: клиент больше не может «начислить»
себе монеты, он может лишь сообщить о событии с квитанцией, а сумму определяет
сервер.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
#  Игры
# --------------------------------------------------------------------------- #
# reward: сколько V начисляется за событие; daily: суточный лимит на игру.
GAMES = [
    {
        'id': 'flappy', 'name': 'Flappy Bird', 'name_en': 'Flappy Bird',
        'file': 'games/flappy.html', 'icon': 'bird', 'tag': 'CLASSIC',
        'cat': ['Аркады', 'Популярное'], 'cat_en': ['Arcades', 'Popular'],
        'desc': 'Классическая аркада с птицей-путешественницей',
        'desc_en': 'The classic arcade with a travelling bird',
        'reward': 2, 'daily': 400, 'event': 'pipe',
        # Итог забега считает сервер: клиент присылает только число пройденных труб.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 60,
        'session_units_per_sec': 0.8,
        'how_ru': 'Нажимай на экран или пробел, чтобы взмахивать крыльями. Каждая пройденная труба '
                  'приносит 2 V (лимит 400 V в сутки).',
        'how_en': 'Tap the screen or press space to flap. Every pipe you pass pays 2 V '
                  '(400 V daily cap).',
        'long_ru': 'Классическая аркада с птицей-путешественницей. Нажимай на экран или пробел, чтобы '
                   'взмахивать крыльями и лавировать между препятствиями.\n\nКаждая пройденная труба '
                   'приносит очки и монеты. Собирай рекорды и не врезайся!',
        'long_en': 'The classic arcade with a travelling bird. Tap the screen or press space to flap and '
                   'weave between the obstacles.\n\nEvery pipe you pass earns points and coins. Beat your '
                   'records and don’t crash!',
        'controls_ru': 'Пробел / тап — взмах',
        'controls_en': 'Space / tap — flap',
    },
    {
        'id': '2048', 'name': '2048', 'name_en': '2048',
        'file': 'games/game2048.html', 'icon': 'grid', 'tag': 'PUZZLE',
        'cat': ['Головоломки'], 'cat_en': ['Puzzles'],
        'desc': 'Логическая головоломка с плитками', 'desc_en': 'A logic puzzle with sliding tiles',
        'reward': 3, 'daily': 300, 'event': 'merge',
        # Единица — блок из 100 очков; сумму V считает сервер.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 40,
        'session_units_per_sec': 0.35,
        'how_ru': 'Двигай плитки стрелками или свайпами. Каждые 100 очков — 3 V (лимит 300 V в сутки).',
        'how_en': 'Move tiles with arrows or swipes. Every 100 points pays 3 V (300 V daily cap).',
        'long_ru': 'Логическая игра-головоломка. Сдвигай плитки стрелками или свайпами и объединяй '
                   'одинаковые числа.\n\nСобери плитку 2048 и открой новые уровни!',
        'long_en': 'A logic puzzle. Move the tiles with arrows or swipes and merge matching numbers.\n\n'
                   'Reach the 2048 tile!',
        'controls_ru': 'Стрелки / свайп — сдвиг поля',
        'controls_en': 'Arrows / swipe — move the board',
    },
    {
        'id': 'platformer', 'name': 'Platformer', 'name_en': 'Platformer',
        'file': 'games/platformer.html', 'icon': 'platforms', 'tag': 'HOT',
        'cat': ['Экшен', 'Популярное'], 'cat_en': ['Action', 'Popular'],
        'desc': 'Бесконечный раннер по платформам', 'desc_en': 'An endless platform runner',
        'reward': 5, 'daily': 400, 'event': 'distance',
        # Единица — 500 метров дистанции.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 24,
        'session_units_per_sec': 0.25,
        'how_ru': 'Беги вправо, прыгай по платформам и уворачивайся. За каждые 500 метров — 5 V '
                  '(лимит 400 V в сутки).',
        'how_en': 'Run right, jump across platforms and dodge. Every 500 metres pays 5 V '
                  '(400 V daily cap).',
        'long_ru': 'Бесконечный раннер: беги направо, прыгай по платформам и уворачивайся от шипов.\n\n'
                   'Двойной прыжок и движущиеся платформы. Чем дальше бежишь — тем быстрее темп.',
        'long_en': 'An endless runner: run right, jump across platforms and dodge spikes.\n\nDouble jump '
                   'and moving platforms make every run exciting.',
        'controls_ru': 'Стрелки / A, D — бег, пробел — прыжок',
        'controls_en': 'Arrows / A, D — run, Space — jump',
    },
    {
        'id': 'pong', 'name': 'Pong', 'name_en': 'Pong',
        'file': 'games/pong.html', 'icon': 'ball', 'tag': 'RETRO',
        'cat': ['Аркады'], 'cat_en': ['Arcades'],
        'desc': 'Ретро-теннис с комбо', 'desc_en': 'Retro tennis with combos',
        'reward': 2, 'daily': 300, 'event': 'combo',
        # Единица — комбо из 5 отбитий.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 50,
        'session_units_per_sec': 0.6,
        'how_ru': 'Отбивай мяч ракеткой. Каждое комбо из 5 отбитий — 2 V (лимит 300 V в сутки).',
        'how_en': 'Return the ball with your paddle. Every 5-hit combo pays 2 V (300 V daily cap).',
        'long_ru': 'Ретро-теннис. Отбивай мяч ракеткой, набирай комбо и не пропускай голы.\n\nКаждые '
                   '5 очков повышают уровень — мяч ускоряется.',
        'long_en': 'Retro tennis. Return the ball with your paddle, build combos and don’t concede '
                   'goals.\n\nEvery 5 points raise the level.',
        'controls_ru': 'Мышь / стрелки — ракетка',
        'controls_en': 'Mouse / arrows — paddle',
    },
    {
        'id': 'shooter', 'name': 'Shooter', 'name_en': 'Shooter',
        'file': 'games/shooter.html', 'icon': 'target', 'tag': 'HOT',
        'cat': ['Шутеры', 'Экшен'], 'cat_en': ['Shooters', 'Action'],
        'desc': 'Космический шутер с волнами врагов', 'desc_en': 'A space shooter with enemy waves',
        'reward': 5, 'daily': 500, 'event': 'wave',
        # Единица — пройденная волна.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 20,
        'session_units_per_sec': 0.2,
        'how_ru': 'Сбивай врагов и проходи волны. Каждая волна — 5 V (лимит 500 V в сутки).',
        'how_en': 'Blast enemies and clear waves. Each wave pays 5 V (500 V daily cap).',
        'long_ru': 'Космический шутер: управляй кораблём, сбивай врагов и уворачивайся от атак.\n\n'
                   'Волны идут одна за другой; собирай бонусы и наращивай комбо.',
        'long_en': 'A space shooter: pilot your ship, shoot down enemies and dodge attacks.\n\nEvery '
                   'cleared wave starts the next.',
        'controls_ru': 'Стрелки / WASD — полёт, пробел — огонь',
        'controls_en': 'Arrows / WASD — fly, Space — fire',
    },
    {
        'id': 'snake', 'name': 'Snake', 'name_en': 'Snake',
        'file': 'games/snake.html', 'icon': 'snake', 'tag': 'CLASSIC',
        'cat': ['Аркады'], 'cat_en': ['Arcades'],
        'desc': 'Легендарная змейка', 'desc_en': 'The legendary snake',
        'reward': 5, 'daily': 300, 'event': 'level',
        # Итоговая награда за забег: игра присылает отдельно обычные и золотые
        # яблоки, сервер сам считает сумму, проверяет правдоподобность по времени
        # и одноразовость сессии. Клиентские V не принимаются.
        'session_claim': True, 'session_award': 'snake', 'session_max_coins': 36,
        'apple_reward': 1, 'gold_reward': 10, 'level_every': 5, 'level_reward': 5,
        'how_ru': 'Веди пальцем по полю или мышью — змейка повернёт. Собирай яблоки и расти: '
                  'каждое яблоко — 1 V, каждые 5 яблок — ещё 5 V, редкое золотое яблоко — 10 V '
                  '(лимит 300 V в сутки).',
        'how_en': 'Drag a finger across the field or move the mouse to steer. Eat apples and '
                  'grow: every apple pays 1 V, every 5 apples pay 5 V more, a rare golden apple '
                  'pays 10 V (300 V daily cap).',
        'long_ru': 'Легендарная змейка в изумрудном стиле: чешуя, свечение и плавные повороты. '
                   'Собирай яблоки, расти и не врезайся в себя.\n\nКроме обычных яблок на поле '
                   'появляются редкие золотые (10 V) и изумруды — временный множитель ×2. Каждые '
                   '5 яблок — новый уровень скорости и новая арена с препятствиями.',
        'long_en': 'The legendary snake in emerald style: scales, glow and smooth turns. Eat apples, '
                   'grow longer and don’t crash into yourself.\n\nBesides normal apples the board '
                   'spawns rare golden ones (10 V) and emeralds — a temporary ×2 multiplier. Every '
                   '5 apples raise the speed level and open a new arena with obstacles.',
        'controls_ru': 'Свайп по полю / мышь / стрелки — направление, пробел — пауза',
        'controls_en': 'Swipe across the field / mouse / arrows — direction, Space — pause',
    },
    {
        'id': 'minicraft', 'name': 'MiniCraft 3D', 'name_en': 'MiniCraft 3D',
        'file': 'games/minicraft.html', 'icon': 'cube', 'tag': 'NEW',
        'cat': ['Песочницы', 'Популярное'], 'cat_en': ['Sandbox', 'Popular'],
        'desc': 'Деревни, жители и монстры в мире 256 × 256',
        'desc_en': 'Villages, villagers and monsters in a 256 × 256 world',
        'reward': 3, 'daily': 450, 'event': 'coin',
        # Итоговая награда за сессию: игра присылает число собранных зелёных монет,
        # сервер платит coins × reward. Флаг включает отдельный эндпоинт только
        # для этой игры; другим играм он по-прежнему недоступен.
        'session_claim': True, 'session_max_coins': 150,
        'how_ru': 'Собирай зелёные V-монеты в деревнях, на фермах и в лесах: каждая монета — '
                  'ровно 3 V (до 150 монет за сессию, лимит 450 V в сутки).',
        'how_en': 'Collect green V coins in villages, farms and forests: each coin pays exactly '
                  '3 V (up to 150 coins per session, 450 V daily cap).',
        'long_ru': 'Зелёные озёра и реки с песчаными берегами, остров с кладом, деревянные и '
                   'каменные мосты, причалы, сторожевые башни, мельница, рынок, небольшой замок, '
                   'руины и пещеры. Шесть деревень с домами, дорогами, фермами, колодцами и '
                   'заборами, дороги между поселениями, ели, берёзы, цветы, грибы и валуны. '
                   'Дружелюбные жители с руками и походкой подсказывают дорогу к сундукам, '
                   'а монстры трёх видов — зомби, скелеты и пауки — охраняют опасные окраины.\n\n'
                   'Каждая зелёная монета V даёт ровно 3 V. Монеты лежат на дорогах, фермах, '
                   'в лесах, у деревень и в опасных окраинах мира; сундуки открываются один '
                   'раз за сессию. Каждую минуту врагов становится больше, а в конце — экран '
                   'результатов с числом монет, V, побед, сундуков и временем.\n\n'
                   'WASD — движение, ПКМ (зажать) — обзор, пробел — прыжок, ЛКМ — ломать / '
                   'атаковать, короткий клик ПКМ — поставить блок, 1–6 — выбор блока. '
                   'Раунд длится 3 минуты, Esc — пауза.',
        'long_en': 'Green lakes and rivers with sandy shores, an island with a hidden chest, '
                   'wooden and stone bridges, docks, watchtowers, a windmill, a market, a small '
                   'castle, ruins and caves. Six villages with houses, roads, farms, wells and '
                   'fences, roads between settlements, pines, birches, flowers, mushrooms and '
                   'boulders. Friendly villagers with arms and a walking cycle point the way to '
                   'chests, while zombies, skeletons and spiders guard the dangerous edges.\n\n'
                   'Every green V coin pays exactly 3 V. Coins lie along roads, on farms, in '
                   'forests, around villages and in the dangerous edges of the map; chests can '
                   'be opened once per session. Every minute brings more enemies, and at the '
                   'end a results screen shows coins, V, kills, chests and time.\n\n'
                   'WASD to move, hold the right button to look around, Space to jump, left '
                   'click to break / attack, a short right click places a block, 1–6 selects a '
                   'block. Each round lasts 3 minutes, Esc pauses.',
        'controls_ru': 'WASD · ПКМ — обзор · ЛКМ — действие · 1–6 — блок',
        'controls_en': 'WASD · RMB — look · LMB — action · 1–6 — block',
    },
    {
        'id': 'doodle', 'name': 'Doodle Jump', 'name_en': 'Doodle Jump',
        'file': 'games/doodle.html', 'icon': 'doodle', 'tag': 'NEW',
        'cat': ['Аркады', 'Популярное'], 'cat_en': ['Arcades', 'Popular'],
        'desc': 'Прыжки по платформам вверх', 'desc_en': 'Bounce your way upwards',
        'reward': 2, 'daily': 400, 'event': 'metre',
        # Единица — 100 метров подъёма.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 40,
        'session_units_per_sec': 0.45,
        'how_ru': 'Прыгай всё выше. Каждые 100 метров — 2 V (лимит 400 V в сутки).',
        'how_en': 'Climb as high as you can. Every 100 metres pays 2 V (400 V daily cap).',
        'long_ru': 'Прыгун отскакивает сам: направляй его стрелками или A/D, стреляй пробелом. Зелёные '
                   'платформы надёжные, голубые двигаются, коричневые ломаются.\n\nНа телефоне — крупные '
                   'кнопки движения и выстрела. Esc/P — пауза.',
        'long_en': 'Your jumper bounces automatically: steer with arrows or A/D, shoot with Space. Green '
                   'platforms are safe, blue ones move and brown ones break.\n\nBig touch buttons make it '
                   'playable on phones. Esc/P pauses.',
        'controls_ru': 'Стрелки / A, D — движение, пробел — выстрел',
        'controls_en': 'Arrows / A, D — move, Space — shoot',
    },
    {
        # Redline снят с витрины по требованию владельца платформы: карточки и
        # запуска нет. Запись остаётся в каталоге, чтобы не потерять историю —
        # game_statistics, ledger и game_receipts ссылаются на id 'redline'.
        # Файл игры тоже остаётся, но публичных ссылок на него больше нет.
        'id': 'redline', 'name': 'Redline: Розыск', 'name_en': 'Redline: Wanted',
        'hidden': True,
        'file': 'games/redline.html', 'icon': 'racecar', 'tag': 'NEW',
        'cat': ['Гонки', 'Популярное'], 'cat_en': ['Racing', 'Popular'],
        'desc': 'Городские гонки и погони', 'desc_en': 'City racing and police pursuits',
        'reward': 10, 'daily': 300, 'event': 'exchange',
        'how_ru': 'Гоночные кредиты Redline обмениваются на V-монеты: 1000 кредитов = 10 V '
                  '(лимит 300 V в сутки).',
        'how_en': 'Redline racing credits convert to V-coins: 1000 credits = 10 V (300 V daily cap).',
        'long_ru': 'Аркадные городские гонки: сеть из 18 дорожных участков, около 8,4 км, сюжетный '
                   'пролог, 15 соперников, гараж и тюнинг, погони с шестью уровнями розыска.\n\n'
                   'Телефон: джойстик — газ и руль, отдельные нитро, ручник и замедление. ПК: WASD, '
                   'Shift, пробел, E, G — гараж, R — вернуть на дорогу.\n\nГоночные кредиты — отдельная '
                   'экономика Redline, но обмен на V-монеты выполняется на сервере.',
        'long_en': 'Arcade city racing: 18 road sections covering about 8.4 km, a story prologue, '
                   '15 rivals, a garage and tuning, six-level police pursuits.\n\nPhone: joystick for '
                   'throttle and steering, separate nitro, handbrake and slow-motion buttons. PC: WASD, '
                   'Shift, Space, E, G for garage, R to recover.\n\nRacing credits are Redline’s own '
                   'economy, but the exchange into V-coins is performed on the server.',
        'controls_ru': 'WASD / джойстик, Shift — нитро, пробел — ручник',
        'controls_en': 'WASD / joystick, Shift — nitro, Space — handbrake',
    },
    {
        'id': 'skyisle', 'name': 'Sky-Isle Logistics', 'name_en': 'Sky-Isle Logistics',
        'file': 'games/sky-isle.html', 'icon': 'drone', 'tag': 'NEW',
        'cat': ['Полёты', 'Популярное'], 'cat_en': ['Flight', 'Popular'],
        'desc': 'Доставка почты дроном между островами', 'desc_en': 'Postal drone deliveries between islands',
        'reward': 5, 'daily': 300, 'event': 'delivery',
        'how_ru': 'Каждая доставка — 5 V (лимит 300 V в сутки).',
        'how_en': 'Each delivery pays 5 V (300 V daily cap).',
        'long_ru': 'Уютный парящий остров Аэро-Вилль и почтовый квадрокоптер. Забирайте посылки в '
                   'зелёном круге у депо и доставляйте их в дома, обсерваторию и мастерскую.\n\nПлавная '
                   'инерция, наклоны дрона, карта и высота от 1,5 до 20 метров. Ни таймеров, ни штрафов.',
        'long_en': 'Fly a little postal quadcopter around the floating island of Aéro-Ville. Pick up '
                   'parcels at the green depot circle and deliver them to houses, the observatory and the '
                   'workshop.\n\nSmooth acceleration, drone tilt, a minimap and a 1.5–20 m altitude range. '
                   'No deadlines or penalties.',
        'controls_ru': 'WASD — полёт, пробел / Shift — вверх, C — вниз',
        'controls_en': 'WASD — fly, Space / Shift — ascend, C — descend',
    },
    {
        'id': 'rover', 'name': 'Космокухня', 'name_en': 'Cosmic Kitchen',
        'file': 'games/chefs-rover.html', 'icon': 'rover', 'tag': 'NEW',
        'cat': ['Приключения', 'Популярное'], 'cat_en': ['Adventure', 'Popular'],
        'desc': 'Фудтрак-вездеход по дорогам Аурелии', 'desc_en': 'A food-truck rover across Aurelia',
        'reward': 6, 'daily': 300, 'event': 'order',
        # Единица — выполненный заказ.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 12,
        'session_units_per_sec': 0.12,
        'how_ru': 'Выполненные заказы приносят 6 V (лимит 300 V в сутки).',
        'how_en': 'Completed orders pay 6 V (300 V daily cap).',
        'long_ru': 'Космокухня: Дороги Аурелии. Леса четырёх биомов, десять деревень с рынками и '
                   'огородами, жители и стоянки вдоль дорог. Путешествуй на уютном фудтраке-вездеходе, '
                   'готовь заказы и исследуй мир.',
        'long_en': 'Cosmic Kitchen: Roads of Aurelia. Forests of four biomes, ten villages with markets '
                   'and gardens, roadside stops and locals. Travel in a cosy food-truck rover, cook orders '
                   'and explore the world.',
        'controls_ru': 'WASD — движение, мышь — обзор, E — взаимодействие',
        'controls_en': 'WASD — move, mouse — look, E — interact',
    },
    {
        'id': 'crystal', 'name': 'Кристальный рубеж', 'name_en': 'Crystal Frontier',
        'file': 'games/crystal-frontier.html', 'icon': 'gem', 'tag': 'NEW',
        'cat': ['Приключения', 'Песочницы'], 'cat_en': ['Adventure', 'Sandbox'],
        'desc': 'Остров в сумерках: жители, руда и осколки Сердца',
        'desc_en': 'A twilight island of villagers, ore and Heart shards',
        'reward': 5, 'daily': 300, 'event': 'fragment',
        # Единица — осколок Сердца, закрытый квест или победа над колоссом:
        # за забег их не больше десяти, поэтому сервер ограничивает итог десятью.
        'session_claim': True, 'session_award': 'units', 'session_max_units': 10,
        'session_units_per_sec': 0.015,
        'how_ru': 'Осколки Сердца, находки, квесты и победа над колоссом приносят V: 5 V за '
                  'единицу, до 50 V за забег и 300 V в сутки.',
        'how_en': 'Heart shards, finds, quests and the Colossus pay V: 5 V per unit, up to '
                  '50 V per run and 300 V per day.',
        'long_ru': 'Трёхмерный остров в сумерках: деревня с жителями, шахты, руины и лес. '                   'Собирайте руду и травы, крафтите кирку, меч и броню, выполняйте поручения '                   'старейшины и возвращайте пять осколков Сердца на алтарь.\n\nМир освещают '                   'кристальные фонари, под землёй ждут пещеры и стражи, а в финале — колосс. '                   'Прогресс сохраняется в браузере, таймера на исследование нет.',
        'long_en': 'A three-dimensional island at dusk: a village with locals, mines, ruins and '                   'forest. Mine ore and gather herbs, craft a pickaxe, sword and armour, take the '                   "elder's errands and return the five Heart shards to the altar.\n\nCrystal "                   'lanterns light the world, caves and guardians wait underground, and the '                   'Colossus closes the story. Progress is saved in the browser and there is no '                   'exploration timer.',
        'controls_ru': 'WASD — движение, Shift — бег, мышь — обзор, ЛКМ — копать/бить/ставить, '
                       'E — действие и разговор, I — инвентарь, L — фонарь, Esc — пауза. '
                       'На телефоне: стик слева, кнопки прыжка, кирки, атаки и действия справа.',
        'controls_en': 'WASD — move, Shift — run, mouse — look, LMB — dig/hit/place, E — act and '
                       'talk, I — inventory, L — lantern, Esc — pause. On a phone: the stick on '
                       'the left, jump/mine/attack/action buttons on the right.',
    },
]

GAME_IDS = {g['id'] for g in GAMES}
GAMES_BY_ID = {g['id']: g for g in GAMES}

# Карточка рулетки в каталоге. Отдельная запись, потому что это не игра с
# наградой за действия, а социальное казино со своими ставками и лимитами;
# карточка каталога — единственное место, где она смешивается с играми.
CASINO_CARD = {
    'id': 'roulette', 'name': 'Рулетка Vert', 'name_en': 'Vert Roulette',
    'href': 'roulette.html', 'icon': 'wheel', 'tag': 'HOT', 'cover': 'roulette',
    'cat': ['Казино', 'Удача'], 'cat_en': ['Casino', 'Luck'],
    'desc': 'Испытай удачу и забери выигрыш до x5',
    'desc_en': 'Try your luck and win up to x5',
    'long_ru': 'Колесо фортуны Vert Games: 20 равных секторов по 18°, четыре множителя — x0, x1, x2 и x5, '
               'теоретический возврат 95 %.\n\nСтавка списывается до вращения, а выплата — это полная сумма: '
               'ставка × множитель. Результат, начисление и история считает сервер в одной транзакции; '
               'клиент только показывает присланный сектор.',
    'long_en': 'The Vert Games wheel of fortune: 20 equal 18° sectors, four multipliers — x0, x1, x2 and x5, '
               'with a 95 % theoretical return.\n\nThe stake is charged before the spin and the payout is the '
               'full amount: stake × multiplier. The server computes the result, the credit and the history in a '
               'single transaction; the client only shows the returned sector.',
    'stakes_ru': 'Ставки: 5, 10, 20, 25, 50 и 100 V. Бесплатное вращение — 1 в сутки, платных — до 5 в сутки.',
    'stakes_en': 'Stakes: 5, 10, 20, 25, 50 and 100 V. One free spin per day and up to 5 paid spins per day.',
    'rtp': 95,
}


def visible_games() -> list[dict]:
    """Игры, доступные на витрине: скрытые (``hidden``) не показываем и не запускаем."""
    return [g for g in GAMES if not g.get('hidden')]


def game_available(game_id: str) -> bool:
    return any(g['id'] == game_id for g in visible_games())


def public_games():
    """Каталог без серверных лимитов (то, что видит браузер). Скрытые игры не отдаём."""
    out = []
    for g in visible_games():
        out.append({
            'id': g['id'], 'name': g['name'], 'name_en': g['name_en'], 'file': g['file'],
            'icon': g['icon'], 'tag': g['tag'], 'cat': g['cat'], 'cat_en': g['cat_en'],
            'desc': g['desc'], 'desc_en': g['desc_en'], 'reward': g['reward'],
            'event': g['event'], 'daily': g['daily'], 'how_ru': g['how_ru'], 'how_en': g['how_en'],
            # Игры с итоговой наградой сессии: платформа должна знать, что сумму
            # считает сервер, а клиент присылает только «единицы» события.
            'sessionClaim': bool(g.get('session_claim')),
            'sessionMaxUnits': g.get('session_max_units'),
            'unitReward': g['reward'],
            'long_ru': g['long_ru'], 'long_en': g['long_en'],
            'controls_ru': g['controls_ru'], 'controls_en': g['controls_en'],
        })
    return out


# --------------------------------------------------------------------------- #
#  Магазин
# --------------------------------------------------------------------------- #
SHOP_ITEMS = [
    # Аватары
    {'id': 'av:rocket', 'kind': 'avatar', 'name_ru': 'Ракета', 'name_en': 'Rocket', 'price': 0,
     'icon': 'rocket', 'payload': 'av:rocket', 'order': 10},
    {'id': 'av:fox', 'kind': 'avatar', 'name_ru': 'Лис', 'name_en': 'Fox', 'price': 100,
     'icon': 'fox', 'payload': 'av:fox', 'order': 11},
    {'id': 'av:tiger', 'kind': 'avatar', 'name_ru': 'Тигр', 'name_en': 'Tiger', 'price': 130,
     'icon': 'tiger', 'payload': 'av:tiger', 'order': 12},
    {'id': 'av:alien', 'kind': 'avatar', 'name_ru': 'Инопланетянин', 'name_en': 'Alien', 'price': 120,
     'icon': 'alien', 'payload': 'av:alien', 'order': 13},
    {'id': 'av:dragon', 'kind': 'avatar', 'name_ru': 'Дракон', 'name_en': 'Dragon', 'price': 180,
     'icon': 'dragon', 'payload': 'av:dragon', 'order': 14},
    {'id': 'av:bot', 'kind': 'avatar', 'name_ru': 'Кибербот', 'name_en': 'Cyborg', 'price': 220,
     'icon': 'bot', 'payload': 'av:bot', 'order': 15},
    {'id': 'av:phoenix', 'kind': 'avatar', 'name_ru': 'Феникс', 'name_en': 'Phoenix', 'price': 280,
     'icon': 'phoenix', 'payload': 'av:phoenix', 'order': 16},
    {'id': 'av:gem', 'kind': 'avatar', 'name_ru': 'Самоцвет', 'name_en': 'Gem', 'price': 320,
     'icon': 'gem', 'payload': 'av:gem', 'order': 17},
    # Цвета профиля
    {'id': 'col:teal', 'kind': 'color', 'name_ru': 'Бирюза', 'name_en': 'Teal', 'price': 0,
     'icon': '', 'payload': '#2ee6c8', 'order': 20},
    {'id': 'col:lime', 'kind': 'color', 'name_ru': 'Неон-лайм', 'name_en': 'Neon lime', 'price': 60,
     'icon': '', 'payload': '#c6ff3d', 'order': 21},
    {'id': 'col:violet', 'kind': 'color', 'name_ru': 'Фиолетовый', 'name_en': 'Violet', 'price': 120,
     'icon': '', 'payload': '#8b5cf6', 'order': 22},
    {'id': 'col:magenta', 'kind': 'color', 'name_ru': 'Магента', 'name_en': 'Magenta', 'price': 140,
     'icon': '', 'payload': '#ff2d95', 'order': 23},
    {'id': 'col:gold', 'kind': 'color', 'name_ru': 'Золото', 'name_en': 'Gold', 'price': 180,
     'icon': '', 'payload': '#e8b64c', 'order': 24},
    {'id': 'col:cyan', 'kind': 'color', 'name_ru': 'Кибер-циан', 'name_en': 'Cyber cyan', 'price': 200,
     'icon': '', 'payload': '#22d3ee', 'order': 25},
    # Титулы
    {'id': 't:new', 'kind': 'title', 'name_ru': 'Новичок', 'name_en': 'Beginner', 'price': 0,
     'icon': '', 'payload': 'Новичок', 'order': 30},
    {'id': 't:vet', 'kind': 'title', 'name_ru': 'Ветеран', 'name_en': 'Veteran', 'price': 80,
     'icon': '', 'payload': 'Ветеран', 'order': 31},
    {'id': 't:ace', 'kind': 'title', 'name_ru': 'Ас', 'name_en': 'Ace', 'price': 160,
     'icon': '', 'payload': 'Ас', 'order': 32},
    {'id': 't:legend', 'kind': 'title', 'name_ru': 'Легенда', 'name_en': 'Legend', 'price': 260,
     'icon': '', 'payload': 'Легенда', 'order': 33},
    # Фоны профиля: обложка шапки профиля (cosmetic). payload — CSS-класс.
    {'id': 'bg:aurora', 'kind': 'bg', 'name_ru': 'Северное сияние', 'name_en': 'Aurora',
     'price': 0, 'icon': '', 'payload': 'vg-cover-aurora', 'order': 50},
    {'id': 'bg:grid', 'kind': 'bg', 'name_ru': 'Сетка', 'name_en': 'Grid',
     'price': 120, 'icon': '', 'payload': 'vg-cover-grid', 'order': 51},
    {'id': 'bg:sunset', 'kind': 'bg', 'name_ru': 'Закат', 'name_en': 'Sunset',
     'price': 180, 'icon': '', 'payload': 'vg-cover-sunset', 'order': 52},
    # Услуги (не «предмет навсегда», а разовое действие за V)
    {'id': 'username_change', 'kind': 'service',
     'name_ru': 'Смена ника', 'name_en': 'Change username',
     'price': 1000, 'icon': 'user', 'payload': '', 'order': 40}
]

# Только косметика. Пакеты V (в том числе за V-монеты) удалены: монеты
# нельзя ни купить, ни обменять — их зарабатывают в играх и казино.
SHOP_KINDS = ['avatar', 'color', 'title', 'bg', 'service']

# Пакеты V за реальные деньги (выключены, пока не задан SHOP_PROVIDER).
# Продажа V-монет за реальные деньги удалена из продукта.
# Словарь сохранён пустым: код магазина и страницы проверяют, что пакетов нет, и
# показывают «V зарабатываются в играх», а не форму оплаты.
SHOP_PACKS = {}

# --------------------------------------------------------------------------- #
#  Ежедневные задания (сброс в 00:00 UTC)
# --------------------------------------------------------------------------- #
DAILY_TASKS = [
    {'key': 'play3', 'title': 'Играть 3 раза', 'title_en': 'Play 3 games',
     'description': 'Сыграйте три любые партии за день.', 'desc_en': 'Play any three rounds today.',
     'task_type': 'play', 'target_value': 3, 'reward': 40},
    {'key': 'casino3', 'title': '3 ставки в казино', 'title_en': '3 casino bets',
     'description': 'Любые ставки в «Рулетке Vert» — слоты или колесо.', 'desc_en': 'Any bets in Vert Roulette — slots or wheel.',
     'task_type': 'casino', 'target_value': 3, 'reward': 60},
]

# --------------------------------------------------------------------------- #
#  Достижения
# --------------------------------------------------------------------------- #
ACHIEVEMENTS = [
    {'id': 'first_login', 'name_ru': 'Добро пожаловать', 'name_en': 'Welcome', 'icon': 'spark',
     'desc_ru': 'Первый вход в аккаунт', 'desc_en': 'First sign-in', 'coins': 50, 'order': 10},
    {'id': 'first_game', 'name_ru': 'Первый запуск', 'name_en': 'First launch', 'icon': 'play',
     'desc_ru': 'Сыграйте в любую игру', 'desc_en': 'Play any game', 'coins': 25, 'order': 20},
    {'id': 'games_10', 'name_ru': 'Во вкусе', 'name_en': 'Getting hooked', 'icon': 'gamepad',
     'desc_ru': '10 сыгранных игр', 'desc_en': '10 games played', 'coins': 100, 'order': 30},
    {'id': 'games_50', 'name_ru': 'Заядлый игрок', 'name_en': 'Hardcore player', 'icon': 'trophy',
     'desc_ru': '50 сыгранных игр', 'desc_en': '50 games played', 'coins': 300, 'order': 40},
    {'id': 'first_shop', 'name_ru': 'Шопоголик', 'name_en': 'Shopper', 'icon': 'bag',
     'desc_ru': 'Первая покупка в магазине', 'desc_en': 'First shop purchase', 'coins': 30, 'order': 50},
    {'id': 'first_bet', 'name_ru': 'Первая ставка', 'name_en': 'First bet', 'icon': 'dice',
     'desc_ru': 'Первая ставка в казино', 'desc_en': 'First casino bet', 'coins': 20, 'order': 60},
    {'id': 'big_win', 'name_ru': 'Крупный куш', 'name_en': 'Big win', 'icon': 'crown',
     'desc_ru': 'Выигрыш 500 V за одну ставку', 'desc_en': 'Win 500 V on a single bet', 'coins': 100,
     'order': 70},
    {'id': 'collector', 'name_ru': 'Коллекционер', 'name_en': 'Collector', 'icon': 'gem',
     'desc_ru': 'Куплено 5 предметов', 'desc_en': '5 items purchased', 'coins': 150, 'order': 80},
    {'id': 'balance_5k', 'name_ru': 'Богач', 'name_en': 'Wealthy', 'icon': 'coin',
     'desc_ru': 'Баланс 5 000 V', 'desc_en': 'Balance of 5 000 V', 'coins': 200, 'order': 90},
    {'id': 'wheel_master', 'name_ru': 'Мастер колеса', 'name_en': 'Wheel master', 'icon': 'wheel',
     'desc_ru': '20 вращений колеса', 'desc_en': '20 wheel spins', 'coins': 120, 'order': 100},
]

# --------------------------------------------------------------------------- #
#  Казино
# --------------------------------------------------------------------------- #
# Версия сборки: попадает в <meta name="vert-build">, в заголовок X-Build и в
# /api/version. По ней видно, какая именно версия страниц реально отдаётся
# сервером (а не закеширована браузером). Меняется при правках казино/колеса.
APP_VERSION = '2026-11-25-crystal-frontier-v1'

# Колесо «Рулетки Vert»: 20 одинаковых секторов по 18°, только целые множители.
#
#   множитель | секторов | вероятность | вклад в RTP
#   x0        |    7     |    35 %     | 0.00
#   x1        |   10     |    50 %     | 0.50
#   x2        |    2     |    10 %     | 0.20
#   x5        |    1     |     5 %     | 0.25
#   ----------+----------+-------------+------------
#   итого     |   20     |   100 %     | 0.95  → RTP 95 %
#
# Секторы равные по геометрии (18° каждый), поэтому вероятности задаются
# количеством секторов, а не шириной дуги. Веса у всех секторов одинаковые (1),
# и колесо рисует ровно 18° на сектор.
#
# Одинаковые множители намеренно не стоят рядом (в том числе через границу
# 19 → 0): соседние секторы всегда разные, чтобы границы читались.
WHEEL_SECTORS = 20
WHEEL_SECTOR_DEGREES = 18
WHEEL_SEGMENTS = [0, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 5, 1, 0, 1, 0, 1, 0, 1]
WHEEL_WEIGHTS = [1] * WHEEL_SECTORS

# Для проверок и документации: ожидаемые вероятности (доли единицы).
WHEEL_CHANCES = {0: 0.35, 1: 0.50, 2: 0.10, 5: 0.05}

# Слоты: символы, выплата за три в ряд и вес.
SLOT_SYMBOLS = [
    {'id': 'v', 'icon': 'coin', 'name': 'V', 'm3': 12, 'w': 30, 'color': '#2ee6c8'},
    {'id': 'spark', 'icon': 'spark', 'name': 'Spark', 'm3': 23, 'w': 16, 'color': '#3b82f6'},
    {'id': 'dice', 'icon': 'dice', 'name': 'Dice', 'm3': 29, 'w': 14, 'color': '#a7b7ca'},
    {'id': 'star', 'icon': 'star', 'name': 'Star', 'm3': 35, 'w': 12, 'color': '#e8b64c'},
    {'id': 'gem', 'icon': 'gem', 'name': 'Gem', 'm3': 47, 'w': 8, 'color': '#8b5cf6'},
    {'id': 'wheel', 'icon': 'wheel', 'name': 'Wheel', 'm3': 53, 'w': 8, 'color': '#22c55e'},
    {'id': 'crown', 'icon': 'crown', 'name': 'Crown', 'm3': 70, 'w': 6, 'color': '#f59e0b'},
]
SLOT_TWO_PAY = 0.4
# Блоки стройки MiniCraft: id совпадает с блоком в движке игры, поэтому
# администратор может скрыть материал, не трогая код игры.
BUILD_BLOCKS = [
    {'id': 1, 'ru': 'Трава', 'en': 'Grass'},
    {'id': 2, 'ru': 'Земля', 'en': 'Dirt'},
    {'id': 3, 'ru': 'Камень', 'en': 'Stone'},
    {'id': 4, 'ru': 'Песок', 'en': 'Sand'},
    {'id': 5, 'ru': 'Дерево', 'en': 'Wood'},
    {'id': 6, 'ru': 'Листва', 'en': 'Leaves'},
    {'id': 9, 'ru': 'Кирпич', 'en': 'Stone brick'},
    {'id': 10, 'ru': 'Булыжник', 'en': 'Cobblestone'},
    {'id': 11, 'ru': 'Тёмные доски', 'en': 'Dark planks'},
    {'id': 12, 'ru': 'Доски', 'en': 'Planks'},
    {'id': 13, 'ru': 'Черепица', 'en': 'Roof tiles'},
    {'id': 14, 'ru': 'Штукатурка', 'en': 'Plaster'},
    {'id': 15, 'ru': 'Стекло', 'en': 'Glass'},
    {'id': 16, 'ru': 'Сланец', 'en': 'Slate'},
]
BUILD_BLOCK_IDS = [row['id'] for row in BUILD_BLOCKS]


CASINO_STAKES = [5, 10, 20, 25, 50, 100]


def wheel_probabilities() -> list[dict]:
    """Вероятности по множителям, а не по секторам.

    Секторов 20 (по 18°), но множители повторяются, поэтому в таблице для
    игрока — одна строка на множитель: сколько секторов, какая вероятность и
    какой вклад в RTP.
    """
    total = sum(WHEEL_WEIGHTS)
    rows: dict = {}
    order: list = []
    for mult, weight in zip(WHEEL_SEGMENTS, WHEEL_WEIGHTS):
        if mult not in rows:
            rows[mult] = {'multiplier': mult, 'weight': 0, 'sectors': 0,
                          'chance': 0.0, 'rtp': 0.0}
            order.append(mult)
        rows[mult]['weight'] += weight
        rows[mult]['sectors'] += 1
    for mult in order:
        rows[mult]['chance'] = round(rows[mult]['weight'] / total, 6)
        rows[mult]['rtp'] = round(rows[mult]['chance'] * mult, 6)
    return [rows[mult] for mult in order]


def wheel_rtp() -> float:
    return round(sum(item['rtp'] for item in wheel_probabilities()), 4)


def slot_probabilities() -> list[dict]:
    total = sum(s['w'] for s in SLOT_SYMBOLS)
    rows, rtp = [], 0.0
    for s in SLOT_SYMBOLS:
        p = s['w'] / total
        chance = p ** 3
        rows.append({'symbol': s['id'], 'chance': round(chance, 6),
                     'payout': s['m3'], 'rtp': round(chance * s['m3'], 6)})
        rtp += chance * s['m3']
    pair = sum(3 * (s['w'] / total) ** 2 * (1 - s['w'] / total) * SLOT_TWO_PAY for s in SLOT_SYMBOLS)
    rows.append({'symbol': 'pair', 'chance': None, 'payout': SLOT_TWO_PAY,
                 'rtp': round(pair, 6)})
    rtp += pair
    return rows


def slot_rtp() -> float:
    return round(slot_rtp_value(), 4)


def slot_rtp_value() -> float:
    total = sum(s['w'] for s in SLOT_SYMBOLS)
    three = sum((s['w'] / total) ** 3 * s['m3'] for s in SLOT_SYMBOLS)
    pair = sum(3 * (s['w'] / total) ** 2 * (1 - s['w'] / total) * SLOT_TWO_PAY for s in SLOT_SYMBOLS)
    return three + pair


def casino_rules() -> dict:
    return {
        'stakes': CASINO_STAKES,
        'wheel': {'segments': WHEEL_SEGMENTS, 'weights': WHEEL_WEIGHTS,
                  'sectors': WHEEL_SECTORS, 'sectorDegrees': WHEEL_SECTOR_DEGREES,
                  'probabilities': wheel_probabilities(), 'rtp': wheel_rtp()},
        'slots': {'symbols': SLOT_SYMBOLS, 'two_pay': SLOT_TWO_PAY,
                  'probabilities': slot_probabilities(), 'rtp': slot_rtp()},
    }
