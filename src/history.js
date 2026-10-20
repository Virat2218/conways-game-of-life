// A bounded undo/redo stack of whole-board transactions. No DOM access.
//
// Each entry is { label, before, after }: the state just before an edit and the
// state just after it. Both are opaque to this module, so whoever records an
// entry decides what a "state" contains. Undo restores `before`, redo restores
// `after`; simulation ticks are never entries.

export const HISTORY_LIMIT = 50;

export class History {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.entries = [];
    // Entries before the cursor are applied (undoable); the rest can be redone.
    this.cursor = 0;
  }

  get canUndo() {
    return this.cursor > 0;
  }

  get canRedo() {
    return this.cursor < this.entries.length;
  }

  get undoLabel() {
    return this.canUndo ? this.entries[this.cursor - 1].label : null;
  }

  get redoLabel() {
    return this.canRedo ? this.entries[this.cursor].label : null;
  }

  // A new edit ends any redo chain and may push the oldest entry out.
  push(entry) {
    this.entries.length = this.cursor;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.cursor = this.entries.length;
  }

  // Both return the entry to apply, or null when there is nothing to do.
  undo() {
    return this.canUndo ? this.entries[--this.cursor] : null;
  }

  redo() {
    return this.canRedo ? this.entries[this.cursor++] : null;
  }

  clear() {
    this.entries = [];
    this.cursor = 0;
  }
}
