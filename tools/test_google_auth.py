"""Offline security/regression tests. Synthetic provider responses, not real Google login.
Run: python3 -m unittest discover -s tools -p test_google_auth.py -v
Optional cryptography package enables the synthetic RSA signature test.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
import server
import google_oauth as google


class GoogleAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_db = server.DB
        cls.folder = tempfile.TemporaryDirectory()
        server.DB = Path(cls.folder.name) / 'accounts.sqlite3'
        server.init_db()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)
        cls.env = patch.dict(os.environ, {'PUBLIC_URL': cls.base, 'GOOGLE_CLIENT_ID': 'test.apps.googleusercontent.com', 'GOOGLE_CLIENT_SECRET': 'test-secret-not-production'})
        cls.env.start()
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join()
        cls.env.stop();server.DB = cls.original_db;cls.folder.cleanup()

    def setUp(self):
        with server.connect() as c:
            for table in ('google_flows', 'google_identities', 'sessions', 'users', 'limits', 'pending'):
                c.execute('DELETE FROM ' + table)
        self.client = requests.Session()
        self.addCleanup(self.client.close)

    def start(self, mode='login', next='index.html', client=None):
        r = (client or self.client).post(self.base+'/api/auth/google/start', json={'mode': mode, 'next': next, 'lang': 'en'}, headers={'Origin': self.base})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertNotIn('test-secret', r.text)
        u = urlparse(data['url']);self.assertEqual(u.netloc, 'accounts.google.com')
        q = {k:v[0] for k,v in parse_qs(u.query).items()}
        self.assertEqual(q['scope'], 'openid email')
        self.assertEqual(q['redirect_uri'], self.base+google.CALLBACK)
        self.assertEqual(q['prompt'], 'select_account')
        with server.connect() as c:
            flow = c.execute('SELECT * FROM google_flows WHERE state_hash=?', (server.digest(q['state']),)).fetchone()
        challenge = base64.urlsafe_b64encode(hashlib.sha256(flow['verifier'].encode()).digest()).rstrip(b'=').decode()
        self.assertEqual(challenge, q['code_challenge'])
        self.assertEqual(flow['nonce_hash'], server.digest(q['nonce']))
        self.assertIn('HttpOnly', r.headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', r.headers['Set-Cookie'])
        return q

    def claims(self, q, **overrides):
        value = dict(iss='https://accounts.google.com', aud=google.configuration()['client'], sub='subject-123',
                     email='test.person@gmail.com', email_verified=True, nonce=q['nonce'], exp=server.now()+600, iat=server.now())
        value.update(overrides)
        return value

    def finish(self, q, claims=None, client=None, error=None):
        values = {'state': q['state']}
        values.update({'error': error} if error else {'code': 'one-time-test-code'})
        with patch.object(google, 'exchange', return_value=claims if claims is not None else self.claims(q)) as exchange:
            r = (client or self.client).get(self.base+google.CALLBACK, params=values, allow_redirects=False)
        self.assertEqual(r.status_code, 303)
        self.assertEqual(r.headers['Cache-Control'], 'no-store')
        self.assertEqual(r.headers['Referrer-Policy'], 'no-referrer')
        return r, exchange.call_count

    def create_password_account(self):
        with server.connect() as c:
            c.execute('INSERT INTO users(username,username_key,email,email_key,password,created,verified) VALUES(?,?,?,?,?,?,?)',
                      ('existing', 'existing', 'test.person@gmail.com', 'test.person@gmail.com', server.password_hash('long-unique-test-password'), server.now(), server.now()))

    def login_password(self):
        r = self.client.post(self.base+'/api/auth/login', json={'identifier':'existing','password':'long-unique-test-password'}, headers={'Origin':self.base})
        self.assertEqual(r.status_code, 200)

    def test_signup_repeat_login_logout_and_no_password(self):
        q = self.start(next='top.html');r, n = self.finish(q)
        self.assertEqual(n, 1);self.assertIn('/top.html?google_login=success', r.headers['Location'])
        user = self.client.get(self.base+'/api/auth/session').json()['user']
        self.assertTrue(user['emailVerified']);self.assertTrue(user['googleLinked'])
        self.assertNotIn('subject', user);self.assertNotIn('password', user)
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT password FROM users').fetchone()[0], '!google-only')
        r = self.client.post(self.base+'/api/auth/login', json={'identifier':user['username'],'password':'anything'}, headers={'Origin':self.base})
        self.assertEqual(r.json()['code'], 'GOOGLE_LOGIN_REQUIRED')
        self.client.post(self.base+'/api/auth/logout', json={}, headers={'Origin':self.base})
        self.assertIsNone(self.client.get(self.base+'/api/auth/session').json()['user'])
        self.finish(self.start())
        self.assertEqual(self.client.get(self.base+'/api/auth/session').json()['user']['username'], user['username'])
        with server.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)

    def test_cancel_replay_and_browser_binding(self):
        q = self.start()
        other = requests.Session();self.addCleanup(other.close)
        r, n = self.finish(q, client=other);self.assertEqual(n, 0);self.assertIn('GOOGLE_STATE_INVALID', r.headers['Location'])
        r, n = self.finish(q, error='access_denied');self.assertEqual(n, 0);self.assertIn('GOOGLE_CANCELLED', r.headers['Location'])
        r, n = self.finish(q);self.assertEqual(n, 0);self.assertIn('GOOGLE_STATE_INVALID', r.headers['Location'])

    def test_expired_flow(self):
        q = self.start()
        with server.connect() as c:c.execute('UPDATE google_flows SET expires=?', (server.now()-1,))
        r, n = self.finish(q);self.assertEqual(n, 0);self.assertIn('GOOGLE_STATE_INVALID', r.headers['Location'])

    def test_invalid_claims_rejected(self):
        invalid = [dict(nonce='wrong'), dict(iss='https://evil.test'), dict(aud='other-client'), dict(azp='other-client'),
                   dict(exp=server.now()-10), dict(iat=server.now()+3600), dict(email_verified=False), dict(email_verified='true'),
                   dict(sub=''), dict(email='not-an-email'), dict(email='third.party@example.org')]
        for changes in invalid:
            with self.subTest(changes=changes):
                q = self.start();r, n = self.finish(q, self.claims(q, **changes))
                self.assertEqual(n, 1);self.assertIn('google_error=', r.headers['Location'])
                self.assertIsNone(self.client.get(self.base+'/api/auth/session').json()['user'])
        with server.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM users').fetchone()[0], 0)

    def test_email_registration_still_works(self):
        codes=[]
        def capture(email, code): codes.append((email,code))
        with patch.dict(os.environ, {'SMTP_HOST':'localhost','SMTP_FROM':'tests@example.org'}), patch.object(server,'send_code',side_effect=capture):
            r=self.client.post(self.base+'/api/auth/register',json={'username':'emailuser','email':'mail@example.org','password':'long-test-password'},headers={'Origin':self.base})
            self.assertEqual(r.status_code,200)
            registration=r.json()['registrationId']
            self.assertIsNone(self.client.get(self.base+'/api/auth/session').json()['user'])
            code=codes[0][1]
            r=self.client.post(self.base+'/api/auth/verify',json={'registrationId':registration,'code':code},headers={'Origin':self.base})
            self.assertEqual(r.status_code,200);self.assertTrue(r.json()['user']['emailVerified']);self.assertFalse(r.json()['user']['googleLinked'])
            self.client.post(self.base+'/api/auth/logout',json={},headers={'Origin':self.base})
            r=self.client.post(self.base+'/api/auth/login',json={'identifier':'mail@example.org','password':'long-test-password'},headers={'Origin':self.base})
            self.assertEqual(r.status_code,200)

    def test_workspace(self):
        q = self.start();r, _ = self.finish(q, self.claims(q, email='player@work.example', hd='work.example'))
        self.assertIn('google_login=success', r.headers['Location'])

    def test_no_implicit_link_and_explicit_link_preserves_account(self):
        self.create_password_account()
        r, _ = self.finish(self.start());self.assertIn('GOOGLE_ACCOUNT_EXISTS', r.headers['Location'])
        self.login_password()
        before = self.client.get(self.base+'/api/auth/session').json()['user']
        self.assertFalse(before['googleLinked'])
        r, _ = self.finish(self.start(mode='link'));self.assertIn('google_login=linked', r.headers['Location'])
        user = self.client.get(self.base+'/api/auth/session').json()['user']
        self.assertEqual(user['username'], 'existing');self.assertTrue(user['googleLinked'])
        self.login_password()
        self.client.post(self.base+'/api/auth/logout', json={}, headers={'Origin':self.base})
        self.finish(self.start())
        self.assertEqual(self.client.get(self.base+'/api/auth/session').json()['user']['username'], 'existing')
        with server.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)

    def test_link_requires_same_session_and_email(self):
        r = self.client.post(self.base+'/api/auth/google/start', json={'mode':'link'}, headers={'Origin':self.base})
        self.assertEqual(r.status_code, 401)
        self.create_password_account();self.login_password()
        q = self.start(mode='link');r, _ = self.finish(q, self.claims(q,email='someone.else@gmail.com'))
        self.assertIn('GOOGLE_LINK_EMAIL', r.headers['Location'])
        q = self.start(mode='link')
        self.client.post(self.base+'/api/auth/logout', json={}, headers={'Origin':self.base})
        r, _ = self.finish(q);self.assertIn('GOOGLE_LINK_SESSION', r.headers['Location'])
        with server.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM google_identities').fetchone()[0], 0)

    def test_config_origin_redirect_and_secret_protection(self):
        r = self.client.post(self.base+'/api/auth/google/start', json={}, headers={'Origin':'https://evil.test'})
        self.assertEqual(r.status_code, 403)
        q = self.start(next='https://evil.test/');r, _ = self.finish(q)
        self.assertTrue(r.headers['Location'].startswith('/index.html?'))
        for path in ('/.env', '/google_oauth.py', '/data/accounts.sqlite3', '/requirements.txt'):
            self.assertEqual(self.client.get(self.base+path).status_code, 404)
        with patch.dict(os.environ, {'GOOGLE_CLIENT_SECRET':''}):
            self.assertFalse(self.client.get(self.base+'/api/auth/session').json()['googleConfigured'])
            r = self.client.post(self.base+'/api/auth/google/start', json={}, headers={'Origin':self.base})
            self.assertEqual(r.status_code, 503)
        with patch.dict(os.environ, {'PUBLIC_URL':'http://insecure.example.org'}):self.assertIsNone(google.configuration())
        with patch.dict(os.environ, {'PUBLIC_URL':'https://example.org/subpath'}):self.assertIsNone(google.configuration())
        with patch.dict(os.environ, {'PUBLIC_URL':'https://example.org'}):
            cookie = google.flow_cookie(google.configuration(), 'opaque', 600)
            self.assertIn('__Host-', cookie);self.assertIn('; Secure', cookie)

    def test_signature_verification_with_synthetic_rsa(self):
        try:
            from cryptography.hazmat.primitives.asymmetric import rsa
            from cryptography.hazmat.primitives import serialization
            from google.auth import crypt, jwt
        except ImportError:
            self.skipTest('Optional cryptography package not installed')
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        signer = crypt.RSASigner.from_string(private, key_id='synthetic')
        q = self.start();claims = self.claims(q)
        class CertResponse:
            status=200
            data=json.dumps({'synthetic':public}).encode()
        for changes in ({}, {'aud':'wrong-audience'}, {'iss':'https://evil.test'}, {'exp':server.now()-10}):
            token = jwt.encode(signer, {**claims, **changes}).decode()
            with patch.object(google.requests, 'Session') as session, patch.object(google, 'Request', return_value=lambda *a,**k:CertResponse()):
                response = session.return_value.__enter__.return_value.post.return_value
                response.status_code=200;response.json.return_value={'id_token':token}
                if changes:
                    with self.assertRaises(Exception):google.exchange('code', google.configuration(), 'verifier')
                else:
                    self.assertEqual(google.exchange('code',google.configuration(),'verifier')['sub'], claims['sub'])
        badkey=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        badprivate=badkey.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
        token=jwt.encode(crypt.RSASigner.from_string(badprivate,key_id='synthetic'),claims).decode()
        with patch.object(google.requests,'Session') as session, patch.object(google,'Request',return_value=lambda *a,**k:CertResponse()):
            response=session.return_value.__enter__.return_value.post.return_value
            response.status_code=200;response.json.return_value={'id_token':token}
            with self.assertRaises(Exception):google.exchange('code',google.configuration(),'verifier')


if __name__=='__main__':
    unittest.main()
