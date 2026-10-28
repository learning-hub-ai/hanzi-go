#!/usr/bin/env python3
"""Tests for scripts/story_brief.py (the writing brief for one lesson's story).

    python3 scripts/test_story_brief.py

Uses the real textbook data and story files; builds its own small story
lists where a test needs a known neighbourhood.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_stories as C  # noqa: E402
import story_brief as B  # noqa: E402

BOOK = C.Textbook()


def story(lesson, style='guess', theme='curious.why', mood='funny', cast=('飞飞',), text='飞飞说。'):
    """A minimal story dict for the neighbourhood tests."""
    return {'lesson': lesson, 'title': 't', 'style': style, 'theme': theme, 'mood': mood,
            'cast': list(cast), 'pages': [{'text': text}]}


class Brief(unittest.TestCase):
    def test_new_chars_and_title(self):
        b = B.brief('1-2-12', BOOK, [])
        self.assertEqual(b['lesson_title'], BOOK.lesson_title['1-2-12'])
        self.assertEqual(b['new_chars'], BOOK.new_chars['1-2-12'])

    def test_a_nearby_style_is_not_allowed(self):
        ls = BOOK.lesson_order
        i = ls.index('1-2-12')
        b = B.brief('1-2-12', BOOK, [story(ls[i - 1], style='copycat')])
        self.assertNotIn('copycat', b['styles_allowed'])
        self.assertIn('guess', b['styles_allowed'])

    def test_warm_ending_due_after_a_run_of_funny(self):
        ls = BOOK.lesson_order
        i = ls.index('1-2-12')
        before = [story(ls[i - k], style=s, theme=t) for k, s, t in
                  zip(range(1, C.WARM_GAP), C.STYLES, C.THEMES)]
        self.assertTrue(B.brief('1-2-12', BOOK, before)['warm_ending_due'])
        before[0]['mood'] = 'quiet'
        self.assertFalse(B.brief('1-2-12', BOOK, before)['warm_ending_due'])

    def test_not_yet_learned_sample_is_stable_and_soonest_first(self):
        a = B.brief('1-2-12', BOOK, [])['not_yet_learned_sample']
        self.assertEqual(a, B.brief('1-2-12', BOOK, [])['not_yet_learned_sample'])
        ls = BOOK.lesson_order
        nxt = ls[ls.index('1-2-12') + 1]
        fresh = [c for c in BOOK.new_chars[nxt] if c not in BOOK.known_at['1-2-12']]
        self.assertEqual(a[:len(fresh)], ''.join(fresh), 'the next lesson comes first, in its own order')

    def test_lead_is_the_name_said_most(self):
        s = story('1-1-20', cast=('飞飞', '乐乐', '妈妈'), text='乐乐说。乐乐笑了。飞飞说。妈妈妈妈妈妈。')
        self.assertEqual(B.lead_of(s), '乐乐', 'parents never lead')


class Draft(unittest.TestCase):
    def check(self, text, allow=''):
        with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(text)
        try:
            return B.check_draft('1-1-35', BOOK, f.name, set(allow))
        finally:
            os.unlink(f.name)

    def test_outside_the_list_fails(self):
        self.assertEqual(self.check('题目\n掉进了小洞里。\n'), 1)

    def test_allowed_and_names_pass(self):
        self.assertEqual(self.check('题目\n小呱掉进了小洞里。\n', allow='洞'), 0)


if __name__ == '__main__':
    unittest.main(verbosity=1)
