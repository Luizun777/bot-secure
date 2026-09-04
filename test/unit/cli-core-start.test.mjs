// `start --yes` en una carpeta vacía: crea el workspace y lo prepara sin preguntar nada.
// El PATH se reduce a `git` para que la prueba no dependa de Docker ni de Claude Code, y no se
// clona ningún repositorio (camino sin red).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContext } from '../../src/cli/start.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
let TMP, PROYECTO, WS, BIN_DIR, RESULT;

/** Ruta real de un binario del sistema (para el PATH mínimo de la prueba). */
function whichBin(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

before(() => {
  TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-start-'));
  PROYECTO = join(TMP, 'tienda');
  WS = join(PROYECTO, 'tienda-ai');
  BIN_DIR = join(TMP, 'bin');
  mkdirSync(PROYECTO, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });
  // Solo git en el PATH: sin docker/podman se omite la base de datos; sin claude sale un aviso.
  const git = whichBin('git');
  if (git) symlinkSync(git, join(BIN_DIR, 'git'));
  RESULT = spawnSync(process.execPath, [BIN, 'start', '--yes'], {
    cwd: PROYECTO, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP, PATH: BIN_DIR },
  });
});

after(() => rmSync(TMP, { recursive: true, force: true }));

test('detectContext distingue carpeta vacía, repo y workspace', () => {
  const vacia = join(TMP, 'vacia');
  mkdirSync(vacia, { recursive: true });
  assert.equal(detectContext(vacia).kind, 'empty');
  const ws = join(TMP, 'ya-ai');
  mkdirSync(join(ws, '.bot-secure'), { recursive: true });
  writeFileSync(join(ws, '.bot-secure', 'policy.json'), '{}');
  assert.equal(detectContext(ws).kind, 'workspace');
  assert.equal(detectContext(ws).root, ws);
});

test('start --yes en una carpeta vacía crea el workspace sin preguntar', () => {
  assert.equal(RESULT.status, 0, RESULT.stderr);
  assert.ok(existsSync(join(WS, '.bot-secure', 'policy.json')), 'falta el workspace tienda-ai/');
  assert.ok(existsSync(join(WS, 'CLAUDE.md')), 'init debió generar CLAUDE.md');
  assert.ok(existsSync(join(WS, '.claude', 'settings.json')), 'init debió compilar las guardas');
  assert.ok(existsSync(join(WS, '.claude', 'hooks', 'guard.mjs')), 'init debió instalar la guarda');
  assert.ok(existsSync(join(WS, '.bot-secure', 'lock.json')), 'init debió escribir lock.json');
});

test('termina diciendo el siguiente paso', () => {
  assert.match(RESULT.stdout, /Listo/);
  assert.match(RESULT.stdout, /bot-secure claude/);
});

test('sin Docker ni Podman avisa y sigue con el resto', () => {
  assert.match(RESULT.stdout + RESULT.stderr, /Docker|Podman/);
  const policy = JSON.parse(readFileSync(join(WS, '.bot-secure', 'policy.json'), 'utf8'));
  assert.equal(policy.project, 'tienda');
  assert.ok(['sensitive', 'standard'].includes(policy.profile));
});

test('en un workspace ya creado, start se salta la creación y va a init', () => {
  const r = spawnSync(process.execPath, [BIN, 'start', '--yes'], {
    cwd: WS, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP, PATH: BIN_DIR },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Listo/);
  assert.ok(!existsSync(join(WS, 'tienda-ai')), 'no debe anidar otro workspace dentro');
});
