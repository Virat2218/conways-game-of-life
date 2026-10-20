import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Clock } from '../src/engine.js';
import { Session } from '../src/session.js';
import { getPreset } from '../src/patterns.js';
import { setup as setupBoard } from './fake-board.js';

function make({ width = 40, height = 24 } = {}) {
  const engine = new Engine(width, height);
  const clock = new Clock(10);
  const state = { editing: false, stroking: false };
  const session = new Session({ engine, clock, isEditing: () => state.editing, isStroking: () => state.stroking });
  return { engine, session, state };
}

// Deterministic PRNG (mulberry32) so a "random" board is the same on every run.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const snap = (engine) => ({ cells: Array.from(engine.cells), generation: engine.generation, population: engine.population });

const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
function glider(engine, dx = 5, dy = 5) {
  for (const [x, y] of GLIDER) engine.set(x + dx, y + dy, 1);
}

// Mimics a stroke: Input brackets its changes with begin and commit.
function stroke(session, engine, cells, label = 'Draw') {
  session.beginTransaction();
  for (const [x, y] of cells) engine.set(x, y, 1);
  return session.commitTransaction(label);
}

// --- Engine snapshots ------------------------------------------------------

test('restore puts back the exact cells and generation and recounts the population', () => {
  const engine = new Engine(10, 10);
  glider(engine, 2, 2);
  engine.step();
  engine.step();
  const saved = engine.snapshot();
  engine.randomize(0.5);
  engine.restore(saved);
  assert.deepEqual(snap(engine), { cells: Array.from(saved.cells), generation: 2, population: 5 });
  assert.ok(engine.matches(saved));
  saved.population = 999; // a wrong stored count must not matter
  engine.restore(saved);
  assert.equal(engine.population, 5);
});

test('a snapshot is an independent copy and a mismatched size is refused', () => {
  const engine = new Engine(10, 10);
  const saved = engine.snapshot();
  engine.set(3, 3, 1);
  assert.equal(saved.cells[3 * 10 + 3], 0);
  assert.equal(engine.matches(saved), false);
  assert.throws(() => engine.restore({ cells: new Uint8Array(5), generation: 0 }), RangeError);
});

// --- Undo and redo ---------------------------------------------------------

test('undo and redo restore exact cells, population and generation for a stroke', () => {
  const { engine, session } = make();
  glider(engine);
  engine.generation = 12;
  const before = snap(engine);
  assert.equal(stroke(session, engine, [[20, 10], [21, 10], [22, 10]]), true);
  const after = snap(engine);
  assert.notDeepEqual(after, before);
  assert.equal(session.history.undoLabel, 'Draw');

  assert.equal(session.undo().label, 'Draw');
  assert.deepEqual(snap(engine), before);
  assert.equal(session.redo().label, 'Draw');
  assert.deepEqual(snap(engine), after);
});

test('a long stroke is one transaction, however many cells it touches', () => {
  const { engine, session } = make();
  const cells = [];
  for (let x = 0; x < 30; x++) cells.push([x, 4]);
  stroke(session, engine, cells);
  assert.equal(session.history.entries.length, 1);
  session.undo();
  assert.equal(engine.population, 0, 'one undo removes the whole stroke');
});

test('cancelled and no-op edits do not consume history entries', () => {
  const { engine, session } = make();
  glider(engine);
  // A stroke that changes nothing.
  session.beginTransaction();
  assert.equal(session.commitTransaction('Draw'), false);
  // A stroke that is reverted.
  session.beginTransaction();
  engine.set(30, 20, 1);
  engine.set(30, 20, 0);
  session.abortTransaction();
  // Commit without begin.
  assert.equal(session.commitTransaction('Draw'), false);
  // Clear on a board that is already empty and at generation 0.
  const empty = make();
  empty.session.clear();
  assert.equal(empty.session.history.entries.length, 0);
  assert.equal(session.history.entries.length, 0);
});

test('Clear and Randomize are undoable and bring back the evolved board', () => {
  const { engine, session } = make();
  glider(engine);
  for (let i = 0; i < 7; i++) engine.step();
  const evolved = snap(engine);
  session.clear();
  assert.equal(engine.population, 0);
  assert.equal(engine.generation, 0);
  session.undo();
  assert.deepEqual(snap(engine), evolved, 'cells and generation 7 are back');

  session.randomize(0.3);
  assert.equal(engine.generation, 0);
  assert.equal(session.history.undoLabel, 'Randomize');
  session.undo();
  assert.deepEqual(snap(engine), evolved);
  session.redo();
  assert.equal(engine.population, engine.cells.reduce((a, v) => a + v, 0));
});

