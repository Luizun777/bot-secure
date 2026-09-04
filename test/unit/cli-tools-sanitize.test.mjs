// `bot-secure sanitize`: --dry-run muestra el diff (enmascarado) y no escribe nada; --apply deja
// el campo vacío en la configuración versionada, la variable de entorno en el código, las reglas
// FUERA del repositorio y SANITIZE-TODO.md con lo manual.
// Los secretos de este archivo son FALSOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
const FAKE_GH = 'ghp_' + '0123456789abcdefghijklmnopqrstuvwxyzAB';

const POLICY = {
  version: 1, project: 'tienda', profile: 'standard', lang: 'es',
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'main'] },
  apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'node' }],
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

function ws(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-san-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  writeFileSync(join(root, 'backend', 'appsettings.json'), JSON.stringify({ Aws: { AccessKeyId: FAKE_AWS } }, null, 2) + '\n');
  writeFileSync(join(root, 'backend', 'app.js'), `const githubToken = "${FAKE_GH}";\n`);
  return { root, home };
}

function cli({ root, home }, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: home, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env });
}

/** Archivos (recursivo) de una carpeta, para comprobar que --dry-run no escribe. */
function tree(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...tree(p)); else out.push(p);
  }
  return out.sort();
}

test('--dry-run imprime un diff enmascarado y no escribe nada', (t) => {
  const w = ws(t);
  cli(w, 'scan');
  const before = tree(w.root).concat(tree(w.home));
  const r = cli(w, 'sanitize', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^--- a\/backend\/appsettings\.json$/m);
  assert.match(r.stdout, /^\+\+\+ b\/backend\/appsettings\.json$/m);
  assert.match(r.stdout, /^@@ -\d+,1 \+\d+,1 @@ config-to-empty$/m);
  assert.match(r.stdout, /^-.*AKIA…\(20\)/m);
  assert.match(r.stdout, /^\+.*"AccessKeyId": ""/m);
  assert.ok(!r.stdout.includes(FAKE_AWS) && !r.stdout.includes(FAKE_GH), 'el diff filtró un valor real');
  assert.deepEqual(tree(w.root).concat(tree(w.home)), before, '--dry-run no debe escribir nada');
});

test('--apply deja el campo vacío, saca el literal a variable de entorno y escribe las reglas fuera del repo', (t) => {
  const w = ws(t);
  cli(w, 'scan');
  const r = cli(w, 'sanitize', '--apply');
  assert.equal(r.status, 0, r.stderr);

  const config = readFileSync(join(w.root, 'backend', 'appsettings.json'), 'utf8');
  assert.ok(!config.includes(FAKE_AWS), 'el valor sigue en la configuración');
  assert.match(config, /"AccessKeyId": ""/);

  const code = readFileSync(join(w.root, 'backend', 'app.js'), 'utf8');
  assert.ok(!code.includes(FAKE_GH), 'el valor sigue en el código');
  assert.match(code, /process\.env\.[A-Z0-9_]+/);
  assert.ok(existsSync(join(w.root, 'backend', '.env.ai')), 'applyRefactors deja el .env.ai de la app');

  const todo = readFileSync(join(w.root, '.bot-secure', 'SANITIZE-TODO.md'), 'utf8');
  assert.ok(!todo.includes(FAKE_AWS) && !todo.includes(FAKE_GH), 'SANITIZE-TODO.md nunca lleva valores');
  assert.match(todo, /Pendientes de saneamiento/);

  const rules = tree(w.home).filter((p) => p.endsWith('rules.txt'));
  assert.equal(rules.length, 1, 'las reglas viven en ~/.bot-secure/<id-repo>/rules.txt');
  const text = readFileSync(rules[0], 'utf8');
  assert.match(text, /^literal:.+==>__AI_PLACEHOLDER__[A-Z0-9_]+__$/m);
  assert.ok(!tree(w.root).some((p) => p.endsWith('rules.txt')), 'rules.txt jamás dentro del repositorio');
});

test('--mirror avisa de que llega en la siguiente versión, con su arreglo', (t) => {
  const w = ws(t);
  const r = cli(w, 'sanitize', '--mirror', '--apply');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /siguiente versión/);
  assert.match(r.stdout, /Arreglo: ver docs\/avanzado\.md/);
});

test('sin hallazgos no hay nada que sanear', (t) => {
  const w = ws(t);
  rmSync(join(w.root, 'backend'), { recursive: true, force: true });
  const r = cli(w, 'sanitize', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nada que sanear/);
});
