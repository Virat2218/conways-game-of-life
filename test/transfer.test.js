import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Clock } from '../src/engine.js';
import { Session } from '../src/session.js';
import { getPreset, LIMITS } from '../src/patterns.js';
import { SAVE_KEY, LINK_MAX } from '../src/serialize.js';
import { Transfer } from '../src/transfer.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

function make({ storage = new MemoryStorage(), width = 48, height = 32, state = {} } = {}) {
  const engine = new Engine(width, height);
  const session = new Session({ engine, clock: new Clock(10), isStroking: () => state.stroking === true });
  const calls = { cancelled: 0, replaced: 0 };
  const transfer = new Transfer({
    engine,
    session,
    storage,
    cancelEdit: () => calls.cancelled++,
    onReplaced: () => calls.replaced++,
  });
  return { engine, session, transfer, storage, calls, state };
}

const snap = (engine) => ({ cells: Array.from(engine.cells), generation: engine.generation, population: engine.population });
const untouched = (t, before, historyLength, seed) => {
  assert.deepEqual(snap(t.engine), before, 'the board is exactly as it was');
  assert.equal(t.session.history.entries.length, historyLength, 'no history entry');
  assert.equal(t.session.seed, seed, 'the restart seed is unchanged');
  assert.equal(t.calls.replaced, 0, 'the view was not reframed');
};

test('save then load restores the cells, generation and restart seed, and Restart still works', () => {
  const t = make();
  t.engine.randomize(0.25, seeded(4));
  t.session.step(); // captures the seed
  t.session.step();
  t.session.step();
  const saved = snap(t.engine);
  const seedCells = Array.from(t.session.seed.cells);
  assert.equal(t.transfer.save().ok, true);
  t.session.clear();
  t.engine.randomize(0.5, seeded(8));
  assert.notDeepEqual(snap(t.engine), saved);
  const result = t.transfer.loadSaved();
  assert.equal(result.ok, true);
  assert.deepEqual(snap(t.engine), saved);
  assert.equal(t.engine.generation, 3, 'counters refreshed');
  assert.deepEqual(Array.from(t.session.seed.cells), seedCells);
  assert.equal(t.session.running, false, 'loading pauses');
  assert.equal(t.session.canRestart, true);
  t.session.restart();
  assert.deepEqual(Array.from(t.engine.cells), seedCells, 'Restart goes back to the saved seed');
  assert.equal(t.engine.generation, 0);
  assert.equal(t.calls.replaced, 1);
});

test('loading a save is one undo step that puts the previous board and seed back', () => {
  const t = make();
  t.engine.randomize(0.3, seeded(1));
  t.transfer.save();
  t.session.step();
  t.session.step();
  const before = snap(t.engine);
  const seedBefore = t.session.seed;
  t.transfer.loadSaved();
  assert.equal(t.session.history.undoLabel, 'Load saved setup');
  t.session.undo();
  assert.deepEqual(snap(t.engine), before);
  assert.equal(t.session.seed, seedBefore);
  t.session.redo();
  assert.equal(t.engine.generation, 0);
  assert.equal(t.session.seed, null, 'the saved setup had no seed yet');
});

test('a running simulation is paused by a load', () => {
  const t = make();
  t.engine.randomize(0.2, seeded(6));
  t.transfer.save();
  t.session.togglePlay();
  assert.equal(t.session.running, true);
  t.transfer.loadSaved();
  assert.equal(t.session.running, false);
});

test('storage that is missing, full, blocked or damaged never costs the current board', () => {
  const cases = {
    'no storage': { storage: null },
    'storage full': { storage: Object.assign(new MemoryStorage(), { setItem() { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } }) },
    'storage refuses writes': { storage: Object.assign(new MemoryStorage(), { setItem() { throw new Error('denied'); } }) },
    'storage refuses reads': { storage: Object.assign(new MemoryStorage(), { getItem() { throw new Error('denied'); } }) },
  };
  for (const [name, options] of Object.entries(cases)) {
    const t = make(options);
    t.engine.randomize(0.3, seeded(3));
    const before = snap(t.engine);
    const saved = t.transfer.save();
    if (name === 'storage refuses reads') assert.equal(saved.ok, true);
    else {
      assert.equal(saved.ok, false, name);
      assert.ok(saved.message.length > 10);
    }
    const loaded = t.transfer.loadSaved();
    assert.equal(loaded.ok, false, name);
    untouched(t, before, 0, null);
  }
  assert.match(make({ storage: cases['storage full'].storage }).transfer.save().message, /full/);
});

test('a missing, corrupt, newer or wrong-size save is reported and the board is untouched', () => {
  const t = make();
  t.engine.randomize(0.3, seeded(12));
  const before = snap(t.engine);
  assert.equal(t.transfer.loadSaved().code, 'none');
  assert.deepEqual(t.transfer.savedInfo(), { state: 'none' });
  const good = JSON.parse((t.transfer.save(), t.storage.getItem(SAVE_KEY)));
  for (const [label, text, code] of [
    ['invalid JSON', '{not json', 'corrupt'],
    ['wrong shape', '[]', 'corrupt'],
    ['newer version', JSON.stringify({ ...good, version: 2 }), 'newer'],
    ['other board size', JSON.stringify({ ...good, width: 50 }), 'size'],
    ['cells that do not add up', JSON.stringify({ ...good, cells: [1, 2, 3] }), 'corrupt'],
  ]) {
    t.storage.setItem(SAVE_KEY, text);
    const result = t.transfer.loadSaved();
    assert.equal(result.ok, false, label);
    assert.equal(result.code, code, label);
    assert.match(result.message, /unchanged/, label);
    untouched(t, before, 0, null);
    assert.equal(t.transfer.savedInfo().state, 'error', label);
  }
});

