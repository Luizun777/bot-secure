// API pública del módulo `db`: base de datos GENÉRICA de pruebas en Docker/Podman con datos
// sintéticos es_MX. Nunca toca datos reales (por diseño no existe `db import`).
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { writeGenerated } from '../lib/fsx.mjs';
import { createRng, markerHeader } from '../engine/synthetic-mx.mjs';
import { renderCompose, renderRolesSql, volumeName } from './compose.mjs';
import { buildDataset } from './dataset.mjs';
import { ENGINES, ENGINE_NAMES, getEngine } from './engines/index.mjs';
import { DB_PASSWORD_PLACEHOLDER, dbContainerName, dbOf, inContainer } from './engines/_common.mjs';
import { migrationPlans, renderMigrateSh } from './migrations.mjs';
import { renderSchema, renderSeedsSql, TABLES } from './schema-generic.mjs';
import { compose, containerRuntime, execInDb, healthOf, waitHealthy } from './runtime.mjs';

export { ENGINES, ENGINE_NAMES, getEngine } from './engines/index.mjs';
export { detectMigrations, migrationPlans } from './migrations.mjs';
export { containerRuntime, detectContainerRuntime } from './runtime.mjs';
export { TABLES } from './schema-generic.mjs';

/** @typedef {{path:string, content:string, mode?:'0755'}} Artifact */

export const DB_DIR = join('mocks', 'db');
const COMPOSE_REL = join(DB_DIR, 'compose.db.yml');
const SEEDS_DIR = join(DB_DIR, 'seeds');

const posix = (p) => String(p).split('\\').join('/');
const projectOf = (policy) => policy?.project || 'proyecto';

/* ------------------------------------ detección de motor ------------------------------------ */

const MANIFESTS = [
  'package.json', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'go.mod', 'settings.py',
  'application.yml', 'application.yaml', 'application.properties', 'appsettings.json', 'appsettings.Development.json',
  join('src', 'main', 'resources', 'application.yml'), join('src', 'main', 'resources', 'application.yaml'),
  join('src', 'main', 'resources', 'application.properties'),
  join('config', 'database.yml'), '.env.example',
];

/** Texto concatenado de los manifiestos y archivos de configuración presentes en `dir`. */
function manifestText(dir) {
  let out = '';
  for (const rel of MANIFESTS) {
    const p = join(dir, rel);
    try { if (existsSync(p)) out += readFileSync(p, 'utf8') + '\n'; } catch { /* ilegible */ }
  }
  // settings.py de Django suele estar en <proyecto>/settings.py
  for (const sub of ['config', 'app', 'src', 'backend', 'core']) {
    const p = join(dir, sub, 'settings.py');
    try { if (existsSync(p)) out += readFileSync(p, 'utf8') + '\n'; } catch { /* ilegible */ }
  }
  // Proyectos .NET: el nombre del .csproj/.fsproj es variable.
  try {
    for (const f of readdirSync(dir)) {
      if (/\.(csproj|fsproj|vbproj)$/i.test(f)) out += readFileSync(join(dir, f), 'utf8') + '\n';
    }
  } catch { /* directorio inexistente */ }
  return out;
}

