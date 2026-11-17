"""Серверная выдача и проверка подписанных игровых сессий.

Зачем это нужно
---------------
Браузер — враждебная среда. Любой запрос можно отредактировать в DevTools или
Burp Suite, а ``postMessage`` из iframe подделать скриптом. Поэтому клиент не
должен присылать ничего, что влияет на баланс: только «я закончил событие» и
подписанный сервером билет, в котором уже записано, за что и сколько платят.

Схема (HMAC-SHA256, без внешних зависимостей):

1. ``GET /api/games/session`` — сервер создаёт
   билет с уникальным ``sid``, привязывает к пользователю, игре, сумме награды
   и времени жизни, подписывает ключом ``GAME_SIGNING_KEY``.
2. Клиент присылает ``{game, receipt, ticket}`` (билет целиком).
   Сумма награды **не принимается от клиента вообще**: сервер проверяет подпись,
   достаёт сумму из билета и сверяет игру/пользователя/срок.
3. ``sid`` одноразовый: повторная отправка билета не платит второй раз
   (``game_receipts.ref UNIQUE``), а истёкший билет отклоняется.

Ключ подписи
------------
``GAME_SIGNING_KEY`` — отдельный секрет, **не** ``SECRET_KEY``: компрометация
одного не должна ломать другой. Если переменная не задана, ключ выводится из
``SECRET_KEY`` (так локальная разработка не требует настройки), но на проде
ключ задаётся явно и ротируется. ``GAME_SIGNING_TTL`` (по умолчанию 1800 с)
ограничивает срок жизни билета: украденный билет бесполезен после.

Что это даёт и чего не даёт
---------------------------
Даёт: нельзя попросить награду «на 1000 V», нельзя переиграть чужой билет,
нельзя проиграть один и тот же билет дважды, нельзя использовать билет другой
игры или после смены ключа.

Не даёт: если игра целиком клиентская, настойчивый читер всё равно может
«сыграть» идеально и получить **легальную** награду в рамках суточного лимита.
Поэтому лимиты (``daily``, частота, аномалии в ``guard.py``) — обязательная
вторая линия, а для дорогих наград нужен серверный симулятор игры.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from typing import Any

TTL = int(os.environ.get('GAME_SIGNING_TTL', '1800') or 1800)
VERSION = 'v1'


class TicketError(Exception):
    """Билет невалиден: подпись, срок, привязка к пользователю/игре."""


def _key() -> bytes:
    raw = (os.environ.get('GAME_SIGNING_KEY') or '').strip()
    if not raw:
        # Локально/в тестах: отдельный домен вывода, чтобы не совпадать с SECRET_KEY.
        raw = (os.environ.get('SECRET_KEY') or 'vertu-dev-signing-key').strip()
        raw = 'game-signing:' + raw
    return hashlib.sha256(raw.encode('utf-8')).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def sign(payload: str) -> str:
    """Подпись строки: HMAC-SHA256 по ключу игры, base64url без паддинга."""
    return _b64(hmac.new(_key(), payload.encode('utf-8'), hashlib.sha256).digest())


def issue(user_id: int, game: str, amount: int, kind: str = 'game',
          ttl: int | None = None, extra: str = '') -> dict:
    """Создать билет игровой сессии.

    ``amount`` — сколько V сервер готов заплатить за одно событие этой игры
    (берётся из каталога, а не из запроса). ``sid`` — одноразовый идентификатор,
    он же квитанция идемпотентности в ``game_receipts``.
    """
    amount = max(0, int(amount))
    ttl = TTL if ttl is None else max(5, int(ttl))
    issued = int(time.time())
    sid = secrets.token_urlsafe(18)
    body = '|'.join([VERSION, kind, str(int(user_id)), game, str(amount),
                     str(issued), str(issued + ttl), sid, extra])
    return {
        'sid': sid, 'game': game, 'kind': kind, 'amount': amount,
        'issuedAt': issued, 'expiresAt': issued + ttl,
        'sig': sign(body), 'version': VERSION,
    }


def verify(ticket: dict, user_id: int, game: str | None = None,
           kind: str = 'game', now: int | None = None) -> dict:
    """Проверить билет и вернуть его разобранное содержимое.

    Бросает :class:`TicketError` при любой несостыковке — вызывающая сторона
    превращает это в 400/403, не раскрывая деталей клиенту.
    """
    if not isinstance(ticket, dict):
        raise TicketError('нет билета')
    try:
        sid = str(ticket['sid'])
        t_game = str(ticket['game'])
        amount = int(ticket['amount'])
        issued = int(ticket['issuedAt'])
        expires = int(ticket['expiresAt'])
        sig = str(ticket['sig'])
        t_kind = str(ticket.get('kind') or 'game')
        extra = str(ticket.get('extra') or '')
    except (KeyError, TypeError, ValueError) as exc:
        raise TicketError('билет повреждён') from exc

    if len(sid) < 16 or len(sid) > 64:
        raise TicketError('плохой sid')
    if kind and t_kind != kind:
        raise TicketError('билет другого типа')
    if game is not None and t_game != game:
        raise TicketError('билет другой игры')

    body = '|'.join([VERSION, t_kind, str(int(user_id)), t_game, str(amount),
                     str(issued), str(expires), sid, extra])
    if not hmac.compare_digest(sign(body), sig):
        # Подпись не сходится: билет выдан другому пользователю, другой игре
        # или подделан. Сравнение постоянное по времени.
        raise TicketError('подпись не сходится')

    moment = int(time.time()) if now is None else int(now)
    if moment > expires:
        raise TicketError('билет истёк')
    if issued > moment + 300:
        raise TicketError('билет из будущего')
    if amount < 0 or amount > 100000:
        raise TicketError('некорректная сумма')
    return {'sid': sid, 'game': t_game, 'kind': t_kind, 'amount': amount,
            'issuedAt': issued, 'expiresAt': expires}


def receipt_for(user_id: int, ticket: dict) -> str:
    """Ключ идемпотентности: один билет = одна выплата."""
    return 'ticket:%s:%s' % (ticket['game'], ticket['sid'])


def describe() -> dict[str, Any]:
    """Диагностика для /api/health (без раскрытия ключа)."""
    return {'enabled': True, 'ttl': TTL, 'version': VERSION,
            'explicitKey': bool((os.environ.get('GAME_SIGNING_KEY') or '').strip())}
