// Recorrido del árbol de archivos: incluye lo ignorado por .gitignore, no sigue symlinks fuera del
// root, detecta submódulos y punteros LFS y NUNCA salta en silencio (todo lo omitido va a `skipped`).
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { matchesAny } from './rules.mjs';

/** Directorios que se excluyen siempre (ruido puro, nunca contienen el original de un secreto). */
export const HARD_SKIP_DIRS = ['.git', 'node_modules', 'vendor', 'bower_components', '.venv', 'venv',
  '__pycache__', '.gradle', '.idea/caches', '.terraform', '.mypy_cache', '.pytest_cache', '.tox',
  '.svn', '.hg', 'Pods', 'DerivedData', '.cache', '.parcel-cache', '.turbo', '.pnpm-store'];

/** Directorios de artefactos de compilación: se saltan salvo `--build`. */
export const BUILD_DIRS = ['dist', 'build', 'out', 'target', '.next', '.nuxt', '.output', '.svelte-kit', 'coverage'];

/** Archivos excluidos por defecto (ruido de alta entropía). */
export const DEFAULT_EXCLUDES = [
  '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/npm-shrinkwrap.json',
  '**/Cargo.lock', '**/go.sum', '**/poetry.lock', '**/Pipfile.lock', '**/composer.lock',
  '**/Gemfile.lock', '**/packages.lock.json', '**/*.min.js', '**/*.min.css', '**/*.map',
  '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.eot', '**/*.ico', '**/*.icns',
  '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.bmp', '**/*.tiff',
  '**/*.mp3', '**/*.mp4', '**/*.avi', '**/*.mov', '**/*.zip', '**/*.gz', '**/*.tgz',
  '**/*.bz2', '**/*.xz', '**/*.7z', '**/*.rar', '**/*.class', '**/*.o', '**/*.so',
  '**/*.dylib', '**/*.dll', '**/*.exe', '**/*.wasm', '**/*.pyc', '**/*.pdb',
];

/** Nunca se saltan, pase lo que pase (aunque estén en excludes o pasen del tamaño máximo). */
export const NEVER_SKIP = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks',
  '**/*.keystore', '**/*.bks', '**/*.p8', '**/*.mobileprovision', '**/.npmrc', '**/.netrc',
  '**/_netrc', '**/.git-credentials', '**/.git/config', '**/kubeconfig*', '**/.kube/config',
  '**/*.tfstate', '**/*.tfstate.*', '**/compose.yml', '**/compose.yaml',
  '**/docker-compose*.yml', '**/docker-compose*.yaml', '**/*.compose.yml', '**/*.compose.yaml',
  '**/appsettings*.json', '**/application*.yml', '**/application*.yaml', '**/application*.properties',
  '**/.mcp.json', '**/.vscode/launch.json', '**/.idea/*.xml', '**/Jenkinsfile', '**/.gitlab-ci.yml',
  '**/local.properties', '**/key.properties', '**/google-services.json', '**/GoogleService-Info.plist',
  '**/*.har', '**/*.saz', '**/*.log', '**/*.kdbx', '**/*.ovpn', '**/*.pgpass', '**/.pgpass',
  '**/.my.cnf', '**/.s3cfg', '**/.boto', '**/.pypirc', '**/id_rsa', '**/id_dsa', '**/id_ecdsa',
  '**/id_ed25519', '**/*.ppk', '**/Tiltfile', '**/skaffold.yaml', '**/helmfile.yaml', '**/*.env.j2',
  '**/credentials.json', '**/service-account*.json', '**/*.cer', '**/*.crt', '**/*.der',
];

/** Extensiones de datos: si pasan del tamaño máximo se escanean por chunks, no se saltan. */
export const STREAM_EXT = /\.(csv|tsv|psv|sql|json|jsonl|ndjson|xml|ya?ml|txt|md|log|har|properties|resx)$/i;

const LFS_MAGIC = 'version https://git-lfs.github.com/spec/';

/** @typedef {{rel:string, abs:string, size:number, stream:boolean, neverSkip:boolean}} WalkFile */
/** @typedef {{path:string, reason:string, size?:number, target?:string}} Skipped */

/** ¿Está en la lista never-skip? */
export function isNeverSkip(rel) { return matchesAny(rel, NEVER_SKIP); }

const posix = (p) => String(p).split(sep).join('/');

/** ¿El archivo parece un puntero de Git LFS? (lee como mucho 200 bytes). */
export function looksLikeLfsPointer(abs, size) {
  if (size > 1024 || size < 100) return false;
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(Math.min(200, size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8').startsWith(LFS_MAGIC);
  } catch { return false; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ya cerrado */ } }
}

