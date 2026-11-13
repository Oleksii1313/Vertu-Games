#!/usr/bin/env python3
"""Vertu Games — сервер платформы (Flask + PostgreSQL).

Что делает сервер:

* отдаёт статические страницы и игры (только разрешённые файлы, без исходников);
* аккаунты: регистрация по нику и паролю, серверные сессии, смена пароля, выход;
* экономика: единственный серверный баланс V-монет, история операций, магазин;
* казино: колесо и слоты, вся случайность и выплаты — на сервере;
* админ-панель: отдельная серверная сессия, журнал действий;
* платёжные вебхуки (выключены без ключей провайдера).

Запуск:
    DATABASE_URL=postgres://… python3 server.py
    gunicorn -w 4 -b 0.0.0.0:$PORT server:app      # Render
"""
from __future__ import annotations

import gzip
import json
import os
import re
import time
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, make_response, g, abort

import captcha
import casino_logic
import db as store
import shop
from db import (AccountBanned, DuplicateUser, InsufficientFunds, InvalidCredentials,
                LimitExceeded, NotFound, StoreError, get_store)
from game_catalog import GAMES, GAMES_BY_ID, game_available, public_games

ROOT = Path(__file__).resolve().parent
COOKIE = 'vg_session'
ADMIN_COOKIE = 'vg_admin'
STATIC_WHITELIST = {
    'index.html', 'top.html', 'roulette.html', 'casino.html', 'admin.html', 'shop.html',
    'profile.html', 'login.html', 'about.html', 'support.html', 'api.html', 'privacy.html',
    'coin.svg', 'robots.txt', 'manifest.webmanifest',
}
STATIC_PREFIXES = ('assets/', 'games/', 'docs/')
STATIC_SUFFIXES = {'.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.json',
                   '.woff2', '.txt', '.glb', '.gz', '.md'}

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 256 * 1024
app.json.ensure_ascii = False


# --------------------------------------------------------------------------- helpers
def now() -> int:
    return int(time.time())


def client_ip() -> str:
    forwarded = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    return forwarded or request.remote_addr or ''


def is_https() -> bool:
    proto = (request.headers.get('X-Forwarded-Proto') or request.scheme or '').split(',')[0]
    return proto.strip() == 'https' or (os.environ.get('PUBLIC_URL', '').startswith('https://'))


def set_cookie(response, name: str, value: str, max_age: int):
    response.set_cookie(name, value, max_age=max_age, httponly=True, samesite='Lax',
                        secure=is_https(), path='/')
    return response


def clear_cookie(response, name: str):
    response.delete_cookie(name, path='/', httponly=True, samesite='Lax', secure=is_https())
    return response


def json_body() -> dict:
    if not request.is_json:
        return {}
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def api_error(status: int, code: str, message: str):
    return jsonify({'ok': False, 'code': code, 'msg': message}), status


def rate(scope: str, limit: int, seconds: int, extra: str = '') -> bool:
    key = store.digest(f'{scope}:{client_ip()}:{extra}')
    return get_store().rate_limit(key, limit, seconds)


def public_user(user) -> dict:
    if not user:
        return None
    data = get_store()
    return {
        'id': int(user['id']),
        'username': user['username'],
        'coins': int(user['coins']),
        'isAdmin': bool(user['is_admin']),
        'avatar': user['avatar'],
        'color': user['color'],
        'title': user['title'],
        'created': int(user['created']),
        'banned': bool(user['banned']),
    }


def current_user():
    if 'user' in g:
        return g.user
    token = request.cookies.get(COOKIE, '')
    g.user = get_store().user_for_token(token) if token else None
    return g.user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return api_error(401, 'AUTH_REQUIRED', 'Требуется вход в аккаунт')
        if user['banned']:
            return api_error(403, 'BANNED', 'Аккаунт заблокирован')
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(ADMIN_COOKIE, '')
        if not get_store().admin_session_valid(token):
            return api_error(401, 'ADMIN_AUTH_REQUIRED', 'Требуется вход администратора')
        return fn(*args, **kwargs)
    return wrapper


def level_info(user) -> dict:
    coins = int(user['coins'])
    level = 1 + coins // 500
    return {'level': level, 'nextLevelAt': level * 500}


# --------------------------------------------------------------------------- static
@app.get('/')
def index():
    return serve_file('index.html')


@app.get('/<path:name>')
def file_route(name: str):
    return serve_file(name)


def serve_file(rel: str):
    rel = rel.lstrip('/')
    if not rel:
        rel = 'index.html'
    if rel not in STATIC_WHITELIST and not (rel.startswith(STATIC_PREFIXES)
                                            and Path(rel).suffix.lower() in STATIC_SUFFIXES):
        abort(404)
    target = (ROOT / rel).resolve()
    if ROOT not in target.parents or not target.is_file():
        abort(404)
    response = make_response(send_from_directory(ROOT, rel))
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    if rel.endswith('.html'):
        response.headers['Cache-Control'] = 'no-cache'
    elif rel.startswith(('assets/vg/', 'coin.svg')):
        # Свои css/js/images кешируем надолго; при обновлении файла ETag/Last-Modified
        # заставят браузер перепроверить содержимое.
        response.headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800'
    else:
        response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


