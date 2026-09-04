// Instalación de git hooks nativos: core.hooksPath + bit ejecutable (fs y, si están trackeados, en el índice).
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { git } from '../lib/exec.mjs';

const toPosix = (p) => p.split(/[\\/]/).join('/');

/**
 * @param {string} repoDir
 * @param {{hooksDir?:string}|{path:string}[]} [optsOrArtifacts] opciones o artefactos de policy.compile (se deduce `.githooks`)
 * @returns {{hooksPath:string, files:{file:string, tracked:boolean}[]}}
 */
export function installHooks(repoDir, optsOrArtifacts = {}) {
  let hooksDir = '.githooks';
  if (Array.isArray(optsOrArtifacts)) {
    const a = optsOrArtifacts.find((x) => /(^|[\\/])\.githooks[\\/]/.test(x.path));
    if (a) { const parts = a.path.split(/[\\/]/); hooksDir = parts.slice(0, parts.indexOf('.githooks') + 1).join('/') || '.githooks'; }
  } else if (optsOrArtifacts.hooksDir) hooksDir = optsOrArtifacts.hooksDir;

  const abs = isAbsolute(hooksDir) ? hooksDir : resolve(repoDir, hooksDir);
  const configured = isAbsolute(hooksDir) ? hooksDir : toPosix(hooksDir);
  git(['config', 'core.hooksPath', configured], { cwd: repoDir });
  const files = [];
  if (existsSync(abs)) {
    for (const f of readdirSync(abs)) {
      const p = join(abs, f);
      if (!statSync(p).isFile()) continue;
      try { chmodSync(p, 0o755); } catch { /* Windows: sin bits; se usa update-index */ }
      const rel = toPosix(relative(repoDir, p));
      const tracked = !rel.startsWith('..') && git(['ls-files', '--error-unmatch', rel], { cwd: repoDir }).status === 0;
      if (tracked) git(['update-index', '--chmod=+x', rel], { cwd: repoDir });
      files.push({ file: rel, tracked });
    }
  }
  return { hooksPath: configured, files };
}
