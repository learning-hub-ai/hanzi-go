#!/usr/bin/env python3
"""Write docs/story-review.html: every story on one page, for the parent to review.

The page is generated from the private story files (scripts/stories_source.py), so it always shows what the
app shows. It lists the stories by volume with an index, and for each one:
the lesson and its 生字, the cast, the pages (生字 highlighted, the readings
marked on 多音字 when "显示读音" is on), the writing style, mood and review note.

The page goes in docs/, which is gitignored for this file: the stories are not
public (docs/story-reading-design.html §7.4).

Usage: python3 scripts/story_review_page.py [--out PATH]
"""
import argparse
import html
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_stories as C  # noqa: E402  (Textbook, page_chars)
import stories_source  # noqa: E402

# Status labels, from the parent's verdict in the design doc §7.3. A story's
# `review` field may set it; otherwise it is "待审阅" (to review).
STATUS = {
    'liked':   ('喜欢', '#15803d', '#dcfce7'),
    'ok':      ('还行', '#1d4ed8', '#dbeafe'),
    'rewrite': ('需要改进', '#b45309', '#fef3c7'),
    'new':     ('待审阅', '#7c3aed', '#ede9fe'),
}
# The parent's verdict on 2026-10-27, by lesson. Lessons rewritten after that
# and approved are 'liked'; rewrites not yet reviewed are 'new'.
VERDICT = {
    '1-1-28': 'liked', '1-1-20': 'liked', '1-1-27': 'liked', '1-1-23': 'liked',
    '1-1-24': 'ok', '1-1-25': 'ok', '1-1-30': 'ok', '1-1-31': 'ok',
    '1-1-26': 'liked', '1-1-34': 'liked', '1-1-37': 'liked', '1-1-32': 'liked', '1-1-33': 'liked', '1-1-29': 'liked', '1-1-21': 'liked', '1-1-22': 'liked', '1-1-35': 'liked', '1-1-36': 'liked',   # rewritten, approved
}
VOLUME_NAME = {(1, 1): '一年级上册', (1, 2): '一年级下册', (2, 1): '二年级上册', (2, 2): '二年级下册'}
MOOD_NAME = {'funny': '好笑', 'warm': '温暖', 'quiet': '安静', 'tense': '紧张'}


def status_of(story):
    """The review status key for a story: its VERDICT, else 待审阅 (new)."""
    return VERDICT.get(story['lesson'], 'new')


def page_html(story, index, book, new_chars):
    """One story page: each character in a span, 生字 highlighted, readings as ruby."""
    readings = story.get('readings') or {}
    text = story['pages'][index - 1]['text']
    out, n = [], 0
    for ch in text:
        if C.HAN.match(ch):
            n += 1
            key = f'p{index}:{n}'
            cls = 'new' if ch in new_chars else ''
            if key in readings:
                out.append(f'<ruby class="{cls}">{html.escape(ch)}<rt>{html.escape(readings[key])}</rt></ruby>')
            else:
                out.append(f'<span class="{cls}">{html.escape(ch)}</span>' if cls else html.escape(ch))
        else:
            out.append(html.escape(ch))
    return ''.join(out)


def story_html(story, book):
    """A story's card: header, meta line and its numbered pages."""
    lesson = story['lesson']
    new_chars = set(book.new_chars.get(lesson, []))
    key = status_of(story)
    label, fg, bg = STATUS[key]
    counts = []
    for ch in book.new_chars.get(lesson, []):
        k = sum(p['text'].count(ch) for p in story['pages'])
        counts.append(f'<span class="{"" if k >= 2 else "few"}">{html.escape(ch)}×{k}</span>')
    pages = ''.join(f'<li>{page_html(story, i, book, new_chars)}</li>'
                    for i in range(1, len(story['pages']) + 1))
    note = html.escape((story.get('reviewed') or {}).get('note', ''))
    return f'''
<section class="story" id="s-{lesson}" data-status="{key}">
  <h3><span class="badge" style="color:{fg};background:{bg}">{label}</span>
    《{html.escape(story["title"])}》 <small>{lesson} {html.escape(book.lesson_title.get(lesson, ""))}</small></h3>
  <p class="meta">出场：{"、".join(story.get("cast") or [])} ·
    写法 {html.escape(story.get("style", ""))} · 主题 {html.escape(story.get("theme", ""))} ·
    结尾 {MOOD_NAME.get(story.get("mood"), story.get("mood", ""))} · {len(story["pages"])} 页</p>
  <p class="meta">本课生字：{" ".join(counts)}</p>
  <ol class="pages">{pages}</ol>
  <p class="note">{note}</p>
</section>'''


