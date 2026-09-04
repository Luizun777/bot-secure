// lock.json (versionado): hashes de los artefactos generados + hash del guard. Sin rutas de máquina.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import PKG from '../../package.json' with { type: 'json' };
import { dirname, join, sep } from 'node:path';

export const LOCK_FILE = join('.bot-secure', 'lock.json');
export const GUARD_FILE = join('.claude', 'hooks', 'guard.mjs');
export const CLAUDE_CODE_MIN = '2.1.246';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(sep).join('/');

function botVersion() {
  return PKG.version ?? '0.0.0';
}

async function rulesVersion() {
  try { const m = await import('../engine/index.mjs'); return m.RULES_VERSION ?? null; } catch { return null; }
}

/**
 * Escribe .bot-secure/lock.json a partir de los artefactos compilados.
 * @param {string} root raíz del workspace
 * @param {{path:string, content:string|Buffer}[]} artifacts
 * @param {{rulesVersion?:string|null}} [opts]
 * @returns {Promise<object>} el lock escrito
 */
export async function writeLock(root, artifacts, opts = {}) {
  const guardPath = join(root, GUARD_FILE);
  const lock = {
    version: botVersion(),
    rulesVersion: opts.rulesVersion === undefined ? await rulesVersion() : opts.rulesVersion,
    claudeCodeMin: CLAUDE_CODE_MIN,
    generatedAt: new Date().toISOString(),
    generated: artifacts.map((a) => ({ path: toPosix(a.path), sha256: sha256(a.content) })).sort((a, b) => a.path.localeCompare(b.path)),
    guardSha256: existsSync(guardPath) ? sha256(readFileSync(guardPath)) : null,
  };
  const p = join(root, LOCK_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

/** Lee lock.json; null si no existe o no es JSON. */
export function readLock(root) {
  try { return JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')); } catch { return null; }
}

/**
 * Compara los artefactos del lock con el disco.
 * @param {string} root
 * @param {{only?:(path:string)=>boolean}} [opts] filtro de rutas a verificar (p. ej. solo guardas)
 * @returns {{ok:boolean, drift:{path:string, expected:string|null, actual:string|null}[]}}
 */
export function verifyIntegrity(root, opts = {}) {
  const lock = readLock(root);
  if (!lock) return { ok: false, drift: [{ path: toPosix(LOCK_FILE), expected: 'lock', actual: 'missing' }] };
  const drift = [];
  for (const g of lock.generated ?? []) {
    if (opts.only && !opts.only(g.path)) continue;
    const p = join(root, ...g.path.split('/'));
    const actual = existsSync(p) ? sha256(readFileSync(p)) : 'missing';
    if (actual !== g.sha256) drift.push({ path: g.path, expected: g.sha256, actual });
  }
  const gp = join(root, GUARD_FILE);
  const guardActual = existsSync(gp) ? sha256(readFileSync(gp)) : 'missing';
  if (lock.guardSha256 && guardActual !== lock.guardSha256) drift.push({ path: toPosix(GUARD_FILE), expected: lock.guardSha256, actual: guardActual });
  if (!lock.guardSha256 && !opts.allowMissingGuard) drift.push({ path: toPosix(GUARD_FILE), expected: null, actual: guardActual });
  return { ok: drift.length === 0, drift };
}

/** ¿Es una ruta de guarda (la verifica el pre-tool en cada invocación)? */
export function isGuardArtifact(p) {
  return /(^|\/)\.claude\/(settings\.json|hooks\/)/.test(p) || /(^|\/)\.githooks\//.test(p);
}
