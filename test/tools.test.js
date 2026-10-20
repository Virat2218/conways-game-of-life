import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/patterns.js';
import { TOOLS } from '../src/input.js';
import { setup } from './fake-board.js';

const snapshot = (engine) => ({
  cells: Array.from(engine.cells),
  population: engine.population,
  generation: engine.generation,
});

function seed(engine) {
  for (const [x, y] of [[5, 2], [6, 2], [7, 2], [9, 2], [3, 6], [4, 6], [5, 6]]) engine.set(x, y, 1);
}

const row = (engine, y, from, to) => {
  const out = [];
  for (let x = from; x <= to; x++) out.push(engine.get(x, y));
  return out;
};

test('Draw is the default tool and the tool list is Draw, Erase, Pan', () => {
  const t = setup();
  assert.equal(t.input.tool, 'draw');
  assert.deepEqual(TOOLS, ['draw', 'erase', 'pan']);
});

test('Draw adds cells wherever the stroke starts, including on a live cell', () => {
  const t = setup();
  seed(t.engine);
  t.down(6, 2); // starts on a live cell
  t.move(12, 2);
  t.up(12, 2);
  assert.deepEqual(row(t.engine, 2, 5, 12), [1, 1, 1, 1, 1, 1, 1, 1], 'the whole run is alive, nothing erased');
});

test('Erase removes cells wherever the stroke starts, including on a dead cell', () => {
  const t = setup();
  t.input.setTool('erase');
  seed(t.engine);
  t.down(1, 2); // starts on a dead cell
  t.move(11, 2);
  t.up(11, 2);
  assert.deepEqual(row(t.engine, 2, 1, 11), new Array(11).fill(0), 'live cells along the stroke are gone');
  assert.equal(t.engine.get(3, 6), 1, 'cells off the stroke are untouched');
  assert.equal(t.engine.population, 3);
});

test('Erase never adds cells and Draw never removes them', () => {
  const erase = setup();
  erase.input.setTool('erase');
  erase.down(2, 9); erase.move(10, 9); erase.up(10, 9);
  assert.equal(erase.engine.population, 0);

  const draw = setup();
  seed(draw.engine);
  const before = draw.engine.population;
  draw.down(5, 6); draw.move(5, 6); draw.up(5, 6);
  assert.ok(draw.engine.population >= before);
});

test('the Pan tool never changes a cell or asks the simulation to pause', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.input.setTool('pan');
  t.down(4, 4);
  t.move(9, 7);
  t.move(14, 9);
  t.up(14, 9);
  assert.ok(t.log.pans >= 2, 'the view moved');
  assert.equal(t.editStarts.length, 0, 'no pause was requested');
  assert.equal(t.input.editing, false);
  assert.deepEqual(snapshot(t.engine), before);
});

test('the Pan tool works for touch and pen, and a pinch takes over from it cleanly', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.input.setTool('pan');
  for (const pointerType of ['touch', 'pen']) {
    const pans = t.log.pans;
    t.down(3, 3, { pointerId: 5, pointerType });
    t.move(8, 6, { pointerId: 5, pointerType });
    t.up(8, 6, { pointerId: 5, pointerType });
    assert.ok(t.log.pans > pans, `${pointerType} drag pans`);
  }
  // One finger pans; the second finger turns it into a pinch.
  t.down(3, 3, { pointerId: 1, pointerType: 'touch' });
  t.move(6, 5, { pointerId: 1, pointerType: 'touch' });
  const pansBeforePinch = t.log.pans;
  t.down(14, 3, { pointerId: 2, pointerType: 'touch' });
  assert.equal(t.input.pan, null, 'the one-finger pan ended');
  t.move(2, 3, { pointerId: 1, pointerType: 'touch' });
  t.move(18, 3, { pointerId: 2, pointerType: 'touch' });
  assert.ok(t.log.zooms.some((z) => String(z).startsWith('zoom:')), 'the pinch zoomed');
  assert.ok(t.log.pans > pansBeforePinch, 'and panned with the midpoint');
  t.up(2, 3, { pointerId: 1, pointerType: 'touch' });
  t.up(18, 3, { pointerId: 2, pointerType: 'touch' });
  // Touch input still works afterwards.
  const pans = t.log.pans;
  t.down(5, 5, { pointerId: 3, pointerType: 'touch' });
  t.move(9, 8, { pointerId: 3, pointerType: 'touch' });
  t.up(9, 8, { pointerId: 3, pointerType: 'touch' });
  assert.ok(t.log.pans > pans, 'a fresh one-finger pan works after the pinch');
  assert.deepEqual(snapshot(t.engine), before, 'no accidental cells anywhere in the sequence');
  assert.equal(t.editStarts.length, 0);
});

