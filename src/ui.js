// Sidebar, status, theme switch, stamp toast and keyboard shortcuts. Translates
// DOM events into actions; owns no simulation state.

import { PRESETS } from './patterns.js';
import { PREFERENCES } from './theme.js';

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Controls where Ctrl/Cmd+Z means "undo my typing", so it must stay native.
const NON_TEXT_INPUTS = new Set(['radio', 'checkbox', 'range', 'button', 'submit', 'reset', 'color', 'file']);

function isTextEntry(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(target.type);
}

const TOOL_TEXT = {
  draw: { label: 'Draw cells', hint: 'Draw: drag to add cells.' },
  erase: { label: 'Erase cells', hint: 'Erase: drag to remove cells.' },
  pan: { label: 'Pan the view', hint: 'Pan: drag to move the view.' },
};

// Screen-reader announcements: rare while running, prompt-ish while paused.
const ANNOUNCE_RUNNING_MS = 5000;
const ANNOUNCE_PAUSED_MS = 1000;

export class UI {
  // actions: { togglePlay, step, clear, randomize, fit, zoomIn, zoomOut, escape,
  //            setSpeed, choosePattern, rotate, setTheme, setTool, undo, redo, restart, fitLive }
  constructor(root, actions) {
    this.actions = actions;
    this.root = root;
    this.el = {
      play: root.getElementById('play'),
      playLabel: root.getElementById('play-label'),
      step: root.getElementById('step'),
      clear: root.getElementById('clear'),
      random: root.getElementById('random'),
      fit: root.getElementById('fit'),
      fitLive: root.getElementById('fit-live'),
      zoomIn: root.getElementById('zoom-in'),
      zoomOut: root.getElementById('zoom-out'),
      zoomValue: root.getElementById('zoom-value'),
      undo: root.getElementById('undo'),
      redo: root.getElementById('redo'),
      restart: root.getElementById('restart'),
      speed: root.getElementById('speed'),
      speedValue: root.getElementById('speed-value'),
      generation: root.getElementById('generation'),
      population: root.getElementById('population'),
      status: root.getElementById('status'),
      statusText: root.getElementById('status-text'),
      library: root.getElementById('library'),
      toast: root.getElementById('toast'),
      toastText: root.getElementById('toast-text'),
      toastRotate: root.getElementById('toast-rotate'),
      toastCancel: root.getElementById('toast-cancel'),
      announcer: root.getElementById('announcer'),
      board: root.getElementById('board'),
      toolGroup: root.getElementById('tool-group'),
      toolLabel: root.getElementById('tool-label'),
      hintTool: root.getElementById('hint-tool'),
      help: root.getElementById('help'),
      helpOpen: root.getElementById('help-open'),
      helpClose: root.getElementById('help-close'),
    };
    this.themeInputs = [...root.querySelectorAll('input[name="theme"]')];
    this.toolInputs = [...root.querySelectorAll('input[name="tool"]')];
    this.tool = 'draw';
    this.placing = null;
    this.shown = { generation: -1, population: -1, running: null, editing: null, history: '', view: '' };
    this.announced = { text: '', time: -Infinity };

    this.bindButton(this.el.play, actions.togglePlay);
    this.bindButton(this.el.step, actions.step);
    this.bindButton(this.el.clear, actions.clear);
    this.bindButton(this.el.random, actions.randomize);
    this.bindButton(this.el.fit, actions.fit);
    this.bindButton(this.el.fitLive, actions.fitLive);
    this.bindButton(this.el.zoomIn, actions.zoomIn);
    this.bindButton(this.el.zoomOut, actions.zoomOut);
    this.bindButton(this.el.undo, actions.undo);
    this.bindButton(this.el.redo, actions.redo);
    this.bindButton(this.el.restart, actions.restart);

    this.el.speed.addEventListener('input', () => this.showSpeed());
    this.showSpeed();

    this.buildLibrary(root);
    this.bindButton(this.el.toastRotate, actions.rotate);
    this.bindButton(this.el.toastCancel, actions.escape);

    for (const input of this.themeInputs) {
      input.addEventListener('change', () => {
        if (input.checked && PREFERENCES.includes(input.value)) actions.setTheme(input.value);
      });
    }

    for (const input of this.toolInputs) {
      input.addEventListener('change', () => {
        if (input.checked) actions.setTool(input.value);
      });
    }

    this.bindHelp();
    root.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  // The dialog is modal, so the board and toolbar are inert while it is open;
  // Escape and the Close button dismiss it and focus goes back to the trigger.
  bindHelp() {
    const { help, helpOpen, helpClose } = this.el;
    helpOpen.addEventListener('click', () => help.showModal());
    helpClose.addEventListener('click', () => help.close());
    // A click on the backdrop (the dialog element itself) also closes it.
    help.addEventListener('click', (e) => {
      if (e.target === help) help.close();
    });
    help.addEventListener('close', () => helpOpen.focus());
  }

  setBoardSize(width, height) {
    for (const span of this.root.querySelectorAll('[data-board-size]')) {
      span.textContent = `${width} × ${height}`;
    }
  }

  // Reflects the selected tool; placing a pattern is shown on top of it.
  showTool(tool) {
    this.tool = tool;
    this.el.board.dataset.tool = tool;
    for (const input of this.toolInputs) input.checked = input.value === tool;
    this.refreshToolText();
  }

  refreshToolText() {
    const { toolGroup, toolLabel, hintTool } = this.el;
    const text = TOOL_TEXT[this.tool];
    if (this.placing) {
      toolGroup.dataset.placing = 'true';
      toolLabel.textContent = `Placing ${this.placing}`;
      hintTool.textContent = `Placing ${this.placing}: click the board to place it.`;
    } else {
      delete toolGroup.dataset.placing;
      toolLabel.textContent = text.label;
      hintTool.textContent = text.hint;
    }
  }

  showSpeed() {
    const { speed, speedValue } = this.el;
    const value = Number(speed.value);
    speedValue.value = `${value} gen / sec`;
    const pct = ((value - Number(speed.min)) / (Number(speed.max) - Number(speed.min))) * 100;
    speed.style.setProperty('--fill', `${pct}%`);
    this.actions.setSpeed(value);
  }

  buildLibrary(root) {
    this.libraryButtons = new Map();
    for (const preset of PRESETS) {
      const item = root.createElement('li');
      const button = root.createElement('button');
      button.type = 'button';
      button.className = 'pattern-item';
      button.dataset.pattern = preset.id;
      button.innerHTML =
        '<span class="pattern-name"></span><span class="pattern-meta"></span>' +
        '<svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>';
      button.querySelector('.pattern-name').textContent = preset.name;
      button.querySelector('.pattern-meta').textContent = `${preset.cells.length} cells`;
      this.bindButton(button, () => this.actions.choosePattern(preset.id));
      item.append(button);
      this.el.library.append(item);
      this.libraryButtons.set(preset.id, button);
    }
  }

  setThemePreference(preference) {
    for (const input of this.themeInputs) input.checked = input.value === preference;
  }

  showStamp(name, id) {
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    this.el.toastText.textContent = `Placing ${name} — ${touch ? 'drag, then release to place.' : 'click the board to place.'}`;
    this.el.toast.hidden = false;
    this.markActivePattern(id);
    this.placing = name;
    this.refreshToolText();
  }

  hideStamp() {
    this.el.toast.hidden = true;
    this.markActivePattern(null);
    this.placing = null;
    this.refreshToolText();
  }

  markActivePattern(id) {
    for (const [key, button] of this.libraryButtons) button.dataset.active = String(key === id);
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
    // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes, except where the
    // browser's own text undo should win, and inside the Help dialog.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const undo = key === 'z' && !e.shiftKey;
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey);
      if (!undo && !redo) return;
      if (isTextEntry(e.target) || e.target?.closest?.('dialog')) return;
      (undo ? this.actions.undo : this.actions.redo)();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Keys inside the Help dialog (Escape to close, Tab, Enter on Close) belong to it.
    if (e.target?.closest?.('dialog')) return;
    if (FORM_TAGS.has(e.target?.tagName) && e.key !== 'Escape') return;
    // A focused button handles its own Space/Enter activation.
    if (e.target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    // Holding Space must toggle once, not on every auto-repeat.
    if (e.key === ' ' && e.repeat) {
      e.preventDefault();
      return;
    }
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

  update({ running, editing = false, generation, population, history = {}, view = {} }) {
    const { el, shown } = this;
    if (running !== shown.running || editing !== shown.editing) {
      shown.running = running;
      shown.editing = editing;
      el.play.dataset.state = running ? 'running' : 'paused';
      el.playLabel.textContent = running ? 'Pause' : 'Play';
      el.status.dataset.state = editing ? 'editing' : running ? 'running' : 'paused';
      el.statusText.textContent = editing ? 'Editing' : running ? 'Running' : 'Paused';
      // Play and Step are unavailable mid-edit. aria-disabled (rather than
      // disabled) keeps them focusable and lets the tooltip and note explain why.
      this.setBlocked(el.play, editing, running ? 'Pause (Space)' : 'Play (Space)');
      this.setBlocked(el.step, editing, 'Step one generation (N or →)');
    }
    this.updateHistory(editing, history);
    this.updateView(view);
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

  // The zoom readout and the − / + buttons, which stop at the first and last level.
  updateView({ zoomText = '', canZoomIn = true, canZoomOut = true } = {}) {
    const key = [zoomText, canZoomIn, canZoomOut].join('|');
    if (key === this.shown.view) return;
    this.shown.view = key;
    const { zoomValue, zoomIn, zoomOut } = this.el;
    zoomValue.textContent = zoomText;
    this.setLimit(zoomIn, canZoomIn, 'Zoom in (+)', 'Already at the maximum zoom');
    this.setLimit(zoomOut, canZoomOut, 'Zoom out (−)', 'Already at the minimum zoom');
  }

  setLimit(button, available, title, limitTitle) {
    if (available) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', 'true');
    button.title = available ? title : limitTitle;
  }

  // Undo, Redo and Restart: unavailable when there is nothing to do, and while
  // an edit is in progress (the same rule as Play and Step).
  updateHistory(editing, { canUndo = false, canRedo = false, canRestart = false, undoLabel = null, redoLabel = null } = {}) {
    const key = [editing, canUndo, canRedo, canRestart, undoLabel, redoLabel].join('|');
    if (key === this.shown.history) return;
    this.shown.history = key;
    const { undo, redo, restart } = this.el;
    this.setAvailable(undo, canUndo, editing, `Undo ${undoLabel} (Ctrl/Cmd+Z)`, 'Nothing to undo');
    this.setAvailable(redo, canRedo, editing, `Redo ${redoLabel} (Ctrl/Cmd+Shift+Z)`, 'Nothing to redo');
    this.setAvailable(restart, canRestart, editing, 'Restart from the initial setup at generation 0', 'Nothing to restart: press Play or Step first');
  }

  setAvailable(button, available, editing, title, emptyTitle) {
    if (editing) return this.setBlocked(button, true, title);
    if (available) return this.setBlocked(button, false, title);
    button.setAttribute('aria-disabled', 'true');
    button.removeAttribute('aria-describedby');
    button.title = emptyTitle;
  }

  // Short message for screen readers, bypassing the throttled status updates.
  say(text) {
    // A repeat of the same words would not be re-read, so alternate a trailing space.
    this.sayFlip = !this.sayFlip;
    this.el.announcer.textContent = this.sayFlip ? text : `${text}\u00a0`;
    this.announced = { text: '', time: performance.now() };
  }

  setBlocked(button, blocked, title) {
    if (blocked) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-describedby', 'edit-note');
      button.title = 'Finish or cancel the edit first';
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-describedby');
      button.title = title;
    }
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
