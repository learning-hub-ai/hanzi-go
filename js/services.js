/**
 * Services — side effects (speech, badges, storage helpers).
 *
 * Each service is a focused module handling one domain:
 * - Speech: browser TTS
 * - BadgeService: achievement checking and awarding
 * - FavoriteService: character favorites CRUD
 * - ErrorBookService: wrong answers tracking
 * - StatsService: play statistics and streaks
 * - SpacedRepService: Leitner box scheduling (which chars are due)
 * - ReportService: read-only aggregation for 学习报告
 * - CustomCardService: user-authored cards (自定义字卡)
 */

/**
 * Speech synthesis wrapper.
 * Priority chain: Google TTS → Baidu TTS → Web Speech API → silent.
 *
 * iOS Safari fix: reuses a single Audio element unlocked on first user tap.
 * Safari blocks .play() unless called on the same element that was first
 * played within a user gesture. We reuse one Audio and swap its src.
 */
const Speech = (() => {
  let _useLocalTTS = false;
  let _audio = null;
  let _unlocked = false;
  const TIMEOUT_MS = 2500;

  const BAIDU_URL = 'https://fanyi.baidu.com/gettts?lan=zh&spd=4&source=web&text=';
  const GOOGLE_URL = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=zh-CN&client=gtx&q=';

  // Tiny silent MP3 to unlock iOS audio on first tap
  const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA';

  /**
   * Ensure Audio element exists and is unlocked for iOS.
   * Called synchronously within the user's tap event.
   */
  function _ensureAudio() {
    if (!_audio) {
      _audio = new Audio();
      _audio.setAttribute('playsinline', '');
    }
    if (!_unlocked) {
      _audio.src = SILENT_MP3;
      _audio.volume = 0;
      const p = _audio.play();
      if (p) p.then(() => { _audio.pause(); _audio.volume = 1; _unlocked = true; }).catch(() => {});
      else { _unlocked = true; }
    }
  }

  /**
   * Speak a character or text aloud.
   * MUST be called from a user gesture (click/tap) for iOS.
   * @param {string} text - Text to speak
   * @param {Function} [onDone] - Called once playback has started (or we've
   *   given up trying — e.g. Web Speech API was invoked, or there's no
   *   speech support at all). Does NOT wait for playback to finish, only
   *   for it to begin, since that's the point at which "the sound you're
   *   about to hear" and "the question on screen" are still in sync —
   *   callers that advance to a new question should wait for this before
   *   doing so, otherwise a slow audio source can start playing after the
   *   next question has already replaced it on screen (see js/controllers.js
   *   ChallengeController.answer()).
   */
  function speak(text, onDone) {
    if (!text) { if (onDone) onDone(); return; }
    _ensureAudio();

    const sources = [];
    const encoded = encodeURIComponent(text);

    if (_useLocalTTS) sources.push(`/tts?text=${encoded}`);
    sources.push(GOOGLE_URL + encoded);
    sources.push(BAIDU_URL + encoded);

    _playSources(sources, 0, text, onDone);
  }

  /**
   * Try each audio source in order. On failure/timeout, try next.
   * Reuses the same _audio element (critical for iOS).
   */
  function _playSources(sources, index, text, onDone) {
    if (index >= sources.length) {
      // All URL sources failed — try Web Speech API
      _speakWebAPI(text);
      if (onDone) onDone();
      return;
    }

    let settled = false;
    let timer = null;

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onDone) onDone();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Try next source
      _playSources(sources, index + 1, text, onDone);
    };

    // Remove old listeners
    _audio.onplaying = null;
    _audio.onerror = null;
    _audio.onstalled = null;

    _audio.onplaying = succeed;
    _audio.onerror = fail;
    _audio.onstalled = fail;

    _audio.src = sources[index];
    _audio.currentTime = 0;
    _audio.volume = 1;

    timer = setTimeout(fail, TIMEOUT_MS);

    _audio.play().catch(fail);
  }

  /** Last resort: Web Speech API */
  function _speakWebAPI(text) {
    if (!text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = State.config('speech.rate', 0.8);
    const voices = speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) utterance.voice = zhVoice;
    speechSynthesis.speak(utterance);
  }

  /** Initialize: detect local TTS server, preload Web Speech voices */
  function init() {
    fetch('/tts?text=好').then(res => {
      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        _useLocalTTS = true;
      }
    }).catch(() => {});

    if ('speechSynthesis' in window) {
      speechSynthesis.getVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
      }
    }
  }

  return { speak, init };
})();

