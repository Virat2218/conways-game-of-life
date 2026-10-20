import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import {
  Renderer,
  ZOOM_LEVELS,
  deviceCellSize,
  visibleRange,
  fitZoomIndex,
  clampZoomIndex,
  nearestZoomIndex,
  rescaleOffset,
  liveBounds,
  fitMargin,
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

test('nearestZoomIndex snaps continuous sizes to the closest level', () => {
  assert.equal(ZOOM_LEVELS[nearestZoomIndex(8)], 8);
  assert.equal(ZOOM_LEVELS[nearestZoomIndex(8.9)], 8);
  assert.equal(ZOOM_LEVELS[nearestZoomIndex(9.2)], 10);
  assert.equal(ZOOM_LEVELS[nearestZoomIndex(0.2)], 1);
  assert.equal(ZOOM_LEVELS[nearestZoomIndex(500)], 48);
});

test('fitZoomIndex compares the snapped device-pixel board at fractional DPRs', () => {
  // 1280×800 CSS @1.5x: 5 CSS px snaps to 8 device px (2048 > 1920), so 4 must win.
  assert.equal(ZOOM_LEVELS[fitZoomIndex(1920, 1200, 256, 160, 1.5)], 4);
  for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
    for (const [cssW, cssH] of [[1280, 800], [390, 844], [1920, 1080], [360, 640]]) {
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      const i = fitZoomIndex(w, h, 256, 160, dpr);
      const cs = deviceCellSize(ZOOM_LEVELS[i], dpr);
      if (i > 0) assert.ok(256 * cs <= w && 160 * cs <= h, `${cssW}×${cssH}@${dpr} fits`);
      if (i < ZOOM_LEVELS.length - 1) {
        const next = deviceCellSize(ZOOM_LEVELS[i + 1], dpr);
        assert.ok(256 * next > w || 160 * next > h, `${cssW}×${cssH}@${dpr} is the largest fit`);
      }
    }
  }
});

test('rescaleOffset keeps the centred world point fixed when snapping is non-linear', () => {
  // Zoom 3 CSS px: 4 device px @1.25x, 5 device px @1.5x (ratio 1.25, not 1.2).
  const cssW = 1000;
  const oldCs = deviceCellSize(3, 1.25);
  const newCs = deviceCellSize(3, 1.5);
  const centred = (cssW * 1.25 - 256 * oldCs) / 2;
  const next = rescaleOffset(centred, cssW, 1.25, 1.5, oldCs, newCs);
  const boardCentreCss = (next + 128 * newCs) / 1.5;
  assert.ok(Math.abs(boardCentreCss - cssW / 2) < 1e-9, `board centre at ${boardCentreCss}`);
  // Naive scaling drifts by ~17 CSS px.
  const naive = ((centred * 1.2) + 128 * newCs) / 1.5;
  assert.ok(Math.abs(naive - cssW / 2) > 10);
});

// --- Fitting the live cells ------------------------------------------------

function boardWith(width, height, live) {
  const cells = new Uint8Array(width * height);
  for (const [x, y] of live) cells[y * width + x] = 1;
  return cells;
}

test('liveBounds is the inclusive box of the live cells, or null for an empty board', () => {
  assert.equal(liveBounds(new Uint8Array(20 * 10), 20, 10), null);
  assert.deepEqual(liveBounds(boardWith(20, 10, [[7, 4]]), 20, 10), { minX: 7, minY: 4, maxX: 7, maxY: 4 });
  assert.deepEqual(liveBounds(boardWith(20, 10, [[3, 8], [12, 2], [9, 5]]), 20, 10), { minX: 3, minY: 2, maxX: 12, maxY: 8 });
});

test('liveBounds uses board coordinates: a shape split across an edge spans the whole width', () => {
  const split = boardWith(32, 16, [[31, 5], [0, 5], [1, 6]]);
  assert.deepEqual(liveBounds(split, 32, 16), { minX: 0, minY: 5, maxX: 31, maxY: 6 });
});

