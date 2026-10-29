#!/usr/bin/env python3
"""Tests for scripts/book_pinyin.py (the book's own pinyin from the 识字表).

    python3 scripts/test_book_pinyin.py

The table tests use small made-up layouts. The last group reads the real
PDFs and is skipped where they are not on the machine (they are not in the
repo, for copyright).
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book_pinyin as B  # noqa: E402


class Decode(unittest.TestCase):
    def test_tone_letters(self):
        self.assertEqual(B.decode('shuQng'), 'shuāng')
        self.assertEqual(B.decode('lüF'), 'lüè')
        self.assertEqual(B.decode('de'), 'de')

    def test_every_tone_vowel_once(self):
        self.assertEqual(len(set(B.TONE_FONT.values())), len(B.TONE_FONT))


class Parse(unittest.TestCase):
    def test_pinyin_over_characters(self):
        rows, problems = B.parse(['  shuQng chuU', '1 霜 吹'])
        self.assertEqual(rows, [[('霜', 'shuāng'), ('吹', 'chuī')]])
        self.assertEqual(problems, [])

    def test_row_label_is_not_a_character(self):
        rows, _ = B.parse(['        shI   zL', '语文园地一  识 组'])
        self.assertEqual(rows, [[('识', 'shí'), ('组', 'zǔ')]])

    def test_label_on_its_own_line(self):
        rows, _ = B.parse(['      liM qU', '  语文园地一', '      六 七'])
        self.assertEqual(rows, [[('六', 'liù'), ('七', 'qī')]])

    def test_two_tables_side_by_side(self):
        py = '    rK  yuF                       bQ  jiL'
        ch = '4   日  月                  7    八  九'
        rows, problems = B.parse([py, ch])
        self.assertEqual(problems, [])
        self.assertEqual(rows, [[('日', 'rì'), ('月', 'yuè'), ('八', 'bā'), ('九', 'jiǔ')]])

    def test_a_row_that_does_not_line_up_is_reported_not_guessed(self):
        rows, problems = B.parse(['  shuQng chuU luH', '1 霜 吹'])
        self.assertEqual(rows, [])
        self.assertEqual(len(problems), 1)


class Compare(unittest.TestCase):
    def setUp(self):
        self.real = B.book_table
        B.book_table = lambda g, s: ([[('倒', 'dǎo'), ('下', 'xià')], [('倒', 'dào'), ('影', 'yǐng')]], [])

    def tearDown(self):
        B.book_table = self.real

    def lesson(self, lid, *cards):
        return {'id': lid, 'chars': [{'char': c, 'pinyin': p} for c, p in cards]}

    def test_same_char_twice_compared_by_position(self):
        diffs, missing = B.compare(9, 9, [self.lesson('a', ('倒', 'dǎo'), ('下', 'xià')),
                                          self.lesson('b', ('倒', 'dǎo'), ('影', 'yǐng'))])
        self.assertEqual(diffs, [('b', '倒', 'dǎo', 'dào')])
        self.assertEqual(missing, [])

    def test_lesson_not_in_book_is_reported(self):
        _, missing = B.compare(9, 9, [self.lesson('c', ('猫', 'māo'))])
        self.assertEqual(missing, ['c'])


@unittest.skipIf(B.available(), B.available() or 'books available')
class RealBooks(unittest.TestCase):
    ROOT = B.REPO_ROOT

    def test_each_volume_reads_completely_and_matches_the_cards(self):
        for g in range(1, 6):
            for s in (1, 2):
                rows, problems = B.book_table(g, s)
                data = json.load(open(os.path.join(self.ROOT, 'data', f'grade{g}-semester{s}.json'), encoding='utf-8'))
                n = sum(len(l['chars']) for l in data['lessons'])
                with self.subTest(volume=f'{g}-{s}'):
                    self.assertEqual(problems, [])
                    self.assertEqual(sum(len(r) for r in rows), n, 'one table entry per card')
                    self.assertEqual(B.compare(g, s, data['lessons']), ([], []))


if __name__ == '__main__':
    unittest.main()
