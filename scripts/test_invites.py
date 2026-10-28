#!/usr/bin/env python3
"""Tests for scripts/invites.py (the invite list in the private repo).

    python3 scripts/test_invites.py

Works on files in a temporary folder with made-up codes; never reads the
real invites.json.
"""
import json
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import invites as I  # noqa: E402

CODE_A = 'ABCD-EFGH-JKMN'
CODE_B = 'PQRS-TVWX-YZ23'


def entry(**kw):
    e = {'id': 'a1b2c3d4', 'code': CODE_A, 'name': '甲', 'added': '2026-10-28', 'revoked': None}
    e.update(kw)
    return e


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def doc(*entries):
    return {'format': I.FORMAT, 'version': I.VERSION, 'invites': list(entries)}


class Validate(unittest.TestCase):
    def bad(self, data, words):
        with self.assertRaises(I.InvitesError) as cm:
            I.validate(data)
        self.assertIn(words, str(cm.exception))
        for secret in (CODE_A, CODE_A.replace('-', ''), CODE_B):
            self.assertNotIn(secret, str(cm.exception), 'an error message must not show a code')

    def test_good_file_gets_defaults_and_canonical_codes(self):
        d = I.validate(doc(entry(code='abcd efgh jkmn')))
        self.assertEqual(d['invites'][0]['code'], CODE_A)
        self.assertEqual(d['invites'][0]['note'], '')

    def test_format_and_version(self):
        self.bad({'invites': []}, 'format/version')
        self.bad({**doc(), 'version': 2}, 'format/version')
        self.bad({**doc(), 'extra': 1}, '不认识的字段')

    def test_entry_fields(self):
        self.bad(doc({k: v for k, v in entry().items() if k != 'name'}), '缺少 name')
        self.bad(doc(entry(revoke='2026-10-29')), '不认识的字段')   # a typo is caught
        self.bad(doc(entry(name='  ')), 'name 不能为空')
        self.bad(doc(entry(note=3)), 'note')

    def test_ids_and_codes(self):
        self.bad(doc(entry(id='XYZ')), 'id 应是')
        self.bad(doc(entry(), entry(code=CODE_B)), 'id 重复')
        self.bad(doc(entry(), entry(id='b2c3d4e5', code=CODE_A.lower())), 'code 和另一个邀请重复')
        self.bad(doc(entry(code='nope')), 'code 不是有效的邀请码')
        self.bad(doc(entry(code=None)), 'code 不是有效的邀请码')

    def test_dates(self):
        self.bad(doc(entry(added='28.10.2026')), 'YYYY-MM-DD')
        self.bad(doc(entry(added='2026-02-30')), '不是有效日期')
        self.bad(doc(entry(revoked='2026-10-01')), 'revoked 不能早于 added')
        I.validate(doc(entry(revoked='2026-10-28')))

    def test_active(self):
        d = I.validate(doc(entry(), entry(id='b2c3d4e5', code=CODE_B, name='乙', revoked='2026-10-29')))
        self.assertEqual(I.active(d), {'a1b2c3d4': CODE_A})


class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'invites.json')

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_file_is_empty(self):
        self.assertEqual(I.load(self.path), I.empty())

    def test_round_trip_is_stable_and_owner_only(self):
        d = doc(entry(note='试读'), entry(id='b2c3d4e5', code=CODE_B, name='乙'))
        I.save(d, self.path)
        first = read(self.path)
        I.save(I.load(self.path), self.path)
        self.assertEqual(read(self.path), first, 'load + save changes nothing')
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        saved = json.loads(first)
        self.assertEqual(list(saved), ['format', 'version', 'invites'])
        self.assertEqual(list(saved['invites'][0]), ['id', 'code', 'name', 'added', 'revoked', 'note'])
        self.assertNotIn('note', saved['invites'][1], 'an empty note is not written')
        self.assertFalse(os.path.exists(self.path + '.tmp'))

    def test_version_0_file_is_upgraded(self):
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump({'invites': [entry()]}, f)
        d = I.load(self.path)
        self.assertEqual((d['format'], d['version']), (I.FORMAT, I.VERSION))

    def test_save_refuses_invalid_data_and_keeps_the_old_file(self):
        I.save(doc(entry()), self.path)
        before = read(self.path)
        with self.assertRaises(I.InvitesError):
            I.save(doc(entry(), entry()), self.path)
        self.assertEqual(read(self.path), before)

    def test_broken_json(self):
        with open(self.path, 'w') as f:
            f.write('{"invites": [\n')
        with self.assertRaises(I.InvitesError) as cm:
            I.load(self.path)
        self.assertIn('不是有效的 JSON', str(cm.exception))


if __name__ == '__main__':
    unittest.main(verbosity=1)
