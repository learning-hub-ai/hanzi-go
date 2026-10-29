/**
 * 礼物故事 — the daily task's completion page gives a story as a present
 * (design §3.1.10). Only on a device with an invite code; a child without
 * one sees the completion page exactly as before.
 *
 *   task page:  🎁 完成任务，飞飞和小天有礼物给你   (small, under the steps)
 *               🎁 还有 2 步，礼物就到啦 / 🎁 最后一步！礼物在等你
 *   done page:  礼物来啦！ 飞飞和小天给你带来了一个惊喜        [拆开看看]
 *        → the box opens: the cover, the title                  [开始读 →]
 *        → the story in 学习; its finish page offers 「回到今天的任务」
 *        → back here: 🎁 你的礼物：《标题》 [开始读]  (opened, not read)
 *                     📚 放进书架啦 ·《标题》 [再读一遍]  (read)
 *
 * Which story: StoryService.rewardFor(today's lesson), decided as soon as the
 * task page shows it and kept in the day's task state (state.gift): what the
 * teaser promised is what the done page gives, even if the child reads that
 * story in 学习 meanwhile. Grades 1–2 only, because only they have stories.
 *
 * Nothing here changes the streak, growth points or the task's steps: the
 * gift is extra, never another step (design §3.1.1).
 */
