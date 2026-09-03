// Runner de pruebas portable (Node 20+, Windows incluido): busca *.test.mjs y ejecuta `node --test`.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const groups = process.argv.slice(2).length ? process.argv.slice(2) : ['unit'];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'tmp' && f !== 'fixtures') walk(p); } else if (/\.test\.mjs$/.test(f)) files.push(p); } };
for (const g of groups) { try { walk(join('test', g)); } catch { /* sin carpeta */ } }
if (!files.length) { console.log('No hay pruebas en', groups.join(', ')); process.exit(0); }
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
