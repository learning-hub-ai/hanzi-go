#!/usr/bin/env python3
"""
Repair example sentences that are actually 生字表 rows mis-parsed as prose.

The bug
-------
The original extraction (see gen_g2s1.py's extract_sentences_from_pdf)
flattens every PDF line by stripping spaces, then splits on punctuation. A
生字表 row is laid out as spaced single characters:

    毯 玻 璃 裳 虹 蹄 腐 稍 微
    朗读课文，想象草原迷人的景色，读出自己的感受。背诵第 1 自然段。

Stripping the spaces turns the first line into one punctuation-free run
("毯玻璃裳虹蹄腐稍微") which then glues onto the 课后练习 line that follows,
and the whole thing becomes a candidate "sentence". 蹄 in 六年级上册《草原》
ended up with "毯玻璃裳虹蹄腐稍微今年的丁香花似乎开得格外茂盛。" — reported
by a user.

Scope: 175 sentences across 44 lessons in 7 of the 18 data files.

Why a targeted repair and not a re-run
--------------------------------------
Only grade2-semester1 has its generator in the repo (gen_g2s1.py); the other
17 files were produced by scripts that were never committed. Re-running is
therefore not possible for most of them, and regenerating wholesale would
also churn pinyin/words that are currently correct. This script rewrites
*only* the `sentence` field of *only* the affected entries, leaving
char/pinyin/words untouched.

Usage
-----
    python3 scripts/fix_polluted_sentences.py --check     # report only
    python3 scripts/fix_polluted_sentences.py --file data/grade6-semester1.json
    python3 scripts/fix_polluted_sentences.py --apply     # all files

Requires the textbook PDFs. They are NOT in the repo (copyright) — point
KEBEN_DIR at them, defaulting to ./keben which .gitignore excludes.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEBEN_DIR = os.environ.get("KEBEN_DIR", os.path.join(REPO_ROOT, "keben"))

GRADE_CN = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五",
            6: "六", 7: "七", 8: "八", 9: "九"}

# A 生字表 row: single characters separated by spaces. Prose never looks like
# this, which is exactly what makes the row identifiable *before* the spaces
# are stripped — the original extractor stripped first and lost the signal.
CHAR_LIST_ROW = re.compile(r'^\s*(?:[\u4e00-\u9fff]\s+){3,}[\u4e00-\u9fff]\s*$')

# 课后练习 / 教学指令 lines. Not prose the child should see as an example, and
# they are what the 生字表 row glues onto.
INSTRUCTION = re.compile(
    r'(朗读课文|默读课文|分角色朗读|朗读并背诵|背诵课文|背诵第|抄写下来|抄写句子'
    r'|字词句运用|交流平台|初试身手|词句段运用|日积月累|读一读|写一写|想一想'
    r'|不要指读|注意读好|注意对话|有感情地朗读|读出自己的感受|选做)'
)

# Lines that are page furniture rather than text.
NOISE = re.compile(r'^\s*(?:\d+|第\s*\d+\s*(?:单元|课)|目\s*录|语文|人民教育出版社)\s*$')

# The appendix tables (识字表/写字表/词语表) are long unspaced runs of
# characters, so the spaced-row pattern above does not catch them.
#
# Matched as a standalone heading, not anywhere in the line: these words also
# appear in the table of contents near the front ("写字表......130"), and
# breaking there cut off the whole book — 5127 lines reduced to 229, which
# turned 4 fixable sentences into 0.
APPENDIX_HEADING = re.compile(r'^\s*(?:写字表|识字表|词语表)\s*$')

# A line that is almost entirely an unspaced run of characters with no
# punctuation is an appendix table body, wherever it appears.
def _is_table_body(s):
    if len(s) < 40:
        return False
    cn = sum(1 for c in s if '\u4e00' <= c <= '\u9fff')
    punct = sum(1 for c in s if c in '，。！？；：、“”')
    return cn >= 40 and punct <= 1

SENT_END = '。！？'
MIN_CN, MAX_CN = 6, 30          # a usable example: a real clause, not a fragment


def pdf_for(data_file):
    """Map data/gradeN-semesterM.json → the textbook PDF filename."""
    m = re.search(r'grade(\d+)-semester(\d+)', os.path.basename(data_file))
    if not m:
        return None
    grade, sem = int(m.group(1)), int(m.group(2))
    half = "上册" if sem == 1 else "下册"
    pattern = os.path.join(KEBEN_DIR, f"语文 统编版 {GRADE_CN[grade]}年级 {half} *.pdf")
    hits = sorted(glob.glob(pattern))
    return hits[0] if hits else None


def pdf_text(pdf_path):
    """pdftotext the whole book once; cached per process."""
    if pdf_path in pdf_text._cache:
        return pdf_text._cache[pdf_path]
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        out = tmp.name
    try:
        subprocess.run(['pdftotext', pdf_path, out],
                       capture_output=True, text=True, check=True)
        with open(out, encoding='utf-8') as f:
            raw = f.read()
    finally:
        if os.path.exists(out):
            os.unlink(out)
    pdf_text._cache[pdf_path] = raw
    return raw
pdf_text._cache = {}


def clean_lines(raw):
    """
    Drop 生字表 rows and 课后练习 lines, THEN strip spaces.

    Order is the whole fix: the space pattern is the only thing that marks a
    character-list row, so it has to be tested before the spaces go.

    Stops entirely at the appendix (写字表/识字表/词语表). Those tables are
    unspaced character runs hundreds of characters long, so the spaced-row
    test above misses them, and anything after that heading is index material.
    """
    kept = []
    for line in raw.split('\n'):
        if APPENDIX_HEADING.match(line):
            break
        if CHAR_LIST_ROW.match(line):
            continue
        if INSTRUCTION.search(line):
            continue
        if NOISE.match(line):
            continue
        s = line.replace(' ', '').replace('\t', '')
        # Strip pinyin annotations, which pdftotext interleaves with the text
        s = re.sub(r'[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+', '', s)
        if _is_table_body(s):
            continue
        if sum(1 for c in s if '\u4e00' <= c <= '\u9fff') >= 3:
            kept.append(s)
    return kept


def sentences_from(raw):
    """
    Candidate example sentences, in document order.

    Joined across lines before splitting: pdftotext hard-wraps mid-sentence,
    and the reported 马蹄 sentence ("起来：欢呼声，车声，马蹄声，响成一片。")
    starts on one line and ends on the next.

    Over-long sentences are split again at clause boundaries rather than
    discarded. Expository passages run long — the 火星 paragraph in 六年级上册
    is one 102-character sentence, and dropping it left 燥/漠/磁 with no
    candidate at all even though each appears in the prose.
    """
    text = ''.join(clean_lines(raw))
    out = []
    buf = ''
    for ch in text:
        buf += ch
        if ch in SENT_END:
            out.extend(_usable(buf))
            buf = ''
    return out


def _usable(sentence):
    """
    One raw sentence → zero or more usable examples.

    Within range: keep as is. Too long: fall back to its clauses, so a
    102-character expository sentence still yields "火星的磁场非常弱" rather
    than nothing. Clauses are kept only if they stand alone as a statement.
    """
    s = _tidy(sentence)
    if not s:
        return []
    n = _cn(s)
    if MIN_CN <= n <= MAX_CN:
        return [s]
    if n <= MAX_CN:
        return []
    parts = [p.strip() for p in re.split(r'[，；：]', s) if p.strip()]
    keep = []
    for p in parts:
        p = _tidy(p)
        if not p:
            continue
        # Re-attach a full stop so the example reads as a sentence.
        cand = p if p[-1] in SENT_END else p + '。'
        if MIN_CN <= _cn(cand) <= MAX_CN:
            keep.append(cand)
    return keep


# Editorial marks pdftotext leaves behind: poem separators, footnote bullets,
# and the ◇/◆/* glyphs the textbook uses between pieces in a 古诗二首 lesson.
# Left in, they produce examples like "拂堤杨柳醉◇不知细叶谁裁出。" — two
# different poems welded together.
EDITORIAL = re.compile(r'[◇◆◎※\*△▲□■●·•]')
# Author/dynasty attribution, e.g. "[唐]贺知章碧玉妆成一树高" — not prose.
ATTRIBUTION = re.compile(r'[\[［【]\s*[\u4e00-\u9fff]{1,3}\s*[\]］】]')


def _tidy(s):
    """
    Normalise a candidate, or return '' to reject it.

    Rejects rather than strips when an editorial mark sits mid-sentence: the
    text on either side belongs to different pieces, so splicing them would
    read as one nonsensical line.
    """
    s = s.strip().strip('“”「」《》')
    if not s:
        return ''
    if ATTRIBUTION.search(s):
        return ''
    if EDITORIAL.search(s):
        return ''
    # Unbalanced quote: pdftotext split a line of dialogue, so the candidate
    # is half a quotation ("寒号鸟重复着哀“哆啰啰。"). Readable but wrong.
    if s.count('“') != s.count('”'):
        return ''
    # Two or more consecutive spaces mark a 词语表 row that survived the
    # single-character test because its entries are multi-character
    # ("珍惜   钱币纸币   财富赔礼"). Not prose.
    if re.search(r'\S\s{2,}\S', s):
        return ''
    # A newline inside the candidate means two typeset lines were joined
    # without being a single sentence.
    if '\n' in s:
        return ''
    # A lesson title sitting flush against its own opening sentence, e.g.
    # "太空生活趣事多航天员乘坐宇宙飞船飞往太空。" — the title line and the
    # first body line were adjacent in the PDF with nothing between them.
    # Strip the title rather than discard the sentence, which is otherwise
    # the correct one for this lesson.
    s = TITLE_PREFIX.sub('', s, count=1)
    if not s or _cn(s) < MIN_CN:
        return ''
    return s


# Lesson titles that pdftotext leaves glued to the following sentence. Listed
# explicitly rather than matched by a pattern: a generic "strip anything
# before the first verb" rule removed real sentence openings.
TITLE_PREFIX = re.compile(
    r'^(?:太空生活趣事多|我爱阅读|习\s*作|山\s*行|口语交际|识字加油站)'
)


def _cn(s):
    return sum(1 for c in s if '\u4e00' <= c <= '\u9fff')


def is_polluted(sentence, lesson_chars):
    """
    True when a sentence opens with a run of this lesson's own 生字 — the
    fingerprint of a 生字表 row that was parsed as prose.

    Requiring the instruction text as well (or a long run) keeps real
    sentences out: 「一二三四五，金木水火土。」 legitimately opens with five
    of its lesson's characters.
    """
    if not sentence:
        return False
    run = 0
    for ch in sentence:
        if ch in lesson_chars:
            run += 1
        else:
            break
    if run < 4:
        return False
    return bool(INSTRUCTION.search(sentence)) or run >= 6


def pick_replacement(char, candidates, used):
    """
    Shortest unused candidate containing the character.

    Shortest because these are examples for a child reading one character;
    unused so a lesson does not show the same sentence for eight 生字 in a
    row, which is how the original data reads in places.
    """
    hits = [s for s in candidates if char in s]
    if not hits:
        return None
    fresh = [s for s in hits if s not in used]
    pool = fresh or hits
    return min(pool, key=lambda s: len(s))


def fallback_from_words(entry):
    """
    Last resort: build "词语·词语" from the entry's own 词语 list.

    27 of the 175 characters genuinely have no example sentence in the book —
    27 of them (螃/鲤/鲫/鲨, 锋/蜜/蜂, 莺/绦 …) appear only inside the 词语表
    and 生字表, never in prose. Checked directly in the PDF rather than
    assumed: 螃 occurs 5 times, all of them in those two tables.
    
    Their 词语 fields are correct, so showing "螃蟹 · 螃蟹壳" is both true and
    useful, where leaving the 生字表 text in place is neither. Flagged as a
    fallback in the report so it is a visible compromise, not a silent one.
    """
    words = [w for w in (entry.get('words') or []) if w]
    if not words:
        return None
    return ' · '.join(words[:3])


def process(data_file, apply_changes):
    with open(data_file, encoding='utf-8') as f:
        data = json.load(f)

    pending = []
    for lesson in data['lessons']:
        chars = {c['char'] for c in lesson['chars']}
        for entry in lesson['chars']:
            if is_polluted(entry.get('sentence', ''), chars):
                pending.append((lesson, entry))

    if not pending:
        return {'file': data_file, 'polluted': 0, 'fixed': 0, 'unfixed': []}

    pdf = pdf_for(data_file)
    if not pdf:
        return {'file': data_file, 'polluted': len(pending), 'fixed': 0,
                'unfixed': [e['char'] for _, e in pending],
                'error': f'no PDF found in {KEBEN_DIR}'}

    candidates = sentences_from(pdf_text(pdf))
    # Never reintroduce the bug: a candidate that still looks like a
    # character list for its own lesson is not a sentence.
    used = {c['sentence'] for L in data['lessons'] for c in L['chars']
            if c.get('sentence')}

    fixed, fellback, unfixed, samples = 0, [], [], []
    for lesson, entry in pending:
        chars = {c['char'] for c in lesson['chars']}
        repl = pick_replacement(entry['char'], candidates, used)
        if repl and not is_polluted(repl, chars):
            samples.append((lesson['id'], entry['char'],
                            entry['sentence'][:28], repl))
            if apply_changes:
                entry['sentence'] = repl
            used.add(repl)
            fixed += 1
            continue
        # No prose example exists in the book for this character.
        alt = fallback_from_words(entry)
        if alt:
            fellback.append((entry['char'], alt))
            if apply_changes:
                entry['sentence'] = alt
            fixed += 1
        else:
            unfixed.append(entry['char'])

    if apply_changes and fixed:
        with open(data_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')

    return {'file': data_file, 'polluted': len(pending), 'fixed': fixed,
            'fellback': fellback, 'unfixed': unfixed, 'samples': samples}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', help='single data file (default: all)')
    ap.add_argument('--apply', action='store_true', help='write changes')
    ap.add_argument('--check', action='store_true', help='report only')
    ap.add_argument('--samples', type=int, default=3,
                    help='how many before/after pairs to print per file')
    args = ap.parse_args()

    files = [args.file] if args.file else sorted(
        glob.glob(os.path.join(REPO_ROOT, 'data', 'grade*.json')))
    apply_changes = args.apply and not args.check

    total_p = total_f = 0
    for path in files:
        r = process(path, apply_changes)
        if not r['polluted']:
            continue
        total_p += r['polluted']
        total_f += r['fixed']
        name = os.path.basename(r['file'])
        fb = r.get('fellback') or []
        print(f"{name}: {r['polluted']} polluted, {r['fixed']} fixable"
              + (f" ({len(fb)} via 词语 fallback)" if fb else '')
              + (f", {len(r['unfixed'])} not" if r['unfixed'] else ''))
        if r.get('error'):
            print(f"  ! {r['error']}")
        for lid, ch, before, after in r.get('samples', [])[:args.samples]:
            print(f"  {lid} 「{ch}」")
            print(f"    - {before}…")
            print(f"    + {after}")
        if fb and args.samples:
            shown = ' '.join(f"{c}→{t}" for c, t in fb[:6])
            print(f"  no prose example in the book, used 词语: {shown}")
        if r['unfixed']:
            print(f"  no candidate at all: {' '.join(r['unfixed'][:20])}")

    verb = 'rewritten' if apply_changes else 'would be rewritten'
    print(f"\n{total_p} polluted sentences, {total_f} {verb}")
    if not apply_changes:
        print("(dry run — pass --apply to write)")
    return 0 if total_f == total_p else 1


if __name__ == '__main__':
    sys.exit(main())
