#!/usr/bin/env python3
"""
Shorten example sentences longer than MAX_LEN characters.

Why
---
Parents reported that some card sentences are too long for a child to take
in at a glance: 852 of 3974 real sentences (21%) were over 20 characters,
the longest 37. A card's sentence exists to show the character in use, not
to be a reading exercise.

How
---
Sentences must stay textbook text (docs/data-generation-spec.md: nothing
reworded, nothing invented). A sentence is split at clause marks
(，；：。！？) and every run of whole, consecutive clauses that contains the
taught character and fits in MAX_LEN is a candidate. A candidate survives
only if it passes every rule in REJECT_RULES; of the survivors, one that
keeps the sentence's own opening (and so its subject) wins, then the longest.
The last clause mark becomes 。 unless the run already ends a sentence.

When nothing survives, the sentence is left unchanged and reported, so a
person can pick a different sentence from the PDF.

Extending
---------
* A new kind of bad cut: add a (name, predicate) pair to REJECT_RULES, add
  a case to scripts/test_shorten_sentences.py, then run --list trimmed and
  confirm only the intended results disappear.
* A bad cut no rule can describe (garbled source text, a lesson title glued
  on): add the trimmed text to sentence_trim_rejects.txt.

Usage
-----
    python3 scripts/shorten_sentences.py                 # summary, dry run
    python3 scripts/shorten_sentences.py --list trimmed  # show every trim
    python3 scripts/shorten_sentences.py --apply         # write data/
    python3 scripts/shorten_sentences.py --review-dir DIR
        # one TSV per grade of what still needs a person: sentences still
        # over MAX_LEN and sentences with a data defect
"""

import argparse
import glob
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_GLOB = os.path.join(REPO_ROOT, 'data', 'grade*.json')
REJECTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'sentence_trim_rejects.txt')

# pre-push.sh imports MAX_LEN, so the limit is defined once.
MAX_LEN = 20
# Fewer characters than this leaves too little context to show the
# character in use ('据后来“侦察”。', '如此精湛的工艺。').
MIN_LEN = 8

# Word-pair fallbacks ('试一试 · 考试') are not prose and are never trimmed.
FALLBACK_MARK = ' · '

CLAUSE_SPLIT = re.compile(r'(?<=[，；：。！？])')  # mark stays with its clause
SENT_END = '。！？'
CLOSE_MARKS = '”’」』）)'
PAIRS = (('“', '”'), ('‘', '’'), ('（', '）'), ('《', '》'), ('「', '」'))


# ---------------------------------------------------------------------------
# Patterns. Each documents the bad cut it was added for.
# ---------------------------------------------------------------------------

# Starts with punctuation left by a PDF line break: '，处处欢声笑语…'.
STRAY_START = re.compile(r'^[，、；：。！？”’」）)·…—]')
# Starts with the tail of a number the extraction cut: '点，踩着…', '年，与…'.
FRAGMENT_START = re.compile(r'^(?:点|年|月|日|号|岁|时|分)[，、]')
# Book apparatus, not lesson text: credits, footnotes, publisher lines.
APPARATUS = re.compile(
    r'绘制插图|封面绘制|本书.{0,6}(?:编|审|校)|出版社|责任编辑|本文作者|'
    r'选作课文时|[①②③④⑤⑥⑦⑧⑨⑩]')
# Mid-sentence clause that continues an earlier one through a connective:
# '而且贝壳可以随身携带。', '想拯救自己的幼儿。'.
CONNECTIVE_START = re.compile(
    r'^(?:而且|而|但是|但|可是|却|也|又|还|就|才|再|并且|所以|因而|因此|于是|'
    r'然后|可|便|甚至|并|且|或|或者|以及|及|和|与|同时|接着|后来|想|要|能|会|'
    r'把|被|跟随|从此|只是|不过|然而|否则|即使|虽然|如果|尽管|至于|是)')
# Mid-sentence clause that opens with a verb or a manner adverb, so its
# subject was in the clause that was cut: '拂过妈妈和爸爸的头发。'.
VERB_START = re.compile(
    r'^(?:[拂吸张踩迅陈沾凑合游体有迈收给甩顾封刷到闭泛裂以吃让沿准浩'
    r'默立作希背拔觉熟两刚很摘镌打像遇跟不慢挤用替尊传日笑说厉问喊叫'
    r'看听想要能会把被将向往对从为与和]|[\u4e00-\u9fff]{1,3}地)')
