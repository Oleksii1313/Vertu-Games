"""Гвардия поведения: то, что не ловят лимиты и подписи.

Три независимых механизма, все серверные и без внешних зависимостей:

1. **Скользящее окно по БД** — ``rate_limits`` с атомарным инкрементом в
   транзакции (уже есть в ``DataStore.rate_limit``). Годится для грубых лимитов
   («60 наград в минуту»), но дороже Redis на каждом запросе.
2. **Токен-бакет в памяти** (``allow``) — дешёвая защита от флуда до обращения
   к БД: одна проверка, никакого I/O. В мультипроцессном gunicorn считаем по
   воркеру — это нормально, задача не «точный учёт», а «не пускать шквал».
3. **Аномалии** (``AnomalyTracker``) — оценки «слишком частые события», «награда
   чаще, чем физически успевает игра», «много аккаунтов с одного IP». Пишем в
   журнал и временно занижаем выплаты/блокируем, не блокируя игрока навсегда
   из-за одного всплеска.

Важно: любая эвристика — источник ложных срабатываний. Поэтому аномалия сначала
только **замедляет** (мягкая деградация), и лишь повторные срабатывания дают
жёсткий ответ. Все пороги — в переменных окружения, чтобы дежурный мог ослабить
их без релиза.
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque

# --------------------------------------------------------------------------- #
#  1. Токен-бакет в памяти
# --------------------------------------------------------------------------- #
_LOCK = threading.Lock()
_BUCKETS: dict[str, tuple[float, float]] = {}   # key -> (tokens, last_ts)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, '') or default)
    except ValueError:
        return default


def allow(key: str, rate: float | None = None, burst: float | None = None) -> bool:
    """Дешёвый предохранитель: ``rate`` событий/с и всплеск ``burst``.

    Пример: ``allow('reward:'+uid, rate=1, burst=5)`` — не больше одного события в
    секунду в среднем и не больше пяти подряд. Возвращает False, когда ведро
    пусто; вызывающая сторона отвечает 429 и **не** трогает БД.
    """
    rate = _env_float('BUCKET_RATE', 2.0) if rate is None else rate
    burst = _env_float('BUCKET_BURST', 10.0) if burst is None else burst
    now = time.monotonic()
    with _LOCK:
        tokens, last = _BUCKETS.get(key, (burst, now))
        tokens = min(burst, tokens + (now - last) * rate)
        if tokens < 1:
            _BUCKETS[key] = (tokens, now)
            return False
        _BUCKETS[key] = (tokens - 1, now)
        if len(_BUCKETS) > 50000:          # защита самой структуры от роста
            stale = [k for k, (_, ts) in _BUCKETS.items() if now - ts > 300]
            for item in stale:
                _BUCKETS.pop(item, None)
        return True


def reset(key: str | None = None) -> None:
    with _LOCK:
        if key is None:
            _BUCKETS.clear()
        else:
            _BUCKETS.pop(key, None)


# --------------------------------------------------------------------------- #
#  2. Аномалии по игроку
# --------------------------------------------------------------------------- #
class AnomalyTracker:
    """История последних наград игрока (в памяти воркера).

    Считаем две метрики: частоту событий и «плотность» выплат относительно
    человеческого темпа. Игрок, который присылает награды раз в 120 мс десятками,
    почти наверняка автоматизирован — но допускаем пачку, чтобы не наказать
    быстрый браузер с очередью сообщений.
    """

    def __init__(self, window: float = 60.0, maxlen: int = 240):
        self.window = window
        self.events: dict[int, deque] = {}
        self.flags: dict[int, int] = {}
        self.lock = threading.Lock()
        self.maxlen = maxlen

    def observe(self, user_id: int, coins: int = 0) -> dict:
        now = time.monotonic()
        with self.lock:
            q = self.events.setdefault(int(user_id), deque(maxlen=self.maxlen))
            q.append((now, int(coins)))
            while q and now - q[0][0] > self.window:
                q.popleft()
            count = len(q)
            coins_sum = sum(c for _, c in q)
            flags = 0
            reasons = []
            max_events = _env_float('ANOMALY_EVENTS_PER_MIN', 90)
            max_coins = _env_float('ANOMALY_COINS_PER_MIN', 900)
            if count > max_events:
                flags += 1
                reasons.append(f'{count} событий/мин > {int(max_events)}')
            if coins_sum > max_coins:
                flags += 1
                reasons.append(f'{coins_sum} V/мин > {int(max_coins)}')
            if count >= 6:
                span = max(1e-3, q[-1][0] - q[0][0])
                if span / (count - 1) < _env_float('ANOMALY_MIN_INTERVAL', 0.35):
                    flags += 1
                    reasons.append('события чаще человеческого темпа: %.2f с' % (span / (count - 1)))
            total = self.flags.get(int(user_id), 0) + (1 if flags else 0)
            self.flags[int(user_id)] = total
            return {'flags': flags, 'strikes': total, 'reasons': reasons,
                    'events': count, 'coins': coins_sum}

    def forget(self, user_id: int) -> None:
        with self.lock:
            self.events.pop(int(user_id), None)
            self.flags.pop(int(user_id), None)


ANOMALIES = AnomalyTracker()


def anomaly_verdict(info: dict) -> str:
    """'ok' | 'throttle' | 'block'.

    Мягкая деградация: первое срабатывание — только занижаем выплату до 0 и
    пишем в журнал; повторные (>= ``ANOMALY_STRIKE_LIMIT``) — отказ 429.
    """
    if not info.get('flags'):
        return 'ok'
    limit = int(_env_float('ANOMALY_STRIKE_LIMIT', 3))
    return 'block' if info.get('strikes', 0) >= limit else 'throttle'
