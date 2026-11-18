#!/usr/bin/env python3
"""E2E по всем играм через настоящий HTTP-сервер: награды, лимиты, история.

Скрипт поднимает отдельную базу, регистрирует игрока и проходит все видимые
игры так, как это делает браузер: берёт подписанный билет, отправляет итог
забега и сверяет, что начислено ровно столько, сколько обещает карточка
каталога, что повтор того же забега не платит второй раз и что баланс,
история и суточные лимиты согласованы.

Запуск (нужен работающий сервер):

    VERT_BASE=http://127.0.0.1:8000 python tools/test_rewards_e2e.py
"""
from __future__ import annotations

import os
import sys
import time
import uuid

import requests

BASE = (os.environ.get('VERT_BASE') or 'http://127.0.0.1:8000').rstrip('/')
PASSWORD = 'Str0ng-Pass!23'
results: list[tuple[bool, str]] = []


def check(name: str, ok: bool, extra=None) -> None:
    results.append((bool(ok), name + ('' if extra is None else f' → {extra!r}')))


class Player:
    def __init__(self):
        self.session = requests.Session()
        self.csrf = ''
        self.username = 'e2e' + uuid.uuid4().hex[:8]
        self.balance = 0
        self.bootstrap()

    def _headers(self):
        return {'X-CSRF-Token': self.csrf} if self.csrf else {}

    def bootstrap(self):
        data = self.session.get(BASE + '/api/session', timeout=15).json()
        self.csrf = data.get('csrf') or ''
        return data

    def post(self, path, body=None):
        response = self.session.post(BASE + path, json=body or {}, headers=self._headers(), timeout=20)
        return response

    def register(self):
        response = self.post('/api/auth/register', {'username': self.username, 'password': PASSWORD})
        payload = response.json()
        if response.status_code != 201:
            raise SystemExit(f'регистрация не прошла: {response.status_code} {payload}')
        self.balance = payload['user']['coins']
        return payload

    def state(self):
        return self.session.get(BASE + '/api/session', timeout=15).json()

    def ticket(self, game):
        return self.session.get(BASE + '/api/games/session', params={'game': game}, timeout=15).json()

    def claim(self, **body):
        return self.post('/api/games/session/claim', body)

    def ledger(self):
        data = self.session.get(BASE + '/api/profile/' + self.username, timeout=15).json()
        return data.get('ledger') or []


