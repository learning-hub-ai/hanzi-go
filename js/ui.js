/**
 * UI Components — rendering only, no business logic.
 *
 * Modules:
 * - FilterUI: lesson dropdown and sidebar count updates
 * - CardUI: flash card rendering and flip
 * - QuizUI: quiz question rendering and feedback
 * - ModalUI: generic modal for favorites, error book, badges, report, custom cards
 * - BadgePopupUI: badge unlock celebration
 */

/** Filter UI — manages sidebar counts and lesson dropdown */
const FilterUI = (() => {
  /** Render the lesson dropdown options for current grade/semester */
  function renderLessons() {
    const sel = document.getElementById('lessonFilter');
    const lessons = DataService.getFilteredLessons();
    const charCount = lessons.reduce((sum, l) => sum + l.chars.length, 0);
    sel.innerHTML = `<option value="all">全部课文 (${charCount}字)</option>`;
    lessons.forEach(l => {
      sel.innerHTML += `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)} (${l.chars.length}字)</option>`;
    });
  }

  function updateStripCounts(lessons) {
    // Update per-grade/semester character counts
    const countEls = document.querySelectorAll('[data-count-for]');
    countEls.forEach(el => {
      const key = el.dataset.countFor; // e.g. "1-1"
      const [grade, sem] = key.split('-');
      const matching = lessons.filter(l => l.id.split('-')[0] === grade && l.id.split('-')[1] === sem);
      const count = matching.reduce((sum, l) => sum + l.chars.length, 0);
      el.textContent = count > 0 ? count : '';
      // Disable sidebar items with no characters
      const item = el.closest('.sidebar-item');
      if (item) item.classList.toggle('disabled', count === 0);
      _renderEditionTag(item, grade, sem);
    });

    // Set first available item as active
    const firstActive = document.querySelector('.sidebar-grades .sidebar-item:not(.disabled)');
    if (firstActive && !document.querySelector('.sidebar-grades .sidebar-item.active')) {
      firstActive.classList.add('active');
    }

    updateFavCount();
    updateErrCount();
  }

  /**
   * Show which textbook print year (统编版 2017/2018/2019/2024...) a
   * grade/semester's data comes from, so parents can tell whether it
   * matches the book their child actually has. Shown as a small tag
   * next to the 上册/下册 label in the sidebar.
   */
  function _renderEditionTag(item, grade, sem) {
    if (!item) return;
    const label = item.querySelector('.sidebar-item-label');
    if (!label) return;
    let tag = item.querySelector('.sidebar-item-edition');
    const edition = typeof DataService !== 'undefined' ? DataService.getEdition(grade, sem) : null;
    if (!edition) {
      if (tag) tag.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'sidebar-item-edition';
      label.after(tag);
    }
    tag.textContent = `${edition}版`;
  }

  function updateFavCount() {
    const count = FavoriteService.getAll().length;
    const el = document.getElementById('favSideCount');
    if (el) el.textContent = count;
    const item = el ? el.closest('.sidebar-item') : null;
    if (item) item.classList.toggle('disabled', count === 0);
  }

  function updateErrCount() {
    const count = ErrorBookService.count();
    const el = document.getElementById('errSideCount');
    if (el) el.textContent = count;
    const item = el ? el.closest('.sidebar-item') : null;
    if (item) item.classList.toggle('disabled', count === 0);
  }

  function updateSrsCount() {
    const count = SpacedRepService.getDueCount();
    console.info('[SRS] Due count:', count, 'Total:', SpacedRepService.getTotalCount());
    const el = document.getElementById('srsSideCount');
    if (el) el.textContent = count;
    const item = el ? el.closest('.sidebar-item') : null;
    if (item) item.classList.toggle('disabled', count === 0);
  }

  /** Update streak display in header */
  function updateStreakDisplay() {
    const el = document.getElementById('streakNumber');
    if (el) el.textContent = State.get('stats').consecutiveDays || 0;
  }

  /**
   * Update the 自定义字卡 badge.
   *
   * Unlike the other review items this one is NEVER disabled at zero: with no
   * cards the only way to create one is to click it and use the form, so
   * disabling it would make the feature unreachable.
   */
  function updateCustomCount() {
    const count = CustomCardService.count();
    const el = document.getElementById('customSideCount');
    if (el) el.textContent = count;
  }

  return { renderLessons, updateStripCounts, updateFavCount, updateErrCount, updateSrsCount, updateStreakDisplay, updateCustomCount };
})();

