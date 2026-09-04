// `bot-secure baseline`: los hallazgos HIGH/CRITICAL exigen --reason, avisan de la segunda
// persona y, una vez aceptados, dejan de aparecer en el siguiente escaneo.
// Los secretos de este archivo son FALSOS (clave de ejemplo de la documentación de AWS).
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
  apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'node' }],
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

function ws(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-base-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  writeFileSync(join(root, 'backend', 'config.json'), JSON.stringify({ aws_access_key_id: FAKE_AWS }, null, 2) + '\n');
  return { root, home };
}

function cli({ root, home }, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: home, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env });
}

/** Huella del hallazgo de la clave falsa, tomada del reporte real. */
function fingerprint(w) {
  cli(w, 'scan');
  const report = JSON.parse(readFileSync(join(w.root, '.bot-secure', 'reports', 'report.json'), 'utf8'));
  const f = report.findings.find((x) => x.ruleId === 'aws-access-key-id');
  assert.ok(f, 'el fixture debe producir el hallazgo de la clave falsa');
  return f.fingerprint;
}

test('add exige --reason para CRITICAL y da el comando exacto', (t) => {
  const w = ws(t);
  const fp = fingerprint(w);
  const r = cli(w, 'baseline', 'add', fp);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--reason es obligatorio/);
  assert.match(r.stdout, new RegExp(`Arreglo: bot-secure baseline add ${fp} --reason`));
  assert.equal(existsSync(join(w.root, '.bot-secure', 'baseline.json')), false, 'no debe escribir nada si falla');
});

test('con --reason se acepta, avisa de la segunda persona y suprime el hallazgo en el siguiente scan', (t) => {
  const w = ws(t);
  const fp = fingerprint(w);
  const add = cli(w, 'baseline', 'add', fp, '--reason', 'clave de ejemplo de la documentacion de AWS', '--by', 'ana', '--expires', '2099-12-31');
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stderr, /PENDIENTE/);
  assert.match(add.stdout, /Caduca el 2099-12-31/);

  const entry = JSON.parse(readFileSync(join(w.root, '.bot-secure', 'baseline.json'), 'utf8')).entries[0];
  assert.equal(entry.fingerprint, fp);
  assert.equal(entry.severity, 'CRITICAL');
  assert.equal(entry.needsSecondApproval, true);
  assert.equal(entry.ruleId, 'aws-access-key-id');
  assert.ok(!JSON.stringify(entry).includes(FAKE_AWS), 'el baseline nunca guarda el valor');

  const after = JSON.parse(cli(w, 'scan', '--json').stdout);
  assert.equal(after.byRule['aws-access-key-id'], undefined, 'el hallazgo debe quedar suprimido');
  assert.equal(after.exitCode, 0);
});

test('list muestra el estado pendiente y expire lo caduca', (t) => {
  const w = ws(t);
  const fp = fingerprint(w);
  cli(w, 'baseline', 'add', fp, '--reason', 'aceptado', '--by', 'ana', '--expires', '2099-12-31');

  const list = cli(w, 'baseline', 'list');
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(fp));
  assert.match(list.stdout, /pending/);
  assert.match(list.stderr, /aprobación de una segunda persona/);

  const approve = cli(w, 'baseline', 'approve', fp, '--by', 'beto');
  assert.equal(approve.status, 0, approve.stderr);
  assert.match(JSON.parse(cli(w, 'baseline', 'list', '--json').stdout).entries[0].status, /active/);

  const exp = cli(w, 'baseline', 'expire', fp);
  assert.equal(exp.status, 0, exp.stderr);
  const back = JSON.parse(cli(w, 'scan', '--json').stdout);
  assert.equal(back.byRule['aws-access-key-id'], 1, 'caducada la excepción, el hallazgo vuelve');
});

test('approve sin --by y subcomando desconocido explican el arreglo', (t) => {
  const w = ws(t);
  const noBy = cli(w, 'baseline', 'approve', '0123456789abcdef');
  assert.equal(noBy.status, 2);
  assert.match(noBy.stdout, /Arreglo: bot-secure baseline approve 0123456789abcdef --by/);

  const bad = cli(w, 'baseline', 'inventado');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Subcomando desconocido/);
  assert.match(bad.stdout, /Arreglo: bot-secure baseline list/);
});
