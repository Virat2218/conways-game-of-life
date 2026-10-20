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

const formatCellSize = (css) => (Number.isInteger(css) ? String(css) : css.toFixed(1));

function zoom(steps) {
  if (renderer.zoomBy(steps)) ui.say(`Zoom ${formatCellSize(renderer.renderedCellCss)} pixels per cell`);
  else ui.say(steps > 0 ? 'Already at the maximum zoom' : 'Already at the minimum zoom');
}

const ui = new UI(document, {
  togglePlay: () => session.togglePlay(),
  step: () => session.step(),
  clear: () => session.clear(),
  randomize: () => session.randomize(0.25),
  fit: () => renderer.fit(),
  fitLive: () => {
    const { empty, fitted } = renderer.fitLive();
    if (empty) ui.say('No live cells, so the whole board is shown');
    else if (!fitted) ui.say('The live cells are larger than the view even at the smallest zoom');
    else ui.say(`Zoomed to the live cells, ${formatCellSize(renderer.renderedCellCss)} pixels per cell`);
  },
  zoomIn: () => zoom(1),
  zoomOut: () => zoom(-1),
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
  setTool: (tool) => input.setTool(tool),
  undo: () => {
    const entry = session.undo();
    if (entry) ui.say(`Undid ${entry.label}`);
  },
  redo: () => {
    const entry = session.redo();
    if (entry) ui.say(`Redid ${entry.label}`);
  },
  restart: () => {
    if (session.restart()) ui.say('Restarted from the initial setup');
  },
});

ui.setThemePreference(theme.preference);

input.onStampEnd = () => ui.hideStamp();
input.onTransaction = (phase, info) => {
  if (phase === 'begin') session.beginTransaction();
  else if (phase === 'commit') session.commitTransaction(info.label);
  else session.abortTransaction();
};
input.onToolChange = (tool) => ui.showTool(tool);
ui.showTool(input.tool);
ui.setBoardSize(engine.width, engine.height);

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
    view: {
      zoomText: `${formatCellSize(renderer.renderedCellCss)} px/cell`,
      canZoomIn: renderer.canZoomIn,
      canZoomOut: renderer.canZoomOut,
    },
    history: {
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      canRestart: session.canRestart,
      undoLabel: session.history.undoLabel,
      redoLabel: session.history.redoLabel,
    },
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