@app.after_request
def compress_response(response):
    """gzip для текстовых ответов: css/js/html сжимаются примерно в 4 раза."""
    mime = response.mimetype or ''
    compressible = mime in ('text/css', 'text/html', 'application/javascript', 'text/javascript',
                            'application/json', 'image/svg+xml')
    if compressible:
        response.headers.setdefault('Vary', 'Accept-Encoding')
    if not compressible or response.status_code != 200:
        return response
    if 'gzip' not in (request.headers.get('Accept-Encoding') or ''):
        return response
    if response.headers.get('Content-Encoding'):
        return response
    # send_from_directory отдаёт файл потоком — сначала читаем его в память
    # (наши страницы и ассеты весят десятки килобайт, крупные файлы не трогаем).
    if response.direct_passthrough:
        length = response.content_length or 0
        if length > 2 * 1024 * 1024:
            return response
        response.direct_passthrough = False
    payload = response.get_data()
    if len(payload) <= 1024:
        return response
    compressed = gzip.compress(payload, 6)
    if len(compressed) >= len(payload):
        return response
    response.set_data(compressed)
    response.headers['Content-Encoding'] = 'gzip'
    response.headers['Content-Length'] = str(len(compressed))
    return response


@app.after_request
def security_headers(response):
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    return response


# --------------------------------------------------------------------------- auth
@app.get('/api/health')
def health():
    data = get_store()
    return jsonify({'ok': True, 'backend': data.backend, 'time': now(),
                    'captcha': captcha.public_config(), 'payments': shop.configured()})


@app.get('/api/session')
def session_info():
    user = current_user()
    data = get_store()
    return jsonify({
        'ok': True,
        'user': public_user(user),
        'level': level_info(user) if user else None,
        'captcha': captcha.public_config(),
        'games': [{'id': g['id'], 'reward': g['reward'], 'daily': g['daily']} for g in public_games()],
        'achievements': len(data.achievements()),
        'payments': shop.configured(),
    })


@app.post('/api/auth/register')
def register():
    data = json_body()
    username = str(data.get('username', '')).strip()
    password = data.get('password', '')
    if not rate('register', int(os.environ.get('REGISTER_RATE', '60')), 3600):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток регистрации. Подождите.')
    if data.get('website') or data.get('honeypot'):
        return api_error(400, 'BOT', 'Регистрация отклонена.')
    if not store.valid_username(username):
        return api_error(400, 'USERNAME',
                         'Ник: 3–24 символа, буквы, цифры, пробел, точка, дефис. '
                         'Начинается и заканчивается буквой или цифрой.')
    if not store.valid_password(password):
        return api_error(400, 'PASSWORD', 'Пароль должен содержать 8–128 символов.')
    started = data.get('startedAt')
    try:
        if started and (time.time() * 1000 - float(started)) < 1200:
            return api_error(400, 'TOO_FAST', 'Форма заполнена слишком быстро. Попробуйте снова.')
    except (TypeError, ValueError):
        pass
    ok, code = captcha.verify(data.get('turnstileToken', ''), client_ip())
    if not ok:
        messages = {
            'CAPTCHA_REQUIRED': 'Подтвердите, что вы не робот.',
            'CAPTCHA_FAILED': 'Проверка CAPTCHA не пройдена. Обновите страницу и повторите.',
            'CAPTCHA_REUSED': 'CAPTCHA уже использована. Обновите страницу.',
            'CAPTCHA_UNAVAILABLE': 'Сервис CAPTCHA недоступен. Попробуйте позже.',
            'CAPTCHA_NOT_CONFIGURED': 'CAPTCHA включена, но ключи не настроены владельцем.',
        }
        return api_error(400, code, messages.get(code, 'Проверка CAPTCHA не пройдена.'))
    if not rate('register_name', int(os.environ.get('REGISTER_NAME_RATE', '10')), 3600, username.casefold()):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток с этим ником.')
    db = get_store()
    try:
        user = db.create_user(username, password)
    except DuplicateUser:
        return api_error(409, 'USERNAME_TAKEN', 'Этот ник уже занят. Выберите другой.')
    except StoreError as exc:
        return api_error(400, 'USERNAME', str(exc))
    token = db.new_session(user['id'], ip=client_ip(), agent=request.headers.get('User-Agent', ''))
    db.unlock_achievement(user['id'], 'first_login')
    db.admin_log(user['username'], 'register', user['username'], 'новый аккаунт', store.digest(client_ip()))
    user = db.get_user(user['id'])
    response = jsonify({'ok': True, 'user': public_user(user), 'coins': int(user['coins'])})
    set_cookie(response, COOKIE, token, store.SESSION_TTL)
    return response, 201


