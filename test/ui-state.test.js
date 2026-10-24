import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI } from '../src/ui.js';

function keyEvent(key, target) {
  return { key, target, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} };
}

function recordingActions() {
  const calls = [];
  const names = ['togglePlay', 'step', 'clear', 'zoomIn', 'zoomOut', 'fit', 'rotate', 'escape'];
  const actions = Object.fromEntries(names.map((n) => [n, () => calls.push(n)]));
  return { actions, calls };
}

const outside = { tagName: 'BODY', closest: () => null };
const insideDialog = { tagName: 'BUTTON', closest: (sel) => (sel === 'dialog' ? {} : null) };
const radio = { tagName: 'INPUT', closest: () => null };

test('keys pressed inside the Help dialog never reach the shortcuts', () => {
  const { actions, calls } = recordingActions();
  for (const key of [' ', 'n', 'ArrowRight', 'c', 'f', 'r', '+', '-', 'Escape']) {
    UI.prototype.onKeyDown.call({ actions }, keyEvent(key, insideDialog));
  }
  assert.deepEqual(calls, [], 'Escape closes the dialog without also pausing the simulation');
});

test('the same keys still work on the page, but only Escape passes through form controls', () => {
  const page = recordingActions();
  for (const key of [' ', 'n', 'Escape']) UI.prototype.onKeyDown.call({ actions: page.actions }, keyEvent(key, outside));
  assert.deepEqual(page.calls, ['togglePlay', 'step', 'escape']);

  const form = recordingActions();
  for (const key of [' ', 'n', 'ArrowRight', 'Escape']) UI.prototype.onKeyDown.call({ actions: form.actions }, keyEvent(key, radio));
  assert.deepEqual(form.calls, ['escape'], 'arrow keys and Space stay with the focused radio');
});

function toolState(tool, placing) {
  return {
    tool,
    placing,
    el: { toolGroup: { dataset: {} }, toolLabel: {}, hintTool: {} },
  };
}

test('the tool label and hint always say what a drag will do', () => {
  for (const [tool, label, hint] of [
    ['draw', 'Draw cells', /add cells/],
    ['erase', 'Erase cells', /remove cells/],
    ['pan', 'Pan the view', /move the view/],
  ]) {
    const ui = toolState(tool, null);
    UI.prototype.refreshToolText.call(ui);
    assert.equal(ui.el.toolLabel.textContent, label);
    assert.match(ui.el.hintTool.textContent, hint);
    assert.equal(ui.el.toolGroup.dataset.placing, undefined);
  }
});

test('placing a pattern is shown as a temporary mode, and the tool is restored afterwards', () => {
  const ui = toolState('erase', 'Pulsar');
  UI.prototype.refreshToolText.call(ui);
  assert.equal(ui.el.toolGroup.dataset.placing, 'true');
  assert.equal(ui.el.toolLabel.textContent, 'Placing Pulsar');
  assert.match(ui.el.hintTool.textContent, /Placing Pulsar/);
  ui.placing = null;
  UI.prototype.refreshToolText.call(ui);
  assert.equal(ui.el.toolGroup.dataset.placing, undefined);
  assert.equal(ui.el.toolLabel.textContent, 'Erase cells', 'back to the tool that was selected');
});

test('showTool checks the matching radio, marks the board and refreshes the text', () => {
  const inputs = ['draw', 'erase', 'pan'].map((value) => ({ value, checked: value === 'draw' }));
  const ui = {
    ...toolState('draw', null),
    toolInputs: inputs,
    refreshToolText: UI.prototype.refreshToolText,
  };
  ui.el.board = { dataset: {} };
  UI.prototype.showTool.call(ui, 'pan');
  assert.deepEqual(inputs.map((i) => i.checked), [false, false, true]);
  assert.equal(ui.el.board.dataset.tool, 'pan');
  assert.equal(ui.el.toolLabel.textContent, 'Pan the view');
});

test('Randomize passes the selected density to its action', () => {
  const calls = [];
  const ui = {
    actions: { randomize: (density) => calls.push(density) },
    el: { randomDensity: { value: '0.1' } },
  };
  for (const density of ['0.1', '0.25', '0.5']) {
    ui.el.randomDensity.value = density;
    UI.prototype.randomize.call(ui);
  }
  assert.deepEqual(calls, [0.1, 0.25, 0.5]);
});

function chord(key, extra, target = outside) {
  return { key, target, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() { this.prevented = true; }, ...extra };
}

function historyActions() {
  const calls = [];
  const record = (n) => () => calls.push(n);
  return { calls, actions: { undo: record('undo'), redo: record('redo'), togglePlay: record('play'), step: record('step'), clear: record('clear'), zoomIn() {}, zoomOut() {}, fit() {}, rotate() {}, escape() {} } };
}

test('Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo', () => {
  const { calls, actions } = historyActions();
  const press = (e) => UI.prototype.onKeyDown.call({ actions }, e);
  const undoPress = chord('z', { ctrlKey: true });
  press(undoPress);
  press(chord('z', { metaKey: true }));
  press(chord('Z', { ctrlKey: true, shiftKey: true }));
  press(chord('z', { metaKey: true, shiftKey: true }));
  press(chord('y', { ctrlKey: true }));
  assert.deepEqual(calls, ['undo', 'undo', 'redo', 'redo', 'redo']);
  assert.equal(undoPress.prevented, true);
});

test('history shortcuts leave text fields, selects, dialogs, Alt chords and plain keys alone', () => {
  const { calls, actions } = historyActions();
  const press = (e) => UI.prototype.onKeyDown.call({ actions }, e);
  press(chord('z', { ctrlKey: true }, { tagName: 'INPUT', type: 'text', closest: () => null }));
  press(chord('z', { ctrlKey: true }, { tagName: 'TEXTAREA', closest: () => null }));
  press(chord('z', { metaKey: true }, { tagName: 'DIV', isContentEditable: true, closest: () => null }));
  press(chord('z', { ctrlKey: true }, { tagName: 'SELECT', closest: () => null }));
  press(chord('z', { ctrlKey: true }, { tagName: 'BUTTON', closest: (sel) => (sel === 'dialog' ? {} : null) }));
  press(chord('z', { ctrlKey: true, altKey: true }));
  press(chord('z', {}));
  press(chord('x', { ctrlKey: true }));
  assert.deepEqual(calls, [], 'native undo and typing are untouched');
  // Radios and sliders have no text to undo, so the app shortcut still applies there.
  press(chord('z', { ctrlKey: true }, { tagName: 'INPUT', type: 'radio', closest: () => null }));
  assert.deepEqual(calls, ['undo']);
});
