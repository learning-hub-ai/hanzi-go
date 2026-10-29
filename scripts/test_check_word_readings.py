#!/usr/bin/env python3
"""Tests for scripts/check_word_readings.py (多音字 words and sentences agree with the card).

    python3 scripts/test_check_word_readings.py

Uses made-up volumes in a temporary folder, plus one check on the real data.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_word_readings as W  # noqa: E402


def card(char, pinyin, words, sentence):
    return {'char': char, 'pinyin': pinyin, 'words': words, 'sentence': sentence}


class WithData(unittest.TestCase):
    """Run check() against volumes written to a temporary repo root."""

    def run_on(self, lessons, grade=1):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, 'data'))
            with open(os.path.join(root, 'data', f'grade{grade}-semester1.json'), 'w', encoding='utf-8') as f:
                json.dump({'lessons': lessons}, f, ensure_ascii=False)
            with mock.patch.object(W, 'REPO_ROOT', root):
                return W.check([grade])

    def test_word_with_another_reading_is_caught(self):
        # 背 annotated bèi but worded 背包 (bēi): same syllable, another tone.
        bad = self.run_on([{'id': '9-9-1', 'chars': [card('背', 'bèi', ['背上', '背包'], '我的背上。')]}])
        self.assertEqual([(b[0], b[3]) for b in bad], [('9-9-1', '背包')])

    def test_another_syllable_is_caught(self):
        bad = self.run_on([{'id': '9-9-1', 'chars': [card('少', 'shǎo', ['多少', '少年'], '少了一块。')]}])
        self.assertEqual([b[3] for b in bad], ['少年'])

    def test_sentence_is_checked_too(self):
        bad = self.run_on([{'id': '9-9-1', 'chars': [card('背', 'bēi', ['背包'], '我的背上有一块泥。')]}])
        self.assertEqual([b[3] for b in bad], ['我的背上有一块泥。'])

    def test_tone_sandhi_and_neutral_tone_are_not_errors(self):
        bad = self.run_on([{'id': '9-9-1', 'chars': [
            card('一', 'yī', ['一个'], '一个人。'),          # yí by sandhi
            card('子', 'zǐ', ['孩子'], '好孩子。'),          # neutral zi
            card('哪', 'na', ['哪里'], '在哪里。'),          # card neutral, word nǎ: textbook\u2019s own
            card('不', 'bù', ['不是'], '不是。'),            # bú by sandhi
        ]}])
        self.assertEqual(bad, [])

    def test_text_without_the_char_is_ignored(self):
        self.assertEqual(self.run_on([{'id': '9-9-1', 'chars': [card('背', 'bèi', ['后面'], '没有这个字。')]}]), [])

    def test_known_ok_skips_only_that_text(self):
        with mock.patch.dict(W.KNOWN_OK, {('9-9-1', '背', '背包'): 'test'}):
            bad = self.run_on([{'id': '9-9-1', 'chars': [card('背', 'bèi', ['背包', '背带'], '背上。')]}])
        self.assertEqual([b[3] for b in bad], ['背带'], 'another wrong word on the same card is still caught')

    def test_only_the_asked_grades(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, 'data'))
            with open(os.path.join(root, 'data', 'grade3-semester1.json'), 'w', encoding='utf-8') as f:
                json.dump({'lessons': [{'id': '3-1-1', 'chars': [card('背', 'bèi', ['背包'], '')]}]}, f, ensure_ascii=False)
            with mock.patch.object(W, 'REPO_ROOT', root):
                self.assertEqual(W.check([1, 2]), [])
                self.assertEqual(len(W.check([3])), 1)


class RealData(unittest.TestCase):
    def test_grades_1_to_5_are_clean(self):
        self.assertEqual(W.check([1, 2, 3, 4, 5]), [])

    def test_every_allowance_is_still_in_the_data(self):
        have = set()
        for g in (1, 2, 3, 4, 5):
            for s in (1, 2):
                path = os.path.join(W.REPO_ROOT, 'data', f'grade{g}-semester{s}.json')
                for lesson in json.load(open(path, encoding='utf-8'))['lessons']:
                    for c in lesson['chars']:
                        for t in (c.get('words') or []) + [c.get('sentence') or '']:
                            have.add((lesson['id'], c['char'], t))
        gone = [k for k in list(W.KNOWN_OK) + list(W.TO_CONFIRM) if k not in have]
        self.assertEqual(gone, [], 'remove allowances whose text is gone')

    def test_every_allowance_has_a_reason(self):
        self.assertTrue(all(W.KNOWN_OK.values()))
        self.assertTrue(all(W.TO_CONFIRM.values()))

    def test_every_allowance_is_still_needed(self):
        # An allowance the check would not miss is dead weight: it hides
        # nothing today and could hide a real error on that text tomorrow.
        with mock.patch.dict(W.KNOWN_OK, {}, clear=True):
            flagged = {(lid, ch, text) for lid, ch, _, text, _ in W.check([1, 2, 3, 4, 5])}
        self.assertEqual([k for k in W.KNOWN_OK if k not in flagged], [])

    def test_to_confirm_is_not_mixed_into_known_ok(self):
        self.assertEqual(set(W.KNOWN_OK) & set(W.TO_CONFIRM), set())


if __name__ == '__main__':
    unittest.main()