LEGACY_DB = Path(os.environ.get('VERTGAMES_DB', 'data/accounts.sqlite3'))


def legacy_account(email: str):
    """Найти аккаунт в старой SQLite-базе (database.py) по email, без изменения файла."""
    if not LEGACY_DB.exists():
        return None
    import sqlite3
    try:
        conn = sqlite3.connect(f'file:{LEGACY_DB}?mode=ro', uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT * FROM users WHERE email_key=? OR LOWER(email)=?',
                           (email.strip().casefold(), email.strip().casefold())).fetchone()
        conn.close()
    except sqlite3.Error:
        return None
    if not row:
        return None
    columns = set(row.keys())
    return {
        'username': row['username'],
        'password': row['password'],
        'email': row['email'] if 'email' in columns else '',
        'coins': int(row['coins']) if 'coins' in columns else 0,
        'is_admin': bool(row['is_admin']) if 'is_admin' in columns else False,
        'created': int(row['created']) if 'created' in columns else 0,
        'banned': bool(row['banned']) if 'banned' in columns else False,
    }


@app.post('/api/auth/login')
def login():
    data = json_body()
    username = str(data.get('username') or data.get('identifier') or '').strip()
    password = data.get('password', '')
    if not rate('login', 10, 600):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток входа. Подождите несколько минут.')
    if not rate('login_name', 12, 900, username.casefold()):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток для этого ника.')
    ok, code = captcha.verify(data.get('turnstileToken', ''), client_ip())
    if not ok:
        return api_error(400, code, 'Проверка CAPTCHA не пройдена. Обновите страницу.')
    db = get_store()
    if username and '@' in username and not db.find_user(username):
        # Плавный переход: старые аккаунты входили по email (ник + email + пароль).
        # Ник восстанавливаем из старой базы, пароль проверяем тем же PBKDF2-хешем.
        legacy = legacy_account(username)
        if legacy:
            db.import_legacy_user(legacy['username'], legacy['password'], legacy['coins'],
                                  legacy['is_admin'], legacy['email'], legacy['created'],
                                  legacy['banned'])
            row = db.find_user(legacy['username'])
            if row and row['banned']:
                return api_error(403, 'BANNED', 'Аккаунт заблокирован. Обратитесь в поддержку.')
            if row:
                username = row['username']
    try:
        user = db.authenticate(username, password)
    except AccountBanned:
        return api_error(403, 'BANNED', 'Аккаунт заблокирован. Обратитесь в поддержку.')
    except InvalidCredentials:
        return api_error(401, 'INVALID', 'Неверный ник или пароль.')
    token = db.new_session(user['id'], ip=client_ip(), agent=request.headers.get('User-Agent', ''))
    db.touch(user['id'])
    db.unlock_achievement(user['id'], 'first_login')
    response = jsonify({'ok': True, 'user': public_user(user)})
    set_cookie(response, COOKIE, token, store.SESSION_TTL)
    return response


@app.post('/api/auth/logout')
def logout():
    token = request.cookies.get(COOKIE, '')
    if token:
        get_store().delete_session(token)
    response = jsonify({'ok': True})
    clear_cookie(response, COOKIE)
    return response


@app.get('/api/auth/availability')
def availability():
    if not rate('availability', 120, 60):
        return api_error(429, 'RATE_LIMIT', 'Слишком много запросов.')
    username = request.args.get('username', '').strip()
    data = get_store()
    taken = bool(username) and data.username_taken(username)
    return jsonify({'ok': True, 'usernameTaken': taken,
                    'valid': store.valid_username(username) if username else None})


@app.post('/api/auth/password')
@login_required
def change_password():
    data = json_body()
    user = current_user()
    db = get_store()
    if not rate('password', 6, 900):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток. Подождите.')
    current = data.get('current', '')
    new = data.get('password', '')
    if not store.verify_password(current, user['password_hash']):
        return api_error(400, 'WRONG_PASSWORD', 'Текущий пароль указан неверно.')
    if not store.valid_password(new):
        return api_error(400, 'PASSWORD', 'Новый пароль должен содержать 8–128 символов.')
    if current == new:
        return api_error(400, 'PASSWORD', 'Новый пароль совпадает с текущим.')
    db.set_password(user['id'], new)
    db.admin_log(user['username'], 'password_change', user['username'], '', store.digest(client_ip()))
    token = db.new_session(user['id'], ip=client_ip(), agent=request.headers.get('User-Agent', ''))
    response = jsonify({'ok': True, 'msg': 'Пароль обновлён. Другие сессии закрыты.'})
    set_cookie(response, COOKIE, token, store.SESSION_TTL)
    return response


