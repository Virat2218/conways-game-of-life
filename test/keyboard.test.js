import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/patterns.js';
import { BIG_STEP } from '../src/input.js';
import { UI } from '../src/ui.js';
import { revealOffset } from '../src/renderer.js';
import { setup } from './fake-board.js';

const cursor = (t) => ({ ...t.input.cursor });

test('arrows move the cursor from the centre of the view, one cell at a time, Shift ten', () => {
  const t = setup({ width: 40, height: 30 });
  t.key('ArrowRight');
  assert.deepEqual(cursor(t), { x: 21, y: 15 }, 'starts at the centre, then moves');
  t.key('ArrowDown');
  t.key('ArrowLeft');
  t.key('ArrowLeft');
  t.key('ArrowUp');
  assert.deepEqual(cursor(t), { x: 19, y: 15 });
  t.key('ArrowRight', { shiftKey: true });
  assert.deepEqual(cursor(t), { x: 19 + BIG_STEP, y: 15 });
  assert.deepEqual(t.log.cursors.at(-1), cursor(t), 'the renderer shows it');
  assert.ok(t.log.reveals.length >= 6, 'the view is asked to follow every move');
});

test('the cursor stays on the board: it clamps at every edge instead of wrapping', () => {
  const t = setup({ width: 12, height: 8 });
  for (let i = 0; i < 30; i++) t.key('ArrowLeft');
  for (let i = 0; i < 30; i++) t.key('ArrowUp');
  assert.deepEqual(cursor(t), { x: 0, y: 0 });
  for (let i = 0; i < 5; i++) t.key('ArrowRight', { shiftKey: true });
  for (let i = 0; i < 5; i++) t.key('ArrowDown', { shiftKey: true });
  assert.deepEqual(cursor(t), { x: 11, y: 7 });
});

test('Enter toggles the cell under the cursor, pausing first, as one undoable step each', () => {
  const t = setup();
  const steps = [];
  t.input.onTransaction = (phase, info) => steps.push([phase, info?.label]);
  t.key('ArrowRight');
  const { x, y } = cursor(t);
  t.key('Enter');
  assert.equal(t.engine.get(x, y), 1);
  assert.equal(t.editStarts.length, 1, 'paused before the change');
  assert.deepEqual(t.editStarts[0], { population: 0, generation: 0 }, 'the board was untouched when it paused');
  t.key('Enter');
  assert.equal(t.engine.get(x, y), 0, 'a second Enter removes it');
  assert.deepEqual(steps, [['begin', undefined], ['commit', 'Add cell'], ['begin', undefined], ['commit', 'Remove cell']]);
});

test('Enter on a cell that is alive removes it; a held Enter does not flicker it', () => {
  const t = setup();
  t.engine.set(12, 8, 1);
  t.key('ArrowLeft');
  assert.deepEqual(cursor(t), { x: 11, y: 8 });
  t.key('ArrowRight');
  t.key('Enter');
  assert.equal(t.engine.get(12, 8), 0);
  const held = t.key('Enter', { repeat: true });
  assert.equal(held.defaultPrevented, true);
  assert.equal(t.engine.get(12, 8), 0, 'auto-repeat is ignored');
});

test('every key the board handles is claimed, so page shortcuts cannot also act on it', () => {
  const t = setup();
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter']) {
    assert.equal(t.key(key).defaultPrevented, true, key);
  }
  for (const key of [' ', 'n', 'N', 'c', 'f', 'r', 'Escape', 'Tab', '+', 'z']) {
    assert.equal(t.key(key).defaultPrevented, false, `${key} is left to the page`);
  }
});

test('modifier shortcuts keep their native or page meaning on the board', () => {
  const t = setup();
  const before = t.log.cursors.length;
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Enter']) assert.equal(t.key(key, mod).defaultPrevented, false);
  }
  assert.equal(t.input.cursor, null);
  assert.equal(t.log.cursors.length, before);
  assert.equal(t.engine.population, 0);
});

test('ArrowRight on the board moves the cursor and never also steps; elsewhere it still steps', () => {
  const calls = [];
  const actions = { step: () => calls.push('step') };
  const ui = { actions };
  const board = setup();
  const target = { tagName: 'CANVAS', closest: () => null };
  const route = (key) => {
    const event = board.key(key); // the canvas listener runs first and may claim it
    event.target = target;
    UI.prototype.onKeyDown.call(ui, event); // then the page-level listener sees the same event
    return event;
  };
  route('ArrowRight');
  assert.deepEqual(calls, [], 'the board claimed it');
  assert.deepEqual(cursor(board), { x: 13, y: 8 });
  // The same key with focus elsewhere (a plain page, not the board) steps.
  const page = { key: 'ArrowRight', target: { tagName: 'BODY', closest: () => null }, repeat: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, preventDefault() {} };
  UI.prototype.onKeyDown.call(ui, page);
  assert.deepEqual(calls, ['step']);
  // N steps from the board too, because the board does not claim it.
  const n = board.key('n');
  n.target = target;
  UI.prototype.onKeyDown.call(ui, n);
  assert.deepEqual(calls, ['step', 'step']);
});