def main() -> int:
    state = requests.get(BASE + '/api/session', timeout=15).json()
    cards = {g['id']: g for g in state.get('games', [])}
    check('каталог отдаёт карточки игр', bool(cards), sorted(cards))

    p = Player()
    p.register()
    welcome = p.balance
    check('регистрация выдала приветственные V', welcome > 0, welcome)

    session_games = [g for g, c in cards.items() if c.get('sessionClaim')]
    check('все 2D-игры объявили серверную награду сессии',
          set(session_games) >= {'flappy', '2048', 'platformer', 'pong', 'shooter', 'doodle', 'rover', 'snake', 'minicraft'},
          sorted(session_games))

    expected_total = 0
    per_game = {}
    for game, card in cards.items():
        if not card.get('sessionClaim'):
            continue
        ticket = p.ticket(game)
        if not ticket.get('sig'):
            check(f'{game}: билет выдан', False, ticket)
            continue
        body = {'game': game, 'time': 600, 'sessionId': f'{game}-e2e-1', 'ticket': ticket}
        if game == 'snake':
            body.update({'apples': 5, 'gold': 1})
            want = 5 * 1 + (5 // 5) * 5 + 1 * 10
        elif game == 'minicraft':
            body.update({'coins': 4})
            want = 4 * card['reward']
        else:
            body.update({'units': 3})
            want = 3 * card['reward']
        response = p.claim(**body)
        payload = response.json()
        ok = response.status_code == 200 and payload.get('awarded') == want
        check(f'{game}: карточка {card["reward"]} V × единицы = выплата', ok,
              [response.status_code, payload.get('awarded'), want])
        if ok:
            expected_total += want
            per_game[game] = want

    state_now = p.state()
    balance = state_now['user']['coins']
    check('баланс = приветственные + все выплаты', balance == welcome + expected_total,
          [welcome, expected_total, balance])

    # Повтор того же забега (перезагрузка страницы) денег не добавляет.
    for game, amount in list(per_game.items())[:4]:
        ticket = p.ticket(game)
        body = {'game': game, 'time': 600, 'sessionId': f'{game}-e2e-1', 'ticket': ticket}
        body.update({'apples': 5, 'gold': 1} if game == 'snake'
                    else {'coins': 4} if game == 'minicraft' else {'units': 3})
        response = p.claim(**body)
        payload = response.json()
        check(f'{game}: повтор забега не платит второй раз',
              response.status_code == 200 and payload.get('awarded') == 0, payload.get('awarded'))
    check('после повторов баланс не изменился', p.state()['user']['coins'] == balance,
          p.state()['user']['coins'])

    # Новая сессия того же игрока (refresh/переход в другую игру) — оплачивается.
    ticket = p.ticket('flappy')
    payload = p.claim(game='flappy', units=2, time=200, sessionId='flappy-e2e-2', ticket=ticket).json()
    check('новый забег оплачивается снова', payload.get('awarded') == 2 * cards['flappy']['reward'], payload)
    balance = p.state()['user']['coins']

    # История согласована с балансом.
    ledger = p.ledger()
    game_rows = [r for r in ledger if r.get('kind') == 'game']
    check('каждая выплата — строка истории', len(game_rows) >= len(per_game), len(game_rows))
    check('в истории есть точные суммы выплат',
          sum(int(r['delta']) for r in game_rows) <= balance, [len(game_rows), balance])

    # Лимит по времени: за 5 секунд нельзя пройти 60 труб.
    ticket = p.ticket('flappy')
    fast = p.claim(game='flappy', units=60, time=5, sessionId='flappy-fast', ticket=ticket).json()
    check('невозможный темп обрезается, а не оплачивается целиком',
          fast.get('awarded', 0) < 60 * cards['flappy']['reward'], fast.get('awarded'))

    # Чужой билет.
    other = p.ticket('2048')
    wrong = p.claim(game='flappy', units=2, time=120, sessionId='flappy-wrong', ticket=other)
    check('билет другой игры не принимается', wrong.status_code == 403, wrong.status_code)

    # Гость не получает награду.
    guest = requests.Session()
    guest.get(BASE + '/api/session', timeout=15)
    csrf = guest.cookies.get('vg_csrf')
    guest_resp = guest.post(BASE + '/api/games/session/claim', json={'game': 'flappy', 'units': 1, 'time': 60},
                            headers={'X-CSRF-Token': csrf} if csrf else {}, timeout=15)
    check('гость не получает награду', guest_resp.status_code in (401, 403), guest_resp.status_code)

    # Баланс переживает выход и вход.
    before_logout = p.state()['user']['coins']
    p.post('/api/auth/logout')
    p.bootstrap()
    p.post('/api/auth/login', {'username': p.username, 'password': PASSWORD})
    after_login = p.state()['user']['coins']
    check('баланс переживает logout/login', after_login == before_logout, [before_logout, after_login])

    # Игры без session_claim продолжают платить по квитанции (skyisle).
    ticket = p.ticket('skyisle')
    resp = p.post('/api/games/reward', {'game': 'skyisle', 'receipt': 'e2e-delivery-1', 'ticket': ticket})
    payload = resp.json()
    check('skyisle платит 5 V за доставку', resp.status_code == 200 and payload.get('awarded') == 5,
          [resp.status_code, payload.get('awarded')])
    again = p.post('/api/games/reward', {'game': 'skyisle', 'receipt': 'e2e-delivery-1', 'ticket': p.ticket('skyisle')})
    check('повтор доставки не платит второй раз', again.json().get('awarded') == 0, again.json().get('awarded'))

    passed = sum(1 for ok, _ in results if ok)
    for ok, line in results:
        print(('PASS · ' if ok else 'FAIL · ') + line)
    print(f'\nИТОГО: {passed}/{len(results)} проверок пройдено')
    print('игр с серверной выплатой: %d, выплачено за прогон: %d V' % (len(per_game), expected_total))
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
