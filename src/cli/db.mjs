// `bot-secure db <init|up|down|reset|seed|dump|status>`: base de datos GENÉRICA de pruebas en
// Docker/Podman con datos sintéticos es_MX. Nunca datos reales (no existe `db import` por diseño).
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { loadPolicy, savePolicy } from '../policy/index.mjs';
import {
  ENGINE_NAMES, TABLES, containerRuntime, down, dump, generate, resolveEngine, dbOptions,
  reset, seed, status, up, writeArtifacts,
} from '../db/index.mjs';

const SUBS = ['init', 'up', 'down', 'reset', 'seed', 'dump', 'status'];

/** Workspace + política, o error con el arreglo exacto. */
function loadWorkspace(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('db.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  const policy = loadPolicy(root);
  if (!policy) throw new BotSecureError('db.noPolicy', { fix: 'bot-secure init', exitCode: EXIT.ERROR });
  return { root, policy };
}

/** Opciones tomadas de las banderas del CLI. */
function optsFrom(ctx) {
  const f = ctx.flags;
  const num = (v) => (v === undefined || v === true ? undefined : Number(v));
  const o = { dryRun: ctx.dryRun, log: ctx.log, t: ctx.t };
  if (typeof f.engine === 'string') o.engine = f.engine;
  if (f.generic) o.generic = true;
  if (num(f.rows) !== undefined && Number.isFinite(num(f.rows))) o.rows = num(f.rows);
  if (num(f.seed) !== undefined && Number.isFinite(num(f.seed))) o.seed = num(f.seed);
  if (f.synthetic) o.synthetic = true;
  if (f.volumes) o.volumes = true;
  return o;
}

/** Guarda motor/puerto/filas/semilla en policy.json para que el resto de comandos coincidan. */
function persist(ctx, root, policy, engine, o) {
  if (ctx.dryRun) return;
  const db = { ...(policy.db ?? {}), engine: engine.name, port: o.port, database: o.database, user: o.user, generic: o.generic, rows: o.rows, seed: o.seed };
  if (JSON.stringify(db) === JSON.stringify(policy.db ?? {})) return;
  // La política puede estar incompleta (workspace a medio crear): guardar es una comodidad,
  // no un requisito, así que nunca debe tumbar el comando.
  try { savePolicy(root, { ...policy, db }); }
  catch (e) { ctx.log.warn(ctx.t('db.policyNotSaved', { message: e?.message ?? String(e) })); }
}

async function cmdInit(ctx, { root, policy }) {
  const o = optsFrom(ctx);
  const engine = resolveEngine(policy, { engine: o.engine, apps: policy.apps ?? [], root });
  const eff = dbOptions(policy, engine, o);
  const artifacts = generate(root, policy, { ...o, engine: engine.name });
  const results = writeArtifacts(root, artifacts, { dryRun: ctx.dryRun, force: !!ctx.flags.force });
  persist(ctx, root, policy, engine, eff);
  ctx.log.ok(ctx.t('db.initDone', { engine: engine.name, port: eff.port, count: artifacts.length }));
  for (const r of results) ctx.log.info(ctx.t('db.artifact', { action: r.action, path: r.path }));
  for (const n of engine.notes ?? []) ctx.log.warn(n);
  if (ctx.dryRun) ctx.log.info(ctx.t('db.dryRun'));
  ctx.log.info(ctx.t('db.nextUp'));
  ctx.log.data({ command: 'db init', engine: engine.name, port: eff.port, rows: eff.rows, seed: eff.seed, artifacts: results, dryRun: !!ctx.dryRun });
  return EXIT.OK;
}

async function cmdUp(ctx, { root, policy }) {
  const o = optsFrom(ctx);
  const runtime = await containerRuntime();
  if (!runtime.kind) ctx.log.warn(ctx.t('db.noRuntimeWarn'));
  const res = await up(root, policy, o);
  const engine = resolveEngine(policy, { engine: o.engine, apps: policy.apps ?? [], root });
  persist(ctx, root, policy, engine, dbOptions(policy, engine, o));
  if (res.mode === 'embedded') return reportEmbedded(ctx, res);
  if (res.dryRun) {
    ctx.log.info(ctx.t('db.dryRun'));
    ctx.log.data({ command: 'db up', ...res });
    return EXIT.OK;
  }
  ctx.log.ok(ctx.t('db.upDone', { engine: res.engine, port: res.port, seconds: Math.round(res.ms / 1000), runtime: res.runtime }));
  ctx.log.info(ctx.t('db.url', { url: res.url }));
  if (res.schema?.kind === 'migrations') ctx.log.info(ctx.t('db.nextMigrate', { tools: res.schema.tools.join(', '), script: res.schema.script }));
  else if (res.seeded) ctx.log.info(ctx.t('db.seeded', { rows: res.seeded.rows, tables: TABLES.length, seed: res.seeded.seed }));
  ctx.log.info(ctx.t('db.nextStatus'));
  ctx.log.data({ command: 'db up', ...res });
  return EXIT.OK;
}

function reportEmbedded(ctx, res) {
  if (res.sqlite) ctx.log.ok(ctx.t('db.embeddedSqlite', { file: res.file, rows: res.loaded }));
  else ctx.log.warn(ctx.t('db.embeddedSqlOnly', { files: res.files.join(', ') }));
  ctx.log.info(ctx.t('db.nextStatus'));
  ctx.log.data({ command: 'db up', ...res });
  return EXIT.OK;
}

async function cmdDown(ctx, { root, policy }) {
  const res = await down(root, policy, optsFrom(ctx));
  if (res.dryRun) ctx.log.info(ctx.t('db.dryRun'));
  else ctx.log.ok(ctx.t(res.volumeRemoved ? 'db.downVolume' : 'db.downDone', { engine: res.engine, volume: res.volume }));
  ctx.log.info(ctx.t('db.nextUp'));
  ctx.log.data({ command: 'db down', ...res });
  return EXIT.OK;
}

async function cmdReset(ctx, { root, policy }) {
  const res = await reset(root, policy, optsFrom(ctx));
  if (res.mode === 'embedded') return reportEmbedded(ctx, res);
  if (res.dryRun) { ctx.log.info(ctx.t('db.dryRun')); ctx.log.data({ command: 'db reset', ...res }); return EXIT.OK; }
  ctx.log.ok(ctx.t('db.resetDone', { engine: res.engine, seed: res.seeded?.seed ?? '?', rows: res.seeded?.rows ?? '?' }));
  ctx.log.info(ctx.t('db.nextStatus'));
  ctx.log.data({ command: 'db reset', ...res });
  return EXIT.OK;
}

async function cmdSeed(ctx, { root, policy }) {
  const res = await seed(root, policy, optsFrom(ctx));
  if (res.mode === 'embedded') return reportEmbedded(ctx, res);
  if (res.dryRun) ctx.log.info(ctx.t('db.dryRun'));
  else ctx.log.ok(ctx.t('db.seeded', { rows: res.rows, tables: TABLES.length, seed: res.seed }));
  ctx.log.info(ctx.t('db.nextStatus'));
  ctx.log.data({ command: 'db seed', ...res });
  return EXIT.OK;
}

async function cmdDump(ctx, { root, policy }) {
  const res = await dump(root, policy, optsFrom(ctx));
  ctx.log.ok(ctx.t('db.dumpDone', { file: res.file, rows: res.rows, seed: res.seed }));
  ctx.log.info(ctx.t('db.dumpCi'));
  ctx.log.data({ command: 'db dump', ...res });
  return EXIT.OK;
}

async function cmdStatus(ctx, { root, policy }) {
  const res = await status(root, policy, optsFrom(ctx));
  if (!res.runtime) ctx.log.warn(ctx.t('db.noRuntimeWarn'));
  if (!res.running) {
    ctx.log.warn(ctx.t('db.statusDown', { engine: res.engine, port: res.port }));
    ctx.log.info(ctx.t('db.nextUp'));
    ctx.log.data({ command: 'db status', ...res });
    return EXIT.OK;
  }
  if (res.mode === 'embedded') ctx.log.ok(ctx.t('db.statusEmbedded', { file: res.file, tables: Object.keys(res.rows).length }));
  else {
    ctx.log.ok(ctx.t('db.statusUp', { engine: res.engine, port: res.port, health: res.health }));
    ctx.log.info(ctx.t('db.url', { url: res.url }));
  }
  ctx.log.table(Object.entries(res.rows).map(([table, n]) => [table, n === null ? '?' : String(n)]));
  ctx.log.data({ command: 'db status', ...res });
  return EXIT.OK;
}

export default {
  name: 'db',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Base de datos de pruebas en Docker con datos sintéticos mexicanos',
    en: 'Test database in Docker with synthetic Mexican data',
  },
  usage: {
    es: `bot-secure db <${SUBS.join('|')}> [--engine ${ENGINE_NAMES.join('|')}] [--generic] [--rows N] [--seed n] [--json] [--dry-run]`,
    en: `bot-secure db <${SUBS.join('|')}> [--engine ${ENGINE_NAMES.join('|')}] [--generic] [--rows N] [--seed n] [--json] [--dry-run]`,
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'status';
    if (!SUBS.includes(sub)) {
      throw new BotSecureError('db.unknownSub', { vars: { sub, subs: SUBS.join(', ') }, fix: 'bot-secure db status', exitCode: EXIT.ERROR });
    }
    const ws = loadWorkspace(ctx);
    if (sub === 'init') return cmdInit(ctx, ws);
    if (sub === 'up') return cmdUp(ctx, ws);
    if (sub === 'down') return cmdDown(ctx, ws);
    if (sub === 'reset') return cmdReset(ctx, ws);
    if (sub === 'seed') return cmdSeed(ctx, ws);
    if (sub === 'dump') return cmdDump(ctx, ws);
    return cmdStatus(ctx, ws);
  },
};
