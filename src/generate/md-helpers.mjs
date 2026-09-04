// Helpers del módulo generate-context: vista segura (solo campos permitidos de policy/apps),
// carga y render de plantillas, y utilidades de texto. Nada de aquí copia valores de .env.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../lib/template.mjs';
import { BotSecureError } from '../lib/errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.join(HERE, '..', '..', 'templates');

/** @typedef {{ path: string, content: string, mode?: string }} Artifact */

/** Convierte una ruta relativa a separadores posix (para escribir dentro de los .md). */
export function toPosix(p) { return String(p).split(path.sep).join('/').replace(/\\/g, '/').replace(/^\.\//, ''); }

/** Crea un Artifact con ruta relativa al workspace usando path.join. */
export function artifact(segments, content, mode) {
  const a = { path: path.join(...segments), content: normalize(content) };
  if (mode) a.mode = mode;
  return a;
}

/** Normaliza saltos: sin 3+ líneas vacías seguidas, sin espacios finales, termina en \n. */
export function normalize(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Número de líneas (sin contar el salto final). */
export function lineCount(text) { return String(text).trimEnd().split('\n').length; }

/** Lee una plantilla: kind 'md' → templates/md/<lang>/<name> (cae a es); kind 'claude' → templates/claude/<name>. */
export function loadTemplate(kind, name, lang = 'es') {
  const candidates = kind === 'md'
    ? [path.join(TEMPLATES_DIR, 'md', lang, name), path.join(TEMPLATES_DIR, 'md', 'es', name)]
    : [path.join(TEMPLATES_DIR, 'claude', name)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, 'utf8');
  throw new BotSecureError('generate.templateMissing', { vars: { path: toPosix(path.relative(TEMPLATES_DIR, candidates[0])) }, fix: 'bot-secure doctor' });
}

/** Renderiza una plantilla con la vista dada. */
export function renderTemplate(kind, name, view, extra = {}) {
  return normalize(render(loadTemplate(kind, name, view.lang), { ...view, ...extra }));
}

/** Extrae el cuerpo de una sección '## título' de un markdown (hasta el siguiente '## '). '' si no existe. */
export function extractSection(md, title) {
  const re = new RegExp(`^## ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
  const m = re.exec(String(md ?? ''));
  return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
}

const KIND_LABEL = { backend: 'backend', frontend: 'frontend', mobile: 'app móvil', lib: 'librería', unknown: 'componente' };

/** Comando de arranque en modo IA (AI_ENV=1) según stack. */
export function runCmdAi(app) {
  const base = app.runCmd || '';
  if (app.stack === 'spring') return 'AI_ENV=1 ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev,ai';
  if (app.stack === 'angular') return 'AI_ENV=1 npx ng serve -c ai';
  if (app.stack === 'dotnet') return 'AI_ENV=1 dotnet run';
  if (!base) return '(pendiente: define runCmd de esta app en .bot-secure/policy.json)';
  return `AI_ENV=1 ${base}`;
}

/** Comando para correr UN archivo/clase de test según stack. */
export function testOneCmd(app) {
  const pm = app.packageManager || 'npm';
  const byStack = {
    spring: pm === 'gradle' ? './gradlew test --tests <Clase>' : './mvnw -q test -Dtest=<Clase>',
    dotnet: 'dotnet test --filter "FullyQualifiedName~<Clase>"',
    django: 'python manage.py test <app>.tests.<Clase>',
    fastapi: 'pytest <ruta/test_x.py> -q', flask: 'pytest <ruta/test_x.py> -q',
    laravel: 'php artisan test --filter <Clase>', symfony: 'vendor/bin/phpunit <ruta>', php: 'vendor/bin/phpunit <ruta>',
    rails: 'bin/rails test <ruta>', go: 'go test ./<paquete> -run <TestNombre>',
    angular: 'npx ng test --include <ruta.spec.ts> --watch=false',
    nest: 'npx jest <ruta>', next: 'npx jest <ruta>', cra: 'npx jest <ruta>',
    vite: 'npx vitest run <ruta>', vue: 'npx vitest run <ruta>', svelte: 'npx vitest run <ruta>', nuxt: 'npx vitest run <ruta>',
    node: `${pm} test -- <ruta>`, express: `${pm} test -- <ruta>`,
    expo: 'npx jest <ruta>', 'react-native': 'npx jest <ruta>', flutter: 'flutter test <ruta>',
    android: './gradlew testDebugUnitTest --tests <Clase>', ios: 'xcodebuild test -scheme <Scheme> -only-testing:<Target>/<Clase>',
  };
  return byStack[app.stack] || app.testCmd || '(pendiente: define testCmd de esta app en .bot-secure/policy.json)';
}

/** Globs de tests (relativos al workspace) según stack, para .claude/rules/tests.md. */
export function testGlobs(app) {
  const p = app.pathPosix;
  const g = {
    spring: [`${p}/src/test/**`], android: [`${p}/**/src/test/**`, `${p}/**/src/androidTest/**`],
    dotnet: [`${p}/**/*Tests/**`, `${p}/**/*.Tests/**`],
    django: [`${p}/**/tests/**`, `${p}/**/test_*.py`], fastapi: [`${p}/**/tests/**`, `${p}/**/test_*.py`], flask: [`${p}/**/tests/**`, `${p}/**/test_*.py`],
    laravel: [`${p}/tests/**`], symfony: [`${p}/tests/**`], php: [`${p}/tests/**`], rails: [`${p}/test/**`, `${p}/spec/**`],
    go: [`${p}/**/*_test.go`], flutter: [`${p}/test/**`], ios: [`${p}/**/*Tests/**`],
  };
  return g[app.stack] || [`${p}/**/*.spec.*`, `${p}/**/*.test.*`, `${p}/**/__tests__/**`];
}

/** Valida y prepara la ruta relativa de una app. */
function appPath(app) {
  const p = String(app.path ?? app.name ?? '').trim();
  if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) {
    throw new BotSecureError('generate.badAppPath', { vars: { name: app.name ?? '?', path: p }, fix: 'bot-secure policy edit' });
  }
  return p.replace(/[\\/]+$/, '');
}

/** Vista de una app: solo campos descriptivos, nunca credenciales. */
function appView(app, all, db) {
  const p = appPath(app);
  const pathPosix = toPosix(p);
  const depth = pathPosix.split('/').length;
  const backend = all.find((a) => a.kind === 'backend' && a.name !== app.name);
  const consumes = (app.kind === 'frontend' || app.kind === 'mobile') && backend?.port ? `http://localhost:${backend.port}` : '';
  const v = {
    name: String(app.name || pathPosix), path: p, pathPosix, kind: app.kind || 'unknown', kindLabel: KIND_LABEL[app.kind] || KIND_LABEL.unknown,
    stack: app.stack || 'unknown', port: app.port || '', hasPort: !!app.port,
    runCmd: app.runCmd || '', testCmd: app.testCmd || '', buildCmd: app.buildCmd || '', lintCmd: app.lintCmd || '',
    packageManager: app.packageManager || '', envStrategy: app.envStrategy || '',
    dependsOn: Array.isArray(app.dependsOn) ? app.dependsOn : [],
    isBackend: app.kind === 'backend', isFrontend: app.kind === 'frontend', isMobile: app.kind === 'mobile',
    consumes, consumesName: consumes ? backend.name : '',
    relRoot: Array(depth).fill('..').join('/'),
    siblingsLine: all.filter((a) => a.name !== app.name).map((a) => `${a.name} → \`./${toPosix(appPath(a))}\``).join(', '),
    usesDb: app.kind === 'backend' && !!db.engine,
  };
  v.runCmdAi = runCmdAi({ ...app, stack: v.stack });
  v.testOneCmd = testOneCmd({ ...app, stack: v.stack, packageManager: v.packageManager });
  v.testGlobs = testGlobs(v);
  v.mapConsumes = v.isBackend ? (db.engine ? `BD de IA 127.0.0.1:${db.port}` : '—') : (consumes || '—');
  return v;
}

/** Bloque markdown del mapa de apps (fallback local si workspace.appMap no existe). */
export function appMapBlock(apps, db) {
  if (!apps.length) return '_Sin apps registradas todavía._';
  const rows = apps.map((a) => `| ${a.name} | \`./${a.pathPosix}\` | ${a.kind} | ${a.stack} | ${a.port ? `:${a.port}` : '—'} | ${a.mapConsumes} |`);
  const dbRow = db.engine ? `\n| db (IA) | \`mocks/db/\` | base de datos | ${db.engine} | :${db.port} | volumen sintético, \`bot-secure up\` |` : '';
  return ['| App | Ruta | Tipo | Stack | Puerto | Consume |', '|---|---|---|---|---|---|', ...rows].join('\n') + dbRow;
}

/** Normaliza un owner de CODEOWNERS ('@org/equipo' o correo). '' si no hay. */
function owner(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.includes('@') ? s : `@${s}`;
}

/**
 * Construye la vista para las plantillas a partir de policy + apps detectadas.
 * Solo se copian campos descriptivos; jamás valores de .env, contraseñas ni hosts de red.
 * @param {string} root
 * @param {object} policy
 * @param {object[]} [apps] apps detectadas (se fusionan por nombre/ruta con policy.apps)
 */
export function buildView(root, policy, apps) {
  const project = String(policy?.project ?? '').trim();
  if (!project) throw new BotSecureError('generate.noProject', { fix: 'bot-secure policy set project <nombre>' });
  const policyApps = Array.isArray(policy.apps) ? policy.apps : [];
  const detected = Array.isArray(apps) ? apps : [];
  const merged = policyApps.length
    ? policyApps.map((pa) => ({ ...(detected.find((d) => d.name === pa.name || toPosix(d.path || '') === toPosix(pa.path || '')) || {}), ...pa }))
    : detected;
  const db = {
    engine: policy.db?.engine || '', port: policy.db?.port || '', database: policy.db?.database || 'app_ai', user: policy.db?.user || 'app',
  };
  db.hostPort = db.engine ? `127.0.0.1:${db.port}` : '';
  const appViews = merged.map((a) => appView(a, merged, db));
  const br = policy.branches || {};
  const branches = {
    ai: br.ai || 'ai-dev', taskPrefix: br.taskPrefix || 'ai/',
    protected: Array.isArray(br.protected) && br.protected.length ? br.protected : ['dev', 'qa', 'prd', 'main', 'master'],
  };
  branches.protectedList = branches.protected.map((b) => `\`${b}\``).join(', ');
  const owners = { repoOwner: owner(policy.owners?.repoOwner), infosec: owner(policy.owners?.infosec), platform: owner(policy.owners?.platform) };
  const conventions = Array.isArray(policy.conventions) ? policy.conventions.map(String) : [];
  const byKind = (k) => appViews.filter((a) => a.kind === k);
  const lessons = existsSync(path.join(root, 'CLAUDE.md')) ? extractSection(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), 'Lecciones aprendidas') : '';
  return {
    project, profile: policy.profile || 'standard', level: policy.level ?? 1, lang: policy.lang || 'es', mode: policy.mode || 'clone',
    apps: appViews, hasApps: appViews.length > 0, appNames: appViews.map((a) => a.name).join(', ') || 'ninguna todavía',
    backends: byKind('backend'), frontends: byKind('frontend'), mobiles: byKind('mobile'),
    hasBackend: byKind('backend').length > 0, hasFrontend: byKind('frontend').length > 0, hasMobile: byKind('mobile').length > 0,
    db, hasDb: !!db.engine, branches, owners, hasInfosec: !!owners.infosec,
    conventions, hasConventions: conventions.length > 0,
    appMap: appMapBlock(appViews, db), lessons,
  };
}
