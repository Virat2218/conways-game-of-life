// Pattern definitions plus parsing and rotation. Pure, no DOM.
//
// A parsed pattern is { cells: [[x, y], ...], width, height } with every cell
// inside [0, width) × [0, height) and the bounding box touching the origin.

// Plaintext format: 'O' (or '*') is alive, '.' is dead, one row per line.
const PRESET_SOURCES = {
  glider: {
    name: 'Glider',
    source: `
.O.
..O
OOO`,
  },
  lwss: {
    name: 'Lightweight spaceship',
    source: `
.O..O
O....
O...O
OOOO.`,
  },
  gosper: {
    name: 'Gosper glider gun',
    source: `
........................O...........
......................O.O...........
............OO......OO............OO
...........O...O....OO............OO
OO........O.....O...OO..............
OO........O...O.OO....O.O...........
..........O.....O.......O...........
...........O...O....................
............OO......................`,
  },
  pulsar: {
    name: 'Pulsar',
    source: `
..OOO...OOO..
.............
O....O.O....O
O....O.O....O
O....O.O....O
..OOO...OOO..
.............
..OOO...OOO..
O....O.O....O
O....O.O....O
O....O.O....O
.............
..OOO...OOO..`,
  },
  pentadecathlon: {
    name: 'Pentadecathlon',
    source: `
..O....O..
OO.OOOO.OO
..O....O..`,
  },
  rpentomino: {
    name: 'R-pentomino',
    source: `
.OO
OO.
.O.`,
  },
  acorn: {
    name: 'Acorn',
    source: `
.O.....
...O...
OO..OOO`,
  },
  diehard: {
    name: 'Diehard',
    source: `
......O.
OO......
.O...OOO`,
  },
};

function normalize(cells) {
  if (cells.length === 0) return { cells: [], width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const out = cells.map(([x, y]) => [x - minX, y - minY]);
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { cells: out, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function parsePlaintext(text) {
  const cells = [];
  const lines = text.split(/\r?\n/).filter((line) => !line.startsWith('!'));
  // Drop leading/trailing blank lines but keep interior blank rows.
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines.at(-1).trim() === '') lines.pop();
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === 'O' || ch === '*') cells.push([x, y]);
      else if (ch !== '.' && ch !== ' ') throw new SyntaxError(`unexpected '${ch}' at ${x},${y}`);
    }
  });
  return normalize(cells);
}

export function parseRLE(text) {
  const body = text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#') && !/^\s*x\s*=/.test(line))
    .join('');
  const cells = [];
  let x = 0;
  let y = 0;
  let count = '';
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') {
      count += ch;
      continue;
    }
    const n = count ? Number(count) : 1;
    count = '';
    if (ch === 'b' || ch === '.') {
      x += n;
    } else if (ch === 'o' || ch === 'A') {
      for (let i = 0; i < n; i++) cells.push([x + i, y]);
      x += n;
    } else if (ch === '$') {
      y += n;
      x = 0;
    } else if (ch === '!') {
      break;
    } else if (!/\s/.test(ch)) {
      throw new SyntaxError(`unexpected '${ch}' in RLE`);
    }
  }
  return normalize(cells);
}

// Accepts either RLE or plaintext.
export function parse(text) {
  const looksRLE = /^\s*x\s*=/m.test(text) || /[bo$]/.test(text.replace(/^[#!].*$/gm, ''));
  return looksRLE ? parseRLE(text) : parsePlaintext(text);
}

// Rotates 90° clockwise and re-normalizes to the origin.
export function rotate(pattern) {
  const { cells, height } = pattern;
  return normalize(cells.map(([x, y]) => [height - 1 - y, x]));
}

export const PRESETS = Object.entries(PRESET_SOURCES).map(([id, { name, source }]) => ({
  id,
  name,
  ...parse(source),
}));

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) ?? null;
}