test('fitMargin is two cells for small shapes and grows slowly for big ones', () => {
  assert.equal(fitMargin({ minX: 5, minY: 5, maxX: 5, maxY: 5 }), 2);
  assert.equal(fitMargin({ minX: 0, minY: 0, maxX: 35, maxY: 8 }), 2);
  assert.equal(fitMargin({ minX: 0, minY: 0, maxX: 255, maxY: 159 }), 13);
});

// --- Renderer.fitLive on a real engine, without a DOM ----------------------

function viewOf(engine, { canvasW = 1020, canvasH = 640, dpr = 1, zoomIndex = 6 } = {}) {
  const view = Object.create(Renderer.prototype);
  Object.assign(view, {
    engine,
    canvas: { width: canvasW, height: canvasH },
    dpr,
    zoomIndex,
    offsetX: 0,
    offsetY: 0,
    changes: 0,
    viewChanged() {
      this.changes++;
    },
  });
  return view;
}

// Device-pixel position of the centre of the box of cells, in the canvas.
const centreOf = (view, minX, minY, maxX, maxY) => ({
  x: Math.round(view.offsetX) + ((minX + maxX + 1) / 2) * view.cellSize,
  y: Math.round(view.offsetY) + ((minY + maxY + 1) / 2) * view.cellSize,
});

test('fitLive picks the largest level that shows the box and margin, at every DPR and viewport', () => {
  const shapes = {
    'a single cell': [[100, 70]],
    'a glider': [[100, 70], [101, 71], [99, 72], [100, 72], [101, 72]],
    'a wide bar': Array.from({ length: 36 }, (_, i) => [90 + i, 70]),
    'the whole board': [[0, 0], [255, 159]],
    'a near-full board': [[2, 0], [250, 150]],
  };
  for (const dpr of [1, 1.25, 1.5, 2, 2.625]) {
    for (const [cssW, cssH] of [[1020, 640], [740, 520], [328, 300], [1400, 800]]) {
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      for (const [name, live] of Object.entries(shapes)) {
        const engine = new Engine(256, 160);
        for (const [x, y] of live) engine.set(x, y, 1);
        const box = liveBounds(engine.cells, 256, 160);
        const margin = fitMargin(box);
        const spanX = box.maxX - box.minX + 1 + 2 * margin;
        const spanY = box.maxY - box.minY + 1 + 2 * margin;
        const view = viewOf(engine, { canvasW: w, canvasH: h, dpr });
        const { fitted } = view.fitLive();
        const label = `${name} in ${cssW}x${cssH}@${dpr}`;
        assert.equal(fitted, spanX * view.cellSize <= w && spanY * view.cellSize <= h, `${label}: the verdict is truthful`);
        if (view.zoomIndex < ZOOM_LEVELS.length - 1) {
          const next = deviceCellSize(ZOOM_LEVELS[view.zoomIndex + 1], dpr);
          assert.ok(spanX * next > w || spanY * next > h, `${label}: one level closer would not fit`);
        }
      }
    }
  }
});

test('fitLive on an empty board shows the whole board, centred', () => {
  const engine = new Engine(256, 160);
  const view = viewOf(engine);
  assert.deepEqual(view.fitLive(), { empty: true, fitted: true });
  assert.equal(ZOOM_LEVELS[view.zoomIndex], 3, '256×160 fits 1020×640 at 3 px/cell with the 4 px level too big');
  const c = centreOf(view, 0, 0, 255, 159);
  assert.ok(Math.abs(c.x - 510) <= 1 && Math.abs(c.y - 320) <= 1);
});

test('fitLive centres a single cell and zooms to the maximum', () => {
  const engine = new Engine(256, 160);
  engine.set(40, 30, 1);
  const view = viewOf(engine);
  assert.deepEqual(view.fitLive(), { empty: false, fitted: true });
  assert.equal(ZOOM_LEVELS[view.zoomIndex], 48);
  const c = centreOf(view, 40, 30, 40, 30);
  assert.ok(Math.abs(c.x - 510) <= 1 && Math.abs(c.y - 320) <= 1, `centred at ${c.x},${c.y}`);
});

