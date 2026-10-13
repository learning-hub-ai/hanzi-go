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
    out = ATTRIBUTION.sub('', out)
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