# Ends on a speech verb whose speech was cut:
# '他盯着小葫芦自言自语地说。' lost 「我的小葫芦，快长啊」.
ENDS_ON_SPEECH = re.compile(r'(?:说|道|问|喊|叫|答|讲|嚷|想|曰)[：，。]?$')
# A subordinate clause whose main clause was cut, by its ending
# ('当蒲公英盛开的时候。') or by its opening word ('由于叛徒的出卖。').
DEPENDENT = re.compile(
    r'(?:的时候|时候|之后|以后|之前|以前|的时|后|间|里|中|上|下|地方)。$'
    r'|^(?:当|在|如果|要是|假如|只要|虽然|尽管|即使|因为|由于|为了|自从|每当|'
    r'就在|据|如此|这样|那样|这么|那么|除了|随着|关于|对于|至于|无论|不管|'
    r'通过|经过|按照|根据)')
# Text the source data already had garbled, which a trim would otherwise
# present as clean: an empty quote pair ('“”'), narration glued after a
# colon ('说：的样子'), a word doubled across a page break ('老屋老屋').
GARBLED = re.compile(
    r'“”|‘’|：(?!“|‘)[^，。！？]{0,6}[的地得]'
    r'|([\u4e00-\u9fff]{2})\1(?![\u4e00-\u9fff]?[的地])')


def balanced(s):
    """True when every quote and bracket pair in s has matching counts."""
    return all(s.count(o) == s.count(c) for o, c in PAIRS)


def load_rejects(path=REJECTS_FILE):
    """Trimmed texts a reviewer rejected; one per line, '#' starts a comment."""
    if not os.path.exists(path):
        return frozenset()
    with open(path, encoding='utf-8') as f:
        lines = (line.split('#', 1)[0].strip() for line in f)
        return frozenset(line for line in lines if line)


# ---------------------------------------------------------------------------
# Candidate rules. Each takes a Candidate and returns True to REJECT it.
# Order only affects which name is reported first; all must pass.
# ---------------------------------------------------------------------------

class Candidate:
    """One run of whole clauses cut from a sentence."""

    __slots__ = ('text', 'char', 'from_start', 'to_end')

    def __init__(self, text, char, from_start, to_end):
        self.text = text              # cleaned run, ends with a sentence mark
        self.char = char              # the taught character
        self.from_start = from_start  # run begins where the sentence begins
        self.to_end = to_end          # run ends where the sentence ends


REJECT_RULES = (
    ('missing-char',   lambda c: c.char not in c.text),
    ('too-short',      lambda c: len(c.text) < MIN_LEN),
    ('unbalanced',     lambda c: not balanced(c.text)),
    ('stray-start',    lambda c: bool(STRAY_START.match(c.text))),
    ('fragment-start', lambda c: bool(FRAGMENT_START.match(c.text))),
    ('apparatus',      lambda c: bool(APPARATUS.search(c.text))),
    ('connective',     lambda c: not c.from_start and bool(CONNECTIVE_START.match(c.text))),
    ('no-subject',     lambda c: not c.from_start and bool(VERB_START.match(c.text))),
    ('speech-cut',     lambda c: not c.to_end and bool(ENDS_ON_SPEECH.search(c.text))),
    ('dependent',      lambda c: bool(DEPENDENT.search(c.text))),
    ('garbled',        lambda c: bool(GARBLED.search(c.text))),
)


def rejected_by(cand):
    """Name of the first rule that rejects cand, or None if it passes all."""
    for name, rule in REJECT_RULES:
        if rule(cand):
            return name
    return None


def end_as_sentence(run):
    """Give a run of clauses a sentence ending."""
    run = run.rstrip('，、；：')
    if not run or run[-1] in SENT_END:
        return run
    if run[-1] in CLOSE_MARKS:
        # A closing quote after a complete utterance ('吧！”', '……”') already
        # ends the sentence; one closing a name ('“地毯”') does not.
        inner = run[:-1]
        if inner.endswith('……') or (inner and inner[-1] in SENT_END):
            return run
    return run + '。'


# Outcomes of trim(), in report order.
OK, TRIMMED, REVIEWED_REJECT, CLAUSE_TOO_LONG, NO_CLEAN_CUT = (
    'ok', 'trimmed', 'reviewed-reject', 'clause-too-long', 'no-clean-cut')
OUTCOMES = (OK, TRIMMED, REVIEWED_REJECT, CLAUSE_TOO_LONG, NO_CLEAN_CUT)


