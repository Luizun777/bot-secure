// El lanzador: sin `claude` en el PATH imprime las instrucciones de la app de escritorio y sale 0;
// el entorno que construye es una lista blanca (nunca hereda los tokens del shell).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnv, quickCheck, ENV_ALLOWLIST } from '../../src/cli/claude.mjs';
import { defaultPolicy } from '../../src/policy/index.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'bot-secure.mjs');
let TMP, WS, EMPTY_BIN;

before(() => {
  TMP = mkdtempSync(join(realpathSync(tmpdir()), 'bs-claude-'));
  WS = join(TMP, 'tienda-ai');
  EMPTY_BIN = join(TMP, 'bin-vacio');
  mkdirSync(EMPTY_BIN, { recursive: true });
  mkdirSync(join(WS, '.bot-secure'), { recursive: true });
  writeFileSync(join(WS, '.bot-secure', 'policy.json'), JSON.stringify(defaultPolicy({ project: 'tienda' }), null, 2));
  writeFileSync(join(WS, '.env.ai'), 'DB_URL=postgres://app@127.0.0.1:5433/app_ai\nAPI_URL=http://localhost:8080\n');
});

after(() => rmSync(TMP, { recursive: true, force: true }));

const claude = (cwd, env = {}) => spawnSync(process.execPath, [BIN, 'claude'], {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es', HOME: TMP, PATH: EMPTY_BIN, ...env },
});

test('sin CLI de Claude en el PATH: instrucciones de la app de escritorio y salida 0', () => {
  // Falta lock.json, así que primero se comprueba que el diagnóstico rápido manda.
  const bloqueado = claude(WS);
  assert.equal(bloqueado.status, 2, bloqueado.stdout);
  assert.match(bloqueado.stdout, /Arreglo: bot-secure init/);

  // Con las guardas en su sitio (lock.json vacío pero coherente) sí se llega al lanzador.
  mkdirSync(join(WS, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(WS, '.claude', 'hooks', 'guard.mjs'), '// guarda de prueba\n');
  writeFileSync(join(WS, '.bot-secure', 'lock.json'), JSON.stringify({
    version: '0.0.0', rulesVersion: null, claudeCodeMin: '2.1.246', generated: [],
    guardSha256: createHash('sha256').update('// guarda de prueba\n').digest('hex'),
  }, null, 2));

  const r = claude(WS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Open folder/);
  assert.ok(r.stdout.includes(WS), 'debe decir exactamente qué carpeta abrir');
});

test('fuera de un workspace, claude dice cómo empezar y sale 2', () => {
  const fuera = join(TMP, 'sin-workspace');
  mkdirSync(fuera, { recursive: true });
  const r = claude(fuera);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Arreglo: bot-secure start/);
});

test('buildEnv usa lista blanca: entran las de .env.ai y las marcas, nunca los tokens del shell', () => {
  const source = { PATH: '/usr/bin', HOME: '/home/dev', LANG: 'es_MX.UTF-8', GITHUB_TOKEN: 'ghp_NO_DEBE_PASAR', AWS_SECRET_ACCESS_KEY: 'NO_DEBE_PASAR' };
  const { env, envAiCount } = buildEnv(WS, [], { source });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/dev');
  assert.equal(env.AI_ENV, '1');
  assert.equal(env.BOT_SECURE_LAUNCHED, '1');
  assert.equal(env.GITHUB_TOKEN, undefined, 'no debe heredar tokens del shell');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.API_URL, 'http://localhost:8080', 'debe traer las variables de .env.ai');
  assert.equal(envAiCount, 2);
  assert.ok(ENV_ALLOWLIST.includes('PATH') && !ENV_ALLOWLIST.includes('GITHUB_TOKEN'));
});

test('quickCheck bloquea si la política es inválida', () => {
  const mala = { ...defaultPolicy({ project: 'x' }), profile: 'inventado' };
  const r = quickCheck(WS, mala);
  assert.equal(r.ok, false);
  assert.equal(r.fix, 'bot-secure init');
});
