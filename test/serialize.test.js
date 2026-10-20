import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, parse, parseRLE, getPreset } from '../src/patterns.js';
import { Engine } from '../src/engine.js';
import {
  SAVE_VERSION,
  LINK_MAX,
  encodeRuns,
  decodeRuns,
  encodeSave,
  decodeSave,
  encodeLink,
  decodeLink,
  livePattern,
  rleBody,
  toRLE,
} from '../src/serialize.js';

// Deterministic PRNG (mulberry32).
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPattern(rng, width, height, density) {
  const cells = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rng() < density) cells.push([x, y]);
  return cells;
}

const sameCells = (a, b) => JSON.stringify([...a].sort((p, q) => p[1] - q[1] || p[0] - q[0])) === JSON.stringify([...b].sort((p, q) => p[1] - q[1] || p[0] - q[0]));

test('every preset survives an RLE export and import exactly', () => {
  for (const p of PRESETS) {
    const text = toRLE(p, { name: p.name });
    const back = parseRLE(text);
    assert.deepEqual(back, { cells: p.cells, width: p.width, height: p.height }, p.id);
    assert.match(text, /rule = B3\/S23/);
  }
});

test('random patterns of many shapes round-trip through RLE, wrapped or not', () => {
  const rng = seeded(11);
  for (const [w, h, d] of [[1, 1, 1], [5, 3, 0.5], [40, 30, 0.2], [64, 64, 0.9], [200, 10, 0.05], [3, 120, 0.3], [256, 160, 0.4]]) {
    let cells = randomPattern(rng, w, h, d);
    if (!cells.length) cells = [[0, 0]];
    const board = new Engine(256, 160);
    for (const [x, y] of cells) board.set(x + 3, y + 2, 1);
    const pattern = livePattern(board);
    for (const wrap of [0, 70, 20]) {
      const back = parse(toRLE(pattern, { wrap }));
      assert.equal(back.width, pattern.width);
      assert.equal(back.height, pattern.height);
      assert.ok(sameCells(back.cells, pattern.cells), `${w}x${h} wrap ${wrap}`);
    }
  }
});