@app.get('/api/auth/session')
def session_alias():
    return session_info()


@app.get('/api/me')
@login_required
def me():
    user = current_user()
    db = get_store()
    return jsonify({
        'ok': True,
        'user': public_user(user),
        'level': level_info(user),
        'stats': {'games': db.plays_total(user['id']),
                  'gameStats': db.game_stats(user['id']),
                  'casino': db.casino_stats(user['id'])},
        'achievements': db.user_achievements(user['id']),
        'purchases': db.purchases(user['id']),
        'ledger': db.ledger(user['id'], limit=15),
        'pendingItem': None,
    })


@app.get('/api/balance')
@login_required
def balance():
    user = current_user()
    return jsonify({'ok': True, 'coins': int(get_store().balance(user['id']))})


@app.get('/api/ledger')
@login_required
def ledger():
    user = current_user()
    db = get_store()
    limit = min(100, max(1, int(request.args.get('limit', 30) or 30)))
    offset = max(0, int(request.args.get('offset', 0) or 0))
    return jsonify({'ok': True, 'items': db.ledger(user['id'], limit, offset),
                    'total': db.ledger_count(user['id'])})


@app.get('/api/profile/<username>')
def profile(username: str):
    db = get_store()
    user = db.find_user(username)
    if not user or user['banned']:
        return api_error(404, 'NOT_FOUND', 'Игрок не найден')
    viewer = current_user()
    private = bool(viewer and viewer['id'] == user['id'])
    payload = {
        'ok': True,
        'user': {'username': user['username'], 'coins': int(user['coins']),
                 'avatar': user['avatar'], 'color': user['color'], 'title': user['title'],
                 'created': int(user['created'])},
        'level': level_info(user),
        'stats': {'games': db.plays_total(user['id']), 'gameStats': db.game_stats(user['id'])},
        'achievements': db.user_achievements(user['id']),
        'purchases': db.purchases(user['id']),
        'private': private,
    }
    if private:
        payload['casino'] = db.casino_stats(user['id'])
        payload['ledger'] = db.ledger(user['id'], limit=15)
        payload['settings'] = {'avatar': user['avatar'], 'color': user['color'], 'title': user['title']}
    return jsonify(payload)


@app.post('/api/profile')
@login_required
def update_profile():
    data = json_body()
    user = current_user()
    db = get_store()
    changes = {}
    for field in ('avatar', 'color', 'title'):
        value = data.get(field)
        if not value:
            continue
        item = next((i for i in db.shop_items() if i['id'] == value), None)
        if not item or item['kind'] != field:
            return api_error(400, 'ITEM', 'Неизвестный предмет профиля')
        if int(item['price']) > 0 and value not in db.owned_ids(user['id']):
            return api_error(403, 'NOT_OWNED', 'Сначала купите этот предмет')
        changes[field] = value
    db.update_profile(user['id'], **changes)
    return jsonify({'ok': True, 'user': public_user(db.get_user(user['id']))})


# --------------------------------------------------------------------------- games
@app.get('/api/games')
def games():
    data = get_store()
    stats = {}
    with data.driver.transaction() as c:
        rows = c.execute('SELECT game, COUNT(*) AS players, SUM(plays) AS plays FROM game_stats'
                         ' GROUP BY game').fetchall()
    for row in rows:
        stats[row['game']] = {'players': int(row['players']), 'plays': int(row['plays'] or 0)}
    return jsonify({'ok': True, 'games': public_games(), 'stats': stats})


@app.post('/api/games/play')
@login_required
def game_play():
    data = json_body()
    user = current_user()
    game = str(data.get('game', ''))
    if game not in GAMES_BY_ID:
        return api_error(404, 'GAME', 'Неизвестная игра')
    if not game_available(game):
        return api_error(404, 'GAME', 'Игра временно недоступна')
    db = get_store()
    db.record_play(user['id'], game)
    db.unlock_achievement(user['id'], 'first_game')
    plays = db.plays_total(user['id'])
    if plays >= 10:
        db.unlock_achievement(user['id'], 'games_10')
    if plays >= 50:
        db.unlock_achievement(user['id'], 'games_50')
    if db.balance(user['id']) >= 5000:
        db.unlock_achievement(user['id'], 'balance_5k')
    return jsonify({'ok': True, 'coins': db.balance(user['id']), 'plays': plays})


