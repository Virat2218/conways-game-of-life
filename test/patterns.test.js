import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, getPreset, parse, parsePlaintext, parseRLE, rotate } from '../src/patterns.js';
import { Engine } from '../src/engine.js';

const EXPECTED_CELLS = {
  glider: 5,
  lwss: 9,
  gosper: 36,
  pulsar: 48,
  pentadecathlon: 12,
  rpentomino: 5,
  acorn: 7,
  diehard: 7,
};

function stamp(engine, pattern, dx, dy) {
  for (const [x, y] of pattern.cells) engine.set(x + dx, y + dy, 1);
}

function snapshot(engine) {
  return Array.from(engine.cells).join('');
}

test('every preset parses to its documented cell count and bounding box', () => {
  assert.deepEqual(PRESETS.map((p) => p.id).sort(), Object.keys(EXPECTED_CELLS).sort());
  for (const p of PRESETS) {
    assert.equal(p.cells.length, EXPECTED_CELLS[p.id], p.id);
    const xs = p.cells.map(([x]) => x);
    const ys = p.cells.map(([, y]) => y);
    assert.equal(Math.min(...xs), 0, `${p.id} touches x=0`);
    assert.equal(Math.min(...ys), 0, `${p.id} touches y=0`);
    assert.equal(Math.max(...xs) + 1, p.width, `${p.id} width`);
    assert.equal(Math.max(...ys) + 1, p.height, `${p.id} height`);
  }
  assert.equal(getPreset('gosper').width, 36);
  assert.equal(getPreset('gosper').height, 9);
  assert.equal(getPreset('nope'), null);
});

test('parsePlaintext keeps interior blank rows and rejects junk', () => {
  const p = parsePlaintext('!Name: test\nO\n.\nO');
  assert.deepEqual(p.cells, [[0, 0], [0, 2]]);
  assert.equal(p.height, 3);
  assert.throws(() => parsePlaintext('O?O'), SyntaxError);
});

test('parseRLE matches the plaintext glider', () => {
  const rle = parseRLE('#N Glider\nx = 3, y = 3, rule = B3/S23\nbob$2bo$3o!');
  assert.deepEqual(rle, { cells: getPreset('glider').cells, width: 3, height: 3 });
  assert.deepEqual(parse('x = 3, y = 3\nbob$2bo$3o!').cells, getPreset('glider').cells);
});

test('rotate turns an asymmetric shape 90° clockwise', () => {
  // L-shape:  O.      OOO
  //           O.  ->  O..
  //           OO
  const l = parsePlaintext('O.\nO.\nOO');
  const r = rotate(l);
  assert.equal(r.width, 3);
  assert.equal(r.height, 2);
  assert.deepEqual(r.cells, parsePlaintext('OOO\nO..').cells);
});

test('four rotations return every preset to its original', () => {
  for (const p of PRESETS) {
    const r4 = rotate(rotate(rotate(rotate(p))));
    assert.deepEqual(r4.cells, p.cells, p.id);
    const r1 = rotate(p);
    assert.equal(r1.width, p.height);
    assert.equal(r1.height, p.width);
  }
});

test('presets behave as the classic patterns', () => {
  const run = (id, gens, size = [64, 64]) => {
    const e = new Engine(...size);
    stamp(e, getPreset(id), 20, 20);
    const start = snapshot(e);
    for (let i = 0; i < gens; i++) e.step();
    return { e, start };
  };
  for (const [id, period] of [['pulsar', 3], ['pentadecathlon', 15]]) {
    const { e, start } = run(id, period);
    assert.equal(snapshot(e), start, `${id} has period ${period}`);
  }
  // Diehard vanishes after exactly 130 generations.
  const die = run('diehard', 129).e;
  assert.ok(die.population > 0);
  die.step();
  assert.equal(die.population, 0);
  // The gun returns to its own shape every 30 generations, plus one emitted glider.
  const gun = run('gosper', 30, [120, 80]).e;
  for (const [x, y] of getPreset('gosper').cells) assert.equal(gun.get(x + 20, y + 20), 1);
  assert.equal(gun.population, 36 + 5);
});
