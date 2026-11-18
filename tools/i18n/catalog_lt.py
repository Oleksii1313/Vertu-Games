"""Литовские переводы каталога игр: жанры, названия, описания и управление.

Ключи — русские строки из ``game_catalog.py``. Словарь используется дважды:

* ``ui_lt.py`` подмешивает его в общий словарь разметки, поэтому карточки игр
  на главной и в каталоге получают ``data-lt`` при сборке;
* ``build_platform.py`` кладёт переводы в ``catalog-data.js`` как поля
  ``*_lt`` — их читает модальное окно игры (длинное описание + правила).

Если перевода нет, интерфейс покажет английский текст, а не русскую строку
посреди литовской страницы.
"""

CATALOG_LT = {
    # жанры (чипы фильтра и подпись в карточке)
    "Аркады": "Arkos",
    "Популярное": "Populiarūs",
    "Головоломки": "Galvosūkiai",
    "Экшен": "Veiksmas",
    "Шутеры": "Šaudyklės",
    "Песочницы": "Smėlio dėžės",
    "Гонки": "Lenktynės",
    "Полёты": "Skrydžiai",
    "Приключения": "Nuotykiai",
    "Казино": "Kazino",
    "Удача": "Sėkmė",

    # названия, которые отличаются от латинских
    "Redline: Розыск": "Redline: Paieška",
    "Космокухня": "Kosmoku virtuvė",

    # Flappy Bird
    "Классическая аркада с птицей-путешественницей": "Klasikinė arkada su keliaujančiu paukščiu",
    "Нажимай на экран или пробел, чтобы взмахивать крыльями. Каждая пройденная труба "
    "приносит 2 V (лимит 400 V в сутки).":
        "Spausk ekraną arba tarpo klavišą, kad paukštis plasnotų. Kiekvienas įveiktas "
        "vamzdis duoda 2 V (400 V paros limitas).",
    "Классическая аркада с птицей-путешественницей. Нажимай на экран или пробел, чтобы "
    "взмахивать крыльями и лавировать между препятствиями.\n\nКаждая пройденная труба "
    "приносит очки и монеты. Собирай рекорды и не врезайся!":
        "Klasikinė arkada su keliaujančiu paukščiu. Spausk ekraną arba tarpo klavišą, kad "
        "paukštis plasnotų ir laviruotų tarp kliūčių.\n\nKiekvienas įveiktas vamzdis duoda "
        "taškų ir monetų. Rink rekordus ir neatsitrenk!",
    "Пробел / тап — взмах": "Tarpo klavišas / bakstelėjimas – plasnojimas",

    # 2048
    "Логическая головоломка с плитками": "Loginis galvosūkis su plytelėmis",
    "Двигай плитки стрелками или свайпами. Каждые 100 очков — 3 V (лимит 300 V в сутки).":
        "Stumk plyteles rodyklėmis arba braukimu. Kas 100 taškų – 3 V (300 V paros limitas).",
    "Логическая игра-головоломка. Сдвигай плитки стрелками или свайпами и объединяй "
    "одинаковые числа.\n\nСобери плитку 2048 и открой новые уровни!":
        "Loginis galvosūkis. Stumk plyteles rodyklėmis arba braukimu ir sujunk vienodus "
        "skaičius.\n\nSurink 2048 plytelę ir atrask naujus lygius!",
    "Стрелки / свайп — сдвиг поля": "Rodyklės / braukimas – lentos stūmimas",

    # Platformer
    "Бесконечный раннер по платформам": "Begalinis bėgimas platformomis",
    "Беги вправо, прыгай по платформам и уворачивайся. За каждые 500 метров — 5 V "
    "(лимит 400 V в сутки).":
        "Bėk į dešinę, šok per platformas ir venk kliūčių. Kas 500 metrų – 5 V "
        "(400 V paros limitas).",
    "Бесконечный раннер: беги направо, прыгай по платформам и уворачивайся от шипов."
    "\n\nДвойной прыжок и движущиеся платформы. Чем дальше бежишь — тем быстрее темп.":
        "Begalinis bėgimas: bėk į dešinę, šok per platformas ir venk spyglių.\n\nDvigubas "
        "šuolis ir judančios platformos. Kuo toliau bėgi, tuo greitesnis tempas.",
    "Стрелки / A, D — бег, пробел — прыжок":
        "Rodyklės / A, D – bėgimas, tarpo klavišas – šuolis",

    # Pong
    "Ретро-теннис с комбо": "Retro tenisas su kombo",
    "Отбивай мяч ракеткой. Каждое комбо из 5 отбитий — 2 V (лимит 300 V в сутки).":
        "Atmušk kamuolį raketėle. Kiekvienas 5 atmušimų kombo – 2 V (300 V paros limitas).",
    "Ретро-теннис. Отбивай мяч ракеткой, набирай комбо и не пропускай голы."
    "\n\nКаждые 5 очков повышают уровень — мяч ускоряется.":
        "Retro tenisas. Atmušk kamuolį raketėle, rink kombo ir nepraleisk įvarčių.\n\nKas "
        "5 taškai kelia lygį – kamuolys greitėja.",
    "Мышь / стрелки — ракетка": "Pelė / rodyklės – raketė",

    # Shooter
    "Космический шутер с волнами врагов": "Kosminė šaudyklė su priešų bangomis",
    "Сбивай врагов и проходи волны. Каждая волна — 5 V (лимит 500 V в сутки).":
        "Naikink priešus ir įveik bangas. Kiekviena banga – 5 V (500 V paros limitas).",
    "Космический шутер: управляй кораблём, сбивай врагов и уворачивайся от атак."
    "\n\nВолны идут одна за другой; собирай бонусы и наращивай комбо.":
        "Kosminė šaudyklė: valdyk laivą, naikink priešus ir venk atakų.\n\nBangos eina "
        "viena po kitos; rink premijas ir didink kombo.",
    "Стрелки / WASD — полёт, пробел — огонь":
        "Rodyklės / WASD – skrydis, tarpo klavišas – šūvis",

    # Snake
    "Легендарная змейка": "Legendaroji gyvatėlė",
    "Собирай яблоки и расти. Каждое яблоко — 1 V, каждые 5 яблок — ещё 5 V, редкое "
    "золотое яблоко — 10 V (лимит 300 V в сутки).":
        "Rink obuolius ir augk. Kiekvienas obuolys – 1 V, kas 5 obuoliai – dar 5 V, retas "
        "auksinis obuolys – 10 V (300 V paros limitas).",
    "Легендарная змейка в изумрудном стиле: чешуя, свечение и плавные повороты. Собирай "
    "яблоки, расти и не врезайся в себя.\n\nКроме обычных яблок на поле появляются редкие "
    "золотые (10 V) и изумруды — временный множитель ×2. Каждые 5 яблок — новый уровень "
    "скорости и новая арена с препятствиями.":
        "Legendaroji gyvatėlė smaragdų stiliumi: žvynai, švytėjimas ir sklandūs posūkiai. "
        "Rink obuolius, augk ir neatsitrenk į save.\n\nBe įprastų obuolių pasirodo reti "
        "auksiniai (10 V) ir smaragdai – laikinas ×2 daugiklis. Kas 5 obuoliai – naujas "
        "greičio lygis ir nauja arena su kliūtimis.",
    "Стрелки / WASD — направление, пробел — пауза":
        "Rodyklės / WASD – kryptis, tarpo klavišas – pauzė",

    # MiniCraft 3D
    "Деревни, жители и монстры в мире 256 × 256": "Kaimai, gyventojai ir pabaisos 256 × 256 pasaulyje",
    "Собирай зелёные V-монеты в деревнях, на фермах и в лесах: каждая монета — ровно 3 V "
    "(до 150 монет за сессию, лимит 450 V в сутки).":
        "Rink žalias V monetas kaimuose, fermose ir miškuose: kiekviena moneta duoda lygiai "
        "3 V (iki 150 monetų per sesiją, 450 V paros limitas).",
    "Зелёные озёра и реки с песчаными берегами, остров с кладом, деревянные и каменные "
    "мосты, причалы, сторожевые башни, мельница, рынок, небольшой замок, руины и пещеры. "
    "Шесть деревень с домами, дорогами, фермами, колодцами и заборами, дороги между "
    "поселениями, ели, берёзы, цветы, грибы и валуны. Дружелюбные жители с руками и "
    "походкой подсказывают дорогу к сундукам, а монстры трёх видов — зомби, скелеты и "
    "пауки — охраняют опасные окраины.\n\nКаждая зелёная монета V даёт ровно 3 V. Монеты "
    "лежат на дорогах, фермах, в лесах, у деревень и в опасных окраинах мира; сундуки "
    "открываются один раз за сессию. Каждую минуту врагов становится больше, а в конце — "
    "экран результатов с числом монет, V, побед, сундуков и временем.\n\nWASD — движение, "
    "ПКМ (зажать) — обзор, пробел — прыжок, ЛКМ — ломать / атаковать, короткий клик ПКМ — "
    "поставить блок, 1–6 — выбор блока. Раунд длится 3 минуты, Esc — пауза.":
        "Žali ežerai ir upės su smėlėtais krantais, sala su lobiu, mediniai ir akmeniniai "
        "tiltai, prieplaukos, sargybos bokštai, malūnas, turgus, nedidelė pilis, griuvėsiai "
        "ir olos. Šeši kaimai su namais, keliais, fermomis, šuliniais ir tvoromis, keliai "
        "tarp gyvenviečių, eglės, beržai, gėlės, grybai ir rieduliai. Draugiški gyventojai "
        "mosteli ranka ir nurodo kelią prie skrynių, o trijų rūšių pabaisos – zombiai, "
        "skeletai ir vorai – saugo pavojingus pakraščius.\n\nKiekviena žalia V moneta duoda "
        "lygiai 3 V. Monetos guli keliuose, fermose, miškuose, prie kaimų ir pavojinguose "
        "pasaulio pakraščiuose; skrynios atsidaro kartą per sesiją. Kas minutę priešų "
        "daugėja, o pabaigoje rodomas rezultatų ekranas su monetų, V, pergalių, skrynių "
        "skaičiumi ir laiku.\n\nWASD – judėjimas, dešinys pelės klavišas (laikyti) – "
        "apžvalga, tarpo klavišas – šuolis, kairys klavišas – laužyti / pulti, trumpas "
        "dešinio klavišo paspaudimas – pastatyti bloką, 1–6 – bloko pasirinkimas. Raundas "
        "trunka 3 minutes, Esc – pauzė.",
    "WASD · ПКМ — обзор · ЛКМ — действие · 1–6 — блок":
        "WASD · dešinys pelės klavišas – apžvalga · kairys – veiksmas · 1–6 – blokas",

    # Doodle Jump
    "Прыжки по платформам вверх": "Šuoliai platformomis aukštyn",
    "Прыгай всё выше. Каждые 100 метров — 2 V (лимит 400 V в сутки).":
        "Šok vis aukščiau. Kas 100 metrų – 2 V (400 V paros limitas).",
    "Прыгун отскакивает сам: направляй его стрелками или A/D, стреляй пробелом. Зелёные "
    "платформы надёжные, голубые двигаются, коричневые ломаются.\n\nНа телефоне — крупные "
    "кнопки движения и выстрела. Esc/P — пауза.":
        "Šokėjas atšoka pats: kreipk jį rodyklėmis arba A/D, šauk tarpo klavišu. Žalios "
        "platformos patikimos, mėlynos juda, rudos lūžta.\n\nTelefone – dideli judėjimo ir "
        "šūvio mygtukai. Esc/P – pauzė.",
    "Стрелки / A, D — движение, пробел — выстрел":
        "Rodyklės / A, D – judėjimas, tarpo klavišas – šūvis",

    # Redline
    "Городские гонки и погони": "Miesto lenktynės ir persekiojimai",
    "Гоночные кредиты Redline обмениваются на V-монеты: 1000 кредитов = 10 V (лимит 300 V "
    "в сутки).":
        "Redline lenktynių kreditai keičiami į V monetas: 1000 kreditų = 10 V (300 V paros "
        "limitas).",
    "Аркадные городские гонки: сеть из 18 дорожных участков, около 8,4 км, сюжетный "
    "пролог, 15 соперников, гараж и тюнинг, погони с шестью уровнями розыска.\n\nТелефон: "
    "джойстик — газ и руль, отдельные нитро, ручник и замедление. ПК: WASD, Shift, "
    "пробел, E, G — гараж, R — вернуть на дорогу.\n\nГоночные кредиты — отдельная "
    "экономика Redline, но обмен на V-монеты выполняется на сервере.":
        "Arkadinės miesto lenktynės: 18 kelių ruožų tinklas, apie 8,4 km, siužeto "
        "prologas, 15 varžovų, garažas ir tiuningas, persekiojimai su šešiais ieškojimo "
        "lygiais.\n\nTelefone: svirtis – dujos ir vairas, atskirai nitras, rankinis stabdys "
        "ir sulėtinimas. Kompiuteryje: WASD, Shift, tarpo klavišas, E, G – garažas, R – "
        "grįžti į kelią.\n\nLenktynių kreditai – atskira Redline ekonomika, bet keitimas į V "
        "monetas atliekamas serveryje.",
    "WASD / джойстик, Shift — нитро, пробел — ручник":
        "WASD / valdymo svirtis, Shift – nitras, tarpo klavišas – rankinis stabdys",

    # Sky-Isle Logistics
    "Доставка почты дроном между островами": "Pašto pristatymas dronu tarp salų",
    "Каждая доставка — 5 V (лимит 300 V в сутки).":
        "Kiekvienas pristatymas – 5 V (300 V paros limitas).",
    "Уютный парящий остров Аэро-Вилль и почтовый квадрокоптер. Забирайте посылки в зелёном "
    "круге у депо и доставляйте их в дома, обсерваторию и мастерскую.\n\nПлавная "
    "инерция, наклоны дрона, карта и высота от 1,5 до 20 метров. Ни таймеров, ни штрафов.":
        "Jauki skraidanti Aero-Ville sala ir pašto kvadrokopteris. Pasiimk siuntas žaliame "
        "rate prie depo ir pristatyk jas į namus, observatoriją bei dirbtuves.\n\nSklandi "
        "inercija, drono pasvyrimai, žemėlapis ir aukštis nuo 1,5 iki 20 metrų. Jokių "
        "laikmačių ar baudų.",
    "WASD — полёт, пробел / Shift — вверх, C — вниз":
        "WASD – skrydis, tarpo klavišas / Shift – aukštyn, C – žemyn",

    # Космокухня
    "Фудтрак-вездеход по дорогам Аурелии": "Visureigis maisto furgonas Aurelijos keliais",
    "Выполненные заказы приносят 6 V (лимит 300 V в сутки).":
        "Įvykdyti užsakymai duoda 6 V (300 V paros limitas).",
    "Космокухня: Дороги Аурелии. Леса четырёх биомов, десять деревень с рынками и "
    "огородами, жители и стоянки вдоль дорог. Путешествуй на уютном фудтраке-вездеходе, "
    "готовь заказы и исследуй мир.":
        "Kosmoku virtuvė: Aurelijos keliai. Keturių biomų miškai, dešimt kaimų su turgumis "
        "ir daržais, gyventojai ir stotelės prie kelių. Keliauk jaukiu maisto furgonu-"
        "visureigiu, gamink užsakymus ir tyrinėk pasaulį.",
    "WASD — движение, мышь — обзор, E — взаимодействие":
        "WASD – judėjimas, pelė – apžvalga, E – sąveika",
    # Рулетка казино (карточка в каталоге)
    "Рулетка Vert": "„Vert“ ruletė",
    "Испытай удачу и забери выигрыш до x5": "Išbandyk sėkmę ir laimėk iki x5",
    "Колесо фортуны Vert Games: 20 равных секторов по 18°, четыре множителя — x0, x1, x2 и "
    "x5, теоретический возврат 95 %.\n\nСтавка списывается до вращения, а выплата — это "
    "полная сумма: ставка × множитель. Результат, начисление и история считает сервер в "
    "одной транзакции; клиент только показывает присланный сектор.":
        "„Vert Games“ laimės ratas: 20 lygių 18° sektorių, keturi daugikliai – x0, x1, x2 ir "
        "x5, teorinė grąža 95 %.\n\nStatymas nurašomas prieš sukimą, o išmoka yra visa "
        "suma: statymas × daugiklis. Rezultatą, įskaitymą ir istoriją serveris skaičiuoja "
        "vienoje transakcijoje; klientas tik parodo gautą sektorių.",
    "Ставки: 5, 10, 20, 25, 50 и 100 V. Бесплатное вращение — 1 в сутки, платных — до 5 в "
    "сутки.":
        "Statymai: 5, 10, 20, 25, 50 ir 100 V. Nemokamas sukimas – 1 per parą, mokamų – iki "
        "5 per parą.",
}
