#!/usr/bin/env python3
"""Магазин: страница услуги «Смена ника» и её двуязычность.

Проверяется то, что видит игрок и что требует ТЗ:

  1. карточка услуги есть в магазине, стоит 1000 V и открывает окно смены ника;
  2. у названия, описания, чипа раздела, кнопки и пояснения есть английская пара
     (data-ru/data-en) — никакого непереведённого текста;
  3. каталог данных отдаёт name_ru/name_en и цену 1000;
  4. окно смены ника в shop.js переведено через T() и перерисовывется при смене
     языка (VG.onLangChange), ошибки и подсказки тоже двуязычны;
  5. VG.rename вызывает POST /api/shop/rename, а ручка описана в api.html;
  6. существующие предметы и цены не изменились (контрольные суммы каталога).

Запуск:  /tmp/venv/bin/python -m unittest tools.test_shop_rename_ui -v
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding='utf-8')


class ShopRenameServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shop = read('shop.html')
        cls.catalog_js = read('assets/vg/js/catalog-data.js')
        cls.shop_js = read('assets/vg/js/shop.js')
        cls.platform_js = read('assets/vg/js/platform.js')

    # ------------------------------------------------------------------ карточка
    def test_service_card_in_shop(self) -> None:
        card = re.search(r'<div class="shop-item" data-item="username_change">(.*?)</div>\s*</div>', self.shop, re.S)
        self.assertIsNotNone(card, 'карточки услуги нет на странице магазина')
        block = card.group(1)
        self.assertIn('1000 V', block)
        self.assertIn('data-rename="username_change"', block)

    def test_service_section_and_chip(self) -> None:
        self.assertIn('id="kind-service"', self.shop)
        self.assertIn('data-jump="kind-service"', self.shop)
        self.assertIn('data-ru="Услуги" data-en="Services"', self.shop)

    def test_pairs_for_every_visible_service_string(self) -> None:
        pairs = {
            'Услуги': 'Services',
            'Смена ника': 'Change username',
            'Сменить ник': 'Change username',
            'Разовая услуга: 1000 V списываются один раз, ник меняется сразу.':
                'One-time service: 1000 V is charged once and the username changes immediately.',
        }
        for ru, en in pairs.items():
            with self.subTest(ru=ru):
                self.assertIn(f'data-ru="{ru}" data-en="{en}"', self.shop)

    def test_service_card_has_no_untranslated_russian_text(self) -> None:
        """Внутри карточки/раздела услуги любой русский текст — только в парах."""
        start = self.shop.index('id="kind-service"')
        # до конца секции: следующая карточка раздела
        end = self.shop.index('id="kind-boost"', start)
        section = self.shop[start:end]
        # убираем переведённые пары и служебные атрибуты
        stripped = re.sub(r'<span [^>]*data-en="[^"]*"[^>]*>.*?</span>', ' ', section, flags=re.S)
        stripped = re.sub(r'<[^>]*>', ' ', stripped)
        left = re.findall(r'[А-Яа-яЁё][А-Яа-яЁё \d,.:;!?«»—-]*', stripped)
        # после удаления пар русских «хвостов» быть не должно
        self.assertEqual([x.strip() for x in left if x.strip()], [], 'непереведённый русский текст в разделе услуги')

    # ------------------------------------------------------------------ каталог
    def test_catalog_payload(self) -> None:
        payload = self.catalog_js[self.catalog_js.index('{'): self.catalog_js.rindex('}') + 1]
        data = json.loads(payload)
        item = next(i for i in data['shop'] if i['id'] == 'username_change')
        self.assertEqual(item['price'], 1000)
        self.assertEqual(item['kind'], 'service')
        self.assertTrue(item['name_ru'])
        self.assertTrue(item['name_en'])
        self.assertNotEqual(item['name_ru'], item['name_en'])

    def test_existing_items_unchanged(self) -> None:
        payload = self.catalog_js[self.catalog_js.index('{'): self.catalog_js.rindex('}') + 1]
        data = json.loads(payload)
        prices = {i['id']: i['price'] for i in data['shop']}
        # контрольные цены до правок — услуга не должна их сдвинуть
        self.assertEqual(prices['av:rocket'], 0)
        self.assertEqual(prices['av:fox'], 100)
        self.assertEqual(prices['col:teal'], 0)
        self.assertEqual(prices['col:lime'], 60)
        self.assertEqual(prices['av:phoenix'], 280)
        self.assertEqual(prices['t:legend'], 260)
        self.assertEqual(prices['username_change'], 1000)
        self.assertEqual(len([i for i in data['shop'] if i['kind'] == 'service']), 1)

    # ------------------------------------------------------------------ окно
    def test_modal_strings_are_bilingual(self) -> None:
        for ru, en in {
            'Смена ника': 'Change username',
            'Новый ник': 'New username',
            'Отмена': 'Cancel',
            'Недостаточно V-монет: смена ника стоит 1000 V.':
                'Not enough V coins: a username change costs 1000 V.',
            'Этот ник уже занят.': 'That username is already taken.',
            'Это ваш текущий ник.': 'That is your current username.',
        }.items():
            with self.subTest(ru=ru):
                index = self.shop_js.find("'" + ru)
                self.assertNotEqual(index, -1, f'нет строки: {ru}')
                fragment = self.shop_js[index: index + 400]
                self.assertIn("'" + en, fragment, f'нет английской пары для: {ru}')

    def test_modal_repaints_on_language_change(self) -> None:
        self.assertIn('VG.onLangChange', self.shop_js)
        self.assertIn('renamePaint', self.shop_js)
        self.assertIn('paintTexts', self.shop_js)

    def test_platform_calls_server_endpoint(self) -> None:
        self.assertIn('/api/shop/rename', self.platform_js)
        self.assertIn('VG.rename = rename', self.platform_js)
        self.assertIn('name:', self.platform_js)

    def test_api_docs_list_endpoint(self) -> None:
        api = read('api.html')
        self.assertIn('/api/shop/rename', api)
        index = api.index('/api/shop/rename')
        row = api[index: api.index('</tr>', index)]
        self.assertIn('data-en="Username change', row, 'строка API без английского перевода')


if __name__ == '__main__':
    unittest.main(verbosity=2)
