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

export const TOOLS = ['draw', 'erase', 'pan'];

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// Shift+arrow moves the keyboard cursor this many cells at once.
export const BIG_STEP = 10;

export class Input {
  constructor(canvas, renderer, engine) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.engine = engine;
    // Draw always adds cells, Erase always removes them, Pan only moves the view.
    this.tool = 'draw';
    this.onToolChange = null;
    this.stroke = null;
    // { pattern, pointerId, cell } while a preset is waiting to be placed.
    this.stamp = null;
    this.onStampEnd = null;
    // Called before the first change of a stroke and before a pattern is
    // armed, so the owner can pause the simulation first.
    this.onEditStart = null;
    // onTransaction('begin' | 'commit' | 'abort', { label }) brackets each stroke
    // and pattern placement so the owner can record it as one undo step.
    this.onTransaction = null;
    // { pointerId, x, y } while right-, middle- or shift-dragging the view.
    this.pan = null;
    // Active touch points by pointerId -> { x, y }.
    this.touches = new Map();
    // { startDist, startCss, mid } during a two-finger pinch.
    this.pinch = null;
    // After a pinch, ignore the remaining finger until every touch lifts.
    this.touchLocked = false;
    this.wheel = { acc: 0, time: 0 };
    // Logical cell {x, y} the keyboard acts on. It is drawn only while the
    // board has keyboard focus (cursorShown), and always stays on the board.
    this.cursor = null;
    this.cursorShown = false;
    // onCursor(cell) after the cursor moves; onCellToggle(cell, alive) after Enter toggles one.
    this.onCursor = null;
    this.onCellToggle = null;

    canvas.addEventListener('pointerdown', (e) => this.handleDown(e));
    canvas.addEventListener('pointermove', (e) => this.handleMove(e));
    canvas.addEventListener('pointerup', (e) => this.handleUp(e, false));
    canvas.addEventListener('pointercancel', (e) => this.handleUp(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      this.renderer.setHover(null);
      if (this.stamp && e.pointerType !== 'touch' && !this.stamp.viaKeyboard) this.updateGhost(null);
    });
    canvas.addEventListener('keydown', (e) => this.handleKey(e));
    canvas.addEventListener('focus', () => this.handleFocus());
    canvas.addEventListener('blur', () => this.hideCursor());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // True while a stroke is being drawn or a pattern is waiting to be placed.
  get editing() {
    return this.stroke !== null || this.stamp !== null;
  }

  // Choosing a tool abandons any edit in progress. Placing a pattern is a
  // temporary mode on top of the tool, so the tool is untouched while it lasts
  // and is simply back in force when placement ends.
  setTool(tool) {
    if (!TOOLS.includes(tool) || tool === this.tool) return;
    this.cancelEdit();
    this.endPan();
    this.tool = tool;
    this.renderer.setHover(null);
    this.onToolChange?.(tool);
  }

  // Escape: abandon the stroke or pattern in progress. Returns false when there
  // was nothing to cancel.
  cancelEdit() {
    if (this.stamp) {
      this.cancelStamp();
      return true;
    }
    if (this.stroke) {
      this.revertStroke();
      return true;
    }
    return false;
  }

  // --- Keyboard ------------------------------------------------------------

