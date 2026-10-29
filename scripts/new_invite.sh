#!/usr/bin/env bash
# Give a child a 小故事 invite code, end to end (design §7.5.4).
#
#     scripts/new_invite.sh 名字 [--note 备注] [--no-push]
#
# 1. build_stories.py --add-invite: a new 12-character code (XXXX-XXXX-XXXX)
# 2. commit + push invites.json in the private repo hanzi-go-stories
# 3. re-encrypt data/stories.enc.json, commit + push it here (pre-push runs)
# 4. wait for the site to serve it and check the new code opens it
#
# The link and the code are written to ~/hanzigo-invites/<id>.txt (mode 600)
# and are never printed: terminal scrollback and logs are not private.
# Neither commit message contains the name. --no-push stops after the local
# commits (nothing leaves this machine).
#
# Exit codes: 0 done; 1 a step failed (later steps not run); 2 usage or setup.
set -euo pipefail

cd "$(dirname "$0")/.."
HERE="$PWD"
PRIVATE="${HANZIGO_STORIES:-$(dirname "$HERE")/hanzi-go-stories/stories}"
PRIVATE_REPO="$(dirname "$PRIVATE")"
OUT_DIR="${HANZIGO_INVITE_DIR:-$HOME/hanzigo-invites}"
SITE="https://learning-hub-ai.github.io/hanzi-go"
PY="python3"; [ -x .venv/bin/python3 ] && PY=".venv/bin/python3"
export TMPDIR="$HERE/.tmp"; mkdir -p "$TMPDIR"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
NAME=""; NOTE=""; PUSH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --note) NOTE="${2:-}"; shift 2 ;;
    --no-push) PUSH=0; shift ;;
    -h|--help) usage ;;
    -*) echo "❌ 不认识的参数：$1" >&2; usage ;;
    *) [ -z "$NAME" ] || usage; NAME="$1"; shift ;;
  esac
done
[ -n "$NAME" ] || usage

step() { echo; echo "▶ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# ---- preflight: both repos clean and on main, so the commits hold only this change
[ -d "$PRIVATE_REPO/.git" ] || { echo "❌ 找不到私有仓库：$PRIVATE_REPO" >&2; exit 2; }
for repo in "$HERE" "$PRIVATE_REPO"; do
  [ "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" = main ] || { echo "❌ $repo 不在 main 分支" >&2; exit 2; }
  [ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] \
    || { echo "❌ $repo 有未提交的改动，先处理再发码" >&2; exit 2; }
done

# ---- 1. the code (the CLI prints link + code: capture them into the private file only)
step "1/4 生成邀请码"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
TMP_OUT="$(umask 077; mktemp "$OUT_DIR/.new.XXXXXX")"
ARGS=(--add-invite "$NAME"); [ -n "$NOTE" ] && ARGS+=(--note "$NOTE")
if ! "$PY" scripts/build_stories.py "${ARGS[@]}" > "$TMP_OUT" 2>&1; then
  sed 's/[0-9A-Z]\{4\}-[0-9A-Z]\{4\}-[0-9A-Z]\{4\}/XXXX-XXXX-XXXX/g' "$TMP_OUT" >&2; rm -f "$TMP_OUT"; exit 1
fi
KID="$(grep -o '新邀请码 [0-9a-f]\{8\}' "$TMP_OUT" | awk '{print $2}')"
[ -n "$KID" ] || { rm -f "$TMP_OUT"; fail "没读到新邀请码的编号"; }
CARD="$OUT_DIR/$KID.txt"
{
  echo "小故事邀请码：$NAME（编号 $KID，$(date +%F)）"
  echo
  grep -E '链接|手动输入' "$TMP_OUT" | sed 's/^ *//'
  echo
  echo "用法：点链接即可开启；添加到主屏幕的用户，请在 App 里点右上角头像 →"
  echo "「谁来学习？」底部「🔑 小故事邀请码」，输入上面的 12 位码。"
} > "$CARD"
rm -f "$TMP_OUT"; chmod 600 "$CARD"
echo "✅ 编号 $KID；链接和码写在 $CARD（只有你能读）"

# ---- 2. private repo: the invite list
step "2/4 私有仓库：提交 invites.json"
git -C "$PRIVATE_REPO" add invites.json
git -C "$PRIVATE_REPO" commit -q -m "邀请码：新增一个试读（$KID）" -m "GEN: AUTO"
if [ "$PUSH" = 1 ]; then
  git -C "$PRIVATE_REPO" push -q origin main || fail "私有仓库推送失败；本地已提交，可稍后 git push"
fi
echo "✅ hanzi-go-stories $(git -C "$PRIVATE_REPO" log --oneline -1)"

# ---- 3. the encrypted file
step "3/4 重新打包并提交 data/stories.enc.json"
"$PY" scripts/build_stories.py || fail "打包失败"
"$PY" scripts/build_stories.py --check || fail "打包后检查失败"
git add data/stories.enc.json
git commit -q -m "小故事：更新密文（新增邀请码 $KID）" -m "GEN: AUTO"
if [ "$PUSH" = 1 ]; then
  git push -q origin main || fail "hanzi-go 推送失败（pre-push 没过？）；本地已提交"
fi
echo "✅ hanzi-go $(git log --oneline -1)"

# ---- 4. the site serves it, and the new code opens it
if [ "$PUSH" = 0 ]; then
  echo; echo "⏸  --no-push：都只提交在本地。推送后网站才会有这个码。"; exit 0
fi
step "4/4 等网站更新（GitHub Pages 通常 1 分钟内）"
for i in $(seq 1 30); do
  if curl -sf "$SITE/data/stories.enc.json?n=$RANDOM" -o "$TMPDIR/live.enc.json" \
     && "$PY" - "$TMPDIR/live.enc.json" "$PRIVATE_REPO/invites.json" "$KID" <<'PY'
import json, sys
sys.path.insert(0, 'scripts')
import invites, story_crypto
enc = json.load(open(sys.argv[1]))
code = next(e['code'] for e in invites.load(sys.argv[2])['invites'] if e['id'] == sys.argv[3])
story_crypto.open_file(enc, code)
PY
  then
    rm -f "$TMPDIR/live.enc.json"
    echo "✅ 网站已更新，新码能打开故事（约 $((i * 10)) 秒）"
    echo; echo "把 $CARD 里的内容发给家长。"
    exit 0
  fi
  sleep 10
done
rm -f "$TMPDIR/live.enc.json"
fail "5 分钟内网站还没更新；稍后用无痕窗口打开链接试试"
