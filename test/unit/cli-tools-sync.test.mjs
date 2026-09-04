// `bot-secure sync`: avance rápido de dev → ai-dev cuando el rango está limpio; cuarentena
// (sin merge) cuando el rango trae hallazgos. Los secretos del fixture son FALSOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';

const POLICY = {
  version: 1, project: 'tienda', profile: 'standard', lang: 'es',
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'main'] },
  apps: [{ name: 'api', path: 'api', kind: 'backend', stack: 'node' }],
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

/** Workspace con una app clonada de un remoto local (dev + ai-dev). */
function ws(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-sync-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  const upstream = join(root, 'upstream.git');
  spawnSync('git', ['init', '-q', '--bare', upstream], { encoding: 'utf8' });
  const api = join(root, 'api');
  const g = (...a) => spawnSync('git', a, { cwd: api, encoding: 'utf8' });
  mkdirSync(api, { recursive: true });
  g('init', '-q', '-b', 'dev');
  g('config', 'user.email', 'ana@ejemplo.invalid');
  g('config', 'user.name', 'Ana Prueba');
  writeFileSync(join(api, 'README.md'), 'hola\n');
  g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-qm', 'c1');
  g('remote', 'add', 'origin', upstream);
  g('push', '-q', 'origin', 'dev');
  g('branch', 'ai-dev', 'dev');
  g('checkout', '-q', 'ai-dev');
  return { root, home, api, g };
}

/** Añade un commit a dev en el remoto y vuelve a ai-dev. */
function commitOnDev({ g, api }, file, content) {
  g('checkout', '-q', 'dev');
  writeFileSync(join(api, file), content);
  g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-qm', `add ${file}`);
  g('push', '-q', 'origin', 'dev');
  g('checkout', '-q', 'ai-dev');
}

function cli({ root, home }, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: home, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env });
}

test('rango limpio: ai-dev avanza en fast-forward', (t) => {
  const w = ws(t);
  commitOnDev(w, 'nuevo.txt', 'contenido inocuo\n');
  const r = cli(w, 'sync');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /avanzó 1 commit/);
  assert.equal(existsSync(join(w.api, 'nuevo.txt')), true, 'ai-dev debe tener el archivo nuevo');
  assert.equal(existsSync(join(w.root, '.bot-secure', 'QUARANTINE.md')), false);

  const otra = cli(w, 'sync');
  assert.equal(otra.status, 0);
  assert.match(otra.stdout, /ya está al día/);
});

test('rango con un secreto: cuarentena, sin merge y exit 1', (t) => {
  const w = ws(t);
  commitOnDev(w, 'secreto.py', `aws_key = "${FAKE_AWS}"\n`);
  const r = cli(w, 'sync');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /NO se mergeó/);
  assert.equal(existsSync(join(w.api, 'secreto.py')), false, 'no debe haberse mergeado');

  const q = readFileSync(join(w.root, '.bot-secure', 'QUARANTINE.md'), 'utf8');
  assert.ok(!q.includes(FAKE_AWS), 'la cuarentena nunca lleva el valor');
  assert.match(q, /aws-access-key-id/);
  assert.match(q, /Ana Prueba/);          // autor
  assert.match(q, /\| `[0-9a-f]{12}` \|/); // commit
  assert.match(q, /\| `[0-9a-f]{16}` \|/); // huella
  assert.match(q, /Plazo para resolver: \d{4}-\d{2}-\d{2}/);
});

test('--dry-run dice qué haría y no mergea', (t) => {
  const w = ws(t);
  commitOnDev(w, 'nuevo.txt', 'contenido inocuo\n');
  const r = cli(w, 'sync', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /avanzaría 1 commit/);
  assert.equal(existsSync(join(w.api, 'nuevo.txt')), false);
});

test('--rebase-open lista las ramas de tarea abiertas', (t) => {
  const w = ws(t);
  commitOnDev(w, 'nuevo.txt', 'contenido inocuo\n');
  w.g('branch', 'ai/TCK-1-algo');
  const r = cli(w, 'sync', '--rebase-open', '--json');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.open.length, 1);
  assert.equal(data.open[0].branch, 'ai/TCK-1-algo');
});

test('sin remoto configurado explica qué falta', (t) => {
  const w = ws(t);
  w.g('remote', 'remove', 'origin');
  const r = cli(w, 'sync');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no hay remoto configurado/);
  assert.match(r.stdout, /Arreglo: git remote add origin/);
});
