// Toolbar, stats and keyboard shortcuts. Translates DOM events into actions.

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export class UI {
  // actions: { togglePlay, step, clear, randomize, fit, zoomIn, zoomOut, escape, setSpeed }
  constructor(root, actions) {
    this.actions = actions;
    this.el = {
      play: root.getElementById('play'),
      step: root.getElementById('step'),
      clear: root.getElementById('clear'),
      random: root.getElementById('random'),
      fit: root.getElementById('fit'),
      speed: root.getElementById('speed'),
      speedValue: root.getElementById('speed-value'),
      generation: root.getElementById('generation'),
      population: root.getElementById('population'),
    };
    this.shown = { generation: -1, population: -1, running: null };

    this.bindButton(this.el.play, actions.togglePlay);
    this.bindButton(this.el.step, actions.step);
    this.bindButton(this.el.clear, actions.clear);
    this.bindButton(this.el.random, actions.randomize);
    this.bindButton(this.el.fit, actions.fit);

    this.el.speed.addEventListener('input', () => {
      const value = Number(this.el.speed.value);
      this.el.speedValue.value = `${value}/s`;
      actions.setSpeed(value);
    });

    root.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  bindButton(button, action) {
    button.addEventListener('click', (e) => {
      action();
      // Mouse clicks report detail > 0. Dropping focus keeps Space from
      // re-activating the button on top of the global play/pause shortcut.
      if (e.detail > 0) button.blur();
    });
  }

  onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (FORM_TAGS.has(e.target?.tagName) && e.key !== 'Escape') return;
    const a = this.actions;
    switch (e.key) {
      case ' ':
        a.togglePlay();
        break;
      case 'n':
      case 'N':
      case 'ArrowRight':
        a.step();
        break;
      case 'c':
      case 'C':
        a.clear();
        break;
      case '+':
      case '=':
        a.zoomIn();
        break;
      case '-':
      case '_':
        a.zoomOut();
        break;
      case 'f':
      case 'F':
        a.fit();
        break;
      case 'Escape':
        a.escape();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  update({ running, generation, population }) {
    const { el, shown } = this;
    if (running !== shown.running) {
      shown.running = running;
      el.play.setAttribute('aria-pressed', String(running));
      el.play.setAttribute('aria-label', running ? 'Pause' : 'Play');
      el.play.title = running ? 'Pause (Space)' : 'Play (Space)';
    }
    if (generation !== shown.generation) {
      shown.generation = generation;
      el.generation.textContent = generation.toLocaleString();
    }
    if (population !== shown.population) {
      shown.population = population;
      el.population.textContent = population.toLocaleString();
    }
  }
}
