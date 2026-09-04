// E2E del camino principal con el CLI real: workspace temporal → `init` → los artefactos que
// promete el README existen y `verifyIntegrity` da ok → `doctor --json` y `status` funcionan
// sobre él → `claude` sin CLI instalado explica cómo abrir la app de escritorio.
// La evidencia real se guarda en evidence/cli-core.txt.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPolicy, isGuardArtifact, verifyIntegrity } from '../../src/policy/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const BIN = join(REPO, 'bin', 'bot-secure.mjs');
const EVIDENCE = join(HERE, 'evidence', 'cli-core.txt');

let TMP, WS, BIN_DIR;
const log = [];
const rec = (titulo, cuerpo) => log.push(`\n### ${titulo}\n${String(cuerpo).trim()}`);

/** Ejecuta el CLI real y guarda la salida para la evidencia. */
function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP, PATH: BIN_DIR },
  });
  rec(`bot-secure ${args.join(' ')}  (exit ${r.status})`, (r.stdout || '') + (r.stderr || ''));
  return r;
}

before(() => {
  // Fuera del repo del bot: dentro, findGitRoot encontraría el propio bot-secure.
  TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-e2e-cli-core-'));
  WS = join(TMP, 'tienda-ai');
  BIN_DIR = join(TMP, 'bin');
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(join(WS, '.bot-secure'), { recursive: true });
  writeFileSync(join(WS, '.bot-secure', 'policy.json'), JSON.stringify(defaultPolicy({ project: 'tienda' }), null, 2));
});

after(() => {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  const texto = log.join('\n').split(TMP).join('<tmp>').split(REPO).join('<repo>');
  writeFileSync(EVIDENCE, [
    '# Evidencia real: test/e2e/cli-core-init.test.mjs',
    `# Generado: ${new Date().toISOString()}`,
    `# node ${process.version} · ${process.platform}`,
    texto, '',
  ].join('\n'));
  rmSync(TMP, { recursive: true, force: true });
});

test('init deja el workspace completo y la integridad en verde', () => {
  const r = cli(WS, 'init', '--yes');
  assert.equal(r.status, 0, r.stderr);
  for (const rel of [
    join('.claude', 'settings.json'), join('.claude', 'hooks', 'guard.mjs'), join('.claude', 'hooks', 'run'),
    'CLAUDE.md', 'AGENTS.md', join('docs', 'INDEX.md'), join('.githooks', 'pre-commit'), join('.bot-secure', 'lock.json'),
  ]) {
    assert.ok(existsSync(join(WS, rel)), `falta ${rel}`);
  }
  const { ok, drift } = verifyIntegrity(WS, { only: isGuardArtifact });
  assert.equal(ok, true, `drift inesperado: ${JSON.stringify(drift)}`);
  rec('verifyIntegrity (solo guardas)', JSON.stringify({ ok, drift }, null, 2));
});

test('init dos veces seguidas no cambia nada', () => {
  const r = cli(WS, 'init', '--yes', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.created, 0);
  assert.equal(out.summary.updated, 0);
});

test('doctor --json describe el workspace y status lo resume', () => {
  const d = cli(WS, 'doctor', '--json');
  const out = JSON.parse(d.stdout);
  assert.equal(out.root, WS);
  assert.ok(out.rows.some((x) => x.id === 'integrity' && x.state === 'ok'), 'la integridad debe estar en verde');
  assert.ok(out.rows.every((x) => x.state === 'ok' || x.fix), 'toda fila que no esté OK debe traer su arreglo');
  const s = cli(WS, 'status');
  assert.ok([0, 2].includes(s.status), `status devolvió ${s.status}`);
  assert.match(s.stdout, /tienda/);
});

test('manipular guard.mjs a mano se detecta como drift (salida 3)', () => {
  const guard = join(WS, '.claude', 'hooks', 'guard.mjs');
  const original = readFileSync(guard, 'utf8');
  writeFileSync(guard, original + '\n// alguien lo tocó\n');
  const r = cli(WS, 'doctor', '--json');
  assert.equal(r.status, 3, 'drift debe salir con 3');
  const out = JSON.parse(r.stdout);
  assert.equal(out.state, 'drift');
  assert.match(out.rows.find((x) => x.id === 'integrity').fix, /bot-secure init/);
  writeFileSync(guard, original);
});

test('claude sin CLI en el PATH explica cómo abrir la app de escritorio y sale 0', () => {
  const r = cli(WS, 'claude');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(WS), 'debe decir exactamente qué carpeta abrir');
});
