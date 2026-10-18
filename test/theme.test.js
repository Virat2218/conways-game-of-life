import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function tokens(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const light = tokens(css.match(/:root\s*{([^}]*)}/)[1]);
const dark = {
  ...light,
  ...tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)[1]),
};

function luminance(hex) {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['muted', 'surface'],
  ['accent-fg', 'accent'],
];
const UI_PAIRS = [
  ['focus', 'surface'],
  ['border', 'surface'],
  ['cell', 'board'],
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme text meets WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name} theme controls meet non-text contrast (3:1)`, () => {
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 3, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('dark theme overrides every canvas color', () => {
  const darkOnly = tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)[1]);
  for (const name of ['board-background', 'board', 'cell', 'grid-minor', 'grid-major', 'hover', 'ghost']) {
    assert.ok(name in light, `--${name} defined in light theme`);
    assert.ok(name in darkOnly, `--${name} overridden in dark theme`);
  }
});
