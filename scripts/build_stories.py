#!/usr/bin/env python3
"""Build data/stories.enc.json from the private stories, and manage invite codes (design §7.5.4).

    python3 scripts/build_stories.py                 # check, then encrypt the reviewed stories
    python3 scripts/build_stories.py --add-invite 名字  # new code; writes its card (link + code)
    python3 scripts/build_stories.py --card <id>     # write the card again
    python3 scripts/build_stories.py --revoke <id>   # stop a code (next build); deletes its card
    python3 scripts/build_stories.py --list          # ids, names, dates, status
    python3 scripts/build_stories.py --check         # is data/stories.enc.json up to date? (pre-push)
    python3 scripts/build_stories.py --fixture       # rewrite test/fixtures/stories.enc.json (made-up stories)

The story text and invites.json live in the private repo (scripts/stories_source.py).
Only the encrypted file goes into this public repo. Invite codes are secrets:
they are in invites.json and, for sending, in the card
hanzi-go-stories/cards/<id>.txt (mode 600, gitignored there). They are never
printed: terminal scrollback and logs are not private.

invites.json: format and rules in scripts/invites.py (the only code that reads it).

Exit codes: 0 ok; 1 a check failed or the file is out of date; 2 usage or
setup problem (no private repo, unknown id, no active code).
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import invites as invites_file  # noqa: E402
import stories_source  # noqa: E402

ENC_FILE = os.path.join(stories_source.ROOT, 'data', 'stories.enc.json')
FIXTURE_FILE = os.path.join(stories_source.ROOT, 'test', 'fixtures', 'stories.enc.json')
# The fixture's code is public on purpose: it opens only the made-up stories
# below, and test.html uses it to check that the browser opens what Python seals.
FIXTURE_CODE = 'TEST-2026-0000'
FIXTURE_ITERATIONS = 1000   # keeps the browser test fast; real files use story_crypto.ITERATIONS


def fixture_payload():
    """Made-up stories for the browser tests. Not story text from the private repo."""
    return {
        'characters': {'allow': [{'char': '鹅', 'pinyin': 'é', 'why': '天鹅'}], 'characters': {
            '飞飞': {'icon': 'assets/characters/feifei.svg', 'emoji': '👦', 'text': '测试用的男孩。', 'readings': {}},
            '小天': {'icon': 'assets/characters/xiaotian.svg', 'emoji': '🦢', 'text': '测试用的天鹅。', 'readings': {}}}},
        'volumes': [
            {'grade': 1, 'semester': 1, 'stories': [
                {'lesson': '1-1-31', 'title': '测试一', 'style': 'misunderstanding', 'theme': 'curious.why',
                 'mood': 'funny', 'cast': ['飞飞', '小天'], 'allow': [],
                 'pages': [{'text': '飞飞看见小天。'}, {'text': '小天说：你好！'}],
                 'readings': {}, 'reviewed': {'by': '测试'}}]},
            {'grade': 1, 'semester': 2, 'stories': [
                {'lesson': '1-2-26', 'title': '测试二', 'style': 'half-right', 'theme': 'curious.why',
                 'mood': 'funny', 'cast': ['飞飞'], 'allow': [],
                 'pages': [{'text': '飞飞找到一支笔。'}], 'readings': {}, 'reviewed': {'by': '测试'}},
                {'lesson': '1-2-27', 'title': '没审过', 'style': 'guess', 'theme': 'curious.why',
                 'mood': 'funny', 'cast': ['飞飞'], 'allow': [],
                 'pages': [{'text': '这篇还没审。'}], 'readings': {}, 'reviewed': {'by': ''}}]}]}


def write_fixture(path=FIXTURE_FILE):
    """Seal the made-up stories with FIXTURE_CODE (unreviewed one included on
    purpose: the browser must drop it)."""
    c = crypto()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c.write(path, c.seal(fixture_payload(), {'te57c0de': FIXTURE_CODE}, iterations=FIXTURE_ITERATIONS))
    print(f'✅ {os.path.relpath(path, stories_source.ROOT)}（测试码 {FIXTURE_CODE}，只能打开编的故事）')
    return 0
SITE = 'https://learning-hub-ai.github.io/hanzi-go/'


def crypto():
    """story_crypto, imported late: only building needs the cryptography package."""
    import story_crypto
    return story_crypto


# ---------- what goes into the file ----------

def payload(d=None):
    """The decrypted content of the file: the intros and every reviewed story.

    Same shape the app used to fetch: {"characters": <characters.json>,
    "volumes": [<volume file without unreviewed stories>, ...]}. Volumes with
    no reviewed story are left out, so the file says nothing about them.
    """
    volumes = []
    for _, data in stories_source.load_volumes(d):
        reviewed = [st for st in data.get('stories') or [] if (st.get('reviewed') or {}).get('by')]
        if reviewed:
            volumes.append({**data, 'stories': reviewed})
    return {'characters': stories_source.load_characters(d), 'volumes': volumes}


# ---------- invites.json ----------

def load_invites(path=None):
    """The validated invite list (scripts/invites.py); empty when there is no file."""
    return invites_file.load(path or stories_source.invites_file())


def save_invites(data, path=None):
    invites_file.save(data, path or stories_source.invites_file())


def active_codes(invites):
    """{id: code} for the codes that are not revoked."""
    return invites_file.active(invites)


def add_invite(invites, name, today=None, note=''):
    """Add a new invite and return it. The name stays in invites.json only."""
    name = (name or '').strip()
    if not name:
        raise ValueError('需要一个名字（只记在私有仓库里，用来认出是谁）')
    if any(i['name'] == name and not i.get('revoked') for i in invites['invites']):
        raise ValueError(f'「{name}」已经有一个有效的邀请码；要换码请先 --revoke 旧的')
    c = crypto()
    taken = {c.normalize(i['code']) for i in invites['invites']}
    code = c.new_code()
    while c.normalize(code) in taken:      # 2^60 codes: practically never loops
        code = c.new_code()
    entry = {'id': c.new_key_id({i['id'] for i in invites['invites']}), 'code': code,
             'name': name, 'added': (today or datetime.date.today()).isoformat(), 'revoked': None,
             'note': (note or '').strip()}
    invites['invites'].append(entry)
    return entry


def revoke(invites, kid, today=None):
    for i in invites['invites']:
        if i['id'] == kid:
            i['revoked'] = i.get('revoked') or (today or datetime.date.today()).isoformat()
            return i
    raise KeyError(kid)


def invite_link(code):
    """The link to send: the code after #, so it never reaches a server."""
    return f'{SITE}#invite={code}'


