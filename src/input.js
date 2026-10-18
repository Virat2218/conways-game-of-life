// Pointer input: painting strokes and pattern stamping on the board.

import { rotate } from './patterns.js';
import { nearestZoomIndex } from './renderer.js';

// One zoom level per 100 normalized pixels of wheel travel: a typical mouse
// notch in every browser, or a short trackpad swipe.
export const WHEEL_STEP = 100;
const LINE_HEIGHT = 33;
const PAGE_HEIGHT = 800;
const WHEEL_IDLE_MS = 250;

// Accumulates wheel deltas and returns whole zoom steps (+ is zoom in).
export function wheelSteps(state, deltaY, deltaMode, time) {
  const scale = deltaMode === 1 ? LINE_HEIGHT : deltaMode === 2 ? PAGE_HEIGHT : 1;
  const delta = -deltaY * scale;
  // Start over after a pause or when the direction flips.
  if (time - state.time > WHEEL_IDLE_MS || Math.sign(delta) !== Math.sign(state.acc)) state.acc = 0;
  state.time = time;
  state.acc += delta;
  const steps = Math.trunc(state.acc / WHEEL_STEP) || 0;
  state.acc -= steps * WHEEL_STEP;
  return steps;
}

// Integer cells on the line from (x0, y0) to (x1, y1), inclusive (Bresenham).
export function line(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export class Input {
  constructor(canvas, renderer, engine) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.engine = engine;
    this.stroke = null;
    // { pattern, pointerId, cell } while a preset is waiting to be placed.
    this.stamp = null;
    this.onStampEnd = null;
    // { pointerId, x, y } while right-, middle- or shift-dragging the view.
    this.pan = null;
    // Active touch points by pointerId -> { x, y }.
    this.touches = new Map();
    // { startDist, startCss, mid } during a two-finger pinch.
    this.pinch = null;
    // After a pinch, ignore the remaining finger until every touch lifts.
    this.touchLocked = false;
    this.wheel = { acc: 0, time: 0 };

    canvas.addEventListener('pointerdown', (e) => this.handleDown(e));
    canvas.addEventListener('pointermove', (e) => this.handleMove(e));
    canvas.addEventListener('pointerup', (e) => this.handleUp(e, false));
    canvas.addEventListener('pointercancel', (e) => this.handleUp(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      this.renderer.setHover(null);
      if (this.stamp && e.pointerType !== 'touch') this.updateGhost(null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // --- Gesture routing -----------------------------------------------------

  handleDown(e) {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.pinch || this.touchLocked) return;
    }
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    if (e.pointerType !== 'touch' && panButton && !this.stroke && !this.pan) {
      e.preventDefault();
      this.pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('panning');
      return;
    }
    this.onPointerDown(e);
  }

  handleMove(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch) {
        this.updatePinch();
        return;
      }
      if (this.touchLocked) return;
    }
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.renderer.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.pan.x = e.clientX;
      this.pan.y = e.clientY;
      return;
    }
    this.onPointerMove(e);
  }

  handleUp(e, cancelled) {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch || this.touchLocked) {
        this.pinch = null;
        this.touchLocked = this.touches.size > 0;
        return;
      }
    }
    if (this.pan && e.pointerId === this.pan.pointerId) {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.pan = null;
      this.canvas.classList.remove('panning');
      return;
    }
    if (cancelled) this.onPointerCancel(e);
    else this.onPointerUp(e);
  }

  // --- Pinch ---------------------------------------------------------------

  touchGeometry() {
    const [a, b] = [...this.touches.values()];
    return {
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  startPinch() {
    // A pinch that begins mid-stroke must not leave a stray line behind.
    if (this.stroke) this.revertStroke();
    if (this.stamp && this.stamp.pointerId !== null) {
      this.stamp.pointerId = null;
      this.updateGhost(null);
    }
    // Capture both fingers (revertStroke released the first) so their moves
    // and lifts reach the canvas even off-board; otherwise a stale touch
    // could leave touchLocked set for good.
    for (const id of this.touches.keys()) {
      try {
        this.canvas.setPointerCapture(id);
      } catch {
        // The pointer already ended; its pointerup will clear it.
      }
    }
    const { dist, mid } = this.touchGeometry();
    this.pinch = { startDist: dist, startCss: this.renderer.cellCss, mid };
  }

  updatePinch() {
    const { dist, mid } = this.touchGeometry();
    const p = this.pinch;
    this.renderer.panBy(mid.x - p.mid.x, mid.y - p.mid.y);
    p.mid = mid;
    const target = nearestZoomIndex(p.startCss * (dist / p.startDist));
    if (target !== this.renderer.zoomIndex) this.renderer.setZoom(target, mid.x, mid.y);
  }

  // --- Wheel ---------------------------------------------------------------

  onWheel(e) {
    e.preventDefault();
    const steps = wheelSteps(this.wheel, e.deltaY, e.deltaMode, e.timeStamp);
    if (steps) this.renderer.zoomBy(steps, e.clientX, e.clientY);
  }

  // --- Stamp mode ----------------------------------------------------------

  setStamp(pattern) {
    if (this.stroke) this.revertStroke();
    this.stamp = pattern ? { pattern, pointerId: null, cell: null } : null;
    this.renderer.setHover(null);
    // The ghost appears once the pointer is over the board.
    this.renderer.setGhost(null);
  }

  rotateStamp() {
    if (!this.stamp) return;
    this.stamp.pattern = rotate(this.stamp.pattern);
    this.updateGhost(this.stamp.cell);
  }

  cancelStamp() {
    if (!this.stamp) return;
    this.endStamp('cancelled');
  }

  endStamp(reason) {
    const { pointerId } = this.stamp;
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
    this.stamp = null;
    this.renderer.setGhost(null);
    this.onStampEnd?.(reason);
  }

  // Top-left cell that centres the stamp on `cell`.
  stampOrigin(cell) {
    const { width, height } = this.stamp.pattern;
    return { x: cell.x - Math.floor(width / 2), y: cell.y - Math.floor(height / 2) };
  }

  updateGhost(cell) {
    if (!this.stamp) return;
    const inside = cell && this.inBounds(cell.x, cell.y);
    this.stamp.cell = inside ? cell : null;
    if (!inside) {
      this.renderer.setGhost(null);
      return;
    }
    const o = this.stampOrigin(cell);
    this.renderer.setGhost(this.stamp.pattern.cells.map(([x, y]) => [x + o.x, y + o.y]));
  }

  placeStamp() {
    const { cell, pattern } = this.stamp;
    if (!cell) {
      this.endStamp('cancelled');
      return;
    }
    const o = this.stampOrigin(cell);
    // Engine.set wraps, so stamps near an edge continue on the opposite side.
    for (const [x, y] of pattern.cells) this.engine.set(x + o.x, y + o.y, 1);
    this.endStamp('placed');
  }

  onStampPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.updateGhost(this.cellAt(e.clientX, e.clientY));
    if (e.pointerType === 'touch') {
      // Touch: drag to position the ghost, release to place.
      this.stamp.pointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
    } else {
      this.placeStamp();
    }
  }

  // --- Painting ------------------------------------------------------------

  // Unclamped integer cell under a client position.
  cellAt(clientX, clientY) {
    const w = this.renderer.clientToWorld(clientX, clientY);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.engine.width && y < this.engine.height;
  }

  onPointerDown(e) {
    if (this.stamp) {
      this.onStampPointerDown(e);
      return;
    }
    if (e.button !== 0 || this.stroke) return;
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.stroke = {
      pointerId: e.pointerId,
      // Starting on a live cell erases; starting on a dead cell draws.
      value: this.engine.get(cell.x, cell.y) ? 0 : 1,
      last: cell,
      // Cells this stroke changed, with their previous value, so it can be reverted.
      changed: new Map(),
    };
    this.paint(cell.x, cell.y);
  }

  onPointerMove(e) {
    if (this.stamp) {
      const dragging = this.stamp.pointerId !== null;
      if (dragging ? e.pointerId === this.stamp.pointerId : e.pointerType !== 'touch') {
        this.updateGhost(this.cellAt(e.clientX, e.clientY));
      }
      return;
    }
    if (e.pointerType !== 'touch') this.updateHover(e);
    const stroke = this.stroke;
    if (!stroke || e.pointerId !== stroke.pointerId) return;
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [e]) {
      const cell = this.cellAt(sample.clientX, sample.clientY);
      if (cell.x === stroke.last.x && cell.y === stroke.last.y) continue;
      for (const [x, y] of line(stroke.last.x, stroke.last.y, cell.x, cell.y)) this.paint(x, y);
      stroke.last = cell;
    }
  }

  onPointerUp(e) {
    if (this.stamp) {
      if (e.pointerId === this.stamp.pointerId) this.placeStamp();
      return;
    }
    this.endStroke(e);
  }

  onPointerCancel(e) {
    if (this.stamp) {
      if (e.pointerId === this.stamp.pointerId) {
        this.stamp.pointerId = null;
        this.updateGhost(null);
      }
      return;
    }
    this.endStroke(e);
  }

  endStroke(e) {
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.stroke = null;
  }

  paint(x, y) {
    if (!this.inBounds(x, y)) return;
    const { changed, value } = this.stroke;
    const key = y * this.engine.width + x;
    // Each cell changes at most once per stroke.
    if (changed.has(key)) return;
    const prev = this.engine.get(x, y);
    if (this.engine.set(x, y, value)) changed.set(key, prev);
  }

  // Undo every cell the current stroke changed and end it.
  revertStroke() {
    const stroke = this.stroke;
    if (!stroke) return;
    const w = this.engine.width;
    for (const [key, prev] of stroke.changed) this.engine.set(key % w, Math.floor(key / w), prev);
    if (this.canvas.hasPointerCapture(stroke.pointerId)) {
      this.canvas.releasePointerCapture(stroke.pointerId);
    }
    this.stroke = null;
  }

  updateHover(e) {
    this.renderer.setHover(this.renderer.screenToCell(e.clientX, e.clientY));
  }
}