/**
 * Recorre el árbol y clasifica cada entrada.
 * @param {object} opts
 * @param {string} opts.root raíz absoluta
 * @param {string[]} [opts.paths] subrutas concretas (relativas al root); vacío = todo el árbol
 * @param {string[]} [opts.include] globs: si se dan, solo se escanea lo que encaje
 * @param {string[]} [opts.exclude] globs extra de exclusión (además de DEFAULT_EXCLUDES)
 * @param {boolean} [opts.build] incluir dist/build/target…
 * @param {boolean} [opts.full] ignorar el límite de tamaño (todo se escanea completo)
 * @param {number} [opts.maxFileSizeMB=1]
 * @param {number} [opts.maxDepth=40]
 * @returns {{files: WalkFile[], skipped: Skipped[], symlinks: {rel:string, target:string, outside:boolean}[], warnings: string[], dirs: number}}
 */
export function collect({ root, paths = [], include = [], exclude = [], build = false, full = false, maxFileSizeMB = 1, maxDepth = 40 } = {}) {
  const rootAbs = resolve(root);
  let rootReal = rootAbs;
  try { rootReal = realpathSync(rootAbs); } catch { /* raíz sin realpath: se usa la ruta dada */ }
  const maxBytes = Math.max(1, Number(maxFileSizeMB) || 1) * 1024 * 1024;
  const excludes = [...DEFAULT_EXCLUDES, ...exclude];
  const files = [], skipped = [], symlinks = [], warnings = [];
  let dirs = 0;

  const roots = paths.length ? paths.map((p) => resolve(rootAbs, p)) : [rootAbs];

  for (const start of roots) {
    if (!existsSync(start)) { warnings.push(`missing:${posix(relative(rootAbs, start))}`); continue; }
    walkEntry(start, 0);
  }

  function walkEntry(abs, depth) {
    let st;
    try { st = lstatSync(abs); } catch { skipped.push({ path: posix(relative(rootAbs, abs)), reason: 'unreadable' }); return; }
    const rel = posix(relative(rootAbs, abs)) || '.';

    if (st.isSymbolicLink()) {
      let target = '';
      let outside = true;
      try { target = realpathSync(abs); outside = !(target === rootReal || target.startsWith(rootReal + sep)); } catch { target = '?'; }
      symlinks.push({ rel, target: outside ? target : posix(relative(rootAbs, target)), outside });
      skipped.push({ path: rel, reason: 'symlink', target: outside ? target : posix(relative(rootAbs, target)) });
      return;
    }

    if (st.isDirectory()) {
      if (depth > maxDepth) { skipped.push({ path: rel, reason: 'max-depth' }); return; }
      const base = abs.split(sep).pop();
      if (depth > 0) {
        if (HARD_SKIP_DIRS.includes(base)) { skipped.push({ path: rel, reason: 'excluded-dir' }); return; }
        if (!build && BUILD_DIRS.includes(base)) { skipped.push({ path: rel, reason: 'build-dir' }); return; }
      }
      // submódulo: carpeta con un archivo `.git` (no directorio)
      try {
        const dotGit = join(abs, '.git');
        if (depth > 0 && existsSync(dotGit) && lstatSync(dotGit).isFile()) {
          warnings.push(`submodule:${rel}`);
          skipped.push({ path: rel, reason: 'submodule' });
          return;
        }
      } catch { /* sin permisos: se recorre igual */ }
      dirs++;
      let entries;
      try { entries = readdirSync(abs); } catch { skipped.push({ path: rel, reason: 'unreadable' }); return; }
      for (const name of entries.sort()) walkEntry(join(abs, name), depth + 1);
      return;
    }

    if (!st.isFile()) { skipped.push({ path: rel, reason: 'not-a-file' }); return; }

    const never = isNeverSkip(rel);
    if (!never) {
      if (include.length && !matchesAny(rel, include)) return;
      if (matchesAny(rel, excludes)) { skipped.push({ path: rel, reason: 'excluded', size: st.size }); return; }
    }
    if (st.size === 0) { skipped.push({ path: rel, reason: 'empty' }); return; }
    if (looksLikeLfsPointer(abs, st.size)) { skipped.push({ path: rel, reason: 'lfs', size: st.size }); return; }

    let stream = false;
    if (!full && st.size > maxBytes) {
      if (STREAM_EXT.test(rel) || never) stream = true;
      else { skipped.push({ path: rel, reason: 'size', size: st.size }); return; }
    }
    files.push({ rel, abs, size: st.size, stream, neverSkip: never });
  }

  return { files, skipped, symlinks, warnings, dirs };
}
