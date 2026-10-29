#!/usr/bin/env python3
"""
Check that every card's pinyin is the book's (the 识字表 of grades 1–5).

    python3 scripts/check_book_pinyin.py

The textbook PDFs are not in the repo (copyright): ./keben, or KEBEN_DIR.
Without them (or without pdftotext) the check is skipped with a note, so a clone without the books
can still push: the data itself is only changed on a machine that has them.
Exit status 1 if a card differs from the book.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book_pinyin as B  # noqa: E402

REPO_ROOT = B.REPO_ROOT
VOLUMES = [(g, s) for g in range(1, 6) for s in (1, 2)]


def main():
    """Compare grades 1–5 with the books; 0 when they agree or the books are absent."""
    why = B.available()
    if why:
        print(f'⏭️  注音对照课本：跳过（{why}）')
        return 0
    bad, missing, n = [], [], 0
    for g, s in VOLUMES:
        data = json.load(open(os.path.join(REPO_ROOT, 'data', f'grade{g}-semester{s}.json'), encoding='utf-8'))
        n += sum(len(l['chars']) for l in data['lessons'])
        d, m = B.compare(g, s, data['lessons'])
        bad += d
        missing += m
    if missing:
        print(f'❌ {len(missing)} 课在课本识字表里找不到：{"、".join(missing)}')
    if bad:
        print(f'❌ {len(bad)} 张卡片的注音和课本识字表不同：')
        for lid, ch, card, book in bad:
            print(f'  {lid} {ch}  卡片 {card}  课本 {book}')
        print('  修法：注音改成课本的，再换读这个音的组词和例句（python3 scripts/check_word_readings.py）')
    if bad or missing:
        return 1
    print(f'✅ 注音和课本识字表一致：一到五年级 {n} 张卡片')
    return 0


if __name__ == '__main__':
    sys.exit(main())
