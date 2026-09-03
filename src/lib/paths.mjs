// Localización de raíces: workspace de IA (.bot-secure/policy.json) y repo git.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './exec.mjs';

export const POLICY_FILE = '.bot-secure/policy.json';

/** Sube desde `start` hasta encontrar .bot-secure/policy.json. null si no hay workspace. */
export function findWorkspaceRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, POLICY_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Raíz del repo git que contiene `start` (null si no es repo). */
export function findGitRoot(start = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], { cwd: start });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function currentBranch(cwd) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return r.status === 0 ? r.stdout.trim() : null;
}
