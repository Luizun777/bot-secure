// Ramas: patrón de ramas protegidas, rama de IA, estado del repo y creación de ai-dev.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotSecureError } from '../../src/lib/errors.mjs';
import { aiBranch, behindCount, currentBranch, ensureAiDevBranch, isDirty, isLocalRepoPath, protectedBranchRe, remoteHeads, DEFAULT_PROTECTED } from '../../src/git/index.mjs';
import { commitOn, gitq, limpiar, makeRepo } from '../fixtures/workspaces/repos.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bs-git-'));

test('protectedBranchRe reconoce las ramas protegidas y los globs release/*', () => {
  const re = protectedBranchRe({ branches: { protected: ['dev', 'main', 'release/*'] } });
  for (const b of ['dev', 'main', 'release/2024.1']) assert.ok(re.test(b), `${b} debería estar protegida`);
  for (const b of ['ai-dev', 'ai/tarea-1', 'developer', 'mainline']) assert.ok(!re.test(b), `${b} no debería estar protegida`);
});

test('sin política se usan las ramas protegidas por defecto', () => {
  const re = protectedBranchRe(undefined);
  for (const b of DEFAULT_PROTECTED.filter((p) => !p.includes('*'))) assert.ok(re.test(b), b);
  assert.equal(aiBranch(undefined), 'ai-dev');
  assert.equal(aiBranch({ branches: { ai: 'ia-dev' } }), 'ia-dev');
});

test('isLocalRepoPath distingue rutas locales de URLs y scp', () => {
  const base = tmp();
  try {
    makeRepo(join(base, 'repo'));
    assert.equal(isLocalRepoPath(join(base, 'repo')), true);
    assert.equal(isLocalRepoPath('https://servidor/equipo/api.git'), false);
    assert.equal(isLocalRepoPath('git@servidor:equipo/api.git'), false);
    assert.equal(isLocalRepoPath(join(base, 'no-existe')), false);
  } finally { limpiar(base); }
});

test('remoteHeads lista las ramas y falla con arreglo si el remoto no existe', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'));
    assert.deepEqual(remoteHeads(repo), ['dev']);
    assert.throws(() => remoteHeads(join(base, 'fantasma')), (e) => {
      assert.ok(e instanceof BotSecureError);
      assert.equal(e.key, 'git.remoteUnreachable');
      assert.match(e.fix, /git ls-remote/);
      return true;
    });
  } finally { limpiar(base); }
});

test('ensureAiDevBranch crea ai-dev desde dev en un repo local y es idempotente', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'));
    const r1 = ensureAiDevBranch(repo, { from: 'dev' });
    assert.deepEqual({ branch: r1.branch, created: r1.created, from: r1.from }, { branch: 'ai-dev', created: true, from: 'dev' });
    assert.ok(remoteHeads(repo).includes('ai-dev'));
    const r2 = ensureAiDevBranch(repo, { from: 'dev' });
    assert.equal(r2.created, false, 'la segunda vez no crea nada');
  } finally { limpiar(base); }
});

test('ensureAiDevBranch elige dev|main|master cuando no se indica base', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'), { branch: 'master' });
    const r = ensureAiDevBranch(repo, {});
    assert.equal(r.from, 'master');
  } finally { limpiar(base); }
});

test('ensureAiDevBranch falla con arreglo si no hay rama base', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'), { branch: 'trunk' });
    assert.throws(() => ensureAiDevBranch(repo, {}), (e) => {
      assert.equal(e.key, 'git.baseBranchMissing');
      assert.match(e.fix, /--from <rama-existente>/);
      return true;
    });
  } finally { limpiar(base); }
});

test('un remoto por URL sin ai-dev pide --push en vez de tocarlo a ciegas', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'));
    // `file://` se comporta como remoto (no como ruta local) para ensureAiDevBranch
    const url = 'file://' + repo.split('\\').join('/');
    assert.throws(() => ensureAiDevBranch(url, { from: 'dev' }), (e) => {
      assert.equal(e.key, 'git.branchMissingNeedsPush');
      assert.match(e.fix, /--push/);
      return true;
    });
  } finally { limpiar(base); }
});

test('currentBranch, isDirty y behindCount reflejan el estado real', () => {
  const base = tmp();
  try {
    const repo = makeRepo(join(base, 'repo'));
    assert.equal(currentBranch(repo), 'dev');
    assert.equal(isDirty(repo), false);
    writeFileSync(join(repo, 'LEEME.txt'), 'cambio local\n');
    assert.equal(isDirty(repo), true);
    gitq(['checkout', '--', 'LEEME.txt'], repo);

    ensureAiDevBranch(repo, { from: 'dev' });
    commitOn(repo, 'dev', 'avance en dev');
    gitq(['checkout', 'ai-dev'], repo);
    assert.equal(behindCount(repo, 'dev'), 1, 'ai-dev está 1 commit por detrás de dev');
    assert.equal(behindCount(repo, 'rama-inexistente'), null);
  } finally { limpiar(base); }
});
