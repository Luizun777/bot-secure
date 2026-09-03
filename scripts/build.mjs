// Empaqueta el CLI y el guard en archivos únicos (dist/) y escribe sus sha256.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { console.error('Falta esbuild. Arreglo: npm install'); process.exit(2); }
mkdirSync('dist', { recursive: true });
const targets = [
  { entry: 'bin/bot-secure.mjs', out: 'dist/bot-secure.mjs', banner: '#!/usr/bin/env node' },
  { entry: 'src/guard/guard.mjs', out: 'dist/guard.mjs', banner: '' },
];
for (const t of targets) {
  await esbuild.build({ entryPoints: [t.entry], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: t.out, banner: { js: t.banner }, legalComments: 'none', logLevel: 'error' });
  const sha = createHash('sha256').update(readFileSync(t.out)).digest('hex');
  writeFileSync(`${t.out}.sha256`, `${sha}  ${t.out.split('/').pop()}\n`);
  console.log(`${t.out} ${sha.slice(0, 12)}…`);
}
