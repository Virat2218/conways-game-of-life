import { Engine, Clock } from './engine.js';
import { Session } from './session.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { createThemeController, readThemeColors } from './theme.js';
import { getPreset, centerOrigin } from './patterns.js';
import { Transfer } from './transfer.js';
import { ShareDialog } from './share.js';

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

// Largest zoom used when framing a freshly loaded pattern, so a glider is not blown up to fill the view.
const LOAD_MAX_CELL_CSS = 16;

function placeCentered(pattern) {
  const o = centerOrigin(pattern, engine.width, engine.height);
  for (const [x, y] of pattern.cells) engine.set(x + o.x, y + o.y, 1);
}

let stampName = '';
let stampReturnFocus = null;

// Columns and rows are numbered from 1 for speech.
const describeCell = ({ x, y }) => `column ${x + 1}, row ${y + 1}`;
const cellState = ({ x, y }) => (engine.get(x, y) ? 'alive' : 'dead');

const formatCellSize = (css) => (Number.isInteger(css) ? String(css) : css.toFixed(1));

function zoom(steps) {
  const zoomed = renderer.zoomBy(steps);
  if (zoomed) ui.say(`Zoom ${formatCellSize(renderer.renderedCellCss)} pixels per cell`);
  else ui.say(steps > 0 ? 'Already at the maximum zoom' : 'Already at the minimum zoom');
}

// Arms a pattern for placing. From the keyboard the whole placement can be done
// without a pointer; Esc goes back to the control that started it.
function armStamp(pattern, { keyboard = false, returnTo = document.activeElement } = {}) {
  input.setStamp(pattern);
  stampName = pattern.name;
  ui.showStamp(pattern.name, pattern.id, { keyboard });
  if (keyboard) {
    stampReturnFocus = returnTo;
    input.stampAtCursor();
    canvas.focus();
    ui.say(`Placing ${pattern.name} at ${describeCell(input.cursor)}. Arrow keys move it, R rotates, Enter places, Escape cancels.`);
  }
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
  choosePattern: (id, options) => {
    const preset = getPreset(id);
    if (preset) armStamp(preset, options);
  },
  loadPattern: (id) => {
    const preset = getPreset(id);
    if (!preset) return;
    // Abandon a pending stroke or placement first; that also removes any ghost.
    input.cancelEdit();
    const loaded = session.load(`Load ${preset.name}`, () => placeCentered(preset));
    if (!loaded) return;
    renderer.fitLive({ maxCellCss: LOAD_MAX_CELL_CSS });
    ui.say(`Loaded ${preset.name} on a clean board. Paused at generation 0.`);
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

// Saving, importing, exporting and sharing. Everything that can fail is checked
// inside Transfer before the board is touched; these wrappers only speak.
const transfer = new Transfer({
  engine,
  session,
  storage: getStorage(),
  cancelEdit: () => input.cancelEdit(),
  onReplaced: () => renderer.fitLive({ maxCellCss: LOAD_MAX_CELL_CSS }),
});
const announce = (result) => {
  if (result.message) ui.say(result.message);
  return result;
};
const pageBase = () => window.location.href.split('#')[0];
const share = new ShareDialog(document, {
  save: () => announce(transfer.save()),
  loadSaved: () => announce(transfer.loadSaved()),
  savedInfo: () => transfer.savedInfo(),
  exportRLE: () => transfer.exportRLE(),
  link: () => transfer.shareLink(pageBase()),
  parseImport: (text) => transfer.parseImport(text),
  loadImport: (pattern, name) => announce(transfer.loadPattern(pattern, name)),
  stampImport: (pattern, name, { keyboard }) =>
    armStamp({ ...pattern, id: 'import', name }, { keyboard, returnTo: document.getElementById('share-open') }),
});

// A share link in the address bar is offered for review, never applied by itself.
function handleHash() {
  const incoming = transfer.readLink(window.location.hash);
  if (incoming === null) return;
  // Handle it once: reloading must not ask again.
  window.history.replaceState(null, '', pageBase());
  if (incoming.ok) share.offer(incoming.pattern, 'Shared pattern');
  else {
    share.show();
    share.report(incoming);
  }
}
window.addEventListener('hashchange', handleHash);

input.onStampEnd = (reason) => {
  // Read the focus before the toast, and any button in it, is hidden.
  const active = document.activeElement;
  const cancelledFromBoard = active === canvas || document.getElementById('toast').contains(active);
  ui.hideStamp();
  if (reason === 'placed') ui.say(`Placed ${stampName}`);
  else if (stampReturnFocus && cancelledFromBoard) stampReturnFocus.focus();
  stampReturnFocus = null;
};
input.onCursor = (cell) =>
  ui.sayLater(() => (input.stamp ? `${stampName} at ${describeCell(cell)}` : `${describeCell(cell)}, ${cellState(cell)}`));
input.onCellToggle = (cell, alive) => ui.say(`${describeCell(cell)}, now ${alive ? 'alive' : 'dead'}`);
input.onTransaction = (phase, info) => {
  if (phase === 'begin') session.beginTransaction();
  else if (phase === 'commit') session.commitTransaction(info.label);
  else session.abortTransaction();
};
input.onToolChange = (tool) => ui.showTool(tool);
ui.showTool(input.tool);
ui.setBoardSize(engine.width, engine.height);

// A fresh session opens on a paused Gosper glider gun rather than random noise.
placeCentered(getPreset('gosper'));

handleHash();

let fitted = false;
renderer.onChange(() => {
  // Fit once the canvas has its first real size.
  if (!fitted && canvas.width > 0 && canvas.height > 0) {
    fitted = true;
    renderer.fitLive({ maxCellCss: LOAD_MAX_CELL_CSS });
  }
});

// requestAnimationFrame drives everything: it is throttled in background tabs,
// so the simulation never races there.
let last = performance.now();
let hintShown = true;
function frame(now) {
  const dt = now - last;
  last = now;
  session.advance(dt);
  // The start hint goes away for good once the user does anything to the board.
  if (hintShown && (session.running || input.editing || session.canUndo || engine.generation > 0)) {
    hintShown = false;
    ui.hideHint();
  }
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