/**
 * Badge/achievement service.
 * Checks conditions and awards badges. Definitions loaded from config.
 */
const BadgeService = (() => {
  const BADGE_DEFS = [
    {
      id: 'challenge_master',
      emoji: '🎓',
      name: '挑战达人',
      get desc() { return '完成挑战: ' + (State.get('stats').totalRounds || 0) + '轮'; },
      check: () => State.get('stats').totalRounds >= 1
    },
    {
      id: 'perfect_record',
      emoji: '🎯',
      name: '满分记录',
      get desc() { return '满分次数: ' + (State.get('stats').perfectRounds || 0) + '次'; },
      check: () => (State.get('stats').perfectRounds || 0) >= 1
    },
    {
      id: 'literacy_master',
      emoji: '📚',
      name: '识字达人',
      get desc() { return '累计答对: ' + (State.get('stats').totalCorrect || 0) + '题'; },
      check: () => State.get('stats').totalCorrect >= 200
    },
    {
      id: 'streak_record',
      emoji: '🔥',
      name: '连续学习',
      get desc() { return '最高纪录: ' + (State.get('stats').bestStreak || 0) + '天'; },
      check: () => State.get('stats').consecutiveDays >= 7
    },
    {
      id: 'error_killer',
      emoji: '🛡️',
      name: '错题克星',
      get desc() { return ErrorBookService.count() === 0 && (State.get('stats').totalEverWrong || 0) > 0 ? '已清零错题本 ✓' : '清零错题本即可解锁'; },
      check: () => ErrorBookService.count() === 0 && (State.get('stats').totalEverWrong || 0) >= 5
    },
    // Growth milestones (unique chars learned)
    {
      id: 'growth_50',
      emoji: '🌱',
      name: '识字萌芽',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/50 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 50
    },
    {
      id: 'growth_100',
      emoji: '🌿',
      name: '百字小能手',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/100 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 100
    },
    {
      id: 'growth_200',
      emoji: '🌳',
      name: '两百识字',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/200 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 200
    },
    {
      id: 'growth_500',
      emoji: '⭐',
      name: '五百字大关',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/500 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 500
    },
    {
      id: 'growth_1000',
      emoji: '👑',
      name: '千字王',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/1000 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 1000
    },
    {
      id: 'growth_2000',
      emoji: '🏆',
      name: '识字冠军',
      get desc() { return `已认识 ${typeof SpacedRepService !== 'undefined' ? SpacedRepService.getTotalCount() : 0}/2000 字`; },
      check: () => typeof SpacedRepService !== 'undefined' && SpacedRepService.getTotalCount() >= 2000
    }
  ];

  /**
   * Check all badge conditions and award new ones.
   * @returns {Array} Newly awarded badge objects
   */
  function checkAndAward() {
    const badges = State.get('badges');
    const newBadges = [];

    BADGE_DEFS.forEach(badge => {
      if (!badges.includes(badge.id) && badge.check()) {
        badges.push(badge.id);
        newBadges.push(badge);
      }
    });

    if (newBadges.length) {
      State.set('badges', badges);
      State.persist('badges');
    }
    return newBadges;
  }

  /** @returns {Array} All badge definitions */
  function getAll() { return BADGE_DEFS; }

  /** @returns {boolean} Whether badge has been earned */
  function isEarned(id) { return State.get('badges').includes(id); }

  return { checkAndAward, getAll, isEarned };
})();

/**
 * Favorite characters service.
 * Manages the user's saved/starred characters list.
 */
