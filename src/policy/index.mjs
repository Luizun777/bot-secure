// API pública del módulo policy: cargar/guardar/validar/compilar la política y manejar lock/local.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import DEFAULTS from './defaults.json' with { type: 'json' };
import { dirname, join } from 'node:path';
import { validatePolicy } from './schema.mjs';

export const POLICY_FILE = join('.bot-secure', 'policy.json');

export { validatePolicy, protectedBranchRe, branchPatternToRegExp } from './schema.mjs';
export { compile, compileSettings, allowedDomains } from './compile.mjs';
export { writeLock, readLock, verifyIntegrity, isGuardArtifact, LOCK_FILE, GUARD_FILE, CLAUDE_CODE_MIN } from './lock.mjs';
export { readLocal, writeLocal, LOCAL_FILE } from './local.mjs';
export { classifyPath, isGuardPath, isInside } from './sensitive.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Política por defecto con proyecto/apps/db opcionales.
 * @param {{project?:string, apps?:object[], db?:object, profile?:string}} [opts]
 */
export function defaultPolicy({ project = '', apps = [], db = {}, profile } = {}) {
  const p = clone(DEFAULTS);
  p.project = project;
  p.apps = apps.map((a) => ({ name: a.name, path: a.path ?? a.name, kind: a.kind ?? 'unknown', stack: a.stack ?? 'unknown', envStrategy: a.envStrategy ?? 'manual',
    packageManager: a.packageManager ?? '', runCmd: a.runCmd ?? '', testCmd: a.testCmd ?? '', port: a.port, dependsOn: a.dependsOn ?? [], remote: a.remote ?? '', branch: a.branch ?? p.branches.ai }));
  p.db = { ...p.db, ...db };
  if (profile) p.profile = profile;
  return p;
}

/** Lee .bot-secure/policy.json (lanza si falta o es inválido en JSON). */
export function loadPolicy(root) {
  return JSON.parse(readFileSync(join(root, POLICY_FILE), 'utf8'));
}

/** Escribe .bot-secure/policy.json (valida antes; lanza Error con la lista si es inválida). */
export function savePolicy(root, policy) {
  const errors = validatePolicy(policy);
  if (errors.length) { const e = new Error('policy inválida: ' + errors.map((x) => `${x.path}: ${x.message}`).join('; ')); e.errors = errors; throw e; }
  const p = join(root, POLICY_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(policy, null, 2) + '\n');
  return p;
}
