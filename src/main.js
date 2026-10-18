import { Engine, Clock } from './engine.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI, watchTheme } from './ui.js';
import { getPreset } from './patterns.js';

const canvas = document.getElementById('board');
const engine = new Engine();
const renderer = new Renderer(canvas, engine);
const input = new Input(canvas, renderer, engine);
const clock = new Clock(10);

let running = false;

function setRunning(value) {
  running = value;
  clock.reset();
}

const ui = new UI(document, {
  togglePlay: () => setRunning(!running),
  step: () => {
    setRunning(false);
    engine.step();
  },
  clear: () => {
    setRunning(false);
    engine.clear();
  },
  randomize: () => engine.randomize(0.25),
  fit: () => renderer.fit(),
  zoomIn: () => renderer.zoomBy(1),
  zoomOut: () => renderer.zoomBy(-1),
  escape: () => {
    if (input.stamp) input.cancelStamp();
    else if (input.stroke) input.revertStroke();
    else setRunning(false);
  },
  setSpeed: (value) => {
    clock.speed = value;
  },
  choosePattern: (id) => {
    const preset = getPreset(id);
    if (!preset) return;
    input.setStamp(preset);
    ui.showStamp(preset.name);
  },
  rotate: () => input.rotateStamp(),
});

input.onStampEnd = () => ui.hideStamp();
watchTheme((colors) => renderer.setColors(colors));

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
  if (running) {
    for (let n = clock.advance(dt); n > 0; n--) engine.step();
  }
  renderer.render();
  ui.update({ running, generation: engine.generation, population: engine.population });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
