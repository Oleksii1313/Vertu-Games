"""Литовские переводы разметки (литовский — третий язык сайта).

Ключи — те же русские строки, что и в ``UI_EN``. Словарь не обязан быть
полным: если литовского текста нет, страница показывает английский вариант,
а не русскую строку посреди литовского интерфейса. Сборка страниц зовёт
``translate_lt`` из ``markup.py`` и вешает результат в ``data-lt``.
"""

UI_LT = {
    "Сезон «Неон» · серверная экономика": "Sezonas „Neon“ · serverio ekonomika",
    "Играй. Побеждай.": "Žaisk. Laimėk.",
    "Копи": "Kaupk",
    "V-монеты": "V monetos",
    "Каталог игр": "Žaidimų katalogas",
    "Открыть казино": "Atidaryti kazino",
    "игр": "žaidimai",
    "игроков": "žaidėjai",
    "V в обороте": "V apyvartoje",
    "запусков": "paleidimai",
    "Рекомендуем": "Rekomenduojame",
    "Выбор платформы": "Platformos pasirinkimas",
    "Все игры": "Visi žaidimai",
    "Играть": "Žaisti",
    "Играть": "Žaisti",
    "Каталог": "Katalogas",
    "Популярные игры": "Populiariausi žaidimai",
    "Смотреть все": "Žiūrėti viską",
    "Аркады": "Arkos",
    "Головоломки": "Galvosūkiai",
    "Экшен": "Veiksmas",
    "Аркады": "Arkos",
    "Шутеры": "Šaudyklės",
    "Аркады": "Arkos",
    "Песочницы": "Smėlio dėžės",
    "Аркады": "Arkos",
    "Полёты": "Skrydžiai",
    "Приключения": "Nuotykiai",
    "Лидеры": "Lyderiai",
    "Лучшие игроки": "Geriausi žaidėjai",
    "Активность": "Aktyvumas",
    "Последние достижения": "Naujausi pasiekimai",
    "Экономика": "Ekonomika",
    "Как это работает": "Kaip tai veikia",
    "Играйте": "Žaiskite",
    "Крутите": "Sukite",
    "Покупайте": "Pirkite",
    "Открыть магазин": "Atidaryti parduotuvę",
    "Готовы забрать первый бонус?": "Pasirengę pasiimti pirmą premiją?",
    "Создать аккаунт": "Sukurti paskyrą",
    "Правила казино": "Kazino taisyklės",
    "Только для развлечения": "Tik pramogai",
    "Платформа": "Platforma",
    "Главная": "Pradžia",
    "Каталог игр": "Žaidimų katalogas",
    "Главная — Vert Games": "Pradžia — Vert Games",
    "Каталог игр — Vert Games": "Žaidimų katalogas — Vert Games",
    "Магазин — Vert Games": "Parduotuvė — Vert Games",
    "Казино — Vert Games": "Kazino — Vert Games",
    "Рулетка Vert — Vert Games": "Vert ruletė — Vert Games",
    "Профиль — Vert Games": "Profilis — Vert Games",
    "Вход и регистрация — Vert Games": "Prisijungimas ir registracija — Vert Games",
    "Админ-панель — Vert Games": "Administravimas — Vert Games",
    "О проекте — Vert Games": "Apie projektą — Vert Games",
    "Поддержка — Vert Games": "Pagalba — Vert Games",
    "API — Vert Games": "API — Vert Games",
    "Конфиденциальность — Vert Games": "Privatumas — Vert Games",
    # Профиль и админка
    "Задания": "Užduotys",
    "Ежедневные задания": "Kasdienės užduotys",
    "Прогресс обнуляется в 00:00 UTC. Награду выдаёт сервер.":
        "Pažanga atnaujinama 00:00 UTC. Atlygį išduoda serveris.",
    "Операции": "Operacijos",
    "Каждая операция — одна строка в transactions":
        "Kiekviena operacija – viena eilutė lentelėje transactions",
    "Ник игрока (пусто — все)": "Žaidėjo slapyvardis (tuščia – visi)",
    "Фильтр по нику": "Filtruoti pagal slapyvardį",
    "Предметы магазина": "Parduotuvės prekės",
    "Только косметика: аватары, цвета, титулы. Пакеты V не продаются.":
        "Tik kosmetika: avatarai, spalvos, titulai. V paketai neparduodami.",
    # Каталог: вводный абзац
    "10 игр: аркады, головоломки, шутеры, песочницы и полёты. Запуск из каталога сохраняет "
    "прогресс в аккаунте, а V-монеты начисляет сервер по опубликованным правилам.":
        "10 žaidimų: arkos, galvosūkiai, šaudyklės, smėlio dėžės ir skrydžiai. Paleidus iš "
        "katalogo, pažanga išsaugoma paskyroje, o V monetas serveris įskaito pagal "
        "paskelbtas taisykles.",
    "Все": "Visi",
}

# Каталог игр (жанры, названия, описания, управление) — отдельный словарь,
# чтобы те же переводы попадали и в catalog-data.js для модального окна.
from catalog_lt import CATALOG_LT  # noqa: E402

UI_LT.update(CATALOG_LT)
