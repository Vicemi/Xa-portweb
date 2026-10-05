// Regenerates public/assets/manifest.json (the list of bundled game files the web build can load).
// Run it after adding or removing files under public/assets — e.g. a new level TMX for a mod:
//   npm run manifest
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const base = join(root, 'assets');
const out = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name !== 'manifest.json') out.push(relative(root, p).split(sep).join('/').toLowerCase());
  }
})(base);
out.sort();
writeFileSync(join(base, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`manifest.json: ${out.length} files`);
