#!/usr/bin/env python3
"""
Build audio/syllables/ — a recorded, toned syllable for each card's reading.

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

Processing: trimmed of leading/trailing silence, normalised to -16 LUFS in
two passes (the source peaks at only 0.07–0.39 of full scale, far quieter
than TTS), peak-limited, faded at both ends (no click), mono 44.1 kHz
48 kbps MP3 — about 7 KB a syllable.

Output
------
audio/syllables/<syllable>.mp3   e.g. zhi4.mp3, zhua3.mp3
audio/syllables/index.json       {"scope", "chars", "syllables", "unavailable", "source"}
The index lists exactly the files present; the app plays a recording only
for a syllable in it, so a missing file cannot mean a silent card.

Usage
-----
    python3 scripts/gen_syllable_audio.py              # build what is missing
    python3 scripts/gen_syllable_audio.py --check      # verify, write nothing
    python3 scripts/gen_syllable_audio.py --all-cards  # switch to every card
    python3 scripts/gen_syllable_audio.py --poly-only  # switch back to 多音字 only

The scope (all cards or 多音字 only) is saved in the index, so a plain run
or --check afterwards keeps it; pass a flag only to change it.

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

# Which cards get a recording. Stored in the index as "scope".
SCOPE_POLY = 'poly'   # only 多音字 (the first rollout)
SCOPE_ALL = 'all'     # every card
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
# Fade both ends after trimming. Trimming stops at the first sample above
# the threshold, so 905 of 1050 clips ended mid-waveform (last 2 ms up to
# 46% of peak), which plays as a click. 5 ms in keeps the consonant attack;
# 30 ms out is shorter than any vowel's natural decay.
FADE = 'afade=t=in:d=0.005,areverse,afade=t=in:d=0.03,areverse'
# Output format. 44.1 kHz / 48 kbps keeps fricatives (s, x, c, q, z) up to
# ~10 kHz, close to the source; 24 kHz / 32 kbps cut them at ~7.8 kHz and
# made 四, 洗, 词 dull. Costs about 2 KB a syllable.
SAMPLE_RATE = '44100'
BITRATE = '48k'


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
             '-af', f'{TRIM},volume={gain:.2f}dB,{LIMIT},{FADE}', '-ac', '1', '-ar', SAMPLE_RATE,
             '-c:a', 'libmp3lame', '-b:a', BITRATE, '-map_metadata', '-1', dest],
            check=True, stdin=subprocess.DEVNULL, timeout=60)
    finally:
        os.unlink(src.name)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='verify only')
    scope = ap.add_mutually_exclusive_group()
    scope.add_argument('--all-cards', action='store_const', dest='scope', const=SCOPE_ALL,
                       help='every card')
    scope.add_argument('--poly-only', action='store_const', dest='scope', const=SCOPE_POLY,
                       help='only 多音字 cards')
    args = ap.parse_args()

    # The scope is stored in the index, so a later plain run or --check
    # (pre-push) uses the same one; a flag only changes it on purpose.
    previous = _read_index().get('scope', SCOPE_POLY)
    current = args.scope or previous
    if args.check and args.scope and args.scope != previous:
        print(f'❌ index was built for scope "{previous}", not "{args.scope}"')
        return 1

    need, chars = needed_syllables(current == SCOPE_ALL)
    os.makedirs(OUT_DIR, exist_ok=True)
    have = {f[:-4] for f in os.listdir(OUT_DIR) if f.endswith('.mp3')}

    if args.check:
        return check(need, chars, have, current)

    # Files no card needs any more (a pinyin was corrected, say) are
    # removed, so the directory always equals the index.
    for syl in sorted(have - set(need)):
        os.unlink(os.path.join(OUT_DIR, syl + '.mp3'))
        have.discard(syl)

    made, missing = 0, []
    for syl in sorted(need):
        dest = os.path.join(OUT_DIR, syl + '.mp3')
        if syl in have:
            continue
        raw = fetch(syl)
        if raw is None:
            missing.append(syl)
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
            'scope': current,
            'note': ('chars: the characters that use these recordings; every other card keeps '
                     'online TTS. unavailable: syllables those cards need that the source lacks.'),
            'chars': chars,
            'syllables': recorded,
            'unavailable': sorted(missing),
        }, f, ensure_ascii=False, indent=1)
        f.write('\n')
    size = sum(os.path.getsize(os.path.join(OUT_DIR, s + '.mp3')) for s in recorded)
    print(f'{len(recorded)}/{len(need)} syllables recorded ({made} new), {size / 1e6:.2f} MB')
    print(f'{len(missing)} without a recording — these cards keep online TTS:')
    print('  ' + ' '.join(f'{s}({need[s]})' for s in missing))
    return 0


def _mp3_format(path):
    """
    (sample_rate, bitrate_kbps) of an MP3, read with no dependencies so
    --check runs anywhere. Skips an ID3 tag and LAME's Xing/Info frame (a
    silent first frame whose header bitrate is not the stream's). None if
    no audio frame is found.
    """
    with open(path, 'rb') as f:
        data = f.read(8192)
    i = 0
    if data[:3] == b'ID3' and len(data) >= 10:
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        i = 10 + size
    rates = {0: 44100, 1: 48000, 2: 32000}
    kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    while i + 4 <= len(data):
        b1, b2 = data[i + 1], data[i + 2]
        # sync word, MPEG-1, Layer III
        if data[i] == 0xFF and (b1 & 0xFE) == 0xFA:
            rate, rate_kbps = rates.get((b2 >> 2) & 3), kbps[b2 >> 4]
            if not rate or not rate_kbps:
                i += 1
                continue
            frame_len = 144000 * rate_kbps // rate + ((b2 >> 1) & 1)
            if b'Xing' in data[i:i + 64] or b'Info' in data[i:i + 64]:
                i += frame_len
                continue
            return rate, rate_kbps
        i += 1
    return None


def _quality_problems(files):
    """
    Audible-quality checks on the built files. Format is always checked;
    loudness, peak and end clicks need ffmpeg and are skipped without it
    (pre-push on a machine with only pypinyin still gets the format check).
    """
    problems = []
    want_rate, want_kbps = int(SAMPLE_RATE), int(BITRATE.rstrip('k'))
    wrong = [os.path.basename(p) for p in files if _mp3_format(p) != (want_rate, want_kbps)]
    if wrong:
        problems.append(f'{len(wrong)} file(s) not {want_rate} Hz / {want_kbps} kbps: {wrong[:5]}')
    try:
        ffmpeg = _ffmpeg_if_available()
    except Exception:
        ffmpeg = None
    if not ffmpeg:
        return problems
    loud, peaky, clicky = [], [], []
    for p in files:
        name = os.path.basename(p)
        # Whole-file loudness and peak.
        r = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', p, '-af', 'ebur128,volumedetect',
                            '-f', 'null', '-'], capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=60).stderr
        lufs = re.findall(r'I:\s+(-?[\d.]+) LUFS', r)
        peak = re.findall(r'max_volume: (-?[\d.]+) dB', r)
        # Peak of the last 2 ms (reverse, keep the first 2 ms), in a separate
        # run: two volumedetect filters in one chain report unreliably.
        t = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', p, '-af',
                            'areverse,atrim=end=0.002,volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60).stderr
        tail = re.findall(r'max_volume: (-?[\d.]+) dB', t)
        if lufs and abs(float(lufs[-1]) - TARGET_LUFS) > 3:
            loud.append(f'{name} {float(lufs[-1]):.1f} LUFS')
        if peak and float(peak[0]) > -1.0:
            peaky.append(f'{name} {float(peak[0]):.1f} dBFS')
        # last 2 ms within 26 dB (5 %) of the clip's peak = audible click
        if peak and tail and float(tail[0]) - float(peak[0]) > -26:
            clicky.append(name)
    if loud:
        problems.append(f'{len(loud)} file(s) more than 3 LU from {TARGET_LUFS} LUFS: {loud[:5]}')
    if peaky:
        problems.append(f'{len(peaky)} file(s) peak above -1 dBFS: {peaky[:5]}')
    if clicky:
        problems.append(f'{len(clicky)} file(s) end abruptly (click): {clicky[:5]}')
    return problems


def _ffmpeg_if_available():
    """ffmpeg path, or None when imageio-ffmpeg is not installed."""
    try:
        import imageio_ffmpeg
    except ImportError:
        return None
    return imageio_ffmpeg.get_ffmpeg_exe()


def _read_index():
    """The current index, or {} before the first build."""
    try:
        with open(INDEX_PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def check(need, chars, have, scope):
    """
    Verify the shipped audio against the data without downloading anything.

    Every syllable the cards need must be either recorded or listed as
    unavailable, and every file must pass _quality_problems(). Without that, a corrected pinyin (to a syllable the source
    does have) would silently leave the card on TTS until someone happened
    to rerun the build. Exit status 1 on any mismatch.
    """
    index = _read_index()
    listed = set(index.get('syllables', []))
    unavailable = set(index.get('unavailable', []))
    problems = []
    if index.get('chars') != chars:
        problems.append('index.chars is out of date with the data')
    if listed - have:
        problems.append(f'index lists syllables with no file: {sorted(listed - have)[:10]}')
    if have - listed:
        problems.append(f'files not in the index: {sorted(have - listed)[:10]}')
    unaccounted = sorted(set(need) - listed - unavailable)
    if unaccounted:
        problems.append(f'cards need syllables the build has not seen: {unaccounted[:10]}')
    stale = sorted((listed | unavailable) - set(need))
    if stale:
        problems.append(f'index has syllables no card needs: {stale[:10]}')
    problems += _quality_problems(sorted(os.path.join(OUT_DIR, s + '.mp3') for s in listed & have))
    if problems:
        for p in problems:
            print(f'❌ {p}')
        return 1
    print(f'✅ scope "{scope}": {len(listed)} recorded syllables, {len(unavailable)} unavailable (TTS), index matches data')
    return 0


if __name__ == '__main__':
    sys.exit(main())
