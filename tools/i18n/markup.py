"""Автоматическая двуязычная разметка страниц.

Сборщик отдаёт готовый HTML, а ``localize()`` проставляет каждому текстовому узлу
(и подписям ``placeholder``/``aria-label``/``title``/``alt``/``content``) пару
``data-ru``/``data-en``. Дальше вся переключалка языка уже работает в рантайме
(``VG.setLang``): она подменяет содержимое по атрибутам и ничего не знает про
шаблоны конкретной страницы.

Если перевода нет, сборка падает: так «забытая» русская строка не попадёт на сайт.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ui_en import UI_EN  # noqa: E402

CYRILLIC = re.compile(r'[А-Яа-яЁё]')
TEXT_ATTRS = ('placeholder', 'aria-label', 'title', 'alt', 'content')
# Теги, внутри которых текст не переводим (код, стили, скрипты).
SKIP_TAGS = {'script', 'style', 'code', 'pre', 'svg', 'title'}

_MISSING: set[str] = set()


def translate(text: str) -> str:
    """Перевод строки с подстановкой счётчиков игр."""
    from context import games_count  # локальный импорт, чтобы не плодить циклы
    key = text.strip()
    if key in UI_EN:
        return UI_EN[key]
    for template, english in UI_EN.items():
        if '{n}' in template:
            pattern = '^' + re.escape(template).replace(re.escape('{n}'), r'(\d+)') + '$'
            match = re.match(pattern, key)
            if match:
                number = match.group(1)
                plural = english
                return plural.replace('{n}', number)
    if '{games}' in key:
        return key.replace('{games}', games_count('en'))
    _MISSING.add(key)
    return ''


class Localizer(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.out: list[str] = []
        self.skip_depth = 0
        self.stack: list[str] = []
        # Для <option> нельзя оборачивать текст в span — атрибуты ставим на сам тег.
        self.option_at: int | None = None

    # --- позиции в исходнике, чтобы правки шли по смещениям ---
    def _offset(self) -> int:
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def localize(self) -> str:
        # Заголовок вкладки нельзя оборачивать в span: английский вариант
        # кладём атрибутом data-title-en на <html>.
        found = re.search(r'<title>(.*?)</title>', self.source, re.S)
        self.title_ru = ' '.join(found.group(1).split()) if found else ''
        self.title_en = translate(self.title_ru) if self.title_ru else ''
        self.line_starts = [0]
        for line in self.source.splitlines(keepends=True):
            self.line_starts.append(self.line_starts[-1] + len(line))
        self.feed(self.source)
        self.close()
        result = ''.join(self.out)
        return result

    def handle_decl(self, decl):
        self.out.append(f'<!{decl}>')

    def handle_comment(self, data):
        self.out.append(f'<!--{data}-->')

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        self.stack.append(tag)
        if tag == 'option':
            self.option_at = len(self.out)
        if tag in SKIP_TAGS:
            self.skip_depth += 1
        if tag == 'html' and self.title_en:
            escaped_title = self.title_en.replace('&', '&amp;').replace('"', '&quot;')
            new_raw = raw.replace('>', f' data-title-en="{escaped_title}">', 1)
            self.out.append(new_raw)
            return
        if tag in ('meta', 'link'):
            self.out.append(raw)
            return
        new_raw = raw
        for name, value in attrs:
            if not value or name not in TEXT_ATTRS or not CYRILLIC.search(value):
                continue
            english = translate(value)
            if not english:
                continue
            marker = f'{name}="{value}"'
            if marker in new_raw:
                new_raw = new_raw.replace(
                    marker, f'{name}="{value}" data-{name}-en="{english}"', 1)
        self.out.append(new_raw)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        # get_starttag_text для самозакрывающихся тегов уже содержит «/>».

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        if tag == 'option':
            self.option_at = None
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        self.out.append(f'</{tag}>')

    def handle_data(self, data):
        if self.skip_depth or not data.strip() or not CYRILLIC.search(data):
            self.out.append(data)
            return
        # Сохраняем исходные пробелы вокруг текста.
        lead = data[:len(data) - len(data.lstrip())]
        trail = data[len(data.rstrip()):]
        # В шаблонах строки переносятся по строкам — ищем перевод по «сжатому» виду.
        core = ' '.join(data.split())
        english = translate(core)
        if not english:
            _MISSING.add(core)
            self.out.append(data)
            return
        if self.stack and self.stack[-1] == 'option':
            # В <option> разметка невозможна: пару языков вешаем на сам тег.
            if self.option_at is not None:
                raw = self.out[self.option_at]
                if raw.rstrip().endswith('>'):
                    head = raw.rstrip()[:-1]
                    self.out[self.option_at] = f'{head} data-ru="{core}" data-en="{english}">'
            self.out.append(data)
            return
        escaped = english.replace('&', '&amp;').replace('"', '&quot;')
        self.out.append(f'{lead}<span data-ru="{core}" data-en="{escaped}">{core}</span>{trail}')

    def handle_entityref(self, name):
        self.out.append(f'&{name};')

    def handle_charref(self, name):
        self.out.append(f'&#{name};')


def localize(html_text: str) -> str:
    return Localizer(html_text).localize()


def missing() -> list[str]:
    return sorted(_MISSING)