@app.post('/api/games/reward')
@login_required
def game_reward():
    """Награда за игровое событие. Сумму и лимиты определяет сервер."""
    data = json_body()
    user = current_user()
    game = str(data.get('game', ''))
    spec = GAMES_BY_ID.get(game)
    if not spec:
        return api_error(404, 'GAME', 'Неизвестная игра')
    if not game_available(game):
        return api_error(404, 'GAME', 'Игра временно недоступна')
    if not rate('reward', 60, 60):
        return api_error(429, 'RATE_LIMIT', 'Слишком часто. Подождите немного.')
    receipt = data.get('receipt') or data.get('ref')
    if not isinstance(receipt, str) or not re.fullmatch(r'[A-Za-z0-9_:.\-]{6,120}', receipt):
        return api_error(400, 'RECEIPT', 'Некорректная квитанция события')
    db = get_store()
    try:
        result = db.game_reward(user['id'], game, spec['reward'], f'{user["id"]}:{game}:{receipt}',
                                f'Игра: {spec["name"]}', spec['daily'])
    except StoreError as exc:
        return api_error(400, 'REWARD', str(exc))
    if result.get('awarded'):
        db.record_play(user['id'], game)
    return jsonify({'ok': True, 'awarded': result.get('awarded', 0), 'repeated': result['repeated'],
                    'coins': result['balance'], 'dailyLeft': result.get('daily_left'),
                    'ceiling': result.get('capped', False)})


# --------------------------------------------------------------------------- shop
@app.get('/api/shop')
def shop_catalog():
    user = current_user()
    return jsonify(shop.catalog(user['id'] if user else None))


@app.post('/api/shop/buy')
@login_required
def shop_buy():
    data = json_body()
    user = current_user()
    item_id = str(data.get('item', ''))
    if not rate('shop_buy', 30, 300):
        return api_error(429, 'RATE_LIMIT', 'Слишком много покупок подряд.')
    try:
        result = shop.buy(user['id'], item_id)
    except InsufficientFunds:
        return api_error(402, 'NO_FUNDS', 'Недостаточно V-монет.')
    except NotFound as exc:
        return api_error(404, 'ITEM', str(exc))
    except StoreError as exc:
        return api_error(400, 'SHOP', str(exc))
    result['user'] = public_user(get_store().get_user(user['id']))
    return jsonify(result)


@app.post('/api/shop/equip')
@login_required
def shop_equip():
    data = json_body()
    user = current_user()
    try:
        result = shop.equip(user['id'], str(data.get('item', '')))
    except shop.NotOwned as exc:
        return api_error(403, 'NOT_OWNED', str(exc))
    except NotFound as exc:
        return api_error(404, 'ITEM', str(exc))
    except StoreError as exc:
        return api_error(400, 'SHOP', str(exc))
    result['user'] = public_user(get_store().get_user(user['id']))
    return jsonify(result)


@app.get('/api/shop/packs')
def shop_packs():
    return jsonify(shop.wallet(current_user()['id'] if current_user() else None))


@app.post('/api/shop/order')
@login_required
def shop_order():
    data = json_body()
    if not rate('shop_order', 12, 600):
        return api_error(429, 'RATE_LIMIT', 'Слишком много заказов.')
    base = os.environ.get('PUBLIC_URL', '').rstrip('/') or request.host_url.rstrip('/')
    try:
        return jsonify(shop.create_order(current_user()['id'], str(data.get('pack', '')), base))
    except shop.ShopError as exc:
        return api_error(exc.status, exc.code, exc.message)


@app.post('/api/shop/claim')
@login_required
def shop_claim():
    data = json_body()
    try:
        result = shop.claim(current_user()['id'], str(data.get('order', '')))
    except NotFound as exc:
        return api_error(404, 'ORDER', str(exc))
    except StoreError as exc:
        return api_error(409, 'ORDER', str(exc))
    result['user'] = public_user(get_store().get_user(current_user()['id']))
    return jsonify(result)


@app.post('/api/shop/webhook/<kind>')
def shop_webhook(kind: str):
    if kind not in shop.PROVIDERS:
        return api_error(404, 'WEBHOOK', 'Неизвестный провайдер')
    raw = request.get_data(cache=False) or b''
    if not raw or len(raw) > 65536:
        return api_error(413, 'TOO_LARGE', 'Payload too large')
    status, payload = shop.webhook(kind, raw, request.headers)
    return jsonify(payload), status


# --------------------------------------------------------------------------- casino
@app.get('/api/casino/rules')
def casino_rules():
    user = current_user()
    payload = casino_logic.rules()
    payload['ok'] = True
    if user:
        limits = get_store().casino_limits(user['id'])
        payload['freeSpin'] = casino_logic.free_spin_available(user['id'])
        payload['limits'] = {'daily': limits['daily_limit'],
                             'excludeUntil': limits['exclude_until']}
        payload['coins'] = get_store().balance(user['id'])
    return jsonify(payload)


