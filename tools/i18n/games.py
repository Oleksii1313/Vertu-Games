#!/usr/bin/env python3
"""Локализация HTML-игр: RU/EN без перезагрузки страницы.

Игры — самостоятельные файлы, поэтому инструмент делает две вещи:

1. проставляет data-ru/data-en видимым текстовым узлам и подписям
   (aria-label, title, placeholder);
2. добавляет в каждую игру рантайм-переводчик, который переключает язык по
   ?lang=en из платформы, по сохранённому выбору и по сообщению плеера.

Инструмент идемпотентен: повторный запуск не дублирует разметку.

    python3 tools/i18n/games.py           # разметить и перевести игры
    python3 tools/i18n/games.py --check   # только показать непереведённые строки
"""
from __future__ import annotations

import html as html_lib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from games_en import GAMES_EN  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
GAMES = sorted((ROOT / 'games').glob('*.html'))
CYRILLIC = re.compile(r'[А-Яа-яЁё]')
ATTRS = ('aria-label', 'title', 'placeholder', 'alt')

RUNTIME_ID = 'game-i18n-runtime'
STRINGS_ID = 'game-i18n-strings'
RUNTIME = r'''<script id="game-i18n-runtime">
/* Переводы игр: пары data-ru/data-en и словарь динамических строк.
   Язык берётся из ?lang=, из localStorage (выбор на платформе) или из
   сообщения player:lang от родительской страницы. */
(function () {
  'use strict';
  var ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  function detect() {
    try {
      var query = new URLSearchParams(location.search).get('lang');
      if (query === 'en' || query === 'ru') return query;
    } catch (e) {}
    try {
      var saved = localStorage.getItem('vg_lang');
      if (saved === 'en' || saved === 'ru') return saved;
    } catch (e) {}
    return 'ru';
  }
  var lang = detect();
  function dictionary(ru) {
    var table = window.VG_GAME_STRINGS || {};
    return table[ru] || null;
  }

  /* Игры пишут подписи из JS. textContent запоминаем вместе с переводом,
     чтобы при смене языка на лету перерисовать и такие строки. */
  var dynamic = window.__vgDynamic = [];
  var texts = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  var nativeSet = texts && texts.set;

  function setText(node, value) {
    if (node.tagName === 'OPTION') { node.textContent = value; return; }
    node.innerHTML = value;
  }

  function apply(next) {
    lang = next === 'en' ? 'en' : 'ru';
    document.documentElement.setAttribute('lang', lang);
    var nodes = document.querySelectorAll('[data-ru]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = node.getAttribute(lang === 'en' ? 'data-en' : 'data-ru');
      if (text == null) continue;
      if (node.tagName === 'OPTION') node.textContent = text;
      else node.innerHTML = text;
    }
    for (var d = 0; d < dynamic.length; d++) {
      var record = dynamic[d];
      if (!record.node || !record.node.parentNode) continue;
      if (record.node.getAttribute && record.node.getAttribute('data-ru')) continue;
      if (record.node.tagName === 'OPTION') record.node.textContent = lang === 'en' ? record.en : record.ru;
      else record.node.innerHTML = lang === 'en' ? record.en : record.ru;
    }
    var attrNodes = document.querySelectorAll('[data-aria-label-en],[data-title-en],[data-placeholder-en],[data-alt-en]');
    for (var j = 0; j < attrNodes.length; j++) {
      var el = attrNodes[j];
      for (var k = 0; k < ATTRS.length; k++) {
        var name = ATTRS[k];
        var english = el.getAttribute('data-' + name + '-en');
        if (english == null) continue;
        var store = 'data-' + name + '-ru';
        if (lang === 'en') {
          if (!el.hasAttribute(store)) el.setAttribute(store, el.getAttribute(name) || '');
          el.setAttribute(name, english);
        } else if (el.hasAttribute(store)) {
          el.setAttribute(name, el.getAttribute(store));
        }
      }
    }
  }

  if (nativeSet) {
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true,
      enumerable: texts.enumerable,
      get: texts.get,
      set: function (value) {
        if (this.nodeType === 3 || typeof value !== 'string' || !/[А-Яа-яЁё]/.test(value)) {
          nativeSet.call(this, value);
          return;
        }
        var english = dictionary(value) || value;
        dynamic.push({ node: this, ru: value, en: english });
        nativeSet.call(this, lang === 'en' ? english : value);
      }
    });
  }

  /* Динамические строки: игра вызывает window.VGT('рус', 'eng'). */
  window.VGT = function (ru, en) { return lang === 'en' ? en : ru; };
  window.VG_I18N = { apply: apply, lang: function () { return lang; } };

  apply(lang);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(lang); });
  }
  addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.type === 'player:lang' && data.lang) apply(data.lang);
  });
})();
</script>
'''


