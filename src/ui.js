// Toolbar, stats, stamp toast and keyboard shortcuts. Translates DOM events into actions.

import { PRESETS } from './patterns.js';

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Screen-reader announcements: rare while running, prompt-ish while paused.
const ANNOUNCE_RUNNING_MS = 5000;
const ANNOUNCE_PAUSED_MS = 1000;

const THEME_VARS = {
  background: '--board-background',
  board: '--board',
  cell: '--cell',
  gridMinor: '--grid-minor',
  gridMajor: '--grid-major',
  hover: '--hover',
  ghost: '--ghost',
};

// Reads the canvas palette from CSS custom properties.
export function readThemeColors(element = document.documentElement) {
  const style = getComputedStyle(element);
  const colors = {};
  for (const [key, name] of Object.entries(THEME_VARS)) {
    const value = style.getPropertyValue(name).trim();
    if (value) colors[key] = value;
  }
  return colors;
}

// Calls `fn` with fresh colors whenever the color scheme flips.
export function watchTheme(fn) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => fn(readThemeColors()));
  fn(readThemeColors());
}

export class UI {
  // actions: { togglePlay, step, clear, randomize, fit, zoomIn, zoomOut, escape,
  //            setSpeed, choosePattern, rotate }
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
      pattern: root.getElementById('pattern'),
      toast: root.getElementById('toast'),
      toastText: root.getElementById('toast-text'),
      toastRotate: root.getElementById('toast-rotate'),
      toastCancel: root.getElementById('toast-cancel'),
      announcer: root.getElementById('announcer'),
    };
    this.shown = { generation: -1, population: -1, running: null };
    this.announced = { text: '', time: -Infinity };

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

    for (const p of PRESETS) {
      const option = root.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      this.el.pattern.append(option);
    }
    this.el.pattern.addEventListener('change', () => {
      const id = this.el.pattern.value;
      if (!id) return;
      actions.choosePattern(id);
      // Reset so the same preset can be picked again, and release focus so
      // R and Esc reach the shortcuts instead of the select's type-ahead.
      this.el.pattern.value = '';
      this.el.pattern.blur();
    });
    this.bindButton(this.el.toastRotate, actions.rotate);
    this.bindButton(this.el.toastCancel, actions.escape);

    root.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  showStamp(name) {
    this.el.toastText.textContent = `Placing ${name} — click or drag and release to place.`;
    this.el.toast.hidden = false;
  }

  hideStamp() {
    this.el.toast.hidden = true;
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
      case 'r':
      case 'R':
        a.rotate();
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
    this.announce(running, generation, population);
  }

  announce(running, generation, population) {
    const now = performance.now();
    const wait = running ? ANNOUNCE_RUNNING_MS : ANNOUNCE_PAUSED_MS;
    if (now - this.announced.time < wait) return;
    const text = `${running ? 'Running' : 'Paused'}. Generation ${generation.toLocaleString()}, population ${population.toLocaleString()}.`;
    if (text === this.announced.text) return;
    this.announced = { text, time: now };
    this.el.announcer.textContent = text;
  }
}
