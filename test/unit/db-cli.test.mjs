// El comando `db` visto desde fuera: cada mensaje debe decir el siguiente paso y --json debe
// imprimir SOLO datos en stdout (para CI). Se ejecuta el binario real en un workspace temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');

const POLICY = {
  version: 1, project: 'tienda', profile: 'standard', level: 1, mode: 'clone', runtime: 'tests',
  autoSwitch: false, requireOrgAccount: false, lang: 'es',
  guard: { mode: 'block', strictRead: false, docsReminder: false, promptBlockSeverity: 'HIGH' },
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'main'] },
  apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'node' }],
  db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app', generic: true, rows: 5, seed: 42 },
  network: { allowedDomains: [], registries: [], prodHosts: [] }, mcp: { allowed: [] },
  owners: { repoOwner: '', infosec: '', platform: '' },
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

function ws(t) {
  const root = mkdtempSync(join(tmpdir(), 'bs-dbcli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  writeFileSync(join(root, 'backend', 'package.json'), JSON.stringify({ name: 'backend', dependencies: { pg: '^8' } }));
  return root;
}

const cli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

test('`db --help` muestra el uso con los subcomandos y las banderas', () => {
  const r = cli(tmpdir(), 'db', '--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /db <init\|up\|down\|reset\|seed\|dump\|status>/);
  assert.match(r.stdout, /--rows N/);
});

test('fuera de un workspace: error con el arreglo exacto', (t) => {
  const vacio = mkdtempSync(join(tmpdir(), 'bs-nows-'));
  t.after(() => rmSync(vacio, { recursive: true, force: true }));
  const r = cli(vacio, 'db', 'status');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /workspace de IA/);
  assert.match(r.stdout, /Arreglo: bot-secure start/);
});

test('`db init` escribe los artefactos y dice el siguiente paso', (t) => {
  const root = ws(t);
  const r = cli(root, 'db', 'init');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Siguiente paso: bot-secure db up/);
  for (const rel of ['compose.db.yml', 'migrate.sh', 'README.md']) {
    assert.ok(existsSync(join(root, 'mocks', 'db', rel)), `falta mocks/db/${rel}`);
  }
});

test('`db init --dry-run` no escribe nada', (t) => {
  const root = ws(t);
  const r = cli(root, 'db', 'init', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--dry-run/);
  assert.equal(existsSync(join(root, 'mocks', 'db', 'compose.db.yml')), false);
});

test('`db init --json` imprime SOLO JSON en stdout', (t) => {
  const root = ws(t);
  const r = cli(root, 'db', 'init', '--engine', 'mongo', '--rows', '3', '--seed', '9', '--json');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.command, 'db init');
  assert.equal(data.engine, 'mongo');
  assert.equal(data.port, 27018, 'al cambiar de motor se usa SU puerto alternativo');
  assert.equal(data.rows, 3);
  assert.equal(data.seed, 9);
});

test('subcomando desconocido: exit 2 con arreglo', (t) => {
  const root = ws(t);
  const r = cli(root, 'db', 'frobnicate');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Subcomando desconocido/);
  assert.match(r.stdout, /Arreglo: bot-secure db status/);
});

test('`db dump` sin --synthetic se rechaza; con --synthetic exporta las semillas', (t) => {
  const root = ws(t);
  const malo = cli(root, 'db', 'dump');
  assert.equal(malo.status, 2);
  assert.match(malo.stdout, /Arreglo: bot-secure db dump --synthetic/);
  const bueno = cli(root, 'db', 'dump', '--synthetic', '--json');
  assert.equal(bueno.status, 0, bueno.stderr);
  assert.match(JSON.parse(bueno.stdout).file, /seeds\/001-sinteticos\.postgres\.sql$/);
});

test('sin Docker el aviso explica el arreglo y `runtime: tests` no rompe el flujo', (t) => {
  const root = ws(t);
  cli(root, 'db', 'init');
  const r = cli(root, 'db', 'up');
  assert.equal(r.status, 0, r.stderr);
  const salida = r.stdout + r.stderr;
  assert.match(salida, /Siguiente paso: bot-secure db status/);
});
