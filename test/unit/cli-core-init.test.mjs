// `init` debe ser idempotente (la segunda ejecución no crea nada) y respetar lo que edites a
// mano (escribe `<archivo>.new` en vez de pisarte). Se ejecuta el CLI real sobre un workspace
// temporal fuera del repo (en el repo, findGitRoot encontraría el propio bot).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPolicy } from '../../src/policy/index.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
let TMP, WS;

const init = (...args) => {
  const r = spawnSync(process.execPath, [BIN, 'init', '--yes', '--json', ...args], {
    cwd: WS, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP },
  });
  assert.equal(r.status, 0, `init falló: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

before(() => {
  TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-init-'));
  WS = join(TMP, 'tienda-ai');
  mkdirSync(join(WS, '.bot-secure'), { recursive: true });
  writeFileSync(join(WS, '.bot-secure', 'policy.json'), JSON.stringify(defaultPolicy({ project: 'tienda' }), null, 2));
});

after(() => rmSync(TMP, { recursive: true, force: true }));

test('la primera vez genera contexto, guardas y lock.json', () => {
  const out = init();
  assert.ok(out.summary.created > 0, 'debe crear archivos la primera vez');
  for (const rel of ['CLAUDE.md', 'AGENTS.md', join('docs', 'INDEX.md'), join('.claude', 'settings.json'), join('.claude', 'hooks', 'guard.mjs'), join('.bot-secure', 'lock.json')]) {
    assert.ok(existsSync(join(WS, rel)), `falta ${rel}`);
  }
  assert.equal(out.guard.action === 'bundle' || out.guard.action === 'shim', true);
});

test('la guarda instalada es dist/guard.mjs, nunca el comando src/cli/guard.mjs', async () => {
  const { findGuardBundle } = await import('../../src/cli/init.mjs');
  const bundle = findGuardBundle();
  if (bundle) {
    assert.match(bundle.split(/[\\/]/).slice(-2).join('/'), /^dist\/guard\.mjs$/, `bundle equivocado: ${bundle}`);
    assert.match(readFileSync(join(WS, '.claude', 'hooks', 'guard.mjs'), 'utf8'), /hookSpecificOutput/, 'la guarda copiada no es la empaquetada');
  } else {
    assert.match(readFileSync(join(WS, '.claude', 'hooks', 'guard.mjs'), 'utf8'), /guard\/entry\.mjs/, 'sin dist/ debe quedar el shim de desarrollo');
  }
});

test('la segunda ejecución es idempotente: no marca nada como creado', () => {
  const out = init();
  assert.equal(out.summary.created, 0, `la segunda vez creó ${out.summary.created} archivo(s)`);
  assert.equal(out.summary.updated, 0, `la segunda vez actualizó ${out.summary.updated} archivo(s)`);
  assert.equal(out.summary.pending, 0, 'no debería haber .new sin ediciones humanas');
  assert.ok(out.summary.unchanged > 0);
});

test('respeta lo editado a mano: escribe CLAUDE.md.new y lo cuenta como pendiente', () => {
  const claudeMd = join(WS, 'CLAUDE.md');
  writeFileSync(claudeMd, readFileSync(claudeMd, 'utf8') + '\n<!-- editado por una persona -->\n');
  const out = init();
  assert.ok(existsSync(claudeMd + '.new'), 'debe dejar CLAUDE.md.new');
  assert.match(readFileSync(claudeMd, 'utf8'), /editado por una persona/, 'no debe pisar la edición');
  assert.ok(out.summary.pending >= 1);
  rmSync(claudeMd + '.new');
});

test('el escaneo es informativo: init termina en 0 aunque haya hallazgos', () => {
  writeFileSync(join(WS, 'config-de-prueba.txt'), 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n');
  const out = init();
  assert.equal(out.command, 'init');
  assert.ok(out.scan, 'el resumen del escaneo debe estar en la salida');
  rmSync(join(WS, 'config-de-prueba.txt'));
});

test('lock.json cubre las guardas y la integridad queda en verde', async () => {
  init();
  const { verifyIntegrity, isGuardArtifact } = await import('../../src/policy/index.mjs');
  const { ok, drift } = verifyIntegrity(WS, { only: isGuardArtifact });
  assert.equal(ok, true, `drift inesperado: ${JSON.stringify(drift)}`);
});
