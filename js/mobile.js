/**
 * Mobile UI — bottom bar, bottom sheet (grade picker), swipe gestures.
 * Only active on viewports ≤768px.
 */
const MobileUI = (() => {
  const GRADE_NAMES = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'];
  const GRADE_ICONS = ['', '📘', '📗', '📙', '📕', '📒', '📘', '📖', '📖', '📖'];
  const SEM_NAMES = ['', '上册', '下册'];

  let _isMobile = false;
  let _sheetOpen = false;
  let _swipeStartX = 0;
  let _swipeStartY = 0;
  let _swiping = false;

  function isMobile() {
    return window.innerWidth <= 768;
  }

  /** Initialize mobile UI — call after AppController.init() */
  function init() {
    _isMobile = isMobile();
    if (!_isMobile) return;

    _bindBottomBar();
    _bindGradePicker();
    _bindMoreFeaturesButton();
    _bindSwipe();
    _updateGradeLabel();

    // Re-check on resize
    window.addEventListener('resize', () => {
      const wasMobile = _isMobile;
      _isMobile = isMobile();
      if (_isMobile && !wasMobile) {
        _updateGradeLabel();
      }
    });
  }

  /** Bind mobile bottom bar buttons to existing controllers */
  function _bindBottomBar() {
    const bar = document.getElementById('mobileBottomBar');
    if (!bar) return;

    document.getElementById('mbtnPrev').addEventListener('click', () => {
      const btnPrev = document.getElementById('btnPrev');
      if (btnPrev) btnPrev.click();
    });
    document.getElementById('mbtnNext').addEventListener('click', () => {
      const btnNext = document.getElementById('btnNext');
      if (btnNext) btnNext.click();
    });
    document.getElementById('mbtnFlip').addEventListener('click', () => {
      const btnFlip = document.getElementById('btnFlip');
      if (btnFlip) btnFlip.click();
    });
    document.getElementById('mbtnSpeak').addEventListener('click', () => {
      const btnSpeak = document.getElementById('btnSpeak');
      if (btnSpeak) btnSpeak.click();
    });
    document.getElementById('mbtnReinforce').addEventListener('click', () => {
      const btnReinforce = document.getElementById('btnReinforce');
      if (btnReinforce) btnReinforce.click();
    });
  }

  /** Bind grade picker button → opens bottom sheet */
  function _bindGradePicker() {
    const picker = document.getElementById('mobileGradePicker');
    const overlay = document.getElementById('mobileSheetOverlay');
    if (!picker || !overlay) return;

    picker.addEventListener('click', (e) => {
      e.stopPropagation();
      _openGradeSheet();
    });

    // Close on overlay tap
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeSheet();
    });
  }

  /** Bind the header's "更多功能" (⋯) button → opens the features sheet */
  function _bindMoreFeaturesButton() {
    const btn = document.getElementById('btnMoreFeatures');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _openFeaturesSheet();
    });
  }

  /**
   * Open the bottom sheet showing ONLY grade/semester options.
   *
   * Deliberately separate from _openFeaturesSheet(): this button's label
   * and aria-label are "选择年级" — mixing in 生词本/成就墙/etc meant
   * tapping it opened on a screen of mostly unrelated items before the
   * grade list even appeared, which is what a user reported as confusing.
   * Each sheet now has exactly the content its trigger button promises.
   */
  function _openGradeSheet() {
    const overlay = document.getElementById('mobileSheetOverlay');
    const content = document.getElementById('mobileSheetContent');
    const title = document.getElementById('mobileSheetTitle');
    if (!overlay || !content) return;
    if (title) title.textContent = '选择年级';

    const currentGrade = State.get('selectedGrade');
    const currentSem = State.get('selectedSemester');
    const allChars = State.get('allChars') || [];

    let html = '';
    for (let g = 1; g <= 9; g++) {
      for (let s = 1; s <= 2; s++) {
        const isActive = String(g) === String(currentGrade) && String(s) === String(currentSem);
        const activeClass = isActive ? ' active' : '';
        const count = allChars.filter(c => c.grade === g && c.semester === s).length;
        if (count === 0) continue; // Skip empty grades
        html += `<div class="mobile-sheet-item${activeClass}" data-grade="${g}" data-sem="${s}">
          <span class="mobile-sheet-item-icon">${GRADE_ICONS[g]}</span>
          <span class="mobile-sheet-item-label">${GRADE_NAMES[g]}${SEM_NAMES[s]}</span>
          <span class="mobile-sheet-item-count">${count}字</span>
        </div>`;
      }
    }

    content.innerHTML = html;

    content.querySelectorAll('.mobile-sheet-item[data-grade]').forEach(item => {
      item.addEventListener('click', () => {
        const grade = item.dataset.grade;
        const sem = item.dataset.sem;
        // Simulate sidebar click
        const sidebarItem = document.querySelector(`.sidebar-item[data-grade="${grade}"][data-sem="${sem}"]`);
        if (sidebarItem) {
          sidebarItem.click();
        } else {
          // Fallback: directly set state and refresh
          State.set('selectedGrade', grade);
          State.set('selectedSemester', sem);
          DataService.applyFilter('all');
          if (typeof LearnController !== 'undefined') LearnController.show();
        }
        _updateGradeLabel();
        _closeSheet();
      });
    });

    overlay.classList.remove('hidden');
    _sheetOpen = true;
  }

  /**
   * Open the bottom sheet showing feature shortcuts: 生词本/智能复习/
   * 成就墙/自定义/学习报告/备份与转移/使用说明.
   *
   * This is the single place these 7 items are listed for mobile. Where
   * a desktop header button already exists for one (favorites, badges,
   * report, data transfer, help — all hidden on mobile via CSS, see
   * .mobile-more-features's comment in index.html), this sheet forwards
   * the tap to that same button via .click() rather than reimplementing
   * its behavior, so there is exactly one place each action's logic
   * lives. 智能复习/自定义 have no desktop header button (sidebar-only
   * there), so those two forward to their existing sidebar/controller
   * entry points instead.
   */
  function _openFeaturesSheet() {
    const overlay = document.getElementById('mobileSheetOverlay');
    const content = document.getElementById('mobileSheetContent');
    const title = document.getElementById('mobileSheetTitle');
    if (!overlay || !content) return;
    if (title) title.textContent = '更多功能';

    const favCount = FavoriteService.getAll().length;
    const srsCount = typeof SpacedRepService !== 'undefined' ? SpacedRepService.getDueChars().length : 0;
    const customCount = typeof CustomCardService !== 'undefined' ? CustomCardService.count() : 0;

    const items = [
      { action: 'fav', icon: '❤️', label: '生词本', count: favCount },
      { action: 'srs', icon: '📈', label: '智能复习', count: srsCount },
      { action: 'badges', icon: '🏆', label: '成就墙' },
      { action: 'custom', icon: '✏️', label: '自定义', count: customCount },
      { action: 'report', icon: '📊', label: '学习报告' },
      { action: 'dataTransfer', icon: '💾', label: '备份与转移' },
      { action: 'help', icon: '❓', label: '使用说明' }
    ];

    content.innerHTML = items.map(it => `<div class="mobile-sheet-item" data-action="${it.action}">
        <span class="mobile-sheet-item-icon">${it.icon}</span>
        <span class="mobile-sheet-item-label">${it.label}</span>
        ${it.count !== undefined ? `<span class="mobile-sheet-item-count">${it.count}</span>` : ''}
      </div>`).join('');

    // action -> desktop button id, for the four that just forward a click
    const FORWARD_TO_BUTTON = {
      fav: 'btnFavorites',
      badges: 'btnBadges',
      report: 'btnReport',
      dataTransfer: 'btnDataTransfer',
      help: 'btnHelp'
    };

    content.querySelectorAll('.mobile-sheet-item[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        _closeSheet();

        if (FORWARD_TO_BUTTON[action]) {
          const btn = document.getElementById(FORWARD_TO_BUTTON[action]);
          if (btn) btn.click();
          return;
        }
        if (action === 'srs') {
          const srsItem = document.querySelector('.sidebar-item[data-grade="srs"]');
          if (srsItem) srsItem.click();
          return;
        }
        if (action === 'custom') {
          AppController.showCustomCards();
          return;
        }
      });
    });

    overlay.classList.remove('hidden');
    _sheetOpen = true;
  }

  /** Close bottom sheet */
  function _closeSheet() {
    const overlay = document.getElementById('mobileSheetOverlay');
    if (overlay) overlay.classList.add('hidden');
    _sheetOpen = false;
  }

  /** Update the grade label in the header */
  function _updateGradeLabel() {
    const label = document.getElementById('mobileGradeLabel');
    if (!label) return;
    const g = parseInt(State.get('selectedGrade')) || 1;
    const s = parseInt(State.get('selectedSemester')) || 1;
    label.textContent = `${GRADE_ICONS[g]} ${GRADE_NAMES[g]}${SEM_NAMES[s]}`;
  }

  /** Bind swipe gestures on the card */
  function _bindSwipe() {
    const card = document.getElementById('cardContainer');
    if (!card) return;

    card.addEventListener('touchstart', (e) => {
      if (!_isMobile) return;
      // Ignore touches starting inside the stroke-practice panel (✍️ 笔顺).
      // #cardContainer wraps the whole flashcard including its back face,
      // where the stroke panel lives — a child drawing a single horizontal
      // stroke (e.g. writing 一 or the top stroke of 天) moves a finger
      // sideways by more than this swipe's 50px threshold, which this
      // listener then misreads as "swipe to next/prev card", yanking the
      // child to a different character mid-stroke. Desktop has no touch
      // events at all, so this bug is mobile-only (matches the report).
      if (e.target.closest('#strokePanel')) { _swiping = false; return; }
      const touch = e.touches[0];
      _swipeStartX = touch.clientX;
      _swipeStartY = touch.clientY;
      _swiping = true;
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      if (!_isMobile || !_swiping) return;
      _swiping = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - _swipeStartX;
      const dy = touch.clientY - _swipeStartY;

      // Only trigger if horizontal swipe > 50px and more horizontal than vertical
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx > 0) {
          // Swipe right → previous
          const btnPrev = document.getElementById('btnPrev');
          if (btnPrev) btnPrev.click();
        } else {
          // Swipe left → next
          const btnNext = document.getElementById('btnNext');
          if (btnNext) btnNext.click();
        }
      }
    }, { passive: true });

    // Swipe down to dismiss bottom sheet
    _bindSheetSwipe();
  }

  /** Bind swipe-down gesture on the bottom sheet to dismiss it */
  function _bindSheetSwipe() {
    const sheet = document.getElementById('mobileSheet');
    if (!sheet) return;

    let startY = 0;
    let currentY = 0;
    let dragging = false;

    sheet.addEventListener('touchstart', (e) => {
      // Only start drag from the handle area (top 40px)
      const rect = sheet.getBoundingClientRect();
      const touch = e.touches[0];
      if (touch.clientY - rect.top < 40) {
        startY = touch.clientY;
        currentY = startY;
        dragging = true;
        sheet.style.transition = 'none';
      }
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      currentY = e.touches[0].clientY;
      const dy = currentY - startY;
      if (dy > 0) {
        // Only allow dragging downward
        sheet.style.transform = `translateY(${dy}px)`;
      }
    }, { passive: true });

    sheet.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      const dy = currentY - startY;
      sheet.style.transition = 'transform 0.2s ease';

      if (dy > 80) {
        // Dismiss — swipe was far enough
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
          _closeSheet();
          sheet.style.transform = '';
          sheet.style.transition = '';
        }, 200);
      } else {
        // Snap back
        sheet.style.transform = '';
        setTimeout(() => { sheet.style.transition = ''; }, 200);
      }
    }, { passive: true });
  }

  /** Call this whenever grade/semester changes (from sidebar too) */
  function onGradeChange() {
    if (_isMobile) _updateGradeLabel();
  }

  /**
   * Show or hide the mobile bottom bar (◀️🔄🔊🔁▶️). It is a page-level
   * fixed element outside #learnMode, so AppController.switchMode()'s
   * #learnMode.hidden toggle never reaches it — this is the only place
   * that controls it. Its buttons forward clicks to #btnPrev/#btnFlip/etc,
   * which only make sense while studying flashcards (学习模式); showing
   * it in 任务/挑战 let a child tap buttons with no visible effect there.
   * No-op on desktop — .mobile-bottom-bar is display:none there regardless
   * of this class, so there is nothing to toggle.
   * @param {boolean} visible
   */
  function setBottomBarVisible(visible) {
    const bar = document.getElementById('mobileBottomBar');
    if (bar) bar.classList.toggle('hidden', !visible);
  }

  return { init, onGradeChange, isMobile, setBottomBarVisible };
})();
