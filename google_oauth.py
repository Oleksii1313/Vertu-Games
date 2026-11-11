"""Google OpenID Connect authorization-code flow. Secrets never reach the client.
Only official fixed Google endpoints are used. No mock/debug authentication mode.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, urlencode

try:
    import requests
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request
except ImportError:
    requests = id_token = Request = None

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
CALLBACK = '/api/auth/google/callback'
PAGES = ('index.html', 'top.html', 'roulette.html', 'admin.html')
TTL = 600


class OAuthError(Exception):
    pass


def configuration():
    origin = os.environ.get('PUBLIC_URL', '').rstrip('/')
    client = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
    secret = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()
    try:
        u = urlparse(origin)
        valid = (u.scheme == 'https' or (u.scheme == 'http' and u.hostname in ('localhost', '127.0.0.1', '::1')))
        valid = valid and u.netloc and not (u.path or u.query or u.fragment or u.username or u.password)
        _ = u.port
    except ValueError:
        valid = False
    if not (valid and client.endswith('.apps.googleusercontent.com') and secret and requests and id_token):
        return None
    return {'origin': origin, 'client': client, 'secret': secret, 'redirect': origin + CALLBACK}


def configured():
    return configuration() is not None


def init_db(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS google_identities (
        subject TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS google_flows (
        state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce_hash TEXT NOT NULL,
        verifier TEXT NOT NULL, return_page TEXT NOT NULL, lang TEXT NOT NULL,
        intent TEXT NOT NULL, user_id INTEGER, session_hash TEXT, expires INTEGER NOT NULL
    );
    ''')


def linked(c, user_id):
    return bool(c.execute('SELECT 1 FROM google_identities WHERE user_id=?', (user_id,)).fetchone())


def flow_cookie(config, value='', age=0):
    secure = config['origin'].startswith('https://')
    name = '__Host-vg_google_flow' if secure else 'vg_google_flow'
    return f'{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}' + ('; Secure' if secure else '')


def browser_token(handler, config):
    try:
        cookies = SimpleCookie()
        cookies.load(handler.headers.get('Cookie', ''))
        key = '__Host-vg_google_flow' if config['origin'].startswith('https://') else 'vg_google_flow'
        return cookies[key].value if key in cookies else ''
    except Exception:
        return ''


def redirect(handler, path, config, session_cookie=None):
    # `path` comes only from PAGES, with fixed result codes and validated language.
    handler.send_response(303)
    handler.send_header('Location', path)
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Referrer-Policy', 'no-referrer')
    handler.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    handler.send_header('Content-Length', '0')
    if config:
        handler.send_header('Set-Cookie', flow_cookie(config))
    if session_cookie:
        handler.send_header('Set-Cookie', session_cookie)
    handler.end_headers()


def start(handler, data, backend):
    config = configuration()
    if not config:
        return handler.error(503, 'GOOGLE_NOT_CONFIGURED', 'Владелец ещё не настроил вход через Google. Нужны сервер, PUBLIC_URL и ключи Google OAuth.')
    if handler.headers.get('Origin', '').rstrip('/') != config['origin']:
        return handler.error(403, 'ORIGIN', 'Откройте сайт по его основному адресу.')
    if not handler.rate('google_start', 30, 900):
        return
    intent = data.get('mode', 'login')
    if intent not in ('login', 'link'):
        return handler.error(400, 'BAD_REQUEST', 'Неизвестный режим входа.')
    user = handler.session() if intent == 'link' else None
    if intent == 'link' and not user:
        return handler.error(401, 'LOGIN_REQUIRED', 'Сначала войдите в существующий серверный аккаунт.')
    page = data.get('next', 'index.html')
    if page not in PAGES:
        page = 'index.html'
    lang = 'en' if data.get('lang') == 'en' else 'ru'
    state, binding, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(4))
    with backend.connect() as c:
        c.execute('DELETE FROM google_flows WHERE expires<?', (backend.now(),))
        c.execute('INSERT INTO google_flows VALUES(?,?,?,?,?,?,?,?,?,?)', (
            backend.digest(state), backend.digest(binding), backend.digest(nonce), verifier, page, lang,
            intent, user['id'] if user else None, backend.digest(handler.token()) if user else None,
            backend.now() + TTL))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    params = dict(client_id=config['client'], redirect_uri=config['redirect'], response_type='code',
                  scope='openid email', state=state, nonce=nonce, prompt='select_account',
                  code_challenge=challenge, code_challenge_method='S256')
    handler.reply(200, {'ok': True, 'url': AUTH_URL + '?' + urlencode(params)}, flow_cookie(config, binding, TTL))


def exchange(code, config, verifier):
    # Never accept a JWT/email supplied directly by the browser. Exchange the
    # one-time code server-side, then verify Google's signature, aud, iss, exp/iat.
    with requests.Session() as transport:
        response = transport.post(TOKEN_URL, data={
            'code': code, 'client_id': config['client'], 'client_secret': config['secret'],
            'redirect_uri': config['redirect'], 'grant_type': 'authorization_code',
            'code_verifier': verifier,
        }, timeout=15, allow_redirects=False)
        if response.status_code != 200:
            raise OAuthError('GOOGLE_TOKEN_FAILED')
        token = response.json().get('id_token')
        if not isinstance(token, str) or len(token) > 20000:
            raise OAuthError('GOOGLE_TOKEN_FAILED')
        request = Request(session=transport)
        def timed_request(*args, **kwargs):
            kwargs['timeout'] = 15
            return request(*args, **kwargs)
        return id_token.verify_oauth2_token(token, timed_request, config['client'])


def checked_identity(claims, nonce_hash, config, backend):
    if not isinstance(claims, dict):
        raise OAuthError('GOOGLE_TOKEN_FAILED')
    # Keep explicit constraints here as well as library signature validation.
    if (claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
            or claims.get('aud') != config['client']
            or claims.get('azp', config['client']) != config['client']):
        raise OAuthError('GOOGLE_TOKEN_FAILED')
    if (type(claims.get('exp')) not in (int, float) or claims['exp'] <= backend.now()
            or type(claims.get('iat')) not in (int, float) or claims['iat'] > backend.now() + 30):
        raise OAuthError('GOOGLE_TOKEN_FAILED')
    nonce = claims.get('nonce', '')
    if not isinstance(nonce, str) or not hmac.compare_digest(backend.digest(nonce), nonce_hash):
        raise OAuthError('GOOGLE_TOKEN_FAILED')
    subject = claims.get('sub')
    email = claims.get('email')
    if not isinstance(subject, str) or not 1 <= len(subject) <= 255 or not backend.valid_email(email):
        raise OAuthError('GOOGLE_TOKEN_FAILED')
    if claims.get('email_verified') is not True:
        raise OAuthError('GOOGLE_EMAIL_UNVERIFIED')
    email = email.strip().lower()
    # For non-Gmail, non-Workspace addresses Google may not remain authoritative.
    # Those addresses must use the existing emailed-code registration instead.
    if email.rsplit('@', 1)[1] not in ('gmail.com', 'googlemail.com') and not (isinstance(claims.get('hd'), str) and claims['hd']):
        raise OAuthError('GOOGLE_EMAIL_EXTERNAL')
    return subject, email


def callback(handler, backend):
    config = configuration()
    page, lang = 'index.html', 'ru'
    try:
        if not config:
            raise OAuthError('GOOGLE_NOT_CONFIGURED')
        if len(handler.path) > 20000:
            raise OAuthError('GOOGLE_STATE_INVALID')
        q = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
        if any(len(v) != 1 for v in q.values()):
            raise OAuthError('GOOGLE_STATE_INVALID')
        state = q.get('state', [''])[0]
        binding = browser_token(handler, config)
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', state) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', binding):
            raise OAuthError('GOOGLE_STATE_INVALID')
        with backend.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            flow = c.execute('SELECT * FROM google_flows WHERE state_hash=?', (backend.digest(state),)).fetchone()
            if not flow or flow['expires'] <= backend.now() or not hmac.compare_digest(flow['browser_hash'], backend.digest(binding)):
                raise OAuthError('GOOGLE_STATE_INVALID')
            # Consume atomically before any remote exchange: no callback replay.
            c.execute('DELETE FROM google_flows WHERE state_hash=?', (backend.digest(state),))
        page, lang = flow['return_page'], flow['lang']
        if q.get('error'):
            raise OAuthError('GOOGLE_CANCELLED')
        code = q.get('code', [''])[0]
        if not code or len(code) > 10000:
            raise OAuthError('GOOGLE_TOKEN_FAILED')
        claims = exchange(code, config, flow['verifier'])
        subject, email = checked_identity(claims, flow['nonce_hash'], config, backend)
        current = handler.session() if flow['intent'] == 'link' else None
        if flow['intent'] == 'link' and (not current or current['id'] != flow['user_id']
                or not hmac.compare_digest(flow['session_hash'], backend.digest(handler.token()))):
            raise OAuthError('GOOGLE_LINK_SESSION')
        with backend.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            identity = c.execute('SELECT user_id FROM google_identities WHERE subject=?', (subject,)).fetchone()
            if flow['intent'] == 'link':
                user = c.execute('SELECT * FROM users WHERE id=?', (current['id'],)).fetchone()
                if user['email_key'] != email.casefold():
                    raise OAuthError('GOOGLE_LINK_EMAIL')
                if identity and identity['user_id'] != user['id']:
                    raise OAuthError('GOOGLE_ACCOUNT_CONFLICT')
                other = c.execute('SELECT subject FROM google_identities WHERE user_id=?', (user['id'],)).fetchone()
                if other and other['subject'] != subject:
                    raise OAuthError('GOOGLE_ACCOUNT_CONFLICT')
                if not identity:
                    c.execute('INSERT INTO google_identities VALUES(?,?,?)', (subject, user['id'], backend.now()))
            elif identity:
                user = c.execute('SELECT * FROM users WHERE id=?', (identity['user_id'],)).fetchone()
                if not user:
                    raise OAuthError('GOOGLE_ACCOUNT_CONFLICT')
                conflict = c.execute('SELECT id FROM users WHERE email_key=? AND id<>?', (email.casefold(), user['id'])).fetchone()
                if conflict:
                    raise OAuthError('GOOGLE_ACCOUNT_CONFLICT')
                c.execute('UPDATE users SET email=?,email_key=? WHERE id=?', (email, email.casefold(), user['id']))
            else:
                if c.execute('SELECT 1 FROM users WHERE email_key=?', (email.casefold(),)).fetchone():
                    raise OAuthError('GOOGLE_ACCOUNT_EXISTS')
                prefix = re.sub(r'[^a-z0-9_]', '', email.split('@')[0])[:18] or 'player'
                while True:
                    username = 'g_' + prefix + '_' + secrets.token_hex(4)
                    if not c.execute('SELECT 1 FROM users WHERE username_key=?', (username.casefold(),)).fetchone():
                        break
                # Sentinel deliberately fails password_ok. No random/shared password.
                cur = c.execute('INSERT INTO users(username,username_key,email,email_key,password,created,verified) VALUES(?,?,?,?,?,?,?)',
                                (username, username.casefold(), email, email.casefold(), '!google-only', backend.now(), backend.now()))
                c.execute('INSERT INTO google_identities VALUES(?,?,?)', (subject, cur.lastrowid, backend.now()))
                user = c.execute('SELECT * FROM users WHERE id=?', (cur.lastrowid,)).fetchone()
            c.execute('DELETE FROM pending WHERE email_key=?', (email.casefold(),))
            session = handler.new_session(c, user['id'])
        result = 'linked' if flow['intent'] == 'link' else 'success'
        redirect(handler, '/' + page + '?' + urlencode({'google_login': result, 'lang': lang}), config, handler.cookie(session))
    except OAuthError as exc:
        redirect(handler, '/' + page + '?' + urlencode({'google_error': str(exc), 'lang': lang}), config)
    except Exception:
        # Never log token responses, claims, codes, cookies, secret or raw exceptions.
        print('Google OAuth failed (details suppressed)', flush=True)
        redirect(handler, '/' + page + '?' + urlencode({'google_error': 'GOOGLE_TOKEN_FAILED', 'lang': lang}), config)
