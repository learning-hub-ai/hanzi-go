/**
 * 小故事邀请码 — open data/stories.enc.json in the browser (design §7.5.6).
 *
 * The story text is not public: the site ships it encrypted, and a child's
 * invite code opens it. The format is defined in scripts/story_crypto.py
 * (AES-256-GCM; PBKDF2-SHA256 with one salt per file; one wrapped content
 * key per invite). test.html opens a fixture made by that script, so the two
 * implementations are checked against each other.
 *
 * This module only knows codes and decryption; StoryService decides what to
 * do with the result and StoryView/the menu show it.
 *
 * Rules that keep the code private:
 * - Errors never carry the code (ErrorLog records error messages).
 * - The code is kept in one shared key for the whole device (State's
 *   SHARED_KEYS), so every child profile can read; only clear() removes it.
 *   Shared keys are not in a profile's export, so the code never travels in
 *   a backup file.
 * - The derived key lives in memory for this page load only.
 */
const StoryUnlock = (() => {
  const FORMAT = 'hanzigo-stories';
  const VERSION = 1;
  const AAD = new TextEncoder().encode(`${FORMAT}:v${VERSION}`);
  const STORE_KEY = 'storyInvite';
  // Crockford Base32 without I L O U; must match story_crypto.ALPHABET.
  const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

  /** Thrown when a code does not open the file. Its message never has the code. */
  class BadCode extends Error {
    constructor(reason) { super(`BadCode: ${reason}`); this.name = 'BadCode'; }
  }

  let _derived = null;   // { salt, iterations, code, key } — this page load only

  /** True when this page can decrypt: WebCrypto exists only on https and localhost. */
  function supported() {
    return !!(window.isSecureContext && window.crypto && crypto.subtle);
  }

  /**
   * Canonical form of a typed code, or '' when it can't be one.
   * Same rule as story_crypto.normalize: drop spaces, dashes and underscores,
   * upper case, O→0, I and L→1.
   * @param {string} code
   * @returns {string}
   */
  function normalize(code) {
    const s = String(code == null ? '' : code).replace(/[\s\-_]/g, '').toUpperCase()
      .replace(/O/g, '0').replace(/[IL]/g, '1');
    return CODE_RE.test(s) ? s : '';
  }

  /** 'ABCDEFGHJKMN' → 'ABCD-EFGH-JKMN' (for showing a saved code). */
  function format(code) {
    const s = normalize(code);
    return s ? s.match(/.{4}/g).join('-') : '';
  }

  /** @returns {string} the saved code, normalized, or '' */
  function code() { return normalize(State.loadShared(STORE_KEY, '')); }

  /** Remember a code for this device (normalized). */
  function save(c) {
    const s = normalize(c);
    if (!s) throw new BadCode('not a code');
    State.saveShared(STORE_KEY, s);
  }

  /** Forget the code (退出小故事试读). */
  function clear() {
    _derived = null;
    State.saveShared(STORE_KEY, '');
  }

  function _bytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function _derive(c, kdf) {
    if (_derived && _derived.code === c && _derived.salt === kdf.salt && _derived.iterations === kdf.iterations) {
      return _derived.key;
    }
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(c), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: _bytes(kdf.salt), iterations: kdf.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    _derived = { code: c, salt: kdf.salt, iterations: kdf.iterations, key };
    return key;
  }

  const _gcm = (key, iv, data) =>
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: _bytes(iv), additionalData: AAD }, key, _bytes(data));

  /**
   * Decrypt a story file with a code.
   * @param {Object} enc - the parsed data/stories.enc.json
   * @param {string} c - an invite code, any spelling
   * @returns {Promise<Object>} { characters, volumes }
   * @throws {BadCode} wrong or revoked code, other format, or a damaged file
   */
  async function open(enc, c) {
    if (!supported()) throw new BadCode('no WebCrypto here');
    if (!enc || enc.format !== FORMAT || enc.v !== VERSION) throw new BadCode('not a v1 story file');
    const s = normalize(c);
    if (!s) throw new BadCode('not a code');
    let key, content = null;
    try {
      key = await _derive(s, enc.kdf);
    } catch (_e) { throw new BadCode('bad kdf'); }
    for (const k of enc.keys || []) {
      try {
        const raw = await _gcm(key, k.iv, k.wrapped);
        content = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        break;
      } catch (_e) { /* not this code's key */ }
    }
    if (!content) throw new BadCode('no key for this code');
    try {
      const plain = await _gcm(content, enc.data.iv, enc.data.ct);
      return JSON.parse(new TextDecoder().decode(plain));   // trailing pad spaces are valid JSON whitespace
    } catch (_e) { throw new BadCode('damaged file'); }
  }

  /**
   * Take a code from the address bar (#invite=…) and remove it at once, so it
   * is not left in the history or in a later error report.
   * @returns {string} the normalized code, or '' when there was none
   */
  function takeFromUrl() {
    const m = /(?:^#|&)invite=([^&]*)/.exec(location.hash || '');
    if (!m) return '';
    const rest = location.hash.replace(/(?:^#|&)invite=[^&]*/, '').replace(/^&/, '');
    // Only the fragment changes. The URL is built from location.href, not
    // relative: a <base> element would otherwise point it at another document.
    const href = location.href.replace(/#.*$/, '') + (rest ? `#${rest}` : '');
    try {
      history.replaceState(null, '', href);
    } catch (_e) {
      location.hash = rest;   // older browsers: at least drop the code from the bar
    }
    let raw = '';
    try { raw = decodeURIComponent(m[1]); } catch (_e) { raw = m[1]; }
    return normalize(raw);
  }

  return {
    supported, normalize, format, code, save, clear, open, takeFromUrl, BadCode,
    STORE_KEY,
    _forgetDerivedForTest: () => { _derived = null; }
  };
})();