test('savedInfo describes what is stored without changing anything', () => {
  const t = make();
  t.engine.randomize(0.1, seeded(2));
  t.transfer.save(Date.UTC(2026, 9, 20, 9, 30, 0));
  assert.deepEqual(t.transfer.savedInfo(), {
    state: 'ok',
    savedAt: '2026-10-20T09:30:00.000Z',
    generation: 0,
    population: t.engine.population,
  });
});

test('a stroke in progress blocks a load, which then changes nothing', () => {
  const t = make();
  t.engine.randomize(0.3, seeded(5));
  t.transfer.save();
  t.engine.set(0, 0, 1 - t.engine.get(0, 0));
  const before = snap(t.engine);
  t.state.stroking = true;
  assert.equal(t.transfer.loadSaved().code, 'busy');
  assert.equal(t.transfer.loadPattern(getPreset('glider')).code, 'busy');
  untouched(t, before, 0, null);
});

// --- Import ---------------------------------------------------------------------

test('a valid import is parsed without touching the board; loading it centres it as one undo step', () => {
  const t = make();
  t.engine.randomize(0.3, seeded(14));
  const before = snap(t.engine);
  const parsed = t.transfer.parseImport('#N Glider\nx = 3, y = 3, rule = B3/S23\nbo$2bo$3o!');
  assert.equal(parsed.ok, true);
  assert.deepEqual(snap(t.engine), before, 'parsing is read-only');
  const result = t.transfer.loadPattern(parsed.pattern, 'Glider');
  assert.equal(result.ok, true);
  assert.equal(t.engine.population, 5);
  assert.equal(t.engine.generation, 0);
  assert.equal(t.calls.cancelled, 1);
  assert.equal(t.session.history.undoLabel, 'Load Glider');
  assert.notEqual(t.session.seed, null, 'the imported board is the restart seed');
  const cells = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) if (t.engine.get(x, y)) cells.push([x, y]);
  assert.deepEqual(cells[0], [23, 14], 'the 3 × 3 glider is centred on the 48 × 32 board (top row ·O·)');
  t.session.undo();
  assert.deepEqual(snap(t.engine), before);
});

test('every kind of bad import is refused with a message and no partial mutation', () => {
  const t = make();
  t.engine.randomize(0.3, seeded(21));
  const before = snap(t.engine);
  const rng = seeded(1);
  const randomJunk = Array.from({ length: 500 }, () => String.fromCharCode(32 + Math.floor(rng() * 95))).join('');
  const bad = {
    'malformed RLE': 'bo?$3o!',
    'unreadable header': 'x = y\nbo!',
    'oversized run': '99999999o!',
    'declared too wide': `x = ${LIMITS.maxWidth + 1}, y = 3\nbo!`,
    'letters that are not RLE': 'xxxxxxxxxx',
    'unsupported rule': 'x = 3, y = 3, rule = B36/S23\nbo$2bo$3o!',
    'too large text': 'O'.repeat(LIMITS.maxChars + 1),
    'empty text': '',
    'only comments': '!just a comment',
    'only dead cells': '...\n...',
    'binary junk': randomJunk,
    'not a string': undefined,
  };
  for (const [label, text] of Object.entries(bad)) {
    const result = t.transfer.parseImport(text);
    assert.equal(result.ok, false, label);
    assert.ok(typeof result.message === 'string' && result.message.length > 5, label);
    assert.ok(result.code, label);
  }
  untouched(t, before, 0, null);
});

test('a pattern with a live-cell count above the limit is refused (small custom limit)', () => {
  const t = make();
  const result = t.transfer.parseImport('OOO\nOOO', { ...LIMITS, maxCells: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cells');
  assert.equal(t.engine.population, 0);
});

// --- Export and links -------------------------------------------------------------

test('export then import reproduces the live cells exactly', () => {
  const t = make();
  t.engine.randomize(0.15, seeded(33));
  const exported = t.transfer.exportRLE('Test');
  assert.equal(exported.ok, true);
  assert.match(exported.text, /^#N Test\nx = \d+, y = \d+, rule = B3\/S23\n/);
  const back = t.transfer.parseImport(exported.text);
  assert.deepEqual(back.pattern.cells, exported.pattern.cells);
  const other = make();
  other.transfer.loadPattern(back.pattern);
  // Same shape, wherever it sits on the other board.
  const shape = (engine) => {
    const cells = [];
    for (let y = 0; y < engine.height; y++) for (let x = 0; x < engine.width; x++) if (engine.get(x, y)) cells.push([x, y]);
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => `${x - minX},${y - minY}`).join(' ');
  };
  assert.equal(shape(other.engine), shape(t.engine));
  assert.equal(make().transfer.exportRLE().code, 'empty');
});

test('share links round-trip through a location hash and refuse what does not fit', () => {
  const t = make({ width: 256, height: 160 });
  for (const [x, y] of getPreset('gosper').cells) t.engine.set(x + 10, y + 10, 1);
  const link = t.transfer.shareLink('https://example.test/conways-game-of-life/');
  assert.equal(link.ok, true);
  assert.ok(link.url.length <= LINK_MAX);
  assert.ok(link.url.startsWith('https://example.test/conways-game-of-life/#pattern=v1.'));
  const back = t.transfer.readLink(link.url.slice(link.url.indexOf('#')));
  assert.deepEqual(back.pattern.cells, link.pattern.cells);
  assert.equal(t.transfer.readLink('#nothing'), null);

  const big = make({ width: 256, height: 160 });
  big.engine.randomize(0.5, seeded(7));
  const refused = big.transfer.shareLink('https://example.test/');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'too-large');
  assert.match(refused.message, /Export the pattern as a file/);
  assert.equal(make().transfer.shareLink('https://example.test/').code, 'empty');
});
