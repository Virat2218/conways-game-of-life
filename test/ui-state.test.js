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