const FavoriteService = (() => {
  /**
   * Toggle a character's favorite status.
   * @param {string} char - The character to toggle
   * @returns {boolean} New favorite status (true = now favorite)
   */
  function toggle(char) {
    const favs = State.get('favorites');
    const idx = favs.indexOf(char);
    if (idx >= 0) {
      favs.splice(idx, 1);
      // Remove context when unfavorited
      const ctx = State.load('favContext', {});
      delete ctx[char];
      State.save('favContext', ctx);
    } else {
      favs.push(char);
    }
    State.set('favorites', favs);
    State.persist('favorites');
    return favs.includes(char);
  }

  /** @returns {boolean} Whether char is in favorites */
  function isFavorite(char) { return State.get('favorites').includes(char); }

  /** @returns {Array} All favorited character strings */
  function getAll() { return State.get('favorites'); }

  /**
   * Store the grade/semester context where a char was favorited.
   * @param {string} char
   * @param {number} grade
   * @param {number} semester
   */
  function setContext(char, grade, semester) {
    const ctx = State.load('favContext', {});
    ctx[char] = { grade, semester };
    State.save('favContext', ctx);
  }

  /**
   * Get the stored context for a favorited char.
   * @param {string} char
   * @returns {Object|null} { grade, semester } or null if not stored
   */
  function getContext(char) {
    const ctx = State.load('favContext', {});
    return ctx[char] || null;
  }

  /**
   * Remove a character from favorites.
   * @param {string} char - Character to remove
   */
  function remove(char) {
    const favs = State.get('favorites').filter(f => f !== char);
    State.set('favorites', favs);
    State.persist('favorites');
    // Also remove context
    const ctx = State.load('favContext', {});
    delete ctx[char];
    State.save('favContext', ctx);
  }

  return { toggle, isFavorite, getAll, setContext, getContext, remove };
})();

/**
 * Error book service.
 * Tracks characters answered incorrectly in challenge mode.
 * Characters are removed after consecutive correct answers.
 */
const ErrorBookService = (() => {
  /** Consecutive correct answers needed to remove from book (from config) */
  function getRemoveThreshold() {
    return State.config('wrongAnswersToRemoveFromErrorBook', 3);
  }

  /**
   * Add or increment a wrong answer.
   * @param {string} char - The character
   * @param {string} pinyin - The character's pinyin
   */
  function addWrong(char, pinyin) {
    const book = State.get('errorBook');
    const existing = book.find(e => e.char === char);
    if (existing) {
      existing.wrongCount++;
      existing.consecutiveCorrect = 0;
    } else {
      book.push({ char, pinyin, wrongCount: 1, consecutiveCorrect: 0 });
      // Track that user has had errors (for badge: 错题克星)
      const stats = State.get('stats');
      stats.totalEverWrong = (stats.totalEverWrong || 0) + 1;
      State.set('stats', stats);
      State.persist('stats');
    }
    State.set('errorBook', book);
    State.persist('errorBook');
  }

  /**
   * Mark a character as answered correctly (in error review mode).
   * Removes from book after REMOVE_AFTER consecutive correct answers.
   * @param {string} char - The character
   */
  function markCorrect(char) {
    const book = State.get('errorBook');
    const entry = book.find(e => e.char === char);
    if (!entry) return;

    entry.consecutiveCorrect = (entry.consecutiveCorrect || 0) + 1;
    if (entry.consecutiveCorrect >= getRemoveThreshold()) {
      State.set('errorBook', book.filter(e => e.char !== char));
    }
    State.persist('errorBook');
  }

  /** @returns {Array} All error book entries */
  function getAll() { return State.get('errorBook'); }

  /** @returns {number} Number of entries in error book */
  function count() { return State.get('errorBook').length; }

  return { addWrong, markCorrect, getAll, count };
})();

/**
 * Statistics service.
 * Tracks cumulative play stats and daily streaks.
 */
