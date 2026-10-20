import { Engine } from '../src/engine.js';
import { Input } from '../src/input.js';

// Drives the real Input with a fake canvas and renderer. By default one client
// pixel is one cell, so clientX/clientY double as cell coordinates; `scale` sets
// the pixels per cell to mimic different zoom levels.
export function setup({ width = 24, height = 16, scale = 1 } = {}) {
  const engine = new Engine(width, height);
  const handlers = {};
  const captured = new Set();
  const canvas = {
    classList: { add() {}, remove() {} },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    setPointerCapture: (id) => captured.add(id),
    releasePointerCapture: (id) => captured.delete(id),
    hasPointerCapture: (id) => captured.has(id),
  };
  const log = { ghosts: [], zooms: [], pans: 0, hovers: [] };
  const renderer = {
    cellCss: 8,
    zoomIndex: 4,
    screenToCell: (x, y) => {
      const cx = Math.floor(x / scale);
      const cy = Math.floor(y / scale);
      return cx >= 0 && cy >= 0 && cx < width && cy < height ? { x: cx, y: cy } : null;
    },
    clientToWorld: (x, y) => ({ x: x / scale, y: y / scale }),
    setHover: (cell) => log.hovers.push(cell),
    setGhost: (cells) => log.ghosts.push(cells),
    panBy: () => log.pans++,
    setZoom: (index) => log.zooms.push(`zoom:${index}`),
    zoomBy: (steps) => log.zooms.push(steps),
  };
  const input = new Input(canvas, renderer, engine);
  const editStarts = [];
  // Record the board as it is at the moment the hook runs.
  input.onEditStart = () => editStarts.push({ population: engine.population, generation: engine.generation });

  const fire = (type, e) =>
    handlers[type]({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, clientX: 0, clientY: 0, preventDefault() {}, ...e });
  return {
    engine,
    input,
    log,
    editStarts,
    captured,
    down: (x, y, e) => fire('pointerdown', { clientX: x, clientY: y, ...e }),
    move: (x, y, e) => fire('pointermove', { clientX: x, clientY: y, ...e }),
    up: (x, y, e) => fire('pointerup', { clientX: x, clientY: y, ...e }),
    wheel: (deltaY) => fire('wheel', { deltaY, deltaMode: 0, timeStamp: 1000, clientX: 3, clientY: 3 }),
  };
}