@app.post('/api/casino/wheel')
@login_required
def casino_wheel():
    data = json_body()
    user = current_user()
    if not rate('casino', 90, 60):
        return api_error(429, 'RATE_LIMIT', 'Слишком много ставок подряд.')
    try:
        result = casino_logic.spin_wheel(user['id'], data.get('stake'),
                                         allow_free=bool(data.get('free')))
    except casino_logic.CasinoError as exc:
        return api_error(exc.status, exc.code, exc.message)
    except LimitExceeded as exc:
        return api_error(400, 'LIMIT', str(exc))
    except InsufficientFunds:
        return api_error(402, 'NO_FUNDS', 'Недостаточно V-монет для ставки.')
    result['ok'] = True
    result['achievements'] = _casino_achievements(user['id'], result)
    return jsonify(result)


@app.post('/api/casino/slots')
@login_required
def casino_slots():
    data = json_body()
    user = current_user()
    if not rate('casino', 90, 60):
        return api_error(429, 'RATE_LIMIT', 'Слишком много ставок подряд.')
    try:
        result = casino_logic.spin_slots(user['id'], data.get('stake'))
    except casino_logic.CasinoError as exc:
        return api_error(exc.status, exc.code, exc.message)
    except LimitExceeded as exc:
        return api_error(400, 'LIMIT', str(exc))
    except InsufficientFunds:
        return api_error(402, 'NO_FUNDS', 'Недостаточно V-монет для ставки.')
    result['ok'] = True
    result['achievements'] = _casino_achievements(user['id'], result)
    return jsonify(result)


def _casino_achievements(user_id: int, result: dict) -> list:
    db = get_store()
    unlocked = []
    for ach in ('first_bet',):
        item = db.unlock_achievement(user_id, ach)
        if item:
            unlocked.append(item)
    if result.get('payout', 0) >= 500:
        item = db.unlock_achievement(user_id, 'big_win')
        if item:
            unlocked.append(item)
    stats = db.casino_stats(user_id)
    if int(stats.get('bets') or 0) >= 20:
        item = db.unlock_achievement(user_id, 'wheel_master')
        if item:
            unlocked.append(item)
    if db.balance(user_id) >= 5000:
        item = db.unlock_achievement(user_id, 'balance_5k')
        if item:
            unlocked.append(item)
    return unlocked


@app.get('/api/casino/history')
@login_required
def casino_history():
    user = current_user()
    db = get_store()
    limit = min(100, max(1, int(request.args.get('limit', 25) or 25)))
    game = request.args.get('game') or None
    stats = db.casino_stats(user['id'])
    # spins/net — то, что показывают страницы: число ставок и чистый результат.
    stats['spins'] = int(stats.get('bets') or 0)
    stats['net'] = int(stats.get('won') or 0) - int(stats.get('staked') or 0)
    return jsonify({'ok': True, 'items': db.casino_history(user['id'], limit, game), 'stats': stats})


@app.post('/api/casino/limits')
@login_required
def casino_limits():
    data = json_body()
    user = current_user()
    db = get_store()
    daily = data.get('daily')
    minutes = data.get('excludeMinutes')
    if daily is not None:
        try:
            daily = max(0, min(100000, int(daily)))
        except (TypeError, ValueError):
            return api_error(400, 'LIMIT', 'Некорректный лимит')
        db.set_casino_limits(user['id'], daily_limit=daily)
    if minutes is not None:
        try:
            minutes = max(0, min(60 * 24 * 365, int(minutes)))
        except (TypeError, ValueError):
            return api_error(400, 'LIMIT', 'Некорректный период')
        db.set_casino_limits(user['id'], exclude_until=now() + minutes * 60 if minutes else 0)
    limits = db.casino_limits(user['id'])
    db.admin_log(user['username'], 'casino_limits', user['username'], json.dumps(limits),
                 store.digest(client_ip()))
    return jsonify({'ok': True, 'limits': {'daily': limits['daily_limit'],
                                           'excludeUntil': limits['exclude_until']}})


# --------------------------------------------------------------------------- leaderboard
@app.get('/api/leaderboard')
def leaderboard():
    data = get_store()
    users = data.top_users(20)
    achievements = data.recent_achievements(12)
    with data.driver.transaction() as c:
        plays = c.execute('SELECT COALESCE(SUM(plays),0) AS n FROM game_stats').fetchone()
        players = c.execute('SELECT COUNT(*) AS n FROM users').fetchone()
        coins = c.execute('SELECT COALESCE(SUM(coins),0) AS n FROM users').fetchone()
    return jsonify({
        'ok': True,
        'users': [{'username': u['username'], 'balance': int(u['coins']), 'avatar': u['avatar'],
                   'color': u['color'], 'title': u['title']} for u in users],
        'achievements': [{'name_ru': a['name_ru'], 'name_en': a['name_en'], 'icon': a['icon'],
                          'coins': int(a['coins']), 'username': a['username'],
                          'unlocked': int(a['unlocked'])} for a in achievements],
        'totals': {'players': int(players['n']), 'coins': int(coins['n']),
                   'plays': int(plays['n']), 'games': len(public_games())},
    })