const StatsService = (() => {
  /**
   * Record the results of a completed quiz round.
   * @param {number} score - Correct answers this round
   * @param {number} total - Total questions this round
   */
  /** Streak milestones that trigger a celebration popup */
  const STREAK_MILESTONES = [7, 14, 30, 50, 100, 365];
  const ROUNDS_MILESTONES = [10, 50, 100];
  const PERFECT_MILESTONES = [3, 10, 30];
  const CORRECT_MILESTONES = [200, 500, 1000];

  /**
   * Advance the daily streak on `stats`, in place.
   *
   * R5 grace day: missing ONE day does not reset the streak. A child in Swedish
   * school has höstlov, jullov, sportlov and sick days — a 40-day streak is
   * almost certain to break, and a reset to 1 is where motivation dies.
   *   Gap of 0 days (same day)  → no change, no double-count
   *   Gap of 1 day (yesterday)  → +1, normal continuation
   *   Gap of 2 days (grace day) → +1, the missed day is forgiven
   *   Gap of 3+ days            → reset to 1
   *
   * Shared by recordRound and recordDailyTask. It lives in one place because it
   * previously did not: R5 was applied to recordRound only, so a child who did
   * just the daily task still lost the streak after one missed day.
   *
   * @param {Object} stats - the stats object, mutated in place
   * @returns {Object|null} a milestone to celebrate, or null
   */
  function _advanceStreak(stats) {
    const today = new Date().toISOString().slice(0, 10);
    if (stats.lastPlayDate === today) return null; // already counted today

    const GRACE_DAYS = 1; // how many consecutive missed days are forgiven
    let gapDays = Infinity;
    if (stats.lastPlayDate) {
      const lastMs = new Date(stats.lastPlayDate).getTime();
      const todayMs = new Date(today).getTime();
      // Unparseable stored date → leave gapDays at Infinity so the streak resets
      if (!isNaN(lastMs)) gapDays = Math.round((todayMs - lastMs) / 86400000);
    }
    // gapDays compares calendar dates (both normalised to YYYY-MM-DD), so this
    // is correct across month and year boundaries and unaffected by DST.
    stats.consecutiveDays = (gapDays >= 1 && gapDays <= 1 + GRACE_DAYS)
      ? (stats.consecutiveDays || 0) + 1
      : 1;
    stats.lastPlayDate = today;

    // Keep a rolling history of active days so the report can show "this week".
    // lastPlayDate alone cannot answer that — it is a single overwritten value.
    // Capped at 400 entries (~13 months) to bound localStorage growth.
    if (!Array.isArray(stats.playDates)) stats.playDates = [];
    if (!stats.playDates.includes(today)) {
      stats.playDates.push(today);
      if (stats.playDates.length > 400) {
        stats.playDates = stats.playDates.slice(-400);
      }
    }

    if (!stats.bestStreak || stats.consecutiveDays > stats.bestStreak) {
      stats.bestStreak = stats.consecutiveDays;
    }

    return STREAK_MILESTONES.includes(stats.consecutiveDays)
      ? { emoji: '🔥', name: `连续${stats.consecutiveDays}天！`, desc: '坚持就是胜利，继续加油！' }
      : null;
  }

  function recordRound(score, total) {
    const stats = State.get('stats');
    stats.totalRounds++;
    stats.totalCorrect += score;
    stats.totalAnswered += total;

    // Track perfect rounds
    if (score === total && total >= 1) {
      stats.perfectRounds = (stats.perfectRounds || 0) + 1;
    }

    // Update daily streak.
    // Update daily streak (shared with recordDailyTask — see _advanceStreak)
    let milestone = _advanceStreak(stats);

    // Check other milestones
    if (!milestone) {
      if (ROUNDS_MILESTONES.includes(stats.totalRounds)) {
        milestone = { emoji: '🎓', name: `完成${stats.totalRounds}轮！`, desc: '学习之路越走越远' };
      } else if (PERFECT_MILESTONES.includes(stats.perfectRounds || 0)) {
        milestone = { emoji: '🎯', name: `${stats.perfectRounds}次满分！`, desc: '准确率惊人' };
      } else if (CORRECT_MILESTONES.includes(stats.totalCorrect)) {
        milestone = { emoji: '📚', name: `答对${stats.totalCorrect}题！`, desc: '知识积累越来越多' };
      }
    }

    State.set('stats', stats);
    State.persist('stats');
    return milestone; // null or {emoji, name, desc}
  }

  /** @returns {Object} Current stats object */
  function get() { return State.get('stats'); }

  /** Record daily task completion (for streak tracking) */
  /**
   * Record that the daily task was completed today.
   * Uses the same streak rules as recordRound, including the R5 grace day.
   * @returns {Object|null} a milestone to celebrate, or null
   */
  function recordDailyTask() {
    const stats = State.get('stats');
    const milestone = _advanceStreak(stats);
    State.set('stats', stats);
    State.persist('stats');
    // Returned for parity with recordRound. The daily-task flow currently
    // shows its own completion screen and ignores this.
    return milestone;
  }

  return { recordRound, recordDailyTask, get };
})();

