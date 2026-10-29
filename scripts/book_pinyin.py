#!/usr/bin/env python3
"""
Read the book's own pinyin for each 生字 from the 识字表 of a textbook PDF.

Why this exists
---------------
The card's pinyin must be the book's (家长 2026-10-29: 「注音要和书上一样」).
Grades 1–6 print every 生字 with its pinyin in the 识字表 appendix, lesson by
lesson. That table, not a dictionary, is the reference for a card.

How the PDF is read
-------------------
pdftotext keeps the table's two-line layout (pinyin over characters). The
pinyin font (HanyuXi-JZ) draws tone vowels for capital letters, so the text
reads 'shuQng' for shuāng. TONE_FONT maps them back; it was worked out by
voting over thousands of characters with a single reading and every letter
had one clear winner (2026-10-29). ü is written 'ü' or 'v' in the PDF.

Only grades 1–5 have such a table: grade 6 has a 写字表 without pinyin, and
grades 7–9 give pinyin only in footnotes for a few words.

Output: rows of [(char, pinyin), ...], in book order. Rows whose pinyin and characters do not line up are reported and left
out rather than guessed.

Usage
-----
    python3 scripts/book_pinyin.py 1 2         # print the table for 一下
The PDFs are not in the repo (copyright): ./keben, or KEBEN_DIR.
"""

import os
import re
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Same place as the other PDF scripts (fix_quotes.py, fix_polluted_sentences.py):
# ./keben, which .gitignore excludes.
KEBEN_DIR = os.environ.get('KEBEN_DIR', os.path.join(REPO_ROOT, 'keben'))
GRADE_NAMES = '一二三四五六七八九'
SEM_NAMES = {1: '上册', 2: '下册'}

# Capital letter -> tone-marked vowel, as drawn by the 识字表's pinyin font.
TONE_FONT = {
    'Q': 'ā', 'W': 'á', 'A': 'ǎ', 'S': 'à',
    'E': 'ē', 'R': 'é', 'D': 'ě', 'F': 'è',
    'U': 'ī', 'I': 'í', 'J': 'ǐ', 'K': 'ì',
    'T': 'ō', 'Y': 'ó', 'G': 'ǒ', 'H': 'ò',
    'O': 'ū', 'P': 'ú', 'L': 'ǔ', 'M': 'ù',
    'Z': 'ǖ', 'B': 'ǘ', 'V': 'ǚ', 'C': 'ǜ',
}
HAN = re.compile(r'[\u4e00-\u9fff]')
PINYIN_TOKEN = re.compile(r"^[a-zA-Zü]+$")


def available():
    """
    Why the books cannot be read here, or '' when they can.

    The PDFs are not in the repo (copyright) and pdftotext is a system tool,
    so a check built on this module skips with this reason instead of failing.
    """
    if not os.path.isdir(KEBEN_DIR):
        return f'没有课本 PDF：{KEBEN_DIR}'
    if not shutil.which('pdftotext'):
        return '没有 pdftotext（poppler-utils）'
    return ''


def pdf_path(grade, semester):
    """The PDF for a volume (edition year varies, so match by name)."""
    want = f'语文 统编版 {GRADE_NAMES[grade - 1]}年级 {SEM_NAMES[semester]}'
    for name in sorted(os.listdir(KEBEN_DIR)):
        if name.startswith(want) and name.endswith('.pdf'):
            return os.path.join(KEBEN_DIR, name)
    raise FileNotFoundError(f'{want} not in {KEBEN_DIR}')


def decode(token):
    """'shuQng' -> 'shuāng'. A ü before a tone letter keeps its own dot: 'lüF' -> 'lüè'."""
    out = ''.join(TONE_FONT.get(c, c) for c in token)
    return out.replace('v', 'ü')


def table_lines(text):
    """The lines of the 识字表, from its heading to the 写字表."""
    lines = text.split('\n')
    starts = [i for i, l in enumerate(lines) if re.sub(r'\s', '', l) == '识字表']
    if not starts:
        return []
    start = starts[-1]                      # the appendix, not the table of contents
    end = next((i for i in range(start + 1, len(lines))
                if re.sub(r'\s', '', lines[i]) in ('写字表', '词语表')), len(lines))
    return lines[start + 1:end]


# Row labels in the 识字表 that are not 生字.
LABEL = re.compile(r'语文园地[一二三四五六七八]?|识字|阅读|汉语拼音')


def _segments(line):
    """Split a line where it has a wide gap (two tables side by side)."""
    return [(m.start(), m.group()) for m in re.finditer(r'\S+(?: {1,5}\S+)*', line)]


