#!/usr/bin/env python3
"""
Unit tests for scripts/check_stories.py.

Each test starts from a small valid story and breaks one thing, so a failing
test names the rule that stopped working.

    python3 scripts/test_check_stories.py
"""

import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_stories as C  # noqa: E402

BOOK = C.Textbook()
VOL = (1, 1)

# 1-1-31《影子》 teaches 影前常黑狗左右它好朋友.
GOOD = {
    'lesson': '1-1-31', 'title': '好朋友', 'style': 'misunderstanding',
    'theme': 'curious.why', 'mood': 'warm', 'cast': ['飞飞'], 'allow': [],
    'pages': [{'text': '飞飞说：它是黑的。'}, {'text': '它在前面，它是好朋友。'},
              {'text': '影子也是黑的。'}, {'text': '左边，右边，常常在。'},
              {'text': '影子是好朋友，左右前后常在。'}],
    'readings': {'p3:2': 'zi', 'p5:2': 'zi'},
    'reviewed': {'by': 'test', 'date': '2026-10-25'},
}


def story(**changes):
    st = copy.deepcopy(GOOD)
    st.update(changes)
    return st


def errors(st, vol=VOL):
    return C.check_story(st, vol, BOOK)[0]


def warnings(st, vol=VOL):
    return C.check_story(st, vol, BOOK)[1]


class Valid(unittest.TestCase):

    def test_good_story_has_no_errors(self):
        self.assertEqual(errors(GOOD), [])

    @unittest.skipUnless(C.stories_source.available(), 'no private story files on this machine')
    def test_shipped_stories_pass(self):
        # The private story files must already satisfy the checker.
        self.assertEqual(C.main(['--check']), 0)


class CharacterRange(unittest.TestCase):

    def test_character_outside_grade_1_2_is_an_error(self):
        # 鹅 is not in the grade 1–2 生字表.
        e = errors(story(pages=GOOD['pages'] + [{'text': '天鹅来了。'}]))
        self.assertTrue(any('「鹅」' in x for x in e), e)

    def test_allow_lets_it_through(self):
        st = story(pages=GOOD['pages'] + [{'text': '天鹅来了。'}],
                   allow=[{'char': '鹅', 'pinyin': 'é', 'why': '角色'}])
        self.assertEqual(errors(st), [])

    def test_allow_needs_a_valid_reading(self):
        st = story(pages=GOOD['pages'] + [{'text': '天鹅来了。'}],
                   allow=[{'char': '鹅', 'pinyin': 'mǎ', 'why': '角色'}])
        self.assertTrue(any('不是这个字的读音' in x for x in errors(st)))

    def test_allow_needs_a_reason(self):
        st = story(allow=[{'char': '鹅', 'pinyin': 'é'}])
        self.assertTrue(any('why' in x for x in errors(st)))

    def test_unused_allow_is_only_a_warning(self):
        st = story(allow=[{'char': '鹅', 'pinyin': 'é', 'why': '角色'}])
        self.assertEqual(errors(st), [])
        self.assertTrue(any('没用到' in x for x in warnings(st)))


class Readings(unittest.TestCase):

    def test_context_reading_that_differs_from_the_card_must_be_written(self):
        # 影子 reads zi; the 子 card says zǐ, so a tap would play zǐ.
        e = errors(story(readings={}))
        self.assertTrue(any('p3:2' in x and 'zi' in x for x in e), e)

    def test_wrong_reading_is_an_error(self):
        e = errors(story(readings={**GOOD['readings'], 'p3:2': 'mā'}))
        self.assertTrue(any('不是这个字的读音' in x for x in e), e)

    def test_key_must_point_at_a_character(self):
        self.assertTrue(any('不存在' in x for x in errors(story(readings={**GOOD['readings'], 'p9:1': 'yī'}))))
        self.assertTrue(any('不存在' in x for x in errors(story(readings={**GOOD['readings'], 'p3:99': 'yī'}))))

    def test_bad_key_format(self):
        self.assertTrue(any('p<页>' in x for x in errors(story(readings={**GOOD['readings'], '3-2': 'zi'}))))

    def test_punctuation_is_not_counted_in_the_position(self):
        # p2 is 它在前面，它是好朋友。 — the 6th character is 是, not 它.
        self.assertEqual(C.page_chars({'text': '它在前面，它是好朋友。'})[5], '是')