test('keyboard focus shows the cursor and blur hides it; a mouse press hides it and sets where the keyboard resumes', () => {
  const t = setup({ width: 40, height: 30 });
  t.focus();
  assert.deepEqual(t.log.cursors.at(-1), { x: 20, y: 15 });
  assert.equal(t.input.cursorShown, true);
  t.blur();
  assert.equal(t.log.cursors.at(-1), null);
  t.focus();
  t.down(5, 6);
  t.up(5, 6);
  assert.equal(t.log.cursors.at(-1), null, 'the pointer takes over');
  t.key('ArrowRight');
  assert.deepEqual(cursor(t), { x: 6, y: 6 }, 'moves on from the pressed cell');
});

test('pointer focus (a click) does not show the keyboard cursor', () => {
  const t = setup();
  t.input.canvas.matches = (q) => q !== ':focus-visible';
  t.focus();
  assert.equal(t.input.cursorShown, false);
  assert.equal(t.log.cursors.length, 0);
});

test('keys are ignored while a stroke or pinch owns the board', () => {
  const t = setup();
  t.down(3, 3);
  const before = t.engine.population;
  t.key('ArrowRight');
  t.key('Enter');
  assert.equal(t.engine.population, before);
  assert.equal(t.key('ArrowRight').defaultPrevented, true, 'still claimed, so it cannot step either');
  t.up(3, 3);
});

// --- Placing a pattern from the keyboard -------------------------------------

test('a pattern is placed entirely from the keyboard: ghost at the cursor, arrows, rotate, Enter', () => {
  const t = setup({ width: 40, height: 30 });
  t.engine.set(1, 1, 1);
  const before = Array.from(t.engine.cells);
  t.input.setStamp(getPreset('glider'));
  t.input.stampAtCursor();
  assert.ok(Array.isArray(t.log.ghosts.at(-1)), 'a ghost appears at the cursor without any pointer');
  const first = t.log.ghosts.at(-1).map((c) => c.join()).join(' ');
  t.key('ArrowRight');
  t.key('ArrowDown');
  const moved = t.log.ghosts.at(-1).map((c) => c.join()).join(' ');
  assert.notEqual(moved, first, 'arrows move the ghost');
  t.input.rotateStamp();
  assert.notEqual(t.log.ghosts.at(-1).map((c) => c.join()).join(' '), moved, 'R rotates it in place');
  assert.deepEqual(Array.from(t.engine.cells), before, 'nothing changed yet');
  const ghost = t.log.ghosts.at(-1).map(([x, y]) => `${x},${y}`).sort();
  t.key('Enter');
  const placed = [];
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (t.engine.get(x, y) && !(x === 1 && y === 1)) placed.push(`${x},${y}`);
  assert.deepEqual(placed.sort(), ghost, 'the glider lands exactly where the ghost was');
  assert.equal(t.input.editing, false);
  assert.equal(t.log.ghosts.at(-1), null);
});

test('Escape (via cancelEdit) after keyboard positioning places nothing and leaves no ghost', () => {
  const t = setup();
  t.input.setStamp(getPreset('pulsar'));
  t.input.stampAtCursor();
  t.key('ArrowLeft');
  assert.equal(t.input.cancelEdit(), true);
  assert.equal(t.engine.population, 0);
  assert.equal(t.log.ghosts.at(-1), null);
  assert.equal(t.input.editing, false);
});

test('a keyboard ghost survives the pointer leaving the board, and the pointer takes over when it moves', () => {
  const t = setup();
  t.input.setStamp(getPreset('glider'));
  t.input.stampAtCursor();
  const ghostCount = t.log.ghosts.length;
  assert.equal(t.input.stamp.viaKeyboard, true);
  t.leave();
  assert.ok(t.log.ghosts.at(-1), 'the pointer leaving the board does not remove a keyboard-positioned ghost');
  t.move(3, 3);
  assert.equal(t.input.stamp.viaKeyboard, false, 'the pointer is in charge again');
  assert.ok(t.log.ghosts.length > ghostCount);
});

