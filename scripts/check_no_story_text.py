#!/usr/bin/env python3
"""Stop story text from reaching the public repo (design §7.5.10).

    python3 scripts/check_no_story_text.py                 # scan tracked files and HEAD's unpushed commits
    python3 scripts/check_no_story_text.py < push-ranges   # as the git pre-push hook: ranges on stdin

Checks, in order:
1. No plain story file is tracked (data/stories/*.json, or any *.json with a
   "stories" list and story pages). Only data/stories.enc.json may be.
2. When the private story text is on this machine: no run of NGRAM Chinese
   characters from any story page or cast intro, and no story title in
   《》, appears in a tracked file, or in the diff or message of a commit
   being pushed.
3. Without the private text only check 1 runs, and it says so.

Push ranges: git gives the hook one line per ref,
"<local ref> <local sha> <remote ref> <remote sha>". Commits in
<remote sha>..<local sha> are scanned; for a new branch (remote sha all
zeros), every commit not yet on any remote branch. Run by hand (no stdin),
the range is @{upstream}..HEAD, or every commit not on a remote branch.

Known coincidences (a story reuses a textbook sentence) go in ALLOWED with a
reason. Exit codes: 0 clean, 1 story text found.
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stories_source  # noqa: E402

NGRAM = 6
HAN_RUN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff]+')
ZERO = '0' * 40
# Story n-grams that are also, legitimately, in public files. Each needs a reason.
ALLOWED = {
    '我们快回家吧': 'a 课本 example sentence (data/grade1-semester2.json) that a story also uses',
}
# The encrypted file: base64 cannot contain Chinese, so it is skipped only to
# save reading 40 KB; check 1 lets it through as the one allowed story file.
SKIP_FILES = {'data/stories.enc.json'}


def git(*args, check=True):
    return subprocess.run(['git', '-C', stories_source.ROOT, *args],
                          capture_output=True, text=True, check=check).stdout


def secrets_from_stories(d=None):
    """(ngrams, titles) taken from every story page and intro."""
    grams, titles = set(), set()

    def add(text):
        for run in HAN_RUN.findall(text or ''):
            for i in range(len(run) - NGRAM + 1):
                grams.add(run[i:i + NGRAM])

    for st in stories_source.all_stories(d):
        if st.get('title'):
            titles.add(st['title'])
        add(st.get('title'))
        for p in st.get('pages') or []:
            add(p.get('text'))
    chars = stories_source.load_characters(d) or {}
    for c in (chars.get('characters') or {}).values():
        add(c.get('text'))
    return grams - set(ALLOWED), titles


def find(text, grams, titles):
    """Sorted story n-grams and 《titles》 found in `text`."""
    hits = {g for g in grams if g in text}
    hits |= {f'《{t}》' for t in titles if f'《{t}》' in text}
    return sorted(hits)


def plain_story_files(files):
    """Tracked paths that look like plain story data."""
    out = []
    for f in files:
        if f in SKIP_FILES or not f.endswith('.json'):
            continue
        if f.startswith('data/stories/'):
            out.append(f)
            continue
        try:
            with open(os.path.join(stories_source.ROOT, f), encoding='utf-8') as fh:
                head = fh.read(200000)
        except (OSError, UnicodeDecodeError):
            continue
        if '"stories"' in head and '"pages"' in head and '"reviewed"' in head:
            out.append(f)
    return out


def push_ranges(stdin_lines):
    """git rev-list arguments for the commits being pushed."""
    ranges = []
    for line in stdin_lines:
        parts = line.split()
        if len(parts) != 4:
            continue
        _, local, _, remote = parts
        if local == ZERO:          # deleting a branch: nothing is sent
            continue
        ranges.append([local, '--not', '--remotes'] if remote == ZERO else [f'{remote}..{local}'])
    return ranges


def default_range():
    up = subprocess.run(['git', '-C', stories_source.ROOT, 'rev-parse', '--verify', '-q', '@{upstream}'],
                        capture_output=True, text=True)
    return [['@{upstream}..HEAD']] if up.returncode == 0 else [['HEAD', '--not', '--remotes']]


def commits(ranges):
    shas = []
    for r in ranges:
        shas += [s for s in git('rev-list', *r).split() if s not in shas]
    return shas


def main(argv, stdin=None):
    files = [f for f in git('ls-files', '-z').split('\0') if f]
    problems = []
    for f in plain_story_files(files):
        problems.append(f'故事原文文件被 git 跟踪：{f}（只允许 data/stories.enc.json）')

    if not stories_source.available():
        print(f'⚠️ 原文检查跳过：{stories_source.missing_message()}；只查了有没有明文故事文件')
        return report(problems)

    grams, titles = secrets_from_stories()
    for f in files:
        if f in SKIP_FILES:
            continue
        try:
            with open(os.path.join(stories_source.ROOT, f), encoding='utf-8') as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError):
            continue          # binary files (audio, images)
        hits = find(text, grams, titles)
        if hits:
            problems.append(f'{f}：含故事原文 {"、".join(hits[:5])}' + (' …' if len(hits) > 5 else ''))

    try:
        interactive = stdin is None or stdin.isatty()
    except (AttributeError, ValueError):
        interactive = False
    lines = [] if interactive else stdin.read().splitlines()
    ranges = push_ranges(lines) if lines else default_range()
    for sha in commits(ranges):
        msg = git('log', '-1', '--format=%B', sha)
        diff = git('show', '--format=', '--no-color', '--unified=0', sha, '--', '.', ':!data/stories.enc.json')
        added = '\n'.join(l[1:] for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++'))
        for where, text in (('提交说明', msg), ('改动', added)):
            hits = find(text, grams, titles)
            if hits:
                problems.append(f'提交 {sha[:7]} 的{where}：含故事原文 {"、".join(hits[:5])}'
                                + (' …' if len(hits) > 5 else ''))
    return report(problems)


def report(problems):
    if problems:
        print('❌ 故事原文不能进公开仓库（design §7.5）：')
        for p in problems:
            print('   ' + p)
        return 1
    print('✅ 公开仓库里没有故事原文')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:], sys.stdin))
