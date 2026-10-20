import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const canonical = 'https://adisakshya.github.io/conways-game-of-life/';
const html = await readFile(new URL('index.html', root), 'utf8');
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => attributes(m[0]));
const meta = (key) => metas.find((m) => m.name === key || m.property === key)?.content;
const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => attributes(m[0]));

test('search and social metadata identify the same public canonical page', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.match(title, /Conway's Game of Life/);
  assert.ok(meta('description')?.length > 50);
  assert.deepEqual(links.filter((l) => l.rel === 'canonical').map((l) => l.href), [canonical]);
  assert.equal(meta('og:url'), canonical);
  assert.equal(meta('og:title'), title);
  assert.equal(meta('twitter:title'), title);
  assert.equal(meta('og:description'), meta('description'));
  assert.equal(meta('twitter:description'), meta('description'));
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.equal(meta('twitter:image'), meta('og:image'));
  assert.ok(meta('og:image:alt'));
  assert.ok(meta('twitter:image:alt'));
  assert.ok(!metas.some((m) => /^(robots|googlebot)$/i.test(m.name ?? '') && /noindex|none/i.test(m.content ?? '')));
});

test('structured data describes the real application without fabricated review claims', () => {
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.name, "Conway's Game of Life");
  assert.equal(data.url, canonical);
  assert.equal(data.image, meta('og:image'));
  assert.equal(data.description, meta('description'));
  assert.equal(data.isAccessibleForFree, true);
  for (const field of ['aggregateRating', 'review', 'award', 'downloadUrl']) assert.ok(!(field in data));
});

test('social image and raster icons exist at their advertised native dimensions', async () => {
  const imageUrl = new URL(meta('og:image'));
  assert.ok(imageUrl.href.startsWith(canonical));
  const png = await readFile(new URL(imageUrl.href.slice(canonical.length), root));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(Number(meta('og:image:width')), 1200);
  assert.equal(Number(meta('og:image:height')), 630);
  for (const link of links.filter((l) => /^(icon|apple-touch-icon)$/.test(l.rel) && l.type !== 'image/svg+xml')) {
    const image = await readFile(new URL(link.href, root));
    const [width, height] = link.sizes.split('x').map(Number);
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
  }
});

test('sitemap lists only the canonical homepage without fabricated timestamps or shared hashes', async () => {
  const xml = await readFile(new URL('sitemap.xml', root), 'utf8');
  assert.match(xml, /xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), [canonical]);
  assert.ok(!/<lastmod>|#pattern=/.test(xml));
});

test('initial HTML provides user-visible educational content without depending on JavaScript', () => {
  const content = html.match(/<section class="about-section"[\s\S]*?<\/section>/)?.[0];
  assert.ok(content);
  assert.match(content, /<details id="about"/);
  assert.match(content, /<summary>About/);
  assert.match(content, /eight neighbors/);
  assert.match(content, /simultaneously/);
  assert.match(content, /Birth:/);
  assert.match(content, /Survival:/);
  assert.match(content, /Death:/);
  assert.match(content, /Glider/);
  assert.match(content, /Pulsar/);
  assert.match(content, /Gosper glider gun/);
  assert.match(content, /256 × 160/);
  assert.match(content, /unbounded/);
  assert.match(content, /<noscript>/);
  assert.ok(!/\shidden(?:\s|>)/.test(content));
  assert.ok(html.indexOf('class="board-panel"') < html.indexOf('class="about-section"'));
});

test('the Pages assembly includes linked assets and sitemap, excluding development content', async () => {
  const output = await mkdtemp(join(tmpdir(), 'gol-pages-'));
  try {
    const workflow = await readFile(new URL('.github/workflows/pages.yml', root), 'utf8');
    assert.match(workflow, /run: node scripts\/assemble-site\.mjs/);
    execFileSync(process.execPath, ['scripts/assemble-site.mjs', output], { cwd: fileURLToPath(root) });
    assert.deepEqual((await readdir(output)).sort(), ['.nojekyll', 'assets', 'index.html', 'sitemap.xml', 'src', 'styles.css']);
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), html);
    const refs = links.filter((l) => l.rel !== 'canonical').map((l) => l.href);
    refs.push(new URL(meta('og:image')).href.slice(canonical.length));
    for (const path of refs) assert.ok((await readFile(join(output, path))).length > 0, path);
    assert.ok((await readFile(join(output, 'sitemap.xml'))).length > 0);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
