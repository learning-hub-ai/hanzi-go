/**
 * Error Log — in-memory ring buffer of recent failures, surfaced on demand.
 *
 * Why this exists: with ~20 children the parents just told the author
 * directly when something broke. At ~100, most people who hit a problem
 * will quietly stop using the app instead of reporting it, so the author
 * would never find out. This captures enough to diagnose a problem and
 * lets a parent hand it over in one copy-paste.
 *
 * Deliberate constraints:
 * - Nothing is uploaded. The app's main privacy property is that a child's
 *   data never leaves the device, and reporting errors to a remote endpoint
 *   would give that up (and pull the project into handling children's
 *   data). The parent forwards the text themselves.
 * - Nothing is persisted. Writing the log to localStorage would be
 *   self-defeating: the failure this most needs to catch is localStorage
 *   being unavailable.
 * - Nothing is shown unprompted. A child answering a question must never
 *   see a stack trace; the report is only assembled when a parent opens it.
 * - No child-identifying data. Counts and dates only — no name, no avatar,
 *   no list of characters studied — so the text is safe to paste into a
 *   class group chat.
 *
 * Loaded before state.js, because State's write path reports through it.
 */
const ErrorLog = (() => {
  const MAX_ENTRIES = 8;
  const _entries = [];

  /** Local wall-clock HH:MM:SS — parent and author share a timezone. */
  function _stamp() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
  }

  /**
   * Record one failure. Never throws: this is called from error handlers
   * and from State's write path, so a fault here would either mask the
   * original problem or break saving outright.
   *
   * @param {string} kind - short category, e.g. 'storage', 'js', 'promise'
   * @param {string} message - one-line description, truncated
   */
  function record(kind, message) {
    try {
      const text = String(message == null ? '' : message).slice(0, 200);
      const last = _entries[_entries.length - 1];
      // Collapse an identical consecutive failure into a counter instead of
      // filling the buffer with it — something throwing every frame would
      // otherwise push out the earlier, more informative entries.
      if (last && last.kind === kind && last.text === text) {
        last.count++;
        return;
      }
      _entries.push({ at: _stamp(), kind, text, count: 1 });
      if (_entries.length > MAX_ENTRIES) _entries.shift();
    } catch (_) { /* never let diagnostics break the app */ }
  }

  /** @returns {Array} a copy of the recorded entries, oldest first */
  function entries() { return _entries.slice(); }

  /** Drop everything (used by tests). */
  function clear() { _entries.length = 0; }

  /**
   * Install global handlers. Separate from module creation so tests can
   * exercise record()/report() without hijacking the page's error events.
   */
  function install() {
    window.addEventListener('error', (e) => {
      // Resource load failures (a missing script/image) arrive here too,
      // with no .error — worth recording, but they have no stack.
      const where = e.filename
        ? ` (${String(e.filename).split('/').pop()}:${e.lineno})`
        : '';
      record('js', (e.message || 'script error') + where);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      record('promise', (r && (r.message || r)) || 'unhandled rejection');
    });
  }

  /**
   * Build the text a parent copies and sends.
   *
   * Everything here is either a device fact or an aggregate number. Adding
   * the profile name would make this unsafe to paste into a group chat, so
   * the profile is identified only by how much has been learned.
   *
   * @returns {string} plain text, ready to select and copy
   */
  function report() {
    const lines = [];
    const push = (s) => lines.push(s);

    try {
      const ua = navigator.userAgent || '';
      // Coarse device/browser identification — enough to tell an iPhone
      // Safari problem from an Android Chrome one, which is the split that
      // has actually mattered here (see the iOS audio bugs).
      const device = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Android/.test(ua) ? 'Android'
        : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '其他';
      const browser = /CriOS/.test(ua) ? 'Chrome(iOS)'
        : /EdgiOS|Edg/.test(ua) ? 'Edge'
        : /FxiOS|Firefox/.test(ua) ? 'Firefox'
        : /Chrome/.test(ua) ? 'Chrome'
        : /Safari/.test(ua) ? 'Safari' : '未知';
      const standalone = window.matchMedia
        && window.matchMedia('(display-mode: standalone)').matches;

      push(`HanziGo 诊断信息 · ${new Date().toLocaleString('zh-CN')}`);
      push(`设备：${device} / ${browser} / ${window.innerWidth}×${window.innerHeight}`
        + (standalone ? ' / 已添加到主屏幕' : ''));
    } catch (_) {
      push('HanziGo 诊断信息（设备信息读取失败）');
    }

    // Storage health is the single most useful line: a parent reporting
    // "进度没保存" almost always turns out to be private browsing.
    try {
      const ok = (typeof State !== 'undefined' && State.storageWorks)
        ? State.storageWorks() : null;
      push(`存储：${ok === null ? '未知' : ok ? '正常' : '⚠ 无法写入（可能开了无痕/隐私模式）'}`);
    } catch (_) { push('存储：未知'); }

    // Aggregate progress only — no names, no character lists.
    try {
      const learned = (typeof SpacedRepService !== 'undefined')
        ? SpacedRepService.getTotalCount() : '?';
      const stats = (typeof State !== 'undefined') ? (State.get('stats') || {}) : {};
      push(`进度：已学 ${learned} 字 / 连续 ${stats.consecutiveDays || 0} 天 / 共 ${stats.totalRounds || 0} 轮挑战`);
    } catch (_) { /* progress is optional in the report */ }

    if (!_entries.length) {
      push('最近没有记录到错误。');
    } else {
      push(`最近 ${_entries.length} 条错误：`);
      _entries.forEach(e => {
        push(`  ${e.at} [${e.kind}] ${e.text}${e.count > 1 ? ` ×${e.count}` : ''}`);
      });
    }
    return lines.join('\n');
  }

  return { record, entries, clear, install, report };
})();
