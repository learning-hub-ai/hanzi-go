#!/bin/bash
# ============================================
# HanziGo Pre-Push Check
# Run this before pushing: ./pre-push.sh
# Or set as git hook (see below)
# ============================================

cd "$(dirname "$0")"
echo "🧪 Running HanziGo pre-push checks..."
echo "=================================================="

# Use the project's .venv when there is one. `git push` runs this hook with
# the shell git inherited, so plain `python3` can be the system interpreter
# (3.6 here) without pypinyin: the 多音字 check then skipped itself silently
# and the recorded-syllable check failed the push outright, while the same
# script passed when run by hand from an activated venv.
if [ -x .venv/bin/python3 ]; then
  python3() { .venv/bin/python3 "$@"; }
fi

# Run Python test suite
python3 -c "
import json, re, os

passed = 0
failed = 0
errors = []

def test(name, condition, error_msg=''):
    global passed, failed, errors
    if condition:
        passed += 1
    else:
        failed += 1
        errors.append(f'  ❌ {name} — {error_msg}')

# 1. Data files
all_chars = []
for grade in range(1, 10):
    for sem in [1, 2]:
        fname = f'data/grade{grade}-semester{sem}.json'
        if not os.path.exists(fname): continue
        with open(fname) as f: data = json.load(f)
        for lesson in data['lessons']:
            for c in lesson['chars']:
                all_chars.append(c)

test('Data: chars loaded', len(all_chars) > 100, f'Only {len(all_chars)}')
missing = sum(1 for c in all_chars if not c.get('char') or len(c['char'])!=1 or not c.get('pinyin') or not c.get('words') or not c.get('sentence'))
test('Data: all fields present', missing == 0, f'{missing} chars with missing fields')
not_in_sent = sum(1 for c in all_chars if c['char'] not in c.get('sentence',''))
test('Data: char in sentence', not_in_sent == 0, f'{not_in_sent} chars not in sentence')

# 2. HTML IDs
with open('index.html') as f: html = f.read()
critical_ids = ['flashcard','cardChar','favBtn','btnPrev','btnNext','btnFlip','btnSpeak','btnReinforce','learnMode','challengeMode','lessonFilter','quizTypeSelector','quizOptions','btnPlayAgain','streakNumber','btnProfile','btnFavorites','btnBadges','sidebar']
html_ids = set(re.findall(r'id=\"([^\"]+)\"', html))
missing_ids = [i for i in critical_ids if i not in html_ids]
test('HTML: critical IDs', len(missing_ids)==0, f'Missing: {missing_ids}')

# 3. JS syntax (braces balanced)
for f in ['js/constants.js','js/state.js','js/data.js','js/services.js','js/ui.js','js/controllers.js']:
    with open(f) as fh: js = fh.read()
    test(f'JS: {f} braces', js.count('{')==js.count('}'), f'{js.count(\"{\")} vs {js.count(\"}\")}')

# 4. Dynamic HTML IDs
with open('js/controllers.js') as f: ctrl = f.read()
dynamic_ids = set(re.findall(r'id=\"([^\"]+)\"', ctrl))
dyn_critical = ['flashcard','cardChar','btnPrev','btnNext','btnFlip','btnSpeak','btnReinforce','lessonFilter','quizTypeSelector']
missing_dyn = [i for i in dyn_critical if i not in dynamic_ids]
test('JS: dynamic HTML IDs', len(missing_dyn)==0, f'Missing: {missing_dyn}')

# 5. No dead code
all_js = ''
for f in ['js/constants.js','js/state.js','js/data.js','js/services.js','js/ui.js','js/controllers.js']:
    with open(f) as fh: all_js += fh.read()
dead = ['semesterStrip','favCardCount','errCardCount','lessonIndicator','flipHint','btnRandom','_showShuffleFeedback']
found_dead = [r for r in dead if r in all_js]
test('Clean: no dead refs', len(found_dead)==0, f'Found: {found_dead}')
test('Clean: no console.log', all_js.count('console.log')==0, f'{all_js.count(\"console.log\")} found')

