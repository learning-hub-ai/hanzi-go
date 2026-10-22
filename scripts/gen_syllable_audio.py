#!/usr/bin/env python3
"""
Build audio/syllables/ — a recorded, toned syllable for every 多音字 card.

Why
---
Online TTS is only given text. For a 多音字 it guesses the reading, and even
a common reading of a bare character can come out wrong (家长 reported 掷 in
grade 3 and 爪 in grade 1). heteronyms.json works around this by speaking a
word that pins the reading, but only where such a word exists. A recording
of the exact toned syllable on the card (zhì, zhuǎ) is right by
construction, works offline, and does not depend on the two unofficial TTS
endpoints.

Source
------
pffy, github.com/davinfifield/mp3-chinese-pinyin-sound — public domain
(Unlicense). One speaker, one file per toned syllable, numbered tones
(zhi4.mp3). It has no ü syllables at all (lü, nü, lüe) and no neutral tones
(ma5), and lacks a few others. Those cards keep using online TTS: a missing
syllable is never approximated (lu4 is 路, not 绿).

Processing: normalised to -16 LUFS in two passes (the source peaks at only
0.07–0.39 of full scale, far quieter than TTS), trimmed of leading/trailing silence, mono
32 kbps MP3 — about 4 KB a syllable.

Output
------
audio/syllables/<syllable>.mp3   e.g. zhi4.mp3, zhua3.mp3
audio/syllables/index.json       {"chars": "…", "syllables": ["a1", …], "source": …}
The index lists exactly the files present; the app plays a recording only
for a syllable in it, so a missing file cannot mean a silent card.

Usage
-----
    python3 scripts/gen_syllable_audio.py            # build what is missing
    python3 scripts/gen_syllable_audio.py --check    # verify, write nothing
    python3 scripts/gen_syllable_audio.py --all-cards  # every card, not only 多音字

Requires pypinyin; building also needs imageio-ffmpeg (dev only; the app
ships the output).
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request

try:
    from pypinyin import pinyin
except ImportError:
    sys.exit('needs: pip install pypinyin')


def _ffmpeg():
    """Path to ffmpeg. Imported only when building, so --check needs just pypinyin."""
    try:
        import imageio_ffmpeg
    except ImportError:
        sys.exit('building needs: pip install imageio-ffmpeg==0.6.0 (bundles a static ffmpeg)')
    return imageio_ffmpeg.get_ffmpeg_exe()

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, 'audio', 'syllables')
INDEX_PATH = os.path.join(OUT_DIR, 'index.json')
SOURCE_URL = 'https://raw.githubusercontent.com/davinfifield/mp3-chinese-pinyin-sound/master/mp3/{}.mp3'
SOURCE_NAME = 'pffy mp3-chinese-pinyin-sound (Unlicense, public domain)'

TONE_MARKS = {'\u0304': '1', '\u0301': '2', '\u030c': '3', '\u0300': '4'}

# Loudness target. -16 LUFS is the usual level for spoken word on phones and
# close to what the online TTS sources play at, so switching between a
# recording and TTS does not jump in volume.
TARGET_LUFS = -16.0
# Peak ceiling after the gain. MP3 encoding adds overshoot after any
# limiter (measured: -0.5 dBFS out of a -1.5 dB limit), so limit at -3 dB.
LIMIT = 'alimiter=limit=0.708:level=false'
# Trim silence at both ends (reverse, trim leading, reverse back).
TRIM = ('silenceremove=start_periods=1:start_threshold=-45dB,'
        'areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse')


def syllable_key(reading):
    """
    'zhuǎ' → 'zhua3', 'lǜ' → 'lv4', 'de' → 'de5'. Returns None for anything
    that is not one syllable (a multi-syllable reading, empty).

    The same rule is implemented in js/services.js (Speech._syllableKey);
    the two must agree, which the test suite checks on every card.
    """
    r = (reading or '').strip().lower()
    if not r or ' ' in r:
        return None
    tone = '5'
    base = ''
    for ch in unicodedata.normalize('NFD', r):
        if ch in TONE_MARKS:
            tone = TONE_MARKS[ch]
        elif ch == '\u0308':          # combining diaeresis: u + ¨ = ü
            base = base[:-1] + 'v' if base.endswith('u') else base + 'v'
        elif 'a' <= ch <= 'z':
            base += ch
        else:
            return None
    return base + tone if base else None


def needed_syllables(all_cards):
    """
    ({syllable: example character}, characters) for the cards that get a
    recording. `characters` is what the app checks before using one, so
    the choice of cards lives here, in one place.
    """
    need, chars = {}, set()
    for path in sorted(glob.glob(os.path.join(REPO_ROOT, 'data', 'grade*.json'))):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for lesson in data['lessons']:
            for c in lesson['chars']:
                if not all_cards and len(pinyin(c['char'], heteronym=True)[0]) < 2:
                    continue
                chars.add(c['char'])
                k = syllable_key(c.get('pinyin'))
                if k:
                    need.setdefault(k, c['char'])
    return need, ''.join(sorted(chars))


def fetch(syllable):
    """Raw MP3 bytes from the source, or None if it has no such syllable."""
    # pffy writes ü as nothing at all — it has no ü files — so a 'v'
    # syllable is never requested under another spelling.
    if 'v' in syllable or syllable.endswith('5'):
        return None
    try:
        with urllib.request.urlopen(SOURCE_URL.format(syllable), timeout=30) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):      # no such file (pffy answers 400 for some names)
            return None
        raise
    return body if body[:3] == b'ID3' or body[:1] == b'\xff' else None


def _loudness(ffmpeg, path, pre=''):
    """Integrated loudness (LUFS) of path after the optional filter chain pre."""
    chain = f'{pre},ebur128' if pre else 'ebur128'
    r = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', path, '-af', chain, '-f', 'null', '-'],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60)
    found = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    return float(found[-1]) if found else None


def process(raw, dest):
    """
    Trim, normalise and re-encode raw MP3 bytes into dest.

    Two passes. A single loudnorm pass caps how much it will amplify, so a
    one-second clip as quiet as these sources (some at -33 dB mean) came out
    5-9 LU too quiet (peng3 at -24.8 LUFS). Instead: measure the trimmed
    clip, apply the exact gain to reach TARGET_LUFS, and let the limiter
    stop the few loud ones from clipping.
    """
    ffmpeg = _ffmpeg()
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as src:
        src.write(raw)
    try:
        measured = _loudness(ffmpeg, src.name, TRIM)
        gain = 0.0 if measured is None else max(-12.0, min(30.0, TARGET_LUFS - measured))
        # stdin closed: ffmpeg reads the terminal for interactive keys, and
        # with an inherited stdin it waited there forever (a 25-minute hang
        # on the first file). timeout guards any other stall.
        subprocess.run(
            [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src.name,
             '-af', f'{TRIM},volume={gain:.2f}dB,{LIMIT}', '-ac', '1', '-ar', '24000',
             '-c:a', 'libmp3lame', '-b:a', '32k', '-map_metadata', '-1', dest],
            check=True, stdin=subprocess.DEVNULL, timeout=60)
    finally:
        os.unlink(src.name)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='verify only')
    ap.add_argument('--all-cards', action='store_true', help='every card, not only 多音字')
    args = ap.parse_args()

    need, chars = needed_syllables(args.all_cards)
    os.makedirs(OUT_DIR, exist_ok=True)
    have = {f[:-4] for f in os.listdir(OUT_DIR) if f.endswith('.mp3')}

    if args.check:
        index = json.load(open(INDEX_PATH, encoding='utf-8'))
        listed = set(index['syllables'])
        if index.get('chars') != chars:
            print('❌ index.chars is out of date with the data: rerun the script')
            return 1
        problems = sorted(listed - have)
        if problems:
            print(f'❌ index lists {len(problems)} syllable(s) with no file: {problems[:10]}')
            return 1
        extra = sorted(have - listed)
        if extra:
            print(f'❌ {len(extra)} file(s) not in the index: {extra[:10]}')
            return 1
        print(f'✅ {len(listed)} recorded syllables, index matches files')
        return 0

    made, missing = 0, []
    for syl in sorted(need):
        dest = os.path.join(OUT_DIR, syl + '.mp3')
        if syl in have:
            continue
        raw = fetch(syl)
        if raw is None:
            missing.append(f'{syl}({need[syl]})')
            continue
        process(raw, dest)
        have.add(syl)
        made += 1
        if made % 50 == 0:
            print(f'  {made} …')

    recorded = sorted(s for s in have if s in need)
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'source': SOURCE_NAME,
            'note': 'chars: the characters that use these recordings; every other card keeps online TTS.',
            'chars': chars,
            'syllables': recorded,
        }, f, ensure_ascii=False, indent=1)
        f.write('\n')
    size = sum(os.path.getsize(os.path.join(OUT_DIR, s + '.mp3')) for s in recorded)
    print(f'{len(recorded)}/{len(need)} syllables recorded ({made} new), {size / 1e6:.2f} MB')
    print(f'{len(missing)} without a recording — these cards keep online TTS:')
    print('  ' + ' '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
