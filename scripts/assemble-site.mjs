// Shared by Pages and its packaging test. Keep docs, tests and scripts private to source.
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? '_site');
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'styles.css', 'src', 'assets', 'sitemap.xml', '.nojekyll']) {
  await cp(path, resolve(output, path), { recursive: true });
}