test('a new edit after an undo clears redo', () => {
  const { engine, session } = make();
  stroke(session, engine, [[1, 1]]);
  stroke(session, engine, [[2, 2]]);
  session.undo();
  assert.equal(session.canRedo, true);
  stroke(session, engine, [[3, 3]]);
  assert.equal(session.canRedo, false);
  assert.equal(session.redo(), null);
});

test('history is bounded to the latest 50 transactions', () => {
  const { engine, session } = make({ width: 60, height: 60 });
  for (let i = 0; i < 70; i++) stroke(session, engine, [[i % 60, Math.floor(i / 60)]]);
  assert.equal(session.history.entries.length, 50);
  let undos = 0;
  while (session.undo()) undos++;
  assert.equal(undos, 50);
});

test('simulation ticks are not history entries; undo and redo use the edit snapshots', () => {
  const { engine, session } = make();
  glider(engine);
  const beforeEdit = snap(engine);
  stroke(session, engine, [[30, 15], [31, 15]]);
  const afterEdit = snap(engine);
  for (let i = 0; i < 25; i++) engine.step();
  assert.equal(session.history.entries.length, 1, 'running added nothing');
  assert.ok(engine.generation > afterEdit.generation);
  session.undo();
  assert.deepEqual(snap(engine), beforeEdit);
  session.redo();
  assert.deepEqual(snap(engine), afterEdit, 'redo restores the recorded generation, not the evolved one');
});

test('undo and redo pause playback and do nothing mid-edit', () => {
  const { engine, session, state } = make();
  stroke(session, engine, [[1, 1]]);
  session.togglePlay();
  assert.equal(session.running, true);
  state.editing = true;
  assert.equal(session.undo(), null);
  assert.equal(session.running, true, 'blocked, so nothing paused or changed');
  assert.equal(engine.population, 1);
  state.editing = false;
  assert.ok(session.undo());
  assert.equal(session.running, false, 'undo pauses');
  state.editing = true;
  assert.equal(session.redo(), null);
  assert.equal(session.restart(), false);
});

// --- Restart seed ----------------------------------------------------------

test('there is no seed until the first Play or Step, and Step captures it once', () => {
  const { engine, session } = make();
  glider(engine);
  assert.equal(session.seed, null);
  assert.equal(session.canRestart, false);
  session.step();
  const seed = session.seed;
  assert.ok(seed);
  session.step();
  session.step();
  assert.equal(session.seed, seed, 'kept through the whole run');
  assert.equal(session.canRestart, true);
});

test('Restart after many generations reproduces the same seed and the same evolution', () => {
  const { engine, session } = make();
  engine.randomize(0.3, seeded(7)); // a lively but fully determined board
  assert.ok(engine.population > 100);
  session.togglePlay();
  session.pause();
  const seedCells = Array.from(session.seed.cells);
  for (let i = 0; i < 40; i++) engine.step();
  const evolved40 = snap(engine);
  assert.ok(evolved40.population > 0 && evolved40.population !== seedCells.reduce((a, v) => a + v, 0), 'the board really evolved');

  assert.equal(session.restart(), true);
  assert.equal(session.running, false, 'Restart stays paused');
  assert.equal(engine.generation, 0);
  assert.deepEqual(Array.from(engine.cells), seedCells, 'exactly the seed');
  for (let i = 0; i < 40; i++) engine.step();
  assert.deepEqual(snap(engine), evolved40, 'the same evolution again');
});

test('any edit gives the next run a new seed', () => {
  const { engine, session } = make();
  glider(engine);
  session.step();
  const first = Array.from(session.seed.cells);
  for (let i = 0; i < 5; i++) engine.step();
  stroke(session, engine, [[30, 20], [31, 20]]);
  assert.equal(session.seed, null, 'the edit dropped the old seed');
  assert.equal(session.canRestart, false);
  session.step();
  assert.notDeepEqual(Array.from(session.seed.cells), first, 'the new seed is the edited board');
  assert.equal(session.seed.cells[20 * 40 + 30], 1);
  for (let i = 0; i < 3; i++) engine.step();
  session.restart();
  assert.equal(engine.get(30, 20), 1, 'restart returns to the edited setup');
  assert.equal(engine.generation, 0);
});

