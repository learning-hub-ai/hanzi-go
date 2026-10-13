#!/usr/bin/env python3
"""
Repair example sentences whose quotation marks are unbalanced.

The problem
-----------
163 sentences carry a lone “ or ”, because the textbook sets dialogue across
typeset lines and the original extraction kept only one of them:

    PDF:    “嘿，我回来啦，
            桑娜！”
    data:   '“嘿，我回来啦。'        ← closing quote and 桑娜！ lost

Deleting the stray mark would produce a sentence that reads fine but is not
what the book says, so the missing half has to be recovered from the PDF.

Approach
--------
Flatten the whole book into one string with punctuation intact, locate the
stored fragment inside it, and extend to the real sentence boundary — forward
for a missing ”, backward for a missing “.

Two safety rules, both enforced per sentence:
  * the character being taught must survive in the result
  * the result must be balanced, or the original is kept unchanged

Anything that cannot be located verbatim is left alone and reported, rather
than guessed at.

Usage
-----
    python3 scripts/fix_quotes.py            # report
    python3 scripts/fix_quotes.py --apply
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

CN = re.compile(r'[\u4e00-\u9fff]')
# Pinyin annotation lines, which pdftotext interleaves with the text.
LATIN = re.compile(r'[A-Za-z\u00c0-\u024f]')
OPEN, CLOSE = '“', '”'
SENT_END = '。！？'
MAX_CN = 40          # a card example longer than this is unreadable anyway
MAX_EXTEND = 60      # how far to look for the missing half


def pdf_for(data_file):
    m = re.search(r'grade(\d+)-semester(\d+)', os.path.basename(data_file))
    if not m:
        return None
    grade, sem = int(m.group(1)), int(m.group(2))
    half = "上册" if sem == 1 else "下册"
    hits = sorted(glob.glob(os.path.join(
        KEBEN_DIR, f"语文 统编版 {GRADE_CN[grade]}年级 {half} *.pdf")))
    return hits[0] if hits else None


def flat_text(pdf_path):
    """
    The whole book as one string, punctuation intact.

    Unlike the other scripts here, lines are joined rather than treated
    individually: the whole point is to cross the typeset line break that
    split the sentence in the first place.
    """
    if pdf_path in flat_text._cache:
        return flat_text._cache[pdf_path]
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tmp:
        out = tmp.name
    try:
        subprocess.run(['pdftotext', pdf_path, out],
                       capture_output=True, text=True, check=True)
        raw = open(out, encoding='utf-8').read()
    finally:
        if os.path.exists(out):
            os.unlink(out)
    kept = [l.replace(' ', '').replace('\t', '')
            for l in raw.split('\n') if not LATIN.search(l)]
    text = ''.join(kept)
    flat_text._cache[pdf_path] = text
    return text
flat_text._cache = {}


def _balanced(s):
    return s.count(OPEN) == s.count(CLOSE)


def repair(fragment, book):
    """
    Return a balanced version of `fragment` taken from `book`, or None.

    The fragment is matched verbatim (minus whitespace) so there is no
    guessing about which sentence it came from; only the extension direction
    depends on which mark is missing.
    """
    frag = re.sub(r'\s+', '', fragment)
    if not frag:
        return None
    at = book.find(frag)
    if at < 0:
        return None

    if frag.count(OPEN) > frag.count(CLOSE):
        # Missing ” — extend forward to just past it.
        #
        # Chinese dialogue closes AFTER the sentence punctuation
        # ('你弄错了。”'), so the ” that belongs to this fragment normally
        # sits immediately after a 。！？. Only an intervening *second*
        # sentence means the quote is not ours, so allow the punctuation
        # that ends our own clause and stop if more text follows it.
        tail = book[at + len(frag): at + len(frag) + MAX_EXTEND]
        end = tail.find(CLOSE)
        if end < 0:
            return None
        between = tail[:end]
        # Anything other than closing punctuation/whitespace between the
        # fragment and the quote means the stored sentence stopped early and
        # the real quotation continues — e.g. '小鸟说：“你弄错了。' is
        # followed in the book by '天无边无际，大得很哪！”', so extending
        # would splice in a second sentence. Those are handled by dropping
        # the stray mark instead (see strip_stray).
        if between.strip('。！？…、 \u3000'):
            return None
        cand = frag + tail[:end + 1]
    else:
        # Missing “ — extend backward to it. Mirror of the above: the
        # opening quote is usually right before our text, with at most the
        # previous speaker's closing punctuation in between.
        head = book[max(0, at - MAX_EXTEND): at]
        start = head.rfind(OPEN)
        if start < 0:
            return None
        prefix = head[start:]
        if prefix[1:].strip('。！？…、 \u3000') and any(p in prefix[1:] for p in SENT_END):
            return None
        cand = prefix + frag

    if not _balanced(cand):
        return None
    if len(CN.findall(cand)) > MAX_CN:
        return None
    return cand


def strip_stray(fragment, char=None):
    """
    Second strategy: drop the orphan quotation mark.

    Used when the stored sentence is a genuine excerpt that simply started or
    stopped mid-quotation — extending it would splice in a second sentence
    (see repair's `between` check). Dropping the mark leaves a correct
    sentence that is merely narrower than the book's full quotation, which is
    what an example sentence on a flashcard is anyway.

    `char` is the character the card teaches. When it sits in the narration
    before the quote ('他盯着小葫芦自言自语地说：“我的小葫芦。' teaches 盯),
    keeping the quoted part would lose it, so the narration is kept instead
    and the dangling quotation dropped.
    """
    s = fragment.strip()
    if not s or _balanced(s):
        return None

    if s.count(OPEN) > s.count(CLOSE):
        m = re.match(rf'^(.{{0,16}}?[：:])\s*{OPEN}(.+)$', s, re.S)
        if m:
            lead, quoted = m.group(1).strip(), m.group(2).strip()
            # Prefer whichever side carries the taught character; the quoted
            # speech when both do, since it is the livelier example.
            if char and char in quoted and len(CN.findall(quoted)) >= 4:
                return quoted
            if char and char in lead:
                # Trim the trailing colon — it introduces speech that is no
                # longer there. A lead ending in a speech verb
                # ('…她问话的意思是：') reads as an unfinished thought, so
                # the verb and anything after the last clause boundary go
                # too: '他叹了口气，说：' → '他叹了口气。'
                stem = re.sub(r'[：:]\s*$', '', lead)
                if re.search(r'(是|为|道|说|问|想|叫|喊|答|曰|着)$', stem):
                    # Drop the trailing speech clause and keep what precedes
                    # it, provided the taught character survives there.
                    cut = re.sub(r'[，,][^，,]*$', '', stem)
                    if cut != stem and char in cut and len(CN.findall(cut)) >= 4:
                        return cut + '。'
                    return None
                return stem + '。'
            if len(CN.findall(quoted)) >= 4:
                return quoted
        if s.startswith(OPEN):
            return s[1:].strip() or None
        # Orphan mid-text with no colon to cut at: removing it would change
        # what is being quoted.
        return None

    # Missing “ — the stored text begins after the real opening quote.
    if s.startswith(CLOSE):
        return s[1:].strip() or None
    # A trailing ” with no opener, e.g. '仙人指路”就更有趣了！' — the quoted
    # phrase is at the start, so the mark closes something not present.
    idx = s.find(CLOSE)
    if idx > 0 and s.count(CLOSE) == 1:
        return (s[:idx] + s[idx + 1:]).strip() or None
    return None


def process(data_file, apply_changes, samples, shown):
    data = json.load(open(data_file, encoding='utf-8'))
    pdf = pdf_for(data_file)
    pending = []
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if s and not _balanced(s):
                pending.append((lesson['id'], entry))
    if not pending:
        return 0, 0, shown
    if not pdf:
        print(f"! no PDF for {os.path.basename(data_file)}")
        return 0, len(pending), shown

    book = flat_text(pdf)
    fixed = extended = stripped = 0
    for lid, entry in pending:
        old = entry['sentence']
        # Preferred: recover the missing half from the book.
        new = repair(old, book)
        how = 'extend'
        if not new:
            # Fallback: drop the orphan mark, keeping a narrower but correct
            # sentence rather than leaving a visibly broken one.
            new = strip_stray(old, entry['char'])
            how = 'strip'
        if not new or entry['char'] not in new or not _balanced(new):
            continue
        if shown < samples:
            shown += 1
            print(f"  {lid} 「{entry['char']}」 [{how}]")
            print(f"    - {old!r}")
            print(f"    + {new!r}")
        if apply_changes:
            entry['sentence'] = new
        fixed += 1
        if how == 'extend':
            extended += 1
        else:
            stripped += 1

    if apply_changes and fixed:
        with open(data_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    return fixed, len(pending) - fixed, shown


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--samples', type=int, default=10)
    args = ap.parse_args()

    total_fixed = total_left = 0
    shown = 0
    for path in sorted(glob.glob(os.path.join(REPO_ROOT, 'data', 'grade*.json'))):
        fixed, left, shown = process(path, args.apply, args.samples, shown)
        if fixed or left:
            print(f"{os.path.basename(path)}: {fixed} repaired, {left} unresolved")
        total_fixed += fixed
        total_left += left

    verb = 'repaired' if args.apply else 'would be repaired'
    print(f"\n{total_fixed} {verb}, {total_left} left for manual review")
    if not args.apply:
        print("(dry run — pass --apply to write)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
