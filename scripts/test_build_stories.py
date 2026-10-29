#!/usr/bin/env python3
"""Tests for scripts/story_crypto.py and scripts/build_stories.py.

    python3 scripts/test_build_stories.py

Uses made-up stories in temporary folders and a low PBKDF2 count, so it is
fast and never reads the real stories. Needs the cryptography package (.venv).
"""
import base64
import copy
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_stories as B  # noqa: E402
import invites as I  # noqa: E402
import story_crypto as K  # noqa: E402
import stories_source as S  # noqa: E402

FAST = 1000          # PBKDF2 iterations in tests; the format records the count
CODE_A = 'ABCD-EFGH-JKMN'
CODE_B = 'PQRS-TVWX-YZ23'
SECRET_NAME = '测试孩子'


def fake_payload():
    return {'characters': {'characters': {'飞飞': {'text': '一个好朋友。'}}},
            'volumes': [{'grade': 1, 'semester': 1, 'stories': [
                {'lesson': '1-1-31', 'title': '编的题目', 'pages': [{'text': '飞飞和小天去玩。'}],
                 'reviewed': {'by': '家长'}}]}]}


class Codes(unittest.TestCase):
    def test_new_codes_are_well_formed_and_differ(self):
        a, b = K.new_code(), K.new_code()
        self.assertRegex(a, r'^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$')
        self.assertNotEqual(a, b)

    def test_normalize_forgives_how_people_type(self):
        self.assertEqual(K.normalize(' abcd efgh-jkmn '), 'ABCDEFGHJKMN')
        self.assertEqual(K.normalize('0OIL-1111-2222'), '001111112222', 'O→0, I/L→1')
        self.assertEqual(K.format_code('abcdefghjkmn'), 'ABCD-EFGH-JKMN')

    def test_normalize_rejects_non_codes(self):
        for bad in ('', None, 'ABCD-EFGH', 'ABCD-EFGH-JKMNP', 'ABCD-EFGH-JKM!', 'ABCD-EFGH-JKMU'):
            self.assertEqual(K.normalize(bad), '', bad)


