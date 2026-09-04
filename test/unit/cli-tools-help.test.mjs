// Contrato de superficie de los comandos de herramientas: cada uno responde a --help con su uso,
// aparece en la ayuda general en el bloque que le toca, y ci/org-pack escriben sus artefactos
// (o explican el arreglo exacto cuando el proveedor o el modo no existen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');
const COMANDOS = ['scan', 'sanitize', 'baseline', 'attest', 'ci', 'org-pack', 'sync'];

function home(t) {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  return h;
}

function run(cwd, h, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: h, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env });
}

function ws(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-help-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify({
    version: 1, project: 'tienda', profile: 'standard', lang: 'es',
    branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev'] },
    apps: [], scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
  }));
  return root;
}

test('cada comando responde a --help con su uso (es y en)', (t) => {
  const h = home(t);
  for (const c of COMANDOS) {
    const es = run(tmpdir(), h, c, '--help');
    assert.equal(es.status, 0, `${c} --help: ${es.stderr}`);
    assert.match(es.stdout, new RegExp(`^bot-secure ${c.replace('-', '\\-')}`), `${c} debe imprimir su uso`);
    const en = run(tmpdir(), h, '--lang', 'en', c, '--help');
    assert.equal(en.status, 0, `${c} --help en: ${en.stderr}`);
    assert.ok(en.stdout.trim().length > 0);
  }
});

test('scan es un comando básico y el resto son avanzados', (t) => {
  const h = home(t);
  const r = run(tmpdir(), h, '--help');
  assert.equal(r.status, 0, r.stderr);
  const [basicos, avanzados] = r.stdout.split(/^Avanzado$/m);
  assert.match(basicos, /^\s+scan\s+/m, 'scan va en la lista básica');
  for (const c of ['sanitize', 'baseline', 'attest', 'ci', 'org-pack', 'sync']) {
    assert.match(avanzados, new RegExp(`^\\s+${c.replace('-', '\\-')}\\s+`, 'm'), `${c} va en Avanzado`);
  }
});

test('ci: proveedor y modo desconocidos llevan su arreglo', (t) => {
  const h = home(t);
  const root = ws(t);
  const prov = run(root, h, 'ci', 'jenkins');
  assert.equal(prov.status, 2);
  assert.match(prov.stderr, /Proveedor de CI desconocido/);
  assert.match(prov.stdout, /Arreglo: bot-secure ci github/);

  const modo = run(root, h, 'ci', 'github', '--mode', 'gritar');
  assert.equal(modo.status, 2);
  assert.match(modo.stderr, /Modo desconocido/);
  assert.match(modo.stdout, /Arreglo: bot-secure ci github --mode block/);

  const v11 = run(root, h, 'ci', 'gitlab');
  assert.equal(v11.status, 2);
  assert.match(v11.stderr, /versión 1\.1/);
});

test('ci github escribe los workflows y dice cómo hacer el check obligatorio', (t) => {
  const h = home(t);
  const root = ws(t);
  const r = run(root, h, 'ci', 'github');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(root, '.github', 'workflows', 'bot-secure.yml')));
  assert.match(r.stdout, /obligatorio en la rama dev/);
  assert.match(r.stdout, /Require status checks/);

  const warn = run(root, h, 'ci', 'github', '--mode', 'warn', '--dry-run', '--json');
  const data = JSON.parse(warn.stdout);
  assert.equal(data.mode, 'warn');
  assert.ok(data.artifacts.length >= 1);
});

test('org-pack escribe infosec/ y apunta al responsable de Seguridad', (t) => {
  const h = home(t);
  const root = ws(t);
  const r = run(root, h, 'org-pack');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(root, 'infosec', 'managed-settings.json')));
  assert.ok(existsSync(join(root, 'infosec', 'apply.sh')));
  assert.match(r.stdout, /infosec\//);
});

test('fuera de un workspace, sanitize y scan no revientan', (t) => {
  const h = home(t);
  const vacio = realpathSync(mkdtempSync(join(tmpdir(), 'bs-vacio-')));
  t.after(() => rmSync(vacio, { recursive: true, force: true }));
  const r = run(vacio, h, 'scan');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Escaneo terminado/);
});
