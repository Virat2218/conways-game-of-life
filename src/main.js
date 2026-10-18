import { Engine } from './engine.js';
import { Renderer } from './renderer.js';

const canvas = document.getElementById('board');
const engine = new Engine();
const renderer = new Renderer(canvas, engine);

engine.randomize(0.25);

let fitted = false;
renderer.onChange(() => {
  // Fit once the canvas has its first real size.
  if (!fitted && canvas.width > 0 && canvas.height > 0) {
    fitted = true;
    renderer.fit();
  }
});

function frame() {
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
