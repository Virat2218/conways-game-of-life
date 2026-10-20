// Playback state, undo history, and the restart seed. No DOM access.
//
// Editing (painting a stroke or placing a pattern) always pauses first and
// never resumes by itself, so a stroke is applied to a board that is standing
// still and can be reverted exactly.
//
// A "state" is the board (cells and generation) plus the restart seed that was
// in force. History entries hold two states, so undo and redo put back both the
// cells and the seed lineage they belonged to.

import { History } from './history.js';

export class Session {
  // `isEditing()`  – a stroke is in progress or a pattern is waiting to be placed.
  // `isStroking()` – a stroke is in progress (its undo record must stay valid).
  constructor({ engine, clock, history = new History(), isEditing = () => false, isStroking = () => false }) {
    this.engine = engine;
    this.clock = clock;
    this.history = history;
    this.isEditing = isEditing;
    this.isStroking = isStroking;
    this.running = false;
    // { cells } of the setup the current run started from, or null until the
    // first Play/Step after the board was edited or replaced.
    this.seed = null;
    this.pending = null;
    this.restartCache = { version: -1, seed: undefined, value: false };
  }

  pause() {
    this.running = false;
    // Drop banked time so the next Play starts a fresh interval.
    this.clock.reset();
  }

  // --- Playback ------------------------------------------------------------

  // Play and Step are unavailable mid-edit; each returns whether it acted.
  togglePlay() {
    if (this.isEditing()) return false;
    if (this.running) this.pause();
    else {
      this.captureSeed();
      this.running = true;
      this.clock.reset();
    }
    return true;
  }

  step() {
    if (this.isEditing()) return false;
    this.captureSeed();
    this.pause();
    this.engine.step();
    return true;
  }

  setSpeed(value) {
    this.clock.speed = value;
  }

  // Called once per animation frame with the elapsed milliseconds.
  advance(dt) {
    if (!this.running || this.isEditing()) return 0;
    const steps = this.clock.advance(dt);
    for (let n = steps; n > 0; n--) this.engine.step();
    return steps;
  }

  // --- Restart seed --------------------------------------------------------

  // The seed is the setup a run started from. It is taken on the first Play or
  // Step after the board changed, kept while the simulation runs on, and
  // dropped by any edit, so the next Play/Step starts a new one.
  captureSeed() {
    if (this.seed === null) this.seed = { cells: this.engine.cells.slice() };
  }

  // Restart puts the seed back at generation 0 and stays paused.
  get canRestart() {
    // Compared cell by cell, so remember the answer until the board or seed changes.
    const cache = this.restartCache;
    if (cache.version !== this.engine.version || cache.seed !== this.seed) {
      cache.version = this.engine.version;
      cache.seed = this.seed;
      cache.value = this.seed !== null && !this.engine.matches({ cells: this.seed.cells, generation: 0 });
    }
    return cache.value;
  }

  // Restart is an ordinary history entry, so Undo brings the evolved board back.
  // The seed itself is unchanged by it.
  restart() {
    if (this.isEditing() || !this.canRestart) return false;
    this.pause();
    const before = this.capture();
    this.engine.restore({ cells: this.seed.cells, generation: 0 });
    this.history.push({ label: 'Restart', before, after: this.capture() });
    return true;
  }

  // --- Board edits and history ---------------------------------------------

  capture() {
    return { ...this.engine.snapshot(), seed: this.seed };
  }

  apply(state) {
    this.engine.restore(state);
    this.seed = state.seed;
  }

  // Multi-event edits (a stroke) bracket their changes with begin and commit;
  // commit records one entry, and only if the board really changed. A cancelled
  // edit calls abort, or restores the board itself, and leaves no entry.
  beginTransaction() {
    this.pending = this.capture();
  }

  // `establishSeed` makes the new board the restart seed straight away (for a
  // replaced board, as opposed to an edit that the next Play/Step will adopt).
  commitTransaction(label, { establishSeed = false } = {}) {
    const before = this.pending;
    this.pending = null;
    if (!before || this.engine.matches(before)) {
      if (before && establishSeed) this.captureSeed();
      return false;
    }
    // Edited boards need a fresh seed at the next Play/Step.
    this.seed = null;
    if (establishSeed) this.captureSeed();
    this.history.push({ label, before, after: this.capture() });
    return true;
  }

  abortTransaction() {
    this.pending = null;
  }

  // For one-shot edits: Clear, Randomize, and later the loading of a preset.
  transact(label, change) {
    this.beginTransaction();
    change();
    return this.commitTransaction(label);
  }

  // Replaces the whole board with `change` (generation 0, paused) and makes it
  // the restart seed. One undo step. Ignored while a stroke is in progress.
  load(label, change) {
    if (this.isStroking()) return false;
    this.pause();
    this.beginTransaction();
    this.engine.clear();
    change();
    this.commitTransaction(label, { establishSeed: true });
    return true;
  }

  get canUndo() {
    return this.history.canUndo;
  }

  get canRedo() {
    return this.history.canRedo;
  }

  // Both pause first and return the entry they applied (null if none).
  undo() {
    if (this.isEditing() || !this.history.canUndo) return null;
    this.pause();
    const entry = this.history.undo();
    this.apply(entry.before);
    return entry;
  }

  redo() {
    if (this.isEditing() || !this.history.canRedo) return null;
    this.pause();
    const entry = this.history.redo();
    this.apply(entry.after);
    return entry;
  }

  // Replacing the board while a stroke is in progress would invalidate the
  // stroke's undo record, so these are ignored until it ends.
  clear() {
    if (this.isStroking()) return false;
    this.pause();
    this.transact('Clear', () => this.engine.clear());
    return true;
  }

  randomize(density = 0.25) {
    if (this.isStroking()) return false;
    this.pause();
    this.transact('Randomize', () => this.engine.randomize(density));
    return true;
  }
}
