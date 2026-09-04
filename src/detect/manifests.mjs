// Lectura tolerante de manifiestos: ningún helper lanza; devuelven null/[] si algo falta.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Carpetas que nunca se recorren al buscar manifiestos. */
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', '.angular', 'coverage', '.idea', '.vscode', 'Pods', '.gradle', '.dart_tool',
  'mocks', 'docs', 'infosec',
]);

export function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }
export function readJsonSafe(p) { const t = readText(p); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } }
export const fileExists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const dirExists = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export function listDir(dir) { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } }

/** Subcarpetas "de código" (sin ocultas ni ignoradas). */
export function subdirs(dir) {
  return listDir(dir).filter((d) => d.isDirectory() && !IGNORED_DIRS.has(d.name) && !d.name.startsWith('.')).map((d) => d.name).sort();
}
/** Entradas (archivo o carpeta) cuyo nombre termina en `ext`. */
export function entriesWithExt(dir, ext) { return listDir(dir).filter((d) => d.name.endsWith(ext)).map((d) => d.name); }
export function filesWithExt(dir, ext) { return listDir(dir).filter((d) => d.isFile() && d.name.endsWith(ext)).map((d) => d.name); }

/** Nombres de dependencias de un package.json (deps + devDeps + peer). */
export function pkgDeps(pkg) {
  return Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) });
}

/** Busca un archivo por nombre hasta `depth` niveles (sin entrar en carpetas ignoradas). Ruta absoluta o null. */
export function findFile(dir, name, depth = 2) {
  if (fileExists(join(dir, name))) return join(dir, name);
  if (depth <= 0) return null;
  for (const sub of subdirs(dir)) {
    const hit = findFile(join(dir, sub), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** Busca carpetas con ese nombre hasta `depth` niveles. Devuelve rutas relativas posix. */
export function findDirs(dir, name, depth = 3, rel = '') {
  const out = [];
  for (const sub of subdirs(dir)) {
    const relPath = rel ? `${rel}/${sub}` : sub;
    if (sub === name) out.push(relPath);
    else if (depth > 0) out.push(...findDirs(join(dir, sub), name, depth - 1, relPath));
  }
  return out;
}

/** Concatena el texto de varios archivos (los que existan) para búsquedas por regex. */
export function readMany(dir, names) {
  return names.map((n) => readText(join(dir, n)) ?? '').join('\n');
}

/** Ruta relativa en formato posix (para policy.json y markdown). */
export const toPosix = (p) => p.split(/[\\/]+/).filter((s) => s !== '' && s !== '.').join('/') || '.';
