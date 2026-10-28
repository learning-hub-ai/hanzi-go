/**
 * Controllers — connect state, data, and UI; handle user interactions
 */

// --- Profile Manager ---
const ProfileManager = (() => {
  const AVATARS = ['👧', '👦', '🧒', '👶', '🧒🏻', '👦🏻', '🐱', '🐶', '🦁', '🐼', '🦄', '🌟', '🚀', '🎈'];

  function getProfiles() { return State.loadShared('profiles', []); }
  function saveProfiles(profiles) { State.saveShared('profiles', profiles); }

  /**
   * Show profile picker (called at startup if no active profile, or from header button).
   * @param {Function} onSelect - Callback after profile is selected
   */
  function showPicker(onSelect) {
    const profiles = getProfiles();
    const activeId = State.getProfileId();

    // Build picker HTML
    let profilesHtml = profiles.map(p => `
      <div class="profile-item ${p.id === activeId ? 'active' : ''}" data-id="${escapeHtml(p.id)}">
        <span class="avatar">${p.avatar}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="edit-icon" data-edit="${escapeHtml(p.id)}">✏️</span>
      </div>
    `).join('');

    profilesHtml += `
      <div class="profile-item profile-add" id="btnAddProfile">
        <span class="avatar">＋</span>
        <span class="name">添加</span>
      </div>
    `;

    const picker = document.createElement('div');
    picker.className = 'profile-picker';
    picker.id = 'profilePicker';
    picker.innerHTML = `
      <div class="profile-panel">
        <button class="profile-panel-close" id="btnPickerClose">✕</button>
        <h3>谁来学习？</h3>
        <div class="profile-list">${profilesHtml}</div>
        <div class="add-profile-form hidden" id="addProfileForm">
          <input type="text" id="newProfileName" placeholder="输入名字" maxlength="6">
          <div class="avatar-picker" id="avatarPicker">
            ${AVATARS.map(a => `<button data-avatar="${a}">${a}</button>`).join('')}
          </div>
          <button class="btn-confirm" id="btnConfirmAdd">确定</button>
        </div>
        ${StoryInvite.panelHtml()}
      </div>
    `;

    document.body.appendChild(picker);
    StoryInvite.bind(picker);

    // Event: close picker (✕ or Esc)
    const opener = document.activeElement;
    const close = () => {
      picker.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.getElementById('btnPickerClose').addEventListener('click', close);

    // Event: select existing profile
    picker.querySelectorAll('.profile-item:not(.profile-add)').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.edit-icon')) return; // Don't select when editing
        const id = item.dataset.id;
        State.setProfile(id);
        updateHeaderAvatar();
        close();
        if (onSelect) onSelect();
      });
    });

    // Event: edit profile (avatar only, name is the key and cannot change)
    picker.querySelectorAll('.edit-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = icon.dataset.edit;
        const profiles = getProfiles();
        const profile = profiles.find(p => p.id === id);
        if (!profile) return;

        const form = document.getElementById('addProfileForm');
        form.classList.remove('hidden');
        const nameInput = document.getElementById('newProfileName');
        nameInput.value = profile.name;
        nameInput.disabled = true; // Name cannot be changed
        nameInput.style.opacity = '0.5';

        // Pre-select current avatar
        selectedAvatar = profile.avatar;
        document.querySelectorAll('.avatar-picker button').forEach(b => {
          b.classList.toggle('selected', b.dataset.avatar === profile.avatar);
        });

        // Change confirm button to save edit
        const confirmBtn = document.getElementById('btnConfirmAdd');
        confirmBtn.textContent = '保存头像';
        confirmBtn.onclick = () => {
          profile.avatar = selectedAvatar;
          saveProfiles(profiles);
          updateHeaderAvatar();
          close();
          showPicker(onSelect); // Re-render
        };
      });
    });

    // Event: add new profile
    let selectedAvatar = AVATARS[0];
    document.getElementById('btnAddProfile').addEventListener('click', () => {
      const form = document.getElementById('addProfileForm');
      const nameInput = document.getElementById('newProfileName');
      const confirmBtn = document.getElementById('btnConfirmAdd');
      // Reset form state (may have been left in edit mode)
      nameInput.value = '';
      nameInput.disabled = false;
      nameInput.style.opacity = '';
      confirmBtn.textContent = '确定';
      confirmBtn.onclick = null; // Clear edit handler so addEventListener works
      selectedAvatar = AVATARS[0];
      document.querySelectorAll('.avatar-picker button').forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === AVATARS[0]);
      });
      form.classList.remove('hidden');
      nameInput.focus();
    });

    document.getElementById('avatarPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      selectedAvatar = btn.dataset.avatar;
      document.querySelectorAll('.avatar-picker button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    // Pre-select first avatar
    setTimeout(() => {
      const first = document.querySelector('.avatar-picker button');
      if (first) first.classList.add('selected');
    }, 0);

    document.getElementById('btnConfirmAdd').addEventListener('click', (e) => {
      // If onclick was set by edit handler, let it handle it (skip this listener)
      if (e.currentTarget.onclick) return;
      const name = document.getElementById('newProfileName').value.trim();
      if (!name) return;
      const profiles = getProfiles();
      // Check duplicate name
      if (profiles.find(p => p.id === name)) {
        alert('这个名字已经存在了');
        return;
      }
      profiles.push({ id: name, name, avatar: selectedAvatar });
      saveProfiles(profiles);
      State.setProfile(name);
      updateHeaderAvatar();
      close();
      if (onSelect) onSelect();
    });
  }

  /**
   * Initialize profile system. Auto-selects last active profile or first profile.
   * Only shows picker if no profiles exist at all.
   * @param {Function} onReady - Called when profile is set
   */
  function init(onReady) {
    const profiles = getProfiles();
    const activeId = State.loadShared('activeProfile', '');

    if (profiles.length === 0) {
      // No profiles — create a default one silently
      const defaultProfile = { id: '宝贝', name: '宝贝', avatar: '🧒' };
      saveProfiles([defaultProfile]);
      State.setProfile('宝贝');
      updateHeaderAvatar();
      if (onReady) onReady();
    } else if (activeId && profiles.find(p => p.id === activeId)) {
      // Resume last active profile
      State.setProfile(activeId);
      updateHeaderAvatar();
      if (onReady) onReady();
    } else {
      // Fallback to first profile
      State.setProfile(profiles[0].id);
      updateHeaderAvatar();
      if (onReady) onReady();
    }
  }

  function updateHeaderAvatar() {
    const profiles = getProfiles();
    const active = profiles.find(p => p.id === State.getProfileId());
    if (active) {
      const avatarEl = document.getElementById('profileAvatar');
      const nameEl = document.getElementById('profileName');
      if (avatarEl) avatarEl.textContent = active.avatar;
      if (nameEl) nameEl.textContent = active.name;
    }
    updateGreeting();
  }

  /** Set greeting based on time of day */
  function updateGreeting() {
    const hour = new Date().getHours();
    const profiles = getProfiles();
    const active = profiles.find(p => p.id === State.getProfileId());
    const name = active ? active.name : '';

    let greeting;
    if (hour < 12) greeting = `☀️ 早安${name}！今天认几个新字？`;
    else if (hour < 18) greeting = `🌤️ ${name}加油！继续学习吧`;
    else greeting = `🌙 ${name}，睡前再认几个字`;

    const el = document.getElementById('appGreeting');
    if (el) el.textContent = greeting;
  }

  return { init, showPicker, getProfiles, updateHeaderAvatar };
})();

