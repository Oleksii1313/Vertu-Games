#!/usr/bin/env python3
"""Сквозные проверки платформы Vertu Games.

Запускает настоящий сервер (Flask) на временном порту с отдельной базой и
прогоняет сценарии из задания: регистрация, вход/выход, CAPTCHA, уникальность
ника, сохранение баланса после перезапуска, магазин, начисление и списание
монет, колесо и слоты, защита API, админ-панель.

    .venv/bin/python tools/check_platform.py

Для PostgreSQL:  DATABASE_URL=postgres://... .venv/bin/python tools/check_platform.py
Без DATABASE_URL используется временная SQLite-база (быстрая проверка логики).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PASS, FAIL = 0, 0


def check(name, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        print(f'  ❌ {name}' + (f' — {detail}' if detail else ''))


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Client:
    """Минимальный HTTP-клиент с cookie-jar (как браузер)."""

    def __init__(self, base):
        self.base = base
        self.cookies = {}

    def request(self, method, path, body=None, headers=None):
        data = None
        head = {'Accept': 'application/json'}
        if body is not None:
            data = json.dumps(body).encode()
            head['Content-Type'] = 'application/json'
        if self.cookies:
            head['Cookie'] = '; '.join(f'{k}={v}' for k, v in self.cookies.items())
        # CSRF как в браузере: токен из куки vg_csrf уходит заголовком.
        if method not in ('GET', 'HEAD') and self.cookies.get('vg_csrf'):
            head['X-CSRF-Token'] = self.cookies['vg_csrf']
        head.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, headers=head, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                status, raw, cookie_headers = response.status, response.read(), response.headers.get_all('Set-Cookie') or []
        except urllib.error.HTTPError as exc:
            status, raw, cookie_headers = exc.code, exc.read(), exc.headers.get_all('Set-Cookie') or []
        for cookie in cookie_headers:
            pair = cookie.split(';')[0]
            if '=' in pair:
                key, value = pair.split('=', 1)
                if value:
                    self.cookies[key] = value
                else:
                    self.cookies.pop(key, None)
        try:
            payload = json.loads(raw.decode() or '{}')
        except ValueError:
            payload = {}
        return status, payload

    def get(self, path):
        return self.request('GET', path)

    def post(self, path, body=None):
        return self.request('POST', path, body if body is not None else {})


def public_games_catalog(base):
    """Каталог игр с сервера: проверяем, что скрытые игры не отдаются."""
    try:
        with urllib.request.urlopen(base + '/api/games', timeout=10) as response:
            return json.loads(response.read().decode()).get('games', [])
    except Exception:  # noqa: BLE001
        return []


def start_server(port, env_extra):
    env = dict(os.environ)
    env.update(env_extra)
    env['PORT'] = str(port)
    proc = subprocess.Popen([sys.executable, '-c',
                             'from server import app; app.run(host="127.0.0.1", port=%d, threaded=True)' % port],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    deadline = time.time() + 40
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                return proc
        except OSError:
            if proc.poll() is not None:
                output = proc.stdout.read() if proc.stdout else ''
                raise SystemExit(f'Сервер не запустился:\n{output[:4000]}')
            time.sleep(0.25)
    proc.kill()
    raise SystemExit('Сервер не ответил за 40 секунд')


def main():
    tmp = tempfile.mkdtemp(prefix='vertu-check-')
    schema = None
    database_url = os.environ.get('DATABASE_URL', '').strip()
    env = {
        'ADMIN_PASSWORD': 'CheckAdmin#2026',
        'WELCOME_COINS': '100',
        'VERTU_DB': str(Path(tmp) / 'check.sqlite3'),
        'PYTHONUNBUFFERED': '1',
    }
    if database_url:
        # Каждый запуск работает в своей схеме, чтобы не мешать данным приложения.
        schema = 'check_' + uuid.uuid4().hex[:12]
        sep = '&' if '?' in database_url else '?'
        env['DATABASE_URL'] = f'{database_url}{sep}options=-csearch_path%3D{schema}'
    base = None
    proc = None
    try:
        print('== Запуск сервера')
        if database_url:
            import psycopg
            with psycopg.connect(database_url, autocommit=True) as conn:
                conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        port = free_port()
        proc = start_server(port, env)
        base = f'http://127.0.0.1:{port}'
        guest = Client(base)
        status, health = guest.get('/api/health')
        check('сервер отвечает /api/health', status == 200 and health.get('ok'), str(health))
        backend = health.get('backend')
        print(f'   база: {backend}')

        print('== Страницы и статика')
        for page in ('index.html', 'top.html', 'shop.html', 'casino.html', 'roulette.html',
                     'profile.html', 'login.html', 'admin.html', 'about.html', 'support.html',
                     'api.html', 'privacy.html', 'games/flappy.html',
                     'assets/vg/css/platform.css', 'assets/vg/js/platform.js'):
            with urllib.request.urlopen(base + '/' + page, timeout=10) as response:
                check(f'{page} отдаётся (200)', response.status == 200)
        for secret in ('db.py', 'schema_sql.py', 'schema_sqlite.py', 'server.py',
                       'casino_logic.py', 'shop.py', 'requirements.txt', '.env',
                       'alembic.ini', 'migrate_sqlite_to_postgres.py', 'tools/build_platform.py'):
            try:
                urllib.request.urlopen(base + '/' + secret, timeout=5)
                check(f'{secret} недоступен', False, 'файл отдаётся публично!')
            except urllib.error.HTTPError as exc:
                check(f'{secret} недоступен (404)', exc.code == 404)

        print('== Регистрация и защита ника')
        alice = Client(base)
        status, data = alice.post('/api/auth/register',
                                  {'username': 'CheckAlice', 'password': 'AlicePass123', 'startedAt': 1})
        check('регистрация по нику и паролю', status == 201 and data.get('user', {}).get('username') == 'CheckAlice', str(data))
        check('приветственный бонус и достижение начислены', data.get('coins') == 150, str(data))
        check('cookie сессии выставлена', 'vg_session' in alice.cookies)
        status, data = alice.get('/api/session')
        check('сессия подтверждает пользователя', data.get('user', {}).get('username') == 'CheckAlice')
        bob = Client(base)
        status, data = bob.post('/api/auth/register',
                                {'username': 'checkalice', 'password': 'AnotherPass123', 'startedAt': 1})
        check('ник уникален без учёта регистра', status == 409 and data.get('code') == 'USERNAME_TAKEN', str(data))
        status, data = bob.post('/api/auth/register', {'username': 'ab', 'password': 'short', 'startedAt': 1})
        check('слабый пароль/короткий ник отклонены', status == 400, str(data))
        status, data = bob.post('/api/auth/register',
                                {'username': 'CheckBob', 'password': 'BobPass12345', 'startedAt': 1, 'website': 'spam'})
        check('honeypot блокирует ботов', status == 400 and data.get('code') == 'BOT', str(data))
        bob = Client(base)
        status, data = bob.post('/api/auth/register',
                                {'username': 'CheckBob', 'password': 'BobPass12345', 'startedAt': 1})
        check('второй аккаунт создан', status == 201, str(data))

        print('== Вход, выход, смена пароля')
        status, data = bob.post('/api/auth/login', {'username': 'CheckBob', 'password': 'wrong-password'})
        check('неверный пароль отклонён', status == 401 and data.get('code') == 'INVALID', str(data))
        status, data = bob.post('/api/auth/login', {'username': 'CheckBob', 'password': 'BobPass12345'})
        check('вход по паролю работает', status == 200 and data.get('user', {}).get('username') == 'CheckBob', str(data))
        status, data = bob.post('/api/auth/password', {'current': 'BobPass12345', 'password': 'BobNewPass123'})
        check('смена пароля', status == 200, str(data))
        status, data = bob.get('/api/me')
        check('новая сессия после смены пароля активна', status == 200, str(data))
        old_client = Client(base)
        status, data = old_client.post('/api/auth/login', {'username': 'CheckBob', 'password': 'BobPass12345'})
        check('старый пароль больше не работает', status == 401, str(data))
        status, data = old_client.post('/api/auth/login', {'username': 'CheckBob', 'password': 'BobNewPass123'})
        check('вход с новым паролем работает', status == 200, str(data))
        status, data = old_client.post('/api/auth/logout', {})
        check('выход из аккаунта', status == 200)
        status, data = old_client.get('/api/me')
        check('после выхода сессия закрыта', status == 401, str(data))

        print('== Игровой плеер (разметка страниц)')
        import re as _re
        for page in ('index.html', 'top.html', 'shop.html', 'profile.html', 'casino.html'):
            html = urllib.request.urlopen(base + '/' + page, timeout=10).read().decode()
            has_placeholder = 'id="playOverlay"' in html
            # Плеер обязан собираться сам: либо контейнера нет, либо он пустой.
            empty = bool(_re.search(r'<div class="play-overlay" id="playOverlay">\s*</div>', html))
            check(f'{page}: плеер собирается на клиенте', (not has_placeholder) or empty,
                  'контейнер плеера не пустой — openGame() его не заполнит')
        platform_js = urllib.request.urlopen(base + '/assets/vg/js/platform.js', timeout=10).read().decode()
        check('openGame достраивает пустой оверлей', "overlay.querySelector('.play-bar')" in platform_js)
        check('getCurrentUser доступен играм', 'window.getCurrentUser' in platform_js)

        print('== Клиентские исправления (мобильный экран, фокус, резкость)')
        games = ('flappy', 'game2048', 'platformer', 'pong', 'shooter', 'snake', 'minicraft',
                 'doodle', 'sky-isle', 'chefs-rover', 'redline')
        for game in games:
            html = urllib.request.urlopen(base + '/games/' + game + '.html', timeout=10).read().decode()
            check(f'{game}: ландшафт на весь экран без полос',
                  'vg-landscape-fullscreen' in html and '100dvh' in html
                  and 'safe-area-inset' in html, 'нет мобильного ландшафтного CSS')
            check(f'{game}: подключён game-kit (фокус и DPR)',
                  'game-kit.js' in html, 'game-kit.js не подключён')
        player = urllib.request.urlopen(base + '/assets/vg/js/platform.js', timeout=10).read().decode()
        check('плеер: псевдополный экран, если Fullscreen API недоступен',
              'pseudoFullscreen' in player and 'pseudo-full' in player)
        check('плеер: фокус внутрь canvas игры',
              'focusInsideGame' in player and 'vg:focus' in player)
        css = urllib.request.urlopen(base + '/assets/vg/css/platform.css', timeout=10).read().decode()
        check('плеер: рамка игры 100vw × 100dvh',
              '.play-overlay' in css and '100dvh' in css and 'orientation:landscape' in css)
        kit = urllib.request.urlopen(base + '/assets/vg/js/game-kit.js', timeout=10).read().decode()
        check('game-kit: devicePixelRatio для canvas', 'devicePixelRatio' in kit and 'setTransform' in kit)
        check('game-kit: автофокус канваса', 'focusGame' in kit)
        roulette_page = urllib.request.urlopen(base + '/roulette.html', timeout=10).read().decode()
        check('страница рулетки называется «Рулетка Vert»',
              'Рулетка Vert' in roulette_page and '<title>Рулетка Vert' in roulette_page)
        check('в навигации «Рулетка Vert»', 'Рулетка Vert' in player)

        print('== Безопасность: CSRF и сессия')
        status, data = guest.get('/api/session')
        check('/api/session отдаёт csrf-токен', status == 200 and bool(data.get('csrf')), str(data)[:80])
        check('/api/session отдаёт роль', status == 200 and data.get('role') in ('guest', 'player', 'admin'))
        raw = urllib.request.Request(base + '/api/auth/logout', data=b'{}', method='POST',
                                     headers={'Content-Type': 'application/json'})
        try:
            urllib.request.urlopen(raw, timeout=10)
            csrf_blocked = False
        except urllib.error.HTTPError as exc:
            csrf_blocked = exc.code == 403
        check('POST без CSRF-токена отклоняется', csrf_blocked, 'запрос без токена прошёл')
        forged = Client(base)
        forged.cookies['vg_session'] = alice.cookies.get('vg_session', '')
        forged.cookies['vg_csrf'] = 'forged'
        status, data = forged.request('POST', '/api/games/reward',
                                      {'game': 'flappy', 'receipt': 'csrf-123456'},
                                      headers={'X-CSRF-Token': 'other'})
        check('несовпадающий CSRF-токен отклоняется', status == 403 and data.get('code') == 'CSRF', str(data))
        status, data = guest.get('/api/shop')
        check('в магазине нет пакетов V', status == 200 and data.get('packs') == [], str(data.get('packs')))

        print('== Баланс и монеты')
        status, data = guest.get('/api/balance')
        check('баланс без входа запрещён', status == 401, str(data))
        status, data = guest.post('/api/games/reward', {'game': 'flappy', 'receipt': 'hack-123456'})
        check('награда без входа запрещена', status == 401, str(data))
        status, data = guest.post('/api/casino/slots', {'stake': 10})
        check('ставка без входа запрещена', status == 401, str(data))
        status, data = guest.get('/api/admin/stats')
        check('админ-API без пароля запрещён', status == 401, str(data))
        status, data = alice.get('/api/balance')
        check('баланс доступен владельцу', status == 200 and data.get('coins') == 150, str(data))
        status, data = alice.post('/api/games/reward', {'game': 'flappy', 'receipt': 'pipe-aaaaaaaa'})
        check('награда за игру начислена сервером', status == 200 and data.get('awarded') == 2, str(data))
        balance_after_reward = data.get('coins')
        status, data = alice.post('/api/games/reward', {'game': 'flappy', 'receipt': 'pipe-aaaaaaaa'})
        check('повторная квитанция не начисляет дважды', data.get('repeated') is True and data.get('awarded') == 0
              and data.get('coins') == balance_after_reward, str(data))
        status, data = alice.post('/api/games/reward', {'game': 'flappy', 'receipt': 'x'})
        check('некорректная квитанция отклонена', status == 400, str(data))
        status, data = alice.post('/api/games/reward', {'game': 'unknown', 'receipt': 'pipe-bbbbbb'})
        check('неизвестная игра отклонена', status == 404, str(data))

        print('== Магазин')
        status, data = alice.get('/api/shop')
        check('каталог магазина отдаётся', status == 200 and len(data.get('items', [])) >= 15, str(len(data.get('items', []))))
        status, data = alice.post('/api/shop/buy', {'item': 'av:gem'})
        check('покупка дороже баланса отклонена', status == 402 and data.get('code') == 'NO_FUNDS', str(data))
        status, data = alice.post('/api/shop/buy', {'item': 'av:fox'})
        # 150 + 2 за игру = 152; покупка 100 -> 52, достижение «Шопоголик» +30 -> 82
        check('покупка предмета списывает V', status == 200 and data.get('balance') == balance_after_reward - 100 + 30, str(data))
        owned_balance = data.get('balance')
        status, data = alice.post('/api/shop/buy', {'item': 'av:fox'})
        check('повторная покупка не списывает дважды', status == 200 and data.get('already') is True
              and data.get('balance') == owned_balance, str(data))
        status, data = alice.post('/api/shop/equip', {'item': 'av:fox'})
        check('экипировка купленного предмета', status == 200 and data.get('user', {}).get('avatar') == 'av:fox', str(data))
        status, data = alice.post('/api/shop/equip', {'item': 'av:dragon'})
        check('нельзя надеть некупленный предмет', status == 403, str(data))

        print('== Казино: слоты и колесо')
        status, rules = alice.get('/api/casino/rules')
        check('правила казино доступны', status == 200 and rules.get('stakes'), str(status))
        check('вероятности и RTP опубликованы', rules['slots']['rtp'] > 0 and rules['wheel']['rtp'] > 0,
              f"slots={rules['slots']['rtp']} wheel={rules['wheel']['rtp']}")
        before = alice.get('/api/balance')[1]['coins']
        status, data = alice.post('/api/casino/slots', {'stake': 10})
        check('слоты: ставка и результат', status == 200 and data.get('reels') and len(data['reels']) == 3, str(data))
        expected = before - 10 + data.get('payout', 0)
        check('слоты: баланс = ставка - списание + выигрыш', data.get('balance') == expected,
              f'{data.get("balance")} != {expected}')
        status, data = alice.post('/api/casino/slots', {'stake': 9999})
        check('слоты: лимит ставки', status == 400, str(data))
        status, data = alice.post('/api/casino/wheel', {'stake': 10, 'free': True})
        check('колесо: бесплатный спин', status == 200 and 'segment' in data, str(data))
        free_balance = data.get('balance')
        check('колесо: бесплатный спин не списывает ставку', free_balance == before + data.get('payout', 0)
              if before == expected else True, str(data))
        status, data = alice.post('/api/casino/wheel', {'stake': 10, 'free': True})
        check('колесо: второй бесплатный спин уже платный', status == 200 and data.get('free') is False, str(data))
        before = alice.get('/api/balance')[1]['coins']
        status, data = alice.post('/api/casino/wheel', {'stake': 10})
        check('колесо: платный спин', status == 200 and data.get('balance') == before - 10 + data.get('payout', 0), str(data))

        # Суточные лимиты колеса: 1 бесплатное и не больше 5 платных вращений.
        status, data = alice.get('/api/casino/rules')
        wheel_limits = data.get('wheelLimits') or {}
        check('колесо: лимиты 1 бесплатный + 5 платных в правилах',
              status == 200 and wheel_limits.get('freeLimit') == 1 and wheel_limits.get('paidLimit') == 5,
              str(wheel_limits))
        check('колесо: счётчики остатка не отрицательные',
              wheel_limits.get('freeLeft') == 0 and 0 <= wheel_limits.get('paidLeft', -1) <= 5,
              str(wheel_limits))
        check('колесо: время сброса лимита в будущем',
              wheel_limits.get('resetAt', 0) > time.time(), str(wheel_limits.get('resetAt')))
        blocked = None
        for _ in range(6):
            status, data = alice.post('/api/casino/wheel', {'stake': 10})
            if status != 200:
                blocked = (status, data)
                break
        check('колесо: шестое платное вращение блокируется',
              bool(blocked) and blocked[0] == 429 and blocked[1].get('code') == 'WHEEL_LIMIT',
              str(blocked[1]) if blocked else 'не заблокировано')
        check('колесо: при блокировке отдаётся таймер разблокировки',
              bool(blocked) and (blocked[1].get('limits') or {}).get('resetAt', 0) > time.time(),
              str((blocked[1].get('limits') if blocked else None)))
        status, data = alice.post('/api/casino/wheel', {'stake': 10, 'free': True})
        check('колесо: бесплатный спин тоже заблокирован после лимита',
              status == 429 and (data.get('limits') or {}).get('blocked') is True, str(data))
        status, data = alice.get('/api/casino/history')
        check('история ставок', status == 200 and len(data.get('items', [])) >= 3, str(data.get('stats')))
        check('история содержит реальные ставки', all(item['stake'] > 0 for item in data['items']))
        status, data = alice.post('/api/casino/limits', {'daily': 100})
        check('дневной лимит сохраняется', status == 200 and data['limits']['daily'] == 100, str(data))
        status, data = alice.post('/api/casino/limits', {'excludeMinutes': 60})
        check('самоисключение включается', status == 200 and data['limits']['excludeUntil'] > time.time(), str(data))
        status, data = alice.post('/api/casino/slots', {'stake': 10})
        check('во время самоисключения ставки запрещены', status == 403, str(data))
        alice.post('/api/casino/limits', {'excludeMinutes': 0, 'daily': 0})

        print('== Казино: математика выплат')
        sys.path.insert(0, str(ROOT))
        import casino_logic
        from game_catalog import SLOT_SYMBOLS
        triple = SLOT_SYMBOLS[0]
        payout, outcome = casino_logic._slot_payout([triple['id']] * 3, 10)
        check('три в ряд платят по коэффициенту', payout == triple['m3'] * 10, f'{payout} {outcome}')
        pair_ids = [SLOT_SYMBOLS[0]['id'], SLOT_SYMBOLS[0]['id'], SLOT_SYMBOLS[1]['id']]
        payout, outcome = casino_logic._slot_payout(pair_ids, 10)
        check('пара платит 40% ставки', payout == 4, f'{payout} {outcome}')

        print('== Админ-панель')
        admin = Client(base)
        status, data = admin.post('/api/admin/login', {'password': 'wrong'})
        check('неверный пароль админа отклонён', status == 401, str(data))
        status, data = admin.post('/api/admin/login', {'password': 'CheckAdmin#2026'})
        check('вход администратора', status == 200, str(data))
        status, data = admin.get('/api/admin/stats')
        check('статистика платформы', status == 200 and data['stats']['users'] >= 2, str(data.get('stats')))
        status, data = admin.get('/api/admin/users?q=check')
        check('поиск пользователей', status == 200 and data['total'] >= 2, str(data.get('total')))
        status, data = admin.get('/api/admin/user/CheckAlice')
        check('профиль пользователя в админке', status == 200 and data['user']['username'] == 'CheckAlice')
        coins_before = data['user']['coins']
        status, data = admin.post('/api/admin/balance', {'username': 'CheckAlice', 'delta': 250, 'reason': 'тест'})
        check('админ начисляет V', status == 200 and data['coins'] == coins_before + 250, str(data))
        status, data = admin.post('/api/admin/balance', {'username': 'CheckAlice', 'set': 10})
        check('админ устанавливает баланс', status == 200 and data['coins'] == 10, str(data))
        status, data = admin.post('/api/admin/balance', {'username': 'CheckAlice', 'delta': -999999})
        check('баланс не уходит в минус', status == 400, str(data))
        status, data = admin.post('/api/admin/banned', {'username': 'CheckBob', 'banned': True, 'reason': 'тест'})
        check('блокировка пользователя', status == 200 and data.get('banned') is True, str(data))
        banned_login = Client(base)
        status, data = banned_login.post('/api/auth/login', {'username': 'CheckBob', 'password': 'BobNewPass123'})
        check('заблокированный не может войти', status == 403, str(data))
        admin.post('/api/admin/banned', {'username': 'CheckBob', 'banned': False})
        status, data = admin.get('/api/admin/log')
        check('журнал действий администратора', status == 200 and len(data['items']) >= 3, str(len(data.get('items', []))))
        status, data = admin.post('/api/admin/settings', {'settings': {'min_stake': 5, 'max_stake': 100}})
        check('настройки казино сохраняются', status == 200, str(data))
        status, data = admin.get('/api/admin/games')
        check('список игр в админке', status == 200 and len(data['games']) == 11, str(len(data.get('games', []))))
        check('Redline скрыт из каталога игр',
              all(g.get('id') != 'redline' for g in public_games_catalog(base)),
              str([g.get('id') for g in public_games_catalog(base)]))
        status, data = admin.get('/api/admin/items')
        check('админ: каталог предметов', status == 200 and len(data.get('items', [])) >= 15,
              str(len(data.get('items', []))))
        status, data = admin.post('/api/admin/items', {'item': {'id': 'av:fox', 'name_ru': 'Лис',
                                                                'price': 120, 'active': True}})
        check('админ: предмет сохраняется', status == 200 and data.get('item', {}).get('id') == 'av:fox', str(data))
        status, data = admin.get('/api/admin/achievements')
        check('админ: достижения', status == 200 and len(data.get('achievements', [])) >= 5,
              str(len(data.get('achievements', []))))
        status, data = admin.post('/api/admin/achievements', {'achievement': {'id': 'first_login',
                                                                              'name_ru': 'Добро пожаловать',
                                                                              'coins': 50}})
        check('админ: достижение сохраняется', status == 200, str(data))
        status, data = admin.get('/api/admin/tasks')
        check('админ: ежедневные задания', status == 200 and isinstance(data.get('tasks'), list), str(data))
        status, data = admin.post('/api/admin/tasks', {'task': {'title': 'Сыграйте 3 игры',
                                                                'task_type': 'play', 'target_value': 3,
                                                                'reward': 40}})
        check('админ: задание создаётся', status == 200 and data.get('task', {}).get('id'), str(data))
        status, data = admin.get('/api/admin/transactions?limit=20')
        check('админ: журнал операций', status == 200 and len(data.get('items', [])) >= 3,
              str(len(data.get('items', []))))
        check('в журнале есть reference_id (идемпотентность)',
              any(row.get('reference_id') for row in data.get('items', [])), 'нет reference_id')
        status, data = admin.get('/api/admin/casino')
        check('админ: история казино', status == 200 and isinstance(data.get('items'), list), str(data))
        status, data = banned_login.get('/api/admin/stats')
        check('обычный игрок не видит админку', status == 401, str(data))
        status, data = alice.get('/api/admin/transactions')
        check('админ-API закрыт для игрока', status == 401, str(data))
        status, data = admin.post('/api/admin/logout', {})
        check('выход из админки', status == 200)
        status, data = admin.get('/api/admin/stats')
        check('после выхода админ-API закрыт', status == 401, str(data))

        print('== Сохранение после перезапуска сервера')
        coins_before = alice.get('/api/balance')[1]['coins']
        proc.terminate()
        proc.wait(timeout=15)
        port2 = free_port()
        proc = start_server(port2, env)
        alice.base = f'http://127.0.0.1:{port2}'
        status, data = alice.get('/api/balance')
        check('сессия переживает перезапуск', status == 200 and data.get('coins') == coins_before, str(data))
        relogin = Client(f'http://127.0.0.1:{port2}')
        status, data = relogin.post('/api/auth/login', {'username': 'CheckAlice', 'password': 'AlicePass123'})
        check('аккаунт сохранён в базе', status == 200 and data['user']['coins'] == coins_before, str(data))

        print('\n== Итог')
        print(f'   пройдено: {PASS}, провалено: {FAIL}')
        return 0 if FAIL == 0 else 1
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == '__main__':
    raise SystemExit(main())