  // Arrows move the cursor (or the pattern being placed) and Enter toggles the
  // cell or places the pattern. Returns whether the key was handled; a handled
  // key has its default prevented, which keeps the page-level shortcuts from
  // also acting on it (ArrowRight must not step the simulation as well).
  handleKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const arrow = ARROWS[e.key];
    if (!arrow && e.key !== 'Enter') return false;
    e.preventDefault();
    // A pointer gesture owns the board until it ends.
    if (this.stroke || this.pan || this.pinch) return true;
    if (arrow) {
      const n = e.shiftKey ? BIG_STEP : 1;
      this.moveCursor(arrow[0] * n, arrow[1] * n);
    } else if (!e.repeat) {
      this.activateCursor();
    }
    return true;
  }

  handleFocus() {
    // Pointer focus (a click) keeps the mouse outline; only keyboard focus shows the cursor.
    if (this.canvas.matches && !this.canvas.matches(':focus-visible')) return;
    this.showCursor();
    this.onCursor?.(this.cursor);
  }

  showCursor() {
    if (!this.cursor) this.cursor = this.renderer.centerCell();
    this.cursorShown = true;
    this.renderer.setCursor(this.cursor);
    this.renderer.revealCell(this.cursor.x, this.cursor.y);
  }

  hideCursor() {
    this.cursorShown = false;
    this.renderer.setCursor(null);
  }

  moveCursor(dx, dy) {
    if (!this.cursor) this.cursor = this.renderer.centerCell();
    this.cursor = {
      x: Math.min(this.engine.width - 1, Math.max(0, this.cursor.x + dx)),
      y: Math.min(this.engine.height - 1, Math.max(0, this.cursor.y + dy)),
    };
    this.showCursor();
    if (this.stamp) {
      this.stamp.viaKeyboard = true;
      this.updateGhost(this.cursor);
    }
    this.onCursor?.(this.cursor);
  }

  // Enter: place the pending pattern, or toggle the cell under the cursor.
  // Like a stroke, a toggle pauses the simulation first and is one undo step.
  activateCursor() {
    if (this.stamp) {
      if (!this.stamp.cell && this.cursor) this.updateGhost(this.cursor);
      this.placeStamp();
      return;
    }
    if (!this.cursor) this.cursor = this.renderer.centerCell();
    this.showCursor();
    const { x, y } = this.cursor;
    const alive = this.engine.get(x, y) ? 0 : 1;
    this.onEditStart?.();
    this.onTransaction?.('begin');
    this.engine.set(x, y, alive);
    this.onTransaction?.('commit', { label: alive ? 'Add cell' : 'Remove cell' });
    this.onCellToggle?.(this.cursor, alive);
  }

  // Arms a pattern with its ghost at the keyboard cursor.
  stampAtCursor() {
    if (!this.stamp) return;
    if (!this.cursor) this.cursor = this.renderer.centerCell();
    this.stamp.viaKeyboard = true;
    this.updateGhost(this.cursor);
    this.renderer.revealCell(this.cursor.x, this.cursor.y);
  }

  // --- Gesture routing -----------------------------------------------------

  handleDown(e) {
    // The next keyboard use starts from where the pointer last pressed.
    const pressed = this.renderer.screenToCell(e.clientX, e.clientY);
    if (pressed) this.cursor = pressed;
    if (this.cursorShown) this.hideCursor();
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.pinch || this.touchLocked) return;
    }
    // Right, middle and Shift-drag pan with any tool; the Pan tool pans on a
    // plain drag (any pointer, a single finger included) unless a pattern is
    // waiting to be placed.
    const shortcutPan = e.pointerType !== 'touch' && (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey));
    const toolPan = this.tool === 'pan' && e.button === 0 && !this.stamp;
    if ((shortcutPan || toolPan) && !this.stroke && !this.pan) {
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
      this.endPan();
      return;
    }
    if (cancelled) this.onPointerCancel(e);
    else this.onPointerUp(e);
  }

  endPan() {
    if (!this.pan) return;
    if (this.canvas.hasPointerCapture(this.pan.pointerId)) {
      this.canvas.releasePointerCapture(this.pan.pointerId);
    }
    this.pan = null;
    this.canvas.classList.remove('panning');
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
    // A pinch that begins mid-stroke must not leave a stray line behind, and
    // it takes over from a one-finger pan.
    if (this.stroke) this.revertStroke();
    this.endPan();
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
    if (pattern) this.onEditStart?.();
    this.stamp = pattern ? { pattern, pointerId: null, cell: null, viaKeyboard: false } : null;
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
    this.onTransaction?.('begin');
    // Engine.set wraps, so stamps near an edge continue on the opposite side.
    for (const [x, y] of pattern.cells) this.engine.set(x + o.x, y + o.y, 1);
    this.onTransaction?.('commit', { label: `Place ${pattern.name}` });
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
    if (e.button !== 0 || this.stroke || this.tool === 'pan') return;
    const cell = this.renderer.screenToCell(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    this.onEditStart?.();
    this.onTransaction?.('begin');
    this.canvas.setPointerCapture(e.pointerId);
    this.stroke = {
      label: this.tool === 'erase' ? 'Erase' : 'Draw',
      pointerId: e.pointerId,
      value: this.tool === 'erase' ? 0 : 1,
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
        this.stamp.viaKeyboard = false;
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
    const { label } = this.stroke;
    this.stroke = null;
    this.onTransaction?.('commit', { label });
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
    this.onTransaction?.('abort');
  }

  updateHover(e) {
    // Panning changes no cells, so there is nothing to point at.
    this.renderer.setHover(this.tool === 'pan' ? null : this.renderer.screenToCell(e.clientX, e.clientY));
  }
}
