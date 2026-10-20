import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, HISTORY_LIMIT } from '../src/history.js';

const entry = (n) => ({ label: `edit ${n}`, before: `b${n}`, after: `a${n}` });

test('an empty history has nothing to undo or redo', () => {
  const h = new History();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
  assert.equal(h.undoLabel, null);
});

test('undo walks back through entries and redo walks forward again', () => {
  const h = new History();
  h.push(entry(1));
  h.push(entry(2));
  assert.equal(h.undoLabel, 'edit 2');
  assert.equal(h.undo().before, 'b2');
  assert.equal(h.redoLabel, 'edit 2');
  assert.equal(h.undo().before, 'b1');
  assert.equal(h.canUndo, false);
  assert.equal(h.redo().after, 'a1');
  assert.equal(h.redo().after, 'a2');
  assert.equal(h.canRedo, false);
});

test('a new edit after an undo discards the redo chain', () => {
  const h = new History();
  h.push(entry(1));
  h.push(entry(2));
  h.undo();
  assert.equal(h.canRedo, true);
  h.push(entry(3));
  assert.equal(h.canRedo, false, 'edit 2 can no longer be redone');
  assert.equal(h.undo().label, 'edit 3');
  assert.equal(h.undo().label, 'edit 1');
  assert.equal(h.undo(), null);
});

test('history is bounded: the oldest entries fall off', () => {
  assert.equal(HISTORY_LIMIT, 50);
  const h = new History();
  for (let n = 1; n <= 80; n++) h.push(entry(n));
  assert.equal(h.entries.length, 50);
  let undone = 0;
  let last = null;
  while (h.canUndo) {
    last = h.undo();
    undone++;
  }
  assert.equal(undone, 50);
  assert.equal(last.label, 'edit 31', 'edit 30 and everything before it were dropped');
  assert.equal(h.cursor, 0);
});

test('the limit also applies when pushing after undos', () => {
  const h = new History(3);
  for (let n = 1; n <= 3; n++) h.push(entry(n));
  h.undo();
  h.push(entry(4));
  assert.deepEqual(h.entries.map((e) => e.label), ['edit 1', 'edit 2', 'edit 4']);
  h.push(entry(5));
  assert.deepEqual(h.entries.map((e) => e.label), ['edit 2', 'edit 4', 'edit 5']);
  assert.equal(h.cursor, 3);
});

test('clear forgets everything', () => {
  const h = new History();
  h.push(entry(1));
  h.clear();
  assert.equal(h.canUndo, false);
  assert.equal(h.entries.length, 0);
});