# 6. Badges
with open('js/services.js') as f: svc = f.read()
badge_ids = re.findall(r\"id: '([^']+)'\", svc)
test('Badges: 11 defined', len(badge_ids)==11, f'Found {len(badge_ids)}')

# 7. Config valid
test('Config: valid JSON', True if json.load(open('config.json')) else False)

# Report
print()
if errors:
    for e in errors: print(e)
print()
print(f'Results: {passed} passed, {failed} failed')
if failed > 0:
    print('❌ FIX ISSUES BEFORE PUSHING')
    exit(1)
else:
    print('✅ All checks passed — safe to push!')
    exit(0)
"

EXIT_CODE=$?
echo "=================================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Ready to push!"
else
    echo "❌ Fix the issues above before pushing."
    exit 1
fi

# === Additional: Clickability checks ===
python3 -c "
import re, sys

with open('css/style.css') as f: css = f.read()
with open('index.html') as f: html = f.read()

issues = []

# Interactive elements must exist
interactive = ['lessonFilter','btnPrev','btnNext','btnFlip','btnSpeak','btnReinforce','btnPlayAgain','btnErrorReview','btnProfile','btnFavorites','btnBadges','btnPinyinToggle','favBtn','quizTimerSelect']
html_ids = set(re.findall(r'id=\"([^\"]+)\"', html))
missing = [i for i in interactive if i not in html_ids]
if missing: issues.append(f'Missing interactive elements: {missing}')

# No justify-content:center on learnMode/challengeMode (causes overlap)
if re.search(r'#learnMode[^{]*\{[^}]*justify-content:\s*center', css):
    issues.append('#learnMode has justify-content:center — blocks dropdown clicks')

# z-index: card-container must be lower than controls and content-header
z_map = {m.group(1): int(m.group(2)) for m in re.finditer(r'([.#][\w-]+)\{[^}]*z-index:\s*(\d+)', css)}
if z_map.get('.content-header', 99) <= z_map.get('.card-container', 0):
    issues.append('content-header z-index too low (dropdown hidden behind card)')

if issues:
    print('❌ Clickability issues:')
    for i in issues: print(f'  {i}')
    sys.exit(1)
else:
    print('✅ Clickability: all interactive elements accessible')
" || exit 1

# === Additional: Service Worker check ===
python3 -c "
import sys
with open('sw.js') as f: sw = f.read()
if 'CACHE_VERSION' not in sw:
    print('❌ sw.js missing CACHE_VERSION')
    sys.exit(1)
if 'stale-while-revalidate' not in sw.lower() and 'fetch' not in sw:
    print('❌ sw.js missing fetch handler')
    sys.exit(1)
print('✅ Service Worker: valid')
" || exit 1

# === Additional: type scale discipline (source-level) ===
# The in-browser guard in test.html can only see elements that are actually
# rendered, so a one-off size on a screen that isn't mounted at page load
# (dt-step-title, modals, the quiz view) slips past it. This reads the
# stylesheet directly so every rule is covered regardless of what's on
# screen. Display sizes above the scale's top step are art, not text, and
# are exempt — as are the two 800-weight display numerals.
python3 -c "
import re, sys
css = open('css/style.css').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)       # comments
css = re.sub(r':root\s*\{.*?\}', '', css, flags=re.S)  # token definitions

SCALE = {10, 11, 12, 13, 14, 16, 18, 24, 32}
TOP = max(SCALE)
EXEMPT_SIZE = {
    '.fav-btn', '.streak-fire', '.modal-item .char-display',
    # The 🔥 grows with the streak tier — same emoji-as-icon exemption as
    # the base .streak-fire rule above, sized to match the stats row art
    # rather than to sit in the text hierarchy.
    '.streak-fire.streak-warm', '.streak-fire.streak-mid', '.streak-fire.streak-hot',
    '.avatar-picker button', '.mobile-bottom-bar button',
    '.dt-step-icon', '.dt-setup-grade-icon',
    '.dt-setup-lesson-icon', '.mobile-sheet-item-icon', '.profile-avatar',
    '.profile-item .avatar', '.sidebar-grade-icon', '.sidebar-item-icon',
    '.sidebar-group-arrow', '.sidebar-grade-arrow', '.mobile-grade-arrow',
    '.profile-item .edit-icon', '.modal-close', '.profile-panel-close',
    '.stroke-panel-close', '.rep-day-mark', '.header-right button',
    '.card-pinyin-back', '.end-score',
}
EXEMPT_WEIGHT = {'.card-pinyin-back', '.end-score'}

