import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { THEME_KEY, resolveTheme, normalizePreference } from '../src/theme.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const boot = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

// Runs the real inline script from index.html against a fake browser.
function bootTheme({ stored, storageThrows = false, systemDark = false, matchMediaThrows = false }) {
  const documentElement = { dataset: {} };
  const sandbox = {
    document: { documentElement },
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('blocked');
        return key === THEME_KEY && stored !== undefined ? stored : null;
      },
    },
    matchMedia(query) {
      if (matchMediaThrows) throw new Error('unsupported');
      assert.equal(query, '(prefers-color-scheme: dark)');
      return { matches: systemDark };
    },
  };
  vm.runInNewContext(boot, sandbox);
  return documentElement.dataset.theme;
}

test('index.html has an inline boot script before the stylesheet', () => {
  assert.ok(boot, 'inline script present');
  assert.ok(html.indexOf('<script>') < html.indexOf('rel="stylesheet"'), 'runs before styles paint');
});

test('boot script: first visit follows the system', () => {
  assert.equal(bootTheme({ systemDark: true }), 'dark');
  assert.equal(bootTheme({ systemDark: false }), 'light');
});

test('boot script: a stored explicit choice beats the system', () => {
  assert.equal(bootTheme({ stored: 'light', systemDark: true }), 'light');
  assert.equal(bootTheme({ stored: 'dark', systemDark: false }), 'dark');
});

test('boot script: junk or unreadable storage falls back to the system, not to light', () => {
  assert.equal(bootTheme({ stored: 'sepia', systemDark: true }), 'dark');
  assert.equal(bootTheme({ storageThrows: true, systemDark: true }), 'dark');
  assert.equal(bootTheme({ matchMediaThrows: true, stored: 'dark' }), 'dark');
  assert.equal(bootTheme({ matchMediaThrows: true }), 'light');
});

test('boot script agrees with the runtime theme rules for every combination', () => {
  for (const stored of [undefined, 'light', 'dark', 'system', 'junk']) {
    for (const systemDark of [false, true]) {
      const expected = resolveTheme(normalizePreference(stored), systemDark);
      assert.equal(bootTheme({ stored, systemDark }), expected, `stored=${stored} systemDark=${systemDark}`);
    }
  }
});
