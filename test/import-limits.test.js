import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, ParseError, parse, parsePlaintext, parseRLE, getPreset } from '../src/patterns.js';

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ParseError, `expected a ParseError, got ${e}`);
    return e.code;
  }
  return null;
};

test('text over the size limit is refused before it is read', () => {
  const big = 'x'.repeat(LIMITS.maxChars + 1);
  for (const fn of [parse, parsePlaintext, parseRLE]) assert.equal(code(() => fn(big)), 'too-large');
  assert.doesNotThrow(() => parse('O'.repeat(100)));
  assert.equal(code(() => parse('O'.repeat(100), { ...LIMITS, maxChars: 50 })), 'too-large');
});

test('runs and headers larger than the board are refused, with no huge allocation', () => {
  assert.equal(code(() => parseRLE('999999999999999999o!')), 'dimensions', 'absurd digit string');
  assert.equal(code(() => parseRLE('1000000o!')), 'dimensions', 'a run far wider than the board');
  assert.equal(code(() => parseRLE(`${LIMITS.maxWidth + 1}o!`)), 'dimensions', 'one cell too wide');
  assert.doesNotThrow(() => parseRLE(`${LIMITS.maxWidth}o!`));
  assert.equal(code(() => parseRLE('x = 257, y = 3\nbo!')), 'dimensions', 'declared width');
  assert.equal(code(() => parseRLE('x = 3, y = 161\nbo!')), 'dimensions', 'declared height');
  assert.equal(code(() => parseRLE(`${'o$'.repeat(LIMITS.maxHeight + 1)}!`)), 'dimensions', 'too many rows');
  assert.equal(code(() => parseRLE(`${LIMITS.maxHeight}$o!`)), 'dimensions', 'a live cell below the last row');
  assert.doesNotThrow(() => parseRLE(`${LIMITS.maxHeight - 1}$o!`));
});

test('the live-cell limit is enforced while parsing', () => {
  const tiny = { ...LIMITS, maxCells: 5 };
  assert.equal(code(() => parseRLE('3o$3o!', tiny)), 'cells');
  assert.equal(code(() => parsePlaintext('OOO\nOOO', tiny)), 'cells');
  assert.equal(parseRLE('3o$2o!', tiny).cells.length, 5, 'exactly at the limit is fine');
});

test('plaintext wider or taller than the board is refused', () => {
  assert.equal(code(() => parsePlaintext('O'.repeat(LIMITS.maxWidth + 1))), 'dimensions');
  assert.equal(code(() => parsePlaintext(Array(LIMITS.maxHeight + 1).fill('O').join('\n'))), 'dimensions');
  assert.doesNotThrow(() => parsePlaintext(Array(LIMITS.maxHeight).fill('O').join('\n')));
});

test('only Conway’s rule is accepted; others are refused instead of silently run as B3/S23', () => {
  for (const rule of ['B3/S23', 'b3/s23', '23/3']) {
    assert.doesNotThrow(() => parse(`x = 3, y = 3, rule = ${rule}\nbob$2bo$3o!`), rule);
  }
  for (const rule of ['B36/S23', 'B3/S2', 'B2/S', '12345/3', 'B3/S23/C3', 'Life']) {
    assert.equal(code(() => parse(`x = 3, y = 3, rule = ${rule}\nbob$2bo$3o!`)), 'rule', rule);
  }
  assert.doesNotThrow(() => parse('x = 3, y = 3\nbob$2bo$3o!'), 'no rule means the default');
});

test('malformed text is a syntax error naming where, never a partial result', () => {
  assert.equal(code(() => parseRLE('bo?$3o!')), 'syntax');
  assert.equal(code(() => parseRLE('x = three\nbo!')), 'syntax', 'unreadable header');
  assert.equal(code(() => parsePlaintext('OO\nO?')), 'syntax');
  assert.match(new ParseError('x', 'syntax').name, /ParseError/);
  assert.throws(() => parsePlaintext('O\nOZ'), /row 2/);
});

test('plaintext and RLE are told apart reliably, comments included', () => {
  const glider = getPreset('glider').cells;
  assert.deepEqual(parse('!Name: glider\n.O.\n..O\nOOO').cells, glider);
  assert.deepEqual(parse('#C a comment with o and b in it\nx = 3, y = 3\nbo$2bo$3o!').cells, glider);
  assert.deepEqual(parse('bo$2bo$3o!').cells, glider, 'RLE without a header');
  assert.deepEqual(parse('.O.\r\n..O\r\nOOO\r\n').cells, glider, 'CRLF plaintext');
  assert.deepEqual(parse('').cells, [], 'nothing at all is an empty pattern (importers reject it)');
});

test('RLE that ends before its terminator is refused, never loaded as a partial pattern', () => {
  for (const text of ['x = 3, y = 2\n3o$2', 'x = 3, y = 3\nbo$2bo$3o', '3o$', '3o$2', '12', 'bo$2bo$3', 'x = 3, y = 3, rule = B3/S23\n']) {
    assert.equal(code(() => parseRLE(text)), 'syntax', JSON.stringify(text));
    if (!/^x = 3, y = 3, rule = B3\/S23\n$/.test(text)) assert.equal(code(() => parse(text)), 'syntax', `parse: ${JSON.stringify(text)}`);
  }
  assert.deepEqual(parseRLE('3o!').cells, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(parseRLE('x = 3, y = 3\nbo$2bo$3o!\nignored after the terminator').cells, getPreset('glider').cells);
});

test('cells beyond the size the RLE header declares are refused, but a larger declared size is fine', () => {
  for (const text of ['x = 1, y = 1\n2o!', 'x = 3, y = 1\nbo$bo!', 'x = 2, y = 2\nbo$2bo$3o!', 'x = 3, y = 3\n3o$3o$3o$o!']) {
    assert.equal(code(() => parseRLE(text)), 'dimensions', JSON.stringify(text));
  }
  assert.deepEqual(parseRLE('x = 3, y = 3\nbo$2bo$3o!').cells, getPreset('glider').cells, 'exact declaration');
  assert.deepEqual(parseRLE('x = 10, y = 10\n3o!').cells, [[0, 0], [1, 0], [2, 0]], 'a roomier declaration is allowed');
  assert.deepEqual(parseRLE('3o!').cells.length, 3, 'no header, nothing to check against');
});

test('dead runs and row ends past the board are refused even when no live cell follows', () => {
  for (const text of ['o160$!', 'o256b!', 'o300$!', 'o999999b!', 'o$'.repeat(LIMITS.maxHeight) + '!']) {
    assert.equal(code(() => parseRLE(text)), 'dimensions', text.slice(0, 20));
  }
  assert.doesNotThrow(() => parseRLE(`o${LIMITS.maxWidth - 1}b!`), 'right up to the edge is fine');
  assert.doesNotThrow(() => parseRLE(`o${LIMITS.maxHeight - 1}$!`), 'down to the last row is fine');
  assert.doesNotThrow(() => parseRLE(`${'o$'.repeat(LIMITS.maxHeight - 1)}o!`), 'exactly 160 rows is fine');
});
