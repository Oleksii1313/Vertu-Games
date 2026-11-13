#!/usr/bin/env python3
"""Сборщик страниц Vertu Games.

Все страницы собираются из одного шаблона, поэтому шапка, подвал, дизайн-система и
скрипты всегда согласованы. Данные (игры, магазин, достижения, правила казино)
берутся из ``game_catalog.py``.

    python3 tools/build_platform.py          # пересобрать страницы
    python3 tools/build_platform.py --check  # проверить, что страницы совпадают с генератором

Сгенерированные файлы: index.html, top.html, shop.html, casino.html, roulette.html,
profile.html, login.html, admin.html, about.html, support.html, api.html,
privacy.html, assets/vg/js/catalog-data.js.
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools' / 'i18n'))

from markup import localize as localize_markup  # noqa: E402

from game_catalog import (ACHIEVEMENTS, CASINO_STAKES, GAMES, SHOP_ITEMS,  # noqa: E402
                          visible_games,
                          casino_rules)

def games_count_ru() -> str:
    # 10 игр / 11 игр / 12 игр - простая русская плюрализация
    n = len(visible_games())
    if n % 10 == 1 and n % 100 != 11:
        return f'{n} игра'
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return f'{n} игры'
    return f'{n} игр'



E = lambda value: html.escape(str(value), quote=True)  # noqa: E731


# --------------------------------------------------------------------------- #  shell
def head(title: str, description: str, page: str, extra_css: str = '') -> str:
    return f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#07080c">
<meta name="description" content="{E(description)}">
<title>{E(title)} — Vertu Games</title>
<link rel="icon" href="coin.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Montserrat:wght@700;800;900&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="assets/vg/css/platform.css">
{extra_css}
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
</head>
<body data-page="{E(page)}">'''


def header(page: str) -> str:
    return f'<header class="site-header" data-page="{E(page)}"></header>'


def footer() -> str:
    return '''<footer class="site-footer">
  <div class="wrap">
    <div class="footer-inner">
      <div style="max-width:320px">
        <div class="brand"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x=".5" y=".5" width="39" height="39" rx="11" fill="#111425"/><path d="M11 13 20 28 29 13h-5l-4 7-4-7h-5Z" fill="#C6FF3D"/><circle cx="20" cy="9.5" r="2.1" fill="#C6FF3D"/></svg><span>VERT<b>GAMES</b></span></div>
        <p class="muted" style="font-size:13px;margin-top:10px">Социальное казино и аркады. Только виртуальные V-монеты: без реальных ставок, покупок монет «на вывод» и денежных выигрышей.</p>
        <div style="display:flex;gap:8px;align-items:center;margin-top:14px"><span class="age" aria-label="18+">18+</span><span class="muted" style="font-size:11.5px">Только для развлечения</span></div>
      </div>
      <div class="footer-col">
        <h5>Платформа</h5>
        <a href="index.html">Главная</a>
        <a href="top.html">Каталог игр</a>
        <a href="casino.html">Казино</a>
        <a href="roulette.html">Рулетка</a>
        <a href="shop.html">Магазин</a>
      </div>
      <div class="footer-col">
        <h5>Аккаунт</h5>
        <a href="profile.html">Профиль</a>
        <a href="login.html?tab=login">Вход</a>
        <a href="login.html?tab=register">Регистрация</a>
        <a href="profile.html#security">Смена пароля</a>
      </div>
      <div class="footer-col">
        <h5>Помощь</h5>
        <a href="about.html">О проекте</a>
        <a href="support.html">Поддержка</a>
        <a href="api.html">API</a>
        <a href="privacy.html">Конфиденциальность</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Vertu Games · Все права защищены</span>
      <span>V-монеты не имеют денежной стоимости и не подлежат обмену</span>
    </div>
  </div>
</footer>'''


def scripts(extra: str = '') -> str:
    return ('<script src="assets/vg/js/catalog-data.js"></script>\n'
            '<script src="assets/vg/js/platform.js"></script>\n'
            '<script src="assets/vg/js/sfx.js"></script>\n'
            f'{extra}\n</body>\n</html>')


def game_card(game: dict, index: int, compact: bool = False) -> str:
    tag = game['tag']
    badge_class = {'NEW': 'badge-new', 'HOT': 'badge-hot'}.get(tag, 'badge-line')
    short = game['desc'] if compact else game['desc']
    return f'''<article class="game-card" data-game="{E(game['id'])}" data-cats="{E('|'.join(game['cat']))}" tabindex="0" role="button" aria-label="{E(game['name'])}">
  <div class="game-cover cover-{index % 8}">
    <div class="tags"><span class="badge {badge_class}">{E(tag)}</span></div>
    <span class="reward"><span data-ico="coin"></span>+{game['reward']} V</span>
    <span class="art" data-ico="{E(game['icon'])}" data-size="64"></span>
  </div>
  <div class="game-body">
    <h3>{E(game['name'])}</h3>
    <p>{E(short)}</p>
    <div class="foot"><span>{E(game['cat'][0])}</span><span>до {game['daily']} V/сутки</span></div>
  </div>
</article>'''


# --------------------------------------------------------------------------- #  index
def build_index() -> str:
    cards = '\n'.join(game_card(g, i) for i, g in enumerate(visible_games()))
    featured = visible_games()[:2]
    featured_html = ''.join(
        f'''<a class="feature" href="#" data-game="{E(g['id'])}">
  <div class="feature-art cover-{i % 8}"><span data-ico="{E(g['icon'])}" data-size="72"></span></div>
  <div class="feature-body"><span class="badge badge-new">NEW</span><h3>{E(g['name'])}</h3><p>{E(g['desc'])}</p>
  <span class="btn btn-sm btn-ghost">Играть {VG_ARROW}</span></div>
</a>''' for i, g in enumerate(featured))
    return f'''{head('Главная', 'Vertu Games — премиальная игровая платформа: {games_count_ru()}, социальное казино, магазин и серверный баланс V-монет.', 'home')}
{header('home')}
<main class="wrap">
  <section class="hero">
    <div class="hero-inner">
      <div>
        <span class="eyebrow"><span data-ico="spark"></span> Сезон «Неон» · серверная экономика</span>
        <h1>Играй. Побеждай.<br>Копи <span class="grad">V-монеты</span>.</h1>
        <p class="lead">Один аккаунт, один серверный баланс и один вкус на всех страницах: аркады, 3D-приключения,
          социальное казино и магазин призов. Монеты начисляются за игру и тратятся внутри платформы.</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="top.html"><span data-ico="gamepad"></span> Каталог игр</a>
          <a class="btn btn-lime btn-lg" href="casino.html"><span data-ico="wheel"></span> Открыть казино</a>
        </div>
        <div class="hero-stats">
          <div><b data-stat="games">11</b><span>игр</span></div>
          <div><b data-stat="players">—</b><span>игроков</span></div>
          <div><b data-stat="coins">—</b><span>V в обороте</span></div>
          <div><b data-stat="plays">—</b><span>запусков</span></div>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-orb"></div>
        <div class="slot-preview">
          <div class="top"><span>Vert Slots · Neon</span><span>x70 max</span></div>
          <div class="reels" id="heroReels">
            <div class="reel-cell">V</div><div class="reel-cell">★</div><div class="reel-cell">♛</div>
          </div>
          <div class="foot"><span>RTP 90.5%</span><span>ставка 10 V</span></div>
          <div class="win-strip">Выигрыш +250 V</div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="featured">
    <div class="section-head"><div><span class="eyebrow">Рекомендуем</span><h2>Выбор платформы</h2></div>
      <a class="link" href="top.html">Все игры <span data-ico="chev"></span></a></div>
    <div class="grid grid-2">{featured_html}</div>
  </section>

  <section class="section">
    <div class="section-head"><div><span class="eyebrow">Каталог</span><h2>Популярные игры</h2>
      <p>Награды начисляет сервер: клиент не может добавить монеты сам.</p></div>
      <a class="link" href="top.html">Смотреть все <span data-ico="chev"></span></a></div>
    <div class="toolbar">
      <label class="search"><span data-ico="search"></span>
        <input type="search" id="gameSearch" placeholder="Поиск игр" aria-label="Поиск игр" autocomplete="off"></label>
      <div class="chips" id="catChips"></div>
    </div>
    <div class="game-grid" id="gameGrid">{cards}</div>
    <div class="empty hidden" id="gameEmpty">Ничего не найдено. Попробуйте другой запрос.</div>
  </section>

  <section class="section">
    <div class="grid grid-3">
      <div class="card panel">
        <span class="eyebrow"><span data-ico="trophy"></span> Лидеры</span>
        <h2 style="font-size:19px;margin:10px 0 14px">Лучшие игроки</h2>
        <div class="board" id="leaderboard"><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div></div>
      </div>
      <div class="card panel">
        <span class="eyebrow"><span data-ico="spark"></span> Активность</span>
        <h2 style="font-size:19px;margin:10px 0 14px">Последние достижения</h2>
        <div class="board" id="achievements"><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div></div>
      </div>
      <div class="card panel">
        <span class="eyebrow"><span data-ico="coin"></span> Экономика</span>
        <h2 style="font-size:19px;margin:10px 0 14px">Как это работает</h2>
        <div class="list">
          <div class="list-row"><span class="ico" data-ico="gamepad"></span><span class="meta"><b>Играйте</b><small>Награды за события начисляет сервер</small></span></div>
          <div class="list-row"><span class="ico" data-ico="wheel"></span><span class="meta"><b>Крутите</b><small>Колесо и слоты считаются на сервере</small></span></div>
          <div class="list-row"><span class="ico" data-ico="bag"></span><span class="meta"><b>Покупайте</b><small>Аватары, цвета и титулы за V</small></span></div>
        </div>
        <a class="btn btn-ghost btn-block" style="margin-top:14px" href="shop.html">Открыть магазин</a>
      </div>
    </div>
  </section>

  <!-- Показывается только гостям: авторизованному игроку дублировать регистрацию незачем. -->
  <section class="section hidden" id="guestCta" data-guest-only="1">
    <div class="card panel" style="display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><h2 style="font-size:22px">Готовы забрать первый бонус?</h2>
        <p class="muted" style="margin:6px 0 0;font-size:13.5px">Регистрация по нику и паролю — без e-mail. Приветственный бонус начисляется на серверный баланс.</p></div>
      <div class="row" style="flex:0 0 auto"><a class="btn btn-primary" href="login.html?tab=register">Создать аккаунт</a>
        <a class="btn btn-ghost" href="casino.html">Правила казино</a></div>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/home.js"></script>')}'''


# --------------------------------------------------------------------------- #  top (catalog)
def build_catalog() -> str:
    cards = '\n'.join(game_card(g, i) for i, g in enumerate(visible_games()))
    return f'''{head('Каталог игр', 'Все игры Vertu Games: аркады, головоломки, гонки и 3D-приключения с серверными наградами V-монет.', 'catalog')}
{header('catalog')}
<main class="wrap">
  <section class="cat-hero">
    <span class="eyebrow"><span data-ico="grid"></span> Каталог</span>
    <h1 style="font-size:clamp(26px,3.6vw,42px);margin:10px 0 10px">Все игры платформы</h1>
    <p class="muted" style="max-width:70ch;margin:0">{games_count_ru()}: аркады, головоломки, шутеры, песочницы, гонки и полёты.
      Запуск из каталога сохраняет прогресс в аккаунте, а V-монеты начисляет сервер по опубликованным правилам.</p>
    <div class="toolbar" style="margin:22px 0 0">
      <label class="search"><span data-ico="search"></span>
        <input type="search" id="gameSearch" placeholder="Поиск по названию или жанру" aria-label="Поиск игр" autocomplete="off"></label>
      <div class="chips" id="catChips"></div>
      <div class="chips" id="sortChips" style="margin-left:auto">
        <button class="chip on" data-sort="default">По умолчанию</button>
        <button class="chip" data-sort="reward">Больше V</button>
        <button class="chip" data-sort="name">А–Я</button>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="game-grid" id="gameGrid">{cards}</div>
    <div class="empty hidden" id="gameEmpty">Ничего не найдено.</div>
  </section>
</main>
{footer()}
<div class="play-overlay" id="playOverlay"></div>
{scripts('<script src="assets/vg/js/catalog.js"></script>')}'''


# --------------------------------------------------------------------------- #  shop
def build_shop() -> str:
    kinds = {
        'avatar': ('Аватары', 'Avatars'), 'color': ('Цвета профиля', 'Profile colors'),
        'title': ('Титулы', 'Titles'), 'boost': ('Пакеты V', 'V packs'),
    }
    blocks = []
    for kind, (ru, en) in kinds.items():
        items = [i for i in SHOP_ITEMS if i['kind'] == kind]
        cards = ''.join(
            f'''<div class="shop-item" data-item="{E(i['id'])}">
  <div class="preview" style="{"background:radial-gradient(circle at 50% 40%," + E(i['payload']) + "44,rgba(9,11,17,.9))" if i["kind"] == "color" else ""}">
    {'<span class="swatch" style="background:' + E(i['payload']) + '"></span>' if i['kind'] == 'color' else '<span data-ico="' + E(i['icon'] or ('bag' if i['kind'] == 'title' else 'coin')) + '" data-size="44"></span>'}
  </div>
  <h4>{E(i['name_ru'])}</h4>
  <div class="price">{'<span data-ico="coin"></span>' if i['price'] else ''} {str(i['price']) + ' V' if i['price'] else 'Бесплатно'}</div>
  <button class="btn btn-sm btn-primary btn-block" data-buy="{E(i['id'])}">{'Купить' if i['price'] else 'Получить'}</button>
</div>''' for i in items)
        blocks.append(f'''<div class="card panel" id="kind-{kind}">
  <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">{E(en)}</span><h2 style="font-size:20px">{E(ru)}</h2></div></div>
  <div class="shop-grid">{cards}</div>
</div>''')
    return f'''{head('Магазин', 'Магазин Vertu Games: аватары, цвета профиля, титулы и пакеты V-монет. Покупки на сервере.', 'shop')}
{header('shop')}
<main class="wrap">
  <section class="section" style="margin-top:24px">
    <div class="section-head">
      <div><span class="eyebrow"><span data-ico="bag"></span> Магазин</span>
        <h1 style="font-size:clamp(26px,3.4vw,38px);margin-top:8px">Призы за V-монеты</h1>
        <p>Все покупки выполняются на сервере: списание и предмет записываются в одной транзакции.</p></div>
      <div class="balance-pill" style="cursor:default"><span data-ico="coin"></span><span data-coins>0</span> V</div>
    </div>
    <div class="chips" style="margin-bottom:20px" id="shopTabs">
      <button class="chip on" data-jump="kind-avatar">Аватары</button>
      <button class="chip" data-jump="kind-color">Цвета</button>
      <button class="chip" data-jump="kind-title">Титулы</button>
      <button class="chip" data-jump="kind-boost">Пакеты V</button>
      <button class="chip" data-jump="kind-owned">Мои покупки</button>
    </div>
    <div class="stack" style="gap:18px" id="shopBody">{''.join(blocks)}
      <div class="card panel" id="kind-owned">
        <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">Inventory</span><h2 style="font-size:20px">Мои покупки</h2></div></div>
        <div id="ownedList"><div class="loading-row"><span class="spinner"></span> Загружаем покупки…</div></div>
      </div>
      <div class="card panel" id="kind-payments">
        <div class="section-head" style="margin-bottom:8px"><div><span class="eyebrow">V-коины</span><h2 style="font-size:20px">Покупка монет за деньги</h2></div></div>
        <p class="muted" style="font-size:13.5px;margin:0">V-монеты зарабатываются в играх и казино и не имеют денежной стоимости.
          Пакеты за реальные деньги отключены владельцем платформы и не влияют на игровой баланс.</p>
        <div class="msg" id="paymentsNote"></div>
      </div>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/shop.js"></script>')}'''


# --------------------------------------------------------------------------- #  casino
def build_casino() -> str:
    rules = casino_rules()
    wheel_rows = ''.join(
        f'<tr><td>x{row["multiplier"]:g}</td><td>{row["weight"]}</td><td>{row["chance"] * 100:.1f}%</td>'
        f'<td>{row["rtp"] * 100:.1f}%</td></tr>' for row in rules['wheel']['probabilities'])
    slot_rows = ''.join(
        f'<tr><td>{E(s["name"])}</td><td>x{s["m3"]}</td><td>{(s["w"] / sum(x["w"] for x in rules["slots"]["symbols"])) ** 3 * 100:.2f}%</td></tr>'
        for s in rules['slots']['symbols'])
    stakes = ''.join(f'<button class="stake{" on" if s == 25 else ""}" data-stake="{s}">{s} V</button>' for s in CASINO_STAKES)
    return f'''{head('Казино', 'Социальное казино Vertu Games: слоты и колесо фортуны на виртуальные V-монеты. Вся логика и выплаты — на сервере.', 'casino')}
{header('casino')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="section-head">
      <div><span class="eyebrow"><span data-ico="wheel"></span> Vertu Casino</span>
        <h1 style="font-size:clamp(26px,3.4vw,40px);margin-top:8px">Социальное казино</h1>
        <p>Только виртуальные V-монеты. Результаты, ставки и выплаты рассчитывает сервер.</p></div>
      <div class="balance-pill" style="cursor:default"><span data-ico="coin"></span><span data-coins>0</span> V</div>
    </div>
    <div class="casino-tabs" id="casinoTabs" role="tablist">
      <button class="on" data-tab="slots" role="tab" aria-selected="true"><span data-ico="dice"></span> Слоты</button>
      <button data-tab="wheel" role="tab" aria-selected="false"><span data-ico="wheel"></span> Колесо</button>
      <button data-tab="history" role="tab" aria-selected="false"><span data-ico="clock"></span> История</button>
      <button data-tab="rules" role="tab" aria-selected="false"><span data-ico="info"></span> Правила</button>
    </div>

    <div class="casino-layout" style="margin-top:18px">
      <div class="card machine">
        <div id="panel-slots">
          <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">3 барабана</span><h2 style="font-size:20px">Vert Slots · Neon</h2></div>
            <span class="badge badge-line">RTP {rules['slots']['rtp'] * 100:.1f}%</span></div>
          <div class="slot-window">
            <div class="slot-grid">
              <div class="slot-cell" data-cell="0"><span class="sym" data-ico="coin" data-size="56"></span></div>
              <div class="slot-cell" data-cell="1"><span class="sym" data-ico="star" data-size="56"></span></div>
              <div class="slot-cell" data-cell="2"><span class="sym" data-ico="crown" data-size="56"></span></div>
            </div>
          </div>
          <div class="stake-row" id="stakeRow">{stakes}</div>
          <div class="machine-foot">
            <button class="btn btn-primary spin-btn" id="spinSlots"><span data-ico="spark"></span> Крутить слоты</button>
            <span class="potential">Возможный выигрыш: до <b id="slotMax">1 750 V</b> (x70)</span>
          </div>
          <div class="result-banner" id="slotResult">Выберите ставку и запустите барабаны</div>
        </div>

        <div id="panel-wheel" class="hidden">
          <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">Колесо фортуны</span><h2 style="font-size:20px">Roulette Wheel</h2></div>
            <span class="badge badge-line">RTP {rules['wheel']['rtp'] * 100:.1f}%</span></div>
          <div class="wheel-stage">
            <div class="wheel-pointer"></div>
            <canvas id="wheelCanvas" width="720" height="720" role="img" aria-label="Колесо фортуны"></canvas>
          </div>
          <div class="stake-row" id="wheelStakes">{stakes}</div>
          <div class="machine-foot">
            <button class="btn btn-primary spin-btn" id="spinWheel"><span data-ico="wheel"></span> Крутить колесо</button>
            <div class="wheel-limits" id="wheelLimits" role="status" aria-live="polite">Бесплатно: 1/1 · Платных: 5/5</div>
            <span class="potential">Секторы: x5, x3, x2, x1, x0.5, x0.25, x0 · <b id="freeSpinNote"></b></span>
          </div>
          <div class="result-banner" id="wheelResult">Крутите колесо — результат придёт с сервера</div>
        </div>

        <div id="panel-history" class="hidden">
          <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">Прозрачность</span><h2 style="font-size:20px">История ставок</h2></div></div>
          <div class="history-tabs" id="historyFilter">
            <button class="on" data-game="">Все</button><button data-game="slots">Слоты</button><button data-game="wheel">Колесо</button>
          </div>
          <div id="historyBody"><div class="loading-row"><span class="spinner"></span> Загружаем историю…</div></div>
        </div>

        <div id="panel-rules" class="hidden">
          <div class="section-head" style="margin-bottom:14px"><div><span class="eyebrow">Честность</span><h2 style="font-size:20px">Правила и вероятности</h2></div></div>
          <p class="muted" style="font-size:13px">Все результаты генерируются на сервере криптографическим генератором случайных чисел.
            Ставка списывается до розыгрыша, выигрыш начисляется в той же транзакции. Клиент не может повлиять на результат.</p>
          <h4 style="margin:16px 0 8px;font-size:15px">Слоты: выплаты за три в ряд</h4>
          <div class="table-wrap"><table><thead><tr><th>Символ</th><th>Множитель</th><th>Вероятность</th></tr></thead>
            <tbody>{slot_rows}<tr><td>Пара</td><td>x{rules['slots']['two_pay']}</td><td>—</td></tr></tbody></table></div>
          <p class="muted" style="font-size:12px;margin-top:8px">Возврат игроку (RTP) слотов: {rules['slots']['rtp'] * 100:.1f}%. Дисперсия высокая: выигрыш не гарантирован.</p>
          <h4 style="margin:16px 0 8px;font-size:15px">Колесо: секторы и вероятности</h4>
          <div class="table-wrap"><table><thead><tr><th>Множитель</th><th>Вес</th><th>Вероятность</th><th>Вклад в RTP</th></tr></thead>
            <tbody>{wheel_rows}</tbody></table></div>
          <p class="muted" style="font-size:12px;margin-top:8px">RTP колеса: {rules['wheel']['rtp'] * 100:.1f}%. В сутки доступно одно бесплатное вращение и до пяти платных; лимит сбрасывается в 00:00 UTC.</p>
          <div class="divider"></div>
          <h4 style="margin:0 0 8px;font-size:15px">Ограничения</h4>
          <p class="muted" style="font-size:13px">Ставки: от {CASINO_STAKES[0]} до {CASINO_STAKES[-1]} V. Доступен дневной лимит ставок и добровольное
            самоисключение. V-монеты не покупаются «на вывод» и не обмениваются на деньги.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btn-ghost btn-sm" data-limits="open">Настроить ограничения</button>
            <a class="btn btn-ghost btn-sm" href="roulette.html">Классическая рулетка</a>
          </div>
        </div>
      </div>

      <aside class="stack" style="gap:16px">
        <div class="card panel">
          <h3 style="font-size:16px;margin-bottom:12px">Ваш прогресс</h3>
          <div class="stat-grid" style="grid-template-columns:1fr 1fr">
            <div class="stat-card coins"><span>Баланс</span><b data-stat="balance">—</b></div>
            <div class="stat-card"><span>Ставок</span><b data-stat="bets">—</b></div>
            <div class="stat-card"><span>Всего ставок на</span><b data-stat="staked">—</b></div>
            <div class="stat-card"><span>Лучший выигрыш</span><b data-stat="best">—</b></div>
          </div>
          <div class="divider"></div>
          <div class="list" id="limitsInfo">
            <div class="list-row"><span class="ico" data-ico="shield"></span><span class="meta"><b>Добровольные ограничения</b><small id="limitText">Не заданы</small></span></div>
          </div>
          <button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px" data-limits="open">Ограничить игру</button>
        </div>
        <div class="card panel">
          <h3 style="font-size:16px;margin-bottom:10px">Честная игра</h3>
          <div class="list">
            <div class="list-row"><span class="ico" data-ico="check"></span><span class="meta"><b>Серверный RNG</b><small>результат генерирует сервер, не браузер</small></span></div>
            <div class="list-row"><span class="ico" data-ico="lock"></span><span class="meta"><b>Атомарные ставки</b><small>списание и выигрыш в одной транзакции</small></span></div>
            <div class="list-row"><span class="ico" data-ico="info"></span><span class="meta"><b>Опубликованные шансы</b><small>вероятности и RTP открыты</small></span></div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</main>
{footer()}
<div class="modal" id="limitsModal"><div class="panel card">
  <button class="close" data-close-limits aria-label="Закрыть">×</button>
  <h2 style="font-size:20px;margin-bottom:6px">Ограничения игры</h2>
  <p class="muted" style="font-size:13px">Дневной лимит ставок и самоисключение применяются на сервере и не могут быть обойдены из браузера.</p>
  <label class="field"><span>Дневной лимит ставок, V (0 — без лимита)</span>
    <input type="number" id="dailyLimit" min="0" max="100000" step="50" value="0"></label>
  <label class="field"><span>Самоисключение</span>
    <select id="excludeSelect">
      <option value="0">Не ограничивать</option>
      <option value="60">1 час</option>
      <option value="1440">1 день</option>
      <option value="10080">7 дней</option>
      <option value="43200">30 дней</option>
    </select></label>
  <div class="row"><button class="btn btn-primary" id="saveLimits">Сохранить</button>
    <button class="btn btn-ghost" data-close-limits>Отмена</button></div>
  <p class="msg" id="limitsMsg" role="status"></p>
</div></div>
{scripts('<script src="assets/vg/js/casino.js"></script>')}'''


# --------------------------------------------------------------------------- #  roulette
def build_roulette() -> str:
    return f'''{head('Рулетка', 'Колесо фортуны Vertu Games: бесплатный спин каждый день и честные серверные вероятности.', 'roulette')}
{header('roulette')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="section-head">
      <div><span class="eyebrow"><span data-ico="wheel"></span> Колесо фортуны</span>
        <h1 style="font-size:clamp(26px,3.4vw,40px);margin-top:8px">Рулетка Vertu</h1>
        <p>Один бесплатный спин и не больше пяти платных в сутки. Дальше колесо ждёт полуночи UTC. Результат считает сервер.</p></div>
      <div class="balance-pill" style="cursor:default"><span data-ico="coin"></span><span data-coins>0</span> V</div>
    </div>
    <div class="casino-layout">
      <div class="card machine">
        <div class="wheel-stage"><div class="wheel-pointer"></div>
          <canvas id="wheelCanvas" width="720" height="720" role="img" aria-label="Колесо фортуны"></canvas></div>
        <div class="stake-row" id="wheelStakes">{''.join(f'<button class="stake{" on" if s == 20 else ""}" data-stake="{s}">{s} V</button>' for s in CASINO_STAKES)}</div>
        <div class="machine-foot">
          <button class="btn btn-primary spin-btn" id="spinWheel"><span data-ico="wheel"></span> Крутить</button>
          <label class="checkbox" style="flex:1"><input type="checkbox" id="useFree" checked>
            <span>Использовать бесплатный спин, если доступен</span></label>
        </div>
        <div class="wheel-limits" id="wheelLimits" role="status" aria-live="polite">Бесплатно: 1/1 · Платных: 5/5</div>
        <div class="result-banner" id="wheelResult">Готово к вращению</div>
      </div>
      <aside class="stack" style="gap:16px">
        <div class="card panel">
          <h3 style="font-size:16px;margin-bottom:10px">Множители</h3>
          <div class="table-wrap"><table><thead><tr><th>Сектор</th><th>Шанс</th></tr></thead><tbody>
            {''.join(f'<tr><td>x{r["multiplier"]:g}</td><td>{r["chance"] * 100:.1f}%</td></tr>' for r in casino_rules()['wheel']['probabilities'])}
          </tbody></table></div>
          <p class="muted" style="font-size:12px;margin-top:10px">RTP колеса: {casino_rules()['wheel']['rtp'] * 100:.1f}%.
            Ставка списывается до вращения, выигрыш начисляется сразу после.</p>
        </div>
        <div class="card panel">
          <h3 style="font-size:16px;margin-bottom:10px">Личная статистика</h3>
          <div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">
            <div class="stat-card"><span>Вращений</span><b id="wheelSpins">0</b></div>
            <div class="stat-card"><span>Итог</span><b id="wheelNet">0 V</b></div>
          </div>
          <p class="muted" style="font-size:12px;margin-top:10px">Виртуальные V-монеты. Реальные деньги не используются.</p>
        </div>
        <div class="card panel">
          <h3 style="font-size:16px;margin-bottom:10px">Последние вращения</h3>
          <div id="wheelHistory"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
        </div>
      </aside>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/roulette.js"></script>')}'''


# --------------------------------------------------------------------------- #  profile
def build_profile() -> str:
    return f'''{head('Профиль', 'Профиль игрока Vertu Games: баланс, статистика, достижения, история операций и настройки аккаунта.', 'profile')}
{header('profile')}
<main class="wrap">
  <section class="section" style="margin-top:22px" id="profileRoot">
    <div class="card">
      <div class="loading-row" style="padding:28px"><span class="spinner"></span> Загружаем профиль…</div>
    </div>
  </section>

  <section class="section hidden" id="guestBlock">
    <div class="card panel center">
      <h2 style="font-size:24px;margin-bottom:8px">Войдите в аккаунт</h2>
      <p class="muted">Профиль, баланс, достижения и история операций доступны после входа.</p>
      <div class="row" style="justify-content:center;margin-top:16px;flex:0 0 auto">
        <a class="btn btn-primary" href="login.html?tab=login">Войти</a>
        <a class="btn btn-ghost" href="login.html?tab=register">Создать аккаунт</a>
      </div>
    </div>
  </section>

  <section class="section hidden" id="profileBody">
    <div class="card">
      <div class="profile-hero">
        <div class="profile-avatar" id="profAvatar"></div>
        <div class="profile-id" style="flex:1;min-width:220px">
          <h1 id="profName">—</h1>
          <div class="profile-meta">
            <span>Уровень <b id="profLevel">1</b></span>
            <span>Регистрация: <b id="profCreated">—</b></span>
            <span>Игр сыграно: <b id="profPlays">0</b></span>
            <span id="profAdminBadge"></span>
          </div>
        </div>
        <div class="stack" style="flex:0 0 auto;min-width:200px">
          <div class="balance-pill" style="cursor:default"><span data-ico="coin"></span><span data-coins>0</span> V</div>
          <button class="btn btn-ghost btn-sm" id="editProfile">Изменить оформление</button>
        </div>
      </div>
    </div>

    <div class="stat-grid" style="margin-top:16px" id="profStats"></div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card panel">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">История</span><h2 style="font-size:19px">Операции с V</h2></div></div>
        <div id="ledgerBody"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
      </div>
      <div class="card panel">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">Достижения</span><h2 style="font-size:19px">Коллекция</h2></div></div>
        <div id="achBody"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card panel">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">Казино</span><h2 style="font-size:19px">Ставки и выигрыши</h2></div></div>
        <div id="casinoBody"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
      </div>
      <div class="card panel">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">Инвентарь</span><h2 style="font-size:19px">Купленные предметы</h2></div></div>
        <div id="itemsBody"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card panel" id="security">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">Безопасность</span><h2 style="font-size:19px">Смена пароля</h2></div></div>
        <form id="passwordForm">
          <label class="field"><span>Текущий пароль</span>
            <input type="password" name="current" autocomplete="current-password" required minlength="8"></label>
          <label class="field"><span>Новый пароль (8–128 символов)</span>
            <input type="password" name="password" autocomplete="new-password" required minlength="8"></label>
          <label class="field"><span>Повторите новый пароль</span>
            <input type="password" name="confirm" autocomplete="new-password" required minlength="8"></label>
          <button class="btn btn-primary" type="submit">Обновить пароль</button>
          <p class="msg" id="passwordMsg" role="status"></p>
        </form>
      </div>
      <div class="card panel">
        <div class="section-head" style="margin-bottom:12px"><div><span class="eyebrow">Настройки</span><h2 style="font-size:19px">Аккаунт</h2></div></div>
        <div class="list">
          <div class="list-row"><span class="ico" data-ico="user"></span><span class="meta"><b>Ник</b><small id="accName">—</small></span></div>
          <div class="list-row"><span class="ico" data-ico="coin"></span><span class="meta"><b>Баланс</b><small>хранится на сервере, доступен на всех устройствах</small></span></div>
          <div class="list-row"><span class="ico" data-ico="lock"></span><span class="meta"><b>Сессии</b><small>смена пароля закрывает все другие сессии</small></span></div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost" id="logoutBtn">Выйти из аккаунта</button>
          <a class="btn btn-ghost" href="shop.html">В магазин</a>
        </div>
      </div>
    </div>
  </section>
</main>
{footer()}
<div class="modal" id="styleModal"><div class="panel card">
  <button class="close" data-close-style aria-label="Закрыть">×</button>
  <h2 style="font-size:20px;margin-bottom:14px">Оформление профиля</h2>
  <div id="stylePicker"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
  <p class="msg" id="styleMsg" role="status"></p>
</div></div>
{scripts('<script src="assets/vg/js/profile.js"></script>')}'''


# --------------------------------------------------------------------------- #  login
def build_login() -> str:
    return f'''{head('Вход и регистрация', 'Регистрация по нику и паролю без e-mail, защищённая Cloudflare Turnstile. Сессии на сервере.', 'login')}
{header('login')}
<main class="auth-shell">
  <section class="auth-art">
    <div class="glow"></div>
    <div style="position:relative;z-index:2;max-width:520px">
      <span class="eyebrow"><span data-ico="spark"></span> Vertu Games</span>
      <h2 class="grad" style="margin:14px 0 0">Один аккаунт — вся платформа</h2>
      <ul>
        <li><span data-ico="check"></span><span>Регистрация по нику и паролю. E-mail не нужен, подтверждение почты не требуется.</span></li>
        <li><span data-ico="check"></span><span>Пароль хранится только как PBKDF2-хеш с солью (310 000 раундов).</span></li>
        <li><span data-ico="check"></span><span>Cloudflare Turnstile проверяется на сервере, плюс ограничение попыток входа.</span></li>
        <li><span data-ico="check"></span><span>Баланс, покупки и достижения хранятся в PostgreSQL и доступны на любом устройстве.</span></li>
      </ul>
    </div>
  </section>
  <section class="auth-form-wrap">
    <div class="card auth-card">
      <div class="tabs" role="tablist">
        <button id="tabLogin" class="on" data-tab="login" role="tab" aria-selected="true">Вход</button>
        <button id="tabRegister" data-tab="register" role="tab" aria-selected="false">Регистрация</button>
      </div>
      <form id="formLogin" novalidate>
        <h2 style="font-size:22px;margin-bottom:4px">С возвращением</h2>
        <p class="muted" style="font-size:13px;margin-bottom:16px">Введите ник и пароль своего аккаунта.</p>
        <label class="field"><span>Ник</span>
          <input type="text" name="username" autocomplete="username" required maxlength="24" placeholder="Ваш ник"></label>
        <label class="field"><span>Пароль</span>
          <input type="password" name="password" autocomplete="current-password" required maxlength="128" placeholder="••••••••"></label>
        <div class="captcha-slot" id="captchaLogin"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="loginSubmit">Войти</button>
        <p class="msg" id="loginMsg" role="status"></p>
        <p class="turnstile-note" id="captchaNote"></p>
      </form>
      <form id="formRegister" class="hidden" novalidate>
        <h2 style="font-size:22px;margin-bottom:4px">Создать аккаунт</h2>
        <p class="muted" style="font-size:13px;margin-bottom:16px">Ник и пароль. Приветственный бонус — 100 V на серверный баланс.</p>
        <label class="field"><span>Ник (3–24 символа)</span>
          <input type="text" name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="Например, NeoPlayer">
          <span class="hint" id="regHint"></span></label>
        <label class="field"><span>Пароль (8–128 символов)</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="128" placeholder="••••••••"></label>
        <label class="field"><span>Повторите пароль</span>
          <input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="128" placeholder="••••••••"></label>
        <label class="field hidden" aria-hidden="true"><span>Website</span>
          <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        <div class="captcha-slot" id="captchaRegister"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="registerSubmit">Зарегистрироваться</button>
        <p class="msg" id="registerMsg" role="status"></p>
        <p class="turnstile-note">Нажимая кнопку, вы подтверждаете, что вам 18+ и вы принимаете правила платформы.
          V-монеты не имеют денежной стоимости.</p>
      </form>
      <div class="divider"></div>
      <p class="muted" style="font-size:12px;margin:0">Забыли пароль? Восстановление по e-mail не используется.
        Обратитесь в <a href="support.html" style="color:var(--lime)">поддержку</a>.</p>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/login.js"></script>')}'''


# --------------------------------------------------------------------------- #  admin
def build_admin() -> str:
    return f'''{head('Админ-панель', 'Админ-панель Vertu Games: пользователи, балансы, статистика, игры и журнал действий.', 'admin',
                  '<style>.admin-grid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:start}.admin-side{position:sticky;top:calc(var(--header-h) + 16px)}.admin-side button{display:flex;align-items:center;gap:9px;width:100%;padding:10px 13px;border:0;border-radius:10px;background:transparent;color:var(--text-2);font-weight:700;font-size:13.5px;cursor:pointer;text-align:left}.admin-side button:hover{{background:rgba(255,255,255,.06)}}.admin-side button.on{{background:linear-gradient(120deg,rgba(139,92,246,.3),rgba(255,45,149,.18));color:#fff}}@media(max-width:900px){{.admin-grid{{grid-template-columns:1fr}}.admin-side{{position:static;display:grid;grid-template-columns:repeat(2,1fr);gap:6px}}.admin-side .divider{{display:none}}}}</style>')}
{header('admin')}
<main class="wrap">
  <section class="section" style="margin-top:22px" id="adminLock">
    <div class="card panel" style="max-width:440px;margin:40px auto">
      <div class="center" style="margin-bottom:18px">
        <div style="width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.35);margin:0 auto 14px">
          <span data-ico="shield" data-size="26"></span></div>
        <h1 style="font-size:24px">Админ-панель</h1>
        <p class="muted" style="font-size:13px;margin-top:6px">Права проверяются на сервере. Пароль администратора не хранится в браузере.</p>
      </div>
      <form id="adminForm">
        <label class="field"><span>Пароль администратора</span>
          <input type="password" name="password" autocomplete="current-password" required placeholder="••••••••"></label>
        <div class="captcha-slot" id="captchaAdmin"></div>
        <button class="btn btn-primary btn-block" type="submit" id="adminSubmit">Войти</button>
        <p class="msg" id="adminMsg" role="status"></p>
      </form>
    </div>
  </section>

  <section class="section hidden" style="margin-top:22px" id="adminApp">
    <div class="section-head">
      <div><span class="eyebrow"><span data-ico="shield"></span> Администрирование</span>
        <h1 style="font-size:clamp(22px,3vw,32px);margin-top:6px">Панель управления</h1></div>
      <button class="btn btn-ghost btn-sm" id="adminLogout">Выйти</button>
    </div>
    <div class="admin-grid">
      <nav class="card admin-side panel" style="padding:10px">
        <button class="on" data-view="overview"><span data-ico="chart"></span> Обзор</button>
        <button data-view="users"><span data-ico="user"></span> Пользователи</button>
        <button data-view="games"><span data-ico="gamepad"></span> Игры</button>
        <button data-view="casino"><span data-ico="wheel"></span> Казино</button>
        <button data-view="log"><span data-ico="clock"></span> Журнал</button>
        <div class="divider"></div>
        <a href="index.html" style="display:flex;align-items:center;gap:9px;padding:10px 13px;font-size:13px;color:var(--muted)"><span data-ico="chev"></span> На сайт</a>
      </nav>
      <div>
        <div id="view-overview">
          <div class="stat-grid" id="adminStats"></div>
          <div class="grid grid-2" style="margin-top:16px">
            <div class="card panel"><div class="section-head" style="margin-bottom:12px"><div><h2 style="font-size:18px">Топ по балансу</h2></div></div>
              <div id="adminTop"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div></div>
            <div class="card panel"><div class="section-head" style="margin-bottom:12px"><div><h2 style="font-size:18px">Последние действия</h2></div></div>
              <div id="adminRecent"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div></div>
          </div>
        </div>
        <div id="view-users" class="hidden">
          <div class="card panel">
            <div class="toolbar" style="margin-bottom:14px">
              <label class="search"><span data-ico="search"></span>
                <input type="search" id="userSearch" placeholder="Поиск по нику" aria-label="Поиск пользователей"></label>
              <button class="btn btn-sm btn-ghost" id="userRefresh">Обновить</button>
              <span class="muted" style="font-size:12px" id="userTotal"></span>
            </div>
            <div id="adminUsers"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
          </div>
          <div class="card panel hidden" id="userDetail" style="margin-top:16px"></div>
        </div>
        <div id="view-games" class="hidden">
          <div class="card panel"><div class="section-head" style="margin-bottom:12px"><div><h2 style="font-size:18px">Игры платформы</h2>
            <p class="muted" style="font-size:12.5px;margin:4px 0 0">Отключение скрывает награды за игру; файлы игр не удаляются.</p></div></div>
            <div id="adminGames"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div></div>
        </div>
        <div id="view-casino" class="hidden">
          <div class="card panel">
            <div class="section-head" style="margin-bottom:12px"><div><h2 style="font-size:18px">Настройки казино</h2></div></div>
            <div id="adminCasino"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div>
          </div>
        </div>
        <div id="view-log" class="hidden">
          <div class="card panel"><div class="section-head" style="margin-bottom:12px"><div><h2 style="font-size:18px">Журнал действий администраторов</h2></div></div>
            <div id="adminLog"><div class="loading-row"><span class="spinner"></span> Загрузка…</div></div></div>
        </div>
      </div>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/admin.js"></script>')}'''


# --------------------------------------------------------------------------- #  info pages
def build_about() -> str:
    return f'''{head('О проекте', 'Vertu Games — браузерная игровая платформа: {games_count_ru()}, социальное казино и серверная экономика V-монет.', 'about')}
{header('about')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="card panel">
      <span class="eyebrow"><span data-ico="info"></span> О проекте</span>
      <h1 style="font-size:clamp(26px,3.6vw,42px);margin:12px 0 14px">Верту Games — игровая платформа</h1>
      <p class="muted" style="max-width:78ch">Vertu Games — развивающийся браузерный игровой проект. Здесь собраны аркады,
        головоломки и полноценные 3D-приключения, а V-монеты зарабатываются и тратятся внутри платформы.
        Регистрация — только по нику и паролю; прогресс, баланс и покупки хранятся на сервере.</p>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card panel"><h2 style="font-size:18px;margin-bottom:8px">Один аккаунт</h2>
        <p class="muted" style="font-size:13.5px;margin:0">Ник, пароль и серверная сессия. E-mail не запрашивается, подтверждение почты
        не требуется. Пароль хранится как хеш PBKDF2-SHA256 с солью.</p></div>
      <div class="card panel"><h2 style="font-size:18px;margin-bottom:8px">Один баланс</h2>
        <p class="muted" style="font-size:13.5px;margin:0">V-монеты начисляются только сервером: за игровые события,
        достижения, магазин и казино. Суммы и суточные лимиты заданы на сервере.</p></div>
      <div class="card panel"><h2 style="font-size:18px;margin-bottom:8px">Только для развлечения</h2>
        <p class="muted" style="font-size:13.5px;margin:0">Казино использует исключительно виртуальные V-монеты.
        Нет реальных ставок, покупок монет «на вывод» и вывода выигрышей в деньги.</p></div>
      <div class="card panel"><h2 style="font-size:18px;margin-bottom:8px">Игры не меняются</h2>
        <p class="muted" style="font-size:13.5px;margin:0">Каждая игра — самостоятельный HTML-файл. Награды используют
        тот же контракт событий, что и раньше, но теперь подтверждаются сервером.</p></div>
    </div>
    <div class="card panel" style="margin-top:16px">
      <h2 style="font-size:18px;margin-bottom:10px">Состав платформы</h2>
      <div class="list">
        <div class="list-row"><span class="ico" data-ico="gamepad"></span><span class="meta"><b>{games_count_ru()}</b>
          <small>{', '.join(g['name'] for g in visible_games())}</small></span></div>
        <div class="list-row"><span class="ico" data-ico="wheel"></span><span class="meta"><b>Социальное казино</b>
          <small>слоты «Vert Slots», колесо фортуны, история ставок и добровольные лимиты</small></span></div>
        <div class="list-row"><span class="ico" data-ico="bag"></span><span class="meta"><b>Магазин</b>
          <small>аватары, цвета профиля, титулы и пакеты V за внутренние монеты</small></span></div>
        <div class="list-row"><span class="ico" data-ico="trophy"></span><span class="meta"><b>Достижения и топ</b>
          <small>серверные достижения с наградами и рейтинг игроков</small></span></div>
      </div>
      <div class="row" style="margin-top:16px"><a class="btn btn-primary" href="top.html">Открыть каталог</a>
        <a class="btn btn-ghost" href="support.html">Поддержка</a></div>
    </div>
  </section>
</main>
{footer()}
{scripts()}'''


def build_support() -> str:
    return f'''{head('Поддержка', 'Поддержка Vertu Games: ответы на вопросы об аккаунте, балансе, играх и казино.', 'support')}
{header('support')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="card panel">
      <span class="eyebrow"><span data-ico="info"></span> Поддержка</span>
      <h1 style="font-size:clamp(26px,3.4vw,40px);margin:12px 0 10px">Чем помочь?</h1>
      <p class="muted" style="max-width:76ch">Ответы на частые вопросы. Если нужного ответа нет — подготовьте отчёт об ошибке
        и передайте его владельцу платформы. Пароли и коды подтверждения никуда отправлять не нужно.</p>
      <div class="toolbar" style="margin-top:18px">
        <label class="search"><span data-ico="search"></span>
          <input type="search" id="faqSearch" placeholder="Поиск по вопросам" aria-label="Поиск по вопросам"></label>
      </div>
      <div id="faqList">
        {faq_html()}
      </div>
      <p class="empty hidden" id="faqEmpty">Ничего не найдено. Попробуйте другой запрос.</p>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card panel">
        <h2 style="font-size:18px;margin-bottom:10px">Проверка сервера</h2>
        <p class="muted" style="font-size:13px">Запрос только читает состояние API: аккаунт не создаётся, письма не отправляются.</p>
        <button class="btn btn-ghost" id="probeBtn">Проверить соединение</button>
        <p class="msg" id="probeMsg" role="status"></p>
      </div>
      <div class="card panel">
        <h2 style="font-size:18px;margin-bottom:10px">Что указать в обращении</h2>
        <div class="list">
          <div class="list-row"><span class="ico" data-ico="check"></span><span class="meta"><b>Ник и время</b><small>когда произошла проблема</small></span></div>
          <div class="list-row"><span class="ico" data-ico="check"></span><span class="meta"><b>Игра или раздел</b><small>например, казино → слоты</small></span></div>
          <div class="list-row"><span class="ico" data-ico="x"></span><span class="meta"><b>Без пароля</b><small>никогда не присылайте пароль или код</small></span></div>
        </div>
      </div>
    </div>
  </section>
</main>
{footer()}
{scripts('<script src="assets/vg/js/info.js"></script>')}'''


def faq_html() -> str:
    faq = [
        ('Как зарегистрироваться?', 'Нужны только ник и пароль (8–128 символов). E-mail не запрашивается, подтверждение почты не требуется. '
                                    'После регистрации вы сразу попадаете в аккаунт с приветственным бонусом 100 V.'),
        ('Почему не проходит капча?', 'Cloudflare Turnstile проверяется на сервере. Если виджет не загрузился, обновите страницу. '
                                       'При повторном использовании токена сервер отклонит запрос — просто обновите форму.'),
        ('Где хранится баланс?', 'В PostgreSQL на сервере. Браузер не хранит баланс: любые операции проходят через серверные API, '
                                 'каждая записывается в историю операций.'),
        ('Как заработать V-монеты?', 'За игровые события (у каждой игры свой размер награды и суточный лимит), за достижения, '
                                     'а также в казино. Все суммы определяет сервер.'),
        ('Почему казино не даёт стабильно выигрывать?', 'RTP слотов около 90.5%, колеса — около 84%. Математическое ожидание игры '
                                                        'отрицательное, это развлекательный режим без реальных денег.'),
        ('Можно ли вывести V-монеты в деньги?', 'Нет. V-монеты не имеют денежной стоимости, их нельзя купить «на вывод» или обменять на деньги.'),
        ('Забыл пароль — что делать?', 'Восстановления по e-mail нет, потому что e-mail не используется. Обратитесь к владельцу '
                                       'платформы: он может сменить пароль через админ-панель или CLI.'),
        ('Как сменить пароль?', 'Профиль → «Смена пароля». После смены все другие сессии закрываются автоматически.'),
        ('Почему достижение не начислилось?', 'Достижения выдаются сервером на определённых событиях. Обновите профиль через несколько секунд '
                                              'после действия.'),
        ('Игра не запускается', 'Для 3D-игр нужен современный браузер с WebGL. Попробуйте отдельную вкладку, отключите блокировщики '
                                'для этого домена и обновите страницу.'),
    ]
    return ''.join(f'<details><summary>{E(q)}</summary><div class="muted" style="padding:0 16px 14px;font-size:13px">{E(a)}</div></details>'
                   for q, a in faq)


def build_api() -> str:
    endpoints = [
        ('GET', '/api/session', 'Текущая сессия, пользователь, конфигурация капчи и каталог.'),
        ('POST', '/api/auth/register', 'Регистрация: {"username", "password", "turnstileToken", "startedAt"}.'),
        ('POST', '/api/auth/login', 'Вход: {"username", "password", "turnstileToken"}.'),
        ('POST', '/api/auth/logout', 'Выход и удаление сессии.'),
        ('POST', '/api/auth/password', 'Смена пароля: {"current", "password"}. Все другие сессии закрываются.'),
        ('GET', '/api/me', 'Профиль, статистика, достижения, покупки и история операций.'),
        ('GET', '/api/balance', 'Текущий серверный баланс V.'),
        ('GET', '/api/ledger?limit=30', 'История операций с монетами.'),
        ('GET', '/api/games', 'Каталог игр и агрегированная статистика.'),
        ('POST', '/api/games/play', 'Отметить запуск игры: {"game"}.'),
        ('POST', '/api/games/reward', 'Награда за событие: {"game", "receipt"}. Сумму и лимит задаёт сервер.'),
        ('GET', '/api/shop', 'Каталог магазина и статус покупок.'),
        ('POST', '/api/shop/buy', 'Покупка предмета: {"item"}.'),
        ('POST', '/api/shop/equip', 'Надеть предмет: {"item"}.'),
        ('GET', '/api/casino/rules', 'Правила казино, вероятности, RTP и лимиты.'),
        ('POST', '/api/casino/wheel', 'Вращение колеса: {"stake", "free"}. Результат считает сервер.'),
        ('POST', '/api/casino/slots', 'Ставка в слотах: {"stake"}.'),
        ('GET', '/api/casino/history?limit=25', 'История ставок и статистика.'),
        ('POST', '/api/casino/limits', 'Ограничения: {"daily", "excludeMinutes"}.'),
        ('GET', '/api/leaderboard', 'Топ игроков, последние достижения и totals.'),
        ('POST', '/api/admin/login', 'Вход администратора: {"password", "turnstileToken"}.'),
        ('GET', '/api/admin/stats', 'Статистика платформы (только админ-сессия).'),
        ('GET', '/api/admin/users?q=', 'Поиск пользователей (только админ-сессия).'),
        ('POST', '/api/admin/balance', 'Изменение баланса: {"username", "delta"|"set", "reason"}.'),
    ]
    rows = ''.join(f'<tr><td><span class="badge {"badge-line" if m == "GET" else "badge-new"}">{m}</span></td>'
                   f'<td><code>{E(path)}</code></td><td class="muted" style="white-space:normal">{E(desc)}</td></tr>'
                   for m, path, desc in endpoints)
    return f'''{head('API', 'Публичное API Vertu Games: аккаунты, баланс, магазин и казино. Все денежные операции на сервере.', 'api',
                  '<style>code{font-family:ui-monospace,monospace;font-size:12px;color:#c9f7e8;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:5px}</style>')}
{header('api')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="card panel">
      <span class="eyebrow"><span data-ico="bolt"></span> API</span>
      <h1 style="font-size:clamp(26px,3.4vw,40px);margin:12px 0 10px">HTTP API платформы</h1>
      <p class="muted" style="max-width:80ch">JSON-API для сайта и игр. Аутентификация — сессионная cookie <code>vg_session</code>
        (HttpOnly, SameSite=Lax). Изменяющие запросы требуют <code>Content-Type: application/json</code>.
        Все суммы V-монет определяются сервером: клиент не может начислить монеты сам.</p>
      <div class="table-wrap" style="margin-top:18px"><table>
        <thead><tr><th>Метод</th><th>Путь</th><th>Описание</th></tr></thead><tbody>{rows}</tbody></table></div>
      <h2 style="font-size:18px;margin:22px 0 10px">Ошибки</h2>
      <p class="muted" style="font-size:13px">Все ошибки возвращаются как <code>&#123;"ok":false,"code":"...","msg":"..."&#125;</code>
        с HTTP-статусом 4xx/5xx. Коды: <code>AUTH_REQUIRED</code>, <code>RATE_LIMIT</code>, <code>NO_FUNDS</code>,
        <code>LIMIT</code>, <code>CAPTCHA_FAILED</code>, <code>ADMIN_AUTH_REQUIRED</code>.</p>
      <h2 style="font-size:18px;margin:22px 0 10px">Безопасность</h2>
      <div class="list">
        <div class="list-row"><span class="ico" data-ico="lock"></span><span class="meta"><b>Сессии</b><small>в базе хранится только SHA-256 от токена; TTL 30 дней</small></span></div>
        <div class="list-row"><span class="ico" data-ico="shield"></span><span class="meta"><b>Rate-limit</b><small>по IP и по нику; отдельные лимиты для входа и регистрации</small></span></div>
        <div class="list-row"><span class="ico" data-ico="check"></span><span class="meta"><b>Идемпотентность</b><small>квитанции и уникальные ref не позволяют начислить дважды</small></span></div>
      </div>
      <div class="row" style="margin-top:16px"><a class="btn btn-ghost" href="support.html">Поддержка</a>
        <a class="btn btn-primary" href="login.html?tab=register">Создать аккаунт</a></div>
    </div>
  </section>
</main>
{footer()}
{scripts()}'''


def build_privacy() -> str:
    sections = [
        ('Какие данные мы храним', 'Ник, PBKDF2-хеш пароля с солью, время регистрации, баланс V-монет, история операций, '
                                   'покупки, статистика игр, достижения, настройки профиля и история ставок в казино. '
                                   'E-mail не запрашивается и не хранится (кроме перенесённых старых аккаунтов).'),
        ('Что не хранится', 'Пароли в открытом виде, коды подтверждения, платёжные данные карт. Braintree/Stripe/ЮKassa '
                            'обрабатывают платежи сами; платформа хранит только идентификатор заказа.'),
        ('Cookies', 'Используется одна служебная cookie <code>vg_session</code> (HttpOnly, SameSite=Lax) для серверной сессии '
                    'и отдельная cookie админ-сессии. Рекламных и сторонних cookies платформа не ставит.'),
        ('Третьи стороны', 'Cloudflare Turnstile (защита от ботов) получает IP и токен проверки. Google Fonts отдаёт шрифты. '
                           'Игровые библиотеки встроены в файлы игр.'),
        ('Локальное хранилище', 'В браузере сохраняются только: язык интерфейса и сохранения самих игр (позиция, прогресс). '
                                 'Баланс и покупки в браузере не хранятся.'),
        ('Безопасность', 'Пароли хешируются PBKDF2-SHA256 (310 000 раундов) с индивидуальной солью. Сессии хранятся как хеши, '
                         'все денежные операции выполняются в транзакциях и проверяются на сервере.'),
        ('Ваши права', 'Вы можете сменить пароль, выйти из всех сессий и запросить удаление аккаунта у владельца платформы. '
                       'Удаление аккаунта удаляет связанные данные (историю операций, покупки, ставки).'),
        ('Дети', 'Платформа предназначена для пользователей 18+. Регистрация несовершеннолетних не допускается.'),
    ]
    body = ''.join(f'<div class="card panel" style="margin-bottom:12px"><h2 style="font-size:17px;margin-bottom:8px">{E(title)}</h2>'
                   f'<p class="muted" style="font-size:13.5px;margin:0">{text}</p></div>' for title, text in sections)
    return f'''{head('Конфиденциальность', 'Политика конфиденциальности Vertu Games: какие данные хранятся и как они защищены.', 'privacy',
                  '<style>code{font-family:ui-monospace,monospace;font-size:12px;color:#c9f7e8;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:5px}</style>')}
{header('privacy')}
<main class="wrap">
  <section class="section" style="margin-top:22px">
    <div class="card panel" style="margin-bottom:14px">
      <span class="eyebrow"><span data-ico="lock"></span> Политика конфиденциальности</span>
      <h1 style="font-size:clamp(24px,3.2vw,36px);margin:12px 0 8px">Данные и приватность</h1>
      <p class="muted" style="margin:0;font-size:13.5px">Последнее обновление: 13 ноября 2026. Коротко: мы храним минимум данных, '
        необходимых для аккаунта и игровой экономики, и не продаём их.</p>
    </div>
    {body}
    <div class="card panel"><h2 style="font-size:17px;margin-bottom:8px">Контакты</h2>
      <p class="muted" style="font-size:13.5px;margin:0">Вопросы об обработке данных — через страницу
        <a href="support.html" style="color:var(--lime)">поддержки</a>.</p></div>
  </section>
</main>
{footer()}
{scripts()}'''


# --------------------------------------------------------------------------- #  data file
def build_catalog_data() -> str:
    payload = {
        'games': [{k: g[k] for k in ('id', 'name', 'name_en', 'file', 'icon', 'tag', 'cat', 'cat_en',
                                     'desc', 'desc_en', 'reward', 'daily', 'event', 'how_ru', 'how_en',
                                     'long_ru', 'long_en', 'controls_ru', 'controls_en')} for g in visible_games()],
        'shop': [{k: i[k] for k in ('id', 'kind', 'name_ru', 'name_en', 'price', 'icon', 'payload', 'order')} for i in SHOP_ITEMS],
        'achievements': ACHIEVEMENTS,
        'casino': {k: v for k, v in casino_rules().items()},
        'stakes': CASINO_STAKES,
    }
    return '/* Сгенерировано tools/build_platform.py — не редактируйте вручную. */\nwindow.VG_DATA = ' + \
        json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n'


VG_ARROW = '<span data-ico="chev" data-size="14"></span>'

BUILDERS = {
    'index.html': build_index,
    'top.html': build_catalog,
    'shop.html': build_shop,
    'casino.html': build_casino,
    'roulette.html': build_roulette,
    'profile.html': build_profile,
    'login.html': build_login,
    'admin.html': build_admin,
    'about.html': build_about,
    'support.html': build_support,
    'api.html': build_api,
    'privacy.html': build_privacy,
    'assets/vg/js/catalog-data.js': build_catalog_data,
}


def main(argv):
    """Собрать страницы. --check — сверить файлы с генератором, ничего не записывая."""
    check_only = '--check' in argv
    problems = []
    for name, builder in BUILDERS.items():
        target = ROOT / name
        # Каждая страница получает пары data-ru/data-en для мгновенного
        # переключения языка без перезагрузки.
        expected = localize_markup(builder())
        if check_only:
            if not target.exists():
                problems.append(f'нет файла: {name}')
            elif target.read_text(encoding='utf-8') != expected:
                problems.append(f'устарел: {name} (пересоберите без --check)')
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(expected, encoding='utf-8')
        print(f'built {name} ({target.stat().st_size} bytes)')
    if check_only:
        for line in problems:
            print(line)
        print('всё актуально' if not problems else f'проблем: {len(problems)}')
        return 1 if problems else 0
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