test('right, middle and Shift drags pan under every tool without changing cells', () => {
  for (const tool of ['draw', 'erase', 'pan']) {
    const t = setup();
    seed(t.engine);
    const before = snapshot(t.engine);
    t.input.setTool(tool);
    for (const e of [{ button: 2 }, { button: 1 }, { button: 0, shiftKey: true }]) {
      const pans = t.log.pans;
      t.down(5, 2, e);
      t.move(9, 6, e);
      t.up(9, 6, e);
      assert.ok(t.log.pans > pans, `${tool}: ${JSON.stringify(e)} pans`);
    }
    assert.deepEqual(snapshot(t.engine), before, `${tool}: nothing changed`);
    assert.equal(t.editStarts.length, 0);
  }
});

test('pattern placement is a temporary mode: the chosen tool is back afterwards', () => {
  const placed = setup();
  placed.input.setTool('erase');
  placed.input.setStamp(getPreset('glider'));
  assert.equal(placed.input.tool, 'erase', 'the tool is untouched while placing');
  placed.move(10, 10);
  placed.down(10, 10);
  assert.equal(placed.input.editing, false);
  assert.equal(placed.input.tool, 'erase');
  seed(placed.engine);
  placed.down(5, 2); placed.move(9, 2); placed.up(9, 2);
  assert.deepEqual(row(placed.engine, 2, 5, 9), [0, 0, 0, 0, 0], 'Erase is in force again');

  const cancelled = setup();
  cancelled.input.setTool('pan');
  cancelled.input.setStamp(getPreset('pulsar'));
  cancelled.input.cancelEdit();
  assert.equal(cancelled.input.tool, 'pan', 'cancelling returns to the same tool');
  const pans = cancelled.log.pans;
  cancelled.down(3, 3); cancelled.move(7, 7); cancelled.up(7, 7);
  assert.ok(cancelled.log.pans > pans);
});

test('with the Pan tool selected, a click still places a pending pattern', () => {
  const t = setup();
  t.input.setTool('pan');
  t.input.setStamp(getPreset('glider'));
  t.move(10, 10);
  t.down(10, 10);
  assert.equal(t.engine.population, 5, 'placed, not panned');
  assert.equal(t.log.pans, 0);
});

test('choosing a tool abandons a pending pattern or a stroke without leftovers', () => {
  const stamping = setup();
  stamping.input.setStamp(getPreset('pulsar'));
  stamping.move(10, 10);
  stamping.input.setTool('erase');
  assert.equal(stamping.input.editing, false);
  assert.equal(stamping.log.ghosts.at(-1), null, 'ghost removed');
  assert.equal(stamping.engine.population, 0);

  const stroking = setup();
  seed(stroking.engine);
  const before = snapshot(stroking.engine);
  stroking.down(1, 10); stroking.move(8, 10);
  stroking.input.setTool('pan');
  assert.deepEqual(snapshot(stroking.engine), before, 'the half-drawn stroke was reverted');
});

test('setTool reports changes, ignores unknown tools, and clears the hover marker for Pan', () => {
  const t = setup();
  const changes = [];
  t.input.onToolChange = (tool) => changes.push(tool);
  t.input.setTool('erase');
  t.input.setTool('erase');
  t.input.setTool('lasso');
  t.input.setTool('pan');
  assert.deepEqual(changes, ['erase', 'pan']);
  assert.equal(t.input.tool, 'pan');
  t.move(4, 4);
  assert.equal(t.log.hovers.at(-1), null, 'no hover outline while panning');
  t.input.setTool('draw');
  t.move(4, 4);
  assert.deepEqual(t.log.hovers.at(-1), { x: 4, y: 4 });
});

test('strokes stay gap-free however far the pointer jumps between samples, at any zoom', () => {
  // Cell size in pixels for several zoom levels; a few sparse samples cross many cells.
  for (const scale of [1, 4, 12, 48]) {
    const t = setup({ width: 64, height: 40, scale });
    const px = (cell) => cell * scale + Math.floor(scale / 2);
    t.down(px(2), px(3));
    t.move(px(30), px(11));
    t.move(px(10), px(35));
    t.up(px(10), px(35));
    const live = new Set();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) if (t.engine.get(x, y)) live.add(`${x},${y}`);
    // Leg one, (2,3) to (30,11), covers 29 cells; leg two, (30,11) to (10,35), adds 24 more.
    assert.equal(live.size, 29 + 24, `scale ${scale}: one cell per step of each leg`);
    // 8-connected: every live cell touches another, except none stranded.
    for (const key of live) {
      const [x, y] = key.split(',').map(Number);
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && live.has(`${x + dx},${y + dy}`)) neighbours++;
      assert.ok(neighbours >= 1, `scale ${scale}: ${key} is connected`);
    }
  }
});
