"""Offline tests for the casino coin shop (no real provider requests).
Run: python3 -m unittest discover -s tools -p test_casino_payments.py -v
Network calls to YooKassa / Stripe / CryptoBot are patched.
"""
import hashlib, hmac, json, os, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
import server
import casino_payments as shop


def sign_stripe(body, secret, timestamp=None):
    stamp = str(int(timestamp if timestamp is not None else time.time()))
    digest = hmac.new(secret.encode(), stamp.encode() + b'.' + body, hashlib.sha256).hexdigest()
    return f't={stamp},v1={digest}'


def sign_cryptobot(body, token):
    key = hashlib.sha256(token.encode()).digest()
    return hmac.new(key, body, hashlib.sha256).hexdigest()


class CasinoShopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_db = server.DB
        cls.folder = tempfile.TemporaryDirectory()
        server.DB = Path(cls.folder.name) / 'shop.sqlite3'
        server.init_db()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()
        server.DB = cls.original_db; cls.folder.cleanup()

    def setUp(self):
        with server.connect() as c:
            for table in ('shop_orders', 'shop_ledger', 'sessions', 'users', 'limits', 'pending',
                          'google_flows', 'google_identities'):
                c.execute('DELETE FROM ' + table)
        env = patch.dict(os.environ, {'PUBLIC_URL': self.base, 'SHOP_PROVIDER': 'stripe',
                                      'STRIPE_SECRET_KEY': 'sk_test_offline', 'STRIPE_WEBHOOK_SECRET': 'whsec_offline',
                                      'CRYPTOBOT_TOKEN': '12345:offline-token',
                                      'YOOKASSA_SHOP_ID': 'shop', 'YOOKASSA_SECRET_KEY': 'secret'})
        env.start(); self.addCleanup(env.stop)
        self.client = requests.Session(); self.addCleanup(self.client.close)
        self.user_id = self.create_user()

    def create_user(self):
        with server.connect() as c:
            cur = c.execute('INSERT INTO users(username,username_key,email,email_key,password,created,verified) '
                            'VALUES(?,?,?,?,?,?,?)',
                            ('pays', 'pays', 'pays@example.com', 'pays@example.com',
                             server.password_hash('long-unique-password'), server.now(), server.now()))
            return cur.lastrowid

    def login(self):
        r = self.client.post(self.base + '/api/auth/login',
                             json={'identifier': 'pays', 'password': 'long-unique-password'},
                             headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200, r.text)

    def make_order(self, pack='major', provider='stripe'):
        with patch.object(shop, 'stripe_create', return_value=('cs_test_1', 'https://checkout.stripe.com/x')), \
             patch.object(shop, 'yookassa_create', return_value=('yk_1', 'https://yoomoney.ru/x')), \
             patch.object(shop, 'cryptobot_create', return_value=('77', 'https://t.me/CryptoBot?start=x')):
            r = self.client.post(self.base + '/api/shop/order', json={'pack': pack, 'method': 'cards'},
                                 headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data['redirectUrl'].startswith('https://'))
        return data['orderId']

    # ---------------------------------------------------------------- basics
    def test_packs_are_public_and_prices_come_from_server(self):
        r = self.client.get(self.base + '/api/shop/packs')
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data['ok'])
        self.assertTrue(data['configured'])
        self.assertEqual({p['id'] for p in data['packs']}, {'start', 'major', 'whale'})

    def test_order_requires_login_and_valid_pack(self):
        r = self.client.post(self.base + '/api/shop/order', json={'pack': 'major'}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 401)
        self.login()
        r = self.client.post(self.base + '/api/shop/order', json={'pack': 'free-money'}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 400)
        # цена берётся из PACKS, а не из тела запроса
        order = self.make_order('whale')
        with server.connect() as c:
            row = c.execute('SELECT * FROM shop_orders WHERE id=?', (order,)).fetchone()
        self.assertEqual(row['coins'], shop.PACKS['whale']['coins'])
        self.assertEqual(row['status'], 'new')

    def test_payments_disabled_returns_503(self):
        self.login()
        with patch.dict(os.environ, {'SHOP_PROVIDER': ''}):
            r = self.client.post(self.base + '/api/shop/order', json={'pack': 'start'}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()['code'], 'PAYMENTS_NOT_CONFIGURED')

    # ------------------------------------------------------------ signatures
    def test_stripe_signature_rules(self):
        body = b'{"type":"checkout.session.completed"}'
        good = sign_stripe(body, 'whsec_offline')
        self.assertTrue(shop.stripe_signature_ok(body, good, 'whsec_offline'))
        self.assertFalse(shop.stripe_signature_ok(body, good, 'other-secret'))
        self.assertFalse(shop.stripe_signature_ok(body, 'garbage', 'whsec_offline'))
        self.assertFalse(shop.stripe_signature_ok(body, '', 'whsec_offline'))
        old = sign_stripe(body, 'whsec_offline', timestamp=time.time() - 3600)
        self.assertFalse(shop.stripe_signature_ok(body, old, 'whsec_offline'))
        # подмена тела ломает подпись
        self.assertFalse(shop.stripe_signature_ok(body + b' ', good, 'whsec_offline'))

    def test_cryptobot_signature_rules(self):
        body = b'{"update_type":"invoice_paid"}'
        self.assertTrue(shop.cryptobot_signature_ok(body, sign_cryptobot(body, '12345:offline-token'), '12345:offline-token'))
        self.assertFalse(shop.cryptobot_signature_ok(body, sign_cryptobot(body, '12345:other'), '12345:offline-token'))
        self.assertFalse(shop.cryptobot_signature_ok(body, 'deadbeef', '12345:offline-token'))

    # --------------------------------------------------------------- webhooks
    def test_stripe_webhook_credits_once_and_claim_is_idempotent(self):
        self.login()
        order = self.make_order('major')
        event = {'type': 'checkout.session.completed', 'object': {
            'id': 'cs_test_1', 'payment_status': 'paid', 'amount_total': round(shop.PACKS['major']['usd'] * 100),
            'client_reference_id': order, 'metadata': {'order_id': order}}}
        body = json.dumps(event).encode()
        headers = {'Stripe-Signature': sign_stripe(body, 'whsec_offline'), 'Content-Type': 'application/json'}
        r = self.client.post(self.base + '/api/shop/webhook/stripe', data=body, headers=headers)
        self.assertEqual(r.status_code, 200, r.text)
        # повторный вебхук не создаёт вторую запись в журнале
        r = self.client.post(self.base + '/api/shop/webhook/stripe', data=body, headers=headers)
        self.assertEqual(r.status_code, 200)
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM shop_ledger').fetchone()[0], 1)
            self.assertEqual(c.execute('SELECT status FROM shop_orders WHERE id=?', (order,)).fetchone()[0], 'paid')
        # первое получение монет
        r = self.client.post(self.base + '/api/shop/claim', json={'order': order}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['coins'], shop.PACKS['major']['coins'])
        self.assertFalse(r.json()['already'])
        # второе получение помечается как already и не платит снова
        r = self.client.post(self.base + '/api/shop/claim', json={'order': order}, headers={'Origin': self.base})
        self.assertTrue(r.json()['already'])
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT claimed FROM shop_orders WHERE id=?', (order,)).fetchone()[0], 1)

    def test_stripe_webhook_rejects_bad_signature_and_underpayment(self):
        self.login()
        order = self.make_order('major')
        body = json.dumps({'type': 'checkout.session.completed', 'object': {
            'id': 'cs_test_1', 'payment_status': 'paid', 'amount_total': 1,
            'client_reference_id': order}}).encode()
        r = self.client.post(self.base + '/api/shop/webhook/stripe', data=body,
                             headers={'Stripe-Signature': 't=1,v1=bad', 'Content-Type': 'application/json'})
        self.assertEqual(r.status_code, 400)
        r = self.client.post(self.base + '/api/shop/webhook/stripe', data=body,
                             headers={'Stripe-Signature': sign_stripe(body, 'whsec_offline')})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'AMOUNT')
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM shop_orders WHERE id=?', (order,)).fetchone()[0], 'new')

    def test_cryptobot_webhook_verifies_signature_and_status(self):
        self.login()
        with patch.dict(os.environ, {'SHOP_PROVIDER': 'cryptobot'}), \
             patch.object(shop, 'cryptobot_create', return_value=('9001', 'https://t.me/CryptoBot?start=x')):
            r = self.client.post(self.base + '/api/shop/order', json={'pack': 'start', 'method': 'crypto'},
                                 headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200, r.text)
        order = r.json()['orderId']
        update = {'update_type': 'invoice_paid', 'payload': {
            'invoice_id': 9001, 'status': 'paid', 'payload': order, 'amount': f"{shop.PACKS['start']['rub']}.00"}}
        body = json.dumps(update).encode()
        # без правильной подписи — 401
        r = self.client.post(self.base + '/api/shop/webhook/cryptobot', data=body,
                             headers={'crypto-pay-api-signature': 'bad'})
        self.assertEqual(r.status_code, 401)
        paid = {'status': 'paid', 'invoice_id': 9001, 'amount': f"{shop.PACKS['start']['rub']}.00"}
        with patch.object(shop, 'cryptobot_paid', return_value=paid) as check:
            r = self.client.post(self.base + '/api/shop/webhook/cryptobot', data=body,
                                 headers={'crypto-pay-api-signature': sign_cryptobot(body, '12345:offline-token')})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(check.call_count, 1)
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM shop_orders WHERE id=?', (order,)).fetchone()[0], 'paid')

    def test_yookassa_webhook_requires_recheck_of_payment(self):
        self.login()
        with patch.object(shop, 'stripe_create', return_value=('cs', 'https://checkout.stripe.com/x')):
            pass
        with patch.dict(os.environ, {'SHOP_PROVIDER': 'yookassa'}), \
             patch.object(shop, 'yookassa_create', return_value=('yk_1', 'https://yoomoney.ru/x')):
            r = self.client.post(self.base + '/api/shop/order', json={'pack': 'start'}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200, r.text)
        order = r.json()['orderId']
        body = json.dumps({'event': 'payment.succeeded', 'object': {
            'id': 'yk_1', 'status': 'succeeded', 'paid': True,
            'amount': {'value': f"{shop.PACKS['start']['rub']}.00", 'currency': 'RUB'},
            'metadata': {'order_id': order}}}).encode()
        # неподтверждённый платёж (провайдер говорит «не оплачено») не зачисляется
        with patch.object(shop, 'yookassa_paid', side_effect=shop.ShopError(400, 'NOT_PAID', 'no')):
            r = self.client.post(self.base + '/api/shop/webhook/yookassa', data=body)
        self.assertEqual(r.status_code, 400)
        with patch.object(shop, 'yookassa_paid', return_value={
                'id': 'yk_1', 'status': 'succeeded', 'paid': True,
                'amount': {'value': f"{shop.PACKS['start']['rub']}.00"},
                'metadata': {'order_id': order}}):
            r = self.client.post(self.base + '/api/shop/webhook/yookassa', data=body)
        self.assertEqual(r.status_code, 200, r.text)
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM shop_orders WHERE id=?', (order,)).fetchone()[0], 'paid')


if __name__ == '__main__':
    unittest.main()
