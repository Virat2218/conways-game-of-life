// Canvas renderer. Every size and offset is snapped to whole device pixels so
// cells and gridlines stay crisp at any devicePixelRatio.

export const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48];

const MINOR_GRID_MIN_CSS = 5;
const MAJOR_GRID_MIN_CSS = 2;
const MAJOR_GRID_EVERY = 10;

// Fallback palette, identical to the light theme in styles.css (a test keeps
// them in step). The page normally overrides it from CSS custom properties.
export const DEFAULT_COLORS = {
  background: '#e8eee8',
  board: '#fbfdfa',
  cell: '#166534',
  gridMinor: 'rgba(22, 101, 52, 0.09)',
  gridMajor: 'rgba(22, 101, 52, 0.2)',
  hover: '#176b2e',
  ghost: 'rgba(23, 107, 46, 0.5)',
  cursor: '#161a17',
  cursorHalo: '#ffffff',
};

// --- Pure geometry helpers (unit-tested) -----------------------------------

export function deviceCellSize(cellCss, dpr) {
  return Math.max(1, Math.round(cellCss * dpr));
}

// Inclusive-exclusive range of cells along one axis that intersect the viewport.
export function visibleRange(offset, cellSize, viewportSize, cellCount) {
  const start = Math.max(0, Math.floor(-offset / cellSize));
  const end = Math.min(cellCount, Math.ceil((viewportSize - offset) / cellSize));
  return end > start ? [start, end] : [0, 0];
}

// Largest zoom level at which the whole grid fits in the viewport. Sizes are
// in device pixels and compared at the snapped cell size actually rendered.
export function fitZoomIndex(viewportWidth, viewportHeight, gridWidth, gridHeight, dpr = 1) {
  let best = 0;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const cs = deviceCellSize(ZOOM_LEVELS[i], dpr);
    if (gridWidth * cs <= viewportWidth && gridHeight * cs <= viewportHeight) best = i;
  }
  return best;
}

// New offset that brings a cell fully inside the viewport with `margin` to spare,
// moving as little as possible. A cell too big to leave the margin is centred.
// Sizes and offsets are in device pixels.
export function revealOffset(offset, index, cellSize, viewport, margin) {
  const start = offset + index * cellSize;
  const end = start + cellSize;
  if (cellSize + 2 * margin > viewport) return offset + (viewport - cellSize) / 2 - start;
  if (start < margin) return offset + (margin - start);
  if (end > viewport - margin) return offset - (end - (viewport - margin));
  return offset;
}

