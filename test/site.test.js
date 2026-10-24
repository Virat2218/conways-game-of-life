import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// Asset references only; "#id" fragments point inside the page (the icon sprite).
function assetRefs(html) {
  // Canonical and educational links are URLs, not deployable assets.
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map((m) => m[0]);
  return tags.filter((tag) => !/rel="canonical"/.test(tag))
    .flatMap((tag) => [...tag.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
}

test('index.html references assets with relative paths only', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const refs = assetRefs(html);
  assert.ok(refs.length > 0, 'expected at least one asset reference');
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/'), `absolute path breaks the Pages subpath: ${ref}`);
    assert.ok(!/^[a-z]+:/i.test(ref), `external URL is not allowed: ${ref}`);
  }
});

test('every referenced asset exists', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const ref of assetRefs(html)) {
    await access(new URL(ref, root));
  }
});

test('every icon the page uses is defined in the sprite', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const defined = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const id of used) assert.ok(defined.has(id), `#${id} is missing from the sprite`);
});

test('.nojekyll is present', async () => {
  await access(new URL('.nojekyll', root));
});

test('the page is titled and headed Conway\'s Game of Life, with no other branding', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /<title>Conway's Game of Life — Interactive Online Simulator<\/title>/);
  assert.match(html, /<h1[^>]*>Conway's Game of Life<\/h1>/);
  const files = [
    'index.html',
    'styles.css',
    'README.md',
    ...(await readdir(new URL('src/', root))).map((f) => `src/${f}`),
  ];
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.ok(!/life\s*lab/i.test(text), `${file} must not mention Life Lab`);
  }
});

test('the board is described as finite and wrapping, never infinite', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.ok(!/infinite/i.test(html), 'index.html must not call the board infinite');
});

test('shortcut controls expose their keyboard shortcuts to assistive technology', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const expected = new Map([
    ['play', 'Space'],
    ['step', 'N ArrowRight'],
    ['clear', 'C'],
    ['fit', 'F'],
    ['zoom-in', '+ ='],
    ['zoom-out', '- _'],
    ['undo', 'Control+Z Meta+Z'],
    ['redo', 'Control+Shift+Z Meta+Shift+Z Control+Y'],
  ]);

  for (const [id, shortcuts] of expected) {
    const tag = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `#${id} button must exist`);
    const actual = tag.match(/\baria-keyshortcuts="([^"]+)"/)?.[1];
    assert.equal(actual, shortcuts, `#${id} must declare ${shortcuts}`);
  }
});
