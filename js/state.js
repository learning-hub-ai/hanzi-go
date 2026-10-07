/**
 * State Management — single source of truth for app state.
 *
 * Supports multi-profile: each profile has its own localStorage namespace.
 * Shared data: profiles list, active profile ID
 * Per-profile: favorites, errorBook, stats, badges
 */
const State = (() => {
  const STORAGE_PREFIX = 'szb_';
  const SHARED_KEYS = ['profiles', 'activeProfile', 'welcomed'];
  let _config = {};
  let _profileId = '';

  /**
   * Get the full storage key (with profile prefix for per-user data).
   * @param {string} key
   * @returns {string}
   */
  function _key(key) {
    if (SHARED_KEYS.includes(key)) return STORAGE_PREFIX + key;
    return STORAGE_PREFIX + _profileId + '_' + key;
  }

  /**
   * Load a value from localStorage.
   * @param {string} key - Storage key
   * @param {*} defaultVal - Default if not found
   * @returns {*}
   */
  function load(key, defaultVal) {
    try {
      const raw = localStorage.getItem(_key(key));
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (_e) {
      return defaultVal;
    }
  }

  /**
   * Save a value to localStorage.
   * @param {string} key
   * @param {*} val
   */
  function save(key, val) {
    localStorage.setItem(_key(key), JSON.stringify(val));
  }

  /**
   * Load shared data (not profile-specific).
   */
  function loadShared(key, defaultVal) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (_e) {
      return defaultVal;
    }
  }

  function saveShared(key, val) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
  }

  /**
   * Load config.json at startup.
   */
  async function loadConfig() {
    try {
      const res = await fetch('config.json');
      if (res.ok) _config = await res.json();
    } catch (_e) {
      console.warn('[State] config.json not found, using defaults');
    }
    return _config;
  }

  /**
   * Get a config value (dot-notation: 'speech.rate').
   */
  function config(key, defaultVal) {
    const parts = key.split('.');
    let val = _config;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') return defaultVal;
      val = val[part];
    }
    return val !== undefined ? val : defaultVal;
  }

  /**
   * Set active profile and reload persisted data.
   * Also migrates legacy (pre-profile) data on first use.
   * @param {string} profileId
   */
  function setProfile(profileId) {
    _profileId = profileId;
    saveShared('activeProfile', profileId);

    // Migrate legacy data (from before profiles were added)
    // Only for profiles that existed before the profile system was added
    const migrationKey = STORAGE_PREFIX + profileId + '_migrated';
    if (!localStorage.getItem(migrationKey)) {
      const legacyKeys = ['favorites', 'errorBook', 'stats', 'badges'];
      const profiles = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'profiles') || '[]');
      const isFirstProfile = profiles.length <= 1; // Only migrate to the original user
      legacyKeys.forEach(key => {
        const legacyVal = localStorage.getItem(STORAGE_PREFIX + key);
        const profileVal = localStorage.getItem(STORAGE_PREFIX + profileId + '_' + key);
        if (legacyVal && !profileVal && isFirstProfile) {
          localStorage.setItem(STORAGE_PREFIX + profileId + '_' + key, legacyVal);
        }
      });
      localStorage.setItem(migrationKey, 'true');
    }

    // Reload per-profile data
    state.favorites = load('favorites', []);
    state.errorBook = load('errorBook', []);
    state.stats = load('stats', {
      totalRounds: 0, totalCorrect: 0, totalAnswered: 0,
      streak: 0, lastPlayDate: '', consecutiveDays: 0,
      playDates: []
    });
    state.badges = load('badges', []);
  }

  /** @returns {string} Current profile ID */
  function getProfileId() { return _profileId; }

  // Keys that make up a profile's full learning data (not shared/profile-list keys,
  // and not transient UI/runtime state — see the exclusion note below).
  // Kept as one explicit list so export/import can't silently drift from what
  // the app actually persists — if a new per-profile key is ever added, it needs
  // to be added here too for backup/restore to include it.
  //
  // Deliberately EXCLUDED (not user data, or not meaningful across devices):
  //   allChars, editions, lessons, filteredChars — derived from the loaded
  //     textbook JSON on every page load; re-generated fresh on the target
  //     device, not something to transfer.
  //   currentIndex, mode, quiz, selectedGrade, selectedSemester, showPinyin —
  //     transient UI/session state (which card you're looking at, which quiz
  //     is mid-flight); meaningless to restore on a different device/session.
  const EXPORT_KEYS = [
    'favorites', 'errorBook', 'stats', 'badges', 'spacedRep', 'customCards', 'favContext',
    'lessonProgress', 'dailyTask', 'growthPoints', 'completedLessonsHistory'
  ];

  /**
   * Export the current profile's full data as a plain object, for backup/transfer
   * to another device. Does not touch shared keys (profile list, active profile),
   * but DOES include the profile's name/avatar so importProfileData() can offer
   * to recreate the profile on a device where it doesn't exist yet.
   * @returns {Object} { profileId, profileName, profileAvatar, exportedAt, data: {...} }
   */
  function exportProfileData() {
    const data = {};
    for (const key of EXPORT_KEYS) {
      data[key] = load(key, null);
    }
    const profiles = loadShared('profiles', []);
    const current = profiles.find(p => p.id === _profileId);
    return {
      profileId: _profileId,
      profileName: current ? current.name : _profileId,
      profileAvatar: current ? current.avatar : '🧒',
      exportedAt: new Date().toISOString(),
      data
    };
  }

  /**
   * Check whether a profile with the given id already exists on this device.
   * Used by the import flow to decide whether to offer "create this profile".
   * @param {string} profileId
   * @returns {boolean}
   */
  function profileExists(profileId) {
    const profiles = loadShared('profiles', []);
    return profiles.some(p => p.id === profileId);
  }

  /**
   * Create a new profile from exported data's name/avatar, if one with that
   * id doesn't already exist. Does not switch to it or touch its data —
   * callers should follow up with importProfileData(payload) targeting the
   * same id to actually fill in the learning data.
   * @param {string} profileId
   * @param {string} name
   * @param {string} avatar
   * @returns {{ok: boolean, error?: string}}
   */
  function createProfileFromImport(profileId, name, avatar) {
    const profiles = loadShared('profiles', []);
    if (profiles.some(p => p.id === profileId)) {
      return { ok: false, error: 'profile_already_exists' };
    }
    profiles.push({ id: profileId, name: name || profileId, avatar: avatar || '🧒' });
    saveShared('profiles', profiles);
    return { ok: true };
  }

  /**
   * Import previously exported data, writing it into the profile identified
   * by payload.profileId (NOT necessarily the currently active profile).
   * Overwrites whatever is currently stored under each key for that profile.
   * Caller is responsible for confirming this with the user first, and for
   * creating the target profile first via createProfileFromImport() if it
   * doesn't exist yet — this function does not create profiles itself.
   *
   * If the target profile IS the currently active one, also updates the
   * in-memory `state` object for the keys it tracks (favorites/errorBook/
   * stats/badges — see setProfile()), so callers that don't force a full
   * page reload still see consistent data via State.get(). If importing into
   * a DIFFERENT (non-active) profile, in-memory state is correctly left alone —
   * the imported data is only visible after switching to that profile (which
   * reloads it from localStorage via setProfile()).
   *
   * @param {Object} payload - the object produced by exportProfileData()
   * @returns {{ok: boolean, error?: string}}
   */
  function importProfileData(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.data !== 'object' || payload.data === null) {
      return { ok: false, error: 'invalid_format' };
    }
    if (!payload.profileId) {
      return { ok: false, error: 'invalid_format' };
    }
    if (!profileExists(payload.profileId)) {
      return { ok: false, error: 'profile_not_found' };
    }
    const targetId = payload.profileId;
    const isActiveProfile = targetId === _profileId;
    const STATE_TRACKED_KEYS = ['favorites', 'errorBook', 'stats', 'badges'];

    for (const key of EXPORT_KEYS) {
      if (payload.data[key] !== undefined && payload.data[key] !== null) {
        // Write directly under the TARGET profile's namespace, not necessarily
        // the currently active one — _key() always uses _profileId, so for a
        // non-active target we build the storage key explicitly here.
        const storageKey = STORAGE_PREFIX + targetId + '_' + key;
        localStorage.setItem(storageKey, JSON.stringify(payload.data[key]));
        if (isActiveProfile && STATE_TRACKED_KEYS.includes(key)) {
          state[key] = payload.data[key];
        }
      }
    }
    return { ok: true };
  }

  // Initial state (profile data loaded after setProfile is called)
  const state = {
    mode: 'dailyTask',
    selectedSemester: '1',
    selectedGrade: '1',
    currentIndex: 0,
    showPinyin: false,
    allChars: [],
    filteredChars: [],
    lessons: [],
    favorites: [],
    errorBook: [],
    stats: { totalRounds: 0, totalCorrect: 0, totalAnswered: 0, streak: 0, lastPlayDate: '', consecutiveDays: 0, playDates: [] },
    badges: [],
    quiz: { questions: [], current: 0, score: 0, streak: 0, isErrorReview: false }
  };

  return {
    get: (key) => state[key],
    set: (key, val) => { state[key] = val; },
    persist: (key) => save(key, state[key]),
    load,
    save,
    loadShared,
    saveShared,
    loadConfig,
    config,
    setProfile,
    getProfileId,
    exportProfileData,
    importProfileData,
    profileExists,
    createProfileFromImport
  };
})();
