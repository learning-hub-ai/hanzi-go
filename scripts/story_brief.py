#!/usr/bin/env python3
"""Print a writing brief for one lesson's 小故事, before outlining it.

For the lesson it shows: the lesson title and its 生字, which characters a
child has already learned by then (and how many of the grade 1–2 list are
still ahead), the styles and themes the rotation rules still allow here,
the neighbouring stories (title, style, theme, mood, cast), who has led the
stories of this volume so far, and whether a warm or quiet ending is due.

    python3 scripts/story_brief.py 1-2-12
    python3 scripts/story_brief.py 1-2-12 --json      # the same, as JSON
    python3 scripts/story_brief.py 1-2-12 --text      # also the lesson's own text

--text reads the textbook PDF in keben/ (local only, never in the repo) with
pdftotext and prints the lesson's Chinese lines, pinyin lines dropped, so the
story can grow from what the lesson says. 语文园地 have no single text.

It only reads data/, the private story files (scripts/stories_source.py) and keben/;
it never writes. Exit codes: 0 ok,
2 unknown lesson.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_stories as C  # noqa: E402
import stories_source  # noqa: E402

# design §7.0a: who should lead most often, in this order; animals after.
LEAD_ORDER = ['飞飞', '小天', '乐乐']
NEIGHBOURS = 4   # stories shown on each side
KEBEN = os.path.join(C.ROOT, 'keben')
GRADE_NAME = '一二三四五六七八九'
HAN_LINE = re.compile(r'[\u4e00-\u9fff]')
TEXT_LINES = 40


def lesson_text(lesson, book):
    """The lesson's own lines from the textbook PDF, or (None, why).

    Finds the PDF for the volume, extracts it, finds the lesson by its name
    (the text inside 《》 of the lesson title) after the table of contents,
    and keeps the lines with Chinese characters until the next lesson starts.
    """
    g, s = book.lesson_volume[lesson]
    name = re.search(r'《(.+?)》', book.lesson_title[lesson])
    if not name:
        return None, '语文园地没有单独的课文'
    name = name.group(1)
    vol = f'{GRADE_NAME[g - 1]}年级 {"上" if s == 1 else "下"}册'
    pdfs = [f for f in os.listdir(KEBEN) if vol in f and f.endswith('.pdf')] if os.path.isdir(KEBEN) else []
    if not pdfs:
        return None, f'没有找到课本 PDF（keben/ 里的「{vol}」）'
    if not shutil.which('pdftotext'):
        return None, '没有 pdftotext'
    out = subprocess.run(['pdftotext', '-layout', os.path.join(KEBEN, pdfs[0]), '-'],
                         capture_output=True, text=True, timeout=60).stdout
    lines = out.splitlines()
    squash = lambda line: re.sub(r'\s+', '', line)
    # The heading line is the lesson number then its name, nothing else;
    # the table of contents has the same with a page number after it.
    heading = lambda flat, nm: re.fullmatch(r'\d*' + re.escape(nm), flat) is not None
    hits = [i for i, line in enumerate(lines) if heading(squash(line), name)]
    if not hits:
        return None, f'在课本里没找到《{name}》'
    start = hits[-1]
    titles = {re.search(r'《(.+?)》', book.lesson_title[l]).group(1)
              for l in book.lesson_order if book.lesson_volume[l] == (g, s) and '《' in book.lesson_title[l]}
    kept = []
    for line in lines[start + 1:]:
        flat = squash(line)
        if any(heading(flat, t) for t in titles - {name}) or re.fullmatch(r'语文园地\S{1,2}', flat):
            break
        if HAN_LINE.search(line) and not re.fullmatch(r'[\d①-⑩]+', flat):
            kept.append(flat)
        if len(kept) >= TEXT_LINES:
            break
    return kept, None


def lead_of(story):
    """The story's lead: the cast member named most often in its pages."""
    text = ''.join(p.get('text', '') for p in story.get('pages') or [])
    cast = [n for n in story.get('cast') or [] if n not in C.FAMILY]
    return max(cast, key=text.count) if cast else None


def brief(lesson, book, stories):
    """The brief as a dict. `stories` are all stories of every volume."""
    pos = book.position
    volume = book.lesson_volume[lesson]
    here = pos[lesson]
    others = sorted((s for s in stories if s['lesson'] != lesson), key=lambda s: pos[s['lesson']])

    near_styles = {s['style'] for s in others if abs(pos[s['lesson']] - here) < C.STYLE_GAP}
    in_volume = [s for s in others if book.lesson_volume[s['lesson']] == volume]
    used = Counter(s['style'] for s in in_volume)
    styles = [st for st in C.STYLES if st not in near_styles
              and used[st] < (C.SPECIAL_PER_VOLUME if st in C.SPECIAL_STYLES else C.STYLE_PER_VOLUME)]
    near_themes = {s['theme'] for s in others if abs(pos[s['lesson']] - here) < C.THEME_GAP}
    themes = [t for t in C.THEMES if t not in near_themes]

    before = [s for s in others if pos[s['lesson']] < here]
    after = [s for s in others if pos[s['lesson']] > here]
    since_warm = 0
    for s in reversed(before):
        if s.get('mood') in C.WARM_MOODS:
            break
        since_warm += 1

    known = book.known_at[lesson]
    # Soonest-taught first; ties (same lesson) by the order the lesson lists them,
    # so the sample is the same on every run (a set's order is not).
    first = {}
    for l in book.lesson_order:
        for i, c in enumerate(book.new_chars[l]):
            first.setdefault(c, (pos[l], i))
    ahead = sorted(book.g12 - known, key=lambda c: first.get(c, (len(pos), 0)))
    leads = Counter(lead_of(s) for s in in_volume if lead_of(s))
    row = lambda s: {'lesson': s['lesson'], 'title': s['title'], 'style': s.get('style'),
                     'theme': s.get('theme'), 'mood': s.get('mood'), 'cast': s.get('cast'), 'lead': lead_of(s)}
    return {
        'lesson': lesson,
        'lesson_title': book.lesson_title[lesson],
        'new_chars': book.new_chars[lesson],
        'known_count': len(known & book.g12),
        'not_yet_learned_count': len(ahead),
        'not_yet_learned_sample': ''.join(ahead[:60]),
        'styles_allowed': styles,
        'themes_allowed': themes,
        'before': [row(s) for s in before[-NEIGHBOURS:]],
        'after': [row(s) for s in after[:NEIGHBOURS]],
        'stories_since_warm_ending': since_warm,
        'warm_ending_due': since_warm >= C.WARM_GAP - 1,
        'leads_in_volume': dict(leads.most_common()),
        'lead_order': LEAD_ORDER,
        'has_story': any(s['lesson'] == lesson for s in stories),
    }


