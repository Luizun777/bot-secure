// .env.ai (fuente única de valores del ambiente de IA) y .env.example (nombres sin valores).
// También helpers compartidos por las estrategias de entorno (plantillas, rutas, prefijos).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeT } from '../lib/i18n.mjs';
import { MOCK_PORTS, fakeComment, fakeFor, inferKind, isFake, normName, slug } from './fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @typedef {{name:string, value:string, kind:string, comment?:string, section:string}} AiVar */
/** @typedef {{path:string, content:string, mode?:string}} Artifact */

const EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.example.local'];
const FRONT_PREFIX = { vite: 'VITE_', cra: 'REACT_APP_', vue: 'VUE_APP_', next: 'NEXT_PUBLIC_', nuxt: 'NUXT_PUBLIC_', svelte: 'PUBLIC_', expo: 'EXPO_PUBLIC_', 'react-native': 'EXPO_PUBLIC_', astro: 'PUBLIC_' };
const DB_DEFAULT_PORT = { postgres: 5433, mysql: 3307, mongo: 27018, redis: 6380, mssql: 1434, oracle: 1522 };

// ---------- helpers compartidos ----------
/** Ruta relativa a la raíz del workspace para un archivo dentro de la app. */
export function appJoin(app, ...segments) { const base = app?.path && app.path !== '.' ? app.path : ''; return base ? join(base, ...segments) : join(...segments); }
/** Prefijo público del framework de front ('' si no inlina variables). */
export function prefixFor(stack) { return FRONT_PREFIX[stack] || ''; }
/** camelCase de un nombre de variable (API_URL → apiUrl). */
export function camel(name) { return normName(name).toLowerCase().split('_').map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join(''); }
/** Escapa una cadena para literal JS/TS/Java/C#/Python entre comillas simples o dobles. */
export function esc(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"'); }
/** Añade scripts a un package.json (puro, idempotente). */
export function patchPackageScripts(json, scripts) {
  const out = JSON.parse(JSON.stringify(json || {}));
  out.scripts = { ...(out.scripts || {}), ...scripts };
  return out;
}
/** Lee JSON si existe (o null). */
export function readJsonIf(p) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; } }

// ---------- parseo de .env ----------
/** Parsea texto .env → [{name, value}] (soporta `export`, comillas, comentarios). */
export function parseEnv(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) out.push({ name, value });
  }
  return out;
}

/** Variables declaradas en el .env.example (o similar) de la app. */
export function readExampleVars(root, app) {
  if (!root) return [];
  for (const f of EXAMPLE_FILES) {
    const p = join(root, appJoin(app, f));
    if (existsSync(p)) return parseEnv(readFileSync(p, 'utf8'));
  }
  return [];
}

// ---------- BD del workspace ----------
/** URL de conexión construida desde policy.db (fallback si el módulo db no expone connectionUrl). */
export function buildDbUrl(db = {}) {
  const engine = db.engine || 'postgres';
  const port = db.port || DB_DEFAULT_PORT[engine] || 5433;
  const user = db.user || 'app', name = db.database || 'app_ai', host = db.host || '127.0.0.1';
  const pass = '__AI_PLACEHOLDER__DB_PASSWORD__';
  switch (engine) {
    case 'mysql': return `mysql://${user}:${pass}@${host}:${port}/${name}`;
    case 'mongo': return `mongodb://${user}:${pass}@${host}:${port}/${name}`;
    case 'redis': return `redis://${host}:${port}/0`;
    case 'mssql': return `sqlserver://${user}:${pass}@${host}:${port}/${name}`;
    case 'oracle': return `oracle://${user}:${pass}@${host}:${port}/${name}`;
    default: return `postgres://${user}:${pass}@${host}:${port}/${name}`;
  }
}

/** URL de la BD de IA: usa src/db (connectionUrl) si existe; si no, la construye con policy.db. */
export async function dbUrlFor(policy) {
  try {
    const mod = await import(pathToFileURL(join(HERE, '..', 'db', 'index.mjs')).href);
    if (typeof mod.connectionUrl === 'function') { const u = mod.connectionUrl(policy); if (u) return String(u); }
  } catch { /* módulo db ausente: fallback */ }
  return buildDbUrl(policy?.db);
}