/**
 * Spaced Repetition Service — Leitner Box System (7 boxes)
 * Tracks mastery per character. Only characters that have been quizzed enter the system.
 *
 * Box intervals: Box1=0d, Box2=1d, Box3=3d, Box4=7d, Box5=14d, Box6=30d, Box7=60d
 * Correct → move up one box. Wrong → move DOWN one box (not reset to Box 1).
 *
 * Why 7 boxes and not 5: with ~4000 characters and MAX_REVIEW=10/day, a 14-day
 * ceiling means every character ever learned returns fortnightly forever, which
 * saturates the daily review queue. Boxes 6-7 let mastered characters rest.
 *
 * Why demote one box instead of resetting: a character in Box 5 that is missed
 * once is not forgotten, it slipped. Resetting to Box 1 forces a 14-day re-climb
 * and reads as punishment to the learner. Anki uses the same partial-lapse idea.
 */
const SpacedRepService = (() => {
  // days until next review per box (0-indexed: box1=index0)
  const BOX_INTERVALS = [0, 1, 3, 7, 14, 30, 60];
  const MAX_BOX = BOX_INTERVALS.length - 1; // highest box index, derived — never hardcode
  let _cache = null; // In-memory cache to avoid localStorage timing issues

  /** Get all spaced rep data for current profile */
  function _getData() {
    if (_cache === null) _cache = State.load('spacedRep', {});
    return _cache;
  }

  /** Save spaced rep data */
  function _saveData(data) {
    _cache = data;
    State.save('spacedRep', data);
  }

  /** Reset cache (call when switching profiles) */
  function resetCache() {
    _cache = null;
  }

  /**
   * Record a quiz answer for a character.
   * @param {string} char - The character
   * @param {boolean} correct - Whether answered correctly
   */
  function recordAnswer(char, correct) {
    const data = _getData();
    const today = new Date().toISOString().slice(0, 10);

    if (!data[char]) {
      // First encounter — enter Box 1
      data[char] = { box: 0, lastReview: today, correctStreak: 0 };
    }

    // Check if this char is actually due for review
    const lastMs = new Date(data[char].lastReview).getTime();
    const todayMs = new Date(today).getTime();
    const daysSince = Math.floor((todayMs - lastMs) / 86400000);
    const interval = BOX_INTERVALS[Math.min(data[char].box, MAX_BOX)];
    const isDue = daysSince >= interval;

    if (correct) {
      data[char].correctStreak = (data[char].correctStreak || 0) + 1;
      // Only promote if the char is due (prevent same-day gaming)
      if (isDue && data[char].box < MAX_BOX) {
        data[char].box++;
      }
    } else {
      // Demote one box, not reset to Box 1 (R4) — a missed Box 5 char slipped,
      // it is not forgotten. Clamped at 0 so it never goes negative.
      data[char].box = Math.max(0, data[char].box - 1);
      data[char].correctStreak = 0;
    }

    data[char].lastReview = today;
    _saveData(data);
  }

  /**
   * Get characters that are due for review today.
   * @returns {Array} Array of character strings that need review
   */
  function getDueChars() {
    const data = _getData();
    const today = new Date().toISOString().slice(0, 10);
    const todayMs = new Date(today).getTime();
    const due = [];

    for (const [char, info] of Object.entries(data)) {
      const lastMs = new Date(info.lastReview).getTime();
      const daysSince = Math.floor((todayMs - lastMs) / 86400000);
      const interval = BOX_INTERVALS[Math.min(info.box, MAX_BOX)];

      if (daysSince >= interval) {
        due.push(char);
      }
    }

    return due;
  }

  /**
   * Get count of characters due for review.
   * @returns {number}
   */
  function getDueCount() {
    return getDueChars().length;
  }

  /**
   * Get total characters in the system.
   * @returns {number}
   */
  function getTotalCount() {
    return Object.keys(_getData()).length;
  }

  /**
   * Get the set of character strings the learner has already studied
   * (i.e. present in the spaced-repetition box system, regardless of box).
   * Used to bias quiz distractors toward characters the learner can
   * actually recognize, instead of pulling from the full 4000+ char set.
   * @returns {Array<string>}
   */
  function getKnownChars() {
    return Object.keys(_getData());
  }

  /**
   * Get box distribution stats.
   * Keys are derived from BOX_INTERVALS so adding a box needs no change here.
   * @returns {Object} {box1: N, ... box7: N}
   */
  function getStats() {
    const data = _getData();
    const stats = {};
    for (let i = 0; i < BOX_INTERVALS.length; i++) stats[`box${i + 1}`] = 0;
    for (const info of Object.values(data)) {
      const box = Math.min(info.box, MAX_BOX);
      stats[`box${box + 1}`]++;
    }
    return stats;
  }

  /**
   * Categorize all chars into review dropdown categories.
   * @returns {Object} { todayTask: [], scheduledReview: [], familiar: [], almostMastered: [], mastered: [] }
   *   - todayTask: Box 1, due (just got wrong)
   *   - scheduledReview: Box 2-5, due (scheduled spaced review)
   *   - familiar: Box 3, NOT due (getting familiar)
   *   - almostMastered: Box 4, NOT due (almost there)
   *   - mastered: Box 5, NOT due (mastered)
   */
  function getCategorizedChars() {
    const data = _getData();
    const today = new Date().toISOString().slice(0, 10);
    const todayMs = new Date(today).getTime();
    const result = { todayTask: [], scheduledReview: [], familiar: [], almostMastered: [], mastered: [] };

    for (const [char, info] of Object.entries(data)) {
      const lastMs = new Date(info.lastReview).getTime();
      const daysSince = Math.floor((todayMs - lastMs) / 86400000);
      const interval = BOX_INTERVALS[Math.min(info.box, MAX_BOX)];
      const isDue = daysSince >= interval;

      if (isDue) {
        if (info.box === 0) {
          result.todayTask.push(char);
        } else {
          result.scheduledReview.push(char);
        }
      } else {
        // Not due — bucket by how far up the boxes the char has climbed.
        // Box 1 not-due is impossible (interval=0); Box 2 not-due = just learned
        // today, deliberately not shown. Boxes 5+ all count as mastered so that
        // adding boxes 6-7 did not silently drop chars out of every category.
        if (info.box === 2) {
          result.familiar.push(char);
        } else if (info.box === 3) {
          result.almostMastered.push(char);
        } else if (info.box >= 4) {
          result.mastered.push(char);
        }
      }
    }

    return result;
  }

  return {
    recordAnswer, getDueChars, getDueCount, getTotalCount, getKnownChars, getStats,
    getCategorizedChars, resetCache,
    // Exposed so tests assert against the real schedule instead of a copy of it
    getBoxIntervals: () => [...BOX_INTERVALS],
    getMaxBox: () => MAX_BOX
  };
})();

