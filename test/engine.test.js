import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Clock, MAX_STEPS_PER_FRAME, DEFAULT_WIDTH, DEFAULT_HEIGHT } from '../src/engine.js';

function liveCells(engine) {
  const out = [];
  for (let y = 0; y < engine.height; y++) {
    for (let x = 0; x < engine.width; x++) {
      if (engine.get(x, y)) out.push(`${x},${y}`);
    }
  }
  return out.sort();
}

function place(engine, cells, dx = 0, dy = 0) {
  for (const [x, y] of cells) engine.set(x + dx, y + dy, 1);
}

function countLive(engine) {
  return engine.cells.reduce((sum, v) => sum + v, 0);
}

// Deterministic PRNG (mulberry32) for reproducible randomize tests.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

test('defaults to a 256×160 grid backed by Uint8Arrays', () => {
  const e = new Engine();
  assert.equal(e.width, DEFAULT_WIDTH);
  assert.equal(e.height, DEFAULT_HEIGHT);
  assert.equal(e.width, 256);
  assert.equal(e.height, 160);
  assert.ok(e.cells instanceof Uint8Array);
  assert.equal(e.cells.length, 256 * 160);
});

test('rejects grids smaller than 3×3', () => {
  assert.throws(() => new Engine(2, 10), RangeError);
  assert.throws(() => new Engine(10, 2.5), RangeError);
});

test('blinker oscillates with period 2', () => {
  const e = new Engine(10, 10);
  place(e, [[3, 4], [4, 4], [5, 4]]);
  const start = liveCells(e);
  e.step();
  assert.deepEqual(liveCells(e), ['4,3', '4,4', '4,5']);
  e.step();
  assert.deepEqual(liveCells(e), start);
  assert.equal(e.generation, 2);
});

test('block is a still life', () => {
  const e = new Engine(8, 8);
  place(e, [[2, 2], [3, 2], [2, 3], [3, 3]]);
  const start = liveCells(e);
  for (let i = 0; i < 5; i++) e.step();
  assert.deepEqual(liveCells(e), start);
  assert.equal(e.population, 4);
});

test('glider moves (+1, +1) every 4 generations', () => {
  const e = new Engine(20, 20);
  place(e, GLIDER, 5, 5);
  for (let i = 0; i < 4; i++) e.step();
  const expected = new Engine(20, 20);
  place(expected, GLIDER, 6, 6);
  assert.deepEqual(liveCells(e), liveCells(expected));
  assert.equal(e.population, 5);
});

test('glider wraps across both edges of the torus', () => {
  const w = 12;
  const h = 9;
  const e = new Engine(w, h);
  place(e, GLIDER, w - 2, h - 2);
  for (let i = 0; i < 4; i++) e.step();
  const expected = new Engine(w, h);
  place(expected, GLIDER, w - 1, h - 1);
  assert.deepEqual(liveCells(e), liveCells(expected));

  // A full lap returns the glider to its starting place.
  const lap = new Engine(w, w);
  place(lap, GLIDER, 3, 3);
  const start = liveCells(lap);
  for (let i = 0; i < 4 * w; i++) lap.step();
  assert.deepEqual(liveCells(lap), start);
  assert.equal(lap.population, 5);
});

test('get/set wrap coordinates and set reports changes', () => {
  const e = new Engine(5, 5);
  assert.equal(e.set(-1, -1, 1), true);
  assert.equal(e.get(4, 4), 1);
  assert.equal(e.get(9, 9), 1);
  assert.equal(e.set(4, 4, 1), false);
  assert.equal(e.population, 1);
  assert.equal(e.set(4, 4, 0), true);
  assert.equal(e.population, 0);
});

test('population stays correct across set, step, clear and randomize', () => {
  const e = new Engine(32, 24);
  place(e, GLIDER, 10, 10);
  place(e, [[1, 1], [2, 1], [3, 1]]);
  assert.equal(e.population, 8);
  for (let i = 0; i < 25; i++) {
    e.step();
    assert.equal(e.population, countLive(e));
  }
  e.clear();
  assert.equal(e.population, 0);
  assert.equal(e.generation, 0);
  assert.equal(countLive(e), 0);
  e.randomize(0.25, seeded(1));
  assert.equal(e.population, countLive(e));
  const ratio = e.population / e.cells.length;
  assert.ok(ratio > 0.2 && ratio < 0.3, `density ${ratio} is not near 0.25`);
});

test('seeded randomize is deterministic', () => {
  const a = new Engine(40, 30);
  const b = new Engine(40, 30);
  a.randomize(0.4, seeded(42));
  b.randomize(0.4, seeded(42));
  assert.deepEqual(a.cells, b.cells);
  assert.throws(() => a.randomize(1.5), RangeError);
});

test('version changes on every mutation', () => {
  const e = new Engine(5, 5);
  const v0 = e.version;
  e.set(1, 1, 1);
  assert.ok(e.version > v0);
  const v1 = e.version;
  e.set(1, 1, 1);
  assert.equal(e.version, v1, 'no-op set must not bump version');
  e.step();
  assert.ok(e.version > v1);
});

test('Clock converts frame time into generations at the set speed', () => {
  const clock = new Clock(10);
  assert.equal(clock.advance(50), 0);
  assert.equal(clock.advance(50), 1, '100ms at 10 gen/s is one step');
  let total = 0;
  for (let i = 0; i < 60; i++) total += clock.advance(1000 / 60);
  assert.equal(total, 10, 'one second at 10 gen/s');
});

test('Clock clamps speed to 1–120 and steps at most 10 per frame', () => {
  const clock = new Clock(500);
  assert.equal(clock.speed, 120);
  clock.speed = 0;
  assert.equal(clock.speed, 1);
  clock.speed = 120;
  assert.equal(clock.advance(1000), MAX_STEPS_PER_FRAME);
  assert.equal(clock.acc, 0, 'backlog is dropped instead of bursting later');
  assert.equal(clock.advance(-5), 0);
});