class SealOpen(unittest.TestCase):
    def seal(self, codes=None, payload=None):
        return K.seal(payload or fake_payload(), codes or {'a1': CODE_A, 'b2': CODE_B}, iterations=FAST)

    def test_round_trip_with_each_code_and_any_spelling(self):
        enc = self.seal()
        self.assertEqual(K.open_file(enc, CODE_A), fake_payload())
        self.assertEqual(K.open_file(enc, CODE_B), fake_payload())
        self.assertEqual(K.open_file(enc, CODE_A.lower().replace('-', ' ')), fake_payload())

    def test_wrong_code_and_non_code_fail(self):
        enc = self.seal()
        with self.assertRaises(K.BadCode):
            K.open_file(enc, 'ZZZZ-ZZZZ-ZZZZ')
        with self.assertRaises(K.BadCode):
            K.open_file(enc, 'hello')

    def test_a_code_left_out_cannot_open(self):
        enc = self.seal({'a1': CODE_A})
        with self.assertRaises(K.BadCode):
            K.open_file(enc, CODE_B)

    def test_any_changed_byte_fails(self):
        enc = self.seal()
        for path in (('data', 'ct'), ('data', 'iv'), ('kdf', 'salt')):
            bad = copy.deepcopy(enc)
            raw = bytearray(base64.b64decode(bad[path[0]][path[1]]))
            raw[len(raw) // 2] ^= 1
            bad[path[0]][path[1]] = base64.b64encode(bytes(raw)).decode()
            with self.assertRaises(K.BadCode, msg=path):
                K.open_file(bad, CODE_A)

    def test_other_version_or_iterations_fail(self):
        enc = self.seal()
        with self.assertRaises(K.BadCode):
            K.open_file({**enc, 'v': 2}, CODE_A)
        with self.assertRaises(K.BadCode):
            K.open_file({**enc, 'kdf': {**enc['kdf'], 'iterations': FAST + 1}}, CODE_A)

    def test_every_build_is_new(self):
        a, b = self.seal(), self.seal()
        self.assertNotEqual(a['data']['ct'], b['data']['ct'])
        self.assertNotEqual(a['kdf']['salt'], b['kdf']['salt'])

    def test_file_reveals_no_names_titles_lessons_or_codes(self):
        p = fake_payload()
        p['characters']['characters']['飞飞']['text'] = SECRET_NAME
        text = json.dumps(self.seal(payload=p), ensure_ascii=False)
        for secret in (SECRET_NAME, '编的题目', '1-1-31', CODE_A, CODE_A.replace('-', ''), '飞飞'):
            self.assertNotIn(secret, text)
        self.assertEqual(set(json.loads(text)), {'format', 'v', 'kdf', 'keys', 'data'})

    def test_key_order_does_not_follow_insertion(self):
        # 8 keys stay in insertion order by chance once in 40320; three builds in a row, never.
        codes = {f'k{i}': K.new_code() for i in range(8)}
        orders = [[k['id'] for k in K.seal({'x': 1}, codes, iterations=1)['keys']] for _ in range(3)]
        self.assertFalse(all(o == list(codes) for o in orders))

    def test_size_is_padded(self):
        small = self.seal(payload={'x': 1})
        bigger = self.seal(payload={'x': 'a' * 1000})
        size = lambda e: len(base64.b64decode(e['data']['ct']))
        self.assertEqual(size(small), size(bigger), 'both fit in one 4 KB block')
        self.assertEqual((size(small) - 16) % K.PAD, 0, 'ciphertext = padded plaintext + 16-byte tag')

    def test_needs_at_least_one_valid_code(self):
        with self.assertRaises(ValueError):
            K.seal(fake_payload(), {}, iterations=FAST)
        with self.assertRaises(ValueError):
            K.seal(fake_payload(), {'a1': 'nope'}, iterations=FAST)


class Build(unittest.TestCase):
    """build_stories against a private repo made in a temporary folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        self.stories = os.path.join(self.repo, 'stories')
        os.makedirs(self.stories)
        p = fake_payload()
        unreviewed = {'lesson': '1-1-32', 'title': '没审的', 'pages': [{'text': '还没审。'}], 'reviewed': {'by': ''}}
        vol = {**p['volumes'][0], 'stories': p['volumes'][0]['stories'] + [unreviewed]}
        self._write('characters.json', p['characters'])
        self._write('grade1-semester1.json', vol)
        self._write('grade1-semester2.json', {'grade': 1, 'semester': 2, 'stories': [unreviewed]})
        self.out = os.path.join(self.repo, 'stories.enc.json')
        self.env = mock.patch.dict(os.environ, {S.ENV: self.stories})
        self.env.start()
        # The real checker validates real lessons; here only the build flow is under test.
        self.checker = mock.patch.object(B, 'run_checker', return_value=True)
        self.checker.start()
        self.git = mock.patch.object(B, 'private_repo_state', return_value=('abc1234', False))
        self.git.start()
        self.quiet = mock.patch('sys.stdout'), mock.patch('sys.stderr')
        for q in self.quiet:
            q.start()

    def tearDown(self):
        for p in (self.env, self.checker, self.git, *self.quiet):
            p.stop()
        self.tmp.cleanup()

    def _write(self, name, data):
        with open(os.path.join(self.stories, name), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)

    def invites(self, *names):
        inv = I.empty()
        for n in names:
            B.add_invite(inv, n)
        B.save_invites(inv)
        return inv

    def build(self):
        return B.build(out=self.out, iterations=FAST)

    def test_payload_keeps_only_reviewed_stories_and_drops_empty_volumes(self):
        p = B.payload()
        self.assertEqual([v['semester'] for v in p['volumes']], [1])
        self.assertEqual([st['lesson'] for st in p['volumes'][0]['stories']], ['1-1-31'])

    def test_invites_live_in_the_private_repo_root(self):
        self.invites('甲')
        self.assertEqual(os.path.dirname(S.invites_file()), self.repo)
        self.assertTrue(os.path.isfile(os.path.join(self.repo, 'invites.json')))

    def test_build_then_check_then_stale(self):
        inv = self.invites('甲', '乙')
        self.assertEqual(self.build(), 0)
        with open(self.out) as f:
            enc = json.load(f)
        self.assertEqual(K.open_file(enc, inv['invites'][1]['code']), B.payload())
        self.assertEqual(B.check(enc_path=self.out), 0)
        self._write('characters.json', {'characters': {'飞飞': {'text': '改过了。'}}})
        self.assertEqual(B.check(enc_path=self.out), 1, 'stories changed after the build')

    def test_revoked_code_cannot_open_the_next_build(self):
        inv = self.invites('甲', '乙')
        gone = inv['invites'][0]
        B.revoke(inv, gone['id'])
        B.save_invites(inv)
        self.assertEqual(B.check(enc_path=self.out), 1, 'no file yet')
        self.assertEqual(self.build(), 0)
        with open(self.out) as f:
            enc = json.load(f)
        with self.assertRaises(K.BadCode):
            K.open_file(enc, gone['code'])
        self.assertEqual([k['id'] for k in enc['keys']], [inv['invites'][1]['id']])

    def test_check_notices_an_added_invite(self):
        self.invites('甲')
        self.assertEqual(self.build(), 0)
        inv = B.load_invites()
        B.add_invite(inv, '乙')
        B.save_invites(inv)
        self.assertEqual(B.check(enc_path=self.out), 1)

    def test_build_refuses_without_codes_dirty_repo_or_failing_checker(self):
        self.assertEqual(self.build(), 2, 'no invites')
        self.invites('甲')
        with mock.patch.object(B, 'private_repo_state', return_value=('abc1234', True)):
            self.assertEqual(self.build(), 2, 'uncommitted story changes')
        with mock.patch.object(B, 'run_checker', return_value=False):
            self.assertEqual(self.build(), 1, 'checker failed')
        self.assertFalse(os.path.exists(self.out))

    def test_names_and_codes_stay_out_of_the_file(self):
        inv = self.invites(SECRET_NAME)
        self.build()
        with open(self.out, encoding='utf-8') as f:
            text = f.read()
        self.assertNotIn(SECRET_NAME, text)
        self.assertNotIn(inv['invites'][0]['code'], text)

    def test_add_invite_needs_a_name_and_ids_are_unique(self):
        inv = I.empty()
        with self.assertRaises(ValueError):
            B.add_invite(inv, '  ')
        ids = {B.add_invite(inv, f'孩子{i}')['id'] for i in range(20)}
        self.assertEqual(len(ids), 20)
        I.validate(inv)

    def test_one_active_code_per_name_and_notes(self):
        inv = I.empty()
        first = B.add_invite(inv, '甲', note='试读')
        with self.assertRaises(ValueError):
            B.add_invite(inv, '甲')
        B.revoke(inv, first['id'])
        self.assertNotEqual(B.add_invite(inv, '甲')['code'], first['code'], 'a new code after revoking')
        self.assertEqual(first['note'], '试读')

    def test_cli_add_list_revoke_and_a_broken_file(self):
        with mock.patch('sys.stdout') as out:
            self.assertEqual(B.main(['--add-invite', '丙', '--note', '朋友']), 0)
        printed = ''.join(c.args[0] for c in out.write.call_args_list)
        entry = I.load(S.invites_file())['invites'][0]
        code = entry['code']
        self.assertNotIn(code, printed, 'the code is never printed')
        self.assertNotIn(code.replace('-', ''), printed)
        card = B.card_path(entry['id'])
        self.assertIn(card, printed, 'it says where the card is')
        with open(card, encoding='utf-8') as f:
            text = f.read()
        self.assertIn(B.invite_link(code), text)
        self.assertIn(code, text)
        self.assertEqual(os.stat(card).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(os.path.dirname(card)).st_mode & 0o777, 0o700)
        self.assertEqual(os.path.dirname(os.path.dirname(card)), self.repo, 'cards/ is in the private repo')
        os.remove(card)
        self.assertEqual(B.main(['--card', entry['id']]), 0, 'the card can be made again')
        with open(card, encoding='utf-8') as f:
            self.assertEqual(f.read(), text, 'and it is the same card')
        with mock.patch('sys.stdout') as out:
            self.assertEqual(B.main(['--list']), 0)
        listed = ''.join(c.args[0] for c in out.write.call_args_list)
        self.assertIn('丙', listed)
        self.assertNotIn(code, listed, '--list never shows a code')
        kid = I.load(S.invites_file())['invites'][0]['id']
        self.assertEqual(B.main(['--revoke', kid]), 0)
        self.assertFalse(os.path.exists(card), 'revoking deletes the card')
        self.assertEqual(B.main(['--card', kid]), 2, 'no card for a revoked code')
        self.assertFalse(os.path.exists(card))
        self.assertEqual(B.main(['--card', 'ffffffff']), 2)
        self.assertEqual(B.main(['--revoke', 'ffffffff']), 2)
        with open(S.invites_file(), 'w') as f:
            f.write('{"invites": [}')
        self.assertEqual(B.main(['--list']), 2, 'a broken file is reported, not a traceback')
        self.assertEqual(B.main(['--check']), 1, 'and fails the pre-push check')

    def test_revoke_unknown_id(self):
        with self.assertRaises(KeyError):
            B.revoke(I.empty(), 'nope')

    def test_link_puts_the_code_after_the_hash(self):
        self.assertEqual(B.invite_link(CODE_A), B.SITE + '#invite=' + CODE_A)

    def test_fixture_opens_with_its_public_code_and_has_no_real_text(self):
        path = os.path.join(self.repo, 'fixture.enc.json')
        B.write_fixture(path)
        with open(path) as f:
            content = K.open_file(json.load(f), B.FIXTURE_CODE)
        self.assertEqual(content, B.fixture_payload())
        titles = [st['title'] for v in content['volumes'] for st in v['stories']]
        self.assertTrue(all(t.startswith('测试') or t == '没审过' for t in titles), titles)

    def test_check_skips_without_private_repo(self):
        with mock.patch.dict(os.environ, {S.ENV: os.path.join(self.repo, 'nope')}):
            self.assertEqual(B.check(enc_path=self.out), 0)


if __name__ == '__main__':
    unittest.main(verbosity=1)