/**
 * Learning Report Service — 学习报告
 *
 * Read-only aggregation over data other services already persist. Adds no
 * storage of its own except stats.playDates, which _advanceStreak maintains.
 *
 * Deliberately a service and not view code: the numbers are testable without
 * a DOM, and 卡住的字 needs a real definition rather than an inline filter.
 */
const ReportService = (() => {
  /** Characters whose wrongCount reaches this are considered genuinely hard */
  const STUCK_WRONG_THRESHOLD = 3;
  /** How many hard characters to list */
  const TOP_HARD = 10;

  const _today = () => new Date().toISOString().slice(0, 10);

  /**
   * Characters that are not sticking.
   *
   * Box level alone is not enough: box 0-1 also holds characters learned
   * correctly today, which are not stuck at all and would dominate the list.
   * The signal is crossing the two stores — low box AND repeatedly missed.
   *
   * @returns {Array} [{char, pinyin, box, wrongCount}] worst first
   */
  function getStuckChars() {
    const srs = State.load('spacedRep', {});
    const book = ErrorBookService.getAll();
    const out = [];
    for (const entry of book) {
      const info = srs[entry.char];
      const box = info ? info.box : 0;
      if (box <= 1 && (entry.wrongCount || 0) >= STUCK_WRONG_THRESHOLD) {
        out.push({ char: entry.char, pinyin: entry.pinyin, box, wrongCount: entry.wrongCount });
      }
    }
    return out.sort((a, b) => b.wrongCount - a.wrongCount);
  }

  /**
   * Hardest characters by error count, regardless of box.
   * @returns {Array} [{char, pinyin, wrongCount}] worst first, capped
   */
  function getHardestChars() {
    return ErrorBookService.getAll()
      .slice()
      .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
      .slice(0, TOP_HARD);
  }

  /**
   * Which of the last 7 calendar days had activity.
   *
   * Only answerable because stats.playDates exists. It starts empty for
   * existing profiles, so early reports under-report rather than guess —
   * there is no retroactive data to recover.
   *
   * @returns {Object} {days: [{date, active}] oldest first, activeCount}
   */
  function getWeekActivity() {
    const stats = State.get('stats') || {};
    const played = new Set(Array.isArray(stats.playDates) ? stats.playDates : []);
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      // Local Y/M/D, not Date.now() + toISOString() (UTC) — otherwise the
      // window is off by one date for 1-2 hours every night in timezones
      // ahead of UTC (e.g. CEST), where the local calendar day has already
      // advanced but the UTC one hasn't. playDates itself is still written
      // with the UTC-based "today" elsewhere (_advanceStreak) — during that
      // same window a same-day entry could in theory miss this local-dated
      // window by one slot. That's a pre-existing, narrower mismatch in the
      // write side and out of scope here; this fixes the display, which is
      // what parents actually look at and what R2 specifies.
      const local = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const d = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
      days.push({ date: d, active: played.has(d) });
    }
    return { days, activeCount: days.filter(d => d.active).length };
  }

  /**
   * Mastery split, coarse on purpose.
   *
   * Per-box counts are already visible in the 智能复习 dropdown and are not
   * actionable at that precision. Three buckets answer the only question a
   * parent asks: how much is solid, how much is in flight, what needs help.
   *
   * Boundaries are derived from the interval schedule, not hardcoded box
   * numbers: "needs work" is anything still reviewed within a couple of days,
   * "mastered" is anything resting a fortnight or more. Change BOX_INTERVALS
   * and the buckets follow instead of silently mis-classifying.
   *
   * @returns {Object} {mastered, learning, needsWork, total}
   */
  function getMasterySplit() {
    const boxStats = SpacedRepService.getStats();
    const intervals = SpacedRepService.getBoxIntervals();
    const NEEDS_WORK_MAX_DAYS = 1;  // box interval <= 1 day: just met, or knocked back
    const MASTERED_MIN_DAYS = 14;   // resting two weeks or longer
    let mastered = 0, learning = 0, needsWork = 0;
    intervals.forEach((days, i) => {
      const n = boxStats[`box${i + 1}`] || 0;
      if (days <= NEEDS_WORK_MAX_DAYS) needsWork += n;
      else if (days < MASTERED_MIN_DAYS) learning += n;
      else mastered += n;
    });
    return { mastered, learning, needsWork, total: mastered + learning + needsWork };
  }

  /** @returns {Object|null} current lesson position, or null before setup */
  function getPosition() {
    if (typeof DailyTaskService === 'undefined') return null;
    const progress = DailyTaskService.getProgress();
    if (!progress) return null;
    return {
      grade: progress.grade,
      semester: progress.semester,
      lessonIndex: progress.lessonIndex,
      completedCount: (progress.completedLessons || []).length
    };
  }

  /**
   * Everything the report needs, in one call.
   * @returns {Object} report data; all fields always present
   */
  function build() {
    const stats = State.get('stats') || {};
    const answered = stats.totalAnswered || 0;
    return {
      date: _today(),
      mastery: getMasterySplit(),
      dueToday: SpacedRepService.getDueCount(),
      totalSeen: SpacedRepService.getTotalCount(),
      week: getWeekActivity(),
      streak: {
        current: stats.consecutiveDays || 0,
        best: stats.bestStreak || 0
      },
      totals: {
        rounds: stats.totalRounds || 0,
        correct: stats.totalCorrect || 0,
        answered,
        accuracy: answered ? Math.round((stats.totalCorrect || 0) / answered * 100) : null
      },
      stuck: getStuckChars(),
      // Not currently rendered — the panel shows `stuck` instead, which also
      // requires a low box. Kept because getHardestChars is a tested public
      // method and a plain "most-missed" list is the obvious next thing to
      // surface in 错题本.
      hardest: getHardestChars(),
      errorBookCount: ErrorBookService.count(),
      position: getPosition()
    };
  }

  return { build, getStuckChars, getHardestChars, getWeekActivity, getMasterySplit, getPosition };
})();

