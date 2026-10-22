#!/usr/bin/env python3
"""
Unit tests for scripts/shorten_sentences.py.

Each rule case is a real sentence from the data that the rule was added
for, so a regression shows the exact bad cut that would come back.

    python3 scripts/test_shorten_sentences.py
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shorten_sentences as S  # noqa: E402


class TrimBasics(unittest.TestCase):

    def test_short_sentence_is_unchanged(self):
        self.assertEqual(S.trim('我们的祖先把它们分成组。', '祖'),
                         ('我们的祖先把它们分成组。', S.OK))

    def test_keeps_whole_clauses_and_ends_with_full_stop(self):
        text, outcome = S.trim('十二岁那年，他离开家乡江苏淮安，随回家探亲的伯父来到了东北。', '淮')
        self.assertEqual(outcome, S.TRIMMED)
        self.assertEqual(text, '十二岁那年，他离开家乡江苏淮安。')

    def test_result_is_original_text(self):
        original = '在北京天坛公园植树的人群里，83岁高龄的邓小平爷爷格外引人注目。'
        text, _ = S.trim(original, '龄')
        self.assertIn(text.rstrip('。'), original)
        self.assertLessEqual(len(text), S.MAX_LEN)

    def test_prefers_the_sentence_opening(self):
        # Both runs fit; the one that keeps the subject 稻穗 must win.
        text, _ = S.trim('看，稻谷就要成熟了，稻穗低垂着头，稻田像一块月光镀亮的银毯。', '穗')
        self.assertTrue(text.startswith('看，'), text)

    def test_clause_longer_than_limit(self):
        _, outcome = S.trim('所以，用“贝”作偏旁的字大多与钱财有关并且还与贸易往来有关，比如。', '贸')
        self.assertEqual(outcome, S.CLAUSE_TOO_LONG)

    def test_idempotent(self):
        once, _ = S.trim('十二岁那年，他离开家乡江苏淮安，随回家探亲的伯父来到了东北。', '淮')
        self.assertEqual(S.trim(once, '淮'), (once, S.OK))


class EndAsSentence(unittest.TestCase):

    def test_comma_becomes_full_stop(self):
        self.assertEqual(S.end_as_sentence('他离开家乡江苏淮安，'), '他离开家乡江苏淮安。')

    def test_closing_quote_of_utterance_kept(self):
        self.assertEqual(S.end_as_sentence('“快长啊！”'), '“快长啊！”')

    def test_closing_quote_of_name_gets_full_stop(self):
        self.assertEqual(S.end_as_sentence('踩着凤凰花铺成的“地毯”'), '踩着凤凰花铺成的“地毯”。')


class RejectRules(unittest.TestCase):
    """Each rule rejects the cut it was written for, and only via its name."""

    def rule(self, text, char, from_start=False, to_end=False):
        return S.rejected_by(S.Candidate(text, char, from_start, to_end))

    def test_every_rule_has_a_unique_name(self):
        names = [n for n, _ in S.REJECT_RULES]
        self.assertEqual(len(names), len(set(names)))

    def test_speech_cut(self):
        self.assertEqual(self.rule('他盯着小葫芦自言自语地说。', '盯', from_start=True), 'speech-cut')

    def test_speech_verb_at_the_real_end_is_fine(self):
        self.assertIsNone(self.rule('他盯着小葫芦自言自语地说。', '盯', from_start=True, to_end=True))

    def test_connective(self):
        self.assertEqual(self.rule('而且贝壳可以随身携带。', '随'), 'connective')

    def test_connective_is_fine_at_the_sentence_start(self):
        self.assertIsNone(self.rule('而且贝壳可以随身携带。', '随', from_start=True))

    def test_no_subject(self):
        self.assertEqual(self.rule('拂过妈妈和爸爸的头发。', '拂'), 'no-subject')

    def test_dependent_ending(self):
        self.assertEqual(self.rule('当蒲公英盛开的时候。', '蒲', from_start=True), 'dependent')

    def test_dependent_opening(self):
        self.assertEqual(self.rule('由于叛徒的出卖。', '卖', from_start=True), 'dependent')

    def test_garbled_doubled_word(self):
        self.assertEqual(self.rule('总也倒不了的老屋老屋低头看看。', '屋', from_start=True), 'garbled')

    def test_apparatus(self):
        self.assertEqual(self.rule('①本文作者方惠珍、盛璐德。', '珍', from_start=True), 'apparatus')

    def test_unbalanced_quote(self):
        self.assertEqual(self.rule('他说：“不信，你们就等着看。', '信', from_start=True), 'unbalanced')

    def test_too_short(self):
        self.assertEqual(self.rule('笼内还有干草。', '草', from_start=True), 'too-short')

    def test_clean_candidate_passes(self):
        self.assertIsNone(self.rule('83岁高龄的邓小平爷爷格外引人注目。', '龄'))


class ReviewedRejects(unittest.TestCase):

    def test_reject_keeps_the_original(self):
        original = '十二岁那年，他离开家乡江苏淮安，随回家探亲的伯父来到了东北。'
        rejects = frozenset({'十二岁那年，他离开家乡江苏淮安。'})
        self.assertEqual(S.trim(original, '淮', rejects), (None, S.REVIEWED_REJECT))

    def test_file_format(self):
        with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write('# heading\n\n甲乙丙。  # why\n丁戊。\n')
        try:
            self.assertEqual(S.load_rejects(f.name), frozenset({'甲乙丙。', '丁戊。'}))
        finally:
            os.unlink(f.name)

    def test_missing_file_means_no_rejects(self):
        self.assertEqual(S.load_rejects('/nonexistent/rejects.txt'), frozenset())


class Defects(unittest.TestCase):

    def test_defects(self):
        self.assertEqual(S.defect('景绍宗为本书封面绘制插图。'), 'apparatus')
        self.assertEqual(S.defect('，处处欢声笑语，热闹极了。'), 'stray-start')
        self.assertEqual(S.defect('年，与当时东北各抗日游击队改编为东北抗日联军。'), 'fragment-start')
        self.assertIsNone(S.defect('稻穗低垂着头。'))


class RepositoryData(unittest.TestCase):
    """The committed data is in the state the script produces."""

    def test_data_is_already_trimmed(self):
        rejects = S.load_rejects()
        pending = [(lid, e['char']) for _, data in S.load_volumes()
                   for lid, e in S.entries(data)
                   if S.trim(e['sentence'], e['char'], rejects)[1] == S.TRIMMED]
        self.assertEqual(pending, [], 'run: python3 scripts/shorten_sentences.py --apply')


if __name__ == '__main__':
    unittest.main(verbosity=1)
