// Saving, loading, importing, exporting and sharing, as one object with no DOM.
// Every method validates its input completely before it touches the board, and a
// board is only ever changed through the Session (paused, one undo step), so a
// failure of any kind leaves the current board exactly as it was.

import { parse, ParseError, LIMITS, centerOrigin } from './patterns.js';
import {
  SAVE_KEY,
  decodeSave,
  encodeSave,
  encodeLink,
  decodeLink,
  livePattern,
  toRLE,
} from './serialize.js';

const ok = (value = {}) => ({ ok: true, ...value });
const fail = (message, code = 'error') => ({ ok: false, code, message });

// Browsers name a full store differently; code 22 and 1014 are the legacy forms.
const isQuotaError = (e) =>
  e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22 || e?.code === 1014;

export class Transfer {
  // storage: a Storage or null. cancelEdit: abandons a stroke or placement.
  // onReplaced: called after the board was replaced (to reframe the view).
  constructor({ engine, session, storage = null, cancelEdit = () => {}, onReplaced = () => {} }) {
    this.engine = engine;
    this.session = session;
    this.storage = storage;
    this.cancelEdit = cancelEdit;
    this.onReplaced = onReplaced;
  }

  // --- Saving on this device -------------------------------------------------

  save(now = Date.now()) {
    if (!this.storage) return fail('Browser storage is unavailable here (private mode or blocked), so nothing was saved.', 'storage');
    const text = encodeSave({ engine: this.engine, seed: this.session.seed }, now);
    try {
      this.storage.setItem(SAVE_KEY, text);
    } catch (error) {
      return fail(
        isQuotaError(error)
          ? 'Browser storage is full, so nothing was saved. Export the pattern as a file instead.'
          : 'The browser refused to store the setup, so nothing was saved.',
        'storage',
      );
    }
    return ok({ message: `Saved on this device: generation ${this.engine.generation.toLocaleString('en-US')}, ${this.engine.population.toLocaleString('en-US')} live cells.` });
  }

  // What is stored: { state: 'none' } | { state: 'ok', savedAt, generation, population } | { state: 'error', message }.
  savedInfo() {
    const read = this.readSave();
    if (!read.ok) return read.code === 'none' ? { state: 'none' } : { state: 'error', message: read.message };
    let population = 0;
    for (const v of read.state.cells) population += v;
    return { state: 'ok', savedAt: read.savedAt, generation: read.state.generation, population };
  }

  readSave() {
    if (!this.storage) return fail('Browser storage is unavailable here, so there is no saved setup to load.', 'storage');
    let text;
    try {
      text = this.storage.getItem(SAVE_KEY);
    } catch {
      return fail('The browser would not let the page read its storage.', 'storage');
    }
    if (text === null) return fail('There is no saved setup on this device yet.', 'none');
    return decodeSave(text, this.engine);
  }

  loadSaved() {
    const read = this.readSave();
    if (!read.ok) return fail(`${read.message} Your board is unchanged.`, read.code);
    this.cancelEdit();
    if (!this.session.loadState('Load saved setup', read.state)) return fail('Finish the stroke in progress first. Your board is unchanged.', 'busy');
    this.onReplaced();
    return ok({ message: `Loaded the saved setup, paused at generation ${read.state.generation.toLocaleString('en-US')}.` });
  }

  // --- Export and import ---------------------------------------------------------

  exportRLE(name = 'Conway\'s Game of Life') {
    const pattern = livePattern(this.engine);
    if (!pattern) return fail('The board has no live cells to export.', 'empty');
    return ok({ text: toRLE(pattern, { name }), filename: 'pattern.rle', pattern });
  }

  // Parses pasted or file text (plaintext or RLE). Nothing is changed.
  parseImport(text, limits = LIMITS) {
    try {
      const pattern = parse(text, limits);
      if (pattern.cells.length === 0) return fail('The text contains no live cells.', 'empty');
      return ok({ pattern });
    } catch (error) {
      if (error instanceof ParseError || error instanceof SyntaxError) {
        return fail(error.message, error.code ?? 'syntax');
      }
      throw error;
    }
  }

  // Replaces the whole board with an already parsed pattern, centred.
  loadPattern(pattern, name = 'imported pattern') {
    this.cancelEdit();
    const origin = centerOrigin(pattern, this.engine.width, this.engine.height);
    const loaded = this.session.load(`Load ${name}`, () => {
      for (const [x, y] of pattern.cells) this.engine.set(x + origin.x, y + origin.y, 1);
    });
    if (!loaded) return fail('Finish the stroke in progress first. Your board is unchanged.', 'busy');
    this.onReplaced();
    return ok({ message: `Loaded ${name} on a clean board, paused at generation 0.` });
  }

  // --- Share links ---------------------------------------------------------------------

  // `base` is the page address without a fragment.
  shareLink(base) {
    const pattern = livePattern(this.engine);
    if (!pattern) return fail('The board has no live cells to share.', 'empty');
    const link = encodeLink(pattern, base);
    if (!link.ok) {
      return fail(`${link.message} Export the pattern as a file instead.`, 'too-large');
    }
    return ok({ url: link.url, pattern });
  }

  // null when the hash holds no share payload; otherwise { ok, pattern } or { ok: false, message }.
  readLink(hash) {
    return decodeLink(hash);
  }
}
