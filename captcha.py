#!/usr/bin/env python3
"""Cloudflare Turnstile: проверка капчи ИСКЛЮЧИТЕЛЬНО на сервере.

Правила:

* ``TURNSTILE_SECRET_KEY`` хранится только в переменных окружения;
* токен проверяется запросом к ``siteverify`` с нашим секретом, с ``remoteip``;
* токен одноразовый: его хеш сохраняется в БД, повторный запрос отклоняется;
* если капча не настроена владельцем (нет ключей), сервер работает без неё —
  но об этом честно сообщает клиенту и в лог, а rate-limit остаётся включённым;
* при ``TURNSTILE_REQUIRED=1`` отсутствие ключей считается ошибкой конфигурации.
"""
from __future__ import annotations

import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError

import db as store

VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'


def secret() -> str:
    return (os.environ.get('TURNSTILE_SECRET_KEY') or '').strip()


def site_key() -> str:
    return (os.environ.get('TURNSTILE_SITE_KEY') or '').strip()


def required() -> bool:
    return (os.environ.get('TURNSTILE_REQUIRED') or '0') == '1'


def enabled() -> bool:
    """Капча реально проверяется только если есть оба ключа."""
    return bool(secret() and site_key())


def config_error() -> str:
    if required() and not enabled():
        return 'CAPTCHA_NOT_CONFIGURED'
    return ''


def public_config() -> dict:
    return {'enabled': enabled(), 'required': required(), 'siteKey': site_key() if enabled() else ''}


def verify(token: str, ip: str = '') -> tuple[bool, str]:
    """Проверить токен Turnstile. Возвращает (ok, код_ошибки)."""
    if required() and not enabled():
        return False, 'CAPTCHA_NOT_CONFIGURED'
    if not enabled():
        return True, ''
    token = str(token or '').strip()
    if not token or len(token) > 4096:
        return False, 'CAPTCHA_REQUIRED'
    # Одноразовость: токен «зажигаем» до запроса к Cloudflare, чтобы два
    # параллельных запроса не прошли с одним токеном. Если сервис недоступен,
    # бронь снимается — пользователь сможет повторить попытку.
    fingerprint = store.digest('turnstile:' + token)
    if not store.get_store().rate_limit('captcha_used:' + fingerprint, 1, 900):
        return False, 'CAPTCHA_REUSED'
    body = {'secret': secret(), 'response': token}
    if ip:
        body['remoteip'] = ip
    request = Request(VERIFY_URL, data=urlencode(body).encode(),
                      headers={'Content-Type': 'application/x-www-form-urlencoded'},
                      method='POST')
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode() or '{}')
    except (URLError, TimeoutError, ValueError):
        store.get_store().rate_forget('captcha_used:' + fingerprint)
        return False, 'CAPTCHA_UNAVAILABLE'
    if payload.get('success') is not True:
        codes = payload.get('error-codes') or []
        return False, 'CAPTCHA_FAILED' if not codes else str(codes[0])
    return True, ''
