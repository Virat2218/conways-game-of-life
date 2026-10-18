import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line } from '../src/input.js';

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
