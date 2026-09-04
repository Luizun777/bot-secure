// Ramas: ai-dev, ramas protegidas, estado del repo (rama, sucio, atraso).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/exec.mjs';
import { BotSecureError } from '../lib/errors.mjs';

export const DEFAULT_PROTECTED = Object.freeze(['dev', 'qa', 'prd', 'prod', 'main', 'master', 'release/*']);

/** Nombre de la rama de IA según policy (por defecto ai-dev). */
export function aiBranch(policy) { return policy?.branches?.ai || 'ai-dev'; }

/** Regex anclado que reconoce ramas protegidas (globs simples con `*`). */
export function protectedBranchRe(policy) {
  const list = policy?.branches?.protected?.length ? policy.branches.protected : DEFAULT_PROTECTED;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = list.map((g) => g.split('*').map(esc).join('.*'));
  return new RegExp(`^(?:${parts.join('|')})$`);
}

export function currentBranch(dir) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** ¿Hay cambios en archivos trackeados? (`--porcelain -uno`, barato). */
export function isDirty(dir) {
  const r = git(['status', '--porcelain', '-uno'], { cwd: dir });
  return r.status === 0 && r.stdout.trim().length > 0;
}

/** Commits que HEAD tiene por detrás de `upstream`; null si el upstream no existe. */
export function behindCount(dir, upstream) {
  const r = git(['rev-list', '--count', `HEAD..${upstream}`], { cwd: dir });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
}

/** ¿`remote` es una ruta local (repo o bare) y no una URL/scp? */
export function isLocalRepoPath(remote) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) return false;
  if (/^[^/\\:]+@[^:]+:/.test(remote)) return false;
  return existsSync(remote);
}

/** Ramas (heads) del remoto o ruta. Lanza si no es alcanzable. */
export function remoteHeads(remote, { cwd = process.cwd() } = {}) {
  const r = git(['ls-remote', '--heads', remote], { cwd });
  if (r.status !== 0) {
    throw new BotSecureError('git.remoteUnreachable', { vars: { remote, detail: firstLine(r.stderr) }, fix: `git ls-remote --heads ${remote}` });
  }
  return r.stdout.split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1].replace(/^refs\/heads\//, ''));
}

const firstLine = (s) => String(s || '').trim().split('\n')[0];

/**
 * Garantiza que exista la rama de IA en el remoto/ruta. Si falta, la crea desde `from` (o dev|main|master).
 * Ruta local: se crea directamente. URL: hace falta `push:true` (clon temporal bare + push).
 * @returns {{branch:string, created:boolean, from:string|null, pushed:boolean, local:boolean}}
 */
export function ensureAiDevBranch(remoteOrRepo, { from, branch = 'ai-dev', push = false, cwd = process.cwd() } = {}) {
  const heads = remoteHeads(remoteOrRepo, { cwd });
  const local = isLocalRepoPath(remoteOrRepo);
  if (heads.includes(branch)) return { branch, created: false, from: null, pushed: false, local };
  const base = from ?? ['dev', 'main', 'master'].find((b) => heads.includes(b));
  if (!base || !heads.includes(base)) {
    throw new BotSecureError('git.baseBranchMissing', {
      vars: { remote: remoteOrRepo, from: from ?? 'dev|main|master', heads: heads.join(', ') || '-' },
      fix: `bot-secure branch create ${remoteOrRepo} --from <rama-existente>${local ? '' : ' --push'}`,
    });
  }
  if (local) {
    const r = git(['branch', branch, base], { cwd: remoteOrRepo });
    if (r.status !== 0) throw new BotSecureError('git.branchCreateFailed', { vars: { branch, detail: firstLine(r.stderr) }, fix: `git -C "${remoteOrRepo}" branch ${branch} ${base}` });
    return { branch, created: true, from: base, pushed: true, local: true };
  }
  if (!push) {
    throw new BotSecureError('git.branchMissingNeedsPush', { vars: { remote: remoteOrRepo, branch, from: base }, fix: `bot-secure branch create ${remoteOrRepo} --from ${base} --push` });
  }
  const tmp = mkdtempSync(join(tmpdir(), 'bot-secure-branch-'));
  try {
    const repo = join(tmp, 'repo.git');
    const c = git(['clone', '--bare', '--single-branch', '--branch', base, '--no-tags', remoteOrRepo, repo], { cwd: tmp });
    if (c.status !== 0) throw new BotSecureError('git.cloneFailed', { vars: { remote: remoteOrRepo, branch: base, detail: firstLine(c.stderr) }, fix: `git ls-remote --heads ${remoteOrRepo}` });
    const p = git(['push', 'origin', `refs/heads/${base}:refs/heads/${branch}`], { cwd: repo });
    if (p.status !== 0) throw new BotSecureError('git.pushFailed', { vars: { remote: remoteOrRepo, branch, detail: firstLine(p.stderr) }, fix: `git push ${remoteOrRepo} refs/heads/${base}:refs/heads/${branch}` });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { branch, created: true, from: base, pushed: true, local: false };
}
