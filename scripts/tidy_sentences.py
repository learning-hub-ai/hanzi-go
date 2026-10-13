#!/usr/bin/env python3
"""
Tidy typesetting debris out of example sentences, without replacing them.

Separate from fix_polluted_sentences.py on purpose. That script answers "this
sentence is not prose at all, find a different one". This one answers "the
sentence is right, but it carries marks from the PDF layout" and edits in
place, so a correct sentence is never swapped for a different one.

Three classes, all artefacts of pdftotext rather than the textbook:

  soft line break   '电脑屏幕上突然出\\n现了谁？'   → join (the typesetter
                    wrapped mid-word; nothing was omitted)
  leading mark      '◇白日依山尽，黄河入海流。'     → strip the ◇/◎/*
  attribution       '[唐]杜甫两个黄鹂鸣翠柳…'       → strip '[唐]杜甫'

Deliberately NOT touched: unbalanced quotes such as '仙人指路”就更有趣了！'.
The opening quote is on an earlier PDF line, so the text is genuinely missing
— removing the stray ” would produce a sentence that reads fine but is not
what the book says. Those need a replacement sentence, not tidying, and are
left for fix_polluted_sentences.py or manual review.

Usage
-----
    python3 scripts/tidy_sentences.py            # report
    python3 scripts/tidy_sentences.py --apply
"""

import argparse
import glob
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CN = r'\u4e00-\u9fff'
# Editorial marks the textbook prints before an exercise or a quoted line.
LEADING_MARK = re.compile(r'^[\s◇◆◎※*△▲□■●·•]+')
# Dynasty + poet, e.g. '[唐]杜甫' / '［唐］李白'. Only stripped at the start:
# mid-sentence it could be part of the text being discussed.
ATTRIBUTION = re.compile(rf'^[\[［【]\s*[{CN}]{{1,3}}\s*[\]］】]\s*[{CN}]{{0,4}}')
# Unit/section headings that pdftotext glues to the first line of prose.
SECTION = re.compile(rf'^第[一二三四五六七八九十]+单元[·\s]*[{CN}]{{0,6}}')
# Wide spaces the textbook uses for alignment inside headings.
WIDE_SPACE = re.compile(r'[\u2002\u2003\u2009\u200a]+')

# Poets whose names appear in the 古诗 lessons, longest first so 刘禹锡 is
# matched before any two-character prefix of it.
#
# An explicit list, not a pattern: a poet's name is two or three characters
# and runs straight into the first line of the poem, so a length-based regex
# cannot tell where the name ends. Trying `[\u4e00-\u9fff]{2,4}` turned
# '[唐]王之涣白日依山尽' into '日依山尽' — it ate 王之涣 plus the 白 that
# opens the verse, losing the very character the card teaches.
POETS = sorted([
    '王之涣', '杜甫', '刘禹锡', '杜牧', '叶绍翁', '李清照', '龚自珍',
    '孟浩然', '于谦', '李白', '王充', '葛洪', '苏轼', '白居易', '王维',
    '贺知章', '杨万里', '范成大', '辛弃疾', '陆游', '张志和', '卢钰',
    '毛泽东', '林升', '查慎行',
], key=len, reverse=True)
POET_RE = re.compile('|'.join(map(re.escape, POETS)))

# A poem heading: title, optional (其七), then [朝代], then the poet.
POEM_HEAD = re.compile(
    rf'^[{CN}\s（）()其一二三四五六七八九十]*?'
    rf'[\[［【]\s*[{CN}]{{1,3}}\s*[\]］】]\s*'
)
# An attributed quotation: '—《论语》◎' / '—— 王充◎' / '—葛洪◎'
QUOTE_SRC = re.compile(rf'^[—\-\s]+(?:《[{CN}]+》|[{CN}]{{2,4}})?\s*[◎※]\s*')
# A lesson title glued to its body with an asterisk: '璀璨的明珠*香港位于…'
TITLE_STAR = re.compile(rf'^[{CN}，、\s]{{2,14}}\*\s*')


def tidy(s):
    """Return (cleaned, [what changed]). Never shortens meaningful text."""
    changes = []
    out = s

    if '\n' in out:
        # Join only when the break is mid-sentence. A break right after
        # sentence-ending punctuation separates two sentences, and joining
        # them would fabricate a longer one.
        joined = re.sub(r'(?<![。！？])\n\s*', '', out)
        joined = joined.replace('\n', '')
        if joined != out:
            out = joined
            changes.append('join')

    before = out
    out = SECTION.sub('', out)

    # Poem heading: '山 行[唐] 杜 牧远上寒山石径斜' → strip title + dynasty,
    # then the poet by name. The textbook spaces out two-character names
    # (杜 牧), so spaces are dropped before the name is matched.
    head = POEM_HEAD.match(out)
    if head:
        rest = WIDE_SPACE.sub('', out[head.end():]).replace(' ', '')
        poet = POET_RE.match(rest)
        if poet:
            out = rest[poet.end():]
        else:
            # Unknown poet: leave the sentence alone rather than guess a
            # name length and risk eating the opening of the verse.
            out = before

    if out == before:
        out = QUOTE_SRC.sub('', out, count=1)
    if out == before:
        out = TITLE_STAR.sub('', out, count=1)
    if out == before:
        out = ATTRIBUTION.sub('', out, count=1)
        out = LEADING_MARK.sub('', out)
    if out != before:
        changes.append('strip-mark')

    collapsed = WIDE_SPACE.sub('', out)
    collapsed = re.sub(r'\s{2,}', ' ', collapsed).strip()
    if collapsed != out:
        out = collapsed
        changes.append('spaces')

    return out, changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--samples', type=int, default=8)
    args = ap.parse_args()

    total = 0
    shown = 0
    for path in sorted(glob.glob(os.path.join(REPO_ROOT, 'data', 'grade*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        n = 0
        for lesson in data['lessons']:
            for entry in lesson['chars']:
                old = entry.get('sentence') or ''
                if not old:
                    continue
                new, changes = tidy(old)
                if new == old or not new:
                    continue
                # Safety: tidying must not drop the character being taught.
                if entry['char'] not in new:
                    continue
                n += 1
                if shown < args.samples:
                    shown += 1
                    print(f"  {lesson['id']} 「{entry['char']}」 [{'/'.join(changes)}]")
                    print(f"    - {old[:52]!r}")
                    print(f"    + {new[:52]!r}")
                if args.apply:
                    entry['sentence'] = new
        if n:
            total += n
            print(f"{os.path.basename(path)}: {n} tidied")
            if args.apply:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    f.write('\n')

    verb = 'tidied' if args.apply else 'would be tidied'
    print(f"\n{total} sentences {verb}")
    if not args.apply:
        print("(dry run — pass --apply to write)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