# --------------------------------------------------------------------------- admin
@app.post('/api/admin/login')
def admin_login():
    data = json_body()
    if not rate('admin_login', int(os.environ.get('ADMIN_LOGIN_RATE', '6')), 900):
        return api_error(429, 'RATE_LIMIT', 'Слишком много попыток. Вход заблокирован на 15 минут.')
    password = str(data.get('password', ''))
    expected = os.environ.get('ADMIN_PASSWORD', '219384')
    ok, _ = captcha.verify(data.get('turnstileToken', ''), client_ip())
    if not ok:
        return api_error(400, 'CAPTCHA', 'Проверка CAPTCHA не пройдена.')
    if not _admin_password_ok(password, expected):
        db = get_store()
        db.admin_log('system', 'admin_login_failed', '', '', store.digest(client_ip()))
        return api_error(401, 'PASSWORD', 'Неверный пароль администратора.')
    token = get_store().new_admin_session(client_ip())
    get_store().admin_log('admin', 'admin_login', '', '', store.digest(client_ip()))
    response = jsonify({'ok': True})
    set_cookie(response, ADMIN_COOKIE, token, store.ADMIN_SESSION_TTL)
    return response


def _admin_password_ok(password: str, expected: str) -> bool:
    import hmac
    return bool(expected) and hmac.compare_digest(password.encode(), expected.encode())


@app.post('/api/admin/logout')
def admin_logout():
    token = request.cookies.get(ADMIN_COOKIE, '')
    get_store().delete_admin_session(token)
    response = jsonify({'ok': True})
    clear_cookie(response, ADMIN_COOKIE)
    return response


@app.get('/api/admin/stats')
@admin_required
def admin_stats():
    return jsonify({'ok': True, 'stats': get_store().platform_stats()})


@app.get('/api/admin/users')
@admin_required
def admin_users():
    query = request.args.get('q', '')
    limit = min(100, max(1, int(request.args.get('limit', 30) or 30)))
    offset = max(0, int(request.args.get('offset', 0) or 0))
    rows, total = get_store().search_users(query, limit, offset)
    return jsonify({'ok': True, 'users': rows, 'total': total, 'limit': limit, 'offset': offset})


@app.get('/api/admin/user/<username>')
@admin_required
def admin_user(username: str):
    db = get_store()
    user = db.find_user(username)
    if not user:
        return api_error(404, 'NOT_FOUND', 'Игрок не найден')
    return jsonify({
        'ok': True,
        'user': {k: user[k] for k in ('id', 'username', 'coins', 'is_admin', 'banned', 'ban_reason',
                                     'avatar', 'color', 'title', 'created', 'last_seen', 'legacy_email')},
        'stats': {'games': db.plays_total(user['id']), 'gameStats': db.game_stats(user['id']),
                  'casino': db.casino_stats(user['id'])},
        'achievements': db.user_achievements(user['id']),
        'purchases': db.purchases(user['id']),
        'ledger': db.ledger(user['id'], limit=40),
        'casinoHistory': db.casino_history(user['id'], 20),
        'sessions': 0,
    })


def _admin_targets(username: str):
    db = get_store()
    user = db.find_user(username)
    if not user:
        return None, None
    return db, user


@app.post('/api/admin/balance')
@admin_required
def admin_balance():
    data = json_body()
    db, user = _admin_targets(str(data.get('username', '')))
    if not user:
        return api_error(404, 'NOT_FOUND', 'Игрок не найден')
    reason = str(data.get('reason', 'Изменение администратора'))[:160]
    try:
        if data.get('set') is not None:
            value = int(data['set'])
            if not 0 <= value <= store.MAX_BALANCE:
                return api_error(400, 'VALUE', 'Некорректная сумма')
            balance = db.set_balance(user['id'], value, 'admin', reason)
            delta = balance - int(user['coins'])
        else:
            delta = int(data.get('delta', 0))
            if not -1000000 <= delta <= 1000000:
                return api_error(400, 'VALUE', 'Некорректная сумма')
            balance = db.add_coins(user['id'], delta, 'admin', reason)['balance']
    except (TypeError, ValueError):
        return api_error(400, 'VALUE', 'Некорректная сумма')
    except InsufficientFunds:
        return api_error(400, 'VALUE', 'Баланс не может быть отрицательным')
    db.admin_log('admin', 'balance', user['username'], f'delta={delta} balance={balance} {reason}',
                 store.digest(client_ip()))
    return jsonify({'ok': True, 'coins': balance, 'delta': delta})


