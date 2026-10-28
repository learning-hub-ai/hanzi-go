#!/usr/bin/env python3
"""The encrypted story file: format, invite codes, seal and open (design §7.5.5).

This module is the one place that knows the format of data/stories.enc.json.
build_stories.py uses it to write the file; the browser's js/story-unlock.js
reads the same format with WebCrypto, and test.html checks the two agree
using a fixture made here (test/fixtures/stories.enc.json).

Format v1:
    {
      "format": "hanzigo-stories", "v": 1,
      "kdf":  {"name": "PBKDF2", "hash": "SHA-256", "iterations": N, "salt": b64},
      "keys": [{"id": hex8, "iv": b64, "wrapped": b64}, ...],   # one per invite, shuffled
      "data": {"iv": b64, "ct": b64}                            # AES-256-GCM
    }

- One random 256-bit content key encrypts the payload. Each invite code is
  stretched with PBKDF2 (one salt for the whole file, so the browser derives
  once and then tries each wrapped key) into a key that wraps the content
  key with AES-GCM. A new content key, salt and IVs on every build.
- The associated data of every AES-GCM operation is "hanzigo-stories:v1",
  so a file of another format or version does not open.
- The payload is UTF-8 JSON padded with spaces to a multiple of PAD bytes,
  so the size only says "about how much".
"""
import base64
import json
import os
import random
import re
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

FORMAT = 'hanzigo-stories'
VERSION = 1
AAD = f'{FORMAT}:v{VERSION}'.encode()
ITERATIONS = 300_000
PAD = 4096
# Crockford Base32 without I L O U: easy to read aloud and to copy by hand.
ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
CODE_GROUPS, GROUP_LEN = 3, 4                  # XXXX-XXXX-XXXX = 60 bits
_CODE_RE = re.compile(f'^[{ALPHABET}]{{{CODE_GROUPS * GROUP_LEN}}}$')


class BadCode(Exception):
    """The code does not open this file (wrong, revoked, or not a code)."""


def _b64(b):
    return base64.b64encode(b).decode('ascii')


def _unb64(s):
    return base64.b64decode(s.encode('ascii'), validate=True)


def new_code():
    """A fresh random invite code, formatted XXXX-XXXX-XXXX."""
    raw = ''.join(secrets.choice(ALPHABET) for _ in range(CODE_GROUPS * GROUP_LEN))
    return format_code(raw)


def normalize(code):
    """Canonical form of a code as typed: upper case, no spaces or dashes,
    O→0 and I/L→1 (the letters Crockford leaves out). '' if it can't be a code.
    The browser's StoryUnlock.normalize does exactly the same.
    """
    s = re.sub(r'[\s\-_]', '', str(code or '')).upper()
    s = s.replace('O', '0').replace('I', '1').replace('L', '1')
    return s if _CODE_RE.match(s) else ''


def format_code(code):
    """'ABCD1234WXYZ' -> 'ABCD-1234-WXYZ' (input normalized first)."""
    s = normalize(code)
    if not s:
        raise ValueError('not an invite code')
    return '-'.join(s[i:i + GROUP_LEN] for i in range(0, len(s), GROUP_LEN))


def _derive(code, salt, iterations):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(normalize(code).encode('ascii'))


def _pad(raw):
    return raw + b' ' * (-len(raw) % PAD)


def seal(payload, codes, iterations=ITERATIONS):
    """Encrypt `payload` (any JSON value) for each code in `codes`.

    Returns the file as a dict. `codes` maps a key id (short, random, not a
    name) to its invite code; at least one is needed.
    """
    if not codes:
        raise ValueError('no active invite codes: nobody could open the file')
    content_key = AESGCM.generate_key(bit_length=256)
    salt = secrets.token_bytes(16)
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    data_iv = secrets.token_bytes(12)
    keys = []
    for kid, code in codes.items():
        if not normalize(code):
            raise ValueError(f'key {kid}: not an invite code')
        iv = secrets.token_bytes(12)
        wrapped = AESGCM(_derive(code, salt, iterations)).encrypt(iv, content_key, AAD)
        keys.append({'id': kid, 'iv': _b64(iv), 'wrapped': _b64(wrapped)})
    random.SystemRandom().shuffle(keys)   # the order must not show who joined first
    return {
        'format': FORMAT, 'v': VERSION,
        'kdf': {'name': 'PBKDF2', 'hash': 'SHA-256', 'iterations': iterations, 'salt': _b64(salt)},
        'keys': keys,
        'data': {'iv': _b64(data_iv), 'ct': _b64(AESGCM(content_key).encrypt(data_iv, _pad(raw), AAD))},
    }


def open_file(enc, code):
    """Decrypt a file made by seal() with one invite code. Raises BadCode."""
    if not isinstance(enc, dict) or enc.get('format') != FORMAT or enc.get('v') != VERSION:
        raise BadCode('not a v1 story file')
    if not normalize(code):
        raise BadCode('not an invite code')
    try:
        kdf = enc['kdf']
        key = AESGCM(_derive(code, _unb64(kdf['salt']), int(kdf['iterations'])))
        for k in enc['keys']:
            try:
                content_key = key.decrypt(_unb64(k['iv']), _unb64(k['wrapped']), AAD)
                break
            except Exception:   # InvalidTag: not this code's key, try the next
                continue
        else:
            raise BadCode('no key for this code')
        raw = AESGCM(content_key).decrypt(_unb64(enc['data']['iv']), _unb64(enc['data']['ct']), AAD)
        return json.loads(raw.decode('utf-8'))
    except BadCode:
        raise
    except Exception as e:      # tampered or malformed file
        raise BadCode('cannot open') from e


def new_key_id(taken=()):
    """A short random key id, not one of `taken`."""
    while True:
        kid = secrets.token_hex(4)
        if kid not in taken:
            return kid


def write(path, enc):
    """Write the file: stable key order, one trailing newline."""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(enc, f, indent=1)
        f.write('\n')
    os.replace(tmp, path)
