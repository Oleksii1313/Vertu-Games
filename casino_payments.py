"""VertGames shop: coin packs paid with real money (YooKassa, Stripe, CryptoBot).

Design notes
------------
* Prices and coin amounts live here, on the server. The browser never sends an
  amount that we trust: it only names a pack. Webhooks are verified with the
  provider (signature or an authenticated re-query) before an order becomes paid.
* Coins are still credited by the browser in this phase (balances are local,
  see database.js). The server keeps the audited ledger: order -> paid -> claimed.
  `POST /api/shop/claim` can be called once per order, so a reload, a second tab
  or a retried request cannot credit the same purchase twice.
* Nothing is charged and no network request is made while `SHOP_PROVIDER` is
  unset: the API answers 503 and the UI stays in demo mode.
* Secrets are read from the environment only. Never put them in HTML or git.

Environment
-----------
SHOP_PROVIDER=yookassa|stripe|cryptobot   (unset = payments disabled)
PUBLIC_URL=https://site.example           (used for redirects and returns)
YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
CRYPTOBOT_TOKEN
"""
import base64, hashlib, hmac, json, os, secrets, time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

PACKS = {
    'start': {'coins': 1000, 'rub': 99, 'usd': 1.5, 'title': 'Старт / Start', 'title_en': 'Start'},
    'major': {'coins': 6050, 'rub': 449, 'usd': 5.9, 'title': 'Мажор / Major', 'title_en': 'Major'},
    'whale': {'coins': 18000, 'rub': 990, 'usd': 12.9, 'title': 'Кит / Whale', 'title_en': 'Whale'},
}
PROVIDERS = ('yookassa', 'stripe', 'cryptobot')
TOLERANCE = 300          # seconds, Stripe replay window
TIMEOUT = 20


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


