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
  /**
   * The speak() call currently in flight, or null — see speak()'s overlap
   * rule. Shape: { text, finish } where finish(reason) fires that call's
   * onDone exactly once.
   */
  let _current = null;
  /**
   * Stops whatever the in-flight call is doing right now (pauses the audio
   * element or cancels the utterance) and turns its pending callbacks into
   * no-ops. Set by _playSources/_speakWebAPI for each attempt.
   */
  let _cancelActive = null;
  /** Extra time allowed past a clip's known duration before giving up on onended. */
  const PLAY_END_GRACE_MS = 500;
  /** Test-only replacement for real playback; see _setPlaybackForTest. */
  let _testPlayback = null;

  // Diagnostic overlay — only active with ?debugSpeech=1 in the URL, so it
  // never shows for normal users. Added to investigate a real-device report
  // (iPhone 16, iOS Safari): 挑战模式 answers never produce sound, even
  // across many consecutive correct answers, while 学习模式's 朗读 button
  // needs several taps before sound starts — and once it does, it keeps
  // working. That pattern doesn't fit the "one real play unlocks the shared
  // _audio element forever" theory (consecutive correct answers in 挑战模式
  // alone never recovered), so this logs the exact source/event sequence on
  // screen (console isn't reachable on a phone) to find the real cause
  // instead of guessing further.
  const _DEBUG = /debugSpeech=1/.test(location.search);
  let _debugEl = null;
  let _debugLines = [];
  function _debugLog(msg) {
    if (!_DEBUG) return;
    _debugLines.push(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
    if (!_debugEl) {
      // Collapsed-by-default toggle button + an expandable panel, instead
      // of an always-visible strip: a strip pinned to any edge either
      // overlaps real controls (bottom — ate clicks on the mobile bottom
      // bar) or sits over the header/card (top/middle — in the way while
      // debugging is exactly when the user needs to tap 朗读 repeatedly).
      // Collapsed, this is just a small badge in a corner with nothing
      // else on screen nearby to intercept clicks from; expanded, it's
      // the user's own explicit choice to cover part of the screen, and
      // closing it again is one tap away. Text is user-select:text so
      // the log can actually be copied off the phone (the previous
      // pointer-events:none design broke that).
      const toggle = document.createElement('button');
      toggle.id = 'speechDebugToggle';
      toggle.textContent = '🐛';
      // Top-right, below the header: avoids the mobile bottom bar
      // (.mobile-bottom-bar, bottom:0 height:56px) that an earlier version
      // of this toggle overlapped, and avoids the header itself.
      toggle.style.cssText = 'position:fixed;top:60px;right:8px;z-index:99999;' +
        'width:36px;height:36px;border-radius:50%;border:none;background:#111;color:#0f0;' +
        'font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer';

      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;top:100px;right:8px;left:8px;max-height:60vh;z-index:99999;' +
        'background:rgba(0,0,0,.92);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
        'overflow-y:auto;padding:8px;color:#0f0;font:11px monospace;white-space:pre-wrap;' +
        'user-select:text;-webkit-user-select:text;display:none';

      toggle.onclick = () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      };

      document.body.appendChild(toggle);
      document.body.appendChild(panel);
      _debugEl = panel;
    }
    _debugEl.textContent = _debugLines.join('\n');
    _debugEl.scrollTop = _debugEl.scrollHeight;
  }

  const BAIDU_URL = 'https://fanyi.baidu.com/gettts?lan=zh&spd=4&source=web&text=';
  // Google honours ttsspeed, but only noticeably on more than one syllable —
  // a single character comes back byte-identical at any value, which is why
  // the bare character sounded rushed while Baidu's spd=4 did not. The value
  // is appended from speech.rate at call time rather than baked in here, so
  // the two sources stay in step with the Web Speech API path.
  const GOOGLE_URL = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=zh-CN&client=gtx&q=';

  // Tiny silent MP3 to unlock iOS audio on first tap
  const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA';

  /**
   * Ensure Audio element exists and is unlocked for iOS.
   * Called synchronously within the user's tap event.
   *
   * iOS Safari fix: the unlock play() is async (its .then() can resolve
   * well after this function returns), but the caller (speak(), via
   * _playSources) proceeds synchronously and immediately overwrites
   * _audio.src with the real TTS URL. If the delayed unlock callback then
   * blindly calls _audio.pause(), it pauses whatever is NOW loaded — the
   * real audio the user is supposed to hear, not the silent clip — which
   * silently cuts it off with no error (so the old "wait for onplaying"
   * logic didn't notice, and even the current "wait for onended" logic
   * doesn't error, it just hangs until maxPlayMs's ceiling eventually
   * fires `finished`). Guard: only pause/reset volume if _audio.src is
   * STILL the silent clip, i.e. nothing has reused the element since.
   */
  function _ensureAudio() {
    if (!_audio) {
      _audio = new Audio();
      _audio.setAttribute('playsinline', '');
    }
    if (!_unlocked) {
      _debugLog('unlock: attempting silent-MP3 play()');
      _audio.src = SILENT_MP3;
      _audio.volume = 0;
      const p = _audio.play();
      if (p) {
        p.then(() => {
          if (_audio.src.startsWith('data:audio/mp3')) {
            _audio.pause();
            _audio.volume = 1;
          }
          _unlocked = true;
          _debugLog('unlock: succeeded, _unlocked=true');
        }).catch((e) => { _unlocked = true; _debugLog(`unlock: play() rejected (${e && e.name}), _unlocked=true anyway`); });
      } else {
        _unlocked = true;
        _debugLog('unlock: play() returned no promise (old browser path), _unlocked=true');
      }
    } else {
      _debugLog('unlock: already unlocked, skipping');
    }
  }

  /**
   * 多音字 → { word: annotated reading }.
   *
   * Populated from data/heteronyms.json by loadHeteronyms(). Left empty on
   * any load failure, which degrades speakChar() back to speaking the bare
   * character — the behaviour before this table existed — rather than
   * breaking playback.
   */
  let HETERONYMS = {};

  /**
   * Load the 多音字 table. Safe to call more than once; a failure is logged
   * and swallowed, since mispronouncing a 多音字 is a much smaller problem
   * than no audio at all.
   * @returns {Promise<number>} How many characters were loaded
   */
  async function loadHeteronyms() {
    try {
      const res = await fetch('data/heteronyms.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      HETERONYMS = await res.json();
      _debugLog(`heteronyms: loaded ${Object.keys(HETERONYMS).length} characters`);
    } catch (e) {
      _debugLog(`heteronyms: load failed (${e.message}) — bare characters will be spoken`);
      HETERONYMS = {};
    }
    return Object.keys(HETERONYMS).length;
  }

  /**
   * Recorded syllables (audio/syllables/, built by
   * scripts/gen_syllable_audio.py). A textbook card whose pinyin is listed
   * here plays the recording of exactly that toned syllable — zhì for 掷,
   * zhuǎ for 爪 — instead of asking TTS, which only sees the character and
   * guesses the reading. Cards whose syllable has no recording (ü, neutral
   * tone, a few others) keep the TTS path below unchanged.
   *
   * Empty until loadSyllables() succeeds, so a failed or slow load only
   * means TTS is used, as before.
   */
  let SYLLABLES = new Set();
  let RECORDED_CHARS = new Set();
  const SYLLABLE_DIR = 'audio/syllables/';

  /**
   * Which voice a card with a recording tries first (使用说明 → 朗读声音).
   * The other is the fallback, so either choice still makes a sound.
   *
   * Stored per device (State.saveShared), not per child: whether online
   * TTS works at all depends on the browser and network (Huawei/Xiaomi
   * browsers, offline use), and the parent sets it once for the device.
   * Not exported with a profile, for the same reason as lastVolume.
   * Anything unrecognised — a hand-edited value, a future option this
   * version does not know — reads as the default.
   */
  const VOICE_RECORDING = 'recording';
  const VOICE_ONLINE = 'online';
  const VOICE_KEY = 'voicePreference';
  let _voicePreference = VOICE_RECORDING;

  function _readVoicePreference() {
    const v = State.loadShared(VOICE_KEY, VOICE_RECORDING);
    return v === VOICE_ONLINE ? VOICE_ONLINE : VOICE_RECORDING;
  }

  /** @returns {string} 'recording' (default) or 'online' */
  function getVoicePreference() { return _voicePreference; }

  /**
   * @param {string} v - 'recording' or 'online'; anything else is ignored
   * @returns {boolean} whether it was accepted
   */
  function setVoicePreference(v) {
    if (v !== VOICE_RECORDING && v !== VOICE_ONLINE) return false;
    _voicePreference = v;
    State.saveShared(VOICE_KEY, v);
    _debugLog(`voice preference: ${v}`);
    return true;
  }

  /** @returns {Promise<number>} how many syllables are available */
  async function loadSyllables() {
    try {
      const res = await fetch(SYLLABLE_DIR + 'index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const index = await res.json();
      SYLLABLES = new Set(Array.isArray(index.syllables) ? index.syllables : []);
      RECORDED_CHARS = new Set(typeof index.chars === 'string' ? [...index.chars] : []);
      _debugLog(`syllables: ${SYLLABLES.size} recordings for ${RECORDED_CHARS.size} characters`);
    } catch (e) {
      _debugLog(`syllables: load failed (${e.message}) — TTS for every card`);
      SYLLABLES = new Set();
      RECORDED_CHARS = new Set();
    }
    return SYLLABLES.size;
  }

  const _TONE_OF = { '\u0304': '1', '\u0301': '2', '\u030c': '3', '\u0300': '4' };

  /**
   * File name for one toned syllable: 'zhuǎ' → 'zhua3', 'lǜ' → 'lv4',
   * 'de' → 'de5'. null for anything that is not a single syllable.
   *
   * Mirrors syllable_key() in scripts/gen_syllable_audio.py, which named
   * the files; the suite checks the two agree. ü must stay distinct from u:
   * the source has no ü recordings, and lu4 is 路, not 绿.
   */
  function _syllableKey(reading) {
    const r = String(reading || '').trim().toLowerCase();
    if (!r || /\s/.test(r)) return null;
    let tone = '5';
    let base = '';
    for (const ch of r.normalize('NFD')) {
      if (_TONE_OF[ch]) tone = _TONE_OF[ch];
      else if (ch === '\u0308') base = base.endsWith('u') ? base.slice(0, -1) + 'v' : base + 'v';
      else if (ch >= 'a' && ch <= 'z') base += ch;
      else return null;
    }
    return base ? base + tone : null;
  }

  /**
   * The recording for a card, or null when it should use TTS. Which cards
   * qualify (all, or only 多音字) is decided by the generator and shipped
   * as index.chars, so widening it later is a data change, not a code one.
   *
   * Custom cards always use TTS. Their pinyin is typed by a parent, and a
   * slip (qín typed as qin3) would play a confidently wrong syllable; TTS
   * at least reads the character itself. They also do not need it for the
   * reason the textbook cards do — their reading was not checked here.
   */
  function _recordingFor(charData) {
    if (!charData || charData.isCustom || !SYLLABLES.size || !RECORDED_CHARS.has(charData.char)) return null;
    const key = _syllableKey(charData.pinyin);
    return key && SYLLABLES.has(key) ? SYLLABLE_DIR + key + '.mp3' : null;
  }

  /**
   * Speak a character or text aloud.
   * MUST be called from a user gesture (click/tap) for iOS.
   * @param {string} text - Text to speak
   * @param {Function} [onDone] - Called exactly once, when the sound is
   *   genuinely over: audio played to the end (onended), the Web Speech
   *   API utterance finished (onend), or every source failed/timed out
   *   and there's nothing left to wait for. Never left uncalled — a dead
   *   or slow-to-start source still resolves this via speech.startTimeoutMs,
   *   so a caller can safely chain more delay after onDone without risking
   *   a hang (see js/controllers.js ChallengeController._advanceAfterSpeech,
   *   which adds quizFeedbackDelayMs on top of onDone before advancing).
   * @param {Object} [opts]
   * @param {string} [opts.recording] - URL of a recorded syllable to try
   *   before TTS (speakChar() supplies it; see _recordingFor)
   */
  function speak(text, onDone, opts = {}) {
    if (!text) { if (onDone) onDone(); return; }

    // Overlap rule. A real-device log (iPhone 16, iOS Safari) showed two
    // speak() calls interleaving — a second tap of 朗读 before the first
    // had finished. Each call reassigns _audio's listeners and (in the Web
    // Speech path) calls speechSynthesis.cancel(), which silently killed
    // the first call: "no sound at first, works after tapping 2-3 times".
    //
    // So a repeat tap of the SAME text is still ignored — the sound the
    // child just triggered is allowed to finish. But a DIFFERENT text now
    // stops the old one and starts immediately. Ignoring everything, as
    // before, made one slow clip block the whole app: a Huawei browser that
    // never fired onended held 「人」 "in flight" for the full 4s ceiling and
    // dropped two taps on 「地」 (on-device log). The old call is settled
    // first, so its onDone fires exactly once, before the new call starts.
    if (_current) {
      if (_current.text === text) {
        _debugLog(`speak("${text}") IGNORED — the same text is still playing`);
        return;
      }
      _debugLog(`speak("${text}") replaces "${_current.text}", which is stopped`);
      if (_cancelActive) _cancelActive();
      _current.finish('replaced');
    }

    let settled = false;
    const call = { text, finish: null };
    call.finish = (reason) => {
      if (settled) return;
      settled = true;
      if (_current === call) { _current = null; _cancelActive = null; }
      if (reason) _debugLog(`speak("${text}") done (${reason})`);
      if (onDone) onDone();
    };
    _current = call;
    const done = () => call.finish();

    _debugLog(`speak("${text}") called`);

    if (_testPlayback) {
      // Test seam: the overlap rule above is what is under test; real audio
      // cannot be driven from the suite. The stub receives the cancel hook
      // so it can behave like a real attempt, and the recording (if any) so
      // a test can assert which audio would have played.
      _testPlayback(text, done, (cancel) => { _cancelActive = cancel; }, opts.recording || null);
      return;
    }

    // Which sources, in which order: decided in _plan (one place, testable
    // without audio). The recording has its own, shorter start timeout
    // (speech.recordingStartTimeoutMs): a local file starts in a few ms, so
    // a long wait would only delay the next source. iOS paths are not yet
    // verified on a real iPhone.
    const plan = _plan(text, opts.recording || null);
    _debugLog(`plan: ${plan.kind}${plan.kind === 'urls' ? ' [' + plan.sources.map(_sourceLabel).join(', ') + ']' : ''} (voice: ${_voicePreference})`);
    if (plan.kind === 'webspeech') {
      _speakWebAPI(text, done);
      return;
    }
    _ensureAudio();
    _playSources(plan.sources, 0, text, done);
  }

  /**
   * Decide how to speak `text`: the single place that orders the sources.
   *
   * Returns { kind: 'webspeech' } to speak with the Web Speech API right
   * away, or { kind: 'urls', sources } to try URL sources in order (Web
   * Speech is still the last resort after them, inside _playSources).
   *
   * Rules, by priority:
   *   1. iOS without a recording → Web Speech first. speechSynthesis.speak()
   *      only works inside a tap's call stack (or a short window after it).
   *      On-device logs (iPhone 16): Google and Baidu both timed out on that
   *      network (2.5 s each), so Web Speech, as the last resort, ran ~5 s
   *      after the tap — voices loaded, speak() was called, and the
   *      utterance was silently dropped (no onstart/onend/onerror). Desktop
   *      keeps URL sources first: Google/Baidu sound better there.
   *   2. iOS with a recording, 在线语音 chosen → Web Speech first too, for
   *      the same reason; it is iOS's online voice. Falls back to the
   *      recording only when the browser has no speech engine.
   *   3. A recording otherwise → the parent's order (使用说明 → 朗读声音):
   *        录音  recording, then online TTS (none on iOS)
   *        在线  online TTS, then the recording
   *   4. No recording → online TTS.
   * "Fails" in the fallbacks means a source did not start (error, 404,
   * start timeout) — the only signal every browser gives reliably. Web
   * Speech stays last: it cannot report that it made no sound.
   *
   * @param {string} text - what TTS would read
   * @param {string|null} recording - the card's syllable file, if any
   * @returns {{kind: 'webspeech'}|{kind: 'urls', sources: string[]}}
   */
  function _plan(text, recording) {
    const ios = _isIOS();
    if (!recording) {
      return ios ? { kind: 'webspeech' } : { kind: 'urls', sources: _ttsSources(text) };
    }
    if (ios && _voicePreference === VOICE_ONLINE && _hasWebSpeech()) {
      return { kind: 'webspeech' };
    }
    return { kind: 'urls', sources: _sourceOrder(recording, ios ? [] : _ttsSources(text)) };
  }

  /** Short name of a source URL for the debug log. */
  function _sourceLabel(url) {
    return url.includes('baidu') ? 'baidu'
      : url.includes('googleapis') ? 'google'
      : url.startsWith(SYLLABLE_DIR) ? 'recording' : 'localTTS';
  }

  /**
   * Sources for a card that has a recording, in the order to try them.
   * One function so the order is defined once and can be tested without
   * playing audio.
   * @param {string} recording - the card's syllable file
   * @param {string[]} online - TTS URLs (empty on iOS, see speak())
   * @returns {string[]}
   */
  function _sourceOrder(recording, online) {
    return _voicePreference === VOICE_ONLINE
      ? [...online, recording]
      : [recording, ...online];
  }

  /** The online TTS URLs for text, in the order they are tried. */
  function _ttsSources(text) {
    const sources = [];
    const encoded = encodeURIComponent(text);

    if (_useLocalTTS) sources.push(`/tts?text=${encoded}`);
    // Pass the configured rate to Google too. Without it Google plays at
    // full speed while Baidu (spd=4) is already slowed, and since Google is
    // tried first that is the voice a child actually hears — reported as
    // the reading being too fast to follow.
    const rate = State.config('speech.rate', 0.8);
    const gRate = (typeof rate === 'number' && rate > 0 && rate < 1)
      ? `&ttsspeed=${rate}` : '';
    sources.push(GOOGLE_URL + encoded + gRate);
    sources.push(BAIDU_URL + encoded);
    return sources;
  }

  /**
   * Speak a taught character, using one of its words to pin the reading.
   *
   * A 多音字 read on its own gets whatever the TTS engine considers its
   * default: 爪 is annotated zhuǎ in the grade 1 textbook ('爪子'), but
   * every engine says zhǎo for the bare character, because that is the
   * commoner reading. 262 of the 4014 characters here are annotated with a
   * reading that differs from the bare-character default, so this is not
   * one stray card.
   *
   * Speaking a WORD instead resolves it — engines disambiguate 多音字 from
   * context, and '爪子' is said zhuǎ zi. The child is looking at the
   * character and its words on screen, so hearing '爪子' rather than a bare
   * 爪 is if anything more useful: it is how the character is actually
   * pronounced in use.
   *
   * The word is only substituted when it is genuinely needed:
   *   * no pinyin on the card → nothing to check against, speak the char
   *   * bare char already matches the annotation → speak the char
   *   * a word exists whose reading matches → speak that word
   * Falling back to the bare character whenever no word matches keeps the
   * 31 cards whose 词语 disagree with their 拼音 no worse than before.
   *
   * @param {Object} charData - Card data: { char, pinyin, words }
   * @param {Function} [onDone] - As speak()
   */
  function speakChar(charData, onDone) {
    if (!charData || !charData.char) { if (onDone) onDone(); return; }
    // A recording of the card's own syllable, when there is one, is tried
    // first; TTS still speaks the reading-pinning word if it fails.
    speak(_readingContext(charData), onDone, { recording: _recordingFor(charData) });
  }

  /**
   * Speak one character of a story in the reading it has there.
   *
   * Unlike speakChar() the reading comes from the story, not a card: 影子
   * taps as zi although the 子 card says zǐ, 一个 as yí. So the syllable
   * recording is chosen from that reading for any character — the story's
   * readings were checked by scripts/check_stories.py and a person, which is
   * the reason recordings are limited to known cards elsewhere. Online TTS
   * cannot be told a reading, so it only follows when there is no recording;
   * for the few neutral-tone syllables the source lacks (le5, de5) that is
   * the bare character, which every engine reads in its usual reading.
   * @param {string} char
   * @param {string} reading - toned pinyin, e.g. 'zi', 'yí'
   * @param {Function} [onDone] - As speak()
   */
  function speakReading(char, reading, onDone) {
    const key = _syllableKey(reading);
    const recording = key && SYLLABLES.has(key) ? SYLLABLE_DIR + key + '.mp3' : null;
    speak(char, onDone, { recording });
  }

  /**
   * Pick the text that makes a TTS engine produce the annotated reading.
   * Exposed for testing; see speakChar() for why this is needed.
   * @param {Object} charData - Card data: { char, pinyin, words }
   * @returns {string} The character, or a word containing it
   */
  function _readingContext(charData) {
    const ch = charData.char;
    const want = (charData.pinyin || '').trim();
    const words = Array.isArray(charData.words) ? charData.words : [];
    if (!want || !words.length) return ch;

    // Only reach for a word when the bare character is actually ambiguous,
    // so the overwhelming majority of cards keep speaking the single
    // character exactly as before.
    if (!HETERONYMS[ch]) return ch;

    const readings = HETERONYMS[ch];
    for (const w of words) {
      if (typeof w !== 'string' || !w.includes(ch)) continue;
      // Use the word only when the table says that word selects the reading
      // THIS card is annotated with. Without the check, 喝 annotated hè
      // would be read as 喝水 (hē), and 间 annotated jiān would pick up
      // 中间 — which the table records as jiàn from a different lesson.
      //
      // Tone must agree exactly, mirroring scripts/gen_heteronyms.py. A
      // tone-insensitive compare equates hē with hè, which is precisely how
      // 喝水 came to be spoken for a card reading hè; the table is clean
      // today, but the player must not depend on that.
      if (readings && readings[w] && _readingMatches(readings[w], want)) return w;
    }
    // No word is known to produce the annotated reading, so there is nothing
    // to gain by guessing: an unvalidated word is as likely to be wrong as
    // the bare character, and hearing '喝水' for a card that says hè is more
    // confusing to a child than hearing a single character. Most cards that
    // land here are already correct as a bare character.
    return ch;
  }

  /**
   * Does `reading` satisfy the card's annotation `want`?
   *
   * Exact match, or — only when the annotation is neutral tone, which the
   * textbook writes without a mark ('爪子' as zi) — the same syllable
   * ignoring tone. Never ignores tone between two toned syllables.
   */
  function _readingMatches(reading, want) {
    if (reading === want) return true;
    if (_hasTone(want)) return false;
    return _toneless(reading) === _toneless(want);
  }

  /** True if the syllable carries a tone mark (so not neutral tone). */
  function _hasTone(syllable) {
    return /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(syllable);
  }

  /** Strip tone marks so 'zhuǎ' and 'zhua' compare equal. */
  function _toneless(p) {
    return p.normalize('NFD').replace(/[\u0300-\u030f]/g, '')
      .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e')
      .replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o')
      .replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜü]/g, 'v')
      .toLowerCase();
  }

  /**
   * True on iOS Safari/WebKit (iPhone, iPad, and iPadOS 13+ which reports
   * as "MacIntel" but still runs WebKit with touch support) — the only
   * platform with the user-gesture-expiry constraint this function exists
   * to work around. Deliberately NOT based on viewport width (unlike
   * MobileUI.isMobile()): an iPad in landscape can be wider than most
   * desktop windows and still have this constraint, while a narrow desktop
   * browser window does not.
   */
  let _iosForTest = null;   // test-only override; see _setIOSForTest

  function _isIOS() {
    if (_iosForTest !== null) return _iosForTest;
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  }

  /** Whether this browser has a speech engine at all (Web Speech API). */
  function _hasWebSpeech() {
    return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /**
   * Try each audio source in order. If a source starts playing, wait for it
   * to finish (onended) before calling onDone — a source that never even
   * STARTS within speech.startTimeoutMs is abandoned in favor of the next
   * source. Reuses the same _audio element (critical for iOS).
   *
   * iOS Safari fix: 'stalled' fires spuriously on healthy CORS audio
   * streams on iOS far more readily than on desktop Chrome — treating it
   * as "this source failed" even AFTER onplaying already fired means a
   * correctly-starting source gets abandoned mid-playback (cutting off
   * sound that was about to be heard) and we jump to the next source
   * instead of just letting the first one finish. So 'stalled'/'error'
   * only abandon the source if they happen BEFORE playback is confirmed
   * started; once onplaying has fired, only onended (real completion)
   * moves things forward — a post-playing stall is treated as "still
   * going", not "failed".
   */
  function _playSources(sources, index, text, onDone) {
    if (index >= sources.length) {
      _debugLog('all URL sources exhausted -> falling back to Web Speech API');
      // All URL sources failed to even start — try Web Speech API, which
      // owns calling onDone itself once that utterance ends (or immediately
      // if unsupported, so onDone is still never left uncalled).
      _speakWebAPI(text, onDone);
      return;
    }

    const sourceLabel = _sourceLabel(sources[index]);
    _debugLog(`[${index}] trying source: ${sourceLabel}`);

    let settled = false;
    let started = false;
    const startTimeoutMs = sourceLabel === 'recording'
      ? State.config('speech.recordingStartTimeoutMs', 1200)
      : State.config('speech.startTimeoutMs', 2500);
    let startTimer = null;
    let maxPlayTimer = null;

    // Lets a newer speak() stop this attempt: silence the element and make
    // every pending callback below a no-op, so the old call cannot fall
    // through to the next source or fire onDone a second time.
    _cancelActive = () => {
      settled = true;
      if (startTimer) clearTimeout(startTimer);
      if (maxPlayTimer) clearTimeout(maxPlayTimer);
      _audio.onplaying = _audio.onended = _audio.onerror = _audio.onstalled = null;
      try { _audio.pause(); } catch (_e) { /* nothing to stop */ }
    };

    const giveUpOnThisSource = (reason) => {
      if (settled || started) return; // never abandon a source once it's confirmed playing
      settled = true;
      _debugLog(`[${index}] ${sourceLabel} FAILED before playing (${reason})`);
      if (startTimer) clearTimeout(startTimer);
      // Try next source
      _playSources(sources, index + 1, text, onDone);
    };

    // `via` says what ended playback. The log used to print
    // "onended/maxPlayMs" for both, which hid that a Huawei browser never
    // fires onended — it only showed up as a 4.001s gap between timestamps.
    const finished = (via) => {
      if (settled) return;
      settled = true;
      _debugLog(`[${index}] ${sourceLabel} finished via ${via} — onDone firing`);
      if (startTimer) clearTimeout(startTimer);
      if (maxPlayTimer) clearTimeout(maxPlayTimer);
      if (onDone) onDone();
    };

    // Remove old listeners
    _audio.onplaying = null;
    _audio.onended = null;
    _audio.onerror = null;
    _audio.onstalled = null;

    // Once playback actually starts, stop racing the start-timeout — a
    // slow-to-START source should be abandoned, but a source that DID
    // start should be allowed to finish even if that takes longer than
    // startTimeoutMs (that's not "slow to start", that's just how long
    // the word takes to say), and a spurious post-start stall/error
    // (common on iOS) should not cut it off either — see function comment.
    // maxPlayTimer is the backstop for the other half of that tradeoff: if
    // onended genuinely never comes (a real failure mid-playback, not a
    // spurious stall), we still must not hang forever — a single spoken
    // character/word has no business taking longer than this.
    _audio.onplaying = () => {
      // 'playing' fires again after a mid-clip stall resumes; the ceiling
      // is set once, from the first start, or timers would stack.
      if (started) return;
      started = true;
      if (startTimer) clearTimeout(startTimer);
      // Prefer the clip's own length as the backstop: a single character is
      // about 1s, and a browser that never fires onended (Huawei, on-device
      // log) used to hold every later tap for the full maxPlayMs. The
      // duration is only known once metadata has loaded; fall back to
      // maxPlayMs when it is missing, zero or not finite (streams).
      const maxPlayMs = State.config('speech.maxPlayMs', 4000);
      const remaining = (_audio.duration - (_audio.currentTime || 0)) * 1000;
      const known = Number.isFinite(remaining) && remaining > 0;
      const ceiling = known
        ? Math.min(Math.ceil(remaining) + PLAY_END_GRACE_MS, maxPlayMs)
        : maxPlayMs;
      _debugLog(`[${index}] ${sourceLabel} onplaying fired — audio IS audibly playing ` +
        `(${known ? `clip ${Math.round(remaining)}ms` : 'length unknown'}, ceiling ${ceiling}ms)`);
      maxPlayTimer = setTimeout(
        () => finished(known ? 'clip-length ceiling (onended never fired)' : 'maxPlayMs ceiling (onended never fired)'),
        ceiling);
    };
    _audio.onended = () => finished('onended');
    _audio.onerror = () => giveUpOnThisSource(`onerror, code=${_audio.error && _audio.error.code}`);
    _audio.onstalled = () => giveUpOnThisSource('onstalled');

    _audio.src = sources[index];
    _audio.currentTime = 0;
    _audio.volume = 1;

    startTimer = setTimeout(() => giveUpOnThisSource('startTimeoutMs elapsed, onplaying never fired'), startTimeoutMs);

    _audio.play().catch((e) => giveUpOnThisSource(`play() rejected: ${e && e.name}`));
  }

  /**
   * Last resort: Web Speech API. Always calls onDone exactly once.
   *
   * iOS Safari fix: speechSynthesis can silently fail to fire onend/onerror
   * at all — e.g. if this is called outside the originating tap's user-
   * gesture window (which _playSources's async retry chain can drift into),
   * or if the synthesis engine just doesn't cooperate on that device. There
   * is no reliable "it started" event to lean on here (unlike <audio>'s
   * onplaying), so onDone would otherwise never fire and the caller (the
   * quiz's "wait for the sound, then advance" step) hangs forever. Guard
   * with an estimated-duration timeout as a hard ceiling.
   */
  function _speakWebAPI(text, onDone) {
    if (!text) { if (onDone) onDone(); return; }
    if (!_hasWebSpeech()) {
      // Was a silent return: the log just stopped after "falling back to
      // Web Speech API", which is all the Huawei/Xiaomi reports showed.
      _debugLog('WebAPI: speechSynthesis not available in this browser — no sound');
      if (onDone) onDone();
      return;
    }

    let settled = false;
    let ceilingTimer = null;
    let startDelay = null;
    const finish = (via) => {
      if (settled) return;
      settled = true;
      _debugLog(`WebAPI: finished via ${via}`);
      if (ceilingTimer) clearTimeout(ceilingTimer);
      if (onDone) onDone();
    };
    // A newer speak() stops this utterance without firing this onDone; the
    // newer call settles the old one itself (see speak()).
    _cancelActive = () => {
      settled = true;
      if (startDelay) clearTimeout(startDelay);
      if (ceilingTimer) clearTimeout(ceilingTimer);
      try { speechSynthesis.cancel(); } catch (_e) { /* nothing to stop */ }
    };

    // iOS Safari fix: cancel() immediately followed by speak() on the same
    // tick is a known trigger for the engine silently swallowing the new
    // utterance — it has no time to actually clear its internal state
    // before being told to speak again, so the utterance gets queued but
    // never actually spoken (no onend, no onerror, nothing — matches the
    // on-device debug log that led here: "68 voices available, zhVoice
    // found" yet "finished via ceilingTimer, onend/onerror never fired").
    // A tiny setTimeout gap is the documented community workaround.
    speechSynthesis.cancel();
    startDelay = setTimeout(() => {
      if (settled) return; // replaced by a newer speak() during the gap
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      const rate = State.config('speech.rate', 0.8);
      utterance.rate = rate;
      const voices = speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.startsWith('zh'));
      if (zhVoice) utterance.voice = zhVoice;
      _debugLog(`WebAPI: ${voices.length} voices available, zhVoice=${zhVoice ? zhVoice.name : 'NONE FOUND'}`);

      utterance.onstart = () => _debugLog('WebAPI: onstart fired — speechSynthesis IS attempting to speak');
      utterance.onend = () => finish('onend');
      utterance.onerror = (e) => finish(`onerror(${e && e.error})`);

      // ~400ms per character at rate 1.0 is a generous estimate for short
      // single-character/word TTS; scale by rate (lower rate = slower
      // speech) and add headroom. This only matters when onend/onerror
      // never fire.
      const estimatedMs = Math.max(600, (text.length * 400) / rate) + 500;
      ceilingTimer = setTimeout(() => finish('ceilingTimer (onend/onerror never fired)'), estimatedMs);

      speechSynthesis.speak(utterance);

      // iOS Safari's speechSynthesis can silently sit idle after speak()
      // without ever actually starting — a separate, documented quirk
      // from the cancel()+speak() race above. resume() right after speak()
      // is the community workaround to nudge it out of that idle state.
      speechSynthesis.resume();
    }, 50);
  }

  /** Initialize: detect local TTS server, preload Web Speech voices */
  function init() {
    _voicePreference = _readVoicePreference();
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

  return {
    speak, init, speakChar, speakReading, loadHeteronyms, loadSyllables,
    getVoicePreference, setVoicePreference, VOICE_RECORDING, VOICE_ONLINE,
    // Exposed so tests can assert the reading choice without playing audio
    _readingContext, _recordingFor, _syllableKey, _sourceOrder, _plan,
    // Exposed so tests can drive the speak() overlap rule without real
    // audio. Each attempt is the function that would play one URL source
    // or utterance; null restores the real one. Test-only.
    _setPlaybackForTest: (fn) => { _testPlayback = fn; },
    // Treat the browser as iOS (true), not iOS (false), or detect (null).
    // Test-only: lets the suite exercise the iOS ordering on desktop.
    _setIOSForTest: (v) => { _iosForTest = v; },
    _isSpeakingForTest: () => _current !== null
  };
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

  /**
   * Put a character in 生字本 if it is not there yet. Never removes.
   *
   * The story reader calls this on every tap, and a child who does not know
   * a character taps it two or three times to hear it again. toggle() would
   * take it back out on every second tap — the less familiar the character,
   * the likelier it ends up missing.
   * @param {string} char
   * @returns {boolean} true if it was added now, false if it was already there
   */
  function add(char) {
    const favs = State.get('favorites');
    if (favs.includes(char)) return false;
    favs.push(char);
    State.set('favorites', favs);
    State.persist('favorites');
    return true;
  }

  return { toggle, add, isFavorite, getAll, setContext, getContext, remove };
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
 * The four input fields are deliberately the same four a textbook character
 * has — 正面/拼音/词语/例句 → {char, pinyin, words, sentence} — so cards flow
 * through the flashcard, SRS and quiz paths with no special-casing, and all
 * four question types work.
 *
 * Only 正面 is required. Each other field unlocks capability:
 *   拼音 → 字→音 and 音→字 (without it the card never appears in 挑战,
 *          so validate() returns a warning rather than accepting silently)
 *   词语 → 字→词
 *   例句 containing the front → 填空
 *
 * Legacy shape: cards created before 词语/例句 existed have a single `back`
 * field (labelled "反面（意思、例句、翻译…）"). Those still live in people's
 * browsers and inside already-downloaded backup files, so reads normalise
 * `back` → `sentence` on the way out instead of migrating the store in place.
 * An in-place rewrite would also need the write to succeed, which is the one
 * thing that cannot be assumed (see State's storage-failure handling).
 */
const CustomCardService = (() => {
  const MAX_FRONT = 8;    // a card front is a char or short word, not a sentence
  const MAX_BACK = 200;
  const MAX_PINYIN = 60;
  const MAX_WORDS = 120;  // the whole comma-separated list, not one word
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
   * Split the 词语 field into an array.
   *
   * Accepts Chinese and ASCII commas plus whitespace, because a parent
   * typing on a phone keyboard gets whichever comma the IME offers.
   *
   * @param {string|string[]} raw
   * @returns {string[]}
   */
  function _parseWords(raw) {
    if (Array.isArray(raw)) return raw.map(w => String(w).trim()).filter(Boolean);
    return String(raw || '')
      .split(/[,，、\s]+/)
      .map(w => w.trim())
      .filter(Boolean);
  }

  /**
   * Normalise a stored card to the current four-field shape.
   *
   * Cards created before 词语/例句 existed have `back` (labelled
   * "反面（意思、例句、翻译…）") and no `words`. Those are still in people's
   * browsers and inside already-downloaded backup files, so every read goes
   * through here rather than migrating the store in place — a rewrite would
   * also have to succeed on a device where writes fail, which is exactly
   * the case that cannot be relied on.
   *
   * `back` is mapped to `sentence`: that is how it was already being
   * consumed (asChars put it in `sentence`), so behaviour is unchanged for
   * existing cards.
   */
  function _normalise(c) {
    if (!c || typeof c !== 'object') return null;
    const front = String(c.front || '').trim();
    if (!front) return null;
    return {
      front,
      pinyin: String(c.pinyin || '').trim(),
      words: _parseWords(c.words),
      // Prefer the new field; fall back to the legacy one.
      sentence: String(c.sentence != null ? c.sentence : (c.back || '')).trim(),
      created: c.created || ''
    };
  }

  /**
   * Validate a would-be card without saving it.
   *
   * Only 正面 is required. 拼音 is optional but gates the quiz: without it a
   * card cannot be asked as 字→音 or 音→字, so the caller is told rather
   * than the card silently never appearing in a round. 词语 and 例句 are
   * optional and each unlock one more question type.
   *
   * @param {Object|string} input - {front, pinyin, words, sentence} (a bare
   *   string is treated as `front`, for the older positional call style)
   * @param {string} [legacySentence] - positional form: add(front, back, pinyin)
   * @param {string} [legacyPinyin]
   * @param {Object} [opts]
   * @param {string} [opts.replacing] - front of the card being edited: it may
   *   keep its own front, and it does not count against MAX_CARDS
   * @returns {Object} {ok, error, warning}
   */
  function validate(input, legacySentence, legacyPinyin, opts = {}) {
    const o = (typeof input === 'string')
      ? { front: input, sentence: legacySentence, pinyin: legacyPinyin }
      : (input || {});
    const f = String(o.front || '').trim();
    const p = String(o.pinyin || '').trim();
    const s = String(o.sentence != null ? o.sentence : (o.back || '')).trim();
    const wordsRaw = (typeof o.words === 'string') ? o.words : _parseWords(o.words).join('，');

    if (!f) return { ok: false, error: '正面不能为空', warning: '' };
    if (f.length > MAX_FRONT) return { ok: false, error: `正面最多 ${MAX_FRONT} 个字`, warning: '' };
    if (p.length > MAX_PINYIN) return { ok: false, error: `拼音最多 ${MAX_PINYIN} 个字符`, warning: '' };
    if (wordsRaw.length > MAX_WORDS) return { ok: false, error: `词语一共最多 ${MAX_WORDS} 个字`, warning: '' };
    if (s.length > MAX_BACK) return { ok: false, error: `例句最多 ${MAX_BACK} 个字`, warning: '' };

    const existing = _load();
    const self = opts.replacing != null ? String(opts.replacing).trim() : null;
    if (existing.some(c => {
      const front = String(c.front || '').trim();
      return front === f && front !== self;
    })) {
      return { ok: false, error: `「${f}」已经有卡片了`, warning: '' };
    }
    if (self === null && existing.length >= MAX_CARDS) {
      return { ok: false, error: `最多 ${MAX_CARDS} 张卡片`, warning: '' };
    }
    // Valid, but say so if the card will be unusable in 挑战 — silently
    // accepting it and never quizzing it is the worse outcome.
    return {
      ok: true,
      error: '',
      warning: p ? '' : '没填拼音，这张卡不会出现在挑战模式里'
    };
  }

  /**
   * Add a card.
   *
   * @param {Object|string} input - {front, pinyin, words, sentence}, or the
   *   front string for the older add(front, back, pinyin) call style
   * @param {string} [legacySentence]
   * @param {string} [legacyPinyin]
   * @returns {Object} {ok, error, warning, card}
   */
  /**
   * The stored shape of a card built from form input. Shared by add() and
   * update() so the two can never disagree on how a field is cleaned.
   * @param {Object} o - {front, pinyin, words, sentence} (or legacy `back`)
   * @param {string} created - YYYY-MM-DD, or '' when unknown
   */
  function _cardFrom(o, created) {
    return {
      front: String(o.front || '').trim(),
      pinyin: String(o.pinyin || '').trim(),
      words: _parseWords(o.words),
      sentence: String(o.sentence != null ? o.sentence : (o.back || '')).trim(),
      created
    };
  }

  function add(input, legacySentence, legacyPinyin) {
    const o = (typeof input === 'string')
      ? { front: input, sentence: legacySentence, pinyin: legacyPinyin }
      : (input || {});
    const check = validate(o);
    if (!check.ok) return { ok: false, error: check.error, warning: '', card: null };
    const card = _cardFrom(o, new Date().toISOString().slice(0, 10));
    const cards = _load();
    cards.push(card);
    _save(cards);
    return { ok: true, error: '', warning: check.warning, card };
  }

  /**
   * Replace a card's fields in place.
   *
   * The card keeps its position and its `created` date, so editing does not
   * reorder the list or make an old card look new. Validation is the same as
   * add(), except the card may keep its own front.
   *
   * Learning progress (智能复习, 错题本, 收藏) is keyed by the front text. A
   * changed 拼音/词语/例句 keeps it. A changed 正面 is a different
   * character: its old progress is deliberately not carried over — the
   * child's record for 秦 says nothing about 泰 — and `frontChanged` lets
   * the caller say so.
   *
   * @param {string} front - the card's current front
   * @param {Object} input - {front, pinyin, words, sentence}
   * @returns {Object} {ok, error, warning, card, frontChanged}
   */
  function update(front, input) {
    const key = String(front || '').trim();
    const fail = error => ({ ok: false, error, warning: '', card: null, frontChanged: false });
    const cards = _load();
    const idx = cards.findIndex(c => String(c.front || '').trim() === key);
    if (idx < 0) return fail('找不到这张卡片，可能已经删除了');
    const o = input || {};
    const check = validate(o, undefined, undefined, { replacing: key });
    if (!check.ok) return fail(check.error);
    // A legacy card may lack `created`; keep it absent rather than invent a
    // date that would misreport when the card was made.
    const card = _cardFrom(o, cards[idx].created || '');
    cards[idx] = card;
    _save(cards);
    return { ok: true, error: '', warning: check.warning, card, frontChanged: card.front !== key };
  }

  /** @returns {Object|null} one card in the four-field shape */
  function get(front) {
    const key = String(front || '').trim();
    return getAll().find(c => c.front === key) || null;
  }

  /**
   * Remove a card by its front text.
   * @returns {boolean} whether a card was removed
   */
  function remove(front) {
    const cards = _load();
    const next = cards.filter(c => String(c.front || '').trim() !== String(front || '').trim());
    if (next.length === cards.length) return false;
    _save(next);
    return true;
  }

  /** @returns {Array} stored cards, newest first, in the four-field shape */
  function getAll() {
    return _load().map(_normalise).filter(Boolean).reverse();
  }

  /**
   * @returns {number} how many usable custom cards exist
   *
   * Counts what getAll() would return, not raw array length: _normalise
   * drops entries with no usable front (null, {}, a blank string — possible
   * in a hand-edited or partially-corrupt store), and a sidebar badge
   * reading "5张" above a list showing one card is worse than either number
   * alone. Every caller here is a count shown next to that list.
   */
  function count() {
    return _load().reduce((n, c) => n + (_normalise(c) ? 1 : 0), 0);
  }

  /**
   * Cards in the same shape as textbook characters, so every existing path
   * (flashcards, SRS, quiz) consumes them without special-casing.
   *
   * Now a straight field-for-field mapping: the four inputs are deliberately
   * the same four fields a textbook character has ({char, pinyin, words,
   * sentence}), which is what lets 字→词 work on a custom card at all —
   * `words` used to be hardcoded empty here, so DataService silently
   * downgraded that question type to 字→音 (see its pickWord fallback).
   *
   * grade/semester are 0 to mark "not from a textbook" — the same convention
   * the error-book branch already uses for synthesised entries.
   *
   * @returns {Array} [{char, pinyin, words, sentence, grade, semester, isCustom}]
   */
  function asChars() {
    return getAll().map(c => ({
      char: c.front,
      pinyin: c.pinyin,
      words: c.words,
      sentence: c.sentence,
      grade: 0,
      semester: 0,
      isCustom: true
    }));
  }

  return { add, update, get, remove, getAll, count, asChars, validate, parseWords: _parseWords };
})();

/**
 * Suggest 拼音/词语/例句 for a custom card from the textbook data.
 *
 * Why the textbook and not a generator: the 4014 生字 already carry checked
 * pinyin, words and real sentences, and they are loaded at startup
 * (State.allChars), so suggestions are instant, offline, and are exactly
 * what the child meets in class. Invented sentences could be wrong in ways a
 * parent cannot spot. Nothing is saved here: the form is filled for the
 * parent to edit and confirm, so a suggestion is never a card by itself.
 *
 * Result shape, consumed by ModalUI.renderCardSuggestion():
 *   { kind, front, options: [Option] }
 *   kind 'char'    the front is one textbook 生字; one Option per distinct
 *                  reading (多音字 → several, the parent picks)
 *   kind 'word'    every character of the front is a 生字; pinyin is built
 *                  per character (ambiguous ones are flagged), and a
 *                  sentence containing the whole word is looked up
 *   kind 'none'    nothing usable was found
 *   Option = { pinyin, words, sentence, source, confidence, note }
 *     confidence 'textbook'  taken unchanged from a 生字 card
 *                'partial'   assembled, or only some fields known
 *
 * Extending: a new source (an offline pinyin library for characters outside
 * the textbook, say) is one more entry in STRATEGIES returning the same
 * shape; the UI needs no change.
 */
const CardSuggestService = (() => {
  // Word-pair fallbacks ('试一试 · 考试') are not sentences; never suggest one.
  const FALLBACK_MARK = ' · ';

  /** 'X年级上册 · 课文1《…》' for a textbook card. */
  function sourceLabel(c) {
    const vol = `${GRADE_CN[c.grade] || c.grade}年级${c.semester === 1 ? '上册' : '下册'}`;
    return c.lesson ? `${vol} · ${c.lesson}` : vol;
  }

  /** Textbook cards, ignoring hand-made ones that share State.allChars. */
  function _textbook() {
    return (State.get('allChars') || []).filter(c => c && !c.isCustom && c.grade);
  }

  function _isSentence(s) {
    return typeof s === 'string' && s.length > 0 && !s.includes(FALLBACK_MARK);
  }

  /**
   * One option per distinct reading, earliest volume first. When the same
   * reading appears in several lessons the first occurrence wins, with any
   * words from later lessons merged in (deduplicated, at most 4) — the
   * earliest is the one the child met first.
   */
  function _charOptions(ch, cards) {
    const byReading = new Map();
    cards
      .filter(c => c.char === ch)
      .sort((a, b) => (a.grade - b.grade) || (a.semester - b.semester))
      .forEach(c => {
        const key = (c.pinyin || '').trim();
        if (!key) return;
        const words = (c.words || []).filter(w => typeof w === 'string' && w.includes(ch));
        if (!byReading.has(key)) {
          byReading.set(key, {
            pinyin: key,
            words: words.slice(0, 4),
            sentence: _isSentence(c.sentence) ? c.sentence : '',
            source: sourceLabel(c),
            confidence: 'textbook',
            note: ''
          });
          return;
        }
        const opt = byReading.get(key);
        words.forEach(w => { if (opt.words.length < 4 && !opt.words.includes(w)) opt.words.push(w); });
        if (!opt.sentence && _isSentence(c.sentence)) opt.sentence = c.sentence;
      });
    return [...byReading.values()];
  }

  /** Shortest textbook sentence containing text, or ''. Short reads best on a card. */
  function _sentenceWith(text, cards) {
    let best = '';
    for (const c of cards) {
      const s = c.sentence;
      if (_isSentence(s) && s.includes(text) && (!best || s.length < best.length)) best = s;
    }
    return best;
  }

  /** An option with only a lesson sentence; the parent fills the rest. */
  function _sentenceOnly(sentence, note) {
    return { pinyin: '', words: [], sentence, source: '课文例句', confidence: 'partial', note };
  }

  /**
   * Suggestion sources, tried in order; the first that returns options
   * wins. Each is (front, chars, cards) → {kind, options} or null.
   *
   * Extending: a new source (an offline pinyin library for characters
   * outside the textbook, say) is one more entry, placed by how much it
   * should be trusted relative to the others. Nothing else changes: the
   * result shape is the same, so the UI renders it as it is.
   */
  const STRATEGIES = [
    // A 生字: every reading the textbook gives it, as written there.
    function textbookChar(front, chars, cards) {
      if (chars.length !== 1) return null;
      const options = _charOptions(front, cards);
      return options.length ? { kind: 'char', options } : null;
    },
    // A word made of 生字: pinyin per character. A character with several
    // readings cannot be resolved without a dictionary, so the earliest
    // reading is used and the parent is told to check.
    function textbookWord(front, chars, cards) {
      if (chars.length < 2) return null;
      const perChar = chars.map(ch => _charOptions(ch, cards).map(o => o.pinyin));
      if (perChar.some(r => !r.length)) return null;
      const sentence = _sentenceWith(front, cards);
      const ambiguous = chars.filter((_, i) => perChar[i].length > 1);
      return {
        kind: 'word',
        options: [{
          pinyin: perChar.map(r => r[0]).join(' '),
          words: [],
          sentence,
          source: sentence ? '拼音按生字表，例句来自课文' : '拼音按生字表',
          confidence: 'partial',
          note: ambiguous.length ? `「${ambiguous.join('」「')}」是多音字，请核对拼音` : ''
        }]
      };
    },
    // Not (all) 生字, but the text occurs in a lesson: offer that sentence.
    function lessonSentence(front, chars, cards) {
      const sentence = _sentenceWith(front, cards);
      if (!sentence) return null;
      const note = chars.length === 1
        ? '这个字不在生字表里，请自己填拼音和词语'
        : '有的字不在生字表里，请自己填拼音';
      return { kind: chars.length === 1 ? 'char' : 'word', options: [_sentenceOnly(sentence, note)] };
    }
  ];

  /**
   * @param {string} front - what the parent typed in 正面
   * @returns {{kind:string, front:string, options:Array}}
   */
  function suggest(front) {
    const f = String(front || '').trim();
    if (!f) return { kind: 'none', front: f, options: [] };
    const cards = _textbook();
    const chars = [...f];
    for (const strategy of STRATEGIES) {
      const r = strategy(f, chars, cards);
      if (r && r.options.length) return { kind: r.kind, front: f, options: r.options };
    }
    return { kind: 'none', front: f, options: [] };
  }

  return { suggest, sourceLabel };
})();