/** Descompone una URL de BD en partes (para JDBC / ADO.NET / variables sueltas). */
export function parseDbUrl(url) {
  const m = /^([a-z0-9+]+):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/]+)(?::(\d+))?(?:\/([^?]*))?/.exec(String(url || ''));
  if (!m) return null;
  return { engine: m[1].replace(/^postgresql$/, 'postgres'), user: m[2] || '', password: m[3] || '', host: m[4], port: m[5] || '', database: m[6] || '' };
}
/** URL JDBC equivalente. */
export function toJdbc(url) {
  const p = parseDbUrl(url); if (!p) return '';
  switch (p.engine) {
    case 'mysql': return `jdbc:mysql://${p.host}:${p.port}/${p.database}`;
    case 'mssql': case 'sqlserver': return `jdbc:sqlserver://${p.host}:${p.port};databaseName=${p.database};encrypt=false`;
    case 'oracle': return `jdbc:oracle:thin:@${p.host}:${p.port}/${p.database}`;
    case 'mongo': case 'mongodb': return url;
    default: return `jdbc:postgresql://${p.host}:${p.port}/${p.database}`;
  }
}
/** Connection string ADO.NET equivalente. */
export function toAdo(url) {
  const p = parseDbUrl(url); if (!p) return '';
  switch (p.engine) {
    case 'mysql': return `Server=${p.host};Port=${p.port};Database=${p.database};User=${p.user};Password=${p.password}`;
    case 'mssql': case 'sqlserver': return `Server=${p.host},${p.port};Database=${p.database};User Id=${p.user};Password=${p.password};TrustServerCertificate=True`;
    case 'oracle': return `Data Source=${p.host}:${p.port}/${p.database};User Id=${p.user};Password=${p.password}`;
    default: return `Host=${p.host};Port=${p.port};Database=${p.database};Username=${p.user};Password=${p.password}`;
  }
}

// ---------- resolución de variables ----------
const isBackendish = (app) => !app || app.kind === 'backend' || app.kind === 'unknown' || app.kind === 'lib';
const isFrontish = (app) => app && (app.kind === 'frontend' || app.kind === 'mobile');

/** Variables conocidas de BD que se mapean a la BD del workspace en vez de a un fake genérico. */
function wellKnownDb(name, db, dbUrl) {
  const n = normName(name);
  const p = parseDbUrl(dbUrl) || {};
  if (/^(DB|DATABASE|POSTGRES|PG|MYSQL|MSSQL|ORACLE|MONGO)_?(HOST|HOSTNAME|SERVER)$|^PGHOST$/.test(n)) return p.host || '127.0.0.1';
  if (/^(DB|DATABASE|POSTGRES|PG|MYSQL|MSSQL|ORACLE|MONGO)_?PORT$|^PGPORT$/.test(n)) return String(p.port || db?.port || '');
  if (/^(DB|DATABASE|POSTGRES|PG|MYSQL|MSSQL|ORACLE|MONGO)_?(NAME|DATABASE|DB)$|^PGDATABASE$/.test(n)) return p.database || db?.database || 'app_ai';
  if (/^(DB|DATABASE|POSTGRES|PG|MYSQL|MSSQL|ORACLE|MONGO)_?(USER|USERNAME)$|^PGUSER$/.test(n)) return p.user || db?.user || 'app';
  if (/^(DB|DATABASE|POSTGRES|PG|MYSQL|MSSQL|ORACLE|MONGO)_?(PASSWORD|PASS|PWD)$|^PGPASSWORD$/.test(n)) return '__AI_PLACEHOLDER__DB_PASSWORD__';
  return null;
}

/**
 * Resuelve las variables del .env.ai de una app (o del workspace si app es null).
 * @param {object|null} app App de policy.apps (null = raíz del workspace)
 * @param {object} policy
 * @param {{root?:string, apps?:object[], dbUrl?:string, exampleVars?:{name:string,value:string}[]}} [opts]
 * @returns {AiVar[]}
 */
