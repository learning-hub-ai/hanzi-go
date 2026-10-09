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
      </div>
    `;

    document.body.appendChild(picker);

    // Event: close picker
    document.getElementById('btnPickerClose').addEventListener('click', () => {
      picker.remove();
    });

    // Event: select existing profile
    picker.querySelectorAll('.profile-item:not(.profile-add)').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.edit-icon')) return; // Don't select when editing
        const id = item.dataset.id;
        State.setProfile(id);
        updateHeaderAvatar();
        picker.remove();
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
          picker.remove();
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
      picker.remove();
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
    Speech.speak(chars[State.get('currentIndex')].char);
  }

  return { showCurrent, next, prev, resetShuffle, reinforce, flip, togglePinyin, toggleFavorite, speakCurrent, deleteCurrentCard };
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
    QuizUI.renderQuestion(q, quiz.score, quiz.streak, quiz.current + 1, quiz.questions.length);
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

    if (isCorrect) {
      // Speak the pronunciation, then hold the usual feedback delay on top
      // of it before advancing — total wait = actual sound length +
      // feedbackDelayMs, so the sound always finishes while ITS question is
      // still on screen, and the child still gets a feedbackDelayMs pause
      // to look at the highlighted answer afterwards. Speech.speak's onDone
      // is guaranteed to fire eventually even if every audio source fails
      // (bounded by speech.startTimeoutMs internally), so this never hangs.
      Speech.speak(q.target.char, () => {
        setTimeout(() => _advanceToNext(quiz), feedbackDelayMs);
      });
    } else {
      // No pronunciation on a wrong answer — the original fixed delay is
      // fine, there's nothing async to wait for.
      setTimeout(() => _advanceToNext(quiz), feedbackDelayMs);
    }
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

    const newBadges = BadgeService.checkAndAward();
    newBadges.forEach(b => BadgePopupUI.show(b));
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

  return { start, answer, setType, getType, setCount, getCount, setTimer, stop: _clearTimer };
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
    }
  }

  function selectSemester(sem, grade) {
    State.set('selectedSemester', sem);
    State.set('selectedGrade', grade);
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
  }

  function showFavorites() {
    const html = ModalUI.renderFavorites(FavoriteService.getAll());
    ModalUI.show(`❤️ 生字本 (${FavoriteService.getAll().length}字)`, html);
  }

  function showCustomCards() {
    ModalUI.show(`✏️ 自定义字卡 (${CustomCardService.count()}张)`,
      ModalUI.renderCustomCards(CustomCardService.getAll()), { cc: true });
    // Land the cursor where typing starts, so the keyboard flow works from the
    // moment the panel opens
    const f = document.getElementById('ccFront');
    if (f) f.focus();
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
    const frontEl = document.getElementById('ccFront');
    const pinyinEl = document.getElementById('ccPinyin');
    const backEl = document.getElementById('ccBack');
    const msgEl = document.getElementById('ccMsg');
    if (!frontEl || !backEl) return;

    const result = CustomCardService.add(frontEl.value, backEl.value, pinyinEl ? pinyinEl.value : '');
    if (!result.ok) {
      // Keep what was typed — re-rendering would discard it
      _setFormMessage(result.error, false);
      frontEl.focus();
      return;
    }

    const okMessage = `已加入「${result.card.front}」✓`;
    frontEl.value = '';
    backEl.value = '';
    if (pinyinEl) pinyinEl.value = '';
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
    CustomCardService.remove(front);
    FilterUI.updateCustomCount();
    // In-place list update, same reason as addCustomCard: keep the form intact
    const list = document.getElementById('ccList');
    const remaining = CustomCardService.getAll();
    if (list && remaining.length) {
      list.innerHTML = ModalUI.renderCustomCardList(remaining);
      // Re-apply whatever search was active — deleting a card out of a
      // filtered-down list should not silently reset the filter.
      const searchEl = document.getElementById('ccSearch');
      if (searchEl && searchEl.value) {
        ModalUI.filterCustomCardList(searchEl.value);
      }
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
        if (msgEl) msgEl.textContent = '❌ 这不是一个有效的备份文件';
        return;
      }
      if (!payload || typeof payload !== 'object' || !payload.profileId || typeof payload.data !== 'object') {
        if (msgEl) msgEl.textContent = '❌ 文件格式不对，不是从这个应用导出的备份';
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
          if (msgEl) msgEl.textContent = '❌ 新建用户失败，请重试';
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
      if (msgEl) msgEl.textContent = '❌ 读取文件失败，请重试';
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
    const container = document.getElementById('cardContainer');
    if (!container) return;

    container.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (State.get('mode') !== 'learn') return;
      const diffX = startX - e.changedTouches[0].clientX;
      const diffY = Math.abs(startY - e.changedTouches[0].clientY);
      if (diffY > 50) return; // vertical scroll, ignore
      if (diffX > 60) LearnController.next();
      else if (diffX < -60) LearnController.prev();
    }, { passive: true });
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

          // Default view: preload favorites if any, otherwise 一上.
          // The highlight below is painted unconditionally, then dropped by
          // _syncSidebarSelection if we booted into 任务 — where the sidebar
          // selection is not used and a highlight claims one that is not.
          const favorites = FavoriteService.getAll();
          if (favorites.length > 0) {
            selectSemester('fav', 'fav');
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            const favItem = document.querySelector('.sidebar-item[data-grade="fav"]');
            if (favItem) favItem.classList.add('active');
          } else {
            selectSemester('1', '1');
          }
          _syncSidebarSelection(State.get('mode'));
        } catch (e) {
          console.warn('[App] Setup error (non-fatal):', e);
        }

        console.info('[App] Binding events...');
        bindEvents();
        console.info('[App] ✅ Ready!');        setupSwipe();

        // Render daily task (default mode)
        if (typeof DailyTaskController !== 'undefined') {
          DailyTaskController.render();
        }
      });
    } catch (err) {
      console.error('[App] Initialization failed:', err);
      const mainEl = document.querySelector('main');
      mainEl.innerHTML = `
        <div style="text-align:center;padding:48px 24px;color:var(--error)">
          <div style="font-size:48px;margin-bottom:16px">⚠️</div>
          <h3 style="color:var(--text);margin-bottom:8px">加载失败</h3>
          <p style="color:var(--text-muted)">${escapeHtml(err.message)}</p>
          <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;border-radius:8px;border:none;background:var(--primary);color:#fff;cursor:pointer">重试</button>
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
            <div class="card-pinyin-back" id="cardPinyinBack">tiān</div>
            <div class="card-words" id="cardWords">天空 · 今天 · 蓝天</div>
            <div class="card-sentence" id="cardSentence">天在上，地在下。</div>
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
    // Shift+Enter still inserts a newline in the 反面 textarea.
    document.getElementById('modalContent').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const t = e.target;
      if (!t || !['ccFront', 'ccPinyin', 'ccBack'].includes(t.id)) return;
      e.preventDefault();
      addCustomCard();
    });

    // Filter the custom-card list as you type. Delegated for the same reason
    // as the keydown handler above.
    document.getElementById('modalContent').addEventListener('input', (e) => {
      if (e.target && e.target.id === 'ccSearch') {
        ModalUI.filterCustomCardList(e.target.value);
      }
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
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
      if (State.get('mode') !== 'learn') return;
      if (e.key === 'ArrowRight') LearnController.next();
      else if (e.key === 'ArrowLeft') LearnController.prev();
      else if (e.key === ' ') { e.preventDefault(); LearnController.flip(); }
    });
  }

  return { init, switchMode, selectSemester, selectLesson, showFavorites,
           showBadges, showReport, showHelp, showDataTransfer, showCustomCards, addCustomCard, removeCustomCard };
})();
