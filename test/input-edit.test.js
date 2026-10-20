import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/patterns.js';
import { setup } from './fake-board.js';

const snapshot = (engine) => ({
  cells: Array.from(engine.cells),
  population: engine.population,
  generation: engine.generation,
});

function seed(engine) {
  for (const [x, y] of [[5, 2], [6, 2], [9, 2], [3, 6], [4, 6], [5, 6]]) engine.set(x, y, 1);
  engine.generation = 7;
}

test('a stroke pauses before it changes any cell', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(1, 2);
  assert.equal(t.editStarts.length, 1);
  assert.deepEqual(t.editStarts[0], { population: before.population, generation: 7 }, 'board untouched when the hook ran');
  assert.equal(t.engine.population, before.population + 1, 'the first cell changed after the hook');
  t.move(8, 2);
  t.up(8, 2);
  assert.equal(t.editStarts.length, 1, 'once per stroke, not per cell');
  assert.equal(t.engine.generation, 7, 'generation is fixed throughout the stroke');
});

test('cancelling a drawing stroke restores cells, population and generation exactly', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(1, 2); // starts on a dead cell: draws, passing over live cells at 5, 6 and 9
  t.move(11, 2);
  t.move(11, 7);
  assert.notDeepEqual(snapshot(t.engine).cells, before.cells);
  assert.equal(t.input.editing, true);
  assert.equal(t.input.cancelEdit(), true);
  assert.deepEqual(snapshot(t.engine), before);
  assert.equal(t.input.editing, false);
  assert.equal(t.captured.size, 0, 'pointer capture released');
  t.move(14, 7); // the button is still held after Escape
  t.up(14, 7);
  assert.deepEqual(snapshot(t.engine), before, 'nothing paints after the cancel');
});

test('cancelling an erasing stroke restores the cells it removed', () => {
  const t = setup();
  t.input.setTool('erase');
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(5, 2);
  t.move(10, 2);
  assert.ok(t.engine.population < before.population);
  t.input.cancelEdit();
  assert.deepEqual(snapshot(t.engine), before);
});

test('cancelEdit reports false when there is nothing to cancel', () => {
  const t = setup();
  assert.equal(t.input.cancelEdit(), false);
});

test('a pinch that starts mid-stroke reverts it and touch drawing keeps working', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(1, 9, { pointerId: 1, pointerType: 'touch' });
  t.move(4, 9, { pointerId: 1, pointerType: 'touch' });
  assert.ok(t.engine.population > before.population, 'the stroke painted');
  t.down(12, 9, { pointerId: 2, pointerType: 'touch' }); // second finger lands
  assert.deepEqual(snapshot(t.engine), before, 'stroke reverted exactly');
  assert.equal(t.input.stroke, null);
  assert.equal(t.editStarts.length, 1, 'the second finger is not a new edit');
  t.up(4, 9, { pointerId: 1, pointerType: 'touch' });
  t.up(12, 9, { pointerId: 2, pointerType: 'touch' });
  t.down(15, 12, { pointerId: 3, pointerType: 'touch' });
  assert.equal(t.engine.population, before.population + 1, 'a fresh one-finger stroke paints');
  t.up(15, 12, { pointerId: 3, pointerType: 'touch' });
});

test('entering stamp mode pauses first, and cancelling leaves the board and ghost clean', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.input.setStamp(getPreset('glider'));
  assert.equal(t.editStarts.length, 1);
  assert.deepEqual(t.editStarts[0], { population: before.population, generation: 7 });
  assert.equal(t.input.editing, true);
  t.move(10, 10); // ghost follows the pointer
  assert.ok(Array.isArray(t.log.ghosts.at(-1)), 'ghost is showing');
  assert.equal(t.input.cancelEdit(), true);
  assert.equal(t.input.editing, false);
  assert.equal(t.log.ghosts.at(-1), null, 'no ghost left behind');
  assert.deepEqual(snapshot(t.engine), before, 'cancelling placed nothing');
});

test('placing a stamp changes the board once and ends the edit without another pause', () => {
  const t = setup();
  const ended = [];
  t.input.onStampEnd = (reason) => ended.push(reason);
  t.input.setStamp(getPreset('glider'));
  t.move(10, 10);
  t.down(10, 10);
  assert.equal(t.engine.population, 5);
  assert.equal(t.input.editing, false);
  assert.deepEqual(ended, ['placed']);
  assert.equal(t.editStarts.length, 1, 'only entering stamp mode paused');
});

test('selecting a pattern mid-stroke reverts the stroke before arming the stamp', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(1, 10);
  t.move(6, 10);
  t.input.setStamp(getPreset('pulsar'));
  assert.deepEqual(snapshot(t.engine), before);
  assert.equal(t.input.stroke, null);
  assert.ok(t.input.stamp);
});

test('panning and zooming never start an edit', () => {
  const t = setup();
  seed(t.engine);
  const before = snapshot(t.engine);
  t.down(5, 5, { button: 2 });
  t.move(9, 8, { button: 2 });
  t.up(9, 8, { button: 2 });
  t.down(5, 5, { shiftKey: true });
  t.move(7, 6, { shiftKey: true });
  t.up(7, 6, { shiftKey: true });
  t.wheel(-100);
  assert.ok(t.log.pans > 0, 'the view panned');
  assert.deepEqual(t.log.zooms, [1], 'the view zoomed');
  assert.equal(t.editStarts.length, 0, 'no pause was requested');
  assert.equal(t.input.editing, false);
  assert.deepEqual(snapshot(t.engine), before);
});
