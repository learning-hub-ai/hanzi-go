#!/usr/bin/env python3
"""
Generate data/heteronyms.json — the 多音字 word-to-reading table.

Why this exists
---------------
A 多音字 spoken on its own gets whatever reading the TTS engine considers
default. 爪 is annotated zhuǎ in the grade 1 textbook (爪子, 鸡爪), but every
engine says zhǎo for the bare character because that reading is commoner.
This is not one stray card: 262 of the 4014 characters carry an annotation
that differs from the bare-character default.

Speaking a WORD fixes it — engines disambiguate from context, and '爪子' is
said zhuǎ zi. This script works out, for each such character, which of its
words actually selects the annotated reading, so Speech.speakChar() can pick
one instead of guessing.

Words whose reading disagrees with the card's pinyin are deliberately left
out: 喝 is annotated hè but worded 喝水/喝茶, which any engine reads hē, so
offering such a word would be actively wrong. Those characters fall back to
the bare character, which is no worse than before.

Requires pypinyin (dev-only; the app itself ships the generated JSON).

Usage
-----
    python3 scripts/gen_heteronyms.py
    python3 scripts/gen_heteronyms.py --check   # verify without writing
"""

import argparse
import glob
import json
import os
import sys

try:
    from pypinyin import pinyin, Style
    from pypinyin.contrib.tone_convert import to_normal
except ImportError:
    sys.exit("pypinyin required: pip install pypinyin")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, 'data', 'heteronyms.json')


def reading_of(word, char):
    """The reading pypinyin gives `char` where it appears in `word`."""
    syllables = pinyin(word, style=Style.TONE, heteronym=False)
    for i, c in enumerate(word):
        if c == char and i < len(syllables):
            return syllables[i][0]
    return None


def build():
    """
    Map each 多音字 to the words that select its annotated reading.

    Returns (table, stats) where stats explains the coverage, so a reviewer
    can see what was included and what was skipped.
    """
    table = {}
    total = bare_ok = covered = uncovered = 0

    for path in sorted(glob.glob(os.path.join(REPO_ROOT, 'data', 'grade*.json'))):
        data = json.load(open(path, encoding='utf-8'))
        for lesson in data['lessons']:
            for entry in lesson['chars']:
                char = entry['char']
                want = (entry.get('pinyin') or '').strip()
                if not want:
                    continue
                total += 1

                # The bare character already reads correctly — most cards.
                if pinyin(char, style=Style.TONE, heteronym=False)[0][0] == want:
                    bare_ok += 1
                    continue

                hits = {}
                for word in (entry.get('words') or []):
                    if not isinstance(word, str) or char not in word or len(word) < 2:
                        continue
                    got = reading_of(word, char)
                    if not got:
                        continue
                    # Accept an exact match, or a match ignoring tone: the
                    # textbook writes neutral tone without a mark ('爪子' as
                    # zi) where pypinyin supplies one.
                    if got == want or to_normal(got) == to_normal(want):
                        hits[word] = want
                if hits:
                    table.setdefault(char, {}).update(hits)
                    covered += 1
                else:
                    uncovered += 1

    return table, {
        'total': total,
        'bare_ok': bare_ok,
        'covered': covered,
        'uncovered': uncovered,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='compare against the committed file without writing')
    args = ap.parse_args()

    table, stats = build()
    body = json.dumps(table, ensure_ascii=False, indent=2, sort_keys=True) + '\n'

    print(f"characters total              {stats['total']}")
    print(f"bare reading already correct  {stats['bare_ok']}")
    print(f"fixed by speaking a word      {stats['covered']}")
    print(f"no usable word (falls back)   {stats['uncovered']}")
    print(f"\ntable: {len(table)} characters, "
          f"{sum(len(v) for v in table.values())} word mappings")

    if args.check:
        if not os.path.exists(OUT_PATH):
            print(f"\n{OUT_PATH} missing")
            return 1
        if open(OUT_PATH, encoding='utf-8').read() != body:
            print(f"\n{OUT_PATH} is out of date — rerun without --check")
            return 1
        print(f"\n{OUT_PATH} is up to date")
        return 0

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(body)
    print(f"\nwrote {OUT_PATH}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
