// Turning boards into text and back: RLE export, the saved-setup schema, and
// share links. Pure functions, no DOM; everything read from outside is validated
// completely before it is returned, so callers never see half a result.

import { parse, ParseError, LIMITS } from './patterns.js';

export const SAVE_KEY = 'gol-save';
export const SAVE_VERSION = 1;
// Longest accepted stored save, in characters, checked before it is parsed.
export const MAX_SAVE_CHARS = 2_000_000;
// Whole share link, in characters. Most browsers, chat apps and mail clients keep
// URLs of about this length intact.
export const LINK_MAX = 2000;
export const LINK_PARAM = 'pattern';
const LINK_PREFIX = 'v1.';

const ok = (value) => ({ ok: true, ...value });
const fail = (code, message) => ({ ok: false, code, message });

// --- Live cells as a pattern -------------------------------------------------

// The live cells of a board as a pattern (bounding box moved to the origin), or
// null when the board is empty. Cells that wrap over an edge are not joined.
export function livePattern({ cells, width, height }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cells[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const out = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) if (cells[y * width + x]) out.push([x - minX, y - minY]);
  }
  return { cells: out, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// --- RLE export ----------------------------------------------------------------

const token = (n, symbol) => (n === 1 ? symbol : `${n}${symbol}`);

// The RLE body of a pattern ("bob$2bo$3o!"). Deterministic: the same cells always
// give the same text.
export function rleBody({ cells, width, height }) {
  const rows = Array.from({ length: height }, () => []);
  for (const [x, y] of cells) rows[y].push(x);
  const parts = rows.map((xs) => {
    xs.sort((a, b) => a - b);
    let out = '';
    let at = 0;
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      if (xs[i] > at) out += token(xs[i] - at, 'b');
      out += token(j - i + 1, 'o');
      at = xs[j] + 1;
      i = j + 1;
    }
    return out; // trailing dead cells are implied
  });
  // Row ends: `$`, and `n$` for n consecutive ends (blank rows).
  return `${parts.join('$').replace(/\$\$+/g, (run) => `${run.length}$`)}!`;
}

// A complete RLE file: optional name comment, header with the rule, then the body.
export function toRLE(pattern, { name = '', wrap = 70 } = {}) {
  const header = `x = ${pattern.width}, y = ${pattern.height}, rule = B3/S23`;
  const body = rleBody(pattern);
  let lines = [body];
  if (wrap) {
    lines = [];
    let line = '';
    for (const t of body.match(/\d*[bo$!]/g)) {
      if (line.length + t.length > wrap) {
        lines.push(line);
        line = '';
      }
      line += t;
    }
    lines.push(line);
  }
  const comment = name ? `#N ${name.replace(/[\r\n]+/g, ' ').slice(0, 100)}\n` : '';
  return `${comment}${header}\n${lines.join('\n')}\n`;
}

// --- The saved-setup schema -----------------------------------------------------

// Cells as alternating run lengths, starting with a (possibly empty) dead run.
export function encodeRuns(cells) {
  const runs = [];
  let state = 0;
  let length = 0;
  for (let i = 0; i < cells.length; i++) {
    const value = cells[i] ? 1 : 0;
    if (value === state) {
      length++;
    } else {
      runs.push(length);
      state = value;
      length = 1;
    }
  }
  runs.push(length);
  return runs;
}

// Back to a cell array, or null when `runs` is not exactly `total` cells of valid runs.
export function decodeRuns(runs, total) {
  if (!Array.isArray(runs) || runs.length === 0 || runs.length > total + 1) return null;
  const cells = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const n = runs[i];
    if (!Number.isSafeInteger(n) || n < 0 || at + n > total) return null;
    if (i % 2 === 1) cells.fill(1, at, at + n);
    at += n;
  }
  return at === total ? cells : null;
}

// One JSON document. The theme preference is stored elsewhere and not part of it.
export function encodeSave({ engine, seed }, now = Date.now()) {
  return JSON.stringify({
    version: SAVE_VERSION,
    width: engine.width,
    height: engine.height,
    generation: engine.generation,
    cells: encodeRuns(engine.cells),
    seed: seed ? encodeRuns(seed.cells) : null,
    savedAt: new Date(now).toISOString(),
  });
}

const damaged = fail('corrupt', 'The saved setup is damaged, so it was not loaded.');

// Validates a stored save for a board of the given size. On success returns
// { state: { cells, generation, seed }, savedAt }; nothing is applied here.
export function decodeSave(text, { width, height }) {
  if (typeof text !== 'string' || text.length > MAX_SAVE_CHARS) return damaged;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return damaged;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return damaged;
  if (!Number.isInteger(data.version) || data.version < 1) return damaged;
  if (data.version > SAVE_VERSION) {
    return fail('newer', 'This setup was saved by a newer version of the page and cannot be loaded here.');
  }
  if (!Number.isInteger(data.width) || !Number.isInteger(data.height)) return damaged;
  if (data.width !== width || data.height !== height) {
    return fail('size', `This setup is for a ${data.width} × ${data.height} board; this board is ${width} × ${height}.`);
  }
  if (!Number.isSafeInteger(data.generation) || data.generation < 0) return damaged;
  const total = width * height;
  const cells = decodeRuns(data.cells, total);
  if (!cells) return damaged;
  let seed = null;
  if (data.seed !== null && data.seed !== undefined) {
    const seedCells = decodeRuns(data.seed, total);
    if (!seedCells) return damaged;
    seed = { cells: seedCells };
  }
  const savedAt = typeof data.savedAt === 'string' && !Number.isNaN(Date.parse(data.savedAt)) ? data.savedAt : null;
  return ok({ state: { cells, generation: data.generation, seed }, savedAt });
}

// --- Share links ------------------------------------------------------------------

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (payload) => {
  if (!/^[A-Za-z0-9_-]*$/.test(payload) || payload.length % 4 === 1) return null;
  try {
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

// `base` is the page address without any fragment. The link carries the pattern's
// live cells only (no position, generation or history), as RLE in the fragment, so
// nothing is sent to a server. Over LINK_MAX the result says how long it would be.
export function encodeLink(pattern, base) {
  const text = `x = ${pattern.width}, y = ${pattern.height}, rule = B3/S23\n${rleBody(pattern)}`;
  const url = `${base}#${LINK_PARAM}=${LINK_PREFIX}${toBase64Url(text)}`;
  if (url.length > LINK_MAX) return fail('too-large', `The link would be ${url.length.toLocaleString('en-US')} characters; the limit is ${LINK_MAX.toLocaleString('en-US')}.`);
  return ok({ url });
}

// Reads a location hash. `null` when there is no share payload at all; otherwise
// { ok: true, pattern } or { ok: false, message }.
export function decodeLink(hash, limits = LIMITS) {
  const match = new RegExp(`^#?${LINK_PARAM}=(.*)$`).exec(String(hash));
  if (!match) return null;
  const value = match[1];
  if (value.length > LINK_MAX || !value.startsWith(LINK_PREFIX)) {
    return fail('link', 'This share link is not valid or comes from a newer version of the page.');
  }
  const text = fromBase64Url(value.slice(LINK_PREFIX.length));
  if (text === null) return fail('link', 'This share link is damaged.');
  try {
    const pattern = parse(text, limits);
    if (pattern.cells.length === 0) return fail('empty', 'This share link contains no live cells.');
    return ok({ pattern });
  } catch (error) {
    if (error instanceof ParseError) return fail(error.code, error.message);
    throw error;
  }
}