class Characters(unittest.TestCase):
    # characters.json: the intros on the page after the cover.

    def data(self, **intros):
        base = {name: {'icon': 'assets/characters/feifei.svg', 'text': '一个好朋友。', 'readings': {'p1:1': 'yí'}}
                for name in C.CHARACTERS + C.FAMILY}
        for name, fields in intros.items():   # only override what the test names
            base[name] = {**base.get(name, {}), 'readings': {}, **fields}
        return {'allow': [{'char': '鹅', 'pinyin': 'é', 'why': '天鹅'}], 'characters': base}

    def test_good(self):
        self.assertEqual(C.check_characters(self.data(), BOOK), [])

    def test_every_character_needs_an_intro(self):
        d = self.data(); del d['characters']['慢爷爷']
        self.assertTrue(any('「慢爷爷」' in x for x in C.check_characters(d, BOOK)))

    def test_character_outside_grade_1_2(self):
        e = C.check_characters(self.data(妈妈={'text': '妈妈会修东西。'}), BOOK)
        self.assertTrue(any('「修」' in x for x in e), e)
        self.assertEqual(C.check_characters(self.data(小天={'text': '小天鹅。'}), BOOK), [], 'allow covers 鹅')

    def test_context_reading_must_be_declared(self):
        e = C.check_characters(self.data(小白={'text': '一只小白兔。'}), BOOK)
        self.assertTrue(any('p1:1' in x for x in e), e)

    def test_icon_is_required_and_must_exist(self):
        d = self.data(); del d['characters']['小白']['icon']
        self.assertTrue(any('「小白」' in x and 'icon' in x for x in C.check_characters(d, BOOK)))
        d = self.data(); d['characters']['小白']['icon'] = 'assets/characters/nope.svg'
        self.assertTrue(any('不存在' in x for x in C.check_characters(d, BOOK)))

    @unittest.skipUnless(C.stories_source.available(), 'no private story files on this machine')
    def test_shipped_file_passes(self):
        self.assertEqual(C.check_characters(C.load_characters(), BOOK), [])


class Title(unittest.TestCase):
    # The title is shown on the cover and tappable, so it obeys the same rules.

    def test_title_character_outside_grade_1_2(self):
        self.assertTrue(any('标题' in x and '「鹅」' in x for x in errors(story(title='天鹅'))))

    def test_title_reading_is_page_0(self):
        # 影子 → the 子 card says zǐ; the title must declare zi like a page.
        self.assertTrue(any('p0:2' in x for x in errors(story(title='影子'))))
        self.assertEqual(errors(story(title='影子', readings={**GOOD['readings'], 'p0:2': 'zi'})), [])

    def test_p0_key_must_point_into_the_title(self):
        self.assertTrue(any('不存在' in x for x in errors(story(readings={**GOOD['readings'], 'p0:9': 'yī'}))))


