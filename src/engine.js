// Pure Game of Life simulation on a toroidal grid (B3/S23). No DOM access.

export const DEFAULT_WIDTH = 256;
export const DEFAULT_HEIGHT = 160;

export class Engine {
  constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
      throw new RangeError('grid must be at least 3×3 integer cells');
    }
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    this.next = new Uint8Array(width * height);
    this.population = 0;
    this.generation = 0;
    // Bumped on every mutation so renderers can skip unchanged frames.
    this.version = 0;
  }

  wrapX(x) {
    return ((x % this.width) + this.width) % this.width;
  }

  wrapY(y) {
    return ((y % this.height) + this.height) % this.height;
  }

  get(x, y) {
    return this.cells[this.wrapY(y) * this.width + this.wrapX(x)];
  }

  // Returns true when the cell actually changed.
  set(x, y, v) {
    const i = this.wrapY(y) * this.width + this.wrapX(x);
    const value = v ? 1 : 0;
    if (this.cells[i] === value) return false;
    this.cells[i] = value;
    this.population += value ? 1 : -1;
    this.version++;
    return true;
  }

  step() {
    const { width: w, height: h, cells, next } = this;
    let population = 0;
    for (let y = 0; y < h; y++) {
      const up = ((y + h - 1) % h) * w;
      const row = y * w;
      const down = ((y + 1) % h) * w;
      for (let x = 0; x < w; x++) {
        const left = x === 0 ? w - 1 : x - 1;
        const right = x === w - 1 ? 0 : x + 1;
        const n =
          cells[up + left] + cells[up + x] + cells[up + right] +
          cells[row + left] + cells[row + right] +
          cells[down + left] + cells[down + x] + cells[down + right];
        const alive = n === 3 || (n === 2 && cells[row + x] === 1) ? 1 : 0;
        next[row + x] = alive;
        population += alive;
      }
    }
    this.cells = next;
    this.next = cells;
    this.population = population;
    this.generation++;
    this.version++;
  }

  clear() {
    this.cells.fill(0);
    this.population = 0;
    this.generation = 0;
    this.version++;
  }

  randomize(density = 0.25, rng = Math.random) {
    if (!(density >= 0 && density <= 1)) throw new RangeError('density must be within [0, 1]');
    let population = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const alive = rng() < density ? 1 : 0;
      this.cells[i] = alive;
      population += alive;
    }
    this.population = population;
    this.generation = 0;
    this.version++;
  }
}