def _strings_script() -> str:
    """JSON-словарь строк, которые игры подставляют из JS."""
    import json
    payload = json.dumps(GAMES_EN, ensure_ascii=False, separators=(',', ':'))
    return (f'<script id="{STRINGS_ID}">/* Сгенерировано tools/i18n/games.py */'
            f'window.VG_GAME_STRINGS={payload};</script>\n')


def english(text: str) -> str | None:
    return GAMES_EN.get(' '.join(text.split()))


STRING_LITERAL = re.compile(r"\s*'([^'\n\\]*[А-Яа-яЁё][^'\n\\]*)'")


VGT_MARKER = "((window.VGT&&window.VGT("


def _literal_at(text: str, start: int) -> int:
    """Индекс сразу после строкового литерала, начинающегося в ``start``."""
    i = start + 1
    while i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == "'":
            return i + 1
        i += 1
    return -1


def _unwrap_localized(chunk: str) -> str:
    """Снимает прежние обёртки VGT, чтобы повторный запуск их не дублировал.

    Форма обёртки: ``((window.VGT&&window.VGT('ru','en'))||'ru')`` — она может
    быть вложенной, поэтому разбираем скобки, а не полагаемся на регулярку.
    """
    out: list[str] = []
    i = 0
    while True:
        start = chunk.find(VGT_MARKER, i)
        if start == -1:
            out.append(chunk[i:])
            break
        out.append(chunk[i:start])
        depth, k = 0, start
        while k < len(chunk):
            char = chunk[k]
            if char == "'":
                nxt = _literal_at(chunk, k)
                if nxt != -1:
                    k = nxt
                    continue
            elif char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        expression = chunk[start:k + 1]
        cut = expression.rfind('||')
        fallback = expression[cut + 2:].rstrip() if cut != -1 else ''
        fallback = fallback.rstrip(')').strip()
        if fallback.startswith("'") and fallback.endswith("'") and len(fallback) > 1:
            out.append(fallback)
        else:
            out.append(expression)
        i = k + 1
    return ''.join(out)


def _localize_script(chunk: str, missing: list[str]) -> str:
    """Строковые литералы в JS оборачиваем в window.VGT(ru, en) — язык учтётся."""
    if 'game-i18n-runtime' in chunk or 'VG_GAME_STRINGS' in chunk:
        return chunk
    chunk = _unwrap_localized(chunk)

    def fix(match: re.Match) -> str:
        value = match.group(1)
        # Большие шаблоны HTML переводить литералом нельзя: это разметка с тегами
        # и подстановками — такие блоки остаются на языке оригинала.
        if value.count('<') > 2:
            return match.group(0)
        # Сначала точное совпадение (важны хвостовые пробелы в шаблонных строках),
        # затем — по нормализованному тексту.
        en = GAMES_EN.get(value) or english(value)
        if not en:
            missing.append(value)
            return match.group(0)
        ru_literal = value.replace("\\", "\\\\").replace("'", "\\'")
        en_literal = en.replace("\\", "\\\\").replace("'", "\\'")
        # Пробелы до литерала сохраняем: это форматирование исходника.
        lead = match.group(0)[:len(match.group(0)) - len(match.group(0).lstrip())]
        return lead + f"((window.VGT&&window.VGT('{ru_literal}','{en_literal}'))||'{ru_literal}')"

    return STRING_LITERAL.sub(fix, chunk)


