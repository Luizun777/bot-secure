import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

test('--help lista comandos y el camino principal (start, claude)', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bot-secure start/);
  assert.match(r.stdout, /bot-secure claude/);
});

test('--version imprime la versión', () => {
  const r = run('--version');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /bot-secure \d+\.\d+\.\d+/);
});

test('comando desconocido: exit 2, sugerencia y arreglo', () => {
  const r = run('statuss');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No existe el comando/);
  assert.match(r.stdout, /Arreglo: bot-secure --help/);
});

test('--lang en traduce la ayuda', () => {
  const r = run('--lang', 'en', '--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: bot-secure/);
});

test('sin argumentos muestra el menú sin fallar', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bot-secure start|Workspace de IA/);
});
