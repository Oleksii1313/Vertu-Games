#!/usr/bin/env python3
"""Проверка «картинки не искажаются» по всей платформе.

Искажение появляется ровно тогда, когда картинку растягивают по двум осям
по-разному. Скрипт ищет такие места в разметке, стилях и играх:

* ``object-fit:fill`` и ``background-size:100% 100%`` — явное растяжение;
* ``preserveAspectRatio="none"`` у SVG;
* неравномерный ``transform:scale(x,y)`` / ``scaleX`` / ``scaleY`` у картинок,
  canvas и превью;
* ``<img>`` без ``width``/``height``, если контейнер не задаёт пропорцию
  (иначе браузер до загрузки рисует картинку в 0 высоты — скачок вёрстки);
* canvas, которому CSS задаёт и ширину, и высоту: у такой страницы должен быть
  код, подгоняющий буфер отрисовки, иначе кадр «квадратится» или растягивается;
* ссылки на несуществующие файлы картинок.

Запуск::

    python3 tools/check_images.py          # проверка (0 — всё хорошо)
    python3 tools/check_images.py -v       # с перечнем проверенных мест
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = sorted(p for p in ROOT.glob('*.html')) + sorted(p for p in (ROOT / 'games').glob('*.html'))
STYLES = sorted(ROOT.glob('assets/vg/css/*.css')) + sorted((ROOT / 'tools').glob('*.css'))
SCRIPTS = sorted(ROOT.glob('assets/vg/js/*.js'))

STRETCH_CSS = [
    (re.compile(r'object-fit\s*:\s*fill', re.I), 'object-fit:fill растягивает картинку'),
    (re.compile(r'background-size\s*:\s*100%\s+100%', re.I), 'background-size:100% 100% растягивает фон'),
    (re.compile(r'preserveAspectRatio\s*=\s*["\']none', re.I), 'preserveAspectRatio="none" ломает пропорции SVG'),
]
UNEVEN_SCALE = re.compile(r'transform\s*:\s*[^;{}]*\bscale\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)', re.I)
AXIS_SCALE = re.compile(r'transform\s*:\s*[^;{}]*\bscale[XY]\s*\(', re.I)
MEDIA_SELECTOR = re.compile(r'(img|\bcanvas\b|\bsvg\b|\.art\b|mascot|cover|thumb|preview|avatar|logo)', re.I)
IMG_TAG = re.compile(r'<img\b[^>]*>', re.I)
CANVAS_BUFFER = re.compile(
    r'(\.width\s*=|\.height\s*=|setSize\s*\(|setDrawingBufferSize\s*\(|getBoundingClientRect\s*\(|clientWidth|clientHeight|devicePixelRatio|fitSquare)'
)


def css_rules(text: str) -> list[tuple[str, str]]:
    """Грубый разбор правил: (селектор, тело). Вложенные медиа-блоки не мешают."""
    rules = []
    for match in re.finditer(r'([^{}@]+)\{([^{}]*)\}', text):
        selector = ' '.join(match.group(1).split())[-160:]
        body = match.group(2)
        if selector:
            rules.append((selector, body))
    return rules


class Report:
    def __init__(self) -> None:
        self.problems: list[str] = []
        self.notes: list[str] = []
        self.checked = 0

    def fail(self, where: str, message: str) -> None:
        self.problems.append(f'{where}: {message}')

    def note(self, message: str) -> None:
        self.notes.append(message)


def check_styles(report: Report) -> None:
    for path in STYLES + PAGES:
        text = path.read_text(encoding='utf-8')
        where = path.relative_to(ROOT).as_posix()
        if path.suffix == '.css':
            css_text = text
        else:
            css_text = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', text, re.S | re.I))
        if not css_text:
            continue
        for pattern, message in STRETCH_CSS:
            for match in pattern.finditer(css_text):
                line = css_text[:match.start()].count('\n') + 1
                report.fail(f'{where}:{line}', message)
        for selector, body in css_rules(css_text):
            report.checked += 1
            if not MEDIA_SELECTOR.search(selector):
                continue
            uneven = UNEVEN_SCALE.search(body)
            if uneven and uneven.group(1) != uneven.group(2):
                report.fail(where, f'неравномерное масштабирование в «{selector}»: {uneven.group(0)}')
            elif AXIS_SCALE.search(body):
                report.fail(where, f'масштаб по одной оси меняет пропорции в «{selector}»: {body.strip()[:70]}')


def check_markup(report: Report) -> None:
    for path in PAGES:
        text = path.read_text(encoding='utf-8')
        where = path.relative_to(ROOT).as_posix()
        css_text = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', text, re.S | re.I))
        page_css = (path.parent / 'assets' / 'vg' / 'css' / 'platform.css')
        if page_css.exists():
            css_text += '\n' + page_css.read_text(encoding='utf-8')
        for tag in IMG_TAG.finditer(text):
            report.checked += 1
            html = tag.group(0)
            src = re.search(r'\bsrc\s*=\s*["\']([^"\']+)', html, re.I)
            classes = (re.search(r'\bclass\s*=\s*["\']([^"\']*)', html, re.I) or [None, ''])[1] if re.search(
                r'\bclass\s*=\s*["\']([^"\']*)', html, re.I) else ''
            name = re.search(r'\bid\s*=\s*["\']([^"\']+)', html, re.I)
            name = name.group(1) if name else ''
            if src:
                target = (path.parent / src.group(1)).resolve()
                if not target.exists():
                    report.fail(where, f'нет файла картинки: {src.group(1)}')
            if 'width=' not in html.lower() or 'height=' not in html.lower():
                selectors = ' '.join(filter(None, [
                    '.' + c for c in classes.split() if c
                ] + ['#' + name if name else '']))
                covered = False
                if selectors:
                    for selector, body in css_rules(css_text):
                        if any(sel and sel in selector for sel in selectors.split()):
                            if 'aspect-ratio' in body or 'object-fit' in body or 'height' in body:
                                covered = True
                                break
                if not covered:
                    report.fail(where, f'<img> без width/height и без пропорции в CSS: {html[:80]}')


def check_canvas(report: Report) -> None:
    for path in PAGES:
        text = path.read_text(encoding='utf-8')
        where = path.relative_to(ROOT).as_posix()
        rules = css_rules('\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', text, re.S | re.I)))
        has_buffer_code = bool(CANVAS_BUFFER.search(text))
        fixed_box = []
        for selector, body in rules:
            if 'canvas' not in selector.lower():
                continue
            width = re.search(r'(?<!max-)(?<!min-)\bwidth\s*:\s*([^;]+)', body)
            height = re.search(r'(?<!max-)(?<!min-)\bheight\s*:\s*([^;]+)', body)
            if not width or not height:
                continue
            if 'auto' in (width.group(1) + height.group(1)):
                continue
            if 'object-fit' in body or 'aspect-ratio' in body:
                continue
            fixed_box.append(selector)
        if fixed_box and not has_buffer_code:
            report.fail(where, 'canvas растягивается стилями без подгонки буфера: ' + ', '.join(fixed_box[:3]))
        if '<canvas' in text:
            report.checked += 1


def check_stage_fit(report: Report) -> None:
    """Полноэкранный 3D-кадр должен пересчитываться при смене видимой области.

    Адресная строка iOS/Android меняет высоту без события ``resize``: если
    буфер отрисовки не подогнать, картинка на экране растягивается по вертикали.
    """
    for path in sorted((ROOT / 'games').glob('*.html')):
        text = path.read_text(encoding='utf-8')
        where = path.relative_to(ROOT).as_posix()
        needs_fit = 'engine.resize(' in text or 'Xe.setSize(' in text or '.setSize(i.w' in text
        if not needs_fit:
            continue
        report.checked += 1
        if 'visualViewport' not in text:
            report.fail(where, 'нет пересчёта кадра по visualViewport — на телефоне возможен растянутый кадр')
        if 'orientationchange' not in text:
            report.fail(where, 'нет пересчёта кадра по orientationchange')


def check_page_scripts(report: Report) -> None:
    """Скрипты страниц не должны растягивать картинки на canvas по двум осям."""
    for path in SCRIPTS + PAGES:
        text = path.read_text(encoding='utf-8')
        where = path.relative_to(ROOT).as_posix()
        for match in re.finditer(r'drawImage\s*\(([^)]*)\)', text):
            args = [a.strip() for a in match.group(1).split(',')]
            report.checked += 1
            if len(args) >= 5:
                report.note(f'{where}: drawImage с 5+ аргументами — {args[1:5]} (проверено вручную)')
        for match in re.finditer(r'\.scale\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)', text):
            if match.group(1) != match.group(2):
                report.note(f'{where}: canvas .scale({match.group(1)}, {match.group(2)}) — рисование, не картинка')


def main(argv: list[str]) -> int:
    report = Report()
    check_styles(report)
    check_markup(report)
    check_canvas(report)
    check_stage_fit(report)
    check_page_scripts(report)
    if '-v' in argv:
        for note in report.notes:
            print(' ·', note)
    if report.problems:
        print('Найдено проблем с пропорциями изображений:')
        for problem in report.problems:
            print('  ✗', problem)
        return 1
    print(f'Пропорции изображений в порядке: проверено {report.checked} правил/тегов, замечаний нет.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