def _pair(py_line, ch_line):
    """
    The (char, pinyin) pairs of one table row, or None if they do not line up.

    The row's characters are the Hanzi under the pinyin, minus row labels
    (「语文园地一」). Normally the counts match and they pair in order. A page
    with two tables side by side has a wide gap in both lines: each half is
    then paired on its own, by the character segment under the pinyin
    segment. Anything else is refused, never guessed.
    """
    tokens = py_line.split()
    chars = HAN.findall(LABEL.sub(' ', ch_line))
    if len(chars) == len(tokens):
        return list(zip(chars, (decode(t) for t in tokens)))
    py_segs, ch_segs = _segments(py_line), _segments(LABEL.sub(lambda m: ' ' * len(m.group()), ch_line))
    ch_segs = [(s, HAN.findall(x)) for s, x in ch_segs if HAN.search(x)]
    out = []
    for start, seg in py_segs:
        toks = seg.split()
        under = [cs for s, cs in ch_segs if abs(s - start) <= 6]
        if len(under) != 1 or len(under[0]) != len(toks):
            return None
        out += list(zip(under[0], (decode(t) for t in toks)))
    used = sum(len(cs) for s, cs in ch_segs if any(abs(s - st) <= 6 for st, _ in py_segs))
    return out if used == len(chars) else None


def parse(lines):
    """
    Pair each pinyin line with the character line under it.

    Returns (rows, problems): rows are lists of (char, pinyin); problems are
    pinyin lines whose characters did not line up, as text, for a person.
    """
    rows, problems = [], []
    for i in range(len(lines) - 1):
        tokens = lines[i].split()
        if not tokens or not all(PINYIN_TOKEN.match(t) for t in tokens):
            continue
        pairs = _pair(lines[i], lines[i + 1])
        # A label on its own line pushes the characters one line down
        # (一上: 「语文园地一」, then 六 七 八 九 十 on the next line).
        if pairs is None and not HAN.findall(LABEL.sub(' ', lines[i + 1])) and i + 2 < len(lines):
            pairs = _pair(lines[i], lines[i + 2])
        if pairs is None:
            problems.append(f'{len(tokens)} pinyin over: {lines[i + 1].strip()}')
            continue
        rows.append(pairs)
    return rows, problems


def book_table(grade, semester):
    """(rows, problems) for one volume's 识字表."""
    text = subprocess.run(['pdftotext', '-layout', pdf_path(grade, semester), '-'],
                          capture_output=True, text=True, check=True).stdout
    return parse(table_lines(text))


def compare(grade, semester, lessons):
    """
    Cards whose pinyin is not the book's.

    Each lesson is found in the 识字表 as the run of its characters in order
    (the table lists lessons in book order, the app may not); its pinyin is
    then compared position by position, which is exact even for a character
    that appears twice with different readings (倒 dǎo / dào).
    A lesson not found as one run (it spans two rows of the table) falls back
    to the character's readings in the volume; one that is not in the book at
    all is reported, since then there is nothing to compare with.

    Returns (differences, lessons_not_found): differences are
    (lesson_id, char, card_pinyin, book_pinyin).
    """
    rows, _ = book_table(grade, semester)
    flat = [x for r in rows for x in r]
    chars = [c for c, _ in flat]
    diffs, missing = [], []
    for lesson in lessons:
        lc = [c['char'] for c in lesson['chars']]
        hits = [i for i in range(len(chars) - len(lc) + 1) if chars[i:i + len(lc)] == lc]
        if len(hits) == 1:
            for card, (_, py) in zip(lesson['chars'], flat[hits[0]:hits[0] + len(lc)]):
                if card['pinyin'] != py:
                    diffs.append((lesson['id'], card['char'], card['pinyin'], py))
            continue
        for card in lesson['chars']:
            readings = {py for ch, py in flat if ch == card['char']}
            if not readings:
                missing.append(lesson['id'])
            elif card['pinyin'] not in readings:
                diffs.append((lesson['id'], card['char'], card['pinyin'], '/'.join(sorted(readings))))
    return diffs, sorted(set(missing))


def main():
    grade, semester = int(sys.argv[1]), int(sys.argv[2])
    rows, problems = book_table(grade, semester)
    for pairs in rows:
        print(' '.join(f'{c}{p}' for c, p in pairs))
    for p in problems:
        print('⚠️', p, file=sys.stderr)


if __name__ == '__main__':
    main()
