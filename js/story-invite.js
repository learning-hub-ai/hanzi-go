/**
 * 小故事邀请码的界面 (design §7.5.7).
 *
 * Two ways in:
 * - a link …/hanzi-go/#invite=XXXX-XXXX-XXXX, handled once at start-up by
 *   fromUrl(): the code is taken out of the address bar first, then tried;
 * - 「🔑 小故事邀请码」 at the bottom of the 谁来学习？ picker: panelHtml()
 *   renders it, bind() wires it. When stories are open the same place shows
 *   「退出小故事试读」.
 *
 * Messages go to the small status line in the panel, or to a toast for the
 * link; neither ever shows the code itself.
 */
const StoryInvite = (() => {
  const MSG = {
    opened: '已开启小故事 📖',
    bad: '邀请码不对或已失效',
    missing: '现在打不开故事文件，请稍后再试',
    unsupported: '这种打开方式不能读小故事，请用正式网址打开',
    notCode: '邀请码是 12 位，例如 ABCD-EFGH-JKMN',
    left: '已退出小故事试读'
  };

  /** One short message on the page, read out by screen readers. */
  function toast(text) {
    let el = document.getElementById('storyInviteToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'storyInviteToast';
      el.className = 'story-invite-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  /** After the stories changed: show or hide the 📖 switch. */
  function _refreshView() {
    if (typeof StoryView !== 'undefined') StoryView.refresh();
  }

  /**
   * Try a code. Saves it and opens the stories when it works.
   * @param {string} code - as typed
   * @returns {Promise<string>} '' on success, else a key of MSG
   */
  async function tryCode(code) {
    if (!StoryUnlock.supported()) return 'unsupported';
    if (!StoryUnlock.normalize(code)) return 'notCode';
    await StoryService.reload(code);
    _refreshView();
    const why = StoryService.status();
    if (why === '') return '';
    // A wrong new code must not lose a code that works: open the saved one again.
    if (StoryUnlock.code()) { await StoryService.reload(); _refreshView(); }
    return why || 'bad';
  }

  /**
   * Handle #invite=… once, at start-up. The code leaves the address bar before
   * anything else happens (decrypting takes about half a second).
   * @returns {Promise<string|null>} null when there was no code in the link
   */
  async function fromUrl() {
    if (!/(?:^#|&)invite=/.test(location.hash || '')) return null;
    const code = StoryUnlock.takeFromUrl();
    const why = code ? await tryCode(code) : 'notCode';
    toast(why ? MSG[why] : MSG.opened);
    return why;
  }

  /** Leave the trial: forget the code and hide the stories. */
  async function leave() {
    StoryUnlock.clear();
    await StoryService.reload();
    _refreshView();
  }

  /** The picker's bottom section. */
  function panelHtml() {
    const on = !!StoryUnlock.code() && StoryService.status() === '';
    if (on) {
      return `
        <div class="story-invite" id="storyInvite">
          <button type="button" class="story-invite-toggle" id="btnStoryLeave">📖 小故事已开启 · 退出试读</button>
          <p class="story-invite-msg" id="storyInviteMsg" role="status" aria-live="polite"></p>
        </div>`;
    }
    const note = StoryUnlock.supported() ? '' : MSG.unsupported;
    return `
      <div class="story-invite" id="storyInvite">
        <button type="button" class="story-invite-toggle" id="btnStoryInvite" aria-expanded="false"
                aria-controls="storyInviteForm">🔑 小故事邀请码</button>
        <form class="story-invite-form hidden" id="storyInviteForm" novalidate>
          <label for="storyInviteCode" class="sr-only">小故事邀请码</label>
          <input type="text" id="storyInviteCode" placeholder="XXXX-XXXX-XXXX" maxlength="20"
                 autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
          <button type="submit" class="btn-confirm" id="btnStoryInviteOk">确定</button>
        </form>
        <p class="story-invite-msg" id="storyInviteMsg" role="status" aria-live="polite">${note}</p>
      </div>`;
  }

  /** Wire the section rendered by panelHtml() inside `root`. */
  function bind(root) {
    const msg = root.querySelector('#storyInviteMsg');
    const leaveBtn = root.querySelector('#btnStoryLeave');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', async () => {
        await leave();
        msg.textContent = MSG.left;
        leaveBtn.disabled = true;
      });
      return;
    }
    const toggle = root.querySelector('#btnStoryInvite');
    const form = root.querySelector('#storyInviteForm');
    const input = root.querySelector('#storyInviteCode');
    const ok = root.querySelector('#btnStoryInviteOk');
    toggle.addEventListener('click', () => {
      const open = form.classList.toggle('hidden') === false;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) input.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true;
      msg.textContent = '正在打开……';
      const why = await tryCode(input.value);
      ok.disabled = false;
      msg.textContent = why ? MSG[why] : MSG.opened;
      if (!why) {
        input.value = '';
        form.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        input.select();
      }
    });
  }

  return { fromUrl, tryCode, leave, panelHtml, bind, toast, MSG };
})();
