// Clon de IA (refspec restringido), verificación de problemas, --fix e instalación de hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../src/lib/exec.mjs';
import { applyFixes, cloneAi, ensureAiDevBranch, installHooks, restrictRefspec, verify } from '../../src/git/index.mjs';
import { gitq, limpiar, makeRepo } from '../fixtures/workspaces/repos.mjs';

const POLICY = { branches: { ai: 'ai-dev', protected: ['dev', 'qa', 'prd', 'main', 'master', 'release/*'] } };
const tmp = () => mkdtempSync(join(tmpdir(), 'bs-verify-'));
const refs = (dir) => git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'], { cwd: dir }).stdout.split('\n').filter(Boolean);
const fetchSpec = (dir) => git(['config', '--get-all', 'remote.origin.fetch'], { cwd: dir }).stdout.split('\n').filter(Boolean);

/** Workspace `<base>/proyecto-ai` con policy.json, para que verify reconozca la raíz. */
function workspace(base) {
  const root = join(base, 'proyecto-ai');
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  return root;
}

test('cloneAi deja un solo refspec y ninguna ref de rama protegida', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'), { fixture: 'spring' });
    ensureAiDevBranch(origen, { from: 'dev' });
    const root = workspace(base);
    const dest = join(root, 'backend');
    const r = cloneAi(origen, dest, { branch: 'ai-dev' });
    assert.equal(r.branch, 'ai-dev');
    assert.deepEqual(fetchSpec(dest), ['+refs/heads/ai-dev:refs/remotes/origin/ai-dev']);
    assert.ok(!refs(dest).includes('refs/remotes/origin/dev'), 'no debe existir origin/dev');
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dest }).stdout.trim(), 'ai-dev');
    assert.ok(existsSync(join(dest, 'pom.xml')), 'el contenido del fixture llegó al clon');
    assert.deepEqual(verify(dest, POLICY, { requireHooks: false }), { ok: true, problems: [] });
  } finally { limpiar(base); }
});

test('cloneAi no pisa una carpeta con contenido', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'));
    ensureAiDevBranch(origen, { from: 'dev' });
    const dest = join(base, 'ocupada');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'algo.txt'), 'contenido previo\n');
    assert.throws(() => cloneAi(origen, dest), (e) => {
      assert.equal(e.key, 'git.destNotEmpty');
      assert.match(e.fix, /\.bak/);
      return true;
    });
  } finally { limpiar(base); }
});

test('verify detecta el clon normal (refspec, rama protegida y rama activa) y propone el arreglo', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'));
    ensureAiDevBranch(origen, { from: 'dev' });
    const root = workspace(base);
    const dest = join(root, 'backend');
    assert.equal(gitq(['clone', origen, dest], base).status, 0);

    const r = verify(dest, POLICY, { requireHooks: false });
    assert.equal(r.ok, false);
    const codes = r.problems.map((p) => p.code);
    assert.ok(codes.includes('refspec'), codes.join(','));
    assert.ok(codes.includes('remote-protected-ref'), codes.join(','));
    assert.ok(codes.includes('branch'), codes.join(','));
    for (const p of r.problems) assert.ok(p.fix && p.fix.length > 0, `el problema ${p.code} debe traer arreglo`);
    assert.match(r.problems.find((p) => p.code === 'refspec').fix, /remote\.origin\.fetch/);
  } finally { limpiar(base); }
});

test('applyFixes arregla refspec, refs protegidas y rama; verify queda limpio', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'));
    ensureAiDevBranch(origen, { from: 'dev' });
    const root = workspace(base);
    const dest = join(root, 'backend');
    gitq(['clone', origen, dest], base);

    const antes = verify(dest, POLICY, { requireHooks: false });
    const aplicado = applyFixes(dest, antes.problems, POLICY);
    for (const a of aplicado) assert.equal(a.fixed, true, `${a.code}: ${a.reason ?? ''}`);
    const despues = verify(dest, POLICY, { requireHooks: false });
    assert.deepEqual(despues, { ok: true, problems: [] });
    assert.deepEqual(fetchSpec(dest), ['+refs/heads/ai-dev:refs/remotes/origin/ai-dev']);
    assert.ok(!refs(dest).includes('refs/remotes/origin/dev'));
  } finally { limpiar(base); }
});

test('verify avisa si la carpeta del workspace no termina en -ai', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'));
    ensureAiDevBranch(origen, { from: 'dev' });
    const dest = join(base, 'sin-sufijo');
    cloneAi(origen, dest, { branch: 'ai-dev' });
    const r = verify(dest, POLICY, { requireHooks: false });
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems.map((p) => p.code), ['dirname']);
    assert.match(r.problems[0].fix, /-ai/);
  } finally { limpiar(base); }
});

test('verify sobre una carpeta que no es repo lo dice con el comando de clonado', () => {
  const base = tmp();
  try {
    const r = verify(base, POLICY);
    assert.equal(r.problems[0].code, 'not-a-repo');
    assert.match(r.problems[0].fix, /branch clone-ai/);
  } finally { limpiar(base); }
});

test('restrictRefspec borra las refs remotas ajenas de un clon existente', () => {
  const base = tmp();
  try {
    const origen = makeRepo(join(base, 'api'));
    ensureAiDevBranch(origen, { from: 'dev' });
    const dest = join(base, 'clon');
    gitq(['clone', origen, dest], base);
    assert.ok(refs(dest).includes('refs/remotes/origin/dev'));
    const r = restrictRefspec(dest, 'ai-dev');
    assert.equal(r.refspec, '+refs/heads/ai-dev:refs/remotes/origin/ai-dev');
    assert.ok(r.removed.includes('refs/remotes/origin/dev'));
    assert.ok(!refs(dest).includes('refs/remotes/origin/dev'));
  } finally { limpiar(base); }
});

test('installHooks configura core.hooksPath y deja los hooks ejecutables', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'api'));
    mkdirSync(join(repo, '.githooks'), { recursive: true });
    const hook = join(repo, '.githooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o644);
    const r = installHooks(repo, [{ path: join('.githooks', 'pre-commit') }]);
    assert.equal(r.hooksPath, '.githooks');
    assert.equal(git(['config', '--get', 'core.hooksPath'], { cwd: repo }).stdout.trim(), '.githooks');
    assert.deepEqual(r.files.map((f) => f.file), ['.githooks/pre-commit']);
    if (process.platform !== 'win32') assert.equal(statSync(hook).mode & 0o111, 0o111, 'el hook debe ser ejecutable');
  } finally { limpiar(base); }
});
