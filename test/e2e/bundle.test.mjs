// El guard se DESPLIEGA como un solo archivo (dist/guard.mjs) copiado dentro del proyecto:
// allí no puede resolver rutas relativas al repo del bot. Esta prueba evita la regresión
// que rompía el guard en destino (require dinámico de i18n/defaults que esbuild no empaqueta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_GUARD = join(ROOT, 'dist', 'guard.mjs');

const construir = () => spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });

test('dist/guard.mjs se ejecuta fuera del repo del bot, sin resolver rutas relativas', (t) => {
  if (!existsSync(DIST_GUARD)) {
    const r = construir();
    if (r.status !== 0) return t.skip('no se pudo construir (¿falta npm install?): ' + (r.stderr || '').slice(0, 200));
  }
  const ws = mkdtempSync(join(tmpdir(), 'bs-bundle-'));
  try {
    mkdirSync(join(ws, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(ws, '.bot-secure'), { recursive: true });
    copyFileSync(DIST_GUARD, join(ws, '.claude', 'hooks', 'guard.mjs'));
    writeFileSync(join(ws, '.bot-secure', 'policy.json'), JSON.stringify({
      version: 1, project: 'prueba', profile: 'standard', mode: 'clone',
      guard: { mode: 'block' }, branches: { ai: 'ai-dev', protected: ['dev', 'qa', 'prd', 'main'] },
      apps: [{ name: 'app', path: '.', kind: 'backend', stack: 'node' }],
    }));

    const entrada = JSON.stringify({
      cwd: ws, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
    });
    const r = spawnSync(process.execPath, [join(ws, '.claude', 'hooks', 'guard.mjs'), 'pre-tool'], {
      input: entrada, encoding: 'utf8', cwd: ws,
    });

    // Lo que se comprueba: el bundle CARGA y DECIDE. Nunca puede morir por módulo no encontrado.
    const salida = (r.stdout || '') + (r.stderr || '');
    assert.doesNotMatch(salida, /Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/,
      'El guard empaquetado no resuelve sus dependencias en destino:\n' + salida.slice(0, 400));
    assert.ok(r.status === 0 || r.status === 2, `exit inesperado ${r.status}: ${salida.slice(0, 300)}`);
    if (r.status === 0) {
      const json = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.equal(json.hookSpecificOutput.permissionDecision, 'deny', 'leer .env debe denegarse');
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('dist/bot-secure.mjs ejecuta SUBCOMANDOS fuera del repo, con mensaje de arreglo', (t) => {
  const dist = join(ROOT, 'dist', 'bot-secure.mjs');
  if (!existsSync(dist)) { const r = construir(); if (r.status !== 0) return t.skip('no se pudo construir'); }
  const dir = mkdtempSync(join(tmpdir(), 'bs-cli-'));
  try {
    const r = spawnSync(process.execPath, [dist, 'workspace', 'status'], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 30000 });
    const salida = (r.stdout || '') + (r.stderr || '');
    // El binario debe traer sus comandos dentro: nada de cargar el árbol de fuentes del bot.
    assert.doesNotMatch(salida, /Cannot find module|ERR_MODULE_NOT_FOUND/, salida.slice(0, 300));
    assert.doesNotMatch(salida, /Error interno|at Object.run/, 'el error debe ser el mensaje del usuario, no una traza:\n' + salida.slice(0, 300));
    assert.match(salida, /Arreglo:/, 'todo error debe decir cómo arreglarlo: ' + salida.slice(0, 200));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dist/bot-secure.mjs se ejecuta fuera del repo', (t) => {
  const dist = join(ROOT, 'dist', 'bot-secure.mjs');
  if (!existsSync(dist)) {
    const r = construir();
    if (r.status !== 0) return t.skip('no se pudo construir');
  }
  const r = spawnSync(process.execPath, [dist, '--version'], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const salida = (r.stdout || '') + (r.stderr || '');
  assert.doesNotMatch(salida, /Cannot find module|ERR_MODULE_NOT_FOUND/, salida.slice(0, 400));
  assert.match(r.stdout, /bot-secure \d+\.\d+\.\d+/);
  // el guard va empaquetado dentro: no debe autoejecutarse al arrancar el CLI
  assert.equal(r.stderr.trim(), '', '--version no debe escribir nada en stderr: ' + r.stderr.slice(0, 200));
  assert.equal(r.status, 0);
});