bad = []
cur = '?'
for line in css.split('\n'):
    m = re.match(r'^\s*([^{}]+?)\s*\{', line)
    if m: cur = m.group(1).strip()
    for px in re.findall(r'font-size:\s*(\d+)px', line):
        if cur in EXEMPT_SIZE: continue
        n = int(px)
        if n <= TOP and n not in SCALE:
            bad.append(f'{cur}: font-size:{n}px — use a --text-* token')
    for w in re.findall(r'font-weight:\s*(\d+)', line):
        if cur in EXEMPT_WEIGHT: continue
        bad.append(f'{cur}: font-weight:{w} — use a --weight-* token')

if bad:
    print('❌ Type scale violations:')
    for b in bad: print(f'  {b}')
    sys.exit(1)
print('✅ Type scale: all sizes and weights use tokens')
" || exit 1

# === Additional: colour token discipline (source-level) ===
# 31 places were hardcoding the brand purple instead of using a token:
# 14 rgba(79,70,229,α) tints at 7 alphas, 10 near-identical pale purples
# that resolve to only 3 distinguishable values, and 7 literal repeats of
# the token values. That is why changing the accent colour was a 34-place
# edit rather than a 3-line one. Keep it that way: every purple must come
# from the ramp. Checked at source level so rules on screens that aren't
# mounted at page load are covered too.
python3 -c "
import re, sys
css = open('css/style.css').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)        # comments
body = re.sub(r':root\s*\{.*?\}', '', css, flags=re.S)  # token definitions

# Any literal that is recognisably the brand purple or a tint of it.
PURPLE = re.compile(
    r'#(?:4f46e5|818cf8|3730a3|4338ca|6366f1|7c3aed|'
    r'eef2ff|e0e7ff|c7d2fe|eff0ff|eff6ff|f5f3ff|fafafe|fbfbfe|'
    # current cobalt ramp: a literal copy of a token value is the same
    # drift the guard exists to stop
    r'3056d3|6578de|2644a8|1b317b|f2f4fd|e3e8fb|c4cef6|9aabed)'
    r'|rgba\(\s*(?:79\s*,\s*70\s*,\s*229|48\s*,\s*86\s*,\s*211)', re.I)

bad, cur = [], '?'
for line in body.split('\n'):
    m = re.match(r'^\s*([^{}]+?)\s*\{', line)
    if m: cur = m.group(1).strip()
    if PURPLE.search(line):
        bad.append(f'{cur}: {PURPLE.search(line).group(0)} — use a --primary-* token')

if bad:
    print('❌ Hardcoded brand colour outside the token block:')
    for b in bad: print(f'  {b}')
    sys.exit(1)
print('✅ Colour tokens: no hardcoded brand colour')
" || exit 1

# === Additional: the stylesheet parses as balanced rules ===
# An orphaned declaration block — a '{ ... }' body whose selector line is
# missing — sat above .quiz-timer-select from the very first commit, leaving
# the file one brace short. CSS parsers recover silently, so nothing broke
# visibly and nothing caught it for the whole life of the project. Counting
# braces is crude but would have caught it on day one.
python3 -c "
import re, sys
css = open('css/style.css').read()
body = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
opens, closes = body.count('{'), body.count('}')
if opens != closes:
    print(f'❌ css/style.css braces unbalanced: {opens} open, {closes} close')
    print('  A declaration block is missing its selector, or a rule is unclosed.')
    sys.exit(1)

# A '}' followed by a declaration before any selector means a block lost its
# selector line — the exact shape of the bug above.
stripped = '\n'.join(l for l in body.split('\n') if l.strip())
orphan = re.search(r'\}\s*\n\s*[-a-z]+\s*:[^;\n]+;', stripped)
if orphan:
    print('❌ css/style.css has a declaration outside any rule:')
    print(f'  {orphan.group(0)[:70].strip()}')
    sys.exit(1)
