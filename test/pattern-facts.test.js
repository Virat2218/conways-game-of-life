import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { PRESETS, CATEGORIES, filterPresets, getPreset, previewPath, centerOrigin } from '../src/patterns.js';

function run(preset, generations) {
  const engine = new Engine(96, 96);
  const o = centerOrigin(preset, 96, 96);
  for (const [x, y] of preset.cells) engine.set(x + o.x, y + o.y, 1);
  for (let i = 0; i < generations; i++) engine.step();
  return engine;
}

// Live cells translated so the bounding box starts at the origin, as a sorted key list.
function shape(engine) {
  const cells = [];
  for (let y = 0; y < engine.height; y++) for (let x = 0; x < engine.width; x++) if (engine.get(x, y)) cells.push([x, y]);
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => `${x - minX},${y - minY}`).sort().join(' ');
}

test('every preset has a known category and a description', () => {
  assert.equal(PRESETS.length, 8);
  for (const p of PRESETS) {
    assert.ok(CATEGORIES[p.category], `${p.id} category`);
    assert.ok(p.description.length > 10, `${p.id} description`);
  }
});

test('filterPresets returns all, matching, empty and unknown-category results without mutation', () => {
  const presets = PRESETS;
  assert.deepEqual(filterPresets(presets, 'all'), presets);
  assert.notEqual(filterPresets(presets, 'all'), presets);
  assert.deepEqual(filterPresets(presets, 'spaceship').map((p) => p.id), ['glider', 'lwss']);
  assert.deepEqual(filterPresets(presets, 'unknown'), []);
  assert.deepEqual(filterPresets([], 'spaceship'), []);
  assert.equal(presets.length, 8);
});

test('spaceships and oscillators repeat their shape after the stated period', () => {
  for (const id of ['glider', 'lwss', 'pulsar', 'pentadecathlon']) {
    const p = getPreset(id);
    const start = shape(run(p, 0));
    assert.equal(shape(run(p, p.period)), start, `${id} repeats after ${p.period}`);
    for (let n = 1; n < p.period; n++) assert.notEqual(shape(run(p, n)), start, `${id} differs at generation ${n}`);
  }
});

test('spaceships actually move and oscillators stay put', () => {
  const origin = (engine) => {
    let minX = Infinity;
    let minY = Infinity;
    for (let y = 0; y < engine.height; y++) for (let x = 0; x < engine.width; x++) if (engine.get(x, y)) { minX = Math.min(minX, x); minY = Math.min(minY, y); }
    return [minX, minY];
  };
  for (const id of ['glider', 'lwss']) {
    const p = getPreset(id);
    assert.notDeepEqual(origin(run(p, p.period)), origin(run(p, 0)), `${id} moved`);
  }
  for (const id of ['pulsar', 'pentadecathlon']) {
    const p = getPreset(id);
    assert.deepEqual(origin(run(p, p.period)), origin(run(p, 0)), `${id} stayed`);
  }
});

test('the Gosper gun emits a glider every 30 generations', () => {
  const gun = getPreset('gosper');
  const counts = [0, 30, 60, 90].map((g) => run(gun, g).population);
  // Each period adds exactly one five-cell glider to the unchanged gun.
  assert.equal(counts[1] - counts[0], 5);
  assert.equal(counts[2] - counts[1], 5);
  assert.equal(counts[3] - counts[2], 5);
  assert.equal(shape(run(gun, 30)).split(' ').length, 36 + 5);
});

test('Diehard vanishes after 130 generations and not before', () => {
  const p = getPreset('diehard');
  assert.equal(run(p, p.vanishesAfter).population, 0);
  assert.ok(run(p, p.vanishesAfter - 1).population > 0);
});

test('the preview path is exactly the pattern cells, one unit square each', () => {
  for (const p of PRESETS) {
    const squares = [...previewPath(p).matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.deepEqual(squares, p.cells, `${p.id}`);
    assert.equal(previewPath(p).replace(/M\d+ \d+h1v1h-1z/g, ''), '', `${p.id}: nothing but squares`);
  }
});

test('centerOrigin puts the bounding box in the middle of the board', () => {
  const gun = getPreset('gosper');
  const o = centerOrigin(gun, 256, 160);
  assert.deepEqual(o, { x: 110, y: 75 });
  assert.ok(Math.abs(256 - (o.x + gun.width) - o.x) <= 1);
  assert.ok(Math.abs(160 - (o.y + gun.height) - o.y) <= 1);
});
