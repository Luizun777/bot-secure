// Descubrimiento de apps (monorepo, raíz-app o subcarpetas) y descripción completa de cada una.
import { basename, dirname, join, resolve } from 'node:path';
import { readJsonSafe, readText, readMany, filesWithExt, subdirs, dirExists, toPosix } from './manifests.mjs';
import { detectStackInfo, detectStack, kindFor, envStrategyFor, detectPackageManager, detectPort, hasDockerfile } from './stack.mjs';
import { detectCommands } from './commands.mjs';
import { detectRegistries, detectSdks, detectSecretManagers } from './deps.mjs';
import { detectOrm } from './orm.mjs';

/**
 * @typedef {object} App
 * @property {string} name
 * @property {string} path ruta relativa posix ('.' si la raíz es la app)
 * @property {'backend'|'frontend'|'mobile'|'lib'|'unknown'} kind
 * @property {string} stack
 * @property {string} envStrategy
 * @property {string} packageManager
 * @property {string[]} manifests
 * @property {string} [runCmd]
 * @property {string} [testCmd]
 * @property {string} [buildCmd]
 * @property {string} [lintCmd]
 * @property {string} [testFileCmd] comando de prueba de un archivo con `{file}`
 * @property {number} [port]
 * @property {string[]} registries
 * @property {string[]} sdks
 * @property {string[]} secretManagers
 * @property {string} [orm]
 * @property {string} [migrationsDir]
 * @property {boolean} hasDockerfile
 */

const CONVENTIONAL_DIRS = ['apps', 'packages', 'services', 'projects'];

/** Describe una app completa a partir de su carpeta. */
export function describeApp(dir, { name, path, kind } = {}) {
  const info = detectStackInfo(dir);
  const { stack } = info;
  const cmds = detectCommands(dir, stack);
  const { orm, migrationsDir } = detectOrm(dir);
  const app = {
    name: name ?? basename(resolve(dir)),
    path: path ?? '.',
    kind: kind ?? kindFor(info),
    stack,
    envStrategy: envStrategyFor(stack),
    packageManager: detectPackageManager(dir, stack),
    manifests: info.manifests,
    ...cmds,
    port: ['frontend', 'backend'].includes(kind ?? kindFor(info)) ? detectPort(dir, stack) : undefined,
    registries: detectRegistries(dir),
    sdks: detectSdks(dir),
    secretManagers: detectSecretManagers(dir),
    orm,
    migrationsDir,
    hasDockerfile: hasDockerfile(dir),
  };
  return Object.fromEntries(Object.entries(app).filter(([, v]) => v !== undefined));
}

/**
 * Apps del workspace. Con `apps` (de policy.json) re-detecta cada una conservando name/kind/remote/branch/dependsOn.
 * Sin `apps`: monorepo (workspaces, pnpm, gradle, .sln) → raíz como app → subcarpetas con manifiesto.
 * @returns {App[]}
 */
export function detectApps(root, { apps } = {}) {
  if (Array.isArray(apps) && apps.length) {
    return apps.map((a) => {
      const dir = join(root, ...a.path.split('/').filter((s) => s && s !== '.'));
      const fresh = describeApp(dir, { name: a.name, path: a.path, kind: a.kind });
      for (const k of ['remote', 'branch', 'dependsOn']) if (a[k] !== undefined) fresh[k] = a[k];
      return fresh;
    });
  }
  const members = monorepoMembers(root);
  if (members.length) return members.map((rel) => describeApp(join(root, ...rel.split('/')), { name: basename(rel), path: rel }));
  if (detectStackInfo(root).stack !== 'unknown') return [describeApp(root, { name: basename(resolve(root)), path: '.' })];
  let subs = subdirs(root).filter((s) => detectStack(join(root, s)) !== 'unknown');
  if (!subs.length) {
    for (const conv of CONVENTIONAL_DIRS) {
      if (!dirExists(join(root, conv))) continue;
      subs.push(...subdirs(join(root, conv)).map((s) => `${conv}/${s}`).filter((rel) => detectStack(join(root, ...rel.split('/'))) !== 'unknown'));
    }
  }
  return subs.map((rel) => describeApp(join(root, ...rel.split('/')), { name: basename(rel), path: rel }));
}

/** Miembros declarados de un monorepo (rutas relativas posix con manifiesto reconocible). */
export function monorepoMembers(root) {
  const globs = [];
  const pkg = readJsonSafe(join(root, 'package.json'));
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  if (Array.isArray(ws)) globs.push(...ws);
  const pnpm = readText(join(root, 'pnpm-workspace.yaml'));
  if (pnpm) for (const m of pnpm.matchAll(/^\s*-\s*["']?([^"'\s#]+)/gm)) globs.push(m[1]);
  const gradle = readMany(root, ['settings.gradle', 'settings.gradle.kts']);
  for (const m of gradle.matchAll(/include\s*\(?\s*((?:["'][^"']+["']\s*,?\s*)+)\)?/g)) {
    for (const p of m[1].matchAll(/["']:?([^"']+)["']/g)) globs.push(p[1].replace(/:/g, '/'));
  }
  for (const sln of filesWithExt(root, '.sln')) {
    for (const m of (readText(join(root, sln)) ?? '').matchAll(/Project\("[^"]+"\)\s*=\s*"[^"]+",\s*"([^"]+\.(?:cs|fs)proj)"/g)) globs.push(dirname(m[1].replace(/\\/g, '/')));
  }
  const dirs = new Set();
  for (const g of globs.filter((g) => !g.startsWith('!'))) {
    const clean = g.replace(/\/+$/, '').replace(/\/\*\*$/, '/*');
    if (clean.includes('*')) {
      const base = clean.split('/*')[0];
      const baseDir = base ? join(root, ...base.split('/')) : root;
      for (const s of subdirs(baseDir)) dirs.add(toPosix(base ? `${base}/${s}` : s));
    } else if (clean && clean !== '.') dirs.add(toPosix(clean));
  }
  return [...dirs].filter((rel) => dirExists(join(root, ...rel.split('/'))) && detectStack(join(root, ...rel.split('/'))) !== 'unknown').sort();
}