def trim(sentence, char, rejects=frozenset()):
    """
    Shorten sentence to at most MAX_LEN characters around char.

    Returns (text, outcome). text is the sentence to use (the original for
    OK) or None when no safe trim exists; outcome is one of OUTCOMES.
    """
    if len(sentence) <= MAX_LEN:
        return sentence, OK
    parts = [p for p in CLAUSE_SPLIT.split(sentence) if p]
    best, best_key = None, None
    for i in range(len(parts)):
        run = ''
        for j in range(i, len(parts)):
            run += parts[j]
            text = end_as_sentence(run)
            if len(text) > MAX_LEN:
                break
            cand = Candidate(text, char, from_start=(i == 0),
                             to_end=(j == len(parts) - 1))
            if rejected_by(cand):
                continue
            # Keeping the sentence's opening keeps its subject; after that,
            # more context is better.
            key = (cand.from_start, len(text))
            if best_key is None or key > best_key:
                best, best_key = text, key
    if best is not None:
        return (None, REVIEWED_REJECT) if best in rejects else (best, TRIMMED)
    holder = next((p for p in parts if char in p), '')
    if len(end_as_sentence(holder)) > MAX_LEN:
        return None, CLAUSE_TOO_LONG
    return None, NO_CLEAN_CUT


def defect(sentence):
    """Name of a defect that needs a different sentence, or None."""
    if APPARATUS.search(sentence):
        return 'apparatus'
    if STRAY_START.match(sentence):
        return 'stray-start'
    if FRAGMENT_START.match(sentence):
        return 'fragment-start'
    return None


# ---------------------------------------------------------------------------
# Data access and CLI
# ---------------------------------------------------------------------------

def load_volumes(pattern=DATA_GLOB):
    """Yield (path, data) for every volume, in a stable order."""
    for path in sorted(glob.glob(pattern)):
        with open(path, encoding='utf-8') as f:
            yield path, json.load(f)


def save_volume(path, data):
    """Write a volume in the repository's JSON style."""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def entries(data):
    """Yield (lesson_id, entry) for every character card with prose."""
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if s and FALLBACK_MARK not in s:
                yield lesson['id'], entry


def write_review(review_dir, rows):
    """One TSV per grade listing what still needs a person."""
    os.makedirs(review_dir, exist_ok=True)
    by_grade = {}
    for lid, entry, problem in rows:
        by_grade.setdefault(lid.split('-')[0], []).append((lid, entry, problem))
    for grade, items in sorted(by_grade.items()):
        path = os.path.join(review_dir, f'grade{grade}.tsv')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('课\t字\t拼音\t字数\t问题\t当前例句\n')
            for lid, entry, problem in items:
                s = entry['sentence']
                f.write(f"{lid}\t{entry['char']}\t{entry.get('pinyin', '')}\t"
                        f"{len(s)}\t{problem}\t{s}\n")
        print(f'  {path}  {len(items)} 行')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--apply', action='store_true', help='write the trims to data/')
    ap.add_argument('--list', choices=OUTCOMES[1:], help='print every sentence with this outcome')
    ap.add_argument('--review-dir', help='write per-grade TSVs of what still needs a person')
    args = ap.parse_args(argv)

    rejects = load_rejects()
    totals = dict.fromkeys(OUTCOMES, 0)
    review = []
    used_rejects = set()
    for path, data in load_volumes():
        changed = False
        for lid, entry in entries(data):
            s = entry['sentence']
            new, outcome = trim(s, entry['char'], rejects)
            totals[outcome] += 1
            if outcome == REVIEWED_REJECT:
                used_rejects.add(trim(s, entry['char'])[0])
            if args.list == outcome:
                print(f"{lid}「{entry['char']}」{len(s)}字  {new or ''}\n    原: {s}")
            if outcome == TRIMMED and args.apply:
                entry['sentence'] = new
                changed = True
            final = new if (outcome == TRIMMED and args.apply) else s
            problem = defect(final) or ('too-long' if len(final) > MAX_LEN else None)
            if problem:
                review.append((lid, entry, problem))
        if changed:
            save_volume(path, data)

    labels = {OK: f'≤{MAX_LEN} 字，不用改', TRIMMED: '截短',
              REVIEWED_REJECT: '人工审阅后否决', CLAUSE_TOO_LONG: '该字所在分句本身超长',
              NO_CLEAN_CUT: '截不出干净的分句'}
    for outcome in OUTCOMES:
        print(f'{labels[outcome]:<14}{totals[outcome]:>5}')
    print(f"{'仍需人工处理':<14}{len(review):>5}")
    # A reject entry that no longer matches any trim is stale: the rules or
    # the data changed. Report it so the file does not silently rot.
    stale = rejects - used_rejects
    if stale:
        print(f'\n⚠️  {len(stale)} entries in {os.path.basename(REJECTS_FILE)} match no trim:')
        for s in sorted(stale):
            print(f'    {s}')
    if args.review_dir:
        write_review(args.review_dir, review)
    if not args.apply:
        print('\n(dry run: pass --apply to write)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