def build(book, volumes):
    """The whole page as a string."""
    index, body = [], []
    for volume, data in volumes:
        stories = sorted(data.get('stories') or [], key=lambda s: book.position.get(s['lesson'], 0))
        if not stories:
            continue
        name = VOLUME_NAME.get(volume, f'{volume[0]}-{volume[1]}')
        links = ''.join(
            f'<li data-status="{status_of(s)}"><a href="#s-{s["lesson"]}">'
            f'<span class="dot" style="background:{STATUS[status_of(s)][1]}"></span>'
            f'《{html.escape(s["title"])}》<small>{s["lesson"][4:]}</small></a></li>' for s in stories)
        index.append(f'<h4>{name}（{len(stories)}）</h4><ul>{links}</ul>')
        body.append(f'<h2>{name}</h2>' + ''.join(story_html(s, book) for s in stories))
    filters = ''.join(f'<label><input type="checkbox" value="{k}" checked> '
                      f'<span class="badge" style="color:{fg};background:{bg}">{label}</span></label>'
                      for k, (label, fg, bg) in STATUS.items())
    when = datetime.now().strftime('%Y-%m-%d %H:%M')
    return f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HanziGo 小故事审阅</title>
<style>
  body{{margin:0;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#f8fafc}}
  nav{{position:fixed;top:0;left:0;bottom:0;width:250px;overflow:auto;background:#fff;border-right:1px solid #e2e8f0;padding:14px;box-sizing:border-box}}
  nav h1{{font-size:17px;margin:0 0 4px}} nav .when{{font-size:12px;color:#94a3b8;margin-bottom:8px}}
  nav h4{{margin:14px 0 4px;color:#1b317b}} nav ul{{list-style:none;padding:0;margin:0}}
  nav li a{{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:6px;color:#1f2937;text-decoration:none;font-size:14px}}
  nav li a:hover{{background:#f1f5f9}} nav small{{color:#94a3b8;margin-left:auto}}
  .dot{{width:9px;height:9px;border-radius:50%;flex:none}}
  .filters label{{display:inline-block;margin:2px 4px 2px 0;font-size:13px;cursor:pointer}}
  .opts{{margin:8px 0;font-size:13px}}
  main{{margin-left:250px;padding:16px 28px;max-width:820px}}
  h2{{color:#1b317b;border-bottom:2px solid #c7d2fe;padding-bottom:4px}}
  .story{{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 18px;margin:14px 0;scroll-margin-top:12px}}
  .story h3{{margin:2px 0 6px;font-size:20px}} .story h3 small{{font-size:13px;color:#64748b;font-weight:400}}
  .badge{{font-size:12px;padding:2px 8px;border-radius:999px;font-weight:600;vertical-align:middle}}
  .meta{{font-size:13px;color:#64748b;margin:2px 0}} .meta .few{{color:#b45309}}
  .pages{{font-size:21px;line-height:1.75;padding-left:2em;margin:10px 0}}
  .pages li::marker{{font-size:13px;color:#94a3b8}}
  .new{{background:#fef9c3;border-radius:3px}}
  rt{{font-size:11px;color:#2563eb;display:none}} body.show-rt rt{{display:ruby-text}}
  .note{{font-size:12px;color:#94a3b8;margin:4px 0 0}}
  @media (max-width:760px){{nav{{position:static;width:auto;border-right:0;border-bottom:1px solid #e2e8f0}} main{{margin-left:0;padding:10px 14px}}}}
  @media print{{nav{{display:none}} main{{margin:0}} .story{{break-inside:avoid}}}}
</style></head>
<body>
<nav>
  <h1>小故事审阅</h1>
  <div class="when">生成于 {when}</div>
  <div class="filters">{filters}</div>
  <div class="opts"><label><input type="checkbox" id="rt"> 显示多音字读音</label></div>
  {"".join(index)}
</nav>
<main>
  <p class="meta">黄色底的是本课生字；本课生字后面的数字是出现次数（橙色＝不到 2 次）。勾选「显示多音字读音」可以核对标过的读音。</p>
  {"".join(body)}
</main>
<script>
  document.getElementById('rt').addEventListener('change', e => document.body.classList.toggle('show-rt', e.target.checked));
  document.querySelectorAll('.filters input').forEach(cb => cb.addEventListener('change', () => {{
    const on = new Set([...document.querySelectorAll('.filters input:checked')].map(x => x.value));
    document.querySelectorAll('[data-status]').forEach(el => {{ el.style.display = on.has(el.dataset.status) ? '' : 'none'; }});
  }}));
</script>
</body></html>
'''


def main(argv):
    """Write the page and print where it went."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--out', default=os.path.join(C.ROOT, 'docs', 'story-review.html'))
    args = ap.parse_args(argv)
    if not stories_source.available():
        print(f'❌ {stories_source.missing_message()}', file=sys.stderr)
        return 1
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(build(C.Textbook(), stories_source.load_volumes()))
    print(f'✅ {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
