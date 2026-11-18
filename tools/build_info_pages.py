#!/usr/bin/env python3
"""Устаревший сборщик информационных страниц (оставлен для истории).

Раньше этот генератор собирал about.html, support.html, api.html и privacy.html
в отдельной вёрстке. Сейчас эти четыре страницы собирает ``tools/build_platform.py``
вместе с остальными: та же шапка, подвал, переключатель языка и актуальные
тексты (серверный баланс, 11 игр, Argon2id).

Запуск этого файла больше ничего не пишет — иначе он перезаписал бы страницы
устаревшим содержимым и сломал ``tools/build_platform.py --check``.
"""
import sys


def main() -> int:
    print('tools/build_info_pages.py больше не используется.')
    print('Информационные страницы собираются командой: python3 tools/build_platform.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
