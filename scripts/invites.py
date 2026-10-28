#!/usr/bin/env python3
"""The invite list in the private repo: invites.json (design §7.5.4).

One file, one place that reads and writes it. build_stories.py uses this
module; nothing else should open invites.json directly.

File format, version 1:
    {
      "format": "hanzigo-invites",
      "version": 1,
      "invites": [
        {
          "id":      "3784dc3c",          # 8 hex chars; the key id inside stories.enc.json
          "code":    "XXXX-XXXX-XXXX",    # the secret; Crockford Base32, formatted
          "name":    "…",                 # who it is for; only here, never in the public repo
          "added":   "2026-10-28",
          "revoked": null,                # or the date it was revoked
          "note":    "…"                  # optional, free text
        }
      ]
    }

Rules (validate() enforces them, so a hand edit cannot break the build):
- ids and codes unique, codes valid (story_crypto.normalize), dates ISO,
  revoked not before added, names non-empty;
- unknown top-level or entry fields are an error, so a typo ("revoke") is
  caught instead of silently ignored. A new field is added here, in
  ENTRY_FIELDS, with a default — that is how the format is extended;
  changing the meaning of a field needs VERSION + 1 and an upgrade in load().

A file without "format"/"version" (written before 2026-10-28 20:55) is
version 0 and is read as version 1.
"""
import datetime
import json
import os
import re

FORMAT = 'hanzigo-invites'
VERSION = 1
ID_RE = re.compile(r'^[0-9a-f]{8}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
# field -> (required, default). Extend the format here.
ENTRY_FIELDS = {
    'id': (True, None),
    'code': (True, None),
    'name': (True, None),
    'added': (True, None),
    'revoked': (False, None),
    'note': (False, ''),
}
TOP_FIELDS = {'format', 'version', 'invites'}


class InvitesError(ValueError):
    """invites.json is not valid. The message never contains a code."""


def empty():
    return {'format': FORMAT, 'version': VERSION, 'invites': []}


def _date(s, what):
    if not isinstance(s, str) or not DATE_RE.match(s):
        raise InvitesError(f'{what}: 日期要写成 YYYY-MM-DD')
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        raise InvitesError(f'{what}: 不是有效日期') from None


def validate(data):
    """Raise InvitesError for anything wrong; return the data with defaults filled."""
    from story_crypto import format_code, normalize   # late: needs the cryptography package
    if not isinstance(data, dict):
        raise InvitesError('invites.json 应该是一个 JSON 对象')
    extra = set(data) - TOP_FIELDS
    if extra:
        raise InvitesError(f'invites.json 有不认识的字段：{sorted(extra)}')
    if data.get('format') != FORMAT or data.get('version') != VERSION:
        raise InvitesError(f'invites.json 的 format/version 应是 {FORMAT}/{VERSION}')
    if not isinstance(data.get('invites'), list):
        raise InvitesError('invites 应该是一个列表')
    ids, codes = set(), set()
    for n, e in enumerate(data['invites'], 1):
        where = f'第 {n} 个邀请（{e.get("id", "?") if isinstance(e, dict) else "?"}）'
        if not isinstance(e, dict):
            raise InvitesError(f'{where}: 应该是一个对象')
        extra = set(e) - set(ENTRY_FIELDS)
        if extra:
            raise InvitesError(f'{where}: 不认识的字段 {sorted(extra)}')
        for field, (required, default) in ENTRY_FIELDS.items():
            if field not in e:
                if required:
                    raise InvitesError(f'{where}: 缺少 {field}')
                e[field] = default
        if not isinstance(e['id'], str) or not ID_RE.match(e['id']):
            raise InvitesError(f'{where}: id 应是 8 位十六进制小写')
        if e['id'] in ids:
            raise InvitesError(f'{where}: id 重复')
        ids.add(e['id'])
        canon = normalize(e['code']) if isinstance(e['code'], str) else ''
        if not canon:
            raise InvitesError(f'{where}: code 不是有效的邀请码')
        if canon in codes:
            raise InvitesError(f'{where}: code 和另一个邀请重复')
        codes.add(canon)
        e['code'] = format_code(canon)
        if not isinstance(e['name'], str) or not e['name'].strip():
            raise InvitesError(f'{where}: name 不能为空')
        added = _date(e['added'], f'{where} added')
        if e['revoked'] is not None and _date(e['revoked'], f'{where} revoked') < added:
            raise InvitesError(f'{where}: revoked 不能早于 added')
        if not isinstance(e['note'], str):
            raise InvitesError(f'{where}: note 应该是文字')
    return data


def load(path):
    """Read and validate; a missing file is an empty list."""
    if not os.path.isfile(path):
        return empty()
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise InvitesError(f'invites.json 不是有效的 JSON（第 {e.lineno} 行）') from None
    if isinstance(data, dict) and 'format' not in data and 'version' not in data:
        data = {'format': FORMAT, 'version': VERSION, **data}   # version 0 → 1
    return validate(data)


def save(data, path):
    """Validate, then write atomically, readable by the owner only."""
    validate(data)
    ordered = {'format': FORMAT, 'version': VERSION,
               'invites': [{k: e[k] for k in ENTRY_FIELDS if k in e and not (k == 'note' and not e[k])}
                           for e in data['invites']]}
    tmp = path + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(ordered, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, path)
    os.chmod(path, 0o600)


def active(data):
    """{id: code} of the invites that are not revoked."""
    return {e['id']: e['code'] for e in data['invites'] if not e.get('revoked')}