/** Card UI — flash card rendering, flip animation, state display */
const CardUI = (() => {
  /** Render a character on the card (front + back content) */
  function render(charData, index, total) {
    const card = document.getElementById('flashcard');
    // Skip flip animation when navigating — instantly show front
    card.style.transition = 'none';
    card.classList.remove('flipped');
    // Force reflow to apply instant change, then restore transition
    card.offsetHeight;
    card.style.transition = '';

    const charEl = document.getElementById('cardChar');
    charEl.textContent = charData.char;
    // Custom cards may have a multi-character front. Size via CSS classes, not
    // an inline font-size, so .card-char's responsive clamp() still wins.
    const frontLen = (charData.char || '').length;
    charEl.classList.remove('card-char--len2', 'card-char--len4', 'card-char--long');
    if (frontLen > 4) charEl.classList.add('card-char--long');
    else if (frontLen > 2) charEl.classList.add('card-char--len4');
    else if (frontLen > 1) charEl.classList.add('card-char--len2');
    document.getElementById('cardPinyinSmall').textContent = charData.pinyin || '';
    document.getElementById('cardPinyinSmall').classList.toggle('hidden', !State.get('showPinyin'));
    document.getElementById('cardPinyinBack').textContent = charData.pinyin || '';
    // words/sentence are optional — error-book and custom cards may lack both
    document.getElementById('cardWords').textContent = (charData.words || []).join(' · ');
    document.getElementById('cardSentence').textContent = charData.sentence || '';
    document.getElementById('favBtn').textContent = FavoriteService.isFavorite(charData.char) ? '❤️' : '🤍';
    document.getElementById('progressBar').textContent = `${index + 1} / ${total}`;
    document.getElementById('progressFill').style.width = `${((index + 1) / total) * 100}%`;
  }

  function flip() {
    document.getElementById('flashcard').classList.toggle('flipped');
  }

  function updateFavIcon(isFav) {
    document.getElementById('favBtn').textContent = isFav ? '❤️' : '🤍';
  }

  function togglePinyinDisplay(show) {
    document.getElementById('cardPinyinSmall').classList.toggle('hidden', !show);
  }

  return { render, flip, updateFavIcon, togglePinyinDisplay };
})();

/** Quiz UI — question rendering, feedback animations, end screen */
const QuizUI = (() => {
  /** Render a quiz question with options and progress dots */
  function renderQuestion(question, score, streak, progress, total) {
    const quizCharEl = document.getElementById('quizChar');
    document.getElementById('quizScore').textContent = score;
    document.getElementById('quizStreak').textContent = streak;
    document.getElementById('quizProgress').textContent = `${progress}/${total}`;
    document.getElementById('streakFire').classList.toggle('hidden', streak < State.config('streakThresholdForFire', 3));

    // Render prompt based on question type
    const type = question.type || 'pickPinyin';
    if (type === 'pickPinyin') {
      quizCharEl.textContent = question.target.char;
      quizCharEl.style.fontSize = '';
    } else if (type === 'pickChar') {
      quizCharEl.textContent = question.target.pinyin;
      quizCharEl.style.fontSize = '36px';
    } else if (type === 'fillBlank') {
      quizCharEl.textContent = question.sentence;
      quizCharEl.style.fontSize = '20px';
    } else if (type === 'pickWord') {
      quizCharEl.textContent = question.blankedWord;
      quizCharEl.style.fontSize = '36px';
    }

    // Render dots
    const dotsEl = document.getElementById('quizDots');
    if (dotsEl.children.length !== total) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'quiz-dot';
        dotsEl.appendChild(dot);
      }
    }
    dotsEl.querySelectorAll('.quiz-dot').forEach((d, i) => {
      d.classList.toggle('current', i === progress - 1);
    });

    // Render options based on type
    const container = document.getElementById('quizOptions');
    container.innerHTML = '';
    question.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      if (type === 'pickPinyin') {
        btn.textContent = opt.pinyin;
      } else if (type === 'pickChar' || type === 'fillBlank' || type === 'pickWord') {
        btn.textContent = opt.char;
        btn.classList.add('quiz-option-char');
      }
      btn.dataset.index = i;
      container.appendChild(btn);
    });
  }

  function showFeedback(selectedIdx, correctIdx, isCorrect) {
    const options = document.querySelectorAll('.quiz-option');
    options.forEach(o => o.classList.add('disabled'));
    options[correctIdx].classList.add('correct');
    if (!isCorrect && selectedIdx >= 0) options[selectedIdx].classList.add('wrong');

    // Update dot color
    const quiz = State.get('quiz');
    const dots = document.querySelectorAll('.quiz-dot');
    if (dots[quiz.current]) {
      dots[quiz.current].classList.remove('current');
      dots[quiz.current].classList.add(isCorrect ? 'correct' : 'wrong');
    }

    // Score bounce
    if (isCorrect) {
      const scoreEl = document.getElementById('quizScore');
      scoreEl.classList.add('score-bounce');
      setTimeout(() => scoreEl.classList.remove('score-bounce'), 300);
    }
  }

  function updateStreak(streak) {
    document.getElementById('quizStreak').textContent = streak;
    document.getElementById('streakFire').classList.toggle('hidden', streak < State.config('streakThresholdForFire', 3));
    document.getElementById('quizScore').textContent = State.get('quiz').score;
  }

  function showEndScreen(score, total) {
    document.getElementById('quizActive').classList.add('hidden');
    document.getElementById('quizEnd').classList.remove('hidden');
    const pct = Math.round(score / total * 100);
    document.getElementById('endScore').textContent = `${score}/${total}`;
    document.getElementById('endDetail').textContent = `正确率 ${pct}%`;

    let msg;
    if (pct === 100) msg = State.config('encourageMessages.perfect', '太棒了！你是识字冠军！🏆');
    else if (pct >= 70) msg = State.config('encourageMessages.good', '很厉害！继续加油！💪');
    else if (pct >= 40) msg = State.config('encourageMessages.ok', '不错哦，再练习一下吧！📖');
    else msg = State.config('encourageMessages.low', '别灰心，多看看生字卡片再来挑战！🌟');
    document.getElementById('endMsg').textContent = msg;
  }

  function showQuizActive() {
    document.getElementById('quizActive').classList.remove('hidden');
    document.getElementById('quizEnd').classList.add('hidden');
  }

  return { renderQuestion, showFeedback, updateStreak, showEndScreen, showQuizActive };
})();