@app.post('/api/admin/banned')
@admin_required
def admin_ban():
    data = json_body()
    db, user = _admin_targets(str(data.get('username', '')))
    if not user:
        return api_error(404, 'NOT_FOUND', 'Игрок не найден')
    if user['is_admin'] and data.get('banned'):
        return api_error(400, 'ADMIN', 'Нельзя заблокировать администратора')
    banned = bool(data.get('banned'))
    db.ban_user(user['id'], banned, str(data.get('reason', ''))[:200])
    db.admin_log('admin', 'ban' if banned else 'unban', user['username'],
                 str(data.get('reason', ''))[:200], store.digest(client_ip()))
    return jsonify({'ok': True, 'banned': banned})


@app.post('/api/admin/is_admin')
@admin_required
def admin_set_admin():
    data = json_body()
    db, user = _admin_targets(str(data.get('username', '')))
    if not user:
        return api_error(404, 'NOT_FOUND', 'Игрок не найден')
    value = bool(data.get('isAdmin'))
    db.set_admin(user['id'], value)
    db.admin_log('admin', 'grant_admin' if value else 'revoke_admin', user['username'], '',
                 store.digest(client_ip()))
    return jsonify({'ok': True, 'isAdmin': value})


@app.get('/api/admin/log')
@admin_required
def admin_log_rows():
    return jsonify({'ok': True, 'items': get_store().admin_log_rows(80)})


@app.get('/api/admin/settings')
@admin_required
def admin_settings():
    return jsonify({'ok': True, 'settings': get_store().settings_map(), 'rules': casino_logic.rules()})


@app.post('/api/admin/settings')
@admin_required
def admin_settings_set():
    data = json_body()
    db = get_store()
    allowed = {'casino_enabled', 'wheel_enabled', 'slots_enabled', 'min_stake', 'max_stake'}
    updated = {}
    for key, value in (data.get('settings') or {}).items():
        if key not in allowed:
            continue
        if key in ('min_stake', 'max_stake'):
            try:
                value = max(1, min(10000, int(value)))
            except (TypeError, ValueError):
                return api_error(400, 'VALUE', 'Некорректное значение лимита')
        else:
            value = '1' if str(value) in ('1', 'True', 'true', 'on') else '0'
        db.set_setting(key, str(value))
        updated[key] = value
    db.admin_log('admin', 'settings', '', json.dumps(updated), store.digest(client_ip()))
    return jsonify({'ok': True, 'updated': updated})


@app.get('/api/admin/games')
@admin_required
def admin_games():
    db = get_store()
    with db.driver.transaction() as c:
        rows = c.execute('SELECT game, COUNT(DISTINCT user_id) AS players, SUM(plays) AS plays,'
                         ' SUM(coins) AS earned FROM game_stats GROUP BY game').fetchall()
    stats = {r['game']: {'players': int(r['players']), 'plays': int(r['plays'] or 0),
                         'earned': int(r['earned'] or 0)} for r in rows}
    games_out = []
    # Админка показывает все игры, включая временно скрытые (флаг hidden в game_catalog)
    for game in GAMES:
        info = stats.get(game['id'], {'players': 0, 'plays': 0, 'earned': 0})
        enabled = db.get_setting(f'game_{game["id"]}_enabled', '1') == '1'
        games_out.append({**{k: game[k] for k in ('id', 'name', 'name_en', 'file', 'reward', 'icon')},
                          **info, 'enabled': enabled, 'hidden': bool(game.get('hidden'))})
    return jsonify({'ok': True, 'games': games_out})


@app.post('/api/admin/games')
@admin_required
def admin_games_set():
    data = json_body()
    game = str(data.get('id', ''))
    if game not in GAMES_BY_ID:
        return api_error(404, 'GAME', 'Неизвестная игра')
    enabled = bool(data.get('enabled'))
    get_store().set_setting(f'game_{game}_enabled', '1' if enabled else '0')
    get_store().admin_log('admin', 'game_toggle', game, 'enabled' if enabled else 'disabled',
                          store.digest(client_ip()))
    return jsonify({'ok': True, 'enabled': enabled})


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith('/api/'):
        return api_error(404, 'NOT_FOUND', 'Неизвестный запрос')
    return ('<!doctype html><meta charset="utf-8"><title>404 — Vertu Games</title>'
            '<body style="background:#08090d;color:#e9ecf5;font:16px system-ui;display:grid;'
            'place-items:center;height:100vh;margin:0"><div style="text-align:center">'
            '<h1 style="font-size:64px;margin:0">404</h1><p style="color:#9aa3b8">Страница не найдена</p>'
            '<a href="/" style="color:#c6ff3d">На главную</a></div>'), 404


@app.errorhandler(405)
def method_not_allowed(_):
    return api_error(405, 'METHOD', 'Метод не поддерживается')


@app.errorhandler(413)
def too_large(_):
    return api_error(413, 'TOO_LARGE', 'Слишком большой запрос')


if __name__ == '__main__':
    get_store()
    port = int(os.environ.get('PORT', '8000'))
    print(f'Vertu Games: http://0.0.0.0:{port}  backend={get_store().backend}', flush=True)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