def _localize_markup(chunk: str, missing: list[str]) -> str:
    """Размечает текстовые узлы и атрибуты вне тегов script/style."""
    tag_re = re.compile(r'<[^>]+>')

    def fix_tag(match: re.Match) -> str:
        tag = match.group(0)
        if tag.startswith('</'):
            return tag
        for name in ATTRS:
            marker = f'{name}="'
            pos = tag.find(marker)
            if pos == -1 or f'data-{name}-en' in tag:
                continue
            end = tag.find('"', pos + len(marker))
            if end == -1:
                continue
            value = tag[pos + len(marker):end]
            if not CYRILLIC.search(value):
                continue
            en = english(html_lib.unescape(value))
            if not en:
                missing.append(value)
                continue
            en_attr = en.replace('"', '&quot;')
            insert_at = end + 1
            tag = tag[:insert_at] + f' data-{name}-en="{en_attr}"' + tag[insert_at:]
        return tag

    chunk = tag_re.sub(fix_tag, chunk)

    # Юридические уведомления об ассетах (CC BY 4.0) остаются как есть:
    # это точные названия, ссылки и цитаты лицензии.
    credit = re.search(r'<details[^>]*id="assetCredits".*?</details>', chunk, re.S)
    tail = ''
    if credit:
        tail = chunk[credit.end():]
        chunk = chunk[:credit.start()]

    text_re = re.compile(r'>([^<>]+)<')
    # Уже размеченный текст не трогаем повторно: инструмент идемпотентен.
    done = [(m.start(1), m.end(1)) for m in
            re.finditer(r'<span data-ru="[^"]*" data-en="[^"]*">([^<]*)</span>', chunk, re.S)]

    def fix_text(match: re.Match) -> str:
        inner = match.group(1)
        if not CYRILLIC.search(inner) or any(a <= match.start(1) < b for a, b in done):
            return match.group(0)
        core = ' '.join(inner.split())
        en = english(core)
        if not en:
            missing.append(core)
            return match.group(0)
        # Экранируем только кавычки: сущности вроде &nbsp; должны остаться рабочими.
        ru_attr = core.replace('"', '&quot;')
        en_attr = en.replace('"', '&quot;')
        return f'><span data-ru="{ru_attr}" data-en="{en_attr}">{inner}</span><'

    return text_re.sub(fix_text, chunk) + tail


def localize_file(path: Path, check_only: bool = False) -> list[str]:
    source = path.read_text(encoding='utf-8')
    missing: list[str] = []
    parts = re.split(r'(<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>)',
                     source, flags=re.S | re.I)
    out: list[str] = []
    for part in parts:
        if part.startswith('<script'):
            out.append(_localize_script(part, missing))
        elif part.startswith('<style'):
            out.append(part)
        else:
            out.append(_localize_markup(part, missing))
    result = ''.join(out)

    # Рантайм и словарь всегда пересобираются: они обновляются вместе с переводом.
    result = re.sub(r'<script id="(?:game-i18n-strings|game-i18n-runtime)">.*?</script>\n?',
                    '', result, flags=re.S)
    blocks = _strings_script() + RUNTIME
    head = result.lower().find('<head>')
    if head != -1:
        at = head + len('<head>')
        # Пустые строки после <head> не накапливаем между запусками.
        rest = result[at:].lstrip('\n')
        result = result[:at] + '\n' + blocks + rest
    else:
        idx = result.lower().rfind('</body>')
        if idx != -1:
            result = result[:idx] + blocks + result[idx:]

    if check_only:
        return missing
    if result != source:
        path.write_text(result, encoding='utf-8')
    return missing


def main(argv: list[str]) -> int:
    check_only = '--check' in argv
    gaps: dict[str, list[str]] = {}
    for path in GAMES:
        missing = localize_file(path, check_only=check_only)
        if missing:
            gaps[path.name] = sorted(set(missing))
    for name, items in gaps.items():
        print(f'{name}: осталось {len(items)} непереведённых строк')
        for item in items[:12]:
            print('   ', item[:100])
    print('готово' if not gaps else f'игр с пропусками: {len(gaps)}')
    return 0 if not gaps else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