test('fitLive frames a pattern with its margin fully visible and centred', () => {
  const engine = new Engine(256, 160);
  for (let x = 100; x < 136; x++) engine.set(x, 60, 1); // a 36-wide bar
  engine.set(105, 68, 1);
  const view = viewOf(engine);
  const { fitted } = view.fitLive();
  assert.equal(fitted, true);
  const cs = view.cellSize;
  const left = Math.round(view.offsetX) + (100 - 2) * cs;
  const right = Math.round(view.offsetX) + (136 + 2) * cs;
  const top = Math.round(view.offsetY) + (60 - 2) * cs;
  const bottom = Math.round(view.offsetY) + (69 + 2) * cs;
  assert.ok(left >= 0 && right <= 1020 && top >= 0 && bottom <= 640, 'cells and margin are inside the canvas');
  const c = centreOf(view, 100, 60, 135, 68);
  assert.ok(Math.abs(c.x - 510) <= 1 && Math.abs(c.y - 320) <= 1);
});

test('fitLive treats cells either side of a wrap edge as spanning the board', () => {
  const engine = new Engine(256, 160);
  engine.set(255, 80, 1);
  engine.set(0, 80, 1);
  const view = viewOf(engine);
  view.fitLive();
  const cs = view.cellSize;
  assert.ok(256 * cs <= 1020, 'the whole width is on screen');
  assert.ok(ZOOM_LEVELS[view.zoomIndex] <= 3);
});

test('fitLive stays crisp: whole device-pixel cells and offsets at fractional DPRs', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 2.625]) {
    const engine = new Engine(256, 160);
    for (const [x, y] of [[120, 70], [121, 71], [122, 70]]) engine.set(x, y, 1);
    const view = viewOf(engine, { canvasW: Math.round(1020 * dpr), canvasH: Math.round(640 * dpr), dpr });
    view.fitLive();
    assert.ok(Number.isInteger(view.cellSize), `cell size at ${dpr}x`);
    assert.ok(Number.isInteger(view.offsetX) && Number.isInteger(view.offsetY), `offsets at ${dpr}x`);
  }
});

test('fitLive is honest when the viewport is too small, and clips around the centre', () => {
  const engine = new Engine(256, 160);
  engine.set(0, 0, 1);
  engine.set(255, 159, 1);
  const view = viewOf(engine, { canvasW: 200, canvasH: 120 });
  const result = view.fitLive();
  assert.equal(result.fitted, false);
  assert.equal(view.zoomIndex, 0, 'as far out as it goes');
});

test('changing the view never touches the cells, generation or playback state', () => {
  const engine = new Engine(256, 160);
  for (const [x, y] of [[10, 10], [200, 120]]) engine.set(x, y, 1);
  engine.generation = 33;
  const before = { cells: Array.from(engine.cells), generation: 33, population: 2, version: engine.version };
  const view = viewOf(engine);
  view.fitLive();
  view.fit();
  assert.deepEqual({ cells: Array.from(engine.cells), generation: engine.generation, population: engine.population, version: engine.version }, before);
});

test('zoom limits and the rendered cell size follow the level and DPR', () => {
  const engine = new Engine(256, 160);
  const view = viewOf(engine, { zoomIndex: 0 });
  assert.equal(view.canZoomOut, false);
  assert.equal(view.canZoomIn, true);
  view.zoomIndex = ZOOM_LEVELS.length - 1;
  assert.equal(view.canZoomIn, false);
  assert.equal(view.canZoomOut, true);
  view.zoomIndex = ZOOM_LEVELS.indexOf(8);
  assert.equal(view.renderedCellCss, 8);
  view.dpr = 1.5;
  assert.equal(view.cellSize, 12);
  assert.equal(view.renderedCellCss, 8);
  view.zoomIndex = ZOOM_LEVELS.indexOf(3);
  assert.equal(view.cellSize, 5, '4.5 device px snaps to 5');
  assert.ok(Math.abs(view.renderedCellCss - 3.333) < 0.01, 'and the readout reports the real size');
});