export function resolveVars(app, policy, opts = {}) {
  const project = policy?.project || 'app';
  const apps = opts.apps || policy?.apps || [];
  const backend = apps.find((a) => a.kind === 'backend');
  const frontend = apps.find((a) => a.kind === 'frontend');
  const backendPort = backend?.port || 8080, frontendPort = frontend?.port || 4200;
  const dbUrl = opts.dbUrl || buildDbUrl(policy?.db);
  const prefix = app ? prefixFor(app.stack) : '';
  const vars = [];
  const seen = new Set();
  const add = (v) => { if (!seen.has(v.name)) { seen.add(v.name); vars.push(v); } };

  add({ name: 'AI_ENV', value: '1', kind: 'plain', section: 'core' });
  if (prefix) add({ name: `${prefix}AI_ENV`, value: '1', kind: 'plain', section: 'core' });

  if (policy?.db && isBackendish(app)) {
    const p = parseDbUrl(dbUrl) || {};
    add({ name: 'DATABASE_URL', value: dbUrl, kind: 'db-url', comment: fakeComment('db-url'), section: 'db' });
    if (app?.stack === 'spring' || app?.stack === 'quarkus' || app?.stack === 'micronaut') add({ name: 'JDBC_DATABASE_URL', value: toJdbc(dbUrl), kind: 'db-url', section: 'db' });
    if (app?.stack === 'dotnet') add({ name: 'ConnectionStrings__Default', value: toAdo(dbUrl), kind: 'db-url', section: 'db' });
    add({ name: 'DB_HOST', value: p.host || '127.0.0.1', kind: 'host', section: 'db' });
    add({ name: 'DB_PORT', value: String(p.port || policy.db.port || ''), kind: 'plain', section: 'db' });
    add({ name: 'DB_NAME', value: p.database || policy.db.database || 'app_ai', kind: 'identifier', section: 'db' });
    add({ name: 'DB_USER', value: p.user || policy.db.user || 'app', kind: 'identifier', section: 'db' });
    add({ name: 'DB_PASSWORD', value: '__AI_PLACEHOLDER__DB_PASSWORD__', kind: 'secret', comment: fakeComment('secret'), section: 'db' });
  }

  if (isBackendish(app)) {
    add({ name: 'OIDC_ISSUER', value: `http://localhost:${MOCK_PORTS.idp}/default`, kind: 'url', comment: fakeComment('url'), section: 'idp' });
    add({ name: 'OIDC_JWKS_URI', value: `http://localhost:${MOCK_PORTS.idp}/default/jwks`, kind: 'url', section: 'idp' });
    add({ name: 'OIDC_CLIENT_ID', value: `ai-${slug(project)}-client`, kind: 'identifier', section: 'idp' });
    add({ name: 'OIDC_CLIENT_SECRET', value: '__AI_PLACEHOLDER__OIDC_CLIENT_SECRET__', kind: 'secret', comment: fakeComment('secret'), section: 'idp' });
    add({ name: 'OIDC_AUDIENCE', value: `ai-${slug(project)}-api`, kind: 'identifier', section: 'idp' });
    add({ name: 'CORS_ORIGIN', value: `http://localhost:${frontendPort}`, kind: 'url', section: 'apps' });
    add({ name: 'FRONTEND_URL', value: `http://localhost:${frontendPort}`, kind: 'url', section: 'apps' });
  }
  if (isFrontish(app) || !app) {
    add({ name: 'API_URL', value: `http://localhost:${backendPort}`, kind: 'url', comment: fakeComment('url'), section: 'apps' });
    if (prefix) add({ name: `${prefix}API_URL`, value: `http://localhost:${backendPort}`, kind: 'url', section: 'apps' });
  }
  if (!app) for (const a of apps) if (a.port) add({ name: `${normName(a.name)}_PORT`, value: String(a.port), kind: 'plain', section: 'apps' });

  for (const ex of opts.exampleVars || []) {
    if (seen.has(ex.name)) continue;
    const known = wellKnownDb(ex.name, policy?.db, dbUrl);
    if (known !== null) { add({ name: ex.name, value: known, kind: /PASS|PWD/i.test(ex.name) ? 'secret' : 'identifier', comment: /PASS|PWD/i.test(ex.name) ? fakeComment('secret') : undefined, section: 'app' }); continue; }
    const kind = inferKind(ex.name);
    const value = fakeFor(kind, ex.name, { project, dbUrl, backendPort, frontendPort, example: ex.value });
    add({ name: ex.name, value, kind, comment: kind === 'plain' ? undefined : fakeComment(kind, ex.name), section: 'app' });
  }
  return vars;
}

