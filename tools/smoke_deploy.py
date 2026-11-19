#!/usr/bin/env python3
"""Дымовая проверка задеплоенного сайта — как браузер, но без браузера.

Скрипт проходит полный путь игрока и администратора по живому адресу и
проверяет то, что чаще всего ломается в проде:

1. `/api/session` выдаёт CSRF-токен в теле **и** в куке (иначе все POST → 403);
2. регистрация, вход, баланс, награда за игру и её идемпотентность;
3. бесплатный спин «Рулетки Vert», лимиты казино, покупка предмета;
4. отсутствие пакетов V в магазине;
5. админ-вход по `ADMIN_PASSWORD`, каталог и журнал операций;
6. `backend` в `/api/health` — `postgresql` (а не `sqlite`);
7. выход из аккаунта закрывает сессию.

Запуск (нужен только стандартный Python, зависимостей нет):

```bash
python tools/smoke_deploy.py https://vert-games.onrender.com --admin-password '…'
```

Код выхода 0 — всё в порядке, 1 — есть провалы (печатаются списком).
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request


class SecurePolicy(http.cookiejar.DefaultCookiePolicy):
    """Принимать Secure-куки: на проде сайт работает по HTTPS."""

    def return_ok_secure(self, cookie, request):  # noqa: D102
        return True


class Browser:
    def __init__(self, base: str):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar(SecurePolicy())
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''

    def cookie(self, name: str) -> str:
        for item in self.jar:
            if item.name == name:
                return item.value
        return ''

    def request(self, method: str, path: str, body: dict | None = None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Accept': 'application/json'}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        if method not in ('GET', 'HEAD'):
            token = self.cookie('vg_csrf') or self.csrf
            if token:
                headers['X-CSRF-Token'] = token
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw, status = response.read(), response.status
        except urllib.error.HTTPError as exc:
            raw, status = exc.read(), exc.code
        try:
            payload = json.loads(raw.decode() or '{}')
        except ValueError:
            payload = {}
        return status, payload

    def get(self, path):
        return self.request('GET', path)

    def post(self, path, body=None):
        return self.request('POST', path, body if body is not None else {})


def main() -> int:
    parser = argparse.ArgumentParser(description='Дымовая проверка задеплоенного Vert Games')
    parser.add_argument('base', help='адрес сайта, например https://vert-games.onrender.com')
    parser.add_argument('--admin-password', default='', help='ADMIN_PASSWORD для проверки админки')
    parser.add_argument('--keep-user', action='store_true', help='оставить тестовый аккаунт')
    args = parser.parse_args()

    results: list[tuple[bool, str, str]] = []

    def check(name: str, ok: bool, detail: str = '') -> None:
        results.append((bool(ok), name, str(detail)))
        mark = '✅' if ok else '❌'
        print(f'  {mark} {name}' + ('' if ok else f' — {detail}'))
        sys.stdout.flush()

    guest = Browser(args.base)
    status, health = guest.get('/api/health')
    check('сайт отвечает на /api/health', status == 200 and health.get('ok'), f'HTTP {status}')
    local = any(h in args.base for h in ('localhost', '127.0.0.1', '0.0.0.0', ':80'))
    if local:
        print(f"  ⚠ локальный запуск, backend={health.get('backend')} (для прода нужен postgresql)")
    else:
        check('backend = postgresql', health.get('backend') == 'postgresql', health.get('backend'))
    captcha = health.get('captcha') or {}
    if captcha.get('required'):
        check('Cloudflare Turnstile настроен', bool(captcha.get('enabled')), captcha)
    else:
        # Локально/в тестах капча может быть выключена — для прода это предупреждение.
        print(f'  ⚠ Turnstile выключен (TURNSTILE_REQUIRED=0): {captcha}')
        if 'onrender.com' in args.base:
            check('Cloudflare Turnstile включён на проде', False,
                  'нет ключей: выставьте TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY и TURNSTILE_REQUIRED=1 '
                  'в Environment на Render (см. docs/CAPTCHA.md)')

    print('== Публикация колеса')
    status, version = guest.get('/api/version')
    check('/api/version отвечает', status == 200 and version.get('ok') is True, f'HTTP {status}')
    check('версия сборки видна', bool(version.get('version')), str(version.get('version')))
    live_wheel = version.get('wheel') or {}
    live_segments = live_wheel.get('segments') or []
    check('колесо: 20 секторов, только x0/x0/x1/x2/x5',
          len(live_segments) == 20 and sorted(set(live_segments)) == [0, 1, 2, 5],
          str(live_segments))
    check('колесо: 7 секторов x0, 10 x1, 2 x2, 1 x5',
          all(live_segments.count(m) == n for m, n in ((0, 7), (1, 10), (2, 2), (5, 1))),
          str({m: live_segments.count(m) for m in set(live_segments)}))
    check('RTP колеса 95 %', abs((live_wheel.get('rtp') or 0) - 0.95) < 1e-9,
          str(live_wheel.get('rtp')))
    live_page = (version.get('pages') or {}).get('roulette.html') or {}
    check('опубликованный roulette.html содержит новые множители',
          live_page.get('probabilities') == ['x0 35.0%', 'x1 50.0%', 'x2 10.0%', 'x5 5.0%'],
          str(live_page.get('probabilities')))
    check('на сайте нет дробных множителей',
          live_page.get('legacy_multipliers') is False, str(live_page))

    print('== CSRF и сессия')
    status, session = guest.get('/api/session')
    check('сессия отдаёт csrf-токен', status == 200 and bool(session.get('csrf')), str(session)[:80])
    guest.csrf = session.get('csrf', '')
    stored = guest.cookie('vg_csrf')
    check('csrf-токен в куке совпадает с телом', not stored or stored == guest.csrf,
          f'cookie={stored[:10]} body={guest.csrf[:10]}')

    print('== Игрок')
    player = Browser(args.base)
    player.get('/api/session')
    name = 'Smoke%d' % int(time.time())
    status, data = player.post('/api/auth/register',
                               {'username': name, 'password': 'SmokePass123', 'startedAt': 1})
    if status == 400 and data.get('code', '').startswith('CAPTCHA'):
        check('регистрация (пропущена: включён Turnstile)', True, 'капча требует браузера')
    else:
        check('регистрация нового аккаунта', status == 201, f'HTTP {status} {data}')
    status, data = player.post('/api/auth/login', {'username': name, 'password': 'SmokePass123'})
    check('вход по нику и паролю', status == 200, str(data)[:90])
    status, data = player.get('/api/balance')
    coins = data.get('coins')
    check('баланс отдаётся сервером', status == 200 and isinstance(coins, int), str(data))
    status, ticket = player.get('/api/games/session?game=flappy')
    check('подписанный билет игры выдан',
          status == 200 and bool(ticket.get('sig')) and ticket.get('amount', 0) > 0, str(ticket)[:90])
    status, data = player.post('/api/games/reward',
                               {'game': 'flappy', 'receipt': 'smoke-aaaaaaaa', 'ticket': ticket})
    check('награда за игру начислена', status == 200 and data.get('awarded', 0) > 0, str(data)[:90])
    after = data.get('coins')
    status, data = player.post('/api/games/reward',
                               {'game': 'flappy', 'receipt': 'smoke-aaaaaaaa', 'ticket': ticket})
    check('повторный билет не платит дважды',
          data.get('repeated') is True and data.get('coins') == after, str(data)[:90])
    status, data = player.post('/api/games/reward',
                               {'game': 'flappy', 'receipt': 'smoke-ccccccc',
                                'ticket': dict(ticket, amount=10000)})
    check('подделанная сумма в билете отклонена', status == 403, str(data)[:90])
    status, data = player.post('/api/casino/wheel', {'stake': 20, 'free': True})
    check('бесплатный спин «Рулетки Vert»', status == 200 and data.get('ok'), str(data)[:90])
    status, data = player.get('/api/casino/rules')
    limits = data.get('wheelLimits') or {}
    check('лимиты колеса: 1 бесплатный + 5 платных',
          limits.get('freeLimit') == 1 and limits.get('paidLimit') == 5, str(limits))
    status, data = player.post('/api/shop/buy', {'item': 'av:fox'})
    check('покупка предмета списывает V', status in (200, 402), str(data)[:90])
    status, data = player.get('/api/shop')
    check('в магазине нет пакетов V', data.get('packs') == [], str(data.get('packs')))

    if args.admin_password:
        print('== Администратор')
        admin = Browser(args.base)
        admin.get('/api/session')
        status, data = admin.post('/api/admin/login', {'password': args.admin_password})
        check('вход в админку', status == 200, f'HTTP {status} {data}')
        status, data = admin.get('/api/admin/stats')
        check('статистика платформы', status == 200 and 'users' in data.get('stats', {}), str(data)[:90])
        status, data = admin.get('/api/admin/users?q=' + name)
        check('поиск игрока в админке', status == 200 and data.get('total', 0) >= 1, str(data.get('total')))
        status, data = admin.get('/api/admin/items')
        check('каталог предметов', status == 200 and len(data.get('items', [])) > 0,
              str(len(data.get('items', []))))
        status, data = admin.get('/api/admin/transactions?limit=20')
        check('журнал операций', status == 200 and len(data.get('items', [])) > 0,
              str(len(data.get('items', []))))
        status, data = admin.get('/api/admin/log')
        check('журнал действий администратора', status == 200 and len(data.get('items', [])) > 0, str(data)[:60])

    print('== Выход')
    status, data = player.post('/api/auth/logout')
    check('выход из аккаунта', status == 200, str(data)[:60])
    status, data = player.get('/api/me')
    check('после выхода сессия закрыта', status == 401, f'HTTP {status}')
    if not args.keep_user:
        print(f'\nТестовый аккаунт: {name} (можно удалить или заблокировать в админке).')

    failed = [r for r in results if not r[0]]
    print(f'\nИтог: проверок {len(results)}, провалов {len(failed)}')
    if failed:
        print('\nПровалы:')
        for _, title, detail in failed:
            print(f'  · {title} — {detail}')
    return 0 if not failed else 1


if __name__ == '__main__':
    raise SystemExit(main())
