import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_KEY,
  normalizePreference,
  resolveTheme,
  loadPreference,
  savePreference,
  createThemeController,
} from '../src/theme.js';

function fakeStorage(initial = {}, { failWrites = false, failReads = false } = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      if (failReads) throw new Error('blocked');
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error('quota');
      data[key] = String(value);
    },
    removeItem(key) {
      if (failWrites) throw new Error('blocked');
      delete data[key];
    },
  };
}

function fakeMediaQuery(matches) {
  const listeners = new Set();
  return {
    matches,
    addEventListener: (_type, fn) => listeners.add(fn),
    // Simulates the OS switching between light and dark.
    setSystemDark(next) {
      this.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

function setup({ stored, systemDark = false, storageOptions } = {}) {
  const storage = fakeStorage(stored ? { [THEME_KEY]: stored } : {}, storageOptions);
  const mediaQuery = fakeMediaQuery(systemDark);
  const root = { dataset: {} };
  const changes = [];
  const controller = createThemeController({
    root,
    storage,
    mediaQuery,
    onChange: (theme, preference) => changes.push([theme, preference]),
  });
  return { storage, mediaQuery, root, changes, controller };
}

test('resolveTheme: explicit choices win, system follows the OS', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('normalizePreference treats anything unknown as system', () => {
  assert.equal(normalizePreference('dark'), 'dark');
  assert.equal(normalizePreference('light'), 'light');
  for (const junk of [undefined, null, '', 'system', 'sepia', 42]) {
    assert.equal(normalizePreference(junk), 'system');
  }
});

test('first visit follows the system preference', () => {
  assert.equal(setup({ systemDark: true }).root.dataset.theme, 'dark');
  assert.equal(setup({ systemDark: false }).root.dataset.theme, 'light');
});

test('a stored explicit choice beats the system on load', () => {
  assert.equal(setup({ stored: 'light', systemDark: true }).root.dataset.theme, 'light');
  assert.equal(setup({ stored: 'dark', systemDark: false }).root.dataset.theme, 'dark');
});

test('an invalid stored value is ignored', () => {
  const { root, controller } = setup({ stored: 'sepia', systemDark: true });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(controller.preference, 'system');
});

test('system changes update the theme only while the preference is system', () => {
  const followed = setup({ systemDark: false });
  followed.mediaQuery.setSystemDark(true);
  assert.equal(followed.root.dataset.theme, 'dark');
  followed.mediaQuery.setSystemDark(false);
  assert.equal(followed.root.dataset.theme, 'light');

  const explicit = setup({ systemDark: false });
  explicit.controller.setPreference('light');
  explicit.mediaQuery.setSystemDark(true);
  assert.equal(explicit.root.dataset.theme, 'light', 'explicit light survives a dark OS');
  explicit.controller.setPreference('dark');
  explicit.mediaQuery.setSystemDark(false);
  assert.equal(explicit.root.dataset.theme, 'dark', 'explicit dark survives a light OS');
});

test('an explicit selection persists across a reload', () => {
  const first = setup({ systemDark: false });
  first.controller.setPreference('dark');
  assert.equal(first.storage.data[THEME_KEY], 'dark');

  const reloaded = createThemeController({
    root: { dataset: {} },
    storage: first.storage,
    mediaQuery: fakeMediaQuery(false),
  });
  assert.equal(reloaded.preference, 'dark');
  assert.equal(reloaded.theme, 'dark');
});

test('choosing System forgets the explicit choice and follows the OS again', () => {
  const { storage, mediaQuery, root, controller } = setup({ stored: 'light', systemDark: true });
  assert.equal(root.dataset.theme, 'light');
  controller.setPreference('system');
  assert.equal(THEME_KEY in storage.data, false, 'nothing stored for system');
  assert.equal(root.dataset.theme, 'dark', 'now follows the dark OS');
  mediaQuery.setSystemDark(false);
  assert.equal(root.dataset.theme, 'light');
});

test('onChange runs after the attribute changes, once per actual theme change', () => {
  const { changes, controller, root } = setup({ systemDark: false });
  assert.deepEqual(changes, [['light', 'system']], 'initial application');
  controller.setPreference('light');
  assert.equal(changes.length, 1, 'same theme, no repaint needed');
  controller.setPreference('dark');
  assert.deepEqual(changes.at(-1), ['dark', 'dark']);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.dataset.themePreference, 'dark');
});

test('unavailable storage never breaks theming', () => {
  const blocked = setup({ systemDark: true, storageOptions: { failReads: true, failWrites: true } });
  assert.equal(blocked.root.dataset.theme, 'dark', 'reads fail, system still applies');
  blocked.controller.setPreference('light');
  assert.equal(blocked.root.dataset.theme, 'light', 'selection applies for this session');
  assert.equal(blocked.controller.persisted, false, 'and reports that it was not saved');

  const noStorage = createThemeController({
    root: { dataset: {} },
    storage: null,
    mediaQuery: fakeMediaQuery(false),
  });
  assert.equal(noStorage.setPreference('dark'), 'dark');
  assert.equal(noStorage.persisted, false);
});

test('loadPreference and savePreference swallow storage errors', () => {
  assert.equal(loadPreference(fakeStorage({}, { failReads: true })), 'system');
  assert.equal(loadPreference(null), 'system');
  assert.equal(savePreference(fakeStorage({}, { failWrites: true }), 'dark'), false);
  assert.equal(savePreference(fakeStorage(), 'dark'), true);
});