class Cast(unittest.TestCase):

    FIVE = ['飞飞', '小天', '小白', '小呱', '乐乐']

    def with_cast(self, cast, extra=''):
        pages = GOOD['pages'] + [{'text': '，'.join(cast) + '来了。' + extra}]
        allow = [{'char': '呱', 'pinyin': 'guā', 'why': '角色名'}] if '小呱' in cast else []
        return story(cast=cast, pages=pages, allow=allow)

    def test_five_is_fine(self):
        self.assertEqual(errors(self.with_cast(self.FIVE)), [])

    def test_six_is_too_many(self):
        e = errors(self.with_cast(self.FIVE + ['慢爷爷']))
        self.assertTrue(any('最多 5' in x for x in e), e)

    def test_named_character_must_be_in_cast(self):
        # 乐乐 speaks but is not listed: the cover would leave him out.
        e = errors(story(pages=GOOD['pages'] + [{'text': '乐乐说：我也要！'}]))
        self.assertTrue(any('「乐乐」' in x and 'cast' in x for x in e), e)

    def test_cast_member_must_appear(self):
        e = errors(story(cast=['飞飞', '小白']))
        self.assertTrue(any('「小白」' in x and '没出现' in x for x in e), e)

    def test_parents_count_towards_five(self):
        e = errors(self.with_cast(['飞飞', '乐乐', '爸爸', '妈妈', '小白', '小天']))
        self.assertTrue(any('最多 5' in x for x in e), e)
        self.assertEqual(errors(self.with_cast(['飞飞', '乐乐', '爸爸', '妈妈'])), [])

    def test_parent_in_cast_must_appear(self):
        e = errors(story(cast=['飞飞', '妈妈']))
        self.assertTrue(any('「妈妈」' in x and '没出现' in x for x in e), e)

    def test_some_animals_mother_is_only_a_prompt(self):
        # 小鸟的妈妈 is not 飞飞's mother: the checker asks, it does not fail.
        st = story(pages=GOOD['pages'] + [{'text': '小鸟的妈妈来了。'}])
        self.assertEqual(errors(st), [])
        self.assertTrue(any('「妈妈」' in x and 'cast' in x for x in warnings(st)), warnings(st))
        listed = story(cast=['飞飞', '妈妈'], pages=GOOD['pages'] + [{'text': '妈妈来了。'}])
        self.assertFalse(any('「妈妈」' in x for x in warnings(listed)))

    def test_count_is_a_review_hint(self):
        # The dictionary reads 数雨点 as shù; a person has to confirm it.
        hints = C._review_hints([{'text': '飞飞数雨点。'}], {}, {}, BOOK)
        self.assertTrue(any('数' in h for h in hints), hints)
        self.assertFalse(any('数' in h for h in C._review_hints([{'text': '飞飞数雨点。'}], {'p1:3': 'shǔ'}, {}, BOOK)),
                         'once marked, no hint')

    def test_name_reads_the_same_everywhere(self):
        # pypinyin reads 在乐乐 as yuè; the name is always lè.
        for text in ('乐乐笑了。', '小天把本子放在乐乐手里。', '快乐的乐乐'):
            r = C.context_readings(text)
            k = text.index('乐乐')
            han = [i for i, ch in enumerate(text) if C.HAN.match(ch)]
            self.assertEqual([r[han.index(k)], r[han.index(k + 1)]], ['lè', 'lè'], text)

    def test_word_containing_a_name_is_not_the_character(self):
        # 小白兔 is any little rabbit: no error that 小白 is missing from cast.
        n = len(GOOD['pages']) + 1
        st = story(pages=GOOD['pages'] + [{'text': '一只小白兔，一只小天鹅。'}],
                   allow=[{'char': '鹅', 'pinyin': 'é', 'why': '天鹅'}],
                   readings={**GOOD['readings'], f'p{n}:1': 'yì', f'p{n}:6': 'yì'})
        self.assertEqual(errors(st), [])
        # The name itself still counts.
        self.assertTrue(any('「小白」' in x for x in errors(story(pages=GOOD['pages'] + [{'text': '小白来了。'}]))))

    def test_old_name_is_a_warning(self):
        st = story(pages=GOOD['pages'] + [{'text': '天天说：飞飞。'}])
        self.assertTrue(any('「天天」' in x and '小天' in x for x in warnings(st)), warnings(st))

    def test_empty_cast(self):
        self.assertTrue(any('cast' in x for x in errors(story(cast=[]))))

    @unittest.skipUnless(C.stories_source.available(), 'no private story files on this machine')
    def test_shipped_stories_have_at_most_five(self):
        for _, data in C.load_volumes():
            for st in data.get('stories') or []:
                self.assertLessEqual(len(st.get('cast') or []), C.MAX_CAST, st['lesson'])


class ToneChanges(unittest.TestCase):

    def reads(self, text):
        return C.context_readings(text)

    def test_yi_changes_before_fourth_and_other_tones(self):
        self.assertEqual(self.reads('一个')[0], 'yí')
        self.assertEqual(self.reads('一起')[0], 'yì')
        self.assertEqual(self.reads('一点')[0], 'yì')

    def test_yi_keeps_its_tone_alone_or_before_punctuation(self):
        self.assertEqual(self.reads('第一。')[1], 'yī')
        self.assertEqual(self.reads('一，二')[0], 'yī')

    def test_bu_changes_only_before_fourth_tone(self):
        self.assertEqual(self.reads('不怕')[0], 'bú')
        self.assertEqual(self.reads('不说')[0], 'bù')

    def test_no_third_tone_sandhi(self):
        # The textbook writes 你好 nǐ hǎo; pypinyin's tone_sandhi would say ní.
        self.assertEqual(self.reads('你好')[0], 'nǐ')


class Structure(unittest.TestCase):

    def test_lesson_must_be_in_this_volume(self):
        self.assertTrue(any('不在' in x for x in errors(GOOD, vol=(1, 2))))

    def test_unknown_style_theme_mood(self):
        for field in ('style', 'theme', 'mood'):
            e = errors(story(**{field: 'nonsense'}))
            self.assertTrue(any(field in x for x in e), (field, e))

    def test_empty_page(self):
        self.assertTrue(any('没有字' in x for x in errors(story(pages=GOOD['pages'] + [{'text': '……'}]))))

    def test_unbalanced_quotes(self):
        st = story(pages=GOOD['pages'] + [{'text': '\u201c它是黑的。'}])
        self.assertTrue(any('引号' in x for x in errors(st)))

    def test_two_stories_for_one_lesson(self):
        e, _, _ = C.check_volume({'grade': 1, 'semester': 1, 'source': 'x',
                                  'stories': [GOOD, GOOD]}, VOL, BOOK)
        self.assertTrue(any('一课只能有一个故事' in x for x in e))

    def test_source_label_required(self):
        e, _, _ = C.check_volume({'grade': 1, 'semester': 1, 'stories': []}, VOL, BOOK)
        self.assertTrue(any('source' in x for x in e))

    def test_unreviewed_story_is_a_warning(self):
        st = story(reviewed={'by': '', 'date': ''})
        self.assertEqual(errors(st), [])
        self.assertTrue(any('审阅' in x for x in warnings(st)))


