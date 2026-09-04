// `doctor --json` sobre un workspace de prueba: filas {id, state, message, fix}, estado global
// y los códigos de salida del contrato (0 ok/aviso · 2 error · 3 drift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmpVersion, globalState, exitFor, parseEnvFile } from '../../src/cli/doctor.mjs';
import { defaultPolicy } from '../../src/policy/index.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
const TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-doctor-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

/** Workspace mínimo: solo .bot-secure/policy.json (lo que exige findWorkspaceRoot). */
function makeWorkspace(name, patch = {}) {
  const root = join(TMP, name);
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  const policy = { ...defaultPolicy({ project: name }), ...patch };
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(policy, null, 2));
  return root;
}

const doctor = (cwd, ...args) => spawnSync(process.execPath, [BIN, 'doctor', '--json', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP },
});

test('doctor --json devuelve filas {id, state, message, fix} y el estado global', () => {
  const root = makeWorkspace('tienda-ai');
  const r = doctor(root);
  const out = JSON.parse(r.stdout);
  assert.equal(out.command, 'doctor');
  assert.equal(out.root, root);
  assert.ok(Array.isArray(out.rows) && out.rows.length > 0, 'debe traer filas');
  for (const row of out.rows) {
    assert.equal(typeof row.id, 'string');
    assert.ok(['ok', 'warn', 'error'].includes(row.state), `estado inválido: ${row.state}`);
    assert.equal(typeof row.message, 'string');
    assert.ok(row.fix === null || typeof row.fix === 'string');
    if (row.state !== 'ok') assert.ok(row.fix, `la fila ${row.id} debe decir cómo arreglarse`);
  }
  assert.ok(['ok', 'warn', 'error', 'drift'].includes(out.state));
  assert.equal(out.exitCode, r.status);
});

test('sin lock.json el estado es error y la salida 2 (no hay guardas instaladas)', () => {
  const root = makeWorkspace('sin-lock-ai');
  const r = doctor(root);
  const out = JSON.parse(r.stdout);
  const lock = out.rows.find((x) => x.id === 'lock');
  assert.equal(lock.state, 'error');
  assert.match(lock.fix, /bot-secure init/);
  assert.equal(r.status, 2, 'sin lock es error (2), no drift (3)');
});

test('un .env con valores reales dentro del workspace es ERROR con su arreglo', () => {
  const root = makeWorkspace('con-env-ai');
  writeFileSync(join(root, '.env'), 'DB_PASSWORD=Sup3rS3cretoDeVerdad\n');
  const out = JSON.parse(doctor(root).stdout);
  const env = out.rows.find((x) => x.id.startsWith('env:'));
  assert.ok(env, 'debe haber una fila por el .env');
  assert.equal(env.state, 'error');
  assert.match(env.message, /\.env/);
  assert.doesNotMatch(JSON.stringify(out), /Sup3rS3cretoDeVerdad/, 'nunca se imprime el valor');
});

test('un .env solo con placeholders del ambiente de IA no es un problema', () => {
  const root = makeWorkspace('env-placeholder-ai');
  writeFileSync(join(root, '.env'), 'DB_PASSWORD=__AI_PLACEHOLDER__DB_PASSWORD__\nAPI_URL=http://localhost:8080\n');
  const out = JSON.parse(doctor(root).stdout);
  assert.ok(!out.rows.some((x) => x.id.startsWith('env:')), 'no debe reportar placeholders');
  assert.equal(out.rows.find((x) => x.id === 'env').state, 'ok');
});

test('requireOrgAccount convierte la cuenta desconocida en error', () => {
  const root = makeWorkspace('org-ai', { requireOrgAccount: true });
  const out = JSON.parse(doctor(root).stdout);
  assert.equal(out.rows.find((x) => x.id === 'account').state, 'error');
});

test('sin workspace la fila workspace es error y dice bot-secure start', () => {
  const root = join(TMP, 'vacio');
  mkdirSync(root, { recursive: true });
  const out = JSON.parse(doctor(root).stdout);
  const ws = out.rows.find((x) => x.id === 'workspace');
  assert.equal(ws.state, 'error');
  assert.equal(ws.fix, 'bot-secure start');
});

test('cmpVersion compara como versiones, no como texto', () => {
  assert.equal(cmpVersion('2.1.246', '2.1.246'), 0);
  assert.equal(cmpVersion('2.1.99', '2.1.246'), -1);
  assert.equal(cmpVersion('2.10.0', '2.9.9'), 1);
});

test('globalState y exitFor siguen el contrato de códigos de salida', () => {
  assert.equal(exitFor(globalState([{ id: 'a', state: 'ok' }])), 0);
  assert.equal(exitFor(globalState([{ id: 'a', state: 'warn' }])), 0);
  assert.equal(exitFor(globalState([{ id: 'a', state: 'error' }])), 2);
  assert.equal(exitFor(globalState([{ id: 'integrity', state: 'error' }])), 3);
});

test('parseEnvFile lee NOMBRE=valor con comillas y export, e ignora comentarios', () => {
  const p = join(TMP, 'muestra.env');
  writeFileSync(p, '# comentario\nexport A="uno"\nB=dos\nno-es-una-variable\n');
  assert.deepEqual(parseEnvFile(p), [{ name: 'A', value: 'uno' }, { name: 'B', value: 'dos' }]);
});