const StoryGift = (() => {
  // The present is made for young readers (design §3.1.12): older grades
  // need something else, so it stays off there even if stories appear.
  const GIFT_GRADES = [1, 2];
  const SLOT_ID = 'dtGiftSlot';
  const TEASER_ID = 'dtGiftTeaser';
  const GIFT_KEY = 'dailyTask';   // the day's task state, owned by DailyTaskService

  /**
   * The story promised for this day's task, or null; decided once and kept.
   * @param {Object} state - the day's task state
   * @param {string} [lessonId] - the lesson of the task (default state.lessonId,
   *   which completeQuiz records; the task page passes the current lesson)
   */
  function _giftFor(state, lessonId) {
    const lesson = lessonId || (state && state.lessonId);
    if (!state || !lesson || StoryService.status() !== '') return null;
    if (!GIFT_GRADES.includes(parseInt(String(lesson).split('-')[0], 10))) return null;
    if (state.gift && StoryService.forLesson(state.gift)) return StoryService.forLesson(state.gift);
    const st = StoryService.rewardFor(lesson);
    if (!st) return null;
    _remember(state, { gift: st.lesson, giftOpened: false });
    return st;
  }

  /**
   * Store gift fields in the day's task state. Written onto a fresh read of
   * the saved state, not the caller's copy: the task page's copy is older
   * than the steps saved since, and must not undo them.
   */
  function _remember(state, fields) {
    Object.assign(state, fields);
    const saved = State.load(GIFT_KEY, null);
    if (saved && saved.date === state.date) State.save(GIFT_KEY, Object.assign(saved, fields));
    else State.save(GIFT_KEY, state);
  }

  /** 「飞飞和小天」 from the cast (at most two names) and their icons. */
  function _givers(story) {
    const names = (story.cast || []).filter(n => StoryService.character(n)).slice(0, 2);
    const icons = names.map(n => {
      const c = StoryService.character(n);
      return c.icon
        ? `<img class="gift-icon" src="${escapeHtml(c.icon)}" width="40" height="40" alt="" data-fallback="${escapeHtml(c.emoji || '')}">`
        : `<span class="gift-icon gift-icon--emoji" aria-hidden="true">${escapeHtml(c.emoji || '')}</span>`;
    }).join('');
    return { text: names.join('和') || '小故事里的朋友', icons };
  }

  function _closedHtml(story) {
    const g = _givers(story);
    return `
      <div class="gift gift--closed" role="group" aria-label="礼物">
        <div class="gift-box" aria-hidden="true">🎁</div>
        <div class="gift-title">礼物来啦！</div>
        <div class="gift-from">${g.icons ? `<span class="gift-icons">${g.icons}</span>` : ''}${escapeHtml(g.text)}给你带来了一个惊喜</div>
        <button type="button" class="gift-btn" data-gift="unwrap">拆开看看</button>
      </div>`;
  }

  function _coverHtml(story) {
    const g = _givers(story);
    return `
      <div class="gift gift--open" role="group" aria-label="礼物：一个小故事">
        <div class="gift-label">一个小故事</div>
        <div class="gift-cover-title char-display">${escapeHtml(story.title)}</div>
        ${g.icons ? `<div class="gift-icons gift-icons--cover">${g.icons}</div>` : ''}
        <button type="button" class="gift-btn" data-gift="read">开始读 →</button>
      </div>`;
  }

  /** Opened: 「你的礼物」 until it is read to the end, then 「放进书架啦」. */
  function _openedHtml(story) {
    const read = StoryService.isRead(story.lesson);
    const text = read
      ? `📚 放进书架啦 ·《${escapeHtml(story.title)}》`
      : `🎁 你的礼物：《${escapeHtml(story.title)}》`;
    return `
      <div class="gift gift--done${read ? ' gift--read' : ''}" role="group" aria-label="礼物">
        <span class="gift-done-text">${text}</span>
        <button type="button" class="gift-btn gift-btn--small" data-gift="read">${read ? '再读一遍' : '开始读'}</button>
      </div>`;
  }

  /** The task page's line: steps left 0–4. */
  function _teaserHtml(story, left) {
    const g = _givers(story);
    // 「礼物」 is marked in every line (the word a child looks for, matching the
    // 🎁), and so is what to do to get it: 完成 / 2 步 / 最后一步 (design §3.1.11).
    const gift = '<em class="gift-teaser-word">礼物</em>';
    const text = left <= 1 ? `<strong class="gift-teaser-left">最后一步！</strong>${gift}在等你`
      : left === 2 ? `还有 <strong class="gift-teaser-left">2 步</strong>，${gift}就到啦`
      : `<strong class="gift-teaser-left">完成</strong>任务，${escapeHtml(g.text)}有${gift}给你`;
    return `<span class="gift-teaser-box" aria-hidden="true">🎁</span>
      ${g.icons ? `<span class="gift-teaser-icons" aria-hidden="true">${g.icons}</span>` : ''}
      <span class="gift-teaser-text">${text}</span>`;
  }

  /**
   * The small promise under the task's steps. Empty (hidden) when there is
   * nothing to promise: no code, grade 3+, no unread story up to this lesson.
   * @param {Object} state - the day's task state
   * @param {string} lessonId - the lesson of today's task
   * @param {number} left - steps not done yet (1–4)
   */
  function renderTeaser(state, lessonId, left) {
    const draw = () => {
      const slot = document.getElementById(TEASER_ID);
      if (!slot) return;
      const story = _giftFor(state, lessonId);
      _fill(slot, story ? _teaserHtml(story, left) : '');
      slot.classList.toggle('hidden', !story);
    };
    draw();
    if (typeof StoryService !== 'undefined') StoryService.load().then(draw);
  }

  /**
   * Fill the completion page's slot (rendered empty by DailyTaskController).
   * Safe to call before the stories are unlocked: StoryService.load() fills
   * it in once they are (unlocking takes about half a second).
   * @param {Object} state - the day's task state
   * @param {Function} onBack - re-render the completion page
   */
  function render(state, onBack) {
    const slot = document.getElementById(SLOT_ID);
    if (!slot) return;
    const draw = () => {
      const now = document.getElementById(SLOT_ID);
      if (!now) return;
      const story = _giftFor(state);
      _fill(now, story ? (state.giftOpened ? _openedHtml(story) : _closedHtml(story)) : '');
      now.classList.toggle('hidden', !story);
      if (!story) return;
      now.onclick = (e) => {
        const btn = e.target.closest('[data-gift]');
        if (!btn) return;
        if (btn.dataset.gift === 'unwrap') _unwrap(now, story, state);
        else if (btn.dataset.gift === 'read') StoryView.open(story.lesson, { onBack });
      };
    };
    draw();
    // Unlocking takes about half a second: draw again once it is done, unless
    // the present is already on screen (a tap on 拆开看看 must not be undone).
    if (typeof StoryService !== 'undefined') {
      StoryService.load().then(() => {
        const now = document.getElementById(SLOT_ID);
        if (now && !now.querySelector('.gift')) draw();
      });
    }
  }

  /**
   * Put gift HTML into an element. Every state shows the characters' pictures,
   * and a picture that cannot load becomes its emoji, as on the cast page.
   */
  function _fill(el, html) {
    el.innerHTML = html;
    el.querySelectorAll('img.gift-icon').forEach(img => img.addEventListener('error', () => {
      img.replaceWith(document.createTextNode(img.dataset.fallback || ''));
    }, { once: true }));
  }

  /** Open the box: a short shake and lid, then the cover. Instant with reduced motion. */
  function _unwrap(slot, story, state) {
    _remember(state, { giftOpened: true });
    const box = slot.querySelector('.gift');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const show = () => {
      _fill(slot, _coverHtml(story));
      const btn = slot.querySelector('[data-gift="read"]');
      if (btn) btn.focus();
    };
    if (reduce || !box) { show(); return; }
    box.classList.add('gift--unwrapping');
    setTimeout(show, 700);
  }

  return { render, renderTeaser, SLOT_ID, TEASER_ID, GIFT_GRADES };
})();