def show(b):
    """The brief as readable text."""
    out = [f"📖 {b['lesson']} {b['lesson_title']}" + ('（这课已经有故事）' if b['has_story'] else ''),
           f"本课生字：{' '.join(b['new_chars'])}",
           f"到这课已学一二年级的字 {b['known_count']} 个；还没学 {b['not_yet_learned_count']} 个，"
           f"尽量少用（只列前 60 个，查草稿用 --chars），例如：{b['not_yet_learned_sample']}",
           f"可用写法：{' '.join(b['styles_allowed'])}",
           f"可用主题：{' '.join(b['themes_allowed'])}",
           '前面的故事：' + ('；'.join(f"{s['lesson']}《{s['title']}》{s['style']}/{s['mood']} 主角{s['lead']}"
                                    for s in b['before']) or '无'),
           '后面的故事：' + ('；'.join(f"{s['lesson']}《{s['title']}》{s['style']}/{s['mood']} 主角{s['lead']}"
                                    for s in b['after']) or '无'),
           f"本册主角次数：{'，'.join(f'{k} {v}' for k, v in b['leads_in_volume'].items()) or '无'}"
           f"（目标顺序：{' > '.join(b['lead_order'])} > 动物）",
           ('温暖/安静的结尾：该有了，这篇最好是温暖或安静的结尾' if b['warm_ending_due'] else
            f"温暖/安静的结尾：不急（前面连续 {b['stories_since_warm_ending']} 篇没有，每 {C.WARM_GAP} 篇有一篇就好）")]
    return '\n'.join(out)


# Characters of the cast names that are not in the list, always allowed (as
# in the story files' `allow`).
NAME_CHARS = {c for name in C.CHARACTERS for c in name} - set()


def check_draft(lesson, book, path, allow):
    """Print, page by page (title = page 0), the characters outside the list
    and not yet learned. Exit 1 if any are outside and not allowed."""
    known = book.known_at[lesson]
    allow = allow | (NAME_CHARS - book.g12)
    outside_any = False
    with open(path, encoding='utf-8') as f:
        pages = [line.strip() for line in f if line.strip()]
    for i, page in enumerate(pages):
        chars = [c for c in page if C.HAN.match(c)]
        outside = sorted({c for c in chars if c not in book.g12 and c not in allow})
        ahead = sorted({c for c in chars if c in book.g12 and c not in known})
        outside_any |= bool(outside)
        label = '标题' if i == 0 else f'{i:>2}.'
        print(f"{label} 超出字表：{''.join(outside) or '无'}　还没学：{''.join(ahead) or '无'}　{page}")
    return 1 if outside_any else 0


def main(argv):
    """Print the brief for the lesson in argv."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('lesson', help='lesson id, e.g. 1-2-12')
    ap.add_argument('--json', action='store_true', help='print JSON instead of text')
    ap.add_argument('--text', action='store_true', help="also print the lesson's text from the textbook PDF")
    ap.add_argument('--chars', metavar='FILE',
                    help='check a draft: a text file, the title on line 1 then one page per line. Per page, '
                         'characters outside the grade 1–2 list and ones not yet learned by this lesson')
    ap.add_argument('--allow', default='', metavar='CHARS',
                    help='characters the story will allow (e.g. 洞阿嚏); the names (呱) are always allowed')
    args = ap.parse_args(argv)
    book = C.Textbook()
    if args.lesson not in book.position:
        print(f'❌ 没有这一课：{args.lesson}（例如 1-2-12）', file=sys.stderr)
        return 2
    if not stories_source.available():
        print(f'⚠️ {stories_source.missing_message()}；前后的故事和主角次数会是空的', file=sys.stderr)
    stories = stories_source.all_stories()
    if args.chars:
        return check_draft(args.lesson, book, args.chars, set(args.allow))
    b = brief(args.lesson, book, stories)
    if args.text:
        b['lesson_text'], b['lesson_text_missing'] = lesson_text(args.lesson, book)
    if args.json:
        print(json.dumps(b, ensure_ascii=False, indent=2))
    else:
        print(show(b))
        if args.text:
            print('课文：' + (b['lesson_text_missing'] or '') if not b['lesson_text'] else
                  '课文（课本 PDF，只看意思，不要照搬）：\n  ' + '\n  '.join(b['lesson_text']))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