def init_db(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS shop_orders (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL, pack TEXT NOT NULL,
        coins INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
        status TEXT NOT NULL, provider_ref TEXT, claimed INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL, paid INTEGER
    );
    CREATE TABLE IF NOT EXISTS shop_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, user_id INTEGER, coins INTEGER,
        reason TEXT NOT NULL, provider_ref TEXT, created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shop_orders_user ON shop_orders(user_id, created);
    CREATE UNIQUE INDEX IF NOT EXISTS shop_ledger_order ON shop_ledger(order_id) WHERE order_id IS NOT NULL;
    ''')


def public_shop():
    return {'ok': True, 'provider': provider(), 'configured': configured(),
            'packs': [{'id': k, 'coins': v['coins'], 'rub': v['rub'], 'usd': v['usd'], 'title': v['title_en']} for k, v in PACKS.items()]}


# --------------------------------------------------------------------------- HTTP
def _request(method, url, body=None, headers=None, form=False):
    """Minimal JSON/form client. Returns (status_code, raw_bytes)."""
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


# --------------------------------------------------------------------------- providers
def yookassa_create(order, return_url):
    shop, key = env('YOOKASSA_SHOP_ID'), env('YOOKASSA_SECRET_KEY')
    auth = base64.b64encode(f'{shop}:{key}'.encode()).decode()
    status, raw = _request('POST', 'https://api.yookassa.ru/v3/payments', {
        'amount': {'value': f"{order['amount_minor'] / 100:.2f}", 'currency': 'RUB'},
        'capture': True,
        'confirmation': {'type': 'redirect', 'return_url': return_url},
        'description': f"VertGames: {PACKS[order['pack']]['title']}",
        'metadata': {'order_id': order['id']},
    }, headers={'Authorization': 'Basic ' + auth, 'Idempotence-Key': order['id']})
    data = _json(status, raw)
    url = (data.get('confirmation') or {}).get('confirmation_url')
    if status >= 300 or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'ЮKassa не создала платёж. Попробуйте позже.')
    return data.get('id'), url


def yookassa_paid(reference):
    """YooKassa notifications are not signed: re-query the payment with our keys."""
    shop, key = env('YOOKASSA_SHOP_ID'), env('YOOKASSA_SECRET_KEY')
    auth = base64.b64encode(f'{shop}:{key}'.encode()).decode()
    status, raw = _request('GET', 'https://api.yookassa.ru/v3/payments/' + reference, None, {'Authorization': 'Basic ' + auth})
    data = _json(status, raw)
    if status != 200 or data.get('status') != 'succeeded' or data.get('paid') is not True:
        raise ShopError(400, 'NOT_PAID', 'Платёж не подтверждён.')
    return data


def stripe_create(order, success_url, cancel_url):
    key = env('STRIPE_SECRET_KEY')
    pack = PACKS[order['pack']]
    status, raw = _request('POST', 'https://api.stripe.com/v1/checkout/sessions', {
        'mode': 'payment',
        'success_url': success_url,
        'cancel_url': cancel_url,
        'client_reference_id': order['id'],
        'metadata[order_id]': order['id'],
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': str(order['amount_minor']),
        'line_items[0][price_data][product_data][name]': f'{pack["coins"]} V — VertGames',
    }, headers={'Authorization': 'Bearer ' + key}, form=True)
    data = _json(status, raw)
    url = data.get('url')
    if status >= 300 or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'Stripe не создал сессию оплаты. Попробуйте позже.')
    return data.get('id'), url


def cryptobot_create(order, return_url):
    status, raw = _request('POST', 'https://pay.crypt.bot/api/createInvoice', {
        'currency_type': 'fiat', 'fiat': 'RUB', 'amount': f"{order['amount_minor'] / 100:.2f}",
        'description': f"VertGames: {PACKS[order['pack']]['title']}",
        'payload': order['id'], 'paid_btn_name': 'callback', 'paid_btn_url': return_url,
    }, headers={'Crypto-Pay-API-Token': env('CRYPTOBOT_TOKEN')})
    data = _json(status, raw).get('result') or {}
    url = data.get('bot_invoice_url') or data.get('mini_app_invoice_url')
    if status >= 300 or not data.get('invoice_id') or not isinstance(url, str) or not url.startswith('https://'):
        raise ShopError(502, 'PROVIDER_ERROR', 'CryptoBot не создал счёт. Попробуйте позже.')
    return str(data['invoice_id']), url


def cryptobot_paid(invoice_id):
    """Second check after the signature: ask CryptoBot for the authoritative status."""
    status, raw = _request('GET', 'https://pay.crypt.bot/api/getInvoices?' + urlencode({'invoice_ids': invoice_id}),
                           None, {'Crypto-Pay-API-Token': env('CRYPTOBOT_TOKEN')})
    items = (_json(status, raw).get('result') or {}).get('items') or []
    item = items[0] if items else {}
    if status != 200 or item.get('status') != 'paid':
        raise ShopError(400, 'NOT_PAID', 'Счёт не оплачен.')
    return item


# --------------------------------------------------------------------------- webhook checks
def stripe_signature_ok(raw_body, header, secret=None, tolerance=TOLERANCE):
    """Stripe-Signature: t=<ts>,v1=<hex>; HMAC-SHA256(ts + '.' + raw body)."""
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
    """crypto-pay-api-signature = HMAC-SHA256(key=SHA256(token), msg=raw body)."""
    token = token or env('CRYPTOBOT_TOKEN')
    if not token or not header:
        return False
    key = hashlib.sha256(token.encode()).digest()
    expected = hmac.new(key, raw_body, hashlib.sha256).hexdigest().encode()
    return hmac.compare_digest(expected, header.strip().encode())


# --------------------------------------------------------------------------- orders
def _row(c, order_id):
    return c.execute('SELECT * FROM shop_orders WHERE id=?', (order_id,)).fetchone()


def mark_paid(c, order, reference):
    """Idempotent: a repeated webhook never credits the same order twice."""
    c.execute('BEGIN IMMEDIATE')
    fresh = _row(c, order['id'])
    if not fresh or fresh['status'] == 'paid':
        return False
    c.execute('UPDATE shop_orders SET status=?, paid=?, provider_ref=? WHERE id=?',
              ('paid', int(time.time()), reference, order['id']))
    c.execute('INSERT INTO shop_ledger(order_id,user_id,coins,reason,provider_ref,created) VALUES(?,?,?,?,?,?)',
              (order['id'], fresh['user_id'], fresh['coins'], 'purchase', reference, int(time.time())))
    return True


def create_order(handler, data, backend):
    if not configured():
        return handler.error(503, 'PAYMENTS_NOT_CONFIGURED',
                             'Платёжный шлюз не подключён. Включите демо-режим или настройте ЮKassa, Stripe либо CryptoBot.')
    user = handler.session()
    if not user:
        return handler.error(401, 'LOGIN_REQUIRED', 'Сначала войдите в аккаунт, чтобы купить монеты.')
    if not handler.rate('shop_order', 12, 600):
        return
    pack_id = str(data.get('pack', ''))
    if pack_id not in PACKS:
        return handler.error(400, 'PACK', 'Неизвестный пакет монет.')
    pack = PACKS[pack_id]
    current = provider()
    currency = 'USD' if current == 'stripe' else 'RUB'
    amount_minor = int(round((pack['usd'] if currency == 'USD' else pack['rub'] * 1.0) * (100 if currency == 'USD' else 100)))
    order = {'id': secrets.token_urlsafe(18), 'user_id': user['id'], 'pack': pack_id, 'coins': pack['coins'],
             'amount_minor': amount_minor, 'currency': currency}
    with backend.connect() as c:
        c.execute('INSERT INTO shop_orders VALUES(?,?,?,?,?,?,?,?,?,0,?,NULL)',
                  (order['id'], order['user_id'], current, pack_id, pack['coins'], amount_minor, currency,
                   'new', None, int(time.time())))
    base = env('PUBLIC_URL').rstrip('/') + '/casino.html'
    return_url = base + '?' + urlencode({'paid': '1', 'order': order['id']})
    cancel_url = base + '?' + urlencode({'cancelled': '1'})
    try:
        if current == 'yookassa':
            reference, url = yookassa_create(order, return_url)
        elif current == 'stripe':
            reference, url = stripe_create(order, return_url, cancel_url)
        else:
            reference, url = cryptobot_create(order, return_url)
    except ShopError as exc:
        with backend.connect() as c:
            c.execute('UPDATE shop_orders SET status=? WHERE id=?', ('failed', order['id']))
        return handler.error(exc.status, exc.code, exc.message)
    with backend.connect() as c:
        c.execute('UPDATE shop_orders SET provider_ref=? WHERE id=?', (reference, order['id']))
    handler.reply(200, {'ok': True, 'orderId': order['id'], 'redirectUrl': url, 'coins': pack['coins'], 'amount': amount_minor / 100, 'currency': currency})


def order_status(handler, backend):
    user = handler.session()
    if not user:
        return handler.error(401, 'LOGIN_REQUIRED', 'Войдите в аккаунт.')
    from urllib.parse import parse_qs, urlparse
    order_id = parse_qs(urlparse(handler.path).query).get('order', [''])[0]
    with backend.connect() as c:
        row = c.execute('SELECT * FROM shop_orders WHERE id=? AND user_id=?', (order_id, user['id'])).fetchone()
    if not row:
        return handler.error(404, 'NOT_FOUND', 'Заказ не найден.')
    handler.reply(200, {'ok': True, 'orderId': row['id'], 'status': row['status'], 'nodes': None,
                        'coins': row['coins'], 'pack': row['pack'], 'claimed': bool(row['claimed'])})


def claim(handler, data, backend):
    """Browser-side credit happens once per paid order; the server keeps the flag."""
    user = handler.session()
    if not user:
        return handler.error(401, 'LOGIN_REQUIRED', 'Войдите в аккаунт.')
    order_id = str(data.get('order', ''))
    with backend.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT * FROM shop_orders WHERE id=? AND user_id=?', (order_id, user['id'])).fetchone()
        if not row:
            return handler.error(404, 'NOT_FOUND', 'Заказ не найден.')
        if row['status'] != 'paid':
            return handler.error(409, 'NOT_PAID', 'Оплата ещё не подтверждена. Обновите страницу через минуту.')
        if row['claimed']:
            return handler.reply(200, {'ok': True, 'coins': row['coins'], 'already': True})
        c.execute('UPDATE shop_orders SET claimed=1 WHERE id=?', (order_id,))
    handler.reply(200, {'ok': True, 'coins': row['coins'], 'already': False})


def wallet(handler, backend):
    """Summary for the browser: purchases on this account and the local mode flag."""
    user = handler.session()
    if not user:
        return handler.reply(200, {'ok': True, 'mode': 'local', 'configured': configured(), 'purchases': []})
    with backend.connect() as c:
        rows = c.execute('SELECT pack,coins,status,created FROM shop_orders WHERE user_id=? ORDER BY created DESC LIMIT 10',
                         (user['id'],)).fetchall()
    handler.reply(200, {'ok': True, 'mode': 'server' if configured() else 'local', 'configured': configured(),
                        'purchases': [{'pack': r['pack'], 'coins': r['coins'], 'status': r['status'], 'created': r['created']} for r in rows]})


# --------------------------------------------------------------------------- webhooks
def webhook(handler, kind, backend):
    raw = getattr(handler, 'raw_body', b'') or b''
    if kind == 'stripe':
        if not stripe_signature_ok(raw, handler.headers.get('Stripe-Signature', '')):
            return handler.error(400, 'SIGNATURE', 'Invalid signature')
        event = _json(200, raw)
        if event.get('type') != 'checkout.session.completed':
            return handler.reply(200, {'ok': True, 'ignored': event.get('type')})
        session = event.get('object') or {}
        order_id = session.get('client_reference_id') or (session.get('metadata') or {}).get('order_id') or ''
        reference = session.get('id') or ''
        if session.get('payment_status') != 'paid':
            return handler.reply(200, {'ok': True, 'ignored': 'unpaid'})
        with backend.connect() as c:
            order = _row(c, order_id)
            if not order or order['provider'] != 'stripe':
                return handler.error(404, 'NOT_FOUND', 'Unknown order')
            if int(session.get('amount_total') or 0) < int(order['amount_minor']):
                return handler.error(400, 'AMOUNT', 'Amount mismatch')
            mark_paid(c, order, reference)
        return handler.reply(200, {'ok': True})

    if kind == 'cryptobot':
        if not cryptobot_signature_ok(raw, handler.headers.get('crypto-pay-api-signature', '')):
            return handler.error(401, 'SIGNATURE', 'Invalid signature')
        update = _json(200, raw)
        if update.get('update_type') != 'invoice_paid':
            return handler.reply(200, {'ok': True, 'ignored': update.get('update_type')})
        invoice = update.get('payload') or {}
        order_id = str(invoice.get('payload') or '')
        try:
            cryptobot_paid(str(invoice.get('invoice_id') or ''))
        except ShopError as exc:
            return handler.error(exc.status, exc.code, exc.message)
        with backend.connect() as c:
            order = _row(c, order_id)
            if not order or order['provider'] != 'cryptobot':
                return handler.error(404, 'NOT_FOUND', 'Unknown order')
            if int(float(invoice.get('amount') or 0) * 100 + 0.5) < int(order['amount_minor']):
                return handler.error(400, 'AMOUNT', 'Amount mismatch')
            mark_paid(c, order, str(invoice.get('invoice_id') or ''))
        return handler.reply(200, {'ok': True})

    if kind == 'yookassa':
        event = _json(200, raw)
        if event.get('event') != 'payment.succeeded':
            return handler.reply(200, {'ok': True, 'ignored': event.get('event')})
        obj = event.get('object') or {}
        order_id = (obj.get('metadata') or {}).get('order_id', '')
        with backend.connect() as c:
            order = _row(c, order_id)
            if not order or order['provider'] != 'yookassa':
                return handler.error(404, 'NOT_FOUND', 'Unknown order')
        try:
            payment = yookassa_paid(str(obj.get('id') or ''))
        except ShopError as exc:
            return handler.error(exc.status, exc.code, exc.message)
        value = ((payment.get('amount') or {}).get('value') or '0')
        try:
            paid_minor = int(float(value) * 100 + 0.5)
        except ValueError:
            paid_minor = 0
        if paid_minor < int(order['amount_minor']) or (payment.get('metadata') or {}).get('order_id') != order['id']:
            return handler.error(400, 'AMOUNT', 'Amount mismatch')
        with backend.connect() as c:
            mark_paid(c, order, str(payment.get('id') or ''))
        return handler.reply(200, {'ok': True})

    return handler.error(404, 'NOT_FOUND', 'Unknown webhook')
