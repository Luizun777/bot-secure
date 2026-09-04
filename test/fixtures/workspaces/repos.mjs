// Ayudas para las pruebas: repos git temporales construidos a partir de test/fixtures/projects.
// No es una prueba: lo importan test/unit/{git,workspace}-*.test.mjs y test/e2e/workspace-*.test.mjs.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../../src/lib/exec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECTS = join(HERE, '..', 'projects');

/** git con identidad fija y sin firma, para que las pruebas no dependan de la config del usuario. */
export function gitq(args, cwd) {
  return git(['-c', 'user.email=bot@example.invalid', '-c', 'user.name=bot-secure', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=dev', ...args], { cwd });
}

/**
 * Crea un repo git en `dir` con el contenido de un fixture de proyecto y un commit en `branch`.
 * @param {string} dir carpeta destino (se crea)
 * @param {{fixture?:string, branch?:string}} [opts] `fixture` = nombre bajo test/fixtures/projects
 * @returns {string} dir
 */
export function makeRepo(dir, { fixture, branch = 'dev' } = {}) {
  mkdirSync(dir, { recursive: true });
  if (fixture) cpSync(join(PROJECTS, fixture), dir, { recursive: true });
  else writeFileSync(join(dir, 'README.md'), '# repo de prueba (sin secretos)\n');
  writeFileSync(join(dir, 'LEEME.txt'), 'Repositorio de prueba de bot-secure. Sin secretos ni datos reales.\n');
  let r = gitq(['init', '-b', branch], dir);
  if (r.status !== 0) { gitq(['init'], dir); gitq(['checkout', '-b', branch], dir); }
  gitq(['add', '-A'], dir);
  r = gitq(['commit', '-m', 'inicial'], dir);
  if (r.status !== 0) throw new Error('no se pudo crear el commit inicial: ' + r.stderr);
  return dir;
}

/** Añade un commit vacío a `branch` (para medir atraso). */
export function commitOn(dir, branch, message = 'cambio') {
  const before = gitq(['rev-parse', '--abbrev-ref', 'HEAD'], dir).stdout.trim();
  gitq(['checkout', branch], dir);
  gitq(['commit', '--allow-empty', '-m', message], dir);
  if (before && before !== branch) gitq(['checkout', before], dir);
}

export function limpiar(dir) { rmSync(dir, { recursive: true, force: true }); }
