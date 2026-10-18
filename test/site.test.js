import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('index.html references assets with relative paths only', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected at least one asset reference');
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/'), `absolute path breaks the Pages subpath: ${ref}`);
    assert.ok(!/^[a-z]+:/i.test(ref), `external URL is not allowed: ${ref}`);
  }
});

test('every referenced asset exists', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    await access(new URL(ref, root));
  }
});

test('.nojekyll is present', async () => {
  await access(new URL('.nojekyll', root));
});
