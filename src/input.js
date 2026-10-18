// Pointer input: painting strokes and pattern stamping on the board.

import { rotate } from './patterns.js';

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

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    canvas.addEventListener('pointerleave', (e) => {
      this.renderer.setHover(null);
      if (this.stamp && e.pointerType !== 'touch') this.updateGhost(null);
    });
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