test('Enter with a pending pattern places it instead of toggling a cell, once', () => {
  const t = setup();
  t.input.setStamp(getPreset('glider'));
  t.input.stampAtCursor();
  const transactions = [];
  t.input.onTransaction = (phase, info) => transactions.push([phase, info?.label]);
  t.key('Enter');
  assert.deepEqual(transactions, [['begin', undefined], ['commit', 'Place Glider']]);
  assert.equal(t.engine.population, 5, 'five glider cells, no extra toggled cell');
});

// --- Scrolling the cursor into view ------------------------------------------

test('revealOffset moves the view only as far as needed and keeps the margin', () => {
  // A 100 px viewport, 10 px cells, 15 px margin.
  assert.equal(revealOffset(0, 5, 10, 100, 15), 0, 'already inside');
  assert.equal(revealOffset(0, 9, 10, 100, 15), -15, 'right edge: end 100 must be at most 85');
  assert.equal(revealOffset(-200, 21, 10, 100, 15), -200 + 5, 'left edge: start 10 must be at least 15');
  assert.equal(revealOffset(0, 1, 10, 100, 15), 5, 'near the left: start 10 pulled to 15');
  assert.equal(revealOffset(0, 20, 10, 100, 15), -125, 'far right: end 210 pulled to 85');
  // A cell bigger than the margins allow is centred.
  assert.equal(revealOffset(0, 3, 90, 100, 15), -265, 'start 270, centred at 5');
});

test('revealOffset leaves every revealed cell fully visible, for any start and zoom', () => {
  for (const cs of [1, 3, 8, 16, 48]) {
    for (const offset of [-5000, -300, 0, 120, 4000]) {
      for (const index of [0, 1, 40, 128, 255]) {
        const view = 600;
        const margin = Math.max(cs, 12);
        const next = revealOffset(offset, index, cs, view, margin);
        const start = next + index * cs;
        assert.ok(start >= margin - 1e-9 && start + cs <= view - margin + 1e-9, `cs ${cs} offset ${offset} index ${index}: ${start}`);
        assert.equal(revealOffset(next, index, cs, view, margin), next, 'idempotent');
      }
    }
  }
});

test('a rotated pattern keeps its name, so the undo step is labelled after it', () => {
  const t = setup({ width: 40, height: 30 });
  const labels = [];
  t.input.onTransaction = (phase, info) => phase === 'commit' && labels.push(info.label);
  t.input.setStamp(getPreset('lwss'));
  t.input.stampAtCursor();
  t.input.rotateStamp();
  assert.equal(t.input.stamp.pattern.name, 'Lightweight spaceship');
  t.key('Enter');
  assert.deepEqual(labels, ['Place Lightweight spaceship']);
});

test('revealCursor keeps a shown cursor in view after the view changes, and does nothing when it is hidden', () => {
  const t = setup({ width: 40, height: 30 });
  t.key('ArrowRight');
  const before = t.log.reveals.length;
  t.input.revealCursor();
  assert.equal(t.log.reveals.length, before + 1);
  assert.deepEqual(t.log.reveals.at(-1), cursor(t));
  t.blur();
  t.input.revealCursor();
  assert.equal(t.log.reveals.length, before + 1, 'hidden cursor: no view change');
  const fresh = setup();
  fresh.input.revealCursor();
  assert.equal(fresh.log.reveals.length, 0, 'no cursor yet: nothing to reveal');
});

test('every view change re-reveals a shown cursor: zoom, Fit and resize all go through the renderer', () => {
  const t = setup({ width: 40, height: 30 });
  t.key('ArrowDown');
  const before = t.log.reveals.length;
  t.viewChanged(); // what zoomBy, fit, fitLive and resize each end with
  t.viewChanged();
  assert.equal(t.log.reveals.length, before + 2);
  assert.deepEqual(t.log.reveals.at(-1), cursor(t));
});

test('a hidden cursor is left alone by view changes, and the wheel hands the view to the pointer', () => {
  const t = setup({ width: 40, height: 30 });
  t.viewChanged();
  assert.equal(t.log.reveals.length, 0, 'no cursor yet');
  t.key('ArrowRight');
  const revealed = t.log.reveals.length;
  t.wheel(-100); // wheel zoom: pointer input takes over, the cursor goes away
  assert.equal(t.input.cursorShown, false);
  assert.equal(t.log.cursors.at(-1), null);
  t.viewChanged(); // the zoom's own view change must not pull the view back to the cursor
  assert.equal(t.log.reveals.length, revealed);
  t.key('ArrowRight');
  assert.ok(t.log.reveals.length > revealed, 'the next arrow key brings the cursor back into view');
  t.blur();
  const after = t.log.reveals.length;
  t.viewChanged();
  assert.equal(t.log.reveals.length, after, 'blurred: not tracked');
});