print(f'✅ Stylesheet: {opens} rules, braces balanced, no orphaned blocks')
" || exit 1

# === Additional: every loaded script is in the offline cache manifest ===
# A script that index.html loads but sw.js doesn't pre-cache breaks the app
# offline — and for js/error-log.js, which loads first, it would break the
# whole page. Caught by hand when that file was added; checked from now on.
python3 -c "
import re, sys
html = open('index.html').read()
sw = open('sw.js').read()
loaded = re.findall(r'<script src=\"(js/[^\"]+)\"', html)
missing = [s for s in loaded if f'./{s}' not in sw and f\"'{s}'\" not in sw]
if missing:
    print('❌ Scripts loaded by index.html but not in sw.js STATIC_ASSETS:')
    for m in missing: print(f'  {m} — add it to STATIC_ASSETS and bump CACHE_VERSION')
    sys.exit(1)
print(f'✅ Offline cache: all {len(loaded)} scripts are pre-cached')
" || exit 1

# === Additional: no 生字表 rows masquerading as example sentences ===
# A user found 蹄 in 六年级上册《草原》 carrying the sentence
# "毯玻璃裳虹蹄腐稍微今年的丁香花似乎开得格外茂盛。" — that is the lesson's
# own 生字表 row, which the textbook PDF lays out as spaced single characters
# (毯 玻 璃 裳 虹 蹄 腐 稍 微). The extractor stripped spaces before splitting
# on punctuation, so the row collapsed into one punctuation-free run and glued
# onto the 课后练习 line that follows it. 175 sentences across 44 lessons were
# affected, in 7 of the 18 data files.
#
# Checked against the data rather than the generator because most generators
# were never committed (only gen_g2s1.py is in the repo), so the data files are
# effectively hand-maintained and a bad sentence can only be caught here.
python3 -c "
import json, glob, os, re, sys

INSTRUCTION = re.compile(
    r'(朗读课文|默读课文|分角色朗读|朗读并背诵|背诵课文|背诵第|抄写下来|抄写句子'
    r'|字词句运用|交流平台|初试身手|词句段运用|日积月累|读一读|写一写|想一想'
    r'|不要指读|注意读好|注意对话|有感情地朗读|读出自己的感受|选做'
    r'|我爱阅读|快乐读书吧|和大人一起读|比一比|填一填|连一连|数一数'
    r'|拓展活动|口语交际|识字加油站|语文园地|讲给别人听'
    r'|识字表|写字表|词语表|不计入生字总数)'
)

bad = []
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        chars = {c['char'] for c in lesson['chars']}
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if not s:
                continue
            why = ''
            # Section heading or exercise glued onto the text.
            if INSTRUCTION.search(s):
                why = 'teaching apparatus'
            # Three or more typeset lines joined into one 'sentence'.
            elif s.count('\n') >= 2:
                why = 'joined lines'
            else:
                run = 0
                for ch in s:
                    if ch in chars:
                        run += 1
                    else:
                        break
                # A long opening run of the lesson's own 生字 is the 生字表
                # fingerprint. Four or five alone is not enough:
                # 一二三四五，金木水火土。 legitimately opens with five.
                if run >= 6:
                    why = 'character-list row'
            if why:
                bad.append(f\"{path.split('/')[-1]} {lesson['id']} {entry['char']} [{why}]: {s[:30]}\")

# Poem titles and author attributions glued to the verse, e.g.
# '山 行[唐] 杜 牧远上寒山石径斜' — which reads as though the poet were
# called 杜牧远. Checked separately because the fix is to strip the prefix
# (tidy_sentences.py), not to find a different sentence.
decor = []
DECOR = re.compile(r'[◇◆◎※*△▲□■●•]')
ATTRIB = re.compile(r'[\[［【][\u4e00-\u9fff]{1,3}[\]］】]')
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if ATTRIB.search(s) or DECOR.search(s):
                decor.append(f\"{path.split('/')[-1]} {lesson['id']} {entry['char']}: {s[:34]}\")
if decor:
    print(f'❌ {len(decor)} sentence(s) carry a title/author/editorial prefix:')
    for b in decor[:10]:
        print(f'  {b}')
    print('  Fix: python3 scripts/tidy_sentences.py --apply')
    sys.exit(1)

# Unbalanced quotation marks. 163 sentences carried a lone “ or ” because the
# textbook sets dialogue across typeset lines and the extraction kept only one
# half: '“嘿，我回来啦。' lost both the closing quote and '桑娜！”'. Deleting
# the stray mark alone would leave a sentence that reads fine but is not what
# the book says, so the missing half is recovered from the PDF.
quotes = []
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if s.count('\u201c') != s.count('\u201d'):
                quotes.append(f\"{path.split('/')[-1]} {lesson['id']} {entry['char']}: {s[:34]}\")
if quotes:
    print(f'❌ {len(quotes)} sentence(s) have unbalanced quotation marks:')
    for b in quotes[:10]:
        print(f'  {b}')
    if len(quotes) > 10:
        print(f'  ... and {len(quotes) - 10} more')
    print('  Fix: python3 scripts/fix_quotes.py --apply')
    sys.exit(1)

# The 多音字 table must stay in step with the data it was generated from.
# 爪 is annotated zhuǎ but every TTS engine says zhǎo for the bare
# character, so Speech.speakChar() reads such characters inside a word that
# selects the right reading. A card whose pinyin changed, or a newly added
# 多音字, silently loses that correction unless the table is regenerated.
het_path = 'data/heteronyms.json'
if not os.path.exists(het_path):
    print(f'❌ {het_path} is missing — 多音字 would be mispronounced')
    print('  Fix: python3 scripts/gen_heteronyms.py')
    sys.exit(1)
het = json.load(open(het_path))
# A character can legitimately carry different readings in different
# lessons (答 is dā in 1-1-36's 回答 but dá elsewhere), so the table is
# keyed by word, not by character alone, and the check has to ask whether
# any card justifies each mapping — not whether every card agrees with it.
justified = {}
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            ch, want = entry['char'], (entry.get('pinyin') or '').strip()
            if not want:
                continue
            for word in (entry.get('words') or []):
                if isinstance(word, str) and ch in word:
                    justified.setdefault((ch, word), set()).add(want)
stale = []
for ch, mapping in het.items():
    for word, reading in mapping.items():
        seen = justified.get((ch, word))
        if not seen:
            stale.append(f'{ch}: table maps {word} but no card pairs them')
        elif reading not in seen:
            cards = '/'.join(sorted(seen))
            stale.append(f'{ch}: table says {word}={reading}, cards say {cards}')
if stale:
    print(f'❌ {len(stale)} 多音字 table entries disagree with the data:')
    for b in stale[:10]:
        print(f'  {b}')
    print('  Fix: python3 scripts/gen_heteronyms.py')
    sys.exit(1)

# The table must not claim a word produces a reading it does not have.
# Matching tone-insensitively equates hē with hè, which is how 喝水 (hē)
# came to be listed for a card annotated hè — the player then spoke '喝水'
# for a character the card says is read hè. Tone may only be ignored when
# the annotation itself is neutral (written without a mark, as 爪子's zi).
#
# This needs a pronunciation source, so it runs only where pypinyin is
# installed (the dev venv). Skipped elsewhere rather than failing, since
# gen_heteronyms.py already enforces the rule at generation time.
TONE_MARKS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'
try:
    from pypinyin import pinyin as _py, Style as _St

    def _word_reading(word, char):
        # Only Hanzi runs go to pypinyin: it collapses a punctuation run into
        # one entry, which shifts every syllable after it. Mirrors
        # reading_of() in scripts/gen_heteronyms.py.
        for run in re.findall(r'[\u4e00-\u9fff]+', word):
            syl = [s[0] for s in _py(run, style=_St.TONE, heteronym=False)]
            if len(syl) != len(run):
                continue
            for c, p in zip(run, syl):
                if c == char:
                    return p
        return None

    toned = []
    for ch, mapping in het.items():
        for word, reading in mapping.items():
            if not any(c in TONE_MARKS for c in reading):
                continue  # neutral-tone annotation; tone difference expected
            actual = _word_reading(word, ch)
            if actual and actual != reading:
                toned.append(f'{ch}: {word} mapped to {reading} but reads {actual}')
    if toned:
        print(f'❌ {len(toned)} 多音字 mappings claim a reading the word lacks:')
        for b in toned[:10]:
            print(f'  {b}')
        print('  Fix: python3 scripts/gen_heteronyms.py')
        sys.exit(1)
except ImportError:
    pass

# Word-fallback sentences ('试一试 · 考试') are a last resort for characters
# the textbook only prints in a 生字表 or 词语表, never in prose. They are
# legitimate but weak — a child sees two words instead of a sentence — so the
# count must not creep back up. 40 remain, all verified as having no usable
# sentence anywhere in their volume.
FALLBACK_BUDGET = 40
fallbacks = []
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            if ' · ' in (entry.get('sentence') or ''):
                fallbacks.append(lesson['id'] + ' ' + entry['char'])
if len(fallbacks) > FALLBACK_BUDGET:
    print(f'❌ {len(fallbacks)} word-fallback sentences, budget is {FALLBACK_BUDGET}:')
    for b in fallbacks[:10]:
        print(f'  {b}')
    print('  A new fallback means a real sentence was replaced by two words.')
    print('  Fix: recover the sentence from the PDF, or lower the budget if')
    print('       the character genuinely has no prose example.')
    sys.exit(1)

# Sentences longer than shorten_sentences.MAX_LEN are hard for a child to
# take in at a glance (parent feedback). The script trims them to whole
# clauses; the ones it cannot trim safely stay and need a person to pick a
# different sentence from the PDF. The count may only go down: lower
# LONG_BUDGET whenever some are fixed.
sys.path.insert(0, 'scripts')
from shorten_sentences import MAX_LEN as LONG_LIMIT
LONG_BUDGET = 387
long_ones = []
for path in sorted(glob.glob('data/grade*.json')):
    data = json.load(open(path))
    for lesson in data['lessons']:
        for entry in lesson['chars']:
            s = entry.get('sentence') or ''
            if ' · ' not in s and len(s) > LONG_LIMIT:
                long_ones.append(lesson['id'] + ' ' + entry['char'] + ' ' + str(len(s)))
if len(long_ones) > LONG_BUDGET:
    print(f'❌ {len(long_ones)} sentences over {LONG_LIMIT} characters, budget is {LONG_BUDGET}:')
    for b in long_ones[:10]:
        print(f'  {b}')
    print('  Fix: python3 scripts/shorten_sentences.py --apply,')
    print(f'       or pick a sentence of at most {LONG_LIMIT} characters from the PDF.')
    sys.exit(1)

# Restored: b3ec230 dropped this header, which left the report below inside
# the fallback-budget branch, so unusable sentences were never reported.
if bad:
    print(f'❌ {len(bad)} example sentence(s) are not usable prose:')
    for b in bad[:12]:
        print(f'  {b}')
    if len(bad) > 12:
        print(f'  ... and {len(bad) - 12} more')
    print('  Fix: python3 scripts/fix_polluted_sentences.py --apply')
    print('   or: python3 scripts/tidy_sentences.py --apply')
    sys.exit(1)
print('✅ Example sentences: usable prose, no 生字表 rows or exercise text')
" || exit 1

# Unit tests for the sentence trimmer. They include a check that the data is
# already in the state the script produces.
python3 scripts/test_shorten_sentences.py 2>/dev/null \
  && echo "✅ Sentence trimmer: unit tests pass" \
  || { echo "❌ Sentence trimmer tests failed: python3 scripts/test_shorten_sentences.py"; exit 1; }

# Recorded syllables: every syllable in the index has its file, there are no
# stray files, and the list of characters that use them matches the data.
# A listed-but-missing file makes a card try a 404 before falling back to
# TTS; a stale character list silently gives a changed card the wrong audio.
python3 scripts/gen_syllable_audio.py --check < /dev/null \
  || { echo "  Fix: python3 scripts/gen_syllable_audio.py"; exit 1; }
