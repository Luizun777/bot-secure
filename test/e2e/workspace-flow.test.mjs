// E2E del workspace de IA con el CLI real: dos repos git (spring y angular) con rama dev →
// `workspace create` → `workspace add` ×2 → comprobación del clon restringido → `workspace status`
// → `branch verify` sobre un clon normal. La evidencia real se guarda en evidence/workspace.txt.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from '../fixtures/workspaces/repos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const BIN = join(REPO, 'bin', 'bot-secure.mjs');
const TMP = join(HERE, 'tmp', 'workspace-flow');
const EVIDENCE = join(HERE, 'evidence', 'workspace.txt');
const WS = join(TMP, 'tienda-ai');

const log = [];
const rec = (titulo, cuerpo) => log.push(`\n### ${titulo}\n${cuerpo.trim()}`);

/** Ejecuta el CLI real y registra la salida para la evidencia. */
function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', BOT_SECURE_LANG: 'es' },
  });
  rec(`bot-secure ${args.join(' ')}  (exit ${r.status})`, (r.stdout || '') + (r.stderr || ''));
  return r;
}

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const refs = (dir) => git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'], dir).stdout.split('\n').filter(Boolean);
const policy = () => JSON.parse(readFileSync(join(WS, '.bot-secure', 'policy.json'), 'utf8'));

before(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  makeRepo(join(TMP, 'tienda-api'), { fixture: 'spring' });
  makeRepo(join(TMP, 'tienda-web'), { fixture: 'angular' });
});

after(() => {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  const texto = log.join('\n').split(TMP).join('<tmp>').split(REPO).join('<repo>');
  writeFileSync(EVIDENCE, [
    '# Evidencia real: test/e2e/workspace-flow.test.mjs',
    `# Generado: ${new Date().toISOString()}`,
    `# node ${process.version} · ${process.platform} · ${git(['--version'], REPO).stdout.trim()}`,
    texto, '',
  ].join('\n'));
  rmSync(TMP, { recursive: true, force: true });
});

test('workspace create deja tienda-ai con política y sugiere el siguiente paso', () => {
  const r = cli(TMP, 'workspace', 'create', 'tienda');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(WS, '.bot-secure', 'policy.json')), 'falta policy.json');
  assert.ok(existsSync(join(WS, '.git')), 'el workspace debe ser un repo git');
  assert.match(r.stdout, /workspace add/, 'debe decir cuál es el siguiente paso');
});

test('workspace add clona backend y frontend en la rama ai-dev', () => {
  const back = cli(WS, 'workspace', 'add', join(TMP, 'tienda-api'), '--kind', 'backend');
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /Spring Boot/, 'debe informar el stack detectado');

  const front = cli(WS, 'workspace', 'add', join(TMP, 'tienda-web'), '--kind', 'frontend');
  assert.equal(front.status, 0, front.stderr);
  assert.match(front.stdout, /Angular/);

  assert.ok(existsSync(join(WS, 'backend', 'pom.xml')), 'falta tienda-ai/backend');
  assert.ok(existsSync(join(WS, 'frontend', 'angular.json')), 'falta tienda-ai/frontend');
});

test('los clones solo traen ai-dev: refspec restringido y sin refs de ramas protegidas', () => {
  for (const app of ['backend', 'frontend']) {
    const dir = join(WS, app);
    const fetch = git(['config', '--get-all', 'remote.origin.fetch'], dir).stdout.split('\n').filter(Boolean);
    assert.deepEqual(fetch, ['+refs/heads/ai-dev:refs/remotes/origin/ai-dev'], `${app}: refspec sin restringir`);
    assert.ok(!refs(dir).includes('refs/remotes/origin/dev'), `${app}: no debe existir refs/remotes/origin/dev`);
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).stdout.trim(), 'ai-dev', `${app}: rama activa`);
    assert.equal(git(['rev-parse', '--verify', '--quiet', 'refs/heads/dev'], dir).status, 1, `${app}: no debe existir la rama local dev`);
    rec(`${app}: refspec y refs remotas`, `${fetch.join('\n')}\n${refs(dir).join('\n')}`);
  }
});

test('policy.apps queda con las dos apps, su stack y su estrategia de entorno', () => {
  const p = policy();
  assert.equal(p.apps.length, 2, JSON.stringify(p.apps.map((a) => a.name)));
  const back = p.apps.find((a) => a.name === 'backend');
  const front = p.apps.find((a) => a.name === 'frontend');
  assert.deepEqual([back.kind, back.stack, back.envStrategy, back.branch], ['backend', 'spring', 'spring-profile', 'ai-dev']);
  assert.deepEqual([front.kind, front.stack, front.envStrategy, front.branch], ['frontend', 'angular', 'angular-environments', 'ai-dev']);
  assert.deepEqual(front.dependsOn, ['backend'], 'el frontend consume el backend');
  assert.equal(back.remote, join(TMP, 'tienda-api'));
  rec('policy.apps', JSON.stringify(p.apps, null, 2).split(TMP).join('<tmp>'));
});

test('workspace status muestra ambas apps en ai-dev', () => {
  const r = cli(WS, 'workspace', 'status');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /backend: ai-dev/);
  assert.match(r.stdout, /frontend: ai-dev/);
  assert.match(r.stdout, /- backend → \.\/backend \(Spring Boot, :8081\)/, 'el mapa de apps');
});

test('branch verify sin argumentos revisa todas las apps del workspace', () => {
  const r = cli(WS, 'branch', 'verify', '--no-hooks');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const app of ['backend', 'frontend']) assert.ok(r.stdout.includes(join(WS, app)), `falta ${app} en la verificación`);
});

test('branch verify detecta un clon normal y --fix lo restringe', () => {
  const sucio = join(WS, 'clon-normal');
  assert.equal(git(['clone', '--quiet', join(TMP, 'tienda-api'), sucio], TMP).status, 0);

  const malo = cli(WS, 'branch', 'verify', 'clon-normal', '--no-hooks');
  assert.equal(malo.status, 1, 'un clon normal debe reportar hallazgos');
  const salida = malo.stdout + malo.stderr;
  assert.match(salida, /refspec del remoto no está restringido/);
  assert.match(salida, /referencias remotas de ramas protegidas: dev/);
  assert.match(salida, /remote\.origin\.fetch/, 'debe proponer el comando exacto');

  const arreglado = cli(WS, 'branch', 'verify', 'clon-normal', '--no-hooks', '--fix');
  assert.equal(arreglado.status, 0, arreglado.stdout + arreglado.stderr);
  const fetch = git(['config', '--get-all', 'remote.origin.fetch'], sucio).stdout.split('\n').filter(Boolean);
  assert.deepEqual(fetch, ['+refs/heads/ai-dev:refs/remotes/origin/ai-dev']);
  assert.ok(!refs(sucio).includes('refs/remotes/origin/dev'));
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], sucio).stdout.trim(), 'ai-dev');
});

test('la evidencia no contiene secretos ni datos reales', () => {
  const texto = log.join('\n');
  assert.doesNotMatch(texto, /AKIA[A-Z0-9]{16}|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});
