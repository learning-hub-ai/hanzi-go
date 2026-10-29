#!/usr/bin/env python3
"""
Check the 小故事 data (hanzi-go-stories/docs/story-reading-design.html §11).

The story text is private (§7.4); scripts/stories_source.py says where it is
and loads it. Without it on this machine there is nothing to check: the
checker says so and exits 0. The rules themselves are all here.

    python3 scripts/check_stories.py          # report every story, with review hints
    python3 scripts/check_stories.py --check  # errors only; exit 1 on any (pre-push)

Errors (fail --check):
  - a character outside the grade 1–2 生字表 that the story's `allow` does not list
  - a 多音字 whose reading in this sentence differs from its card and that has no
    entry in `readings` (the app would read the card's reading when it is tapped)
  - a reading that is not a reading of its character
  - a malformed file: wrong grade/semester, unknown lesson, two stories for one
    lesson, an empty page, unbalanced quotes, an unknown style/theme/mood, a
    reading key that does not point at a character
  - the rotation rules of §8.4

Warnings (reported, never fail): a new character used fewer than twice, a page
over PAGE_WARN characters, an `allow` entry the story does not use, a story not
yet reviewed (the app does not show those).

Readings are keyed "p<page>:<n>", both 1-based, n counting only the Chinese
characters of that page. The title is page 0: the app shows it on a cover
whose characters can be tapped too. The app resolves a tap the same way: `readings`, then
the `allow` entry, then the character's first textbook card.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stories_source  # noqa: E402  (where the private story text is)
from stories_source import ROOT, load_characters, load_volumes  # noqa: E402,F401  (re-exported for callers)

# §8.2 — the twenty ways a story can be told. SPECIAL ones are so
# recognisable that a second or third use in one volume already feels stale.
STYLES = [
    'misunderstanding', 'half-right', 'three-tries', 'more-and-more',
    'last-page-twist', 'talk-to-reader', 'over-worry', 'stubborn',
    'slow-wait', 'oops-help', 'self-argue', 'role-swap', 'imagine-real',
    'few-words', 'guess', 'research-notes', 'copycat', 'surprise',
    'full-circle', 'quiet-warm',
]
SPECIAL_STYLES = {'three-tries', 'talk-to-reader', 'full-circle'}
# §8.3 — what a story is about.
THEMES = [
    'friend.missing', 'friend.share', 'friend.quarrel', 'friend.jealous',
    'friend.help', 'friend.new',
    'feel.afraid', 'feel.worry', 'feel.angry', 'feel.sad', 'feel.shy', 'feel.lonely',
    'grow.first', 'grow.persist', 'grow.ok-to-fail', 'grow.honest',
    'grow.patience', 'grow.different',
    'curious.why', 'curious.measure', 'curious.invent',
    'nature.seasons', 'nature.family', 'nature.garden',
    # From 《蚕豆大哥》-style stories (design §8.3): liking how you are made,
    # a treasured thing, everyone's own skill in a rescue.
    'grow.my-looks', 'friend.treasure', 'friend.rescue',
    # 飞飞's own threads (design §8.3b).
    'feifei.helps',        # an experiment or a bit of research gets 小天 or 小白 out of trouble
    'feifei.science',      # 飞飞 shares a fun experiment or a maths puzzle
    'feifei.flying',       # 飞飞's dream of flying
    'feifei.space',        # 飞飞's dream of space
]
MOODS = ['funny', 'warm', 'quiet', 'tense']

# §8.4 rotation rules, over the stories in lesson order.
STYLE_GAP = 8          # the same style may not recur within 8 lessons
STYLE_PER_VOLUME = 3
SPECIAL_PER_VOLUME = 2
THEME_GAP = 3
MOOD_RUN = 3           # at most 3 neighbouring lessons with the same mood, except funny
# Every story may be funny: a child reads one story per lesson, days apart,
# and funny is why they turn the page. So funny does not rotate. Instead,
# within any WARM_GAP stories in a row there should be one whose ending is
# warm or quiet (a good one for bedtime). Only a reminder.
FREE_MOOD = 'funny'
WARM_MOODS = {'warm', 'quiet'}
WARM_GAP = 6

# The recurring characters (design §7). A story lists who is in it in
# `cast`, shown on the cover; at most MAX_CAST, so a short story stays easy
# to follow. A one-off visitor (a snail, a duckling) is fine without a name
# here, as long as the cast stays within the limit.
# The children have doubled names (飞飞, 乐乐); the animals are 小X, so a
# reader tells them apart, and 慢爷爷 is the old tortoise.
CHARACTERS = ['飞飞', '乐乐', '小天', '小白', '小呱', '慢爷爷']
# 飞飞 and 乐乐's parents. In the cast they are 爸爸 / 妈妈, each counting
# towards MAX_CAST. Unlike the names above, 妈妈 is also any animal's mother
# (小鸟的妈妈), so finding the word only prompts a check, not an error.
FAMILY = ['爸爸', '妈妈']
# How each name reads, whatever the dictionary guesses from context.
NAME_READINGS = {'乐乐': ['lè', 'lè']}
MAX_CAST = 5
# Ordinary words that contain a name: 小白兔 is any little rabbit, not
# necessarily 小白. They are skipped when finding who is in a story.
NAME_IN_WORD = ['小白兔', '小白菜', '小天鹅', '小天地']
# The characters' old names (until 2026-10). Seen in a story, it is almost
# certainly a name that was not updated.
OLD_NAMES = {'天天': '小天', '白白': '小白', '呱呱': '小呱', '慢慢': '慢爷爷'}

PAGE_WARN = 40
NEW_CHAR_MIN = 2

# Readings the review hint asks a person to confirm even when the generator
# agrees with the card: pypinyin reads 慢慢地 (the word) as dì and 量了又量 as liàng,
# both identical to the card, so no rule above can catch them.
# 数 (shù number / shǔ to count) is here because the dictionary guesses
# shù even where it means "to count" (数一数, 数星星): every 数 in the 一上
# stories was wrong.
REVIEW_HINT = set('地得着头过量长为都还空只种重教少发乐中差便行数')

HAN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff]')
KEY = re.compile(r'^p(\d+):(\d+)$')
TONE_MARKS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'


def toneless(p):
    """'zhuǎ' -> 'zhua'; ü kept as ü so lü and lu stay apart."""
    table = str.maketrans('āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ', 'aaaaeeeeiiiioooouuuuüüüü')
    return p.translate(table)


class Textbook:
    """Lesson order, characters and card readings from data/grade*.json."""

    def __init__(self, root=ROOT):
        self.lesson_order = []       # every lesson id, grade 1-9 in book order
        self.lesson_title = {}
        self.lesson_volume = {}
        self.new_chars = {}          # lesson id -> its 生字, in order
        self.known_at = {}           # lesson id -> characters taught up to and including it
        self.card_reading = {}       # char -> pinyin of its first card (what the app plays)
        self.card_readings = {}      # char -> every pinyin any card gives it
        self.g12 = set()
        seen = set()
        for g in range(1, 10):
            for s in (1, 2):
                path = os.path.join(root, 'data', f'grade{g}-semester{s}.json')
                if not os.path.exists(path):
                    continue
                with open(path, encoding='utf-8') as f:
                    data = json.load(f)
                for lesson in data['lessons']:
                    lid = lesson['id']
                    self.lesson_order.append(lid)
                    self.lesson_title[lid] = lesson['title']
                    self.lesson_volume[lid] = (g, s)
                    chars = [c['char'] for c in lesson['chars']]
                    self.new_chars[lid] = chars
                    for c in lesson['chars']:
                        self.card_reading.setdefault(c['char'], c['pinyin'])
                        self.card_readings.setdefault(c['char'], set()).add(c['pinyin'])
                        if g <= 2:
                            self.g12.add(c['char'])
                    seen.update(chars)
                    self.known_at[lid] = set(seen)
        self.position = {lid: i for i, lid in enumerate(self.lesson_order)}


def _pypinyin():
    try:
        import pypinyin
        return pypinyin
    except ImportError:
        return None


def _tone(reading):
    for ch in reading or '':
        i = TONE_MARKS.find(ch)
        if i >= 0:
            return i % 4 + 1
    return 5


def context_readings(text):
    """Reading of each Chinese character of `text` in context, in order.

    Applies the 一/不 tone changes the 统编版 marks (一个 yí, 一起 yì,
    不怕 bú) and no others: pypinyin's tone_sandhi also turns 你好 into ní
    and 蚂蚁 into má, which the textbook never annotates. Returns None when
    pypinyin is not installed.
    """
    p = _pypinyin()
    if p is None:
        return None
    out = p.lazy_pinyin(text, style=p.Style.TONE, errors=lambda s: [None] * len(s))
    if len(out) != len(text):
        # Never expected for story text; read char by char rather than misalign.
        out = [p.lazy_pinyin(ch, style=p.Style.TONE, errors=lambda s: [None])[0] for ch in text]
    han = [(ch, r) for ch, r in zip(text, out) if HAN.match(ch)]
    # The tone change depends on the next character in the same phrase, so a
    # punctuation mark in between (一。) leaves the citation tone.
    nxt = {}
    for i, ch in enumerate(text):
        if HAN.match(ch) and i + 1 < len(text) and HAN.match(text[i + 1]):
            nxt[i] = out[i + 1]
    readings, k = [], 0
    for i, ch in enumerate(text):
        if not HAN.match(ch):
            continue
        r = han[k][1]
        k += 1
        follow = _tone(nxt.get(i)) if i in nxt else None
        if ch == '一' and r == 'yī' and follow:
            r = 'yí' if follow == 4 else ('yì' if follow in (1, 2, 3) else r)
        elif ch == '不' and r == 'bù' and follow == 4:
            r = 'bú'
        readings.append(r)
    # A character's name always reads the same: pypinyin reads 在乐乐 as
    # yuè. Override each name's characters wherever the name occurs.
    pos = [i for i, ch in enumerate(text) if HAN.match(ch)]
    for name, reading in NAME_READINGS.items():
        start = text.find(name)
        while start >= 0:
            for j, syl in enumerate(reading):
                readings[pos.index(start + j)] = syl
            start = text.find(name, start + len(name))
    return readings


def valid_readings(char, book):
    """Every reading `char` can have: dictionary, cards, their neutral forms."""
    readings = set(book.card_readings.get(char, ()))
    p = _pypinyin()
    if p is not None:
        readings.update(p.pinyin(char, heteronym=True, style=p.Style.TONE)[0])
    if char == '一':
        readings.update({'yī', 'yí', 'yì'})
    if char == '不':
        readings.update({'bù', 'bú'})
    readings.update({toneless(r) for r in list(readings)})
    return readings


def page_chars(page):
    return [c for c in page.get('text', '') if HAN.match(c)]


def check_story(story, volume, book):
    """(errors, warnings, info) for one story of `volume` = (grade, semester)."""
    errors, warnings = [], []
    lid = story.get('lesson', '?')
    where = f"{lid}《{story.get('title', '?')}》"

    def err(msg):
        errors.append(f'{where}: {msg}')

    def warn(msg):
        warnings.append(f'{where}: {msg}')

    if book.lesson_volume.get(lid) != volume:
        err(f'课号不在 {volume[0]}年级{"上" if volume[1] == 1 else "下"}册')
    for field, allowed in (('style', STYLES), ('theme', THEMES), ('mood', MOODS)):
        if story.get(field) not in allowed:
            err(f'{field} "{story.get(field)}" 不在列表里（见 §8）')
    if not story.get('title'):
        err('没有标题')
    pages = story.get('pages') or []
    if not pages:
        err('没有页')

    cast = story.get('cast') or []
    if not cast:
        err('cast 是空的（封面上要列出场角色）')
    if len(cast) > MAX_CAST:
        err(f'出场 {len(cast)} 个角色，最多 {MAX_CAST} 个：{"、".join(cast)}')
    if len(set(cast)) != len(cast):
        err('cast 里有重复的名字')
    text_all = ''.join(p.get('text', '') for p in story.get('pages') or [])
    for name in cast:
        if name not in text_all:
            err(f'cast 里的「{name}」故事里没出现')
    # Longest names first, in case one name ever contains another. A word
    # that only contains a name (小白兔) is not the character.
    rest = text_all
    for w in NAME_IN_WORD:
        rest = rest.replace(w, '')
    for name in sorted(CHARACTERS, key=len, reverse=True):
        if name in rest:
            if name not in cast:
                err(f'「{name}」在故事里出现了，但不在 cast 里')
            rest = rest.replace(name, '')
    for name in FAMILY:
        if name in text_all and name not in cast:
            warn(f'故事里有「{name}」：如果是飞飞家的{name}，加进 cast')

    for old, new in OLD_NAMES.items():
        if old in text_all + (story.get('title') or '') or old in cast:
            warn(f'「{old}」是旧名字，现在叫「{new}」')

    allow = {}
    for a in story.get('allow') or []:
        ch = a.get('char', '')
        if len(ch) != 1 or not a.get('pinyin') or not a.get('why'):
            err(f'allow 条目要有 char、pinyin、why：{a}')
            continue
        allow[ch] = a['pinyin']
        if a['pinyin'] not in valid_readings(ch, book):
            err(f'allow「{ch}」的读音 {a["pinyin"]} 不是这个字的读音')

    readings = story.get('readings') or {}
    counts = {}
    used = set()
    title_page = {'text': story.get('title') or ''}
    for pi, page in [(0, title_page)] + list(enumerate(pages, 1)):
        text = page.get('text', '')
        chars = page_chars(page)
        where_p = '标题' if pi == 0 else f'第 {pi} 页'
        if not chars:
            if pi:
                err(f'{where_p}没有字')
            continue
        if text.count('\u201c') != text.count('\u201d'):
            err(f'{where_p}引号不成对')
        if pi and len(chars) > PAGE_WARN:
            warn(f'第 {pi} 页有 {len(chars)} 个字（超过 {PAGE_WARN}）')
        context = context_readings(text)
        for n, ch in enumerate(chars, 1):
            if pi:   # how often a 生字 appears counts the story, not its title
                counts[ch] = counts.get(ch, 0) + 1
            used.add(ch)
            if ch not in book.g12 and ch not in allow:
                err(f'{where_p}「{ch}」不在一二年级生字表里，也不在 allow 里')
            key = f'p{pi}:{n}'
            if key in readings:
                if readings[key] not in valid_readings(ch, book):
                    err(f'{key}「{ch}」读 {readings[key]}？这不是这个字的读音')
                continue
            if ch in allow or context is None:
                continue
            default = book.card_reading.get(ch)
            heard = context[n - 1]
            if default and heard and heard != default:
                near = ''.join(chars[max(0, n - 3):n + 2])
                err(f'{key}「{ch}」（{near}）在这里读 {heard}？卡片是 {default}，'
                    f'点字会读成 {default}。在 readings 里写 "{key}": "<读音>"')

    for key, value in readings.items():
        m = KEY.match(key)
        if not m:
            err(f'readings 的键 "{key}" 应该是 p<页>:<第几个字>')
            continue
        pi, n = int(m.group(1)), int(m.group(2))
        target = title_page if pi == 0 else (pages[pi - 1] if pi <= len(pages) else None)
        if target is None or not (1 <= n <= len(page_chars(target))):
            err(f'readings "{key}" 指向不存在的字')

    for ch in allow:
        if ch not in used:
            warn(f'allow 里的「{ch}」故事里没用到')
    new = book.new_chars.get(lid, [])
    few = [f'{c}×{counts.get(c, 0)}' for c in new if 0 < counts.get(c, 0) < NEW_CHAR_MIN]
    if few:
        warn(f'本课新字出现不到 {NEW_CHAR_MIN} 次：{" ".join(few)}')
    if not (story.get('reviewed') or {}).get('by'):
        warn('还没审阅（App 里不显示）')

    han = [c for p in pages for c in page_chars(p)]   # the story itself, without the title
    known = book.known_at.get(lid, set())
    info = {
        'pages': len(pages), 'chars': len(han), 'distinct': len(set(han)),
        'new': [(c, counts.get(c, 0)) for c in new],
        'unlearned': sorted({c for c in han if c not in known}, key=han.index),
        'unlearned_share': sum(1 for c in han if c not in known) / len(han) if han else 0,
        'outside': sorted({c for c in han if c not in book.g12}, key=han.index),
        'review': _review_hints(pages, readings, allow, book),
    }
    return errors, warnings, info


def _review_hints(pages, readings, allow, book):
    """Characters whose reading a person should confirm (not an error)."""
    hints = []
    for pi, page in enumerate(pages, 1):
        chars = page_chars(page)
        context = context_readings(page.get('text', '')) or [None] * len(chars)
        for n, ch in enumerate(chars, 1):
            key = f'p{pi}:{n}'
            if key in readings or ch in allow or ch not in REVIEW_HINT:
                continue
            reading = book.card_reading.get(ch) or context[n - 1]
            near = ''.join(chars[max(0, n - 2):n + 2])
            hints.append(f'{key} {ch}={reading}（{near}）')
    return hints


def check_volume(volume_data, volume, book):
    """(errors, warnings, infos) for one story file."""
    errors, warnings, infos = [], [], []
    g, s = volume
    if volume_data.get('grade') != g or volume_data.get('semester') != s:
        errors.append(f'grade{g}-semester{s}.json: grade/semester 字段和文件名不一致')
    if not volume_data.get('source'):
        errors.append(f'grade{g}-semester{s}.json: 缺少 source（标明原创）')
    seen = set()
    for story in volume_data.get('stories') or []:
        lid = story.get('lesson')
        if lid in seen:
            errors.append(f'{lid}: 一课只能有一个故事')
        seen.add(lid)
        e, w, info = check_story(story, volume, book)
        errors += e
        warnings += w
        infos.append((story, info))
    return errors, warnings, infos


def check_rotation(stories, book):
    """§8.4 over all stories. Distances are counted in lessons, not stories:
    two stories 30 lessons apart do not repeat each other just because no
    story has been written for the lessons in between. Returns errors."""
    errors = []
    pos = lambda st: book.position.get(st.get('lesson'), 10 ** 6)
    ordered = sorted(stories, key=pos)
    for i, st in enumerate(ordered):
        for prev in reversed(ordered[:i]):
            gap = pos(st) - pos(prev)
            if gap >= STYLE_GAP:
                break
            if prev.get('style') == st.get('style'):
                errors.append(f"{st['lesson']}: 写法 {st.get('style')} 和 {prev['lesson']} 重复"
                              f"（{STYLE_GAP} 课内不能重复）")
                break
        for prev in reversed(ordered[:i]):
            if pos(st) - pos(prev) >= THEME_GAP:
                break
            if prev.get('theme') == st.get('theme'):
                errors.append(f"{st['lesson']}: 主题 {st.get('theme')} 和 {prev['lesson']} 重复"
                              f"（{THEME_GAP} 课内不能重复）")
                break
        run = [x for x in ordered[:i + 1] if pos(st) - pos(x) <= MOOD_RUN]
        if (st.get('mood') != FREE_MOOD and len(run) > MOOD_RUN
                and len({x.get('mood') for x in run}) == 1):
            errors.append(f"{st['lesson']}: 连续 {MOOD_RUN + 1} 课都是 {st.get('mood')}")
    per_volume = {}
    for st in ordered:
        vol = book.lesson_volume.get(st.get('lesson'))
        per_volume.setdefault((vol, st.get('style')), []).append(st['lesson'])
    for (vol, style), lessons in per_volume.items():
        limit = SPECIAL_PER_VOLUME if style in SPECIAL_STYLES else STYLE_PER_VOLUME
        if vol and len(lessons) > limit:
            errors.append(f"{vol[0]}-{vol[1]} 册写法 {style} 用了 {len(lessons)} 次"
                          f"（最多 {limit}）：{' '.join(lessons)}")
    return errors


def warm_reminders(stories, book):
    """Warnings where WARM_GAP stories in a row, in lesson order, have no
    warm or quiet ending. Counted in stories, not lessons: a child only
    meets the lessons that have one. Reported once per stretch."""
    pos = lambda st: book.position.get(st.get('lesson'), 10 ** 6)
    ordered = sorted(stories, key=pos)
    warnings, run = [], []
    for st in ordered + [None]:
        if st is None or st.get('mood') in WARM_MOODS:
            if len(run) >= WARM_GAP:
                warnings.append(f"{run[0]['lesson']}–{run[-1]['lesson']}：连续 {len(run)} 篇没有温暖或安静的结尾"
                                f"（每 {WARM_GAP} 篇最好有一篇，适合睡前读）")
            run = []
        else:
            run.append(st)
    return warnings


def check_characters(data, book):
    """Errors for characters.json, the cast page after the cover.

    Each intro is checked like a one-page story: every character within the
    grade 1-2 list or `allow`, and context readings declared as "p1:<n>".
    Every recurring character needs an intro, since any story may list them.
    """
    errors = []
    allow = {a['char']: a['pinyin'] for a in data.get('allow') or []}
    intros = data.get('characters') or {}
    for name in CHARACTERS + FAMILY:
        if name not in intros:
            errors.append(f'人物介绍：没有「{name}」')
    for name, intro in intros.items():
        icon = intro.get('icon')
        if not icon:
            errors.append(f'人物介绍「{name}」：没有 icon（assets/characters/ 里的 SVG）')
        elif not os.path.exists(os.path.join(ROOT, icon)):
            errors.append(f'人物介绍「{name}」：icon 文件不存在：{icon}')
        text = intro.get('text', '')
        chars = page_chars({'text': text})
        if not chars:
            errors.append(f'人物介绍「{name}」：没有字')
            continue
        readings = intro.get('readings') or {}
        context = context_readings(text)
        for n, ch in enumerate(chars, 1):
            if ch not in book.g12 and ch not in allow:
                errors.append(f'人物介绍「{name}」：「{ch}」不在一二年级生字表里，也不在 allow 里')
            key = f'p1:{n}'
            if key in readings:
                if readings[key] not in valid_readings(ch, book):
                    errors.append(f'人物介绍「{name}」：{key}「{ch}」读 {readings[key]}？这不是这个字的读音')
                continue
            if ch in allow or context is None:
                continue
            default, heard = book.card_reading.get(ch), context[n - 1]
            if default and heard and heard != default:
                errors.append(f'人物介绍「{name}」：{key}「{ch}」在这里读 {heard}？卡片是 {default}。'
                              f'在 readings 里写 "{key}": "<读音>"')
        for key in readings:
            m = KEY.match(key)
            if not m or m.group(1) != '1' or not (1 <= int(m.group(2)) <= len(chars)):
                errors.append(f'人物介绍「{name}」：readings "{key}" 指向不存在的字')
    return errors


def main(argv):
    check = '--check' in argv
    if _pypinyin() is None:
        print('❌ 小故事检查需要 pypinyin（.venv/bin/pip install pypinyin）')
        return 1
    if not stories_source.available():
        print(f'⚠️ 小故事：{stories_source.missing_message()}，跳过检查')
        return 0
    book = Textbook()
    errors, warnings, all_stories, infos = [], [], [], []
    for volume, data in load_volumes():
        e, w, i = check_volume(data, volume, book)
        errors += e
        warnings += w
        infos += i
        all_stories += data.get('stories') or []
    errors += check_rotation(all_stories, book)
    warnings += warm_reminders(all_stories, book)
    chars_data = load_characters()
    if chars_data is None:
        errors.append(f'没有 {stories_source.CHARACTERS_FILE}（封面背面的人物介绍）')
    else:
        errors += check_characters(chars_data, book)

    if not check:
        for story, info in infos:
            print(f"📖 {story['lesson']} {book.lesson_title.get(story['lesson'], '')}《{story.get('title')}》"
                  f" {info['pages']} 页 {info['chars']} 字 {info['distinct']} 个不同的字")
            print('   本课新字：' + ' '.join(f'{c}×{n}' for c, n in info['new']))
            print(f"   还没学到 {len(info['unlearned'])} 个（{info['unlearned_share']:.0%}）："
                  f"{''.join(info['unlearned'])}")
            print(f"   超出一二年级字表：{''.join(info['outside']) or '无'}")
            if info['review']:
                print('   请核对读音：' + '；'.join(info['review']))
        for w in warnings:
            print(f'⚠️  {w}')
    for e in errors:
        print(f'❌ {e}')
    if errors:
        print(f'❌ 小故事：{len(errors)} 个错误')
        return 1
    print(f'✅ 小故事：{len(all_stories)} 篇，用字、读音、轮换规则都通过'
          + (f'（{len(warnings)} 个提醒，不带 --check 运行可看）' if check and warnings else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
