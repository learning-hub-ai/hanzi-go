#!/usr/bin/env python3
"""Where the 小故事 text lives, and how to read it (docs/story-reading-design.html §7.4).

The story text is private. It is kept in the repo learning-hub-ai/hanzi-go-stories,
cloned next to this one; the public repo only ships the encrypted
data/stories.enc.json. Every script that needs the plain text reads it through
this module, so the location rule and the "not on this machine" message are
written once.

Location, first match wins:
    1. $HANZIGO_STORIES — a directory holding the story files;
    2. ../hanzi-go-stories/stories/ — the private clone next to this repo.

The directory is resolved on every call, not at import, so a test or a
caller can point $HANZIGO_STORIES elsewhere at any time.

Layout of that directory (one file per volume, all optional except the intros):
    characters.json                    the cast intros after the cover
    grade<g>-semester<s>.json          one per volume in VOLUMES
and next to it, in the private repo's root:
    invites.json                       who may read (build_stories.py manages it)
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = 'HANZIGO_STORIES'
PRIVATE_REPO = 'learning-hub-ai/hanzi-go-stories'
CHARACTERS_FILE = 'characters.json'
INVITES_FILE = 'invites.json'
# Volumes that may have stories (grades 1–2). Adding a volume = adding it here.
VOLUMES = [(1, 1), (1, 2), (2, 1), (2, 2)]


def volume_file(volume):
    """File name for one volume, e.g. (1, 2) -> 'grade1-semester2.json'."""
    g, s = volume
    return f'grade{g}-semester{s}.json'


def story_dir():
    """The directory holding the private story files (it may not exist)."""
    return os.environ.get(ENV) or os.path.join(os.path.dirname(ROOT), 'hanzi-go-stories', 'stories')


def repo_dir(d=None):
    """The private repo's root: the parent of the story directory."""
    return os.path.dirname(os.path.abspath(d or story_dir()))


def invites_file(d=None):
    """Where the invite list is (it may not exist yet)."""
    return os.path.join(repo_dir(d), INVITES_FILE)


def available(d=None):
    """True when the private story files are on this machine.

    The intros file is required in every layout, so it marks a real checkout
    (an empty or wrong directory does not count).
    """
    return os.path.isfile(os.path.join(d or story_dir(), CHARACTERS_FILE))


def missing_message():
    """One line saying where the story text was expected and how to get it."""
    return (f'没有故事原文：私有仓库 {PRIVATE_REPO} 应克隆在 {story_dir()}'
            f'（或用环境变量 {ENV} 指定）')


def _read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_characters(d=None):
    """The intros file as a dict, or None when it is not there."""
    path = os.path.join(d or story_dir(), CHARACTERS_FILE)
    return _read(path) if os.path.isfile(path) else None


def load_volumes(d=None):
    """[(volume, data)] for each volume file that exists, in VOLUMES order."""
    d = d or story_dir()
    out = []
    for volume in VOLUMES:
        path = os.path.join(d, volume_file(volume))
        if os.path.isfile(path):
            out.append((volume, _read(path)))
    return out


def all_stories(d=None):
    """Every story of every volume, in volume order."""
    return [st for _, data in load_volumes(d) for st in data.get('stories') or []]