class NewCharacters(unittest.TestCase):

    def test_new_character_used_once_is_a_warning(self):
        st = story(pages=[{'text': '飞飞说：它是黑的。'}, {'text': '它在前面。'}], readings={})
        w = warnings(st)
        self.assertTrue(any('黑×1' in x for x in w), w)
        self.assertEqual(errors(st), [])

    def test_unused_new_character_is_not_nagged(self):
        # 狗 is not in GOOD at all — unused is a writing choice, not a slip.
        self.assertFalse(any('狗' in x for x in warnings(GOOD)))


class Rotation(unittest.TestCase):

    def at(self, lesson, style='misunderstanding', theme='curious.why', mood='warm'):
        return {'lesson': lesson, 'style': style, 'theme': theme, 'mood': mood}

    def ids(self, n, start='1-2-'):
        # Consecutive grade 1-2 lessons, in book order.
        order = [l for l in BOOK.lesson_order if l.startswith(start)]
        return order[:n]

    def test_same_style_within_eight_lessons(self):
        a, *_, b = self.ids(8)
        e = C.check_rotation([self.at(a, theme='feel.shy', mood='funny'),
                              self.at(b, theme='grow.first', mood='warm')], BOOK)
        self.assertTrue(any('写法' in x for x in e), e)

    def test_same_style_nine_lessons_apart_is_fine(self):
        ls = self.ids(9)
        e = C.check_rotation([self.at(ls[0], theme='feel.shy', mood='funny'),
                              self.at(ls[8], theme='grow.first', mood='warm')], BOOK)
        self.assertEqual(e, [])

    def test_same_theme_within_three_lessons(self):
        a, _, b = self.ids(3)
        e = C.check_rotation([self.at(a, style='guess', mood='funny'),
                              self.at(b, style='surprise', mood='warm')], BOOK)
        self.assertTrue(any('主题' in x for x in e), e)

    def test_four_neighbouring_lessons_with_one_mood(self):
        # Any mood but funny still rotates.
        ls = self.ids(4)
        styles = ['guess', 'surprise', 'copycat', 'stubborn']
        themes = ['feel.shy', 'grow.first', 'friend.help', 'nature.seasons']
        e = C.check_rotation([self.at(l, style=s, theme=t, mood='warm')
                              for l, s, t in zip(ls, styles, themes)], BOOK)
        self.assertTrue(any('连续' in x for x in e), e)

    def test_funny_may_run_on(self):
        # Every story may be funny: no rotation error, however long the run.
        ls = self.ids(8)
        styles = ['guess', 'surprise', 'copycat', 'stubborn', 'misunderstanding', 'half-right', 'over-worry', 'role-swap']
        themes = ['feel.shy', 'grow.first', 'friend.help', 'nature.seasons'] * 2
        e = C.check_rotation([self.at(l, style=s, theme=t, mood='funny')
                              for l, s, t in zip(ls, styles, themes)], BOOK)
        self.assertFalse(any('连续' in x for x in e), e)

    def test_long_funny_run_reminds_once(self):
        ls = self.ids(C.WARM_GAP + 3)
        mk = lambda moods: [self.at(l, mood=m) for l, m in zip(ls, moods)]
        w = C.warm_reminders(mk(['funny'] * C.WARM_GAP + ['warm', 'funny']), BOOK)
        self.assertEqual(len(w), 1, w)
        self.assertIn(f'连续 {C.WARM_GAP} 篇', w[0])
        w = C.warm_reminders(mk(['funny'] * (C.WARM_GAP + 2)), BOOK)
        self.assertEqual(len(w), 1, 'a run reaching the end of the list is reported too')
        self.assertEqual(C.warm_reminders(mk(['funny'] * (C.WARM_GAP - 1) + ['quiet'] + ['funny'] * 3), BOOK), [],
                         'a quiet ending in time: no reminder')

    def test_special_style_limit_per_volume(self):
        ls = self.ids(30)
        picks = [ls[0], ls[10], ls[20]]
        themes = ['feel.shy', 'grow.first', 'friend.help']
        e = C.check_rotation([self.at(l, style='three-tries', theme=t, mood=m)
                              for l, t, m in zip(picks, themes, ['funny', 'warm', 'quiet'])], BOOK)
        self.assertTrue(any('最多 2' in x for x in e), e)


if __name__ == '__main__':
    unittest.main(verbosity=1)