test('Clear and Randomize also start a new seed lineage', () => {
  const { engine, session } = make();
  glider(engine);
  session.step();
  session.clear();
  assert.equal(session.seed, null);
  session.step();
  assert.ok(session.seed);
  session.randomize(0.2);
  assert.equal(session.seed, null);
});

test('undo restores the seed that belonged to the board it brings back', () => {
  const { engine, session } = make();
  glider(engine);
  session.step();
  const seed = session.seed;
  for (let i = 0; i < 6; i++) engine.step();
  stroke(session, engine, [[30, 20]]);
  assert.equal(session.seed, null);
  session.undo();
  assert.equal(session.seed, seed, 'the run it came from is restartable again');
  session.restart();
  assert.deepEqual(Array.from(engine.cells), Array.from(seed.cells));
});

test('Restart is itself undoable and does not change the seed', () => {
  const { engine, session } = make();
  glider(engine);
  session.step();
  const seed = session.seed;
  for (let i = 0; i < 9; i++) engine.step();
  const evolved = snap(engine);
  session.restart();
  assert.equal(session.history.undoLabel, 'Restart');
  assert.equal(session.seed, seed);
  assert.equal(session.canRestart, false, 'already at the seed');
  assert.equal(session.restart(), false, 'a second Restart is a no-op and adds no entry');
  assert.equal(session.history.entries.length, 1);
  session.undo();
  assert.deepEqual(snap(engine), evolved, 'the evolved board and its generation are back');
  assert.equal(session.seed, seed);
  assert.equal(session.canRestart, true);
});

// --- With the real Input, end to end ---------------------------------------

function wired() {
  const t = setupBoard({ width: 40, height: 24 });
  const clock = new Clock(10);
  const session = new Session({ engine: t.engine, clock, isEditing: () => t.input.editing, isStroking: () => t.input.stroke !== null });
  t.input.onEditStart = () => session.pause();
  t.input.onTransaction = (phase, info) => {
    if (phase === 'begin') session.beginTransaction();
    else if (phase === 'commit') session.commitTransaction(info.label);
    else session.abortTransaction();
  };
  return { ...t, session };
}

test('Input strokes and placements land in history as single labelled steps', () => {
  const t = wired();
  t.down(2, 2); t.move(12, 2); t.move(12, 9); t.up(12, 9);
  assert.equal(t.session.history.entries.length, 1);
  assert.equal(t.session.history.undoLabel, 'Draw');
  t.input.setTool('erase');
  t.down(5, 2); t.move(9, 2); t.up(9, 2);
  assert.equal(t.session.history.undoLabel, 'Erase');
  t.input.setStamp(getPreset('glider'));
  t.move(25, 15); t.down(25, 15);
  assert.equal(t.session.history.undoLabel, 'Place Glider');
  assert.equal(t.session.history.entries.length, 3);
  const withGlider = snap(t.engine);
  t.session.undo();
  assert.equal(t.engine.population, withGlider.population - 5);
  t.session.redo();
  assert.deepEqual(snap(t.engine), withGlider);
});

test('cancelled strokes, pinch reverts, cancelled placements and no-op placements add nothing', () => {
  const t = wired();
  // Escape mid-stroke.
  t.down(2, 2); t.move(12, 2);
  t.input.cancelEdit();
  t.up(12, 2);
  // Pinch mid-stroke.
  t.down(3, 6, { pointerId: 1, pointerType: 'touch' });
  t.move(9, 6, { pointerId: 1, pointerType: 'touch' });
  t.down(20, 6, { pointerId: 2, pointerType: 'touch' });
  t.up(9, 6, { pointerId: 1, pointerType: 'touch' });
  t.up(20, 6, { pointerId: 2, pointerType: 'touch' });
  // Cancelled placement.
  t.input.setStamp(getPreset('pulsar'));
  t.move(20, 12);
  t.input.cancelEdit();
  // A stroke that starts and ends without changing anything (Erase on empty).
  t.input.setTool('erase');
  t.down(30, 20); t.up(30, 20);
  assert.equal(t.session.history.entries.length, 0);
  assert.equal(t.engine.population, 0);

  // Placing a pattern exactly over itself changes nothing the second time.
  t.input.setTool('draw');
  t.input.setStamp(getPreset('glider')); t.move(20, 12); t.down(20, 12);
  t.input.setStamp(getPreset('glider')); t.move(20, 12); t.down(20, 12);
  assert.equal(t.session.history.entries.length, 1, 'the identical second placement was a no-op');
});

