import { Engine, Clock } from './engine.js';
import { Session } from './session.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { createThemeController, readThemeColors } from './theme.js';
import { getPreset } from './patterns.js';

const canvas = document.getElementById('board');
const engine = new Engine();
const renderer = new Renderer(canvas, engine);
const input = new Input(canvas, renderer, engine);
const clock = new Clock(10);

// Storage access itself can throw (blocked cookies, sandboxed frames).
function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Updates data-theme, then re-reads the canvas palette so the board changes
// with the page even while paused.
const theme = createThemeController({
  root: document.documentElement,
  storage: getStorage(),
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
  onChange: () => renderer.setColors(readThemeColors()),
});

// Owns play state and decides when the board may change. Editing pauses the
// simulation (below) and Play/Step stay unavailable until the edit ends.
const session = new Session({
  engine,
  clock,
  isEditing: () => input.editing,
  isStroking: () => input.stroke !== null,
});
input.onEditStart = () => session.pause();

const ui = new UI(document, {
  togglePlay: () => session.togglePlay(),
  step: () => session.step(),
  clear: () => session.clear(),
  randomize: () => session.randomize(0.25),
  fit: () => renderer.fit(),
  zoomIn: () => renderer.zoomBy(1),
  zoomOut: () => renderer.zoomBy(-1),
  escape: () => {
    if (!input.cancelEdit()) session.pause();
  },
  setSpeed: (value) => session.setSpeed(value),
  choosePattern: (id) => {
    const preset = getPreset(id);
    if (!preset) return;
    input.setStamp(preset);
    ui.showStamp(preset.name, preset.id);
  },
  rotate: () => input.rotateStamp(),
  setTheme: (preference) => theme.setPreference(preference),
});

ui.setThemePreference(theme.preference);

input.onStampEnd = () => ui.hideStamp();

engine.randomize(0.25);

let fitted = false;
renderer.onChange(() => {
  // Fit once the canvas has its first real size.
  if (!fitted && canvas.width > 0 && canvas.height > 0) {
    fitted = true;
    renderer.fit();
  }
});

// requestAnimationFrame drives everything: it is throttled in background tabs,
// so the simulation never races there.
let last = performance.now();
function frame(now) {
  const dt = now - last;
  last = now;
  session.advance(dt);
  renderer.render();
  ui.update({
    running: session.running,
    editing: input.editing,
    generation: engine.generation,
    population: engine.population,
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