// Inclusive bounding box of the live cells in board coordinates, or null when
// the board is empty. Cells that wrap across an edge are not joined: a glider
// split over the left and right edges spans the whole width.
export function liveBounds(cells, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!cells[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

// Empty cells kept around the live cells when fitting them: two, or 5% of the
// longer side for big shapes.
export function fitMargin({ minX, minY, maxX, maxY }) {
  return Math.max(2, Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.05));
}

// Zoom level closest to a continuous cell size, compared on a log scale.
export function nearestZoomIndex(cellCss) {
  let best = 0;
  let bestDist = Infinity;
  const target = Math.log(Math.max(cellCss, 1e-6));
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const d = Math.abs(Math.log(ZOOM_LEVELS[i]) - target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// New device-pixel offset that keeps the world point at the viewport centre
// fixed across a DPR change. Snapped cell sizes don't scale linearly with
// DPR, so scaling the offset alone would drift.
export function rescaleOffset(offset, viewportCss, oldDpr, newDpr, oldCellSize, newCellSize) {
  const anchor = ((viewportCss * oldDpr) / 2 - offset) / oldCellSize;
  return (viewportCss * newDpr) / 2 - anchor * newCellSize;
}

export function clampZoomIndex(index) {
  return Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Math.round(index)));
}

// --- Renderer --------------------------------------------------------------

export class Renderer {
  constructor(canvas, engine, colors = DEFAULT_COLORS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.colors = { ...DEFAULT_COLORS, ...colors };

    this.dpr = window.devicePixelRatio || 1;
    this.zoomIndex = ZOOM_LEVELS.indexOf(8);
    // Device-pixel position of cell (0, 0). Kept fractional; rounded once per frame.
    this.offsetX = 0;
    this.offsetY = 0;

    this.hover = null;
    this.ghost = null;
    this.cursor = null;

    this.layer = document.createElement('canvas');
    this.layer.width = engine.width;
    this.layer.height = engine.height;
    this.layerCtx = this.layer.getContext('2d');
    this.image = this.layerCtx.createImageData(engine.width, engine.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.cellRGBA = 0;

    this.layerVersion = -1;
    this.dirty = true;
    this.listeners = new Set();

    this.updateCellColor();
    this.observeSize();
    this.observeDpr();
  }

  get cellCss() {
    return ZOOM_LEVELS[this.zoomIndex];
  }

  get cellSize() {
    return deviceCellSize(this.cellCss, this.dpr);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  invalidate() {
    this.dirty = true;
  }

  viewChanged() {
    this.dirty = true;
    for (const fn of this.listeners) fn();
  }

  setColors(colors) {
    this.colors = { ...this.colors, ...colors };
    this.updateCellColor();
    this.layerVersion = -1;
    this.dirty = true;
  }

  setHover(cell) {
    const same = cell && this.hover && cell.x === this.hover.x && cell.y === this.hover.y;
    if (same || (!cell && !this.hover)) return;
    this.hover = cell;
    this.dirty = true;
  }

  // The keyboard cursor: a cell, or null when the board does not have keyboard focus.
  setCursor(cell) {
    const same = cell && this.cursor && cell.x === this.cursor.x && cell.y === this.cursor.y;
    if (same || (!cell && !this.cursor)) return;
    this.cursor = cell;
    this.dirty = true;
  }

  // Pans just enough to show a cell with a little room around it.
  revealCell(x, y) {
    const cs = this.cellSize;
    const margin = Math.max(cs, Math.round(12 * this.dpr));
    // Whole device pixels only: a half-pixel target (a cell larger than the view is
    // centred) would never compare equal to the rounded offset and would keep
    // announcing view changes, and the view change itself calls back into here.
    const ox = Math.round(revealOffset(Math.round(this.offsetX), x, cs, this.canvas.width, margin));
    const oy = Math.round(revealOffset(Math.round(this.offsetY), y, cs, this.canvas.height, margin));
    if (ox === Math.round(this.offsetX) && oy === Math.round(this.offsetY)) return;
    this.offsetX = ox;
    this.offsetY = oy;
    this.viewChanged();
  }

  // The cell at the middle of the view, kept on the board.
  centerCell() {
    const cs = this.cellSize;
    const x = Math.floor((this.canvas.width / 2 - Math.round(this.offsetX)) / cs);
    const y = Math.floor((this.canvas.height / 2 - Math.round(this.offsetY)) / cs);
    return {
      x: Math.min(this.engine.width - 1, Math.max(0, x)),
      y: Math.min(this.engine.height - 1, Math.max(0, y)),
    };
  }

  setGhost(cells) {
    this.ghost = cells;
    this.dirty = true;
  }

  // --- Sizing --------------------------------------------------------------

  observeSize() {
    const ro = new ResizeObserver((entries) => {
      // A DPR change also resizes the device-pixel box; pick up the new ratio
      // first so the size below is interpreted at the right scale.
      this.syncDpr();
      const entry = entries[0];
      const box = entry.devicePixelContentBoxSize?.[0];
      const estW = entry.contentRect.width * this.dpr;
      const estH = entry.contentRect.height * this.dpr;
      // Prefer the exact device-pixel box, but only when it agrees with the
      // estimate (emulated DPRs can report an unscaled box).
      const exact = box && Math.abs(box.inlineSize - estW) < 1 && Math.abs(box.blockSize - estH) < 1;
      this.resize(exact ? box.inlineSize : Math.round(estW), exact ? box.blockSize : Math.round(estH));
    });
    try {
      ro.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(this.canvas);
    }
  }

  observeDpr() {
    const query = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    query.addEventListener(
      'change',
      () => {
        this.syncDpr();
        const rect = this.canvas.getBoundingClientRect();
        this.resize(Math.round(rect.width * this.dpr), Math.round(rect.height * this.dpr));
        this.observeDpr();
      },
      { once: true },
    );
  }

  // Rescales the device-pixel offsets when devicePixelRatio changes.
  syncDpr() {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === this.dpr) return;
    const oldDpr = this.dpr;
    const oldCs = this.cellSize;
    this.dpr = dpr;
    const newCs = this.cellSize;
    const cssW = this.cssWidth ?? this.canvas.width / oldDpr;
    const cssH = this.cssHeight ?? this.canvas.height / oldDpr;
    this.offsetX = rescaleOffset(this.offsetX, cssW, oldDpr, dpr, oldCs, newCs);
    this.offsetY = rescaleOffset(this.offsetY, cssH, oldDpr, dpr, oldCs, newCs);
    this.viewChanged();
  }

  resize(width, height) {
    if (width === this.canvas.width && height === this.canvas.height) return;
    const cssWidth = width / this.dpr;
    const cssHeight = height / this.dpr;
    // Keep the board centre where it was when the CSS size changes. A
    // DPR-only change leaves the CSS size alone, so it shifts nothing.
    if (this.cssWidth !== undefined) {
      this.offsetX += ((cssWidth - this.cssWidth) / 2) * this.dpr;
      this.offsetY += ((cssHeight - this.cssHeight) / 2) * this.dpr;
    }
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = width;
    this.canvas.height = height;
    this.viewChanged();
  }

  // --- Coordinates ---------------------------------------------------------

  // Fractional cell coordinates for a client (CSS px) position.
  clientToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / (rect.width || 1));
    const py = (clientY - rect.top) * (this.canvas.height / (rect.height || 1));
    return {
      x: (px - Math.round(this.offsetX)) / this.cellSize,
      y: (py - Math.round(this.offsetY)) / this.cellSize,
    };
  }

  // Integer cell under a client position, or null when outside the board.
  screenToCell(clientX, clientY) {
    const w = this.clientToWorld(clientX, clientY);
    const x = Math.floor(w.x);
    const y = Math.floor(w.y);
    if (x < 0 || y < 0 || x >= this.engine.width || y >= this.engine.height) return null;
    return { x, y };
  }

  // Client (CSS px) position of a cell's top-left corner.
  cellToScreen(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = (rect.width || 1) / (this.canvas.width || 1);
    return {
      x: rect.left + (Math.round(this.offsetX) + x * this.cellSize) * scale,
      y: rect.top + (Math.round(this.offsetY) + y * this.cellSize) * scale,
    };
  }

  // --- View ----------------------------------------------------------------

  setZoom(index, clientX, clientY) {
    const next = clampZoomIndex(index);
    if (next === this.zoomIndex) return false;
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    const anchor = this.clientToWorld(cx, cy);
    const px = (cx - rect.left) * (this.canvas.width / (rect.width || 1));
    const py = (cy - rect.top) * (this.canvas.height / (rect.height || 1));
    this.zoomIndex = next;
    this.offsetX = px - anchor.x * this.cellSize;
    this.offsetY = py - anchor.y * this.cellSize;
    this.viewChanged();
    return true;
  }

  zoomBy(steps, clientX, clientY) {
    return this.setZoom(this.zoomIndex + steps, clientX, clientY);
  }

  panBy(dxCss, dyCss) {
    this.offsetX += dxCss * this.dpr;
    this.offsetY += dyCss * this.dpr;
    this.viewChanged();
  }

  fit() {
    this.zoomIndex = fitZoomIndex(
      this.canvas.width,
      this.canvas.height,
      this.engine.width,
      this.engine.height,
      this.dpr,
    );
    this.center();
  }

  get canZoomIn() {
    return this.zoomIndex < ZOOM_LEVELS.length - 1;
  }

  get canZoomOut() {
    return this.zoomIndex > 0;
  }

  // Rendered cell size in CSS pixels. At fractional pixel ratios cells snap to
  // whole device pixels, so this can differ slightly from the nominal level.
  get renderedCellCss() {
    return this.cellSize / this.dpr;
  }

  // Zooms and centres on the live cells (plus a small margin). An empty board
  // falls back to fitting the whole board. Returns { empty, fitted }; `fitted`
  // is false when even the smallest zoom cannot show the cells, in which case
  // they are centred and the view is honestly clipped.
  // `maxCellCss` stops small shapes from being blown up to the largest zoom.
  fitLive({ maxCellCss = Infinity } = {}) {
    const { width, height } = this.engine;
    const box = liveBounds(this.engine.cells, width, height);
    if (!box) {
      this.fit();
      return { empty: true, fitted: true };
    }
    const margin = fitMargin(box);
    const spanX = box.maxX - box.minX + 1 + 2 * margin;
    const spanY = box.maxY - box.minY + 1 + 2 * margin;
    const cap = ZOOM_LEVELS.findLastIndex((level) => level <= maxCellCss);
    this.zoomIndex = Math.min(
      fitZoomIndex(this.canvas.width, this.canvas.height, spanX, spanY, this.dpr),
      Math.max(cap, 0),
    );
    const cs = this.cellSize;
    this.offsetX = Math.round(this.canvas.width / 2 - ((box.minX + box.maxX + 1) / 2) * cs);
    this.offsetY = Math.round(this.canvas.height / 2 - ((box.minY + box.maxY + 1) / 2) * cs);
    this.viewChanged();
    return { empty: false, fitted: spanX * cs <= this.canvas.width && spanY * cs <= this.canvas.height };
  }

  center() {
    const cs = this.cellSize;
    this.offsetX = Math.round((this.canvas.width - this.engine.width * cs) / 2);
    this.offsetY = Math.round((this.canvas.height - this.engine.height * cs) / 2);
    this.viewChanged();
  }

  // --- Drawing -------------------------------------------------------------

  updateCellColor() {
    const probe = this.layerCtx;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = this.colors.cell;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    // ImageData is RGBA in memory; Uint32 view is little-endian on all target platforms.
    this.cellRGBA = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  updateLayer() {
    const { cells } = this.engine;
    const px = this.pixels;
    const on = this.cellRGBA;
    for (let i = 0; i < cells.length; i++) px[i] = cells[i] ? on : 0;
    this.layerCtx.putImageData(this.image, 0, 0);
    this.layerVersion = this.engine.version;
  }

  // Draws only when something changed since the last frame. Returns true if it drew.
  render() {
    if (!this.dirty && this.layerVersion === this.engine.version) return false;
    if (this.layerVersion !== this.engine.version) this.updateLayer();
    this.dirty = false;

    const { ctx, canvas, engine, colors } = this;
    const cs = this.cellSize;
    const ox = Math.round(this.offsetX);
    const oy = Math.round(this.offsetY);
    const [x0, x1] = visibleRange(ox, cs, canvas.width, engine.width);
    const [y0, y1] = visibleRange(oy, cs, canvas.height, engine.height);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (x1 <= x0 || y1 <= y0) return true;

    const left = ox + x0 * cs;
    const top = oy + y0 * cs;
    const w = (x1 - x0) * cs;
    const h = (y1 - y0) * cs;
    ctx.fillStyle = colors.board;
    ctx.fillRect(left, top, w, h);
    ctx.drawImage(this.layer, x0, y0, x1 - x0, y1 - y0, left, top, w, h);

    this.drawGrid(cs, ox, oy, x0, x1, y0, y1);
    this.drawGhost(cs, ox, oy);
    this.drawHover(cs, ox, oy);
    this.drawCursor(cs, ox, oy);
    return true;
  }

  drawGrid(cs, ox, oy, x0, x1, y0, y1) {
    const { ctx, colors } = this;
    const minor = this.cellCss >= MINOR_GRID_MIN_CSS;
    const major = this.cellCss >= MAJOR_GRID_MIN_CSS;
    if (!minor && !major) return;
    const top = oy + y0 * cs;
    const left = ox + x0 * cs;
    const height = (y1 - y0) * cs;
    const width = (x1 - x0) * cs;

    const lines = (isMajor) => {
      for (let x = x0; x <= x1; x++) {
        if ((x % MAJOR_GRID_EVERY === 0) === isMajor) ctx.fillRect(ox + x * cs, top, 1, height);
      }
      for (let y = y0; y <= y1; y++) {
        if ((y % MAJOR_GRID_EVERY === 0) === isMajor) ctx.fillRect(left, oy + y * cs, width, 1);
      }
    };
    if (minor) {
      ctx.fillStyle = colors.gridMinor;
      lines(false);
    }
    ctx.fillStyle = colors.gridMajor;
    lines(true);
  }

  drawGhost(cs, ox, oy) {
    if (!this.ghost) return;
    const { ctx, engine } = this;
    ctx.fillStyle = this.colors.ghost;
    for (const [gx, gy] of this.ghost) {
      const x = engine.wrapX(gx);
      const y = engine.wrapY(gy);
      ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
    }
  }

  drawHover(cs, ox, oy) {
    if (!this.hover || cs < 3) return;
    const { ctx } = this;
    const x = ox + this.hover.x * cs;
    const y = oy + this.hover.y * cs;
    const t = Math.max(1, Math.round(this.dpr));
    ctx.fillStyle = this.colors.hover;
    ctx.fillRect(x, y, cs, t);
    ctx.fillRect(x, y + cs - t, cs, t);
    ctx.fillRect(x, y, t, cs);
    ctx.fillRect(x + cs - t, y, t, cs);
  }

  // A ring in two colours so it reads on live cells, empty cells and the board
  // edge alike. Below 10 CSS px the ring grows past the cell so it stays visible.
  drawCursor(cs, ox, oy) {
    if (!this.cursor) return;
    const { ctx, colors } = this;
    const t = Math.max(1, Math.round(this.dpr));
    const side = Math.max(cs, Math.round(10 * this.dpr));
    const x = Math.round(ox + (this.cursor.x + 0.5) * cs - side / 2);
    const y = Math.round(oy + (this.cursor.y + 0.5) * cs - side / 2);
    const ring = (inset, thickness, color) => {
      const rx = x + inset;
      const ry = y + inset;
      const size = side - 2 * inset;
      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, size, thickness);
      ctx.fillRect(rx, ry + size - thickness, size, thickness);
      ctx.fillRect(rx, ry, thickness, size);
      ctx.fillRect(rx + size - thickness, ry, thickness, size);
    };
    ring(-t, 4 * t, colors.cursorHalo);
    ring(0, 2 * t, colors.cursor);
  }
}