const LearnController = (() => {
  /** Delete button label in its unarmed state */
  const DELETE_ICON = '🗑';
  /** Delete button label once armed — second tap commits */
  const DELETE_CONFIRM = '确定删除?';

  function showCurrent() {
    const chars = State.get('filteredChars');
    if (!chars.length) { _syncCustomCardControls(null); return; }
    let idx = State.get('currentIndex');
    // Clamp index to valid range
    if (idx >= chars.length) { idx = 0; State.set('currentIndex', 0); }
    CardUI.render(chars[idx], idx, chars.length);
    _syncCustomCardControls(chars[idx]);
  }

  /**
   * Show the custom-card controls only while studying custom cards.
   *
   * 🗑 replaces the ❤️ role for user-authored cards: un-hearting a textbook
   * character only drops it from 生词本 — the character still exists in the
   * data. Deleting a custom card destroys the only copy, so this one asks for
   * confirmation (the button becomes 确定删除? on first tap).
   *
   * @param {Object|null} charData - the card on screen, or null if none
   */
  function _syncCustomCardControls(charData) {
    // Two different conditions, deliberately kept apart:
    //   per-card   — 🗑 / ❤️ depend on what is on screen right now
    //   per-view   — ➕ depends on which collection is being studied
    _syncPerCardControls(!!(charData && charData.isCustom));
    _syncNewCardButton(State.get('selectedGrade') === 'custom');
  }

  /**
   * 🗑 and ❤️ swap according to whether the card on screen is user-authored.
   * @param {boolean} isCustom
   */
  function _syncPerCardControls(isCustom) {
    const delBtn = document.getElementById('btnDeleteCard');
    if (delBtn) {
      delBtn.classList.toggle('hidden', !isCustom);
      _disarmDelete(delBtn);
    }
    // Favouriting a custom card would file it in 生字本, which stores the
    // grade/semester to return to — a custom card has none. Hide the heart.
    const favBtn = document.getElementById('favBtn');
    if (favBtn) favBtn.classList.toggle('hidden', isCustom);
  }

  /**
   * ➕ 新建卡片 is only meaningful while the custom collection is on screen.
   * @param {boolean} viewingCustom
   */
  function _syncNewCardButton(viewingCustom) {
    const newBtn = document.getElementById('btnNewCard');
    if (newBtn) newBtn.classList.toggle('hidden', !viewingCustom);
  }

  /** Return the delete button to its unarmed state. */
  function _disarmDelete(btn) {
    const el = btn || document.getElementById('btnDeleteCard');
    if (!el) return;
    el.textContent = DELETE_ICON;
    el.dataset.confirming = '';
  }

  /**
   * Delete the card on screen. First tap arms, second confirms.
   * @returns {void}
   */
  function deleteCurrentCard() {
    const chars = State.get('filteredChars');
    const idx = State.get('currentIndex');
    const charData = chars[idx];
    if (!charData || !charData.isCustom) return;

    const btn = document.getElementById('btnDeleteCard');
    if (btn && btn.dataset.confirming !== 'yes') {
      btn.dataset.confirming = 'yes';
      btn.textContent = DELETE_CONFIRM;
      return;
    }

    CustomCardService.remove(charData.char);
    FilterUI.updateCustomCount();

    const remaining = CustomCardService.asChars();
    State.set('filteredChars', remaining);
    if (!remaining.length) {
      // Nothing left to study — fall back to the editor rather than an empty card
      State.set('currentIndex', 0);
      _syncCustomCardControls(null);
      // showCustomCards lives on AppController; reach it via the global export
      // rather than closing over a sibling module.
      if (typeof AppController !== 'undefined') AppController.showCustomCards();
      return;
    }
    State.set('currentIndex', Math.min(idx, remaining.length - 1));
    showCurrent();
  }

  function next() {
    const total = State.get('filteredChars').length;
    State.set('currentIndex', (State.get('currentIndex') + 1) % total);
    showCurrent();
  }

  function prev() {
    const total = State.get('filteredChars').length;
    State.set('currentIndex', (State.get('currentIndex') - 1 + total) % total);
    showCurrent();
  }

  /** Reset reinforce button state (called when filter changes) */
  function resetShuffle() {
    _resetReinforce();
  }

  /**
   * 加强记忆: toggle between normal and 3x repeated shuffle.
   * First click: triple + shuffle. Second click: restore original.
   */
  let _reinforceOriginal = null;

  function reinforce() {
    const btn = document.getElementById('btnReinforce');

    if (_reinforceOriginal) {
      // Already reinforced — restore original
      State.set('filteredChars', _reinforceOriginal);
      State.set('currentIndex', 0);
      _reinforceOriginal = null;
      if (btn) { btn.textContent = '🔁 加强记忆'; btn.classList.remove('active'); }
      showCurrent();
      return;
    }

    // Enter reinforce: save original, triple + shuffle
    const chars = State.get('filteredChars');
    if (chars.length < 1) return;

    _reinforceOriginal = [...chars];
    const repeated = [...chars, ...chars, ...chars];
    // Fisher-Yates shuffle
    for (let i = repeated.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [repeated[i], repeated[j]] = [repeated[j], repeated[i]];
    }
    State.set('filteredChars', repeated);
    State.set('currentIndex', 0);
    if (btn) { btn.textContent = '🔁 退出加强'; btn.classList.add('active'); }
    showCurrent();
  }

  /** Reset reinforce state (called when filter/semester changes) */
  function _resetReinforce() {
    _reinforceOriginal = null;
    const btn = document.getElementById('btnReinforce');
    if (btn) { btn.textContent = '🔁 加强记忆'; btn.classList.remove('active'); }
  }

  function flip() { CardUI.flip(); }

  function togglePinyin() {
    const show = !State.get('showPinyin');
    State.set('showPinyin', show);
    CardUI.togglePinyinDisplay(show);
  }

  function toggleFavorite() {
    const chars = State.get('filteredChars');
    const charData = chars[State.get('currentIndex')];
    const char = charData.char;
    const isFav = FavoriteService.toggle(char);
    // Store the grade/semester context of where the char was favorited
    FavoriteService.setContext(char, charData.grade, charData.semester);
    CardUI.updateFavIcon(isFav);
    FilterUI.updateFavCount();
  }

  function speakCurrent() {
    const chars = State.get('filteredChars');
    Speech.speakChar(chars[State.get('currentIndex')]);
  }

  /**
   * ✍️ 笔顺 button on the card back. First click opens the panel and plays
   * the stroke animation; the panel's own buttons (再看一遍/我来写/收起)
   * are bound once in init() below, since they don't need to know which
   * card is current — CardUI tracks that internally.
   */
  function openStrokePractice() {
    const chars = State.get('filteredChars');
    const charData = chars[State.get('currentIndex')];
    if (!charData) return;
    const opened = CardUI.openStrokePanel(charData.char);
    if (!opened) {
      // HanziWriter global isn't defined — either the CDN script is still
      // loading (slow connection) or failed outright (offline on first
      // use). Degrade to an inline message on the card itself rather than
      // silently doing nothing, so the child isn't left wondering why the
      // button didn't work.
      CardUI.showStrokeUnavailableMessage();
    }
  }

  /** Wire up the stroke panel's own controls. Called once from init(). */
  function _initStrokePractice() {
    // All these buttons sit on the card's back face, which flips on click
    // (see btnDeleteCard/favBtn above for the same pattern) — without
    // stopPropagation, every click would also flip the card back to front.
    const btn = document.getElementById('btnStrokePractice');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); openStrokePractice(); });

    const replayBtn = document.getElementById('btnStrokeReplay');
    if (replayBtn) replayBtn.addEventListener('click', (e) => { e.stopPropagation(); CardUI.replayStrokeAnimation(); });

    const quizBtn = document.getElementById('btnStrokeQuiz');
    if (quizBtn) {
      quizBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        CardUI.startStrokeQuiz({
          onComplete: () => {
            const chars = State.get('filteredChars');
            const charData = chars[State.get('currentIndex')];
            // Small reward, consistent with 朗读 elsewhere on this card —
            // the child just finished writing the character, hearing it
            // read aloud reinforces the character/sound pairing.
            if (charData) Speech.speakChar(charData);
          }
        });
      });
    }

    const closeBtn = document.getElementById('btnStrokeClose');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); CardUI.closeStrokePanel(); });

    // The stroke canvas itself must not propagate clicks either — drawing
    // a stroke during a quiz is a sequence of mousedown/mousemove/mouseup
    // on the canvas, and HanziWriter needs those events uninterrupted by
    // the card's flip handler.
    const target = document.getElementById('strokeCanvasTarget');
    if (target) target.addEventListener('click', (e) => e.stopPropagation());
  }

  return {
    showCurrent, next, prev, resetShuffle, reinforce, flip, togglePinyin,
    toggleFavorite, speakCurrent, deleteCurrentCard,
    openStrokePractice, _initStrokePractice
  };
})();

