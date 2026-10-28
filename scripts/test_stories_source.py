#!/usr/bin/env python3
"""Tests for scripts/stories_source.py (where the private story text is).

    python3 scripts/test_stories_source.py

Every test builds its own story directory in a temporary folder and points
$HANZIGO_STORIES at it, so the tests never need the private repo and never
read the real stories.
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stories_source as S  # noqa: E402


def write(d, name, data):
    with open(os.path.join(d, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)


class Location(unittest.TestCase):
    def test_default_is_the_clone_next_to_this_repo(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(S.ENV, None)
            self.assertEqual(S.story_dir(),
                             os.path.join(os.path.dirname(S.ROOT), 'hanzi-go-stories', 'stories'))

    def test_env_wins_and_is_read_on_every_call(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            with mock.patch.dict(os.environ, {S.ENV: a}):
                self.assertEqual(S.story_dir(), a)
            with mock.patch.dict(os.environ, {S.ENV: b}):
                self.assertEqual(S.story_dir(), b, 'not cached at import')

    def test_missing_message_names_the_repo_and_the_variable(self):
        m = S.missing_message()
        self.assertIn(S.PRIVATE_REPO, m)
        self.assertIn(S.ENV, m)


class Loading(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.env = mock.patch.dict(os.environ, {S.ENV: self.d})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_empty_directory_is_not_available(self):
        self.assertFalse(S.available())
        self.assertIsNone(S.load_characters())
        self.assertEqual(S.load_volumes(), [])
        self.assertEqual(S.all_stories(), [])

    def test_volumes_only_without_intros_is_not_available(self):
        write(self.d, S.volume_file((1, 1)), {'stories': []})
        self.assertFalse(S.available(), 'characters.json marks a real checkout')

    def test_loads_what_is_there_in_volume_order(self):
        write(self.d, S.CHARACTERS_FILE, {'characters': {'飞飞': {}}})
        write(self.d, S.volume_file((1, 2)), {'grade': 1, 'semester': 2, 'stories': [{'lesson': '1-2-1'}]})
        write(self.d, S.volume_file((1, 1)), {'grade': 1, 'semester': 1, 'stories': [{'lesson': '1-1-20'}]})
        self.assertTrue(S.available())
        self.assertEqual([v for v, _ in S.load_volumes()], [(1, 1), (1, 2)])
        self.assertEqual([st['lesson'] for st in S.all_stories()], ['1-1-20', '1-2-1'])
        self.assertEqual(list(S.load_characters()['characters']), ['飞飞'])

    def test_an_explicit_directory_overrides_the_environment(self):
        with tempfile.TemporaryDirectory() as other:
            write(other, S.CHARACTERS_FILE, {'characters': {}})
            self.assertFalse(S.available())
            self.assertTrue(S.available(other))

    def test_file_names(self):
        self.assertEqual(S.volume_file((2, 1)), 'grade2-semester1.json')


if __name__ == '__main__':
    unittest.main(verbosity=1)
