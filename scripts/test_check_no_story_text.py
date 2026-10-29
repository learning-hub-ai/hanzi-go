#!/usr/bin/env python3
"""Tests for scripts/check_no_story_text.py (the story-text guard in pre-push).

    python3 scripts/test_check_no_story_text.py

Builds a throwaway git repo with made-up stories, so it never reads the real
ones and never touches this repo's history.
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_no_story_text as G  # noqa: E402
import stories_source as S  # noqa: E402

STORY_LINE = '小天在湖边找到一只红色的风筝。'   # made up; its 6-grams are the "secret"
INTRO = '一只最爱唱歌的小鸟儿。'
TITLE = '红风筝'
CODE = 'ABCD-EFGH-JKMN'       # made-up invite codes in the made-up private list
OLD_CODE = 'PQRS-TVWX-YZ23'   # revoked: still private


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = self.tmp.name
        # private stories
        self.stories = os.path.join(base, 'private', 'stories')
        os.makedirs(self.stories)
        with open(os.path.join(self.stories, 'characters.json'), 'w', encoding='utf-8') as f:
            json.dump({'characters': {'小天': {'text': INTRO}}}, f, ensure_ascii=False)
        with open(os.path.join(self.stories, 'grade1-semester1.json'), 'w', encoding='utf-8') as f:
            json.dump({'grade': 1, 'semester': 1, 'stories': [
                {'lesson': '1-1-31', 'title': TITLE, 'pages': [{'text': STORY_LINE}], 'reviewed': {'by': 'x'}}]},
                f, ensure_ascii=False)
        # a public repo with one pushed commit
        self.repo = os.path.join(base, 'public')
        self.remote = os.path.join(base, 'remote.git')
        os.makedirs(self.repo)
        sh(base, 'git', 'init', '-q', '--bare', self.remote)
        sh(self.repo, 'git', 'init', '-q', '-b', 'main')
        sh(self.repo, 'git', 'config', 'user.email', 't@example.com')
        sh(self.repo, 'git', 'config', 'user.name', 't')
        self.commit('README.md', '公开的说明。\n', '第一个提交')
        sh(self.repo, 'git', 'remote', 'add', 'origin', self.remote)
        sh(self.repo, 'git', 'push', '-q', '-u', 'origin', 'main')
        # a private invite list next to the stories
        with open(os.path.join(base, 'private', 'invites.json'), 'w', encoding='utf-8') as f:
            json.dump({'format': 'hanzigo-invites', 'version': 1, 'invites': [
                {'id': 'a1b2c3d4', 'code': CODE, 'name': '测', 'added': '2026-10-29', 'revoked': None},
                {'id': 'b2c3d4e5', 'code': OLD_CODE, 'name': '旧', 'added': '2026-10-01', 'revoked': '2026-10-02'}]},
                f, ensure_ascii=False)
        self.patches = [mock.patch.object(S, 'ROOT', self.repo),
                        mock.patch.object(G.stories_source, 'ROOT', self.repo),
                        mock.patch.dict(os.environ, {S.ENV: self.stories})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def commit(self, path, text, msg):
        full = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8') as f:
            f.write(text)
        sh(self.repo, 'git', 'add', path)
        sh(self.repo, 'git', 'commit', '-q', '-m', msg)
        return sh(self.repo, 'git', 'rev-parse', 'HEAD')

    def run_guard(self, stdin=''):
        out = io.StringIO()
        with mock.patch('sys.stdout', out):
            code = G.main([], io.StringIO(stdin))
        return code, out.getvalue()

    def test_clean_repo_passes(self):
        self.assertEqual(self.run_guard()[0], 0)

    def test_story_text_in_a_tracked_file(self):
        self.commit('test.html', f"const T = '{STORY_LINE[2:10]}';\n", '测试')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn('test.html', out)

    def test_a_changed_punctuation_mark_still_matches(self):
        # Sentences differ in punctuation; six characters in a row still match.
        self.commit('a.js', '// 小天在湖边找到一只……\n', 'x')
        self.assertEqual(self.run_guard()[0], 1)

    def test_intro_text_and_titles_in_brackets(self):
        self.commit('b.js', f'// {INTRO}\n', 'x')
        self.assertEqual(self.run_guard()[0], 1)
        sh(self.repo, 'git', 'rm', '-q', 'b.js')
        sh(self.repo, 'git', 'commit', '-q', '-m', 'rm')
        self.commit('c.md', f'见《{TITLE}》。\n', 'x')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn(f'《{TITLE}》', out)

    def test_title_alone_without_brackets_is_fine(self):
        # A two- or three-character title is an ordinary word; only 《title》 counts.
        self.commit('d.md', f'{TITLE}很好看。\n', 'x')
        self.assertEqual(self.run_guard()[0], 0)

    def test_text_added_then_removed_is_caught_in_history(self):
        self.commit('e.js', f'// {STORY_LINE}\n', '加')
        self.commit('e.js', '// 编的。\n', '删')
        code, out = self.run_guard()
        self.assertEqual(code, 1, 'the files are clean, but a commit being pushed has it')
        self.assertIn('的改动', out)

    def test_commit_message_is_scanned(self):
        self.commit('f.md', '新功能。\n', f'新增《{TITLE}》')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn('提交说明', out)

    def test_plain_story_file_is_refused(self):
        self.commit('data/stories/grade1-semester1.json', '{}\n', 'x')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn('data/stories/grade1-semester1.json', out)

    def test_story_shaped_json_elsewhere_is_refused(self):
        self.commit('misc/copy.json', json.dumps({'stories': [{'pages': [], 'reviewed': {}}]}), 'x')
        self.assertEqual(self.run_guard()[0], 1)

    def test_encrypted_file_is_allowed(self):
        self.commit('data/stories.enc.json', '{"format": "hanzigo-stories"}\n', 'x')
        self.assertEqual(self.run_guard()[0], 0)

    def test_push_ranges_from_the_hook(self):
        bad = self.commit('g.js', f'// {STORY_LINE}\n', 'x')
        sh(self.repo, 'git', 'rm', '-q', 'g.js')
        sh(self.repo, 'git', 'commit', '-q', '-m', 'rm')
        head = sh(self.repo, 'git', 'rev-parse', 'HEAD')
        remote = sh(self.repo, 'git', 'rev-parse', 'origin/main')
        line = f'refs/heads/main {head} refs/heads/main {remote}\n'
        self.assertEqual(self.run_guard(line)[0], 1, 'range remote..local includes the bad commit')
        line_after = f'refs/heads/main {head} refs/heads/main {bad}\n'
        self.assertEqual(self.run_guard(line_after)[0], 0, 'already on the remote: not scanned again')
        self.assertEqual(G.push_ranges([f'refs/heads/x {G.ZERO} refs/heads/x {remote}']), [], 'branch delete')
        self.assertEqual(G.push_ranges([f'refs/heads/new {head} refs/heads/new {G.ZERO}']),
                         [[head, '--not', '--remotes']], 'new branch')

    def test_allowed_coincidence(self):
        with mock.patch.dict(G.ALLOWED, {STORY_LINE[0:6]: 'test'}):
            grams, _ = G.secrets_from_stories()
        self.assertNotIn(STORY_LINE[0:6], grams)
        self.assertIn(STORY_LINE[1:7], grams)

    def test_an_invite_code_in_a_file_or_a_commit_blocks_the_push(self):
        for spelling in (CODE, CODE.replace('-', ''), CODE.lower().replace('-', ' ')):
            with self.subTest(spelling=spelling):
                self.commit('x.md', f'link #invite={spelling}\n', 'x')
                code, out = self.run_guard()
                self.assertEqual(code, 1)
                self.assertIn('a1b2c3d4', out, 'the id is reported')
                self.assertNotIn(CODE.replace('-', ''), out.replace('-', '').upper(), 'never the code')
                sh(self.repo, 'git', 'reset', '-q', '--hard', 'origin/main')
        self.commit('y.md', f'{OLD_CODE}\n', 'x')
        self.assertEqual(self.run_guard()[0], 1, 'a revoked code is still private')
        sh(self.repo, 'git', 'reset', '-q', '--hard', 'origin/main')
        self.commit('z.md', '编的。\n', f'发码 {CODE}')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn('提交说明', out)

    def test_a_code_in_an_already_pushed_file_is_still_caught(self):
        # Pushed before the check existed: no new commit has it, the file does.
        self.commit('old.md', f'{CODE}\n', 'x')
        sh(self.repo, 'git', 'push', '-q', 'origin', 'main')
        code, out = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn('old.md', out)

    def test_code_like_text_is_not_a_false_alarm(self):
        self.commit('w.md', 'Z' + CODE.replace('-', '') + '\nAB CD EFGH JKMN\n', 'x')
        self.assertEqual(self.run_guard()[0], 0)

    def test_without_private_text_only_the_file_check_runs(self):
        self.commit('h.js', f'// {STORY_LINE}\n', 'x')
        with mock.patch.dict(os.environ, {S.ENV: os.path.join(self.tmp.name, 'nope')}):
            code, out = self.run_guard()
        self.assertEqual(code, 0)
        self.assertIn('跳过', out)


if __name__ == '__main__':
    unittest.main(verbosity=1)