def card_text(entry):
    """What to send a parent for one invite: the link, the code, how to use them."""
    return (f"小故事邀请码：{entry['name']}（编号 {entry['id']}，{entry['added']}）\n"
            f"\n"
            f"发给家长的链接：{invite_link(entry['code'])}\n"
            f"手动输入的码：{entry['code']}\n"
            f"\n"
            f"用法：点链接即可开启；添加到主屏幕的用户，请在 App 里点右上角头像 →\n"
            f"「谁来学习？」底部「🔑 小故事邀请码」，输入上面的 12 位码。\n")


def card_path(kid, d=None):
    return os.path.join(stories_source.cards_dir(d), f'{kid}.txt')


def write_card(entry, d=None):
    """Write the card for an active invite (mode 600, its folder 700). Returns the path."""
    if entry.get('revoked'):
        raise ValueError(f"{entry['id']} 已取消，不能再发")
    folder = stories_source.cards_dir(d)
    os.makedirs(folder, mode=0o700, exist_ok=True)
    os.chmod(folder, 0o700)
    path = card_path(entry['id'], d)
    tmp = path + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(card_text(entry))
    os.replace(tmp, path)
    return path


def remove_card(kid, d=None):
    """Delete the card of a revoked code, so a dead code cannot be sent by mistake."""
    try:
        os.remove(card_path(kid, d))
        return True
    except FileNotFoundError:
        return False


# ---------- build and check ----------

def private_repo_state(d=None):
    """(commit, dirty) of the private repo, or (None, None) when it is not a git repo."""
    repo = stories_source.repo_dir(d)
    try:
        commit = subprocess.run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'],
                                capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', repo, 'status', '--porcelain', '--', 'stories'],
                               capture_output=True, text=True, check=True).stdout.strip()
        return commit, bool(dirty)
    except (OSError, subprocess.CalledProcessError):
        return None, None


def run_checker():
    """The story checker must pass before anything is published."""
    import check_stories
    return check_stories.main(['--check']) == 0


def build(out=ENC_FILE, d=None, invites_path=None, iterations=None, allow_dirty=False):
    """Encrypt the reviewed stories for every active code. Returns an exit code."""
    if not stories_source.available(d):
        print(f'❌ {stories_source.missing_message()}', file=sys.stderr)
        return 2
    commit, dirty = private_repo_state(d)
    if dirty and not allow_dirty:
        print('❌ 私有仓库的 stories/ 有未提交的改动；先在 hanzi-go-stories 里提交，再打包'
              '（这样每次发布都对得上是哪一版）', file=sys.stderr)
        return 2
    if not run_checker():
        print('❌ 故事检查没通过，没有打包', file=sys.stderr)
        return 1
    codes = active_codes(load_invites(invites_path))
    if not codes:
        print('❌ 没有有效的邀请码：先 --add-invite <名字>', file=sys.stderr)
        return 2
    c = crypto()
    content = payload(d)
    kwargs = {'iterations': iterations} if iterations else {}
    c.write(out, c.seal(content, codes, **kwargs))
    n = sum(len(v['stories']) for v in content['volumes'])
    print(f'✅ {os.path.relpath(out, stories_source.ROOT)}：{n} 篇故事，{len(codes)} 个有效邀请码'
          + (f'，故事版本 {commit}' if commit else ''))
    return 0


