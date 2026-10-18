import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_LEVELS,
  deviceCellSize,
  visibleRange,
  fitZoomIndex,
  clampZoomIndex,
} from '../src/renderer.js';

test('zoom levels match the spec', () => {
  assert.deepEqual(ZOOM_LEVELS, [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48]);
});

test('device cell size is always a whole number of device pixels', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
    for (const z of ZOOM_LEVELS) {
      const size = deviceCellSize(z, dpr);
      assert.ok(Number.isInteger(size), `${z}css @ ${dpr}x gave ${size}`);
      assert.ok(size >= 1);
    }
  }
  assert.equal(deviceCellSize(1, 1.5), 2);
  assert.equal(deviceCellSize(8, 2), 16);
});

test('visibleRange clips to the viewport and the grid', () => {
  assert.deepEqual(visibleRange(0, 10, 100, 256), [0, 10]);
  assert.deepEqual(visibleRange(-25, 10, 100, 256), [2, 13]);
  assert.deepEqual(visibleRange(50, 10, 100, 3), [0, 3]);
  assert.deepEqual(visibleRange(-5000, 10, 100, 256), [0, 0]);
  assert.deepEqual(visibleRange(200, 10, 100, 256), [0, 0]);
});

test('fitZoomIndex picks the largest level that fits', () => {
  assert.equal(ZOOM_LEVELS[fitZoomIndex(1280, 800, 256, 160)], 5);
  assert.equal(ZOOM_LEVELS[fitZoomIndex(360, 640, 256, 160)], 1);
  assert.equal(fitZoomIndex(100, 100, 256, 160), 0, 'falls back to the smallest level');
});

test('clampZoomIndex keeps indexes in range', () => {
  assert.equal(clampZoomIndex(-3), 0);
  assert.equal(clampZoomIndex(99), ZOOM_LEVELS.length - 1);
  assert.equal(clampZoomIndex(4), 4);
});