/**
 * Custom Card Service — 自定义字卡
 *
 * User-authored cards for anything the textbook data does not cover: a word
 * from a story, a Swedish-class term, a name. Stored per-profile under its own
 * key, deliberately NOT in data/*.json — those are generated from textbook
 * PDFs and regenerating them would wipe user content.
 *
 * Cards are shaped exactly like textbook chars ({char, pinyin, words,
 * sentence}) so they flow through the flashcard, SRS and quiz paths unchanged.
 * The 反面 text lands in `sentence`, which is what the card back renders.
 *
 * Quiz support depends on which fields are filled:
 *   pinyin given  → 字→音 and 音→字 work
 *   back contains the front → 填空 works
 *   words empty   → 字→词 skips this card (see DataService distractor filter)
 */
const CustomCardService = (() => {
  const MAX_FRONT = 8;    // a card front is a char or short word, not a sentence
  const MAX_BACK = 200;
  const MAX_PINYIN = 60;
  const MAX_CARDS = 500;  // bound localStorage; far above realistic use

  /** @returns {Array} raw stored cards */
  function _load() {
    const cards = State.load('customCards', []);
    return Array.isArray(cards) ? cards : [];
  }

  function _save(cards) {
    State.save('customCards', cards);
  }

  /**
   * Validate a would-be card without saving it.
   * @returns {Object} {ok: boolean, error: string}
   */
  function validate(front, back, pinyin) {
    const f = (front || '').trim();
    const b = (back || '').trim();
    const p = (pinyin || '').trim();
    if (!f) return { ok: false, error: '正面不能为空' };
    if (!b) return { ok: false, error: '反面不能为空' };
    if (f.length > MAX_FRONT) return { ok: false, error: `正面最多 ${MAX_FRONT} 个字` };
    if (b.length > MAX_BACK) return { ok: false, error: `反面最多 ${MAX_BACK} 个字` };
    if (p.length > MAX_PINYIN) return { ok: false, error: `拼音最多 ${MAX_PINYIN} 个字符` };
    if (_load().some(c => c.front === f)) return { ok: false, error: `「${f}」已经有卡片了` };
    if (_load().length >= MAX_CARDS) return { ok: false, error: `最多 ${MAX_CARDS} 张卡片` };
    return { ok: true, error: '' };
  }

  /**
   * Add a card.
   * @param {string} front - card front (the prompt)
   * @param {string} back - card back (meaning, example, translation…)
   * @param {string} [pinyin] - optional; enables the pinyin quiz types
   * @returns {Object} {ok: boolean, error: string, card: Object|null}
   */
  function add(front, back, pinyin) {
    const check = validate(front, back, pinyin);
    if (!check.ok) return { ok: false, error: check.error, card: null };
    const card = {
      front: (front || '').trim(),
      back: (back || '').trim(),
      pinyin: (pinyin || '').trim(),
      created: new Date().toISOString().slice(0, 10)
    };
    const cards = _load();
    cards.push(card);
    _save(cards);
    return { ok: true, error: '', card };
  }

  /**
   * Remove a card by its front text.
   * @returns {boolean} whether a card was removed
   */
  function remove(front) {
    const cards = _load();
    const next = cards.filter(c => c.front !== front);
    if (next.length === cards.length) return false;
    _save(next);
    return true;
  }

  /** @returns {Array} stored cards, newest first */
  function getAll() {
    return _load().slice().reverse();
  }

  /** @returns {number} how many custom cards exist */
  function count() {
    return _load().length;
  }

  /**
   * Cards in the same shape as textbook characters, so every existing path
   * (flashcards, SRS, quiz) consumes them without special-casing.
   *
   * grade/semester are 0 to mark "not from a textbook" — the same convention
   * the error-book branch already uses for synthesised entries.
   *
   * @returns {Array} [{char, pinyin, words, sentence, grade, semester, isCustom}]
   */
  function asChars() {
    return getAll().map(c => ({
      char: c.front,
      pinyin: c.pinyin || '',
      words: [],
      sentence: c.back,
      grade: 0,
      semester: 0,
      isCustom: true
    }));
  }

  return { add, remove, getAll, count, asChars, validate };
})();