const SIGNS = [
  ['postgres', /"pg"|pg-promise|postgres|psycopg|npgsql|asyncpg|jdbc:postgresql|lib\/pq|jackc\/pgx|postgis/i],
  ['mysql', /mysql2|"mysql"|pymysql|mysqlclient|mysql-connector|mariadb|jdbc:mysql|go-sql-driver\/mysql|mysql:\/\//i],
  ['mongo', /mongoose|pymongo|mongodb|mongo-driver|mongo-go-driver|"motor"|mongo:\/\//i],
  ['mssql', /"mssql"|System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|pyodbc|pymssql|jdbc:sqlserver|mssql-jdbc|tedious/i],
  ['oracle', /oracledb|cx_Oracle|ojdbc|jdbc:oracle|Oracle\.ManagedDataAccess|godror/i],
  ['redis', /ioredis|"redis"|redis-py|StackExchange\.Redis|go-redis|redis:\/\//i],
];

/**
 * Motor de BD del proyecto según las dependencias y la configuración de sus apps.
 * @param {object[]} apps App[] del contrato
 * @param {{root?:string}} [opts] raíz del workspace (si falta se usan solo los campos de la app)
 * @returns {'postgres'|'mysql'|'mongo'|'redis'|'mssql'|'oracle'|null}
 */
export function detectEngine(apps = [], { root } = {}) {
  const scores = new Map(ENGINE_NAMES.map((n) => [n, 0]));
  for (const app of apps ?? []) {
    if (app?.orm === 'mongoose') scores.set('mongo', scores.get('mongo') + 3);
    const text = root ? manifestText(join(root, ...String(app?.path || '.').split('/'))) : (app?.manifestText ?? '');
    if (!text) continue;
    for (const [name, re] of SIGNS) {
      const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
      if (hits) scores.set(name, scores.get(name) + hits.length);
    }
  }
  // Redis casi siempre acompaña a una BD principal: solo gana si es lo único que hay.
  const primary = ENGINE_NAMES.filter((n) => n !== 'redis').map((n) => [n, scores.get(n)]).sort((a, b) => b[1] - a[1]);
  if (primary[0]?.[1] > 0) return primary[0][0];
  return scores.get('redis') > 0 ? 'redis' : null;
}

/** Motor efectivo: `--engine` > policy.db.engine > detección > postgres. */
export function resolveEngine(policy, { engine, apps, root } = {}) {
  const name = engine || policy?.db?.engine || detectEngine(apps ?? policy?.apps ?? [], { root }) || 'postgres';
  const mod = getEngine(name);
  if (!mod) {
    throw new BotSecureError('db.unknownEngine', { vars: { engine: name, engines: ENGINE_NAMES.join(', ') }, fix: `bot-secure db init --engine postgres`, exitCode: EXIT.ERROR });
  }
  return mod;
}

/** Opciones efectivas de la BD (policy.db + flags). */
export function dbOptions(policy, engine, opts = {}) {
  const d = dbOf(policy, engine);
  // El puerto guardado solo vale si la política habla del MISMO motor: al cambiar de motor
  // (--engine mysql) hay que usar su puerto alternativo, no el del motor anterior.
  const mismoMotor = !policy?.db?.engine || policy.db.engine === engine.name;
  return {
    ...d,
    engine: engine.name,
    port: opts.port ? Number(opts.port) : (mismoMotor && policy?.db?.port ? Number(policy.db.port) : engine.altPort),
    rows: opts.rows !== undefined ? Number(opts.rows) : d.rows,
    seed: opts.seed !== undefined ? Number(opts.seed) : d.seed,
    generic: opts.generic !== undefined ? !!opts.generic : d.generic,
  };
}

/** URL de conexión que va a `.env.ai` (idéntica a la que muestra `db status`). */
export function connectionUrl(policy, { engine, host = '127.0.0.1', ...opts } = {}) {
  const mod = engine && typeof engine === 'object' ? engine : resolveEngine(policy, { engine });
  const d = dbOptions(policy, mod, opts);
  return mod.connectionUrl({ ...policy, db: { ...(policy?.db ?? {}), ...d } }, { host });
}

/* -------------------------------------- generación ------------------------------------------ */

/** Semilla + dataset deterministas. */
function seedContent(engine, policy, o) {
  return engine.seedStatements(o.rows, createRng(o.seed), { ...policy, db: { ...(policy?.db ?? {}), ...o } });
}

/**
 * Artefactos de la BD de pruebas: compose, init, esquema genérico, migrate.sh, seeds y README.
 * @param {string} root raíz del workspace
 * @param {object} policy
 * @param {{engine?:string, rows?:number, seed?:number, generic?:boolean, apps?:object[]}} [opts]
 * @returns {Artifact[]}
 */
export function generate(root, policy, opts = {}) {
  const apps = opts.apps ?? policy?.apps ?? [];
  const engine = resolveEngine(policy, { engine: opts.engine, apps, root });
  const o = dbOptions(policy, engine, opts);
  const effective = { ...policy, db: { ...(policy?.db ?? {}), ...o } };
  const plans = o.generic ? [] : migrationPlans(apps, { root });
  const url = engine.connectionUrl(effective, { host: '127.0.0.1' });

  const out = [
    { path: COMPOSE_REL, content: renderCompose(engine, effective) },
    { path: join(DB_DIR, 'init', '00-roles.sql'), content: renderRolesSql(engine, effective) },
    { path: join(DB_DIR, engine.schemaFile), content: engine.schemaGeneric(effective) },
    { path: join(DB_DIR, 'migrate.sh'), content: renderMigrateSh(plans, url, { engine: engine.name }), mode: '0755' },
    { path: join(SEEDS_DIR, engine.seedFile), content: seedContent(engine, effective, o) },
    { path: join(DB_DIR, 'README.md'), content: renderReadme(engine, effective, o, plans, url) },
  ];
  return out;
}

/** README corto (español) de `mocks/db`. */
export function renderReadme(engine, policy, o, plans, url) {
  const name = dbContainerName(policy);
  const lines = [
    '# Base de datos de pruebas (ambiente de IA)',
    '',
    `Motor **${engine.name}** (\`${engine.image}\`) en contenedor, expuesto **solo** en \`127.0.0.1:${o.port}\`.`,
    'Datos **sintéticos** es_MX (RFC/CURP/CLABE/NSS/tarjetas válidos por checksum pero inventados).',
    'Nunca copies aquí datos reales: `bot-secure scan` marca los volcados de producción como CRITICAL.',
    '',
    '## Comandos',
    '',
    '```sh',
    'bot-secure db up        # levanta, espera el healthcheck, aplica esquema y semillas',
    'bot-secure db status    # motor, puerto y filas por tabla',
    'bot-secure db reset     # borra el volumen y regenera (mismo seed = mismos datos)',
    'bot-secure db down      # apaga (conserva el volumen)',
    '```',
    '',
    '## Conexión',
    '',
    '```',
    url,
    '```',
    '',
    `La contraseña es literalmente el placeholder \`${DB_PASSWORD_PLACEHOLDER}\`: el mismo valor va en \`.env.ai\`.`,
    `Volumen de datos: \`${name}\`. Red: \`ai-internal\` (sin salida a internet).`,
    '',
    '## Esquema y datos',
    '',
    plans.length
      ? `Migraciones del proyecto detectadas (${plans.map((p) => p.tool).join(', ')}): se aplican con \`./migrate.sh\` en el HOST.`
      : `Sin migraciones detectadas: se usa el esquema genérico \`${engine.schemaFile}\` (${TABLES.join(', ')}).`,
    `Semillas: \`seeds/${engine.seedFile}\` — ${o.rows} filas por tabla, semilla \`${o.seed}\`.`,
    `La primera línea de cada semilla lleva el marcador \`${markerHeader('#').trim().split(' ')[1]}\` para que el escáner no la reporte.`,
    '',
  ];
  if (engine.notes?.length) lines.push('## Notas', '', ...engine.notes.map((n) => `- ${n}`), '');
  lines.push('Generado por bot-secure; regenerar con `bot-secure db init`.', '');
  return lines.join('\n');
}

/**
 * Escribe artefactos respetando ediciones humanas (se escribe `<archivo>.new` si el humano lo tocó).
 * @param {string} root
 * @param {Artifact[]} artifacts
 * @param {{dryRun?:boolean, force?:boolean, onlyMissing?:boolean}} [opts]
 *   `onlyMissing` deja intacto lo que ya existe (lo usa `db up`: no debe pisar el compose que el
 *   equipo haya ajustado, pero sí crear lo que falte).
 * @returns {{path:string, action:string}[]}
 */
export function writeArtifacts(root, artifacts, { dryRun = false, force = false, onlyMissing = false } = {}) {
  const results = [];
  for (const a of artifacts) {
    const abs = join(root, a.path);
    if (dryRun) { results.push({ path: posix(a.path), action: existsSync(abs) ? 'updated' : 'created' }); continue; }
    if (onlyMissing && existsSync(abs)) { results.push({ path: posix(a.path), action: 'unchanged' }); continue; }
    const r = writeGenerated(abs, a.content, { force });
    results.push({ path: posix(a.path), action: r.action });
  }
  return results;
}

/* ------------------------------------ ciclo de vida ----------------------------------------- */

const say = (opts, key, vars) => { const m = opts?.t ? opts.t(key, vars) : key; opts?.log?.step?.(m); };

async function requireRuntime(policy, opts) {
  const runtime = opts.runtime ?? await containerRuntime();
  if (!runtime.kind || !runtime.compose.length) return null;
  return runtime;
}

function ctxFor(root, policy, opts) {
  const engine = resolveEngine(policy, { engine: opts.engine, apps: opts.apps ?? policy?.apps ?? [], root });
  const o = dbOptions(policy, engine, opts);
  const effective = { ...policy, db: { ...(policy?.db ?? {}), ...o } };
  return {
    engine, o, effective,
    file: 'compose.db.yml',
    cwd: join(root, DB_DIR),
    project: `${projectOf(policy)}-ai-db`,
    container: dbContainerName(policy),
  };
}

/** Error de "no hay Docker ni Podman" con el arreglo exacto. */
function noRuntimeError(policy) {
  return new BotSecureError('db.noRuntime', {
    vars: { engine: policy?.db?.engine ?? 'postgres' },
    fix: 'bot-secure db up --generic  (tras instalar Docker Desktop, Colima, OrbStack o Podman)',
    exitCode: EXIT.ERROR,
  });
}

/**
 * Levanta la BD: compose up -d, espera healthcheck (≤ 90 s), aplica esquema o migraciones y semillas.
 * Sin runtime y con `policy.runtime === 'tests'` cae al modo embebido (SQLite / SQL para carga manual).
 */
export async function up(root, policy, opts = {}) {
  const c = ctxFor(root, policy, opts);
  const artifacts = generate(root, policy, opts);
  // El esquema y las semillas son datos generados (dependen de --rows/--seed): se regeneran siempre.
  const generados = new Set([posix(join(DB_DIR, c.engine.schemaFile)), posix(join(SEEDS_DIR, c.engine.seedFile))]);
  const written = [
    ...writeArtifacts(root, artifacts.filter((a) => !generados.has(posix(a.path))), { dryRun: opts.dryRun, onlyMissing: true }),
    ...writeArtifacts(root, artifacts.filter((a) => generados.has(posix(a.path))), { dryRun: opts.dryRun, force: true }),
  ];
  const runtime = await requireRuntime(policy, opts);
  if (!runtime) {
    if (policy?.runtime === 'tests' || opts.embedded) return { ...(await embedded(root, policy, opts)), artifacts: written, engine: c.engine.name };
    throw noRuntimeError(policy);
  }
  if (opts.dryRun) {
    return { dryRun: true, engine: c.engine.name, port: c.o.port, url: c.engine.connectionUrl(c.effective), artifacts: written, runtime: runtime.kind };
  }

  say(opts, 'db.upStarting', { engine: c.engine.name, port: c.o.port });
  const upRes = compose(runtime, { file: c.file, project: c.project, cwd: c.cwd, args: ['up', '-d', '--remove-orphans'] });
  if (upRes.status !== 0) {
    throw new BotSecureError('db.composeFailed', { vars: { message: (upRes.stderr || upRes.stdout).trim().slice(0, 400) }, fix: `cd ${posix(DB_DIR)} && ${runtime.compose.join(' ')} -f compose.db.yml up`, exitCode: EXIT.ERROR });
  }
  say(opts, 'db.waitingHealth', { seconds: 90 });
  const health = await waitHealthy(runtime, { container: c.container, timeoutMs: opts.timeoutMs ?? 90_000 });
  if (!health.ok) {
    throw new BotSecureError('db.notHealthy', { vars: { container: c.container, status: health.status, seconds: Math.round(health.ms / 1000) }, fix: `${runtime.bin} logs ${c.container}`, exitCode: EXIT.ERROR });
  }

  const plans = c.o.generic ? [] : migrationPlans(opts.apps ?? policy?.apps ?? [], { root });
  let schema = null;
  if (plans.length) {
    schema = { kind: 'migrations', tools: plans.map((p) => p.tool), script: posix(join(DB_DIR, 'migrate.sh')) };
    say(opts, 'db.migrationsPending', { tools: schema.tools.join(', '), script: schema.script });
  } else {
    say(opts, 'db.applyingSchema', { file: c.engine.schemaFile });
    applyFile(runtime, c, c.engine.schemaFile, { allowFail: false });
    schema = { kind: 'generic', file: c.engine.schemaFile };
  }
  let seeded = null;
  if (!plans.length && opts.seedAfterUp !== false) seeded = await seed(root, policy, { ...opts, runtime, alreadyGenerated: true });

  return {
    engine: c.engine.name, port: c.o.port, container: c.container, runtime: runtime.kind,
    url: c.engine.connectionUrl(c.effective), health: health.status, ms: health.ms,
    artifacts: written, schema, seeded,
  };
}

/** Ejecuta un archivo de `mocks/db` dentro del contenedor con el cliente del motor. */
function applyFile(runtime, c, rel, { allowFail = false } = {}) {
  const argv = c.engine.applyCmd(c.effective, inContainer(rel));
  const r = execInDb(runtime, { file: c.file, project: c.project, cwd: c.cwd, argv });
  if (r.status !== 0 && !allowFail) {
    throw new BotSecureError('db.applyFailed', { vars: { file: posix(rel), message: (r.stderr || r.stdout).trim().slice(0, 400) }, fix: `bot-secure db reset`, exitCode: EXIT.ERROR });
  }
  return r;
}

/** Apaga la BD (conserva el volumen salvo `opts.volumes`). */
export async function down(root, policy, opts = {}) {
  const c = ctxFor(root, policy, opts);
  const runtime = await requireRuntime(policy, opts);
  if (!runtime) throw noRuntimeError(policy);
  if (opts.dryRun) return { dryRun: true, engine: c.engine.name, volumes: !!opts.volumes };
  const args = ['down', ...(opts.volumes ? ['-v'] : [])];
  const r = compose(runtime, { file: c.file, project: c.project, cwd: c.cwd, args });
  if (r.status !== 0) throw new BotSecureError('db.composeFailed', { vars: { message: (r.stderr || r.stdout).trim().slice(0, 400) }, fix: `${runtime.bin} ps -a`, exitCode: EXIT.ERROR });
  return { engine: c.engine.name, stopped: true, volumeRemoved: !!opts.volumes, volume: volumeName(policy) };
}

/** Borra el volumen y vuelve a levantar: con la misma semilla los datos son idénticos. */
export async function reset(root, policy, opts = {}) {
  const runtime = await requireRuntime(policy, opts);
  if (!runtime) {
    if (policy?.runtime === 'tests' || opts.embedded) {
      const c = ctxFor(root, policy, opts);
      try { rmSync(join(root, SQLITE_REL), { force: true }); } catch { /* no existe */ }
      return { ...(await embedded(root, policy, opts)), reset: true, engine: c.engine.name };
    }
    throw noRuntimeError(policy);
  }
  if (opts.dryRun) return { dryRun: true, reset: true };
  await down(root, policy, { ...opts, runtime, volumes: true });
  const res = await up(root, policy, { ...opts, runtime });
  return { ...res, reset: true };
}

/** Aplica (o regenera y aplica) las semillas sintéticas. */
export async function seed(root, policy, opts = {}) {
  const c = ctxFor(root, policy, opts);
  const rel = join(SEEDS_DIR, c.engine.seedFile);
  if (!opts.alreadyGenerated) writeArtifacts(root, [{ path: rel, content: seedContent(c.engine, c.effective, c.o) }], { dryRun: opts.dryRun, force: true });
  const runtime = await requireRuntime(policy, opts);
  if (!runtime) {
    if (policy?.runtime === 'tests' || opts.embedded) return embedded(root, policy, opts);
    throw noRuntimeError(policy);
  }
  if (opts.dryRun) return { dryRun: true, file: posix(rel), rows: c.o.rows, seed: c.o.seed };
  say(opts, 'db.seeding', { rows: c.o.rows, seed: c.o.seed });
  applyFile(runtime, c, rel);
  return { file: posix(rel), rows: c.o.rows, seed: c.o.seed, tables: TABLES.length };
}

/** Estado: motor, puerto, salud y filas por tabla. */
export async function status(root, policy, opts = {}) {
  const c = ctxFor(root, policy, opts);
  const runtime = await requireRuntime(policy, opts);
  const base = { engine: c.engine.name, port: c.o.port, container: c.container, url: c.engine.connectionUrl(c.effective), runtime: runtime?.kind ?? null };
  if (!runtime) {
    const emb = await embeddedStatus(root);
    return emb ? { ...base, ...emb } : { ...base, running: false, health: 'sin-runtime', rows: {} };
  }
  const health = healthOf(runtime, c.container);
  if (health === 'missing') return { ...base, running: false, health, rows: {} };
  const rows = {};
  if (!opts.noRows) {
    for (const table of (opts.tables ?? TABLES)) {
      const r = execInDb(runtime, { file: c.file, project: c.project, cwd: c.cwd, argv: c.engine.countCmd(c.effective, table), timeout: 30_000 });
      const n = /(-?\d+)/.exec((r.stdout || '').trim().split('\n').filter(Boolean).pop() ?? '');
      rows[table] = r.status === 0 && n ? Number(n[1]) : null;
    }
  }
  return { ...base, running: true, health, rows };
}

/**
 * Exporta las semillas sintéticas a `mocks/db/seeds/` (para CI). Solo `--synthetic`:
 * volcar datos reales está prohibido por diseño.
 */
export async function dump(root, policy, opts = {}) {
  if (!opts.synthetic) {
    throw new BotSecureError('db.dumpRealForbidden', { fix: 'bot-secure db dump --synthetic', exitCode: EXIT.ERROR });
  }
  const c = ctxFor(root, policy, opts);
  const rel = join(SEEDS_DIR, c.engine.seedFile);
  const written = writeArtifacts(root, [{ path: rel, content: seedContent(c.engine, c.effective, c.o) }], { dryRun: opts.dryRun, force: true });
  return { file: posix(rel), rows: c.o.rows, seed: c.o.seed, engine: c.engine.name, artifacts: written };
}

/* ---------------------------------- respaldo sin runtime ------------------------------------ */

const SQLITE_REL = join(DB_DIR, 'app_ai.sqlite');

/** Estado de la base embebida (SQLite) si existe; null si no la hay o Node no trae node:sqlite. */
async function embeddedStatus(root) {
  const file = join(root, SQLITE_REL);
  if (!existsSync(file)) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = {};
    for (const t of TABLES) {
      try { rows[t] = Number(db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n); } catch { rows[t] = null; }
    }
    db.close();
    return { running: true, health: 'embebida', mode: 'embedded', file: posix(SQLITE_REL), rows };
  } catch {
    return { running: true, health: 'embebida', mode: 'embedded', file: posix(SQLITE_REL), rows: {} };
  }
}

/**
 * Sin Docker/Podman y con `runtime: tests`: genera el SQL equivalente en SQLite para carga manual
 * y, si esta versión de Node trae `node:sqlite`, crea la base ya cargada.
 */
export async function embedded(root, policy, opts = {}) {
  const engine = resolveEngine(policy, { engine: opts.engine, apps: opts.apps ?? policy?.apps ?? [], root });
  const o = dbOptions(policy, engine, opts);
  const rng = createRng(o.seed);
  const schema = renderSchema('sqlite');
  const seeds = renderSeedsSql('sqlite', buildDataset(o.rows, rng), { seed: o.seed, rows: o.rows });
  const schemaRel = join(DB_DIR, 'schema-generic.sqlite.sql');
  const seedRel = join(SEEDS_DIR, '001-sinteticos.sqlite.sql');
  const artifacts = writeArtifacts(root, [
    { path: schemaRel, content: schema },
    { path: seedRel, content: seeds },
  ], { dryRun: opts.dryRun });
  const result = { mode: 'embedded', engine: engine.name, rows: o.rows, seed: o.seed, artifacts, files: [posix(schemaRel), posix(seedRel)] };
  if (opts.dryRun) return { ...result, sqlite: false, dryRun: true };

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const file = join(root, SQLITE_REL);
    try { rmSync(file, { force: true }); } catch { /* no existe */ }
    const db = new DatabaseSync(file);
    db.exec(schema);
    db.exec(seeds);
    const n = db.prepare('SELECT count(*) AS n FROM clientes').get().n;
    db.close();
    return { ...result, sqlite: true, file: posix(SQLITE_REL), loaded: Number(n) };
  } catch (e) {
    return { ...result, sqlite: false, reason: e?.message ?? String(e) };
  }
}
