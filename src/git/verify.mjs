// Verificación del clon de IA: refspec, refs remotas protegidas, hooksPath, rama actual, nombre *-ai.
import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { git } from '../lib/exec.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { aiBranch, protectedBranchRe, currentBranch, isDirty } from './branch.mjs';
import { aiRefspec, restrictRefspec } from './clone-ai.mjs';

/**
 * @typedef {{code:'not-a-repo'|'refspec'|'remote-protected-ref'|'hooksPath'|'branch'|'dirname', detail?:string, fix:string}} Problem
 */

/**
 * @param {string} repoDir
 * @param {object} policy
 * @param {{requireHooks?:boolean}} [opts]
 * @returns {{ok:boolean, problems:Problem[]}}
 */
export function verify(repoDir, policy, { requireHooks = true } = {}) {
  const dir = resolve(repoDir);
  const ai = aiBranch(policy);
  const problems = [];
  if (git(['rev-parse', '--show-toplevel'], { cwd: dir }).status !== 0) {
    return { ok: false, problems: [{ code: 'not-a-repo', fix: `bot-secure branch clone-ai <remoto> "${dir}"` }] };
  }
  const fetch = git(['config', '--get-all', 'remote.origin.fetch'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  const want = aiRefspec(ai);
  if (fetch.length !== 1 || fetch[0] !== want) {
    problems.push({ code: 'refspec', detail: fetch.join(' ') || '(sin remoto)', fix: `git -C "${dir}" config --replace-all remote.origin.fetch "${want}"` });
  }
  const prot = protectedBranchRe(policy);
  const refs = git(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  const bad = refs.filter((n) => n !== 'HEAD' && n !== ai && prot.test(n));
  if (bad.length) {
    problems.push({ code: 'remote-protected-ref', detail: bad.join(', '), fix: bad.map((n) => `git -C "${dir}" update-ref -d refs/remotes/origin/${n}`).join(' && ') });
  }
  if (requireHooks) {
    const hp = git(['config', '--get', 'core.hooksPath'], { cwd: dir }).stdout.trim();
    if (!hp) problems.push({ code: 'hooksPath', detail: '(no configurado)', fix: `git -C "${dir}" config core.hooksPath ${hooksDirFor(dir)}` });
    else if (!existsSync(resolve(dir, hp))) problems.push({ code: 'hooksPath', detail: hp, fix: `bot-secure init` });
  }
  const br = currentBranch(dir);
  if (br !== ai) problems.push({ code: 'branch', detail: br ?? '?', fix: `git -C "${dir}" switch ${ai}` });
  const wsRoot = findWorkspaceRoot(dir) ?? dir;
  if (!/-ai$/.test(basename(wsRoot))) problems.push({ code: 'dirname', detail: basename(wsRoot), fix: `mv "${wsRoot}" "${wsRoot}-ai"` });
  return { ok: problems.length === 0, problems };
}

/** Carpeta de hooks: la del repo si existe, si no la del workspace (relativa), si no `.githooks`. */
function hooksDirFor(dir) {
  if (existsSync(resolve(dir, '.githooks'))) return '.githooks';
  const ws = findWorkspaceRoot(dir);
  if (ws && ws !== dir && existsSync(resolve(ws, '.githooks'))) return relative(dir, resolve(ws, '.githooks')).split(/[\\/]/).join('/');
  return '.githooks';
}

/**
 * Aplica los arreglos seguros (--fix). `branch` solo si el árbol está limpio.
 * @returns {{code:string, fixed:boolean, reason?:string}[]}
 */
export function applyFixes(repoDir, problems, policy) {
  const dir = resolve(repoDir);
  const ai = aiBranch(policy);
  const out = [];
  for (const p of problems) {
    switch (p.code) {
      case 'refspec':
      case 'remote-protected-ref':
        restrictRefspec(dir, ai); out.push({ code: p.code, fixed: true }); break;
      case 'hooksPath': {
        const hd = hooksDirFor(dir);
        if (!existsSync(resolve(dir, hd))) { out.push({ code: p.code, fixed: false, reason: 'no-hooks-dir' }); break; }
        git(['config', 'core.hooksPath', hd], { cwd: dir }); out.push({ code: p.code, fixed: true }); break;
      }
      case 'branch': {
        if (isDirty(dir)) { out.push({ code: p.code, fixed: false, reason: 'dirty' }); break; }
        let r = git(['switch', ai], { cwd: dir });
        if (r.status !== 0) r = git(['switch', '-c', ai, '--track', `origin/${ai}`], { cwd: dir });
        out.push({ code: p.code, fixed: r.status === 0, reason: r.status === 0 ? undefined : 'switch-failed' }); break;
      }
      default:
        out.push({ code: p.code, fixed: false, reason: 'manual' });
    }
  }
  return out;
}
