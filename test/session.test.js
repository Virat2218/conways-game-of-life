import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Clock, MAX_STEPS_PER_FRAME } from '../src/engine.js';
import { Session } from '../src/session.js';
import { UI } from '../src/ui.js';

function setup({ editing = false, stroking = false } = {}) {
  const state = { editing, stroking };
  const engine = new Engine(24, 16);
  const clock = new Clock(10);
  const session = new Session({
    engine,
    clock,
    isEditing: () => state.editing,
    isStroking: () => state.stroking,
  });
  return { state, engine, clock, session };
}

function blinker(engine) {
  for (const x of [4, 5, 6]) engine.set(x, 5, 1);
}

function snapshot(engine) {
  return { cells: Array.from(engine.cells), population: engine.population, generation: engine.generation };
}

test('Play toggles running and starts each run with a fresh interval', () => {
  const { session, clock } = setup();
  clock.acc = 80;
  assert.equal(session.togglePlay(), true);
  assert.equal(session.running, true);
  assert.equal(clock.acc, 0, 'banked time is dropped when starting');
  clock.acc = 60;
  session.togglePlay();
  assert.equal(session.running, false);
  assert.equal(clock.acc, 0, 'and when pausing');
});

test('pausing resets the clock accumulator', () => {
  const { session, clock } = setup();
  session.togglePlay();
  clock.acc = 90;
  session.pause();
  assert.equal(session.running, false);
  assert.equal(clock.acc, 0);
});

test('Step pauses a running simulation and advances exactly one generation', () => {
  const { session, engine } = setup();
  blinker(engine);
  session.togglePlay();
  assert.equal(session.step(), true);
  assert.equal(session.running, false);
  assert.equal(engine.generation, 1);
});

test('Play and Step do nothing while editing, and work again once the edit ends', () => {
  const { session, engine, state } = setup({ editing: true });
  blinker(engine);
  assert.equal(session.togglePlay(), false);
  assert.equal(session.running, false);
  assert.equal(session.step(), false);
  assert.equal(engine.generation, 0);
  state.editing = false;
  assert.equal(session.togglePlay(), true);
  assert.equal(session.running, true);
});

test('an edit that starts during playback leaves the simulation paused afterwards', () => {
  const { session, state } = setup();
  session.togglePlay();
  assert.equal(session.running, true);
  state.editing = true;
  session.pause(); // what Input's onEditStart hook does
  state.editing = false; // the edit ends (placed or cancelled)
  assert.equal(session.running, false, 'no automatic resume');
});

test('the frame loop runs only while playing and not mid-edit', () => {
  const { session, engine, state } = setup();
  blinker(engine);
  assert.equal(session.advance(1000), 0, 'paused');
  session.togglePlay();
  assert.equal(session.advance(100), 1, '100ms at 10 gen/s is one step');
  assert.equal(engine.generation, 1);
  state.editing = true;
  assert.equal(session.advance(1000), 0, 'editing');
  assert.equal(engine.generation, 1);
  state.editing = false;
  session.setSpeed(120);
  assert.equal(session.advance(1000), MAX_STEPS_PER_FRAME, 'still capped per frame');
});

test('Randomize pauses, resets generation to zero and keeps population consistent', () => {
  const { session, engine } = setup();
  blinker(engine);
  session.togglePlay();
  session.advance(300);
  assert.ok(engine.generation > 0);
  assert.equal(session.randomize(0.25), true);
  assert.equal(session.running, false, 'Play must be deliberate afterwards');
  assert.equal(engine.generation, 0);
  assert.equal(engine.population, engine.cells.reduce((sum, v) => sum + v, 0));
});

test('Clear pauses and resets, but neither Clear nor Randomize touches the board mid-stroke', () => {
  const { session, engine, state } = setup();
  blinker(engine);
  session.togglePlay();
  assert.equal(session.clear(), true);
  assert.equal(session.running, false);
  assert.equal(engine.population, 0);

  blinker(engine);
  state.stroking = true;
  const before = snapshot(engine);
  assert.equal(session.clear(), false);
  assert.equal(session.randomize(), false);
  assert.deepEqual(snapshot(engine), before, 'the stroke record stays valid');
});

test('keyboard shortcuts cannot bypass the edit guard', () => {
  const { session, engine, state } = setup({ editing: true });
  blinker(engine);
  // Routes keys the way main.js does: the UI only ever calls these actions.
  const actions = {
    togglePlay: () => session.togglePlay(),
    step: () => session.step(),
    clear: () => session.clear(),
    zoomIn() {},
    zoomOut() {},
    fit() {},
    rotate() {},
    escape() {},
  };
  const press = (key) =>
    UI.prototype.onKeyDown.call(
      { actions },
      { key, target: { tagName: 'BODY' }, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} },
    );

  for (const key of [' ', 'n', 'N', 'ArrowRight']) press(key);
  assert.equal(session.running, false, 'Space did not start playback');
  assert.equal(engine.generation, 0, 'N and ArrowRight did not step');

  state.editing = false;
  press('n');
  assert.equal(engine.generation, 1, 'the same key works once the edit ends');
  press(' ');
  assert.equal(session.running, true);
});
