#!/usr/bin/env python3
"""Магазин Vertu Games: каталог, покупки, экипировка.

Покупка — одна серверная транзакция: списание V и запись покупки. Повторная
покупка того же предмета отклоняется. Экипировать можно только купленное.
Пакеты V за реальные деньги включаются только при настроенном ``SHOP_PROVIDER``.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import db as store
from game_catalog import SHOP_KINDS, SHOP_PACKS

PROVIDERS = ('yookassa', 'stripe', 'cryptobot')
TOLERANCE = 300
TIMEOUT = 20


class NotOwned(Exception):
    """Предмет не куплен — HTTP 403."""


class ShopError(Exception):
    def __init__(self, status=400, code='SHOP_ERROR', message='Ошибка оплаты'):
        super().__init__(code)
        self.status, self.code, self.message = status, code, message


def env(name, default=''):
    return os.environ.get(name, default).strip()


def provider():
    value = env('SHOP_PROVIDER').lower()
    return value if value in PROVIDERS else ''


def configured():
    p = provider()
    if p == 'yookassa':
        return bool(env('YOOKASSA_SHOP_ID') and env('YOOKASSA_SECRET_KEY') and env('PUBLIC_URL'))
    if p == 'stripe':
        return bool(env('STRIPE_SECRET_KEY') and env('STRIPE_WEBHOOK_SECRET') and env('PUBLIC_URL'))
    if p == 'cryptobot':
        return bool(env('CRYPTOBOT_TOKEN') and env('PUBLIC_URL'))
    return False


# --------------------------------------------------------------------------- каталог
def catalog(user_id: int | None = None) -> dict:
    """Каталог для браузера: предметы, цены и что уже куплено."""
    data = store.get_store()
    items = data.shop_items()
    owned = data.owned_ids(user_id) if user_id else set()
    user = data.get_user(user_id) if user_id else None
    equipped = {'avatar': user['avatar'], 'color': user['color'], 'title': user['title']} if user else {}
    out = []
    for item in items:
        out.append({
            'id': item['id'], 'kind': item['kind'], 'name_ru': item['name_ru'],
            'name_en': item['name_en'], 'price': int(item['price']), 'icon': item['icon'],
            'payload': item['payload'], 'owned': item['id'] in owned or int(item['price']) == 0,
            'equipped': equipped.get(item['kind']) == item['id'],
        })
    packs = []
    if configured():
        for pid, pack in SHOP_PACKS.items():
            packs.append({'id': pid, 'coins': pack['coins'], 'rub': pack['rub'], 'usd': pack['usd'],
                          'title_ru': pack['title_ru'], 'title_en': pack['title_en']})
    return {'ok': True, 'kinds': SHOP_KINDS, 'items': out, 'packs': packs,
            'payments': {'provider': provider(), 'configured': configured()}}


def buy(user_id: int, item_id: str) -> dict:
    data = store.get_store()
    result = data.buy_item(user_id, item_id)
    item = result['item']
    payload = {'ok': True, 'already': result['already'], 'balance': result['balance'],
               'item': {'id': item['id'], 'kind': item['kind'], 'name_ru': item['name_ru'],
                        'name_en': item['name_en'], 'payload': item['payload'],
                        'price': int(item['price'])}}
    if item['kind'] == 'boost' and not result['already']:
        try:
            amount = int(item['payload'])
        except (TypeError, ValueError):
            amount = 0
        if amount > 0:
            credited = data.add_coins(user_id, amount, 'shop', f'Бонус: {item["name_ru"]}',
                                     f'boost:{user_id}:{item["id"]}')
            payload['balance'] = credited['balance']
            payload['boost'] = amount
    payload['achievements'] = grant_achievements(user_id)
    # Достижения могут начислить V — показываем актуальный баланс.
    payload['balance'] = data.balance(user_id)
    return payload


def equip(user_id: int, item_id: str, kind: str | None = None) -> dict:
    data = store.get_store()
    items = {i['id']: i for i in data.shop_items()}
    item = items.get(item_id)
    if not item:
        raise store.NotFound('Предмет не найден')
    if kind and item['kind'] != kind:
        raise store.StoreError('Несовпадение типа предмета')
    if int(item['price']) > 0 and item_id not in data.owned_ids(user_id):
        raise NotOwned('Сначала купите этот предмет')
    field = {'avatar': 'avatar', 'color': 'color', 'title': 'title'}.get(item['kind'])
    if not field:
        raise store.StoreError('Этот предмет нельзя экипировать')
    data.update_profile(user_id, **{field: item_id})
    return {'ok': True, 'equipped': {item['kind']: item_id}}


def grant_achievements(user_id: int) -> list:
    """Проверить покупки/баланс и выдать достижения (идемпотентно)."""
    data = store.get_store()
    unlocked = []
    owned = data.owned_ids(user_id)
    if len(owned) >= 1:
        item = data.unlock_achievement(user_id, 'first_shop')
        if item:
            unlocked.append(item)
    if len(owned) >= 5:
        item = data.unlock_achievement(user_id, 'collector')
        if item:
            unlocked.append(item)
    if data.balance(user_id) >= 5000:
        item = data.unlock_achievement(user_id, 'balance_5k')
        if item:
            unlocked.append(item)
    return unlocked


# --------------------------------------------------------------------------- HTTP
def _request(method, url, body=None, headers=None, form=False):
    data = None
    headers = dict(headers or {})
    if body is not None:
        if form:
            data = urlencode(body).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        else:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read()
    except HTTPError as exc:
        return exc.code, exc.read() or b''
    except (URLError, TimeoutError) as exc:
        raise ShopError(502, 'PROVIDER_UNAVAILABLE', 'Платёжный сервис недоступен. Попробуйте позже.') from exc


def _json(status, raw):
    try:
        return json.loads(raw.decode() or '{}')
    except (ValueError, UnicodeError):
        return {}


def yookassa_create(order, return_url):
    shop, key = env('YOOKASSA_SHOP_ID'), env('YOOKASSA_SECRET_KEY')
    auth = base64.b64encode(f'{shop}:{key}'.encode()).decode()
    status, raw = _request('POST', 'https://api.yookassa.ru/v3/payments', {
        'amount': {'value': f"{order['amount_minor'] / 100:.2f}", 'currency': 'RUB'},
        'capture': True,
        'confirmation': {'type': 'redirect', 'return_url': return_url},
        'description': f"Vertu Games: {SHOP_PACKS[order['pack']]['title_ru']}",
        'metadata': {'order_id': order['id']},
    }, headers={'Authorization': 'Basic ' + auth, 'Idempotence-Key': order['id']})
    data = _json(status, raw)
    url = (data.get('confirmation') or {}).get('confirmation_url')
    if status >= 300 or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'ЮKassa не создала платёж. Попробуйте позже.')
    return data.get('id'), url


def yookassa_paid(reference):
    shop, key = env('YOOKASSA_SHOP_ID'), env('YOOKASSA_SECRET_KEY')
    auth = base64.b64encode(f'{shop}:{key}'.encode()).decode()
    status, raw = _request('GET', 'https://api.yookassa.ru/v3/payments/' + reference, None,
                           {'Authorization': 'Basic ' + auth})
    data = _json(status, raw)
    if status != 200 or data.get('status') != 'succeeded' or data.get('paid') is not True:
        raise ShopError(400, 'NOT_PAID', 'Платёж не подтверждён.')
    return data


def stripe_create(order, success_url, cancel_url):
    key = env('STRIPE_SECRET_KEY')
    pack = SHOP_PACKS[order['pack']]
    status, raw = _request('POST', 'https://api.stripe.com/v1/checkout/sessions', {
        'mode': 'payment',
        'success_url': success_url,
        'cancel_url': cancel_url,
        'client_reference_id': order['id'],
        'metadata[order_id]': order['id'],
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': str(order['amount_minor']),
        'line_items[0][price_data][product_data][name]': f'{pack["coins"]} V — Vertu Games',
    }, headers={'Authorization': 'Bearer ' + key}, form=True)
    data = _json(status, raw)
    url = data.get('url')
    if status >= 300 or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'Stripe не создал сессию оплаты. Попробуйте позже.')
    return data.get('id'), url


def cryptobot_create(order, return_url):
    status, raw = _request('POST', 'https://pay.crypt.bot/api/createInvoice', {
        'currency_type': 'fiat', 'fiat': 'RUB', 'amount': f"{order['amount_minor'] / 100:.2f}",
        'description': f"Vertu Games: {SHOP_PACKS[order['pack']]['title_ru']}",
        'payload': order['id'], 'paid_btn_name': 'callback', 'paid_btn_url': return_url,
    }, headers={'Crypto-Pay-API-Token': env('CRYPTOBOT_TOKEN')})
    data = _json(status, raw).get('result') or {}
    url = data.get('bot_invoice_url') or data.get('mini_app_invoice_url')
    if status >= 300 or not data.get('invoice_id') or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'CryptoBot не создал счёт. Попробуйте позже.')
    return str(data['invoice_id']), url


def cryptobot_paid(invoice_id):
    status, raw = _request('GET', 'https://pay.crypt.bot/api/getInvoices?' + urlencode({'invoice_ids': invoice_id}),
                           None, {'Crypto-Pay-API-Token': env('CRYPTOBOT_TOKEN')})
    items = (_json(status, raw).get('result') or {}).get('items') or []
    item = items[0] if items else {}
    if status != 200 or item.get('status') != 'paid':
        raise ShopError(400, 'NOT_PAID', 'Счёт не оплачен.')
    return item


def stripe_signature_ok(raw_body, header, secret=None, tolerance=TOLERANCE):
    secret = secret or env('STRIPE_WEBHOOK_SECRET')
    if not secret or not header:
        return False
    stamps, signatures = [], []
    for part in header.split(','):
        name, _, value = part.strip().partition('=')
        if name == 't':
            stamps.append(value)
        elif name == 'v1' and value:
            signatures.append(value)
    if len(stamps) != 1 or not signatures:
        return False
    try:
        stamp = int(stamps[0])
    except ValueError:
        return False
    if abs(int(time.time()) - stamp) > tolerance:
        return False
    expected = hmac.new(secret.encode(), stamps[0].encode() + b'.' + raw_body, hashlib.sha256).hexdigest().encode()
    return any(hmac.compare_digest(expected, sig.encode()) for sig in signatures)


def cryptobot_signature_ok(raw_body, header, token=None):
    token = token or env('CRYPTOBOT_TOKEN')
    if not token or not header:
        return False
    key = hashlib.sha256(token.encode()).digest()
    expected = hmac.new(key, raw_body, hashlib.sha256).hexdigest().encode()
    return hmac.compare_digest(expected, header.strip().encode())


# --------------------------------------------------------------------------- заказы
def create_order(user_id: int, pack_id: str, base_url: str) -> dict:
    if not configured():
        raise ShopError(503, 'PAYMENTS_NOT_CONFIGURED',
                        'Покупка монет за деньги не подключена. V-монеты зарабатываются в играх.')
    if pack_id not in SHOP_PACKS:
        raise ShopError(400, 'PACK', 'Неизвестный пакет монет.')
    pack = SHOP_PACKS[pack_id]
    current = provider()
    currency = 'USD' if current == 'stripe' else 'RUB'
    amount_minor = int(round((pack['usd'] if currency == 'USD' else pack['rub']) * 100))
    order = {'id': secrets.token_urlsafe(18), 'user_id': int(user_id), 'provider': current,
             'pack': pack_id, 'coins': pack['coins'], 'amount_minor': amount_minor,
             'currency': currency, 'created': int(time.time())}
    data = store.get_store()
    data.create_order(order)
    return_url = base_url.rstrip('/') + '/shop.html?' + urlencode({'paid': '1', 'order': order['id']})
    cancel_url = base_url.rstrip('/') + '/shop.html?' + urlencode({'cancelled': '1'})
    try:
        if current == 'yookassa':
            reference, url = yookassa_create(order, return_url)
        elif current == 'stripe':
            reference, url = stripe_create(order, return_url, cancel_url)
        else:
            reference, url = cryptobot_create(order, return_url)
    except ShopError:
        data.fail_order(order['id'])
        raise
    data.set_order_ref(order['id'], reference)
    return {'ok': True, 'orderId': order['id'], 'redirectUrl': url, 'coins': pack['coins'],
            'amount': amount_minor / 100, 'currency': currency}


def claim(user_id: int, order_id: str) -> dict:
    data = store.get_store()
    result = data.claim_order(order_id, user_id)
    grant_achievements(user_id)
    return {'ok': True, 'coins': result['coins'], 'balance': result['balance'],
            'already': result['already']}


def wallet(user_id: int | None) -> dict:
    data = store.get_store()
    if not user_id:
        return {'ok': True, 'mode': 'guest', 'configured': configured(), 'purchases': []}
    return {'ok': True, 'mode': 'server' if configured() else 'coins-only',
            'configured': configured(),
            'purchases': [{'pack': r['pack'], 'coins': int(r['coins']), 'status': r['status'],
                           'created': r['created']} for r in data.order_history(user_id)]}


def webhook(kind: str, raw: bytes, headers) -> tuple[int, dict]:
    data = store.get_store()
    if kind == 'stripe':
        if not stripe_signature_ok(raw, headers.get('Stripe-Signature', '')):
            return 400, {'ok': False, 'code': 'SIGNATURE'}
        event = _json(200, raw)
        if event.get('type') != 'checkout.session.completed':
            return 200, {'ok': True, 'ignored': event.get('type')}
        session = event.get('object') or {}
        order_id = session.get('client_reference_id') or (session.get('metadata') or {}).get('order_id') or ''
        order = data.order(order_id)
        if not order or order['provider'] != 'stripe':
            return 404, {'ok': False, 'code': 'NOT_FOUND'}
        if session.get('payment_status') != 'paid':
            return 200, {'ok': True, 'ignored': 'unpaid'}
        if int(session.get('amount_total') or 0) < int(order['amount_minor']):
            return 400, {'ok': False, 'code': 'AMOUNT'}
        data.mark_order_paid(order_id, session.get('id') or '')
        return 200, {'ok': True}

    if kind == 'cryptobot':
        if not cryptobot_signature_ok(raw, headers.get('crypto-pay-api-signature', '')):
            return 401, {'ok': False, 'code': 'SIGNATURE'}
        update = _json(200, raw)
        if update.get('update_type') != 'invoice_paid':
            return 200, {'ok': True, 'ignored': update.get('update_type')}
        invoice = update.get('payload') or {}
        order_id = str(invoice.get('payload') or '')
        try:
            cryptobot_paid(str(invoice.get('invoice_id') or ''))
        except ShopError as exc:
            return exc.status, {'ok': False, 'code': exc.code}
        order = data.order(order_id)
        if not order or order['provider'] != 'cryptobot':
            return 404, {'ok': False, 'code': 'NOT_FOUND'}
        if int(float(invoice.get('amount') or 0) * 100 + 0.5) < int(order['amount_minor']):
            return 400, {'ok': False, 'code': 'AMOUNT'}
        data.mark_order_paid(order_id, str(invoice.get('invoice_id') or ''))
        return 200, {'ok': True}

    if kind == 'yookassa':
        event = _json(200, raw)
        if event.get('event') != 'payment.succeeded':
            return 200, {'ok': True, 'ignored': event.get('event')}
        obj = event.get('object') or {}
        order_id = (obj.get('metadata') or {}).get('order_id', '')
        order = data.order(order_id)
        if not order or order['provider'] != 'yookassa':
            return 404, {'ok': False, 'code': 'NOT_FOUND'}
        try:
            payment = yookassa_paid(str(obj.get('id') or ''))
        except ShopError as exc:
            return exc.status, {'ok': False, 'code': exc.code}
        value = ((payment.get('amount') or {}).get('value') or '0')
        try:
            paid_minor = int(float(value) * 100 + 0.5)
        except ValueError:
            paid_minor = 0
        if paid_minor < int(order['amount_minor']) or (payment.get('metadata') or {}).get('order_id') != order['id']:
            return 400, {'ok': False, 'code': 'AMOUNT'}
        data.mark_order_paid(order['id'], str(payment.get('id') or ''))
        return 200, {'ok': True}

    return 404, {'ok': False, 'code': 'NOT_FOUND'}
