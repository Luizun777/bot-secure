// Los 7 comandos del camino principal deben responder a --help sin tocar el disco:
// se ejecutan en una carpeta temporal vacía (sin workspace, sin repo) y no debe aparecer nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
const COMMANDS = ['start', 'init', 'doctor', 'status', 'up', 'down', 'claude'];

// macOS: /tmp y /var son enlaces simbólicos; sin realpath las comparaciones de ruta fallan.
const TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-help-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], {
  cwd: TMP, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP, ...env },
});

for (const name of COMMANDS) {
  test(`${name} --help sale 0, imprime su uso y no escribe nada`, () => {
    const antes = readdirSync(TMP);
    const r = run([name, '--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`bot-secure ${name}`), `el uso de ${name} debe empezar por "bot-secure ${name}"`);
    assert.deepEqual(readdirSync(TMP), antes, `${name} --help no debe escribir en disco`);
  });
}

test('--lang en traduce el uso de doctor', () => {
  const r = run(['doctor', '--help'], { BOT_SECURE_LANG: 'en' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--onboarding/);
});

test('los 7 comandos aparecen en la ayuda general', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const name of COMMANDS) assert.match(r.stdout, new RegExp(`\\b${name}\\b`), `falta ${name} en --help`);
});

test('doctor --onboarding funciona sin workspace y sale 0', () => {
  const r = run(['doctor', '--onboarding']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bot-secure start/);
});
