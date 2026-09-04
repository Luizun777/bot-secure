#!/usr/bin/env node
// bot-secure: puente entre los hooks git y el guard del workspace.
// Uso: node .githooks/run.mjs <pre-commit|pre-push|post-checkout> [args de git]   (cwd = raíz del repo; stdin = el de git)
// Localiza el workspace subiendo hasta .bot-secure/policy.json y ejecuta .claude/hooks/guard.mjs con el evento git-<hook>.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function findWorkspace(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.bot-secure', 'policy.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const [hook = 'pre-commit', ...args] = process.argv.slice(2);
const ws = findWorkspace(process.cwd());
if (!ws) {
  console.error(`bot-secure[${hook}]: no encuentro el workspace (.bot-secure/policy.json) desde ${process.cwd()}. Arreglo: bot-secure init`);
  process.exit(1);
}
const guard = join(ws, '.claude', 'hooks', 'guard.mjs');
if (!existsSync(guard)) {
  console.error(`bot-secure[${hook}]: falta ${guard}. Arreglo: bot-secure init`);
  process.exit(1);
}
let stdin = '';
if (hook === 'pre-push') { try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; } }
try {
  const mod = await import(pathToFileURL(guard).href);
  const code = await mod.main(`git-${hook}`, JSON.stringify({ cwd: process.cwd(), stdin, args }));
  process.exit(typeof code === 'number' ? code : 1);
} catch (e) {
  console.error(`bot-secure[${hook}]: error del guard (${e?.message ?? e}); operación rechazada. Arreglo: bot-secure doctor`);
  process.exit(1);
}