// --- Loading a pattern onto a clean board -------------------------------------

const place = (engine, preset, ox = 8, oy = 6) => () => {
  for (const [x, y] of preset.cells) engine.set(x + ox, y + oy, 1);
};

test('load replaces the board, resets the generation, pauses and sets the restart seed', () => {
  const { engine, session } = make({ width: 60, height: 40 });
  engine.randomize(0.3, seeded(7));
  session.togglePlay();
  session.advance(1000);
  assert.ok(engine.generation > 0 && session.running);
  const glider = getPreset('glider');
  assert.equal(session.load('Load Glider', place(engine, glider)), true);
  assert.equal(session.running, false, 'paused');
  assert.equal(engine.generation, 0);
  assert.equal(engine.population, 5, 'every old cell is gone');
  assert.notEqual(session.seed, null, 'the loaded board is the restart seed');
  assert.equal(session.canRestart, false, 'nothing to restart yet');
  session.step();
  session.step();
  assert.equal(session.canRestart, true);
  session.restart();
  assert.equal(engine.generation, 0);
  assert.equal(engine.population, 5, 'restart returns to the loaded pattern, not the earlier board');
});

test('load is one undo step that brings back the whole earlier board, and redo reloads it with its seed', () => {
  const { engine, session } = make({ width: 60, height: 40 });
  engine.randomize(0.3, seeded(3));
  const earlier = snap(engine);
  session.load('Load Pulsar', place(engine, getPreset('pulsar')));
  const loaded = snap(engine);
  assert.equal(session.history.undoLabel, 'Load Pulsar');
  assert.equal(session.history.entries.length, 1);
  session.undo();
  assert.deepEqual(snap(engine), earlier);
  session.redo();
  assert.deepEqual(snap(engine), loaded);
  assert.notEqual(session.seed, null, 'the seed is back after Redo');
  session.step();
  assert.equal(session.canRestart, true);
});

test('loading the same preset twice works, and the second load adds no history', () => {
  const { engine, session } = make({ width: 60, height: 40 });
  const rpent = getPreset('rpentomino');
  session.load('Load R-pentomino', place(engine, rpent));
  const first = snap(engine);
  session.step();
  session.step();
  session.step();
  assert.equal(session.load('Load R-pentomino', place(engine, rpent)), true);
  assert.deepEqual(snap(engine), first, 'back to the clean pattern at generation 0');
  assert.equal(session.history.entries.length, 2, 'the evolved board was replaced, so that load is its own step');
  const entries = session.history.entries.length;
  session.load('Load R-pentomino', place(engine, rpent));
  assert.equal(session.history.entries.length, entries, 'an identical board adds nothing');
  assert.notEqual(session.seed, null);
});

test('load is ignored while a stroke is in progress', () => {
  const { engine, session, state } = make();
  glider(engine);
  const before = snap(engine);
  state.stroking = true;
  assert.equal(session.load('Load Glider', place(engine, getPreset('glider'))), false);
  assert.deepEqual(snap(engine), before);
  assert.equal(session.history.entries.length, 0);
});

test('stamping keeps the board while loading replaces it (the two actions differ)', () => {
  const stamped = setupBoard({ width: 60, height: 40 });
  stamped.engine.set(2, 2, 1);
  stamped.engine.set(3, 2, 1);
  stamped.input.setStamp(getPreset('glider'));
  stamped.move(20, 20);
  stamped.down(20, 20);
  assert.equal(stamped.engine.population, 7, 'old cells kept, glider added');

  const { engine, session } = make({ width: 60, height: 40 });
  engine.set(2, 2, 1);
  engine.set(3, 2, 1);
  session.load('Load Glider', place(engine, getPreset('glider')));
  assert.equal(engine.population, 5, 'old cells gone');
});