// ---------- render de archivos ----------
const SECTION_TITLES = { core: 'Bandera del ambiente de IA', db: 'Base de datos de IA (Docker/Podman, solo 127.0.0.1)', idp: 'Proveedor de identidad mock (mock-oauth2-server)', apps: 'Apps del workspace', app: 'Variables de la app (desde .env.example, con fakes por tipo)' };

function quote(v) { const s = String(v ?? ''); return /[\s#"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s; }

/**
 * Serializa AiVar[] a texto .env.ai.
 * El marcador `# bot-secure:fake <tipo>` va en la MISMA línea: el anti-falsos-positivos del motor
 * mira el texto de la línea del hallazgo, así que en la línea anterior no suprimiría nada.
 * `node --env-file`, dotenv y Vite descartan el comentario final de una línea sin comillas.
 */
export function renderEnvAi(vars, { title = '.env.ai' } = {}) {
  const lines = [
    `# ${title} — valores del ambiente de IA generados por bot-secure. Versionado. SIN secretos reales.`,
    '# Regla del campo vacío: en ai-dev los campos sensibles de la config quedan "" y el loader de IA',
    '# los rellena desde este archivo cuando AI_ENV=1. Fuera de AI_ENV, vacío → error claro al arrancar.',
    '# Los valores marcados "# bot-secure:fake <tipo>" son falsos pero válidos por formato (no rotar, no usar en dev/qa/prd).',
  ];
  let section = null;
  for (const v of vars) {
    if (v.section !== section) { section = v.section; lines.push('', `# --- ${SECTION_TITLES[section] || section} ---`); }
    const value = quote(v.value);
    // Solo se comenta al final si el valor no lleva comillas (ahí el comentario sería parte del valor).
    lines.push(`${v.name}=${value}${v.comment && value === String(v.value ?? '') ? `   ${v.comment}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** .env.example: nombres sin valores. */
export function buildEnvExample(vars) {
  const lines = ['# .env.example — nombres de variables (sin valores). Generado por bot-secure.', '# Copia a .env y rellena en tu máquina; en el ambiente de IA se usa .env.ai.'];
  for (const v of vars) if (!/AI_ENV$/.test(v.name)) lines.push(`${v.name}=`);
  return lines.join('\n') + '\n';
}

/**
 * Contenido de .env.ai para una app o para la raíz del workspace.
 * @param {object|string} appOrRoot App de policy.apps, o ruta raíz (string) para el .env.ai del workspace
 * @param {object} policy
 * @param {{vars?:AiVar[], root?:string, apps?:object[], dbUrl?:string}} [opts]
 * @returns {Promise<string>}
 */
export async function buildEnvAi(appOrRoot, policy, opts = {}) {
  const isRoot = typeof appOrRoot === 'string' || appOrRoot == null;
  const app = isRoot ? null : appOrRoot;
  const root = isRoot ? appOrRoot : opts.root;
  const dbUrl = opts.dbUrl || await dbUrlFor(policy);
  const vars = opts.vars || resolveVars(app, policy, { root, apps: opts.apps, dbUrl, exampleVars: app ? readExampleVars(root, app) : [] });
  return renderEnvAi(vars, { title: app ? `${appJoin(app, '.env.ai')}` : '.env.ai (workspace)' });
}

/**
 * ¿Todos los valores del .env.ai son placeholders, fakes o locales?
 * Auto-verificación del generador: si esto falla, un valor real se coló en un archivo versionado.
 */
export function envAiLooksSafe(text) {
  return parseEnv(text).every((v) => valueLooksSafe(v.name, v.value));
}

/** Un valor concreto: vacío, fake conocido, bandera, apunta al loopback o identificador corto. */
export function valueLooksSafe(name, value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  if (isFake(v)) return true;
  if (inferKind(name) === 'plain') return true;
  if (/^(\d+|true|false)$/i.test(v)) return true;
  // Cualquier esquema (http, jdbc, postgres, redis…) mientras el destino sea la máquina local.
  if (/(^|[/@])(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(v)) return true;
  // Identificador corto en minúsculas (app, app_ai, ai-tienda-api): sin entropía, no es un secreto.
  if (/^[a-z][a-z0-9_.-]{0,30}$/.test(v)) return true;
  return false;
}

// ---------- regla del campo vacío ----------
const EMPTY_FIELD_FILES = {
  spring: { files: 'application*.yml|properties (spring.datasource.url/username/password, issuer-uri)', loader: 'aienv.AiEnv (EnvironmentPostProcessor) + application-ai.yml' },
  quarkus: { files: 'application.properties (%ai. prefijo)', loader: 'perfil ai' },
  dotnet: { files: 'appsettings*.json (ConnectionStrings:Default, AzureAd, KeyVault)', loader: 'AiEnv.cs (AddAiEnv) + appsettings.AI.json' },
  angular: { files: 'src/environments/environment*.ts (apiUrl, firebase.apiKey…)', loader: 'src/app/ai-env.ts + environment.ai.ts (ng serve -c ai)' },
  django: { files: 'settings.py (DATABASES, AWS_*, CELERY_*)', loader: 'ai_env.py (load_ai_env/ai_env)' },
  fastapi: { files: 'config.py / settings.py', loader: 'ai_env.py' },
  flask: { files: 'config.py', loader: 'ai_env.py' },
  laravel: { files: 'config/*.php (usan env()), .env.example', loader: 'bootstrap/AiEnv.php' },
  symfony: { files: 'config/packages/*.yaml (%env()%), .env', loader: 'config/AiEnv.php' },
  rails: { files: 'config/database.yml, config/credentials', loader: 'config/ai_env.rb' },
  go: { files: 'config.go / config.yaml', loader: 'internal/aienv' },
  php: { files: 'config.php', loader: 'config.ai.php + AiEnv.php' },
  android: { files: 'gradle.properties / local.properties', loader: 'ai-env.gradle (flavor ai → BuildConfig)' },
  ios: { files: 'Info.plist / *.xcconfig', loader: 'AI.xcconfig + scheme AI' },
  flutter: { files: 'lib/config.dart', loader: 'lib/ai_env.dart (--dart-define-from-file=ai.env.json)' },
  expo: { files: 'app.json / app.config.js (extra)', loader: 'ai-env.config.js (withAiEnv)' },
};
const NODE_LIKE = { files: 'config/*.js|ts, src/config.ts, .env.example', loader: 'src/ai-env.ts (aiEnv) o node --env-file=.env.ai' };
const FRONT_LIKE = { files: '.env.example, src/config.ts', loader: 'src/ai-env.ts (constantes con prefijo público) + .env.ai' };

/** Texto (markdown) de la regla del campo vacío para el stack, listo para docs. */
export function emptyFieldRule(stack, lang = 'es') {
  const t = makeT(lang);
  const info = EMPTY_FIELD_FILES[stack] || (prefixFor(stack) ? FRONT_LIKE : (['node', 'nest', 'express'].includes(stack) ? NODE_LIKE : { files: 'archivos de configuración versionados', loader: 'SANITIZE-TODO.md (manual)' }));
  return t('generate-env.emptyFieldRule', { stack: stack || 'unknown', files: info.files, loader: info.loader });
}