test('RLE output is canonical: blank rows merge, lines wrap at tokens, same cells give the same text', () => {
  assert.equal(rleBody({ cells: [[0, 0], [0, 3]], width: 1, height: 4 }), 'o3$o!');
  assert.equal(rleBody({ cells: [[2, 0], [0, 1]], width: 3, height: 2 }), '2bo$o!');
  assert.equal(rleBody(getPreset('glider')), 'bo$2bo$3o!');
  const gun = toRLE(getPreset('gosper'), { wrap: 70 });
  for (const line of gun.split('\n')) assert.ok(line.length <= 70, line);
  assert.equal(toRLE(getPreset('gosper')), gun);
  assert.match(toRLE(getPreset('glider'), { name: 'two\nlines' }), /^#N two lines\n/);
});

test('livePattern is the bounding box moved to the origin, and null for an empty board', () => {
  const board = new Engine(20, 10);
  assert.equal(livePattern(board), null);
  board.set(5, 4, 1);
  board.set(7, 6, 1);
  assert.deepEqual(livePattern(board), { cells: [[0, 0], [2, 2]], width: 3, height: 3 });
});

test('run-length cell storage round-trips and rejects anything inconsistent', () => {
  const rng = seeded(5);
  for (const density of [0, 0.02, 0.5, 1]) {
    const cells = Uint8Array.from({ length: 1000 }, () => (rng() < density ? 1 : 0));
    assert.deepEqual(Array.from(decodeRuns(encodeRuns(cells), 1000)), Array.from(cells));
  }
  assert.deepEqual(encodeRuns(Uint8Array.of(1, 1, 0)), [0, 2, 1], 'starts with an empty dead run');
  for (const bad of [null, [], 'abc', [1, 2, 3], [-1, 4], [0.5, 3.5], [3, 'x'], [NaN, 4], [1e300], [2 ** 53], [0, 5, 0, 0, 0, 0, 0, 0, 0]]) {
    assert.equal(decodeRuns(bad, 4), null, JSON.stringify(bad));
  }
});

function board(width = 24, height = 16) {
  const engine = new Engine(width, height);
  engine.randomize(0.3, seeded(9));
  return engine;
}

test('a saved setup restores cells, generation and restart seed exactly', () => {
  const engine = board();
  const seed = { cells: engine.cells.slice() };
  for (let i = 0; i < 7; i++) engine.step();
  const text = encodeSave({ engine, seed }, Date.UTC(2026, 9, 20, 12, 0, 0));
  const back = decodeSave(text, engine);
  assert.equal(back.ok, true);
  assert.deepEqual(Array.from(back.state.cells), Array.from(engine.cells));
  assert.equal(back.state.generation, 7);
  assert.deepEqual(Array.from(back.state.seed.cells), Array.from(seed.cells));
  assert.equal(back.savedAt, '2026-10-20T12:00:00.000Z');
  const noSeed = decodeSave(encodeSave({ engine, seed: null }), engine);
  assert.equal(noSeed.state.seed, null);
  assert.equal(JSON.parse(text).version, SAVE_VERSION);
  assert.ok(!('theme' in JSON.parse(text)), 'the theme preference is stored separately');
});

test('saves from other versions, boards or damage are refused with a reason', () => {
  const engine = board();
  const good = JSON.parse(encodeSave({ engine, seed: null }));
  const run = (patch) => decodeSave(JSON.stringify({ ...good, ...patch }), engine);
  assert.equal(run({}).ok, true);
  assert.equal(run({ version: SAVE_VERSION + 1 }).code, 'newer');
  assert.equal(run({ version: 99 }).code, 'newer');
  for (const version of [0, -1, 1.5, '1', null, undefined]) assert.equal(run({ version }).code, 'corrupt', `version ${version}`);
  assert.equal(run({ width: 25 }).code, 'size');
  assert.match(run({ height: 17 }).message, /24 × 16/);
  assert.equal(run({ width: '24' }).code, 'corrupt');
  for (const generation of [-1, 1.5, '3', null, 2 ** 60]) assert.equal(run({ generation }).code, 'corrupt', `generation ${generation}`);
  assert.equal(run({ cells: [1, 2, 3] }).code, 'corrupt');
  assert.equal(run({ cells: 'nope' }).code, 'corrupt');
  assert.equal(run({ seed: [1, 2] }).code, 'corrupt');
  for (const text of ['', '{', 'null', '[]', '"x"', '42', '{"version":1}', undefined, null, 'x'.repeat(2_000_001)]) {
    assert.equal(decodeSave(text, engine).ok, false, String(text).slice(0, 20));
  }
});

test('share links are deterministic, bounded, and decode to the same cells', () => {
  for (const p of PRESETS) {
    const a = encodeLink(p, 'https://example.test/game/');
    const b = encodeLink(p, 'https://example.test/game/');
    assert.equal(a.ok, true, p.id);
    assert.equal(a.url, b.url, 'deterministic');
    assert.ok(a.url.length <= LINK_MAX);
    assert.match(a.url.slice(a.url.indexOf('=') + 1), /^v1\.[A-Za-z0-9_-]+$/, 'URL-safe alphabet');
    const back = decodeLink(a.url.slice(a.url.indexOf('#')));
    assert.deepEqual(back.pattern, { cells: p.cells, width: p.width, height: p.height }, p.id);
  }
  assert.equal(decodeLink('#something-else'), null, 'unrelated fragments are ignored');
  assert.equal(decodeLink(''), null);
});

test('a link over the limit is refused with its length, and the limit is exact', () => {
  const rng = seeded(2);
  const dense = { cells: randomPattern(rng, 120, 80, 0.5), width: 120, height: 80 };
  const refused = encodeLink(dense, 'https://example.test/');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'too-large');
  assert.match(refused.message, /2,000/);
  // Find a base length that lands exactly on and just over the limit.
  const p = getPreset('gosper');
  const baseLen = LINK_MAX - encodeLink(p, '').url.length;
  assert.equal(encodeLink(p, 'a'.repeat(baseLen)).ok, true, 'exactly at the limit');
  assert.equal(encodeLink(p, 'a'.repeat(baseLen + 1)).ok, false, 'one over');
});

test('damaged, hostile or oversized link payloads are rejected, never partly applied', () => {
  const good = encodeLink(getPreset('glider'), '').url;
  const payload = good.slice(good.indexOf('=') + 1);
  const bad = (hash) => {
    const r = decodeLink(hash);
    assert.ok(r && r.ok === false, hash.slice(0, 40));
    return r;
  };
  bad('#pattern=');
  bad('#pattern=v2.abc');
  bad('#pattern=abc');
  bad(`#pattern=v1.${payload}!!`);
  bad(`#pattern=v1.${payload}A`.replace(/A$/, 'AAAAA'));
  bad(`#pattern=v1.${'A'.repeat(LINK_MAX)}`);
  bad('#pattern=v1.' + btoa('x = 999, y = 999\nbo!').replace(/=+$/, ''));
  bad('#pattern=v1.' + btoa('x = 3, y = 3, rule = B36/S23\nbo!').replace(/=+$/, ''));
  bad('#pattern=v1.' + btoa('999999999999o!').replace(/=+$/, ''));
  bad('#pattern=v1.' + btoa('x = 1, y = 1\n!').replace(/=+$/, ''));
  bad('#pattern=v1.' + btoa('ÿþ').replace(/=+$/, ''));
  assert.equal(bad('#pattern=v1.' + btoa('x = 3, y = 3, rule = B36/S23\nbo!').replace(/=+$/, '')).code, 'rule');
});
