// `bot-secure attest`: manifiesto de evidencia con el sha256 REAL del reporte, los commits de
// cada app, las versiones y el firmante con el correo enmascarado (nunca datos personales en claro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
// Correo de prueba: dominio inexistente, no es de nadie.
const TEST_EMAIL = 'ana.prueba@ejemplo.invalid';

const POLICY = {
  version: 1, project: 'tienda', profile: 'sensitive', lang: 'es',
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'main'] },
  apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'node' }],
  owners: { repoOwner: '', infosec: '', platform: '' },
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

function ws(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-att-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  writeFileSync(join(root, 'backend', 'config.json'), JSON.stringify({ aws_access_key_id: FAKE_AWS }, null, 2) + '\n');
  // Repo git con firmante propio: el manifiesto debe enmascarar el correo.
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'ai-dev');
  git('config', 'user.email', TEST_EMAIL);
  git('config', 'user.name', 'Ana Prueba');
  git('add', '-A');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'inicial');
  return { root, home };
}

function cli({ root, home }, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: home, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env });
}

const manifests = (root) => {
  const dir = join(root, '.bot-secure', 'attest');
  return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
};

test('el manifiesto lleva el sha256 correcto del reporte y no expone datos personales', (t) => {
  const w = ws(t);
  cli(w, 'scan');
  const r = cli(w, 'attest', '--rotation-id', 'SEC-123');
  assert.equal(r.status, 0, r.stderr);

  const files = manifests(w.root);
  assert.equal(files.length, 1, 'debe escribir un manifiesto');
  assert.match(files[0], /\d{4}-\d{2}-\d{2}\.json$/);
  const m = JSON.parse(readFileSync(files[0], 'utf8'));

  const real = createHash('sha256').update(readFileSync(join(w.root, '.bot-secure', 'reports', 'report.json'))).digest('hex');
  assert.equal(m.report.sha256, real, 'el sha256 del reporte no cuadra');
  assert.equal(m.report.reportSha256, JSON.parse(readFileSync(join(w.root, '.bot-secure', 'reports', 'report.json'), 'utf8')).reportSha256);
  assert.equal(m.rotationId, 'SEC-123');
  assert.equal(m.project, 'tienda');
  assert.equal(typeof m.manifestSha256, 'string');

  const text = JSON.stringify(m);
  assert.ok(!text.includes(TEST_EMAIL), 'el correo del firmante no puede ir en claro');
  assert.ok(!text.includes(FAKE_AWS), 'el manifiesto nunca lleva el valor de un secreto');
  assert.match(m.signer.emailMasked, /^a\*+@ejemplo\.invalid$/);
  assert.equal(m.signer.name, 'Ana Prueba');

  // doctor se ejecuta por import (sin spawn) y sus mensajes van saneados
  assert.equal(m.doctor.available, true);
  assert.ok(Array.isArray(m.doctor.rows) && m.doctor.rows.length > 0, 'faltan las filas del diagnóstico');
  assert.ok(m.doctor.rows.every((r) => typeof r.state === 'string'));
});

test('registra el commit y la rama de cada app y las versiones', (t) => {
  const w = ws(t);
  cli(w, 'scan');
  cli(w, 'attest');
  const m = JSON.parse(readFileSync(manifests(w.root)[0], 'utf8'));
  assert.equal(m.apps.length, 1);
  assert.equal(m.apps[0].name, 'backend');
  assert.match(m.apps[0].commit ?? '', /^[0-9a-f]{40}$/);
  assert.equal(m.apps[0].branch, 'ai-dev');
  assert.equal(typeof m.versions.rules, 'string');
  assert.match(m.versions.bot, /^\d+\.\d+\.\d+$/);
  assert.equal(m.versions.node, process.version);
});

test('--dry-run no escribe el manifiesto y --json solo imprime datos', (t) => {
  const w = ws(t);
  cli(w, 'scan');
  const r = cli(w, 'attest', '--dry-run', '--json');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.dryRun, true);
  assert.equal(manifests(w.root).length, 0);
});

test('sin reporte previo avisa y escribe igualmente la evidencia disponible', (t) => {
  const w = ws(t);
  const r = cli(w, 'attest');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /No hay reporte todavía/);
  const m = JSON.parse(readFileSync(manifests(w.root)[0], 'utf8'));
  assert.equal(m.report.present, false);
});

test('fuera de un workspace o repo, error con el arreglo exacto', (t) => {
  const vacio = realpathSync(mkdtempSync(join(tmpdir(), 'bs-nada-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(vacio, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const r = cli({ root: vacio, home }, 'attest');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Arreglo: bot-secure start/);
});