def check(enc_path=ENC_FILE, d=None, invites_path=None):
    """0 when the encrypted file opens with an active code and holds exactly the
    current reviewed stories; 1 when it is missing, stale or opens with a revoked code."""
    if not stories_source.available(d):
        print(f'⚠️ {stories_source.missing_message()}；跳过密文检查')
        return 0
    if not os.path.isfile(enc_path):
        print('❌ 没有 data/stories.enc.json：python3 scripts/build_stories.py', file=sys.stderr)
        return 1
    c = crypto()
    with open(enc_path, encoding='utf-8') as f:
        enc = json.load(f)
    invites = load_invites(invites_path)
    codes = active_codes(invites)
    if not codes:
        print('❌ 没有有效的邀请码', file=sys.stderr)
        return 1
    try:
        content = c.open_file(enc, next(iter(codes.values())))
    except c.BadCode:
        print('❌ 密文用现在的邀请码打不开（换过邀请码？）：python3 scripts/build_stories.py', file=sys.stderr)
        return 1
    problems = []
    if content != payload(d):
        problems.append('密文过期：故事改过，还没重新打包')
    if {k['id'] for k in enc['keys']} != set(codes):
        problems.append('密文里的邀请码和 invites.json 不一致（加了或取消了邀请码？）')
    if problems:
        for p in problems:
            print(f'❌ {p}', file=sys.stderr)
        print('   重新打包：python3 scripts/build_stories.py', file=sys.stderr)
        return 1
    print(f'✅ 密文是最新的（{len(codes)} 个有效邀请码）')
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--add-invite', metavar='NAME', help='add an invite code for NAME and print the link')
    g.add_argument('--revoke', metavar='ID', help='revoke the invite with this id (deletes its card)')
    g.add_argument('--card', metavar='ID', help='write the card to send for this invite again')
    g.add_argument('--list', action='store_true', help='list invites (codes are not shown)')
    g.add_argument('--check', action='store_true', help='is data/stories.enc.json up to date?')
    g.add_argument('--fixture', action='store_true', help='rewrite test/fixtures/stories.enc.json')
    ap.add_argument('--note', default='', help='with --add-invite: a free-text note kept in invites.json')
    ap.add_argument('--allow-dirty', action='store_true', help='build even with uncommitted story changes')
    args = ap.parse_args(argv)

    try:
        return _run(args)
    except invites_file.InvitesError as err:
        # A broken invites.json fails the build and the pre-push check alike.
        print(f'❌ {err}', file=sys.stderr)
        return 1 if args.check else 2


def _run(args):
    if args.check:
        return check()
    if args.fixture:
        return write_fixture()
    if not stories_source.available():
        print(f'❌ {stories_source.missing_message()}', file=sys.stderr)
        return 2
    if args.list:
        for i in load_invites()['invites']:
            state = f"已取消 {i['revoked']}" if i.get('revoked') else '有效'
            print(f"{i['id']}  {i['added']}  {state:<14} {i['name']}" + (f"  （{i['note']}）" if i.get('note') else ''))
        if not load_invites()['invites']:
            print('（还没有邀请码：--add-invite <名字>）')
        return 0
    if args.add_invite:
        inv = load_invites()
        try:
            e = add_invite(inv, args.add_invite, note=args.note)
        except ValueError as err:
            print(f'❌ {err}', file=sys.stderr)
            return 2
        save_invites(inv)
        path = write_card(e)
        print(f"✅ 新邀请码 {e['id']}（{e['name']}）。重新打包后生效：python3 scripts/build_stories.py")
        print(f"   要发的链接和码在：{path}")
        return 0
    if args.card:
        entry = next((i for i in load_invites()['invites'] if i['id'] == args.card), None)
        if not entry:
            print(f'❌ 没有这个编号：{args.card}（--list 查看）', file=sys.stderr)
            return 2
        try:
            path = write_card(entry)
        except ValueError as err:
            print(f'❌ {err}', file=sys.stderr)
            return 2
        print(f"✅ {entry['id']}（{entry['name']}）的链接和码在：{path}")
        return 0
    if args.revoke:
        inv = load_invites()
        try:
            e = revoke(inv, args.revoke)
        except KeyError:
            print(f'❌ 没有这个编号：{args.revoke}（--list 查看）', file=sys.stderr)
            return 2
        save_invites(inv)
        gone = '，卡片已删除' if remove_card(e['id']) else ''
        print(f"✅ 已取消 {e['id']}（{e['name']}）{gone}。重新打包后生效：python3 scripts/build_stories.py")
        return 0
    return build(allow_dirty=args.allow_dirty)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