const ChallengeController = (() => {
  let _questionType = 'pickPinyin';
  let _questionCount = 'all';
  let _timerSeconds = 0; // 0 = off, 5/10/15
  let _timerInterval = null;

  function setType(type) { _questionType = type; }
  function getType() { return _questionType; }
  function setCount(count) { _questionCount = count; }
  function getCount() { return _questionCount; }
  function setTimer(seconds) { _timerSeconds = seconds; }

  function _startTimer() {
    _clearTimer();
    if (_timerSeconds <= 0) {
      const bar = document.getElementById('quizTimerBar');
      if (bar) bar.classList.add('hidden');
      return;
    }

    const bar = document.getElementById('quizTimerBar');
    const fill = document.getElementById('quizTimerFill');
    if (!bar || !fill) return;

    bar.classList.remove('hidden');
    fill.style.transition = 'none';
    fill.style.width = '100%';

    // Force reflow then start animation
    fill.offsetHeight;
    fill.style.transition = `width ${_timerSeconds}s linear`;
    fill.style.width = '0%';

    // Auto-answer wrong when time runs out
    _timerInterval = setTimeout(() => {
      const quiz = State.get('quiz');
      const q = quiz.questions[quiz.current];
      if (!q.answered) {
        // Time's up — treat as wrong
        answer(-1); // -1 = no selection (timeout)
      }
    }, _timerSeconds * 1000);
  }

  function _clearTimer() {
    if (_timerInterval) {
      clearTimeout(_timerInterval);
      _timerInterval = null;
    }
  }

  function start(fromErrorBook = false) {
    // Visual feedback that button was clicked
    const endMsg = document.getElementById('endMsg');
    if (endMsg) endMsg.textContent = fromErrorBook ? '正在生成错题...' : '正在出题...';

    let questions;
    try {
      questions = DataService.generateQuizQuestions(fromErrorBook, _questionType, _questionCount);
    } catch (err) {
      console.error('[Challenge] Error generating questions:', err);
      _showStartError('生成题目时出错: ' + err.message);
      return;
    }
    if (!questions) {
      // Show feedback instead of silently failing
      console.warn('[Challenge] Cannot generate questions:', { fromErrorBook, type: _questionType, count: _questionCount, filteredLen: State.get('filteredChars').length, errorBookLen: ErrorBookService.count() });
      if (fromErrorBook) {
        const errCount = ErrorBookService.count();
        if (errCount === 0) {
          _showStartError('📖 错题本是空的，暂无可复习的字');
        } else {
          _showStartError('字数太少，无法生成题目（至少需要4个不同的字）');
        }
      } else {
        const filtered = State.get('filteredChars');
        if (!filtered || filtered.length === 0) {
          _showStartError('当前范围没有生字，请选择其他课文');
        } else {
          _showStartError('无法生成题目（filteredLen=' + filtered.length + '）');
        }
      }
      return;
    }
    State.set('quiz', { questions, current: 0, score: 0, streak: 0, isErrorReview: fromErrorBook });
    QuizUI.showQuizActive();
    showQuestion();
  }

  /** Show a brief toast/message when quiz cannot start */
  function _showStartError(msg) {
    // If end screen is visible, show message there; otherwise show toast
    const endEl = document.getElementById('quizEnd');
    if (endEl && !endEl.classList.contains('hidden')) {
      const msgEl = document.getElementById('endMsg');
      if (msgEl) {
        const origText = msgEl.textContent;
        msgEl.textContent = msg;
        msgEl.style.color = 'var(--error, #e53e3e)';
        setTimeout(() => { msgEl.textContent = origText; msgEl.style.color = ''; }, 2500);
      }
    } else {
      // Toast fallback for non-end-screen context
      const toast = document.createElement('div');
      toast.className = 'quiz-toast';
      toast.textContent = msg;
      toast.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:var(--surface,#fff);color:var(--error,#e53e3e);padding:12px 24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;font-size:15px;animation:fadeIn .2s';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }
  }

  function showQuestion() {
    const quiz = State.get('quiz');
    const q = quiz.questions[quiz.current];
    QuizUI.renderQuestion(q, quiz.score, quiz.streak, quiz.current + 1, quiz.questions.length,
      quiz.questions.map(x => (x.answered ? x.correct : null)));
    _startTimer();
  }

  function answer(selectedIdx) {
    _clearTimer();
    const quiz = State.get('quiz');
    const q = quiz.questions[quiz.current];
    if (q.answered) return;
    q.answered = true;

    const correctIdx = q.options.indexOf(q.target);
    const isCorrect = selectedIdx >= 0 && selectedIdx === correctIdx;
    // Kept on the question so the progress dots can be drawn from this
    // round's own data (QuizUI.renderQuestion), never from leftover DOM.
    q.correct = isCorrect;

    // Record for spaced repetition (every quiz answer)
    SpacedRepService.recordAnswer(q.target.char, isCorrect);

    if (isCorrect) {
      quiz.score++;
      quiz.streak++;
      if (quiz.isErrorReview || State.get('selectedGrade') === 'err') {
        ErrorBookService.markCorrect(q.target.char);
      }
      if (State.get('selectedGrade') === 'fav') {
        _trackFavCorrect(q.target.char);
      }
    } else {
      quiz.streak = 0;
      ErrorBookService.addWrong(q.target.char, q.target.pinyin);
      // Reset favorites consecutive count on wrong
      if (State.get('selectedGrade') === 'fav') {
        _resetFavCorrect(q.target.char);
      }
    }
    FilterUI.updateErrCount();
    FilterUI.updateSrsCount();

    State.set('quiz', quiz);
    QuizUI.showFeedback(selectedIdx, correctIdx, isCorrect);
    QuizUI.updateStreak(quiz.streak);

    const feedbackDelayMs = State.config('quizFeedbackDelayMs', 1200);

    // Speak the correct answer's character either way. After a right answer
    // it confirms what the child chose; after a wrong one (or a timeout) it
    // teaches what the green answer is, which is when hearing it matters
    // most. Then hold the usual feedback delay on top of the sound before
    // advancing — total wait = actual sound length + feedbackDelayMs — so
    // the sound always finishes while ITS question is still on screen, and
    // the child still gets a pause to look at the highlighted answer.
    // speakChar's onDone is guaranteed to fire even if every audio source
    // fails (bounded by the start timeouts), so this never hangs.
    Speech.speakChar(q.target, () => {
      setTimeout(() => _advanceToNext(quiz), feedbackDelayMs);
    });
  }

  /** Move to the next question, or end the round if this was the last one. */
  function _advanceToNext(quiz) {
    quiz.current++;
    if (quiz.current < quiz.questions.length) {
      showQuestion();
    } else {
      endRound();
    }
  }

  /**
   * Check badge conditions and celebrate anything newly unlocked.
   *
   * Lives here rather than being called only from endRound() because 6 of
   * the 11 badges depend on getTotalCount() or consecutiveDays — values
   * that move in Learn mode and in the daily task, not just at the end of
   * a quiz round. Before this, a child could learn 50 characters through
   * the daily task and never see 识字萌芽 fire; the badge was silently
   * awarded later, the first time they happened to finish a quiz.
   *
   * Safe to call often: checkAndAward() only returns badges not already
   * held, so repeat calls are no-ops once everything is unlocked.
   */
  function _celebrateNewBadges() {
    BadgeService.checkAndAward().forEach(b => BadgePopupUI.show(b));
  }

  function endRound() {
    const quiz = State.get('quiz');
    const milestone = StatsService.recordRound(quiz.score, quiz.questions.length);
    QuizUI.showEndScreen(quiz.score, quiz.questions.length);
    FilterUI.updateStreakDisplay();
    FilterUI.updateSrsCount();

    // Show milestone celebration
    if (milestone) {
      BadgePopupUI.show(milestone);
    }

    _celebrateNewBadges();
  }

  // Track consecutive correct answers for favorites removal
  const _favCorrectCounts = {};

  function _trackFavCorrect(char) {
    _favCorrectCounts[char] = (_favCorrectCounts[char] || 0) + 1;
    if (_favCorrectCounts[char] >= 3) {
      FavoriteService.remove(char);
      FilterUI.updateFavCount();
      delete _favCorrectCounts[char];
    }
  }

  function _resetFavCorrect(char) {
    _favCorrectCounts[char] = 0;
  }

  return { start, answer, setType, getType, setCount, getCount, setTimer, stop: _clearTimer,
           celebrateNewBadges: _celebrateNewBadges };
})();

const AppController = (() => {
  /**
   * Show or hide the sidebar selection depending on mode.
   *
   * The sidebar picks which characters learn/challenge operate on. In 任务
   * (dailyTask) mode it has no effect — the daily task drives its own lesson
   * progression — so a highlighted item there claims a selection that is not
   * in use. Startup used to activate 练生字 whenever favourites existed, even
   * though 任务 is the default tab, and switchMode never cleared it.
   *
   * @param {string} mode - the mode being switched to
   */
  function _syncSidebarSelection(mode) {
    const inUse = (mode === 'learn' || mode === 'challenge');
    if (!inUse) {
      document.querySelectorAll('.sidebar-item.active')
        .forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.sidebar-grade-header.active')
        .forEach(i => i.classList.remove('active'));
    }
  }

  /**
   * Remove the daily-task floating controls.
   *
   * These are appended to document.body with position:fixed, so they survive
   * a mode switch — the daily task only cleared them on its own re-render.
   * Left behind, the 「已看 N/M · 继续翻看」 button sat over the last quiz
   * option in 挑战 and made it unclickable on short screens.
   *
   * @param {string} mode - the mode being switched to
   */
  function _clearDailyTaskOverlays(mode) {
    if (mode === 'dailyTask') return;   // the daily task owns them
    ['dtFloatingBtn', 'dtTaskBanner', 'dtReturnBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function switchMode(newMode) {
    State.set('mode', newMode);
    document.querySelectorAll('.mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === newMode);
    });
    _syncSidebarSelection(newMode);
    _clearDailyTaskOverlays(newMode);
    // Mode switch UI
    const learnEl = document.getElementById('learnMode');
    const challengeEl = document.getElementById('challengeMode');
    const dailyTaskEl = document.getElementById('dailyTaskMode');
    if (learnEl) learnEl.classList.toggle('hidden', newMode !== 'learn');
    if (challengeEl) challengeEl.classList.toggle('hidden', newMode !== 'challenge');
    if (dailyTaskEl) dailyTaskEl.classList.toggle('hidden', newMode !== 'dailyTask');

    // Mobile's ◀️🔄🔊🔁▶️ bottom bar (nav#mobileBottomBar) is a page-level
    // position:fixed element, OUTSIDE #learnMode — so hiding #learnMode
    // above does not hide it. It forwards clicks to #btnPrev/#btnFlip/etc,
    // which are 学习模式-only operations (flip the card, read it aloud,
    // reshuffle); showing it in 任务/挑战 let a child tap buttons that do
    // nothing meaningful there. Only show it in 学习.
    if (typeof MobileUI !== 'undefined') MobileUI.setBottomBarVisible(newMode === 'learn');

    if (newMode === 'challenge') {
      // Move the lesson filter into challenge mode (before quiz type selector)
      const filterEl = document.querySelector('.content-header');
      const typeSel = document.getElementById('quizTypeSelector');
      if (typeSel && filterEl) {
        typeSel.before(filterEl);
      }
      ChallengeController.start();
    } else if (newMode === 'dailyTask') {
      // Leaving challenge mode — stop any running timer
      ChallengeController.stop();
      if (typeof DailyTaskController !== 'undefined') {
        DailyTaskController.render();
      }
    } else {
      // Leaving challenge mode — stop any running timer
      ChallengeController.stop();
      // Move the lesson filter back into learn mode (first child)
      const filterEl = document.querySelector('.content-header');
      const learnEl = document.getElementById('learnMode');
      if (learnEl && filterEl) {
        learnEl.insertBefore(filterEl, learnEl.firstChild);
      }
      // Render the card for the current selection. selectSemester skips
      // rendering while 任务 is showing, so the card on screen is whatever
      // was last drawn — at boot that is 一上's first character. Entering
      // 学习 after the last-read volume was restored showed 「天」 1/45
      // under a 五年级下册 header. It went unnoticed only because the boot
      // volume used to be 一上 too, so the stale card happened to match.
      LearnController.showCurrent();
    }
    if (typeof StoryView !== 'undefined') StoryView.refresh();
  }

  /**
   * Choose what 学习/挑战 show when the app starts.
   *
   * Order, first match wins:
   *   1. the volume this child was last reading (see selectSemester)
   *   2. 收藏, if there are favourites — only on a first run with no
   *      remembered volume, which is the old default
   *   3. 一年级上册
   *
   * The remembered volume comes first because it is where the child
   * actually is in the textbook. 收藏 is a handful of characters picked
   * from across volumes, and putting it first meant that any child who had
   * favourited even one character was sent there on every launch and had
   * to find their volume again by hand — the exact chore remembering the
   * volume was meant to remove.
   *
   * The highlight painted here is dropped again by _syncSidebarSelection if
   * we booted into 任务, where the sidebar selection is not used.
   */
  function _restoreInitialView() {
    const last = State.load('lastVolume', null);
    // Re-validate rather than trust storage: a volume could have been
    // removed from data/, and a hand-edited or corrupt value must not boot
    // the app into an empty character list.
    const hasChars = !!last && (State.get('allChars') || []).some(
      c => String(c.grade) === last.grade && String(c.semester) === last.semester);
    if (hasChars) {
      selectSemester(last.semester, last.grade);
      _pointSidebarAt(last.grade, last.semester);
      return;
    }
    if (FavoriteService.getAll().length > 0) {
      selectSemester('fav', 'fav');
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      const favItem = document.querySelector('.sidebar-item[data-grade="fav"]');
      if (favItem) favItem.classList.add('active');
      return;
    }
    selectSemester('1', '1');
  }

  /**
   * Point the sidebar at a grade/semester: highlight the row, and expand its
   * grade group if it is collapsed.
   *
   * The click handler paints this itself, so this exists for the one case
   * that has no click — restoring the last-read volume at boot. Without it
   * the sidebar would still show 一年级上册 selected and expanded while the
   * app had actually loaded 五年级下册.
   *
   * @param {string} grade - Grade number as a string
   * @param {string} sem - Semester, '1' or '2'
   */
  function _pointSidebarAt(grade, sem) {
    const item = document.querySelector(
      `.sidebar-item[data-grade="${grade}"][data-sem="${sem}"]`);
    if (!item) return;
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const group = item.closest('.sidebar-grade-group');
    if (!group) return;
    document.querySelectorAll('.sidebar-grade-header.active')
      .forEach(h => h.classList.remove('active'));
    const header = group.querySelector('.sidebar-grade-header');
    const children = group.querySelector('.sidebar-grade-children');
    if (header) header.classList.add('active');
    if (children && !children.classList.contains('expanded')) {
      // Collapse whichever group the markup left open (一年级) so only the
      // restored one is expanded, matching what a click would produce.
      document.querySelectorAll('.sidebar-grade-children.expanded')
        .forEach(c => c.classList.remove('expanded'));
      document.querySelectorAll('.sidebar-grade-arrow')
        .forEach(a => { if (a.textContent === '−') a.textContent = '+'; });
      children.classList.add('expanded');
      const arrow = header && header.querySelector('.sidebar-grade-arrow');
      if (arrow) arrow.textContent = '−';
    }
  }

  function selectSemester(sem, grade) {
    State.set('selectedSemester', sem);
    State.set('selectedGrade', grade);
    // Remember which textbook volume this child was last reading, so the
    // next launch does not drop a 五年级 user back on 一年级上册 — on
    // mobile that meant scrolling an 18-row sheet every single session.
    //
    // Only real volumes are stored. 'fav'/'err'/'srs'/'custom' are filters,
    // not volumes: restoring 错题本 on launch would show an empty screen
    // once the mistakes were cleared. Skipping them also means opening 收藏
    // does not overwrite the volume the child was reading, so the next
    // launch still returns to it (see _restoreInitialView). Stored per
    // profile (State.save is profile-scoped) so two children on one device
    // keep their own volume, and deliberately NOT added to EXPORT_KEYS —
    // which volume you are reading is device-local, not something to carry
    // to another device.
    if (/^[1-9]$/.test(String(grade)) && /^[12]$/.test(String(sem))) {
      State.save('lastVolume', { grade: String(grade), semester: String(sem) });
    }
    LearnController.resetShuffle();
    // Update mobile grade label if active
    if (typeof MobileUI !== 'undefined') MobileUI.onGradeChange();

    const currentMode = State.get('mode');

    if (grade === 'fav') {
      // Special: filter to favorites with semester-based dropdown
      const allChars = State.get('allChars');
      const favorites = FavoriteService.getAll();

      // Build favChars using stored context (grade/semester where char was favorited)
      // Fallback: for legacy favorites without context, use first match in allChars
      const favChars = [];
      const seen = new Set();
      for (const char of favorites) {
        if (seen.has(char)) continue;
        seen.add(char);
        const ctx = FavoriteService.getContext(char);
        if (ctx) {
          // Use stored context — find the exact allChars entry matching grade+semester
          const match = allChars.find(c => c.char === char && c.grade === ctx.grade && c.semester === ctx.semester);
          if (match) { favChars.push(match); continue; }
        }
        // Fallback: use first occurrence in allChars
        const fallback = allChars.find(c => c.char === char);
        if (fallback) favChars.push(fallback);
      }

      State.set('filteredChars', favChars);
      State.set('currentIndex', 0);

      // Group favorites by grade-semester
      const gradeNames = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'];
      const semNames = ['', '上册', '下册'];
      const bySemester = {};
      for (const c of favChars) {
        const key = `${c.grade}-${c.semester}`;
        if (!bySemester[key]) bySemester[key] = [];
        bySemester[key].push(c);
      }

      let options = `<option value="fav_all">❤️ 全部收藏 (${favChars.length}字)</option>`;
      const sortedKeys = Object.keys(bySemester).sort((a, b) => {
        const [g1, s1] = a.split('-').map(Number);
        const [g2, s2] = b.split('-').map(Number);
        return g1 !== g2 ? g1 - g2 : s1 - s2;
      });
      for (const key of sortedKeys) {
        const [g, s] = key.split('-').map(Number);
        if (g > 0 && g < gradeNames.length && s > 0 && s < semNames.length) {
          options += `<option value="fav_sem_${key}">📗 ${gradeNames[g]}${semNames[s]} (${bySemester[key].length}字)</option>`;
        }
      }

      const sel = document.getElementById('lessonFilter');
      sel.innerHTML = options;
    } else if (grade === 'err') {
      // Special: filter to error book with frequency-based dropdown
      const allChars = State.get('allChars');
      const errorBook = ErrorBookService.getAll();
      const seen = new Set();
      const errChars = [];
      for (const c of allChars) {
        if (errorBook.some(e => e.char === c.char) && !seen.has(c.char)) {
          seen.add(c.char);
          errChars.push(c);
        }
      }
      // Include error book chars not found in allChars (e.g. from a different grade selection)
      for (const e of errorBook) {
        if (!seen.has(e.char)) {
          seen.add(e.char);
          errChars.push({ char: e.char, pinyin: e.pinyin, words: [], sentence: '', grade: 0, semester: 0 });
        }
      }
      State.set('filteredChars', errChars);
      State.set('currentIndex', 0);

      // Group by error frequency
      const frequent = errorBook.filter(e => e.wrongCount >= 3);
      const occasional = errorBook.filter(e => e.wrongCount === 2);
      const recent = errorBook.filter(e => e.wrongCount === 1);

      let options = `<option value="err_all">📖 全部错题 (${errChars.length}字)</option>`;
      if (frequent.length > 0) options += `<option value="err_frequent">🔴 经常出错 (${frequent.length}字)</option>`;
      if (occasional.length > 0) options += `<option value="err_occasional">🟡 偶尔出错 (${occasional.length}字)</option>`;
      if (recent.length > 0) options += `<option value="err_recent">🟢 刚出错 (${recent.length}字)</option>`;

      const sel = document.getElementById('lessonFilter');
      sel.innerHTML = options;
    } else if (grade === 'srs') {
      // Special: filter to spaced repetition with categorized dropdown
      const allChars = State.get('allChars');
      const categories = SpacedRepService.getCategorizedChars();
      const dueCharList = SpacedRepService.getDueChars();

      // Build "all due" list (default view)
      const seen = new Set();
      const srsChars = [];
      for (const c of allChars) {
        if (dueCharList.includes(c.char) && !seen.has(c.char)) {
          seen.add(c.char);
          srsChars.push(c);
        }
      }
      State.set('filteredChars', srsChars);
      State.set('currentIndex', 0);

      // Build dropdown with categories
      const sel = document.getElementById('lessonFilter');
      const allDueCount = srsChars.length;
      const todayCount = categories.todayTask.length;
      const reviewCount = categories.scheduledReview.length;
      const familiarCount = categories.familiar.length;
      const almostCount = categories.almostMastered.length;
      const masteredCount = categories.mastered.length;

      let options = `<option value="srs_all">📈 全部待复习 (${allDueCount}字)</option>`;
      if (todayCount > 0) options += `<option value="srs_today">🔴 今日任务 (${todayCount}字)</option>`;
      if (reviewCount > 0) options += `<option value="srs_review">🟡 复习回顾 (${reviewCount}字)</option>`;
      if (familiarCount > 0) options += `<option value="srs_familiar">🔵 熟悉中 (${familiarCount}字)</option>`;
      if (almostCount > 0) options += `<option value="srs_almost">🟣 快掌握了 (${almostCount}字)</option>`;
      if (masteredCount > 0) options += `<option value="srs_mastered">⭐ 已掌握 (${masteredCount}字)</option>`;
      sel.innerHTML = options;
    } else if (grade === 'custom') {
      // Special: user-authored cards. They already carry the textbook char
      // shape, so nothing downstream needs to know they are custom.
      const customChars = CustomCardService.asChars();
      State.set('filteredChars', customChars);
      State.set('currentIndex', 0);
      const sel = document.getElementById('lessonFilter');
      sel.innerHTML = `<option value="custom_all">✏️ 自定义字卡 (${customChars.length}张)</option>`;
    } else {
      FilterUI.renderLessons();
      DataService.applyFilter('all');
    }

    if (currentMode === 'challenge') {
      ChallengeController.start();
    } else if (currentMode !== 'dailyTask') {
      LearnController.showCurrent();
    }
    // If in dailyTask mode, do nothing — sidebar selection only preloads data for learn/challenge
    if (typeof StoryView !== 'undefined') StoryView.refresh();
  }

  function selectLesson(lessonId) {
    // Handle SRS category filters
    if (lessonId && lessonId.startsWith('srs_')) {
      const allChars = State.get('allChars');
      const categories = SpacedRepService.getCategorizedChars();
      let targetChars = [];

      if (lessonId === 'srs_all') {
        targetChars = SpacedRepService.getDueChars();
      } else if (lessonId === 'srs_today') {
        targetChars = categories.todayTask;
      } else if (lessonId === 'srs_review') {
        targetChars = categories.scheduledReview;
      } else if (lessonId === 'srs_familiar') {
        targetChars = categories.familiar;
      } else if (lessonId === 'srs_almost') {
        targetChars = categories.almostMastered;
      } else if (lessonId === 'srs_mastered') {
        targetChars = categories.mastered;
      }

      const targetSet = new Set(targetChars);
      const seen = new Set();
      const filtered = [];
      for (const c of allChars) {
        if (targetSet.has(c.char) && !seen.has(c.char)) {
          seen.add(c.char);
          filtered.push(c);
        }
      }
      State.set('filteredChars', filtered);
      State.set('currentIndex', 0);
    } else if (lessonId && lessonId.startsWith('fav_')) {
      // Handle favorites semester filters
      const allChars = State.get('allChars');
      const favorites = FavoriteService.getAll();
      const seen = new Set();
      const favChars = [];
      for (const c of allChars) {
        if (favorites.includes(c.char) && !seen.has(c.char)) {
          seen.add(c.char);
          favChars.push(c);
        }
      }

      if (lessonId === 'fav_all') {
        State.set('filteredChars', favChars);
      } else if (lessonId.startsWith('fav_sem_')) {
        // fav_sem_G-S — filter by grade and semester
        const [gradeNum, semNum] = lessonId.replace('fav_sem_', '').split('-').map(Number);
        const filtered = favChars.filter(c => c.grade === gradeNum && c.semester === semNum);
        State.set('filteredChars', filtered);
      }
      State.set('currentIndex', 0);
    } else if (lessonId && lessonId.startsWith('err_')) {
      // Handle error book frequency filters
      const allChars = State.get('allChars');
      const errorBook = ErrorBookService.getAll();
      let targetChars = [];

      if (lessonId === 'err_all') {
        targetChars = errorBook.map(e => e.char);
      } else if (lessonId === 'err_frequent') {
        targetChars = errorBook.filter(e => e.wrongCount >= 3).map(e => e.char);
      } else if (lessonId === 'err_occasional') {
        targetChars = errorBook.filter(e => e.wrongCount === 2).map(e => e.char);
      } else if (lessonId === 'err_recent') {
        targetChars = errorBook.filter(e => e.wrongCount === 1).map(e => e.char);
      }

      const targetSet = new Set(targetChars);
      const seen = new Set();
      const filtered = [];
      for (const c of allChars) {
        if (targetSet.has(c.char) && !seen.has(c.char)) {
          seen.add(c.char);
          filtered.push(c);
        }
      }
      // Include error book chars not found in allChars
      for (const char of targetChars) {
        if (!seen.has(char)) {
          seen.add(char);
          const entry = errorBook.find(e => e.char === char);
          filtered.push({ char, pinyin: entry ? entry.pinyin : '', words: [], sentence: '', grade: 0, semester: 0 });
        }
      }
      State.set('filteredChars', filtered);
      State.set('currentIndex', 0);
    } else {
      DataService.applyFilter(lessonId);
    }

    if (State.get('mode') === 'challenge') {
      ChallengeController.start();
    } else {
      LearnController.showCurrent();
    }
    if (typeof StoryView !== 'undefined') StoryView.refresh();
  }

  function showFavorites() {
    const html = ModalUI.renderFavorites(FavoriteService.getAll());
    ModalUI.show(`❤️ 生字本 (${FavoriteService.getAll().length}字)`, html);
  }

  function showCustomCards() {
    ModalUI.show(`✏️ 自定义字卡 (${CustomCardService.count()}张)`,
      ModalUI.renderCustomCards(CustomCardService.getAll()), { cc: true });
    _suggestion = _noSuggestion();
    _editingFront = null;
    // Land the cursor where typing starts, so the keyboard flow works from the
    // moment the panel opens
    const f = document.getElementById('ccFront');
    if (f) f.focus();
  }

  /**
   * The custom-card form, in one place. Each entry ties a field's element id
   * to the card property it edits and how that property is written into the
   * field. Adding a field to custom cards means one entry here (and the input
   * in ModalUI.renderCustomCards); filling, clearing, suggesting and editing
   * all read this table.
   *   suggested: whether 自动填写 may fill it (正面 is what the parent types)
   */
  const _CC_FIELDS = [
    { id: 'ccFront',    key: 'front',    show: v => v || '',               suggested: false },
    { id: 'ccPinyin',   key: 'pinyin',   show: v => v || '',               suggested: true },
    { id: 'ccWords',    key: 'words',    show: v => (v || []).join('，'),  suggested: true },
    { id: 'ccSentence', key: 'sentence', show: v => v || '',               suggested: true }
  ];

  /** Current form values as {front, pinyin, words, sentence} strings. */
  function _readCardForm() {
    const out = {};
    for (const f of _CC_FIELDS) {
      const el = document.getElementById(f.id);
      out[f.key] = el ? el.value : '';
    }
    return out;
  }

  /** Write a card (or suggestion) into the form; '' everywhere when null. */
  function _writeCardForm(card) {
    for (const f of _CC_FIELDS) {
      const el = document.getElementById(f.id);
      if (el) el.value = card ? f.show(card[f.key]) : '';
    }
  }

  /**
   * 自动填写 state for the custom-card form.
   *   result  CardSuggestService.suggest() output for the current 正面
   *   active  index of the option filled in, or null
   *   filled  {fieldId: value} last written by a suggestion. A field whose
   *           current value differs was edited by the parent and is never
   *           overwritten — picking another reading must not destroy work.
   */
  let _suggestion = _noSuggestion();

  function _noSuggestion() { return { result: null, active: null, filled: {} }; }

  /** Recompute suggestions for whatever is in 正面 and redraw the strip. */
  function updateCardSuggestion() {
    const frontEl = document.getElementById('ccFront');
    const box = document.getElementById('ccSuggest');
    if (!frontEl || !box) return;
    const result = CardSuggestService.suggest(frontEl.value);
    const prev = _suggestion.result;
    // Typing the same front again (or IME re-firing input) changes nothing.
    if (prev && prev.front === result.front) return;
    _suggestion.result = result;
    _suggestion.active = null;
    // With exactly one reading there is nothing to choose: fill it in now,
    // which is the whole point of the feature. Several readings wait for the
    // parent, because a wrong guess would go onto the card.
    if (result.options.length === 1) {
      applyCardSuggestion(0);
      return;
    }
    // A new front invalidates what the previous suggestion wrote, but only
    // where the parent has not since edited it.
    _clearSuggestedFields();
    _renderSuggestion();
  }

  /** Fill the form from option i of the current suggestion. */
  function applyCardSuggestion(i) {
    const r = _suggestion.result;
    if (!r || !r.options[i]) return;
    const o = r.options[i];
    for (const f of _CC_FIELDS.filter(x => x.suggested)) {
      const el = document.getElementById(f.id);
      if (!el || !_isUntouched(el)) continue;
      const value = f.show(o[f.key]);
      el.value = value;
      _suggestion.filled[f.id] = value;
    }
    _suggestion.active = i;
    _renderSuggestion();
  }

  /** A field is ours to write if it is empty or still holds what we wrote. */
  function _isUntouched(el) {
    return el.value === '' || el.value === _suggestion.filled[el.id];
  }

  function _clearSuggestedFields() {
    for (const [id, value] of Object.entries(_suggestion.filled)) {
      const el = document.getElementById(id);
      if (el && el.value === value) el.value = '';
    }
    _suggestion.filled = {};
  }

  function _renderSuggestion() {
    const box = document.getElementById('ccSuggest');
    if (!box) return;
    const html = ModalUI.renderCardSuggestion(_suggestion.result, _suggestion.active);
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
  }

  /**
   * Editing a custom card.
   *
   * Reuses the add form rather than a second form or inline row editing:
   * one place to type, the same 自动填写, the same validation, and nothing
   * new for a parent to learn. While editing, the form is labelled with the
   * card's name, 加入 becomes 保存修改, a 取消 appears, and the card is
   * highlighted in the list. Leaving edit mode (save, cancel, deleting that
   * card, reopening the panel) always restores the plain add form.
   *
   * 自动填写 stays quiet when editing starts: the fields hold the card's own
   * values, and filling them over with textbook data would undo the very
   * correction the parent opened the card to keep. It wakes up only if the
   * parent changes 正面.
   */
  let _editingFront = null;

  function startEditCustomCard(front) {
    const card = CustomCardService.get(front);
    if (!card) { _setFormMessage('找不到这张卡片，可能已经删除了', false); return; }
    _writeCardForm(card);
    _editingFront = card.front;
    // 自动填写 must not fill over the card's own values. Marking the card's
    // front as already handled shows nothing now; if the parent then
    // changes 正面, _isUntouched() still protects every field that holds the
    // card's text, because no field is recorded as filled by a suggestion.
    _suggestion = _noSuggestion();
    _suggestion.result = { kind: 'none', front: card.front, options: [] };
    _renderSuggestion();
    _setFormMessage('', true);
    _renderEditState();
    const f = document.getElementById('ccFront');
    if (f) { f.focus(); f.select(); }
  }

  function saveCustomCardEdit() {
    const result = CustomCardService.update(_editingFront, _readCardForm());
    if (!result.ok) {
      _setFormMessage(result.error, false);
      const f = document.getElementById('ccFront');
      if (f) f.focus();
      return;
    }
    _exitEditMode();
    _refreshCustomCardList();
    let msg = result.frontChanged
      ? `已改成「${result.card.front}」✓ 正面换了字，学习记录从头开始`
      : `已保存「${result.card.front}」✓`;
    if (result.warning) msg += ` ${result.warning}`;
    _setFormMessage(msg, true);
    // The study view may be showing this very card.
    if (State.get('selectedGrade') === 'custom') selectSemester('custom', 'custom');
  }

  function cancelCustomCardEdit() {
    _exitEditMode();
    _setFormMessage('', true);
  }

  /** Back to the plain add form: empty fields, no label, 加入 button. */
  function _exitEditMode() {
    _editingFront = null;
    _resetCardForm();
    _renderEditState();
  }

  /** Empty every field and the suggestion strip, and focus 正面. */
  function _resetCardForm() {
    _writeCardForm(null);
    _suggestion = _noSuggestion();
    _renderSuggestion();
    const f = document.getElementById('ccFront');
    if (f) f.focus();
  }

  /** Reflect _editingFront in the label, buttons and list highlight. */
  function _renderEditState() {
    const editing = _editingFront !== null;
    const label = document.getElementById('ccEditingLabel');
    if (label) {
      label.textContent = editing ? `正在修改「${_editingFront}」` : '';
      label.classList.toggle('hidden', !editing);
    }
    const add = document.querySelector('[data-action="cc-add"]');
    if (add) add.textContent = editing ? '💾 保存修改' : '➕ 加入（可连续添加）';
    const cancel = document.querySelector('[data-action="cc-cancel-edit"]');
    if (cancel) cancel.classList.toggle('hidden', !editing);
    document.querySelectorAll('[data-cc-item]').forEach(row => {
      row.classList.toggle('is-editing', editing && row.dataset.ccItem === _editingFront);
    });
  }

  /** Redraw the card list in place, keeping any active search. */
  function _refreshCustomCardList() {
    const list = document.getElementById('ccList');
    if (!list) return;
    list.innerHTML = ModalUI.renderCustomCardList(CustomCardService.getAll());
    const searchEl = document.getElementById('ccSearch');
    if (searchEl && searchEl.value) ModalUI.filterCustomCardList(searchEl.value);
    _renderEditState();
  }

  /**
   * Add a card from the modal form.
   *
   * Does NOT re-render the modal on success: that would clear the form and
   * scroll position, making a second card tedious. Instead it clears the three
   * inputs, prepends the new card to the list and refocuses 正面, so cards can
   * be entered one after another (Anki's Add-window behaviour).
   */
  function addCustomCard() {
    // The same form and the same submit (button or Enter) edit a card when
    // one is being edited; see startEditCustomCard().
    if (_editingFront !== null) { saveCustomCardEdit(); return; }
    const frontEl = document.getElementById('ccFront');
    if (!frontEl) return;

    const result = CustomCardService.add(_readCardForm());
    if (!result.ok) {
      // Keep what was typed — re-rendering would discard it
      _setFormMessage(result.error, false);
      frontEl.focus();
      return;
    }

    // Surface the "no pinyin → never quizzed" warning alongside the success,
    // rather than letting the card look fully added when it is not usable in
    // 挑战. Still a success: the card is saved and works in 学习.
    const okMessage = result.warning
      ? `已加入「${result.card.front}」✓ ${result.warning}`
      : `已加入「${result.card.front}」✓`;
    _resetCardForm();
    FilterUI.updateCustomCount();

    // Update the list in place where possible. On the very first card the list
    // container does not exist yet, so one full re-render is unavoidable — and
    // that replaces the message element, hence setting the message afterwards
    // in both paths rather than before.
    const list = document.getElementById('ccList');
    if (list) {
      list.innerHTML = ModalUI.renderCustomCardList(CustomCardService.getAll());
      // Clear any active search so the card just added is not hidden by a
      // filter that does not happen to match it — "I just added it, where
      // did it go?" would be a confusing thing to hit right after adding.
      const searchEl = document.getElementById('ccSearch');
      if (searchEl && searchEl.value) {
        searchEl.value = '';
        ModalUI.filterCustomCardList('');
      }
    } else {
      showCustomCards();
    }
    _setFormMessage(okMessage, true);
    const focusTarget = document.getElementById('ccFront');
    if (focusTarget) focusTarget.focus();
  }

  /**
   * Write the inline feedback line under the custom-card form.
   * @param {string} text
   * @param {boolean} ok - true for success styling, false for error
   */
  function _setFormMessage(text, ok) {
    const el = document.getElementById('ccMsg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('form-msg--ok', !!ok);
    el.classList.toggle('form-msg--err', !ok);
  }

  function removeCustomCard(front) {
    // Deleting the card being edited leaves nothing to save into.
    if (_editingFront === String(front || '').trim()) _exitEditMode();
    CustomCardService.remove(front);
    FilterUI.updateCustomCount();
    // In-place list update, same reason as addCustomCard: keep the form intact.
    // _refreshCustomCardList re-applies an active search, so deleting from a
    // filtered-down list does not silently reset the filter.
    if (document.getElementById('ccList') && CustomCardService.count()) {
      _refreshCustomCardList();
    } else {
      showCustomCards(); // last card gone — fall back to the empty state
    }
    // Refresh the study view if it is currently showing custom cards
    if (State.get('selectedGrade') === 'custom') selectSemester('custom', 'custom');
  }

  /** Close the modal and study the custom cards as flashcards */
  function reviewCustomCards() {
    if (!CustomCardService.count()) return;
    ModalUI.close();
    // Safe to go through the sidebar item now: it only intercepts when the
    // collection is empty, and we just checked it is not.
    const item = document.querySelector('.sidebar-item[data-grade="custom"]');
    if (item) { item.click(); return; }
    switchMode('learn');
    selectSemester('custom', 'custom');
  }

  function showHelp() {
    ModalUI.show('❓ 使用说明', ModalUI.renderHelp(), { wide: true });
    // 朗读声音: applies the moment it is chosen; no save button to miss.
    document.querySelectorAll('input[name="voicePreference"]').forEach(r => {
      r.addEventListener('change', () => { if (r.checked) Speech.setVoicePreference(r.value); });
    });
    // Wire the diagnostics button after the modal exists. Built on demand
    // rather than at render time so the report reflects the state at the
    // moment the parent asks for it, and so opening the help page normally
    // costs nothing.
    const btn = document.getElementById('diagShowBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const box = document.getElementById('diagBox');
      const hint = document.getElementById('diagHint');
      box.textContent = ErrorLog.report();
      box.classList.remove('hidden');
      // The button sits inside a sentence, so hiding it would leave a hole
      // mid-line. Disable it in place instead and let the hint carry the
      // result.
      btn.disabled = true;
      // Copy first, then reveal the text as confirmation of what was
      // copied. Where the Clipboard API is unavailable (older iOS, or a
      // non-secure context) the text stays selectable, which is the
      // fallback that has actually worked on parents' phones.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.textContent)
          .then(() => { hint.textContent = '✅ 已复制'; })
          .catch(() => { hint.textContent = '长按下面文字全选复制'; });
      } else {
        hint.textContent = '长按下面文字全选复制';
      }
    });
  }

  function showReport() {
    const html = ModalUI.renderReport(ReportService.build());
    ModalUI.show('📊 学习报告', html, { report: true });
  }

  function showBadges() {
    // Award any badges that qualify but haven't been awarded yet
    BadgeService.checkAndAward();
    const html = ModalUI.renderBadges(BadgeService.getAll(), StatsService.get());
    ModalUI.show('🏆 成就墙', html);
  }

  function showDataTransfer() {
    const profiles = ProfileManager.getProfiles();
    const current = profiles.find(p => p.id === State.getProfileId());
    ModalUI.show('💾 备份与转移', ModalUI.renderDataTransfer(current ? current.name : ''));

    const exportBtn = document.getElementById('xferExportBtn');
    const importBtn = document.getElementById('xferImportBtn');
    const importFile = document.getElementById('xferImportFile');
    const importMsg = document.getElementById('xferImportMsg');

    if (exportBtn) exportBtn.addEventListener('click', _exportData);
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => _importData(e, importMsg));
    }
  }

  /** Trigger a browser download of the current profile's exported data as JSON. */
  function _exportData() {
    const payload = State.exportProfileData();
    const profiles = ProfileManager.getProfiles();
    const current = profiles.find(p => p.id === payload.profileId);
    const safeName = (current ? current.name : '备份').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    const dateStr = payload.exportedAt.slice(0, 10);

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hanzigo-备份-${safeName}-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Handle a chosen backup file: resolve the target profile (creating it if
   * it doesn't exist on this device yet), confirm overwrite, then import. */
  function _importData(event, msgEl) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let payload;
      try {
        payload = JSON.parse(reader.result);
      } catch (_e) {
        if (msgEl) msgEl.textContent = '❌ 这个文件读不出来，现有记录没有被改动。'
          + '要选的是点 💾「导出数据」生成的那个 .json 文件'
          + '（名字类似 hanzigo-备份-宝贝-2026-10-11.json）。';
        return;
      }
      if (!payload || typeof payload !== 'object' || !payload.profileId || typeof payload.data !== 'object') {
        if (msgEl) msgEl.textContent = '❌ 这个文件不是 HanziGo 的备份，现有记录没有被改动。'
          + '请换成点 💾「导出数据」生成的那个 .json 文件。';
        return;
      }

      const displayName = payload.profileName || payload.profileId;
      const exists = State.profileExists(payload.profileId);

      if (!exists) {
        const createConfirmed = window.confirm(
          `这台设备上还没有「${displayName}」这个用户。要新建一个「${displayName}」并导入这份备份吗？`
        );
        if (!createConfirmed) return;
        const createResult = State.createProfileFromImport(payload.profileId, payload.profileName, payload.profileAvatar);
        if (!createResult.ok) {
          // Almost always the same root cause as a failed import: the
          // device won't persist anything. Say so rather than "请重试",
          // which invites the parent to retry something that cannot work.
          if (msgEl) {
            msgEl.textContent = State.storageWorks()
              ? `❌ 没能新建用户「${displayName}」。请刷新页面后再试一次。`
              : `❌ 这台设备存不下数据，没能新建用户「${displayName}」。多半是浏览器开了无痕/隐私模式 —— 换成普通窗口再试。`;
          }
          return;
        }
      } else {
        const overwriteConfirmed = window.confirm(
          `导入会覆盖「${displayName}」当前的生字本、错题本、复习进度、徽章和自定义卡片，确定要继续吗？`
        );
        if (!overwriteConfirmed) return;
      }

      const result = State.importProfileData(payload);
      if (!result.ok) {
        if (msgEl) msgEl.textContent = '❌ 导入失败：' + (result.error || '未知错误');
        return;
      }
      if (typeof SpacedRepService !== 'undefined') SpacedRepService.resetCache();
      if (msgEl) msgEl.textContent = exists
        ? '✅ 导入成功，正在刷新…'
        : `✅ 已新建「${displayName}」并导入数据，正在刷新…`;
      setTimeout(() => window.location.reload(), 600);
    };
    reader.onerror = () => {
      // The file never got read, so nothing was touched — say that, so the
      // parent isn't left wondering whether a half-import happened.
      if (msgEl) msgEl.textContent = '❌ 没能读取这个文件，现有记录没有被改动。'
        + '请确认选的是之前导出的 .json 备份文件，然后再试一次。';
    };
    reader.readAsText(file);
  }

  function removeFavorite(char) {
    FavoriteService.remove(char);
    showFavorites();
    LearnController.showCurrent();
    FilterUI.updateFavCount();
  }

  function reviewFavoritesAsCards() {
    const allChars = State.get('allChars');
    const favorites = FavoriteService.getAll();
    const favChars = allChars.filter(c => favorites.includes(c.char));
    if (!favChars.length) return;
    State.set('filteredChars', favChars);
    State.set('currentIndex', 0);
    ModalUI.close();
    switchMode('learn');
    LearnController.showCurrent();
  }

  function reviewFavoritesAsQuiz() {
    const allChars = State.get('allChars');
    const favorites = FavoriteService.getAll();
    const favChars = allChars.filter(c => favorites.includes(c.char));
    if (favChars.length < 4) { alert('生字本中字数不足4个，无法开始挑战'); return; }
    State.set('filteredChars', favChars);
    ModalUI.close();
    switchMode('challenge');
  }

  function setupSwipe() {
    let startX = 0;
    let startY = 0;
    let swiping = false;
    const container = document.getElementById('cardContainer');
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
      // Ignore touches starting inside the stroke-practice panel (✍️ 笔顺)
      // — see the identical guard in MobileUI._bindSwipe() (js/mobile.js)
      // for the full explanation. This is a SEPARATE swipe implementation
      // that also listens on #cardContainer; a child drawing a horizontal
      // stroke on the canvas was triggering next()/prev() here even after
      // mobile.js's swipe handler was fixed, because this one had no such
      // guard at all.
      if (e.target.closest('#strokePanel')) { swiping = false; return; }
      swiping = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (!swiping) return;
      swiping = false;
      if (State.get('mode') !== 'learn') return;
      const diffX = startX - e.changedTouches[0].clientX;
      const diffY = Math.abs(startY - e.changedTouches[0].clientY);
      if (diffY > 50) return; // vertical scroll, ignore
      if (diffX > 60) LearnController.next();
      else if (diffX < -60) LearnController.prev();
    }, { passive: true });
  }

  /**
   * One-time banner shown when localStorage rejects a write.
   *
   * Deliberately not a blocking alert: the child can keep practising, the
   * only loss is that progress won't survive a reload. Dismissible, and
   * only ever shown once per session (State reports the failure once).
   *
   * Wording follows three rules used for every failure message in the app:
   * say what happened in the user's terms (not "QuotaExceededError"), say
   * what still works, and give the one action that fixes it. A parent
   * reading "保存失败" alone would not know the app is still usable, nor
   * that private browsing is the cause — which it almost always is.
   */
  function _showStorageWarning() {
    if (document.getElementById('storageWarning')) return;
    const el = document.createElement('div');
    el.id = 'storageWarning';
    el.className = 'storage-warning';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span><strong>⚠️ 这台设备存不下学习记录。</strong>
      现在可以照常练，但<strong>一关页面今天的进度就没了</strong>。
      常见原因是浏览器开了无痕/隐私模式，或者设置里把网站数据关掉了 ——
      换成普通窗口打开就好。如果还是不行，点右上角 ❓ 里的「显示诊断信息」发给我。</span>
      <button type="button" aria-label="知道了">知道了</button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }

  async function init() {
    try {
      // Show loading state
      const mainEl = document.querySelector('main');
      mainEl.innerHTML = `
        <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
          <div style="font-size:36px;margin-bottom:12px">⏳</div>
          <p>正在加载数据...</p>
        </div>`;

      // Load configuration first
      await State.loadConfig();

      // Preload speech voices (async in some browsers)
      Speech.init();
      // Load the 多音字 table so 爪 is read zhuǎ (as the textbook annotates
      // it) rather than the engine default zhǎo. Not awaited: a slow or
      // failed fetch must not delay first paint, and speakChar() falls back
      // to the bare character while the table is empty.
      Speech.loadHeteronyms();
      // Recorded syllables for the cards. Same reasoning: not awaited,
      // and until it lands every card simply uses TTS.
      Speech.loadSyllables();

      // Load character data
      const { allChars } = await DataService.loadAll();

      // Handle empty data gracefully
      if (!allChars.length) {
        mainEl.innerHTML = `
          <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
            <div style="font-size:48px;margin-bottom:16px">📭</div>
            <h3 style="color:var(--text);margin-bottom:8px">暂无数据</h3>
            <p>请将生字JSON文件放入 data/ 目录</p>
            <p style="font-size:12px;margin-top:12px">格式: grade{N}-semester{M}.json</p>
          </div>`;
        return;
      }

      // Restore main content (was replaced by loading state)
      mainEl.innerHTML = _getMainContentHTML();

      // Tell the user once if the device refuses to persist anything —
      // otherwise the only symptom is that progress silently resets on
      // every visit, which reads as "the app is broken" rather than
      // "private browsing is on". Registered before the first writes
      // happen so the very first failure is the one that triggers it.
      State.onStorageFailure(() => _showStorageWarning());

      // Profile selection — waits for user to pick/create a profile before proceeding
      ProfileManager.init(() => {
        try {
          FilterUI.updateStripCounts(State.get('lessons'));
          FilterUI.renderLessons();
          FilterUI.updateFavCount();
          FilterUI.updateErrCount();
          FilterUI.updateSrsCount();
          FilterUI.updateCustomCount();
          FilterUI.updateStreakDisplay();

          _restoreInitialView();
          _syncSidebarSelection(State.get('mode'));
          // Mirrors switchMode()'s bottom-bar visibility rule for the
          // mode we actually booted into — boot does not go through
          // switchMode() itself (see selectSemester calls above), so
          // without this the ◀️🔄🔊🔁▶️ bar would default to visible on
          // mobile even when 任务 (the default mode) is showing.
          if (typeof MobileUI !== 'undefined') MobileUI.setBottomBarVisible(State.get('mode') === 'learn');
        } catch (e) {
          console.warn('[App] Setup error (non-fatal):', e);
        }

        console.info('[App] Binding events...');
        bindEvents();
        console.info('[App] ✅ Ready!');        setupSwipe();
        // 🃏 字卡 | 📖 故事 under the lesson dropdown (js/story.js). A link with
        // #invite=… opens the stories first (js/story-invite.js); its code is
        // removed from the address bar before anything else.
        if (typeof StoryInvite !== 'undefined') StoryInvite.init();
        if (typeof StoryView !== 'undefined') StoryView.init();

        // Render daily task (default mode)
        if (typeof DailyTaskController !== 'undefined') {
          DailyTaskController.render();
        }
      });
    } catch (err) {
      console.error('[App] Initialization failed:', err);
      // Guarded like the other call sites: this is the last-resort handler
      // that paints the "couldn't open" screen, so a throw here would
      // leave the parent with a blank page instead of instructions.
      if (typeof ErrorLog !== 'undefined') {
        ErrorLog.record('js', 'init failed: ' + (err && err.message));
      }
      const mainEl = document.querySelector('main');
      // The worst-case screen: nothing loaded. A raw err.message here is
      // usually an English technical string ("Failed to fetch") that tells
      // a parent nothing. Lead with the likely cause and the one thing
      // worth trying, keep the technical text as a collapsed detail for
      // the diagnostic copy-paste, and offer the report path.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      mainEl.innerHTML = `
        <div style="text-align:center;padding:48px 24px;max-width:420px;margin:0 auto">
          <div style="font-size:48px;margin-bottom:16px">⚠️</div>
          <h3 style="color:var(--text);margin-bottom:8px">没能打开 HanziGo</h3>
          <p style="color:var(--text-secondary);line-height:1.7">${
            offline
              ? '看起来现在没有联网。第一次打开需要联网，之后就可以离线用了 —— 连上网络再点下面的「重新打开」。'
              : '可能是网络不稳，或者上次没下载完整。点下面的「重新打开」通常就好了。'
          }</p>
          <button onclick="location.reload()" class="dt-btn-primary" style="margin-top:16px">重新打开</button>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin-top:20px;line-height:1.7">
            试几次还是这样的话，把下面这行发给我：<br>
            <code style="user-select:text;-webkit-user-select:text;word-break:break-all">${escapeHtml(err && err.message || 'unknown')}</code>
          </p>
        </div>`;
    }
  }

  /** Returns the original main content HTML (restored after loading state) */
  function _getMainContentHTML() {
    return `
    <!-- Daily Task Mode -->
    <div id="dailyTaskMode"></div>

    <!-- Learning Mode -->
    <div id="learnMode" class="hidden">
      <div class="content-header">
        <label for="lessonFilter" class="hidden">选择课文</label>
        <select id="lessonFilter" aria-label="选择课文">
          <option value="all">全部课文</option>
        </select>
      </div>
      <div class="card-container" id="cardContainer">
        <div class="card" id="flashcard" role="button" aria-label="点击翻转卡片">
          <div class="card-face card-front">
            <button class="pinyin-toggle" id="btnPinyinToggle">拼音</button>
            <button class="fav-btn" id="favBtn">🤍</button>
            <button class="fav-btn hidden" id="btnDeleteCard" title="删除这张卡片" aria-label="删除这张卡片">🗑</button>
            <div class="card-char char-display" id="cardChar" role="button" aria-label="点击朗读" title="点击朗读">天</div>
            <div class="card-pinyin-small hidden" id="cardPinyinSmall">tiān</div>
            <div class="card-hint">点击翻转 →</div>
          </div>
          <div class="card-face card-back">
            <div class="card-back-content" id="cardBackContent">
              <div class="card-pinyin-back" id="cardPinyinBack">tiān</div>
              <div class="card-words" id="cardWords">天空 · 今天 · 蓝天</div>
              <div class="card-sentence" id="cardSentence">天在上，地在下。</div>
              <button class="stroke-toggle-btn" id="btnStrokePractice" aria-label="笔顺练习" aria-expanded="false">✍️ 笔顺</button>
            </div>
            <div class="stroke-panel hidden" id="strokePanel">
              <div class="stroke-canvas-target" id="strokeCanvasTarget"></div>
              <div class="stroke-panel-controls">
                <button id="btnStrokeReplay" aria-label="重新演示笔顺">🔁 再看一遍</button>
                <button id="btnStrokeQuiz" aria-label="开始练习">✍️ 我来写</button>
              </div>
              <div class="stroke-panel-msg hidden" id="strokePanelMsg"></div>
              <button class="stroke-panel-close" id="btnStrokeClose" aria-label="收起笔顺练习">收起 ✕</button>
            </div>
          </div>
        </div>
      </div>
      <div class="card-controls">
        <button id="btnPrev" aria-label="上一个">⬅️ 上一个</button>
        <button id="btnFlip" aria-label="翻转卡片">🔄 翻转</button>
        <button id="btnSpeak" aria-label="朗读">🔊 朗读</button>
        <button id="btnReinforce" aria-label="加强记忆" class="btn-reinforce">🔁 加强记忆</button>
        <button id="btnNext" aria-label="下一个">➡️ 下一个</button>
        <button id="btnNewCard" class="hidden" aria-label="新建自定义卡片">➕ 新建卡片</button>
      </div>
      <div class="progress-container">
        <div class="progress-track"><div class="progress-fill" id="progressFill" style="width:2%"></div></div>
        <div class="progress-text" id="progressBar">1 / 45</div>
      </div>
    </div>

    <!-- Challenge Mode -->
    <div id="challengeMode" class="hidden">
      <div class="quiz-type-selector" id="quizTypeSelector">
        <button class="quiz-type-btn active" data-qtype="pickPinyin">字→音</button>
        <button class="quiz-type-btn" data-qtype="pickChar">音→字</button>
        <button class="quiz-type-btn" data-qtype="pickWord">字→词</button>
        <button class="quiz-type-btn" data-qtype="fillBlank">📝 填空</button>
        <button class="quiz-type-btn" data-qtype="mixed">🎲 混合</button>
        <select id="quizTimerSelect" class="quiz-timer-select">
          <option value="0">⏱️ 关</option>
          <option value="5">⏱️ 5秒</option>
          <option value="10">⏱️ 10秒</option>
          <option value="15">⏱️ 15秒</option>
        </select>
      </div>
      <div class="quiz-timer-bar hidden" id="quizTimerBar">
        <div class="quiz-timer-fill" id="quizTimerFill"></div>
      </div>
      <div class="quiz-container" id="quizActive">
        <div class="quiz-dots" id="quizDots"></div>
        <div class="quiz-stats">
          <span>📊 <span id="quizScore">0</span>分</span>
          <span>🔥 <span id="quizStreak">0</span>连对 <span id="streakFire" class="streak-fire hidden">🔥</span></span>
          <span>📝 <span id="quizProgress">1/10</span></span>
        </div>
        <div class="quiz-char char-display" id="quizChar">天</div>
        <div class="quiz-options" id="quizOptions"></div>
      </div>
      <div id="quizEnd" class="end-screen hidden">
        <div class="end-score" id="endScore">8</div>
        <div class="end-detail" id="endDetail">正确率 80%</div>
        <div class="end-msg" id="endMsg">很厉害！继续加油！💪</div>
        <div class="end-actions">
          <button class="btn-play-again" id="btnPlayAgain" onclick="ChallengeController.start()">🔄 再来一轮</button>
          <button class="btn-play-again btn-play-again--secondary" id="btnErrorReview" onclick="ChallengeController.start(true)">📖 错题复习</button>
        </div>
      </div>
    </div>`;
  }

  function bindEvents() {
    // --- Header actions ---
    document.getElementById('btnProfile').addEventListener('click', () => {
      ProfileManager.showPicker(() => {
        // Reload UI with new profile's data
        FilterUI.updateFavCount();
        FilterUI.updateErrCount();
        SpacedRepService.resetCache();
    FilterUI.updateSrsCount();
        FilterUI.updateStreakDisplay();
        LearnController.showCurrent();
      });
    });
    document.getElementById('btnFavorites').addEventListener('click', showFavorites);
    document.getElementById('btnBadges').addEventListener('click', showBadges);
    document.getElementById('btnReport').addEventListener('click', showReport);
    document.getElementById('btnDataTransfer').addEventListener('click', showDataTransfer);
    document.getElementById('btnHelp').addEventListener('click', showHelp);

    // --- Navigation: sidebar ---
    // Review group toggle (collapsible)
    document.getElementById('reviewGroupToggle').addEventListener('click', () => {
      const header = document.getElementById('reviewGroupToggle');
      const items = document.getElementById('reviewGroupItems');
      const arrow = document.getElementById('reviewArrow');
      const isCollapsed = items.classList.toggle('collapsed');
      header.classList.toggle('collapsed');
      arrow.textContent = isCollapsed ? '+' : '−';
    });

    // Grade accordion — click header to expand, collapse others
    document.getElementById('sidebarGrades').addEventListener('click', (e) => {
      const header = e.target.closest('.sidebar-grade-header');
      if (header) {
        const group = header.closest('.sidebar-grade-group');
        const children = group.querySelector('.sidebar-grade-children');
        const isExpanded = children.classList.contains('expanded');

        // Collapse all
        document.querySelectorAll('.sidebar-grade-children.expanded').forEach(el => el.classList.remove('expanded'));
        document.querySelectorAll('.sidebar-grade-header.active').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.sidebar-grade-arrow').forEach(el => el.textContent = '+');

        // Expand clicked (if it wasn't already open)
        if (!isExpanded) {
          children.classList.add('expanded');
          header.classList.add('active');
          header.querySelector('.sidebar-grade-arrow').textContent = '−';
        }
        return;
      }
    });

    // Sidebar item clicks (semester selection + review items)
    document.getElementById('sidebar').addEventListener('click', (e) => {
      const item = e.target.closest('.sidebar-item');
      if (!item || item.classList.contains('disabled')) return;

      // Handle badges button
      if (item.id === 'sidebarBadges') {
        showBadges();
        return;
      }

      // 自定义 behaves like its siblings (练生字/练错题/智能复习): clicking it
      // loads the cards into study mode. The one exception is an empty
      // collection — there is nothing to study, and the editor is the only
      // place a first card can be created, so open that instead.
      if (item.dataset.grade === 'custom' && CustomCardService.count() === 0) {
        showCustomCards();
        return;
      }

      // Handle grade/review item selection
      if (item.dataset.sem && item.dataset.grade) {
        // Switch mode BEFORE painting the highlight: switchMode calls
        // _syncSidebarSelection, which clears the selection in modes that do
        // not use the sidebar. Painting first would immediately be undone.
        if (State.get('mode') === 'dailyTask') {
          switchMode('learn');
        }
        document.querySelectorAll('.sidebar-item').forEach(c => c.classList.remove('active'));
        item.classList.add('active');
        selectSemester(item.dataset.sem, item.dataset.grade);
      }
    });

    // --- Navigation: lesson filter ---
    document.getElementById('lessonFilter').addEventListener('change', (e) => {
      selectLesson(e.target.value);
    });

    // --- Navigation: mode tabs ---
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // --- Learning mode: card interactions ---
    document.getElementById('flashcard').addEventListener('click', LearnController.flip);
    // Tapping the character speaks it. index.html has always declared this
    // (role="button" title="点击朗读") but nothing was ever bound, so the card
    // just flipped — stopPropagation keeps the flip handler above from firing.
    document.getElementById('cardChar').addEventListener('click', (e) => {
      e.stopPropagation();
      LearnController.speakCurrent();
    });
    document.getElementById('btnPinyinToggle').addEventListener('click', (e) => { e.stopPropagation(); LearnController.togglePinyin(); });
    document.getElementById('favBtn').addEventListener('click', (e) => { e.stopPropagation(); LearnController.toggleFavorite(); });
    document.getElementById('btnPrev').addEventListener('click', LearnController.prev);
    document.getElementById('btnFlip').addEventListener('click', LearnController.flip);
    document.getElementById('btnSpeak').addEventListener('click', LearnController.speakCurrent);
    document.getElementById('btnReinforce').addEventListener('click', LearnController.reinforce);
    document.getElementById('btnNext').addEventListener('click', LearnController.next);
    LearnController._initStrokePractice();
    document.getElementById('btnDeleteCard').addEventListener('click', (e) => {
      e.stopPropagation(); // the card itself flips on click
      LearnController.deleteCurrentCard();
    });
    document.getElementById('btnNewCard').addEventListener('click', showCustomCards);

    // --- Challenge mode: quiz actions ---
    document.getElementById('quizTypeSelector').addEventListener('click', (e) => {
      const btn = e.target.closest('.quiz-type-btn');
      if (!btn) return;
      document.querySelectorAll('.quiz-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ChallengeController.setType(btn.dataset.qtype);
      ChallengeController.start();
    });
    document.getElementById('quizTimerSelect').addEventListener('change', (e) => {
      ChallengeController.setTimer(parseInt(e.target.value));
      ChallengeController.start();
    });
    document.getElementById('btnPlayAgain').addEventListener('click', () => ChallengeController.start());
    document.getElementById('btnErrorReview').addEventListener('click', () => ChallengeController.start(true));
    document.getElementById('quizOptions').addEventListener('click', (e) => {
      const btn = e.target.closest('.quiz-option');
      if (btn) ChallengeController.answer(parseInt(btn.dataset.index));
    });

    // --- Modal ---
    document.getElementById('btnModalClose').addEventListener('click', ModalUI.close);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) ModalUI.close();
    });
    // Enter submits the custom-card form. Delegated because the modal content
    // is replaced wholesale, so direct listeners would not survive a re-render.
    // Shift+Enter still inserts a newline in the 例句 textarea.
    document.getElementById('modalContent').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const t = e.target;
      if (!t || !['ccFront', 'ccPinyin', 'ccWords', 'ccSentence'].includes(t.id)) return;
      e.preventDefault();
      addCustomCard();
    });

    // Filter the custom-card list as you type. Delegated for the same reason
    // as the keydown handler above.
    document.getElementById('modalContent').addEventListener('input', (e) => {
      if (e.target && e.target.id === 'ccSearch') {
        ModalUI.filterCustomCardList(e.target.value);
      }
      if (e.target && e.target.id === 'ccFront') updateCardSuggestion();
    });

    document.getElementById('modalContent').addEventListener('click', (e) => {
      const removeFavBtn = e.target.closest('[data-action="remove-fav"]');
      if (removeFavBtn) { removeFavorite(removeFavBtn.dataset.char); return; }

      const reviewCards = e.target.closest('[data-action="review-cards"]');
      if (reviewCards) { reviewFavoritesAsCards(); return; }

      const reviewQuiz = e.target.closest('[data-action="review-quiz"]');
      if (reviewQuiz) { reviewFavoritesAsQuiz(); return; }

      const ccAdd = e.target.closest('[data-action="cc-add"]');
      if (ccAdd) { addCustomCard(); return; }

      const ccRemove = e.target.closest('[data-action="cc-remove"]');
      if (ccRemove) { removeCustomCard(ccRemove.dataset.front); return; }

      const ccReview = e.target.closest('[data-action="cc-review"]');
      if (ccReview) { reviewCustomCards(); return; }

      const ccSpeak = e.target.closest('[data-action="cc-speak"]');
      if (ccSpeak) { Speech.speak(ccSpeak.dataset.front); return; }

      const ccSuggest = e.target.closest('[data-action="cc-suggest"]');
      if (ccSuggest) { applyCardSuggestion(Number(ccSuggest.dataset.index)); return; }

      const ccEdit = e.target.closest('[data-action="cc-edit"]');
      if (ccEdit) { startEditCustomCard(ccEdit.dataset.front); return; }

      const ccCancel = e.target.closest('[data-action="cc-cancel-edit"]');
      if (ccCancel) { cancelCustomCardEdit(); return; }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
      if (State.get('mode') !== 'learn') return;
      // While a story is showing, ← → turn its pages instead of the cards.
      if (typeof StoryView !== 'undefined' && StoryView.isActive()) {
        if (e.key === 'ArrowRight') StoryView.next();
        else if (e.key === 'ArrowLeft') StoryView.prev();
        return;
      }
      if (e.key === 'ArrowRight') LearnController.next();
      else if (e.key === 'ArrowLeft') LearnController.prev();
      else if (e.key === ' ') { e.preventDefault(); LearnController.flip(); }
    });
  }

  return { init, switchMode, selectSemester, selectLesson, showFavorites,
           showBadges, showReport, showHelp, showDataTransfer, showCustomCards, addCustomCard, removeCustomCard, updateCardSuggestion, applyCardSuggestion,
           startEditCustomCard, saveCustomCardEdit, cancelCustomCardEdit,
           // Exported for tests: boot runs once per page load, so the
           // launch-order rules can only be exercised by calling this directly.
           _restoreInitialView,
           // Exported for tests: the once-per-session latch in State means a
           // failed write only shows the banner the first time, so a test
           // needs to render it directly to assert its wording.
           showStorageWarning: _showStorageWarning };
})();
