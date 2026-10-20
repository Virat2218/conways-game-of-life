// Playback state and the rules for when the board may change. No DOM access.
//
// Editing (painting a stroke or placing a pattern) always pauses first and
// never resumes by itself, so a stroke is applied to a board that is standing
// still and can be reverted exactly.

export class Session {
  // `isEditing()`  – a stroke is in progress or a pattern is waiting to be placed.
  // `isStroking()` – a stroke is in progress (its undo record must stay valid).
  constructor({ engine, clock, isEditing = () => false, isStroking = () => false }) {
    this.engine = engine;
    this.clock = clock;
    this.isEditing = isEditing;
    this.isStroking = isStroking;
    this.running = false;
  }

  pause() {
    this.running = false;
    // Drop banked time so the next Play starts a fresh interval.
    this.clock.reset();
  }

  // Play and Step are unavailable mid-edit; each returns whether it acted.
  togglePlay() {
    if (this.isEditing()) return false;
    if (this.running) this.pause();
    else {
      this.running = true;
      this.clock.reset();
    }
    return true;
  }

  step() {
    if (this.isEditing()) return false;
    this.pause();
    this.engine.step();
    return true;
  }

  // Replacing the board while a stroke is in progress would invalidate the
  // stroke's undo record, so these are ignored until it ends.
  clear() {
    if (this.isStroking()) return false;
    this.pause();
    this.engine.clear();
    return true;
  }

  randomize(density = 0.25) {
    if (this.isStroking()) return false;
    this.pause();
    this.engine.randomize(density);
    return true;
  }

  setSpeed(value) {
    this.clock.speed = value;
  }

  // Called once per animation frame with the elapsed milliseconds.
  advance(dt) {
    if (!this.running || this.isEditing()) return 0;
    let steps = this.clock.advance(dt);
    for (let n = steps; n > 0; n--) this.engine.step();
    return steps;
  }
}
