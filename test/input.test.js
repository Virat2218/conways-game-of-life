import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line, wheelSteps } from '../src/input.js';

test('line: single point', () => {
  assert.deepEqual(line(3, 4, 3, 4), [[3, 4]]);
});

test('line: horizontal in both directions', () => {
  assert.deepEqual(line(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(line(3, 0, 0, 0), [[3, 0], [2, 0], [1, 0], [0, 0]]);
});

test('line: vertical', () => {
  assert.deepEqual(line(2, 5, 2, 2), [[2, 5], [2, 4], [2, 3], [2, 2]]);
});

test('line: diagonal', () => {
  assert.deepEqual(line(0, 0, 3, 3), [[0, 0], [1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(line(3, 0, 0, 3), [[3, 0], [2, 1], [1, 2], [0, 3]]);
});

test('line: steep and shallow lines are gap-free and hit both ends', () => {
  for (const [x0, y0, x1, y1] of [[0, 0, 2, 9], [0, 0, 9, 2], [5, 5, -4, 1], [-3, 7, 4, -6]]) {
    const pts = line(x0, y0, x1, y1);
    assert.deepEqual(pts[0], [x0, y0]);
    assert.deepEqual(pts.at(-1), [x1, y1]);
    assert.equal(pts.length, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      assert.ok(Math.abs(bx - ax) <= 1 && Math.abs(by - ay) <= 1, 'consecutive points touch');
    }
  }
});

test('wheelSteps: one zoom step per mouse notch across delta modes', () => {
  const s = { acc: 0, time: 0 };
  assert.equal(wheelSteps(s, 100, 0, 1000), -1, 'Chrome pixel notch zooms out');
  assert.equal(wheelSteps(s, -100, 0, 2000), 1, 'reverse notch zooms in');
  assert.equal(wheelSteps(s, -3, 1, 3000), 0, 'Firefox 3-line notch is just under one step…');
  assert.equal(wheelSteps(s, -3, 1, 3010), 1, '…and the accumulator carries the rest');
});

test('wheelSteps: trackpad deltas accumulate and reset on pause or reversal', () => {
  const s = { acc: 0, time: 0 };
  let steps = 0;
  for (let i = 0; i < 10; i++) steps += wheelSteps(s, -12, 0, 100 + i * 16);
  assert.equal(steps, 1, '120px of small deltas is one step');
  assert.equal(wheelSteps(s, -90, 0, 1000), 0, 'pause discards the remainder');
  assert.equal(wheelSteps(s, 40, 0, 1010), 0, 'direction flip discards the remainder');
  assert.equal(wheelSteps(s, 70, 0, 1020), -1);
});
