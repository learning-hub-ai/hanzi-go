/**
 * 小故事阅读 — one short original story per lesson, grades 1–2.
 *
 * Design: docs/story-reading-design.html. The story text is private: the site
 * ships data/stories.enc.json, opened with a child's invite code by
 * StoryUnlock (js/story-unlock.js, design §7.5); the plain files live in the
 * private repo and are checked by scripts/check_stories.py.
 *
 * - StoryService: loads the stories and answers "what does this character
 *   read as here" and "where does it go in 生字本".
 * - StoryView: the story as a second way of looking at a lesson inside 学习,
 *   next to the flashcards. It reuses the learn screen's own pieces — the
 *   lesson dropdown, a card-shaped page, the card's 拼音 pill, the
 *   prev/next buttons and progress bar, the phone's bottom bar and swipe —
 *   so the child stays in the same app rather than landing on a new screen.
 *   (The first prototype was a full-screen overlay that hid the header and
 *   sidebar; it read as a different website.)
 */

const StoryService = (() => {
  let _encFile = 'data/stories.enc.json';   // tests point this at test/fixtures/
  const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  let _byLesson = {};
  let _characters = {};     // name -> { emoji, text, readings }
  let _charAllow = [];      // allow list for the intros (天鹅's 鹅)
  let _ready = null;
  // Why there are no stories: 'none' (no code), 'unsupported' (no WebCrypto:
  // http:// on the LAN or file://), 'bad' (the saved code no longer opens the
  // file; it has been forgotten), 'missing' (no file), or '' (stories loaded).
  let _status = '';
  let _loads = 0;     // load tickets (see load)

  /**
   * Install decrypted content: { characters: <characters.json>, volumes: [...] }.
   * Stories nobody has reviewed are dropped here as well (the build already
   * leaves them out), so the rest of the app never sees them (design §10).
   * @returns {number} how many stories are available
   */
  function _install(content) {
    const chars = (content && content.characters) || {};
    _characters = chars.characters || {};
    _charAllow = chars.allow || [];
    const byLesson = {};
    for (const v of (content && content.volumes) || []) {
      for (const st of (v && v.stories) || []) {
        if (st && st.lesson && st.reviewed && st.reviewed.by) byLesson[st.lesson] = st;
      }
    }
    _byLesson = byLesson;
    return Object.keys(byLesson).length;
  }

  /**
   * Load the stories once per page (or after reload()): fetch the encrypted
   * file and open it with this device's invite code. Never rejects; without
   * a usable code there are simply no stories, and status() says why.
   * @param {string} [code] - try this code instead of the saved one (and save it if it works)
   * @returns {Promise<number>} how many stories are available
   */
  function load(code) {
    if (_ready && !code) return _ready;
    // Each load gets a ticket; a slower, older one must not overwrite what a
    // newer one installed (e.g. a code typed while the start-up load runs).
    const ticket = ++_loads;
    const install = (content, status) => {
      if (ticket !== _loads) return Object.keys(_byLesson).length;
      _status = status;
      return _install(content);
    };
    _ready = (async () => {
      const c = code || StoryUnlock.code();
      if (!c) return install(null, 'none');
      if (!StoryUnlock.supported()) return install(null, 'unsupported');
      let enc;
      try {
        const r = await fetch(_encFile);
        enc = r.ok ? await r.json() : null;
      } catch (_e) { enc = null; }
      if (!enc) return install(null, 'missing');
      let content;
      try {
        content = await StoryUnlock.open(enc, c);
      } catch (e) {
        if (!(e instanceof StoryUnlock.BadCode)) throw e;
        if (!code && ticket === _loads) StoryUnlock.clear();   // a saved code that stopped working (revoked)
        return install(null, 'bad');
      }
      if (code && ticket === _loads) StoryUnlock.save(code);
      return install(content, '');
    })();
    return _ready;
  }

  /** Forget what was loaded and load again (after a code was entered or cleared). */
  function reload(code) {
    _ready = null;
    return load(code);
  }

  /** @returns {string} '' when stories are loaded, else why not (see _status) */
  function status() { return _status; }

  /** @returns {Object|null} the reviewed story for a lesson id, e.g. '1-2-26' */
  function forLesson(lessonId) { return _byLesson[lessonId] || null; }

  /** @returns {boolean} */
  function isHan(ch) { return HAN.test(ch); }

  /** The first textbook card for a character — what 生字本 and 练生字 use. */
  function _card(char) {
    const all = State.get('allChars') || [];
    return all.find(c => c.char === char) || null;
  }

  /**
   * Reading of the n-th Chinese character (1-based) of a page (1-based).
   * Same order as scripts/check_stories.py: the story's `readings`, then its
   * `allow` entry, then the character's first card.
   * @returns {string|null}
   */
  /** The intro shown for a character on the cast page, or null. */
  function character(name) { return _characters[name] || null; }

  /**
   * Reading of the n-th character of a character's intro: its own
   * readings, then the intro file's allow list, then the card.
   */
  function introReadingAt(name, n, char) {
    const intro = _characters[name];
    const r = intro && intro.readings && intro.readings[`p1:${n}`];
    if (r) return r;
    const allowed = _charAllow.find(a => a.char === char);
    if (allowed) return allowed.pinyin;
    const card = _card(char);
    return card ? card.pinyin : null;
  }

  function readingAt(story, page, n, char) {
    const r = story.readings && story.readings[`p${page}:${n}`];
    if (r) return r;
    const allowed = (story.allow || []).find(a => a.char === char);
    if (allowed) return allowed.pinyin;
    const card = _card(char);
    return card ? card.pinyin : null;
  }

  /** The lesson's own 生字, for highlighting. */
  function newChars(lessonId) {
    const lesson = (State.get('lessons') || []).find(l => l.id === lessonId);
    return new Set(lesson ? lesson.chars.map(c => c.char) : []);
  }

  /**
   * A tapped character goes into 生字本 (design §12). Only textbook
   * characters: 练生字 shows cards, and 呱 has none.
   * @returns {boolean} true if it was added by this tap
   */
  function addTapped(char) {
    const card = _card(char);
    if (!card) return false;
    const added = FavoriteService.add(char);
    if (added) FavoriteService.setContext(char, card.grade, card.semester);
    return added;
  }

  /**
   * ❤️/🤍 on the finish page: the same toggle as the card's ❤️.
   * @returns {boolean} whether it is in 生字本 now
   */
  function toggleFavorite(char) {
    const isFav = FavoriteService.toggle(char);
    const card = _card(char);
    if (isFav && card) FavoriteService.setContext(char, card.grade, card.semester);
    return isFav;
  }

  return {
    load, reload, status, forLesson, isHan, readingAt, newChars, addTapped, toggleFavorite,
    character, introReadingAt,
    // Test-only: install stories (and optionally character intros) without fetching.
    _setForTest: (stories, characters) => {
      _byLesson = {};
      (stories || []).forEach(st => { _byLesson[st.lesson] = st; });
      if (characters) { _characters = characters.characters || {}; _charAllow = characters.allow || []; }
      _ready = Promise.resolve(stories ? stories.length : 0);
    },
    _resetForTest: () => { _byLesson = {}; _characters = {}; _charAllow = []; _ready = null; _status = ''; },
    // Test-only: read another encrypted file (the fixture made by build_stories.py --fixture).
    _setFileForTest: (path) => { _encFile = path || 'data/stories.enc.json'; _ready = null; }
  };
})();

