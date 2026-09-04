// `bot-secure mocks`: fuera de un workspace debe fallar con el arreglo exacto, y `keys generate`
// nunca imprime el contenido de una llave (solo rutas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import comando from '../../src/cli/mocks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');

/** Workspace mínimo con política. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'bs-mockscli-'));
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify({
    version: 1, project: 'tienda', profile: 'standard', mode: 'clone',
    guard: { mode: 'block' }, branches: { ai: 'ai-dev', protected: ['dev'] },
    db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' },
    apps: [{ name: 'api', path: '.', kind: 'backend', stack: 'node', envStrategy: 'dotenv' }],
  }, null, 2));
  return root;
}

const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 60_000 });

test('el comando declara nombre, resumen y uso en los dos idiomas', () => {
  assert.equal(comando.name, 'mocks');
  for (const lang of ['es', 'en']) {
    assert.ok(comando.summary[lang]?.length > 10, `resumen ${lang}`);
    assert.ok(comando.usage[lang]?.startsWith('bot-secure mocks'), `uso ${lang}`);
  }
  assert.equal(typeof comando.run, 'function');
});

test('fuera de un workspace falla con exit 2 y el comando de arreglo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-nows-'));
  try {
    const r = run(['mocks', 'status'], dir);
    assert.equal(r.status, 2);
    const salida = (r.stdout ?? '') + (r.stderr ?? '');
    assert.match(salida, /Arreglo: bot-secure start/);
    assert.doesNotMatch(salida, /at Object\.run|Error interno/, 'debe ser el mensaje del usuario, no una traza');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un subcomando desconocido dice cuáles existen', () => {
  const root = workspace();
  try {
    const r = run(['mocks', 'levantar'], root);
    assert.equal(r.status, 2);
    const salida = (r.stdout ?? '') + (r.stderr ?? '');
    assert.match(salida, /up, down, idp, keys, status/);
    assert.match(salida, /Arreglo: bot-secure mocks status/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('`mocks keys generate` escribe las llaves y NO imprime su contenido', () => {
  const root = workspace();
  try {
    const r = run(['mocks', 'keys', 'generate', '--json'], root);
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    const data = JSON.parse(r.stdout);
    assert.equal(data.command, 'mocks keys generate');
    assert.ok(data.files.some((f) => f.endsWith('ai-rsa.key.pem')), data.files.join(', '));

    const salida = (r.stdout ?? '') + (r.stderr ?? '');
    assert.doesNotMatch(salida, /BEGIN (RSA )?PRIVATE KEY/, 'jamás se imprime una llave privada');

    const llave = readFileSync(join(root, '.bot-secure', 'ai-keys', 'ai-rsa.key.pem'), 'utf8');
    assert.match(llave, /^# bot-secure:throwaway/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('`mocks keys generate --dry-run` no escribe nada', () => {
  const root = workspace();
  try {
    const r = run(['mocks', 'keys', 'generate', '--dry-run', '--json'], root);
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    assert.equal(JSON.parse(r.stdout).dryRun, true);
    assert.equal(existsSync(join(root, '.bot-secure', 'ai-keys')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('`mocks status` no revienta sin runtime de contenedores ni compose', () => {
  const root = workspace();
  try {
    const r = run(['mocks', 'status', '--json'], root);
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    const data = JSON.parse(r.stdout);
    assert.equal(data.command, 'mocks status');
    assert.ok(Array.isArray(data.services));
    assert.ok(data.services.includes('idp'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('`mocks up --dry-run` no necesita Docker', () => {
  const root = workspace();
  try {
    const r = run(['mocks', 'up', '--dry-run', '--json'], root);
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    const data = JSON.parse(r.stdout);
    assert.equal(data.dryRun, true);
    assert.ok(data.services.includes('idp'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
