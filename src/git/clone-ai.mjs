// Clon de IA: single-branch ai-dev, refspec restringido, sin tags, con submódulos.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { git } from '../lib/exec.mjs';
import { BotSecureError } from '../lib/errors.mjs';
import { isLocalRepoPath } from './branch.mjs';

/** Refspec único permitido para la rama de IA. */
export const aiRefspec = (branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`;

/**
 * Clona solo `branch` en `dest`. Con rutas locales usa --no-local para no copiar objetos de otras ramas.
 * @returns {{dest:string, branch:string}}
 */
export function cloneAi(remote, dest, { branch = 'ai-dev', submodules = true } = {}) {
  const target = resolve(dest);
  if (existsSync(target) && readdirSync(target).length) {
    throw new BotSecureError('git.destNotEmpty', { vars: { dest: target }, fix: `mv "${target}" "${target}.bak"` });
  }
  const args = ['clone', '--single-branch', '--branch', branch, '--no-tags'];
  if (submodules) args.push('--recurse-submodules');
  if (isLocalRepoPath(remote)) args.push('--no-local');
  args.push(remote, target);
  const r = git(args, { cwd: dirname(target) });
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim().split('\n').pop();
    throw new BotSecureError('git.cloneFailed', { vars: { remote, branch, detail }, fix: `bot-secure branch create ${remote} --from dev --push` });
  }
  restrictRefspec(target, branch);
  return { dest: target, branch };
}

/** Deja un único refspec para `branch`, sin tags, y borra refs remotas ajenas. */
export function restrictRefspec(dir, branch = 'ai-dev') {
  git(['config', '--replace-all', 'remote.origin.fetch', aiRefspec(branch)], { cwd: dir });
  git(['config', 'remote.origin.tagOpt', '--no-tags'], { cwd: dir });
  const keep = new Set([`refs/remotes/origin/${branch}`, 'refs/remotes/origin/HEAD']);
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  const removed = [];
  for (const ref of refs) if (!keep.has(ref)) { git(['update-ref', '-d', ref], { cwd: dir }); removed.push(ref); }
  return { refspec: aiRefspec(branch), removed };
}