/** Modal UI — generic modal for displaying lists and content */
const ModalUI = (() => {
  /** Show a modal with given title and HTML content */
  /**
   * Show the modal.
   *
   * @param {string} title
   * @param {string} html
   * @param {Object} [opts]
   * @param {boolean} [opts.wide] - widest box, for reading-heavy panels. The
   *   default 380px suits character lists; prose at that width wraps every
   *   few words and becomes a ribbon.
   * @param {boolean} [opts.report] - middle width, for the 学习报告: a short
   *   list of labelled numbers, which needs room for label and value on one
   *   line but not the full reading width.
   * @param {boolean} [opts.cc] - 自定义字卡 layout: fixed-height flex column
   *   with its own independently-scrolling list, so 复习卡片/搜索 (top) and
   *   the add form (bottom) stay reachable without scrolling past however
   *   many cards are in between.
   */
  function show(title, html, opts) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalContent').innerHTML = html;
    const box = document.getElementById('modalBox');
    if (box) {
      box.classList.toggle('modal--wide', !!(opts && opts.wide));
      box.classList.toggle('modal--report', !!(opts && opts.report));
      box.classList.toggle('modal--cc', !!(opts && opts.cc));
    }
    document.getElementById('modalOverlay').classList.add('show');
  }

  function close() {
    document.getElementById('modalOverlay').classList.remove('show');
  }

  function renderFavorites(favorites) {
    if (!favorites.length) return '<p style="color:#999">还没有收藏生字</p>';
    let html = favorites.map(f =>
      `<div class="modal-item"><span class="char-display" style="font-size:24px">${escapeHtml(f)}</span><button data-action="remove-fav" data-char="${escapeHtml(f)}">✕</button></div>`
    ).join('');
    html += `<div style="display:flex;gap:8px;margin-top:16px;justify-content:center">
      <button data-action="review-cards" class="btn-modal-action btn-modal-action--primary">📚 复习卡片</button>
      <button data-action="review-quiz" class="btn-modal-action btn-modal-action--warning">🎮 生字挑战</button>
    </div>`;
    return html;
  }

  function renderErrorBook(entries) {
    if (!entries.length) return '<p style="color:#999">没有错题，太厉害了！</p>';
    return entries.map(e =>
      `<div class="modal-item"><span class="char-display" style="font-size:24px">${escapeHtml(e.char)}</span><span>${escapeHtml(e.pinyin)} (错${e.wrongCount}次)</span></div>`
    ).join('');
  }

  // Badge theme colors (unlocked state)
  const BADGE_COLORS = {
    'challenge_master': '#4f46e5',
    'perfect_record': '#059669',
    'literacy_master': '#2563eb',
    'streak_record': '#ea580c',
    'error_killer': '#7c3aed'
  };

  function renderBadges(allBadges, stats) {
    let html = allBadges.map(b => {
      const earned = BadgeService.isEarned(b.id);
      const color = earned ? (BADGE_COLORS[b.id] || '#1e293b') : '#999';
      return `<div class="modal-item" style="opacity:${earned ? 1 : .4}">
        <span style="font-size:28px">${b.emoji}</span>
        <span style="color:${earned ? '#1e293b' : '#999'}"><strong style="color:${color}">${b.name}</strong><br><small style="color:${earned ? color : '#bbb'}">${b.desc}</small></span>
        ${earned ? '<span>✅</span>' : '<span>🔒</span>'}
      </div>`;
    }).join('');
    html += `<hr style="margin:16px 0"><p style="font-size:13px;color:#999">累计: ${stats.totalRounds}轮 | ${stats.totalCorrect}/${stats.totalAnswered}题 | 连续${stats.consecutiveDays}天</p>`;
    html += `<p style="font-size:10px;color:#ccc;margin-top:8px" id="versionTag">v1.0</p>`;
    return html;
  }

  /**
   * 学习报告 — read-only summary for a parent (and useful to the child).
   *
   * No action buttons by design: this panel answers "how is it going", and
   * anything editable here would be editable by the child too.
   *
   * @param {Object} r - ReportService.build() output
   * @returns {string} HTML
   */
  function renderReport(r) {
    const GRADE = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

    // Nothing learned yet — say so plainly instead of showing a wall of zeros
    if (!r.totalSeen) {
      return '<p style="color:#999">还没有学习记录。做一次每日任务或挑战，这里就会有数据。</p>';
    }

    const row = (label, value) =>
      `<div class="modal-item"><span>${label}</span><span><strong>${value}</strong></span></div>`;

    let html = '';

    // Where they are in the textbook
    if (r.position) {
      const g = GRADE[r.position.grade] || r.position.grade;
      const sem = r.position.semester === 1 ? '上册' : '下册';
      html += row('📍 当前进度', `${g}年级${sem} 第 ${r.position.lessonIndex + 1} 课`);
      html += row('✅ 学完的课', `${r.position.completedCount} 课`);
    }

    // 已掌握 + 在学 + 需加强 is exactly 学过的字 — they were four separate rows
    // with nothing saying three of them summed to the fourth, which read as
    // four unrelated numbers. One total, then its breakdown, with the dividing
    // line (review interval) stated so the buckets are not arbitrary.
    const m = r.mastery;
    // Describe how well the character is known, not when the scheduler will ask
    // again. The interval is machine behaviour — a reader has to work backwards
    // from "longer gap" to "knows it better" before it means anything.
    //
    // The hint belongs with the label, not with the value: .modal-item uses
    // space-between, so a hint inside the value span pushes the number left by
    // the hint's own width and the column of numbers stops lining up.
    const lab = (name, note) =>
      `${name}<small class="rep-note">${note}</small>`;
    html += row(lab('📚 学过的字', '下面是这些字的分布'), `${r.totalSeen} 字`);
    html += row(lab('　⭐ 已掌握', '隔很久再问也还记得'), `${m.mastered} 字`);
    html += row(lab('　📘 在学', '记住了，但还得再确认几次'), `${m.learning} 字`);
    html += row(lab('　🔴 需加强', '还没记住，马上要再问'), `${m.needsWork} 字`);
    html += row('📅 今天要复习', `${r.dueToday} 字`);

    html += row('🔥 连续天数', `${r.streak.current} 天（最高 ${r.streak.best}）`);
    const acc = r.totals.accuracy === null ? '—' : `${r.totals.accuracy}%`;
    html += row('🎯 累计正确率', `${acc}（${r.totals.correct}/${r.totals.answered}）`);
    html += row('🎮 完成轮数', `${r.totals.rounds} 轮`);

    // The last seven days go after the number rows, not between them: the dot
    // grid is the only non-tabular element here, and sitting mid-list it broke
    // the run of 今天要复习 / 连续天数 / 正确率 / 轮数 in two.
    //
    // Oldest first — a rolling window, not a calendar week. That is why the
    // weekday labels can start mid-week (today is the last cell, not the last
    // column of a Mon-Sun grid). The day-of-month and the marked today cell
    // make the window self-evident instead of looking shuffled.
    const dots = r.week.days.map((d, i) => {
      // d.date is now a local-calendar-day string ("YYYY-MM-DD") from
      // ReportService.getWeekActivity(). Parse the Y/M/D fields directly
      // rather than `new Date(d.date)`, which the spec treats as UTC
      // midnight and would reintroduce a UTC/local mismatch when read
      // back with .getDate()/.getDay().
      const [y, m, dayNum] = d.date.split('-').map(Number);
      const dt = new Date(y, m - 1, dayNum);
      const wd = WEEKDAY[dt.getDay()];
      const dom = dt.getDate();
      const isToday = i === r.week.days.length - 1;
      const mark = d.active ? '🟢' : '⚪';
      return `<span class="rep-day${isToday ? ' rep-day--today' : ''}" title="${escapeHtml(d.date)}">
        <span class="rep-day-mark">${mark}</span>
        <small class="rep-day-wd">${wd}</small>
        <small class="rep-day-dom">${dom}</small></span>`;
    }).join('');
    html += `<div class="modal-item"><span>🗓 最近七天</span><span>${r.week.activeCount}/7 天</span></div>`;
    html += `<div class="rep-week">${dots}</div>
      <p class="rep-week-note">左边最早，右边是今天</p>`;

    // Characters that are not sticking — the actionable part
    html += '<hr style="margin:16px 0">';
    if (r.stuck.length) {
      html += `<p style="font-size:13px;color:#991b1b;margin:0 0 8px">
        🔴 这些字反复出错，建议一起看看（错 ${r.stuck[0].wrongCount} 次起）</p>`;
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px">' + r.stuck.map(c =>
        `<span style="border:1px solid #fecaca;border-radius:6px;padding:4px 8px;background:#fef2f2">
          <span class="char-display" style="font-size:20px">${escapeHtml(c.char)}</span>
          <small style="color:#991b1b">${escapeHtml(c.pinyin || '')} 错${c.wrongCount}次</small></span>`
      ).join('') + '</div>';
    } else if (r.errorBookCount) {
      html += `<p style="font-size:13px;color:#666;margin:0">
        错题本里有 ${r.errorBookCount} 个字，但都还没到反复出错的程度。</p>`;
    } else {
      html += '<p style="font-size:13px;color:#059669;margin:0">错题本是空的 👍</p>';
    }

    html += `<p style="font-size:11px;color:#bbb;margin-top:16px">
      报告日期 ${escapeHtml(r.date)}　·　「最近七天」从启用本功能当天开始记录</p>`;
    return html;
  }

  /**
   * 自定义字卡 — fixed header (count + 复习卡片 + search) and fixed footer
   * (add form) around an independently-scrolling card list.
   *
   * This replaced two earlier, each incomplete fixes: first 复习卡片 sat
   * below the whole list (scroll past 100+ cards just to review); moving it
   * above the list fixed that but pushed the add form itself below the list
   * instead — same problem, different button. Scrolling the list on its own
   * inside a bounded box, with the header and footer outside that scroll
   * area, is what actually keeps every frequently-used control reachable
   * regardless of list length — put 复习卡片 and the add button on their own
   * and the next-longest list just creates the same complaint about
   * whichever one is not pinned.
   *
   * 复习卡片 and the search box share one row (both are "find/get to what I
   * already have" actions) rather than search getting a sticky row of its
   * own, which previously overclaimed otherwise-usable list height.
   *
   * 反面's textarea is 1 row, not 2: the fixed footer was taking roughly
   * half the modal's height on its own, which is exactly what you do not
   * want while scanning search results — less list is visible per pixel of
   * modal. Still resizable by drag for anyone typing a longer sentence.
   *
   * Three inputs in the form, not two: 拼音 is separate because the quiz reads
   * that field directly. Without it a card can only be flipped, never quizzed.
   *
   * Built for entering several cards in one sitting (the Anki model): the form
   * stays put, clears after each add and returns focus to 正面, so adding ten
   * cards is type-tab-type-Enter ten times. Quizlet's full-page editor solves
   * the same problem but exists for long shared sets, which this is not.
   *
   * @param {Array} cards - CustomCardService.getAll()
   * @returns {string} HTML
   */
  function renderCustomCards(cards) {
    const formHtml = `<div class="cc-footer">
      <label for="ccFront" style="display:block;font-size:13px;color:#475569;margin-bottom:4px">正面（字或词，最多 8 个字）</label>
      <input id="ccFront" type="text" maxlength="8" placeholder="例：秦" autocomplete="off"
        style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px;box-sizing:border-box">

      <label for="ccPinyin" style="display:block;font-size:13px;color:#475569;margin:10px 0 4px">拼音（可不填；填了才能用于挑战）</label>
      <input id="ccPinyin" type="text" maxlength="60" placeholder="例：qín" autocomplete="off"
        style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:16px;box-sizing:border-box">

      <label for="ccBack" style="display:block;font-size:13px;color:#475569;margin:10px 0 4px">反面（意思、例句、翻译…）—— 按 Enter 直接加入</label>
      <textarea id="ccBack" maxlength="200" rows="1" placeholder="例：秦始皇统一了中国。"
        style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:15px;box-sizing:border-box;resize:vertical"></textarea>

      <div id="ccMsg" class="form-msg"></div>
      <button data-action="cc-add" class="btn-modal-action btn-modal-action--primary"
        style="width:100%">➕ 加入（可连续添加）</button>
    </div>`;

    if (!cards.length) {
      return '<p style="color:#999">还没有自定义字卡。下面填好正反面就能加。</p>' + formHtml;
    }

    // Search shares the header row with 复习卡片 rather than claiming a row
    // of its own — both are "get to a card I already have" actions.
    // Always shown once there is at least one card: a per-count threshold
    // (previously >8) meant the control appeared and disappeared as the
    // collection grew, which is more surprising than just always having it.
    const searchHtml = `<input id="ccSearch" type="text" placeholder="🔍 搜索…" autocomplete="off"
          style="flex:1;min-width:0;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box">`;
    let html = `<div class="cc-header">
      <span style="font-size:13px;color:#64748b;flex-shrink:0">共 ${cards.length} 张</span>
      <button data-action="cc-review" class="btn-modal-action btn-modal-action--primary" style="flex:1">📚 复习卡片</button>
      ${searchHtml}
    </div>`;
    html += `<div id="ccListWrap" class="cc-list-wrap">
      <div id="ccList">${renderCustomCardList(cards)}</div>
      <p id="ccNoMatch" class="hidden" style="color:#999;text-align:center;padding:12px 0">没有匹配的卡片</p>
    </div>`;
    return html + formHtml;
  }

  /**
   * The card list on its own, so a new card can be prepended in place instead
   * of re-rendering the whole modal (which would clear the form).
   *
   * 🔊 uses the TTS the app already has. phase-6 charges for automatic audio on
   * self-made vocabulary; here it costs nothing and makes a hand-made card feel
   * as finished as a textbook one.
   *
   * @param {Array} cards
   * @returns {string} HTML
   */
  function renderCustomCardList(cards) {
    return cards.map(c => `<div class="modal-item" data-cc-item="${escapeHtml(c.front)}">
      <span>
        <span class="char-display" style="font-size:20px">${escapeHtml(c.front)}</span>
        ${c.pinyin ? `<small style="color:#64748b;margin-left:6px">${escapeHtml(c.pinyin)}</small>` : ''}
        <br><small style="color:#94a3b8">${escapeHtml(c.back)}</small>
      </span>
      <span style="display:flex;gap:4px;flex-shrink:0">
        <button data-action="cc-speak" data-front="${escapeHtml(c.front)}" aria-label="朗读" title="朗读">🔊</button>
        <button data-action="cc-remove" data-front="${escapeHtml(c.front)}" aria-label="删除" title="删除">✕</button>
      </span>
    </div>`).join('');
  }

  /**
   * Filter the already-rendered card list by 正面, in place.
   * Called on every keystroke in #ccSearch — cheap even for a few hundred
   * .modal-item rows, so no debouncing.
   * @param {string} query
   */
  function filterCustomCardList(query) {
    const list = document.getElementById('ccList');
    const noMatch = document.getElementById('ccNoMatch');
    if (!list) return;
    const q = query.trim();
    let visibleCount = 0;
    list.querySelectorAll('[data-cc-item]').forEach(item => {
      const match = !q || item.dataset.ccItem.includes(q);
      item.classList.toggle('hidden', !match);
      if (match) visibleCount++;
    });
    if (noMatch) noMatch.classList.toggle('hidden', visibleCount > 0);
  }

  /**
   * 使用说明 — what each entry point is for, and when to use it.
   *
   * Deliberately not a feature list: an icon plus "查看学习进度" tells a child
   * nothing they could not guess. What is NOT guessable is why each thing
   * exists, and which mechanisms decide things for you. The error book in
   * particular empties by answering correctly, not by deleting — the single
   * most confusable rule in the app.
   *
   * Written for the child, with a short 给家长 section at the end: box levels
   * and intervals are noise to a 10-year-old but are the point of 学习报告.
   *
   * Numbers here are the real configured values (config.json, BOX_INTERVALS).
   * If those change, this text goes stale — a test checks the key ones.
   *
   * @returns {string} HTML
   */
  function renderHelp() {
    const perRound = State.config('questionsPerRound', 10);
    const toRemove = State.config('wrongAnswersToRemoveFromErrorBook', 2);
    const schedule = (typeof SpacedRepService !== 'undefined')
      ? SpacedRepService.getBoxIntervals().join('→') : '';

    const row = (k, v, cls) =>
      `<div class="help-row${cls ? ' ' + cls : ''}"><div class="help-row-k">${k}</div><div class="help-row-v">${v}</div></div>`;
    /** One section: a titled band over its own bordered box. */
    const block = (title, subtitle, body) =>
      `<div class="help-block">
        <div class="help-sec"><span class="help-sec-t">${title}</span><span class="help-sec-s">${subtitle}</span></div>
        <div class="help-body">${body}</div>
      </div>`;

    const STEPS = [
      ['①', '复习', '该复习的字'],
      ['②', '回顾上课', '上一课的字'],
      ['③', '学习新字', '今天的新字'],
      ['④', '闯关测验', '检查记住了没'],
      ['⑤', '完成', '连续天数 +1']
    ];
    const steps = `<div class="help-steps">${STEPS.map(([n, t, d]) => `<div class="help-step">
      <div class="help-step-n">${n}</div><div class="help-step-t">${t}</div><div>${d}</div></div>`).join('')}</div>
      <p class="help-row-v" style="margin:6px 0 0">漏一天不要紧，第二天补上照样连着算；隔两天才从头数。</p>`;

    return `
    <p class="help-lead">每天打开先做 <strong>📖 任务</strong> —— 该学哪些新字、该复习哪些旧字，
    它都替你排好了，照着做完就算一天，连续天数会自己往上加。
    下面这些地方都不是必须的：等任务做完了，还想多练一会儿，再按自己的想法挑 ——
    想把某一课再翻一遍、想专门补那几个总记不住的字、想加几个课本里没有的词，都在下面。</p>

    <div class="help-cols">
    ${block('📖 任务', '每天的主线，五步做完', steps)}

    ${block('📚 学习 和 🎮 挑战', '想多练的时候自己挑：一个看答案，一个考你',
      row('📚 学习', '翻卡片。正面是字，点一下翻到背面看拼音、组词、例句；点字会朗读。选了哪一课，就只看那一课的字。') +
      row('🎮 挑战', `做题，每轮 ${perRound} 道。四种题型：字→音、音→字、字→词、填空，也能混着来。答错的字自动进错题本。`))}

    ${block('🎯 复习区', '四批字，来路不同 —— 两批自动挑，两批你自己挑',
      row('📈 智能复习', '<strong>自动算出来的</strong> —— 哪个字该复习了，它说了算。刚学会的隔一天再问，记牢了拉长到一周、两周、一个月。每天内容都不一样，照着练就行。') +
      row('❤️ 练生字', '你自己收藏的字。看卡片时点卡片上的 ❤️ 收进来，再点一下取消。') +
      row('📖 练错题', `答错过的字。<strong>连续答对 ${toRemove} 次才自动移出去</strong> —— 不能手动删。这正是它的用处：错过的字得真学会才算过关。`) +
      row('✏️ 自定义', '课本没有、但你想记的词 —— 故事里看到的、中文课上的、人名都行。填好正面反面就能加，一张接一张按 Enter。<strong>拼音填了才能用在挑战里</strong>（不填也能当卡片翻）。卡片上的 🗑 要点两次才删，因为只有这一份。'))}

    ${block('本子和设置', '看看自己已经学了多少 —— 攒徽章、换用户都在这',
      row('❤️ 生字本<br>📖 错题本', '看这两批字都有哪些、取消收藏。想拿来练，就点复习区里的 练生字 / 练错题。') +
      row('🏆 成就墙', '学到的字越多，徽章越多 —— 识字量 50、100、200、500、1000、2000 各有一个，还有连续天数和满分的徽章。累计数据也在这里。') +
      row('👧 切换用户', '当前设备上几个人分开用，进度、收藏、错题互不影响。'))}

    ${block('给家长', '📊 学习报告 是给你看的',
      row('已掌握 / 在学<br>需加强', '按<strong>掌握程度</strong>分的三档 —— 答对过几次、隔多久还记得，不是正确率。三档加起来就是学过的字总数。') +
      row('最近七天', '哪天做了任务 —— <strong>最右边是今天，往左数六天</strong>，所以星期标签可能从周中开始，不是周一到周日的日历。从加这个功能那天开始记，之前没有数据。') +
      row('这些字反复出错', '真正值得一起看的字：既没升上去、又错过三次以上。只看「刚学的字」会把今天刚学会的也算进来，所以要两个条件。') +
      row('复习间隔', `${schedule} 天。答对往上走一级，答错只退一级（不是回到头）—— 偶尔手滑不会毁掉进度，真没记住的字会一直回来。`))}

    ${block('数据存在哪', '现在只存在当前设备上',
      row('存在本机', '进度、收藏、错题、徽章、自定义卡片全都存在浏览器里（localStorage），<strong>不会上传</strong>。所以没网也能用，也没人能看到你的数据。') +
      row('换设备不会跟过去', '换手机、换电脑、清掉浏览器数据，记录就没了 —— 这是现在的做法带来的代价。换用户只是在当前设备上分开记，不是云账号。') +
      row('以后想做什么', '打算加一个后台存储：这样记录能跨设备跟着走，还能让几个小朋友看到彼此的进度、互相鼓劲。还在计划中，请再等等。')
    )}

    ${block('版权', '欢迎使用，尊重版权',
      row('✅ 可以', '在线用、下载到自己电脑上用、打印、在课堂上用、分享网址 —— 都欢迎，不用告诉我。', 'help-row--ok') +
      row('🚫 请不要', '复制到别的网站、App、公众号重新发布（<strong>请改为放链接</strong>）；收费出售或放进付费产品；去掉出处当成自己写的。', 'help-row--no') +
      row('教材部分', '生字、拼音、组词、例句、课文标题都来自人教版语文教材，<strong>这部分版权归教材编者及出版社所有</strong>，本项目只是按课整理成练习数据。') +
      row('本项目的部分', '代码、界面文字 —— <strong>版权归本项目作者所有，保留所有权利</strong>。')
    )}
    </div>

    <p class="help-foot">手机上可以「添加到主屏幕」，之后没网也能用。</p>`;
  }

  /**
   * Render the backup/transfer screen: export current profile's data as a
   * downloadable JSON file, or import a previously exported file to restore
   * it (overwriting current data after an explicit confirm in the controller).
   * @param {string} profileName - current profile's display name, for the filename hint
   */
  function renderDataTransfer(profileName) {
    return `
    <p class="help-lead">换设备、清了浏览器数据，或者想先存一份备份 —— 导出一个文件，
    到另一台设备上导入回来就行。不需要网络，也不会上传到任何地方。</p>

    <div class="help-block">
      <div class="help-sec"><span class="help-sec-t">⬇️ 导出</span><span class="help-sec-s">存一份当前进度到文件</span></div>
      <div class="help-body">
        <p class="help-row-v" style="margin:0 0 10px">把「<strong>${escapeHtml(profileName || '')}</strong>」的生字本、错题本、
        复习进度、徽章、自定义卡片打包成一个文件，下载到你的设备上。</p>
        <button id="xferExportBtn" class="xfer-btn xfer-btn-primary">⬇️ 导出数据</button>
      </div>
    </div>

    <div class="help-block">
      <div class="help-sec"><span class="help-sec-t">⬆️ 导入</span><span class="help-sec-s">用备份文件覆盖当前进度</span></div>
      <div class="help-body">
        <p class="help-row-v" style="margin:0 0 10px"><strong>⚠️ 会覆盖「${escapeHtml(profileName || '')}」当前的数据</strong>，
        导入前最好先导出一份当前的作为备份。</p>
        <input type="file" id="xferImportFile" accept="application/json" style="display:none">
        <button id="xferImportBtn" class="xfer-btn">⬆️ 选择备份文件导入</button>
        <p id="xferImportMsg" class="help-row-v" style="margin:10px 0 0"></p>
      </div>
    </div>`;
  }

  return { show, close, renderFavorites, renderErrorBook, renderBadges, renderReport, renderCustomCards, renderCustomCardList, filterCustomCardList, renderHelp, renderDataTransfer };
})();

/** Badge Popup UI — celebration overlay when earning a new badge */
const BadgePopupUI = (() => {
  /** Show a badge unlock popup (auto-dismisses after 3s) */
  function show(badge) {
    const div = document.createElement('div');
    div.className = 'badge-popup';
    div.innerHTML = `<div class="emoji">${badge.emoji}</div><h3>🎉 获得新徽章！</h3><p>${badge.name} — ${badge.desc}</p>`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }
  return { show };
})();