const StoryView = (() => {
  const PINYIN_FLASH_MS = 2500;
  // A page that does not fit the card is shrunk in steps down to this,
  // rather than scrolled: a child reading a picture book does not scroll.
  // 24px is still larger than the textbook's own type for these grades.
  const FIT_MIN_PX = 24;
  // The cast page is a list to glance at, not the story: it may go smaller.
  const FIT_MIN_CAST_PX = 14;
  const FIT_STEP_PX = 2;

  let _active = false;      // 学习 is showing the story instead of the cards
  let _story = null;
  // Screens of one reading: 0 is the cover, 1..pages.length the story's
  // pages (screen n shows data page n, so `readings` keys line up), and
  // pages.length + 1 the finish page. The cover's title is data page 0.
  // Who is in the story is on the back of the cover: tap to flip.
  let _page = 0;
  let _coverBack = false;   // the cover is turned over to the cast
  let _added = [];          // characters this reading put into 生字本, in tap order
  let _newSet = new Set();

  function _showPinyin() { return State.load('storyPinyin', false) === true; }
  const _learn = () => document.getElementById('learnMode');

  /** The lesson picked in 学习's dropdown. */
  function _lessonId() {
    const sel = document.getElementById('lessonFilter');
    return sel ? sel.value : '';
  }

  /** Is the daily task's 学习新字 step using 学习 right now? */
  function _inDailyLearn() { return !!document.getElementById('dtFloatingBtn'); }

  /**
   * Build the switch and the story area once per main-content render.
   * AppController replaces #main's markup at boot (see
   * _getMainContentHTML), so this checks rather than assumes they exist.
   */
  function _ensureDom() {
    const learn = _learn();
    if (!learn) return false;
    if (!document.getElementById('storySwitch')) {
      const sw = document.createElement('div');
      sw.id = 'storySwitch';
      sw.className = 'story-switch hidden';
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', '看字卡还是读故事');
      sw.innerHTML = `
        <button class="story-switch-btn active" id="btnViewCards" aria-pressed="true">🃏 字卡</button>
        <button class="story-switch-btn" id="btnViewStory" aria-pressed="false">📖 故事</button>`;
      const header = learn.querySelector('.content-header') || document.querySelector('.content-header');
      if (header) header.appendChild(sw);
      sw.querySelector('#btnViewCards').addEventListener('click', () => show(false));
      sw.querySelector('#btnViewStory').addEventListener('click', () => show(true));
    }
    if (!document.getElementById('storyView')) {
      const view = document.createElement('div');
      view.id = 'storyView';
      view.className = 'story-view hidden';
      // Same three rows as the cards: a card-shaped page, the controls
      // underneath, then the progress bar.
      view.innerHTML = `
        <div class="story-card" id="storyCard">
          <button class="pinyin-toggle" id="storyPinyinBtn" aria-pressed="false">拼音</button>
          <div class="story-body" id="storyBody"></div>
        </div>
        <div class="card-controls story-controls">
          <button id="storyPrev" aria-label="上一页">⬅️ 上一页</button>
          <button id="storyNext" aria-label="下一页">➡️ 下一页</button>
        </div>
        <div class="progress-container">
          <div class="progress-track"><div class="progress-fill" id="storyProgressFill"></div></div>
          <div class="progress-text" id="storyCount"></div>
        </div>`;
      learn.appendChild(view);
      view.querySelector('#storyPrev').addEventListener('click', prev);
      view.querySelector('#storyNext').addEventListener('click', next);
      view.querySelector('#storyPinyinBtn').addEventListener('click', togglePinyin);
      view.querySelector('#storyBody').addEventListener('click', _onBodyClick);
      _bindSwipe(view.querySelector('#storyCard'));
    }
    return true;
  }

  /**
   * Bring the switch and the view in line with the current mode and lesson.
   * Called whenever either changes (AppController.switchMode, selectLesson,
   * selectSemester). Picking a different lesson while reading opens that
   * lesson's story at page 1; a lesson without one goes back to the cards.
   */
  function refresh() {
    if (!_ensureDom()) return;
    const story = StoryService.forLesson(_lessonId());
    const usable = State.get('mode') === 'learn' && !_inDailyLearn() && !!story;
    const sw = document.getElementById('storySwitch');
    sw.classList.toggle('hidden', !usable);
    sw.closest('.content-header').classList.toggle('has-story', usable);
    if (usable) document.getElementById('btnViewStory').setAttribute('aria-label', `读故事《${story.title}》`);
    if (!usable) { _setActive(false); return; }
    if (_active && story !== _story) _openStory(story);
  }

  /**
   * Switch 学习 between the cards and the story.
   * @param {boolean} story - true for the story
   */
  function show(story) {
    if (!_ensureDom()) return;
    const st = StoryService.forLesson(_lessonId());
    if (story && !st) return;
    // Coming from the cards always starts a fresh reading at page 1: the
    // finish page lists what *this* reading added to 生字本.
    if (story && !_active) _openStory(st);
    _setActive(story);
    if (story) _render();
  }

  function _openStory(story) {
    _story = story;
    _page = 0;
    _coverBack = false;
    _added = [];
    _newSet = StoryService.newChars(story.lesson);
    _render();
  }

  function _setActive(on) {
    _active = !!on;
    const learn = _learn();
    if (learn) learn.classList.toggle('story-active', _active);
    const view = document.getElementById('storyView');
    if (view) view.classList.toggle('hidden', !_active);
    const cardsBtn = document.getElementById('btnViewCards');
    const storyBtn = document.getElementById('btnViewStory');
    if (cardsBtn && storyBtn) {
      cardsBtn.classList.toggle('active', !_active);
      storyBtn.classList.toggle('active', _active);
      cardsBtn.setAttribute('aria-pressed', String(!_active));
      storyBtn.setAttribute('aria-pressed', String(_active));
    }
    document.body.classList.toggle('story-reading', _active);
  }

  function isActive() { return _active; }

  /** The cast members who have an intro, in the story's order. */
  const _castIntros = () => (_story.cast || []).filter(n => StoryService.character(n));
  /** Index of the finish screen. */
  const _finishAt = () => _story.pages.length + 1;

  /** Turn the cover over to the cast, or back. Only on the cover. */
  function flipCover(back) {
    if (!_active || !_story || _page !== 0 || !_castIntros().length) return;
    _coverBack = back === undefined ? !_coverBack : !!back;
    const card = document.getElementById('storyCard');
    card.classList.remove('story-card--turning');
    void card.offsetWidth;                 // restart the turn animation
    card.classList.add('story-card--turning');
    _render();
  }

  function next() {
    if (!_active || !_story || _page >= _finishAt()) return;
    _coverBack = false;
    _page++;
    _render();
  }

  function prev() {
    if (!_active || !_story) return;
    if (_page === 0) { if (_coverBack) flipCover(false); return; }
    _coverBack = false;
    _page--;
    _render();
  }

  function togglePinyin() {
    State.save('storyPinyin', !_showPinyin());
    _render();
  }

  // Punctuation that belongs to the character after it. Everything else
  // (，。！？：、”…—) sticks to the character before it.
  const OPENING = '\u201c\u2018\uff08\u300a\u300c';

  /**
   * Markup for one run of text: every Chinese character is its own button.
   *
   * Each character is wrapped together with the punctuation around it in a
   * no-wrap group, so a line never starts with 「，」 and a page never ends
   * with 「。」 alone on the last line (both happened on a phone).
   * @param {string} text
   * @param {number} dataPage - which page of the data it is (0 = title),
   *   for looking up each character's reading
   * @returns {string} the groups' markup
   */
  function _charsHtml(text, dataPage, readingOf) {
    let n = 0;
    const groups = [];        // each: html string of one unbreakable unit
    let pendingOpen = '';
    for (const ch of text) {
      if (ch === '\n') { groups.push('<br>'); continue; }
      if (!StoryService.isHan(ch)) {
        const mark = `<span class="story-punct">${escapeHtml(ch)}</span>`;
        const last = groups.length - 1;
        if (OPENING.includes(ch) || last < 0 || groups[last] === '<br>') pendingOpen += mark;
        else groups[last] += mark;
        continue;
      }
      n++;
      const reading = (readingOf ? readingOf(n, ch) : StoryService.readingAt(_story, dataPage, n, ch)) || '';
      const cls = 'story-ch' + (_newSet.has(ch) ? ' story-new' : '');
      groups.push(pendingOpen +
        `<button class="${cls}" data-p="${dataPage}" data-n="${n}" aria-label="${escapeHtml(ch + (reading ? '，' + reading : ''))}">` +
        `${escapeHtml(ch)}<span class="story-py" aria-hidden="true">${escapeHtml(reading)}</span></button>`);
      pendingOpen = '';
    }
    if (pendingOpen) groups.push(pendingOpen);
    // <wbr> marks where a line may break. Without it Firefox (and Safari)
    // see the groups as one unbreakable run — each character is a button,
    // and there is no text between them to break at — so a long page ran
    // off the card on a single line. Chrome happened to break anyway.
    return groups.map(g => (g === '<br>' ? g : `<span class="story-w">${g}</span>`)).join('<wbr>');
  }

  /** One page of the story (1-based data page). */
  function _pageHtml(dataPage) {
    const html = _charsHtml(_story.pages[dataPage - 1].text || '', dataPage);
    return `<div class="story-page${_showPinyin() ? ' show-pinyin' : ''}">${html}</div>`;
  }

  /**
   * The cover, like a picture book's: the title large in the app's colour,
   * and who is in the story. The title's characters can be tapped like any
   * other (data page 0); the names are just a list.
   */
  function _coverHtml() {
    const cast = (_story.cast || []).map(escapeHtml).join('<span class="story-cover-dot">·</span>');
    const meet = _castIntros().length
      ? '<button class="story-flip-btn" data-action="story-flip" aria-label="翻过来，看看故事里的朋友">👀 认识他们</button>' : '';
    return `<div class="story-cover story-page${_showPinyin() ? ' show-pinyin' : ''}">
      <h2 class="story-cover-title" aria-label="${escapeHtml(_story.title)}">${_charsHtml(_story.title, 0).replace(/<wbr>/g, '')}</h2>
      ${cast ? `<div class="story-cover-cast">${cast}</div>` : ''}
      ${meet}
    </div>`;
  }

  /**
   * The back of the cover: who is in this story, one line each. The intros
   * are shared by every story (data/stories/characters.json); their
   * characters can be tapped like the story's, using the intro's readings.
   */
  /**
   * A character's picture: our own SVG, the same on every device (emoji are
   * drawn by the system — 飞飞 had brown hair and 小白 was grey on some).
   * The emoji stays as the fallback if the file cannot be loaded.
   */
  function _iconHtml(c) {
    const emoji = escapeHtml(c.emoji || '');
    if (!c.icon) return emoji;
    return `<img class="story-cast-icon" src="${escapeHtml(c.icon)}" alt="" width="64" height="64" data-fallback="${emoji}">`;
  }

  function _castHtml() {
    const rows = _castIntros().map(name => {
      const c = StoryService.character(name);
      const text = _charsHtml(c.text, -1, (n, ch) => StoryService.introReadingAt(name, n, ch));
      return `<li class="story-cast-row">
        <span class="story-cast-emoji" aria-hidden="true">${_iconHtml(c)}</span>
        <span class="story-cast-name">${escapeHtml(name)}</span>
        <span class="story-cast-text" data-intro="${escapeHtml(name)}">${text}</span>
      </li>`;
    }).join('');
    return `<div class="story-cast story-page${_showPinyin() ? ' show-pinyin' : ''}">
      <h2 class="story-cast-heading">故事里的朋友</h2>
      <ul class="story-cast-list">${rows}</ul>
      <button class="story-flip-btn" data-action="story-flip" aria-label="翻回封面">↩ 翻回封面</button>
    </div>`;
  }

  function _finishHtml() {
    const list = _added.map(ch => {
      const fav = FavoriteService.isFavorite(ch);
      return `<button class="story-fav" data-fav="${escapeHtml(ch)}" aria-pressed="${fav}"
        aria-label="${escapeHtml(ch)}，${fav ? '在生字本里，点一下取消' : '不在生字本里，点一下加入'}">
        <span class="story-fav-char char-display">${escapeHtml(ch)}</span><span class="story-fav-heart">${fav ? '❤️' : '🤍'}</span></button>`;
    }).join('');
    return `<div class="story-finish">
      <div class="story-finish-emoji">🎉</div>
      <div class="story-finish-title">读完了！</div>
      ${_added.length
        ? `<p class="story-finish-lead">这次点过的 ${_added.length} 个字，已经放进 ❤️ 生字本，在「练生字」里练。<br>只是好奇点了一下的，点 ❤️ 去掉。</p>
           <div class="story-fav-list">${list}</div>`
        : '<p class="story-finish-lead">这次没有点字。不认识的字，点一下就能听读音。</p>'}
      <div class="story-finish-actions">
        <button class="story-finish-btn" data-action="story-again">🔁 再读一遍</button>
        <button class="story-finish-btn story-finish-btn--primary" data-action="story-cards">🃏 回到字卡</button>
      </div>
    </div>`;
  }

  function _render() {
    if (!_story || !document.getElementById('storyView')) return;
    const total = _finishAt();               // the cover counts as a page
    const finished = _page >= _finishAt();
    const onBack = !finished && _page === 0 && _coverBack;
    document.getElementById('storyBody').innerHTML =
      finished ? _finishHtml() : _page === 0 ? (onBack ? _castHtml() : _coverHtml()) : _pageHtml(_page);
    document.getElementById('storyCard').classList.toggle('story-card--finish', finished);
    document.getElementById('storyCard').classList.toggle('story-card--cover', _page === 0);
    document.getElementById('storyCard').classList.toggle('story-card--cast', onBack);
    document.getElementById('storyCount').textContent = finished ? '读完了' : `${_page + 1} / ${total}`;
    document.getElementById('storyProgressFill').style.width =
      `${Math.round(Math.min(_page + 1, total) / total * 100)}%`;
    document.getElementById('storyPrev').disabled = _page === 0;
    document.getElementById('storyNext').disabled = finished;
    const py = document.getElementById('storyPinyinBtn');
    py.classList.toggle('active', _showPinyin());
    py.setAttribute('aria-pressed', String(_showPinyin()));
    py.classList.toggle('hidden', finished);
    _fit();
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (_active) _fit(); });
  }

  /**
   * Shrink the page's text until it fits the card without scrolling.
   *
   * The CSS size suits a typical page; the longest pages (40 characters,
   * five lines) overflowed a 360×640 phone and a 1280×800 laptop. Starts
   * from the CSS size every time, so a short page after a long one is not
   * left small, and turning pinyin on does not change the size (its room
   * is always reserved).
   */
  function _fit() {
    const body = document.getElementById('storyBody');
    const page = body && body.querySelector('.story-page');
    if (!page) return;
    if (page.classList.contains('story-cover')) { _fitTitle(page); return; }
    page.style.fontSize = '';
    let size = parseFloat(getComputedStyle(page).fontSize);
    const min = page.classList.contains('story-cast') ? FIT_MIN_CAST_PX : FIT_MIN_PX;
    const overflows = () => body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1;
    page.style.setProperty('--story-ch', size + 'px');
    while (overflows() && size > min) {
      size = Math.max(min, size - FIT_STEP_PX);
      page.style.fontSize = size + 'px';
      page.style.setProperty('--story-ch', size + 'px');
    }
  }

  /**
   * Keep the cover title on one line: 「小呱的两件宝」 wrapped as
   * 「小呱的两件 / 宝」 on a phone. The title cannot wrap (nowrap in CSS),
   * so this shrinks it from the CSS size until it is no wider than the
   * story body, down to the story text's minimum.
   */
  function _fitTitle(cover) {
    const title = cover.querySelector('.story-cover-title');
    if (!title) return;
    title.style.fontSize = '';
    let size = parseFloat(getComputedStyle(title).fontSize);
    // The room is the card's inner width. Everything inside the card (the
    // body, the cover) is stretched by a nowrap title that is too wide, so
    // only the card itself, sized by the page, is a fixed measure.
    const card = document.getElementById('storyCard');
    const cs = getComputedStyle(card);
    const room = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
    const tooWide = () => title.getBoundingClientRect().width > room + 0.5;
    while (tooWide() && size > FIT_MIN_PX) {
      size = Math.max(FIT_MIN_PX, size - FIT_STEP_PX);
      title.style.fontSize = size + 'px';
    }
  }

  function _onBodyClick(e) {
    const chBtn = e.target.closest('.story-ch');
    if (chBtn) { _tap(chBtn); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) { _toggleFav(fav); return; }
    const action = e.target.closest('[data-action]');
    if (action && action.dataset.action === 'story-flip') { flipCover(); return; }
    if (action && action.dataset.action === 'story-again') { _page = 0; _coverBack = false; _render(); return; }
    // A tap on the cover's empty space turns it over too, like a card.
    if (_page === 0 && !_coverBack && e.target.closest('.story-cover')) { flipCover(true); return; }
    if (action && action.dataset.action === 'story-cards') { show(false); return; }
  }

  function _tap(btn) {
    const n = Number(btn.dataset.n);
    const ch = btn.textContent.trim().charAt(0);
    const intro = btn.closest('[data-intro]');
    const reading = intro
      ? StoryService.introReadingAt(intro.dataset.intro, n, ch)
      : StoryService.readingAt(_story, Number(btn.dataset.p), n, ch);
    Speech.speakReading(ch, reading);

    btn.classList.remove('flash');
    // Restart the animation when the same character is tapped again.
    void btn.offsetWidth;
    btn.classList.add('flash');
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => btn.classList.remove('flash'), PINYIN_FLASH_MS);

    if (StoryService.addTapped(ch)) {
      _added.push(ch);
      btn.classList.add('story-added');
      if (typeof FilterUI !== 'undefined') FilterUI.updateFavCount();
    }
  }

  function _toggleFav(btn) {
    const ch = btn.dataset.fav;
    StoryService.toggleFavorite(ch);
    if (typeof FilterUI !== 'undefined') FilterUI.updateFavCount();
    _render();
    const again = document.querySelector(`#storyBody [data-fav="${CSS.escape(ch)}"]`);
    if (again) again.focus();
  }

  /**
   * Swipe left for the next page, right for the previous — the same gesture
   * and thresholds as the cards (AppController.setupSwipe).
   */
  function _bindSwipe(el) {
    let x = 0, y = 0, on = false;
    el.addEventListener('touchstart', (e) => {
      on = true; x = e.touches[0].clientX; y = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!on) return;
      on = false;
      const dx = x - e.changedTouches[0].clientX;
      const dy = Math.abs(y - e.changedTouches[0].clientY);
      if (dy > 50) return;
      if (dx > 60) next();
      else if (dx < -60) prev();
    }, { passive: true });
  }

  /** Called once at startup, after the main content is in place. */
  function init() {
    _ensureDom();
    // Rotating a phone or resizing a window changes how much fits.
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (_active) _fit(); }, 100);
    });
    // A picture that cannot load (offline before it was cached) becomes its
    // emoji. Image errors do not bubble, so listen in the capture phase.
    document.getElementById('storyBody').addEventListener('error', e => {
      const img = e.target;
      if (img && img.classList && img.classList.contains('story-cast-icon')) {
        img.replaceWith(document.createTextNode(img.dataset.fallback || ''));
      }
    }, true);
    StoryService.load().then(refresh);
    refresh();
  }

  return {
    init, refresh, show, isActive, next, prev, togglePinyin, flipCover,
    // Test-only: what this reading has put into 生字本.
    _addedForTest: () => [..._added]
  };
})();
