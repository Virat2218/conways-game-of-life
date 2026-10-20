import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_COLORS } from '../src/renderer.js';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function tokens(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const lightOnly = tokens(css.match(/^:root\s*{([^}]*)}/m)[1]);
const darkOnly = tokens(css.match(/^:root\[data-theme="dark"\]\s*{([^}]*)}/m)[1]);
const light = lightOnly;
const dark = { ...lightOnly, ...darkOnly };

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

// Foreground, background pairs where the foreground is text (WCAG AA 4.5:1).
const TEXT_PAIRS = [
  ['fg', 'bg'],
  ['fg', 'panel'],
  ['fg', 'panel-2'],
  ['muted', 'bg'],
  ['muted', 'panel'],
  ['muted', 'panel-2'],
  ['accent', 'panel'], // eyebrow and population use the accent as text
  ['accent', 'bg'],
  ['accent-ink', 'accent'], // label on the primary button and selected theme option
];
// Non-text pieces that identify a control or its state (WCAG 3:1).
const UI_PAIRS = [
  ['focus', 'panel'],
  ['focus', 'bg'],
  ['accent', 'panel'], // slider thumb, active pattern outline, status dot
  ['track', 'panel'], // slider track
  ['cell', 'board'], // live cells on the board
  ['hover', 'board'], // hover outline on the board
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme text meets WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name} theme controls and focus meet non-text contrast (3:1)`, () => {
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 3, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('the dark theme overrides every canvas token the light theme defines', () => {
  const canvasTokens = ['board-background', 'board', 'cell', 'grid-minor', 'grid-major', 'hover', 'ghost'];
  for (const name of canvasTokens) {
    assert.ok(name in lightOnly, `--${name} defined for light`);
    assert.ok(name in darkOnly, `--${name} overridden for dark`);
    assert.notEqual(lightOnly[name], darkOnly[name], `--${name} differs between themes`);
  }
});

test('the dark theme is not a plain inversion: it overrides the surface and accent tokens too', () => {
  for (const name of ['bg', 'panel', 'border', 'fg', 'muted', 'accent', 'accent-ink', 'focus', 'track']) {
    assert.ok(name in darkOnly, `--${name} overridden for dark`);
  }
});

test('the renderer fallback palette matches the light theme', () => {
  const normalize = (v) => v.replace(/\s+/g, '').toLowerCase();
  assert.equal(normalize(DEFAULT_COLORS.background), normalize(light['board-background']));
  assert.equal(normalize(DEFAULT_COLORS.board), normalize(light.board));
  assert.equal(normalize(DEFAULT_COLORS.cell), normalize(light.cell));
  assert.equal(normalize(DEFAULT_COLORS.gridMinor), normalize(light['grid-minor']));
  assert.equal(normalize(DEFAULT_COLORS.gridMajor), normalize(light['grid-major']));
  assert.equal(normalize(DEFAULT_COLORS.hover), normalize(light.hover));
  assert.equal(normalize(DEFAULT_COLORS.ghost), normalize(light.ghost));
});

test('the keyboard cursor is visible on the board and on live cells in both themes, and defined for both', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    assert.ok(contrast(theme.cursor, theme.board) >= 3, `${name}: cursor on an empty cell`);
    assert.ok(contrast(theme['cursor-halo'], theme.cell) >= 3, `${name}: halo against a live cell`);
    assert.ok(contrast(theme.cursor, theme['cursor-halo']) >= 3, `${name}: the two ring colours differ clearly`);
    assert.ok(contrast(theme.cursor, theme['board-background']) >= 3, `${name}: cursor beyond the board edge`);
  }
  assert.notEqual(light.cursor, dark.cursor);
  const normalize = (v) => v.replace(/\s+/g, '').toLowerCase();
  assert.equal(normalize(DEFAULT_COLORS.cursor), normalize(light.cursor));
  assert.equal(normalize(DEFAULT_COLORS.cursorHalo), normalize(light['cursor-halo']));
});
