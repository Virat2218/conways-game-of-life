// Pointer input: painting strokes on the board.

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

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => this.renderer.setHover(null));
  }

  // Unclamped integer cell under a client position.
  cellAt(clientX, clientY) {
    const w = this.renderer.clientToWorld(clientX, clientY);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.engine.width && y < this.engine.height;
  }

  onPointerDown(e) {
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
