// `bot-secure init`: en la raíz del workspace detecta las apps, fusiona la política, escanea
// (informativo), genera el contexto Markdown, compila las guardas, instala guard.mjs y los hooks
// de git y escribe lock.json. Es idempotente: ejecutarlo dos veces no cambia nada la segunda.
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { sha256, writeGenerated, writeText } from '../lib/fsx.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { detectApps } from '../detect/index.mjs';
import { detectEngine } from '../db/index.mjs';
import { compile, defaultPolicy, loadPolicy, readLock, savePolicy, validatePolicy, writeLock } from '../policy/index.mjs';
import { generateAll } from '../generate/index.mjs';
import { installHooks } from '../git/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD_REL = join('.claude', 'hooks', 'guard.mjs');
const toPosix = (p) => String(p).split(sep).join('/');
const OWNER_FIELDS = ['repoOwner', 'infosec', 'platform'];

/**
 * Preguntas con valor por defecto entre corchetes. Con `--yes`, `--json` o sin TTY no pregunta:
 * devuelve el valor por defecto (necesario para CI y para las pruebas).
 * @returns {{interactive:boolean, ask:(q:string, def?:string)=>Promise<string>, close:()=>void}}
 */
export function createPrompter(ctx) {
  const interactive = !ctx.yes && !ctx.flags?.json && !!process.stdin.isTTY && !!process.stdout.isTTY;
  let rl = null;
  return {
    interactive,
    async ask(question, def = '') {
      if (!interactive) return def;
      if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question(`${question}${def ? ` [${def}]` : ''} `)).trim();
      return answer || def;
    },
    close() { if (rl) { rl.close(); rl = null; } },
  };
}

/** Raíz del workspace o error con el comando exacto para crearlo. */
function requireRoot(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('cli-core.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  return root;
}

/**
 * Origen de la guarda autocontenida. Se busca junto al binario (dist/) y en el repo, nunca por
 * ruta relativa al cwd del usuario.
 * @returns {string|null}
 */
export function findGuardBundle() {
  // Siempre `<algo>/dist/guard.mjs`: junto a src/cli/ vive guard.mjs, que es el COMANDO `guard`,
  // no la guarda empaquetada. Copiarlo dejaba el workspace sin guarda real.
  const candidates = [
    basename(HERE) === 'dist' ? join(HERE, 'guard.mjs') : null,  // dist/bot-secure.mjs junto a dist/guard.mjs
    join(HERE, '..', 'dist', 'guard.mjs'),
    join(HERE, '..', '..', 'dist', 'guard.mjs'),                 // src/cli/ → <repo>/dist
    join(HERE, '..', '..', '..', 'dist', 'guard.mjs'),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

/**
 * Copia `dist/guard.mjs` al workspace. Sin bundle deja un shim de desarrollo que importa
 * `src/guard/entry.mjs` por ruta absoluta y avisa con el arreglo (`npm run build`).
 * @returns {{action:'bundle'|'shim', from:string, sha256:string}}
 */
export function installGuard(root, { dryRun = false } = {}) {
  const dest = join(root, GUARD_REL);
  const bundle = findGuardBundle();
  if (bundle) {
    const content = readFileSync(bundle, 'utf8');
    if (!dryRun) writeText(dest, content);
    return { action: 'bundle', from: toPosix(bundle), sha256: sha256(content) };
  }
  const entry = join(HERE, '..', 'guard', 'entry.mjs');
  const content = [
    '#!/usr/bin/env node',
    '// Generado por bot-secure (modo desarrollo): no hay dist/guard.mjs.',
    '// El definitivo (autocontenido) lo produce `npm run build`.',
    `export * from ${JSON.stringify(pathToFileURL(entry).href)};`,
    '',
  ].join('\n');
  if (!dryRun) writeText(dest, content);
  return { action: 'shim', from: toPosix(entry), sha256: sha256(content) };
}

/** Hashes de la última generación (lock.json) por ruta posix. */
function knownHashes(root) {
  const lock = readLock(root);
  const map = {};
  for (const g of lock?.generated ?? []) map[g.path] = g.sha256;
  return map;
}

/**
 * Nombres válidos para policy.json (letras, números, . _ -) y sin duplicados.
 * @param {object[]} apps
 * @param {string} ai rama de IA por defecto
 * @returns {object[]}
 */
export function normalizeApps(apps, ai) {
  const used = new Set();
  return apps.map((a, i) => {
    let name = String(a.name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `app${i + 1}`;
    while (used.has(name)) name = `${name}-${i + 1}`;
    used.add(name);
    return { ...a, name, branch: a.branch ?? ai, dependsOn: a.dependsOn ?? [] };
  });
}

/**
 * Política efectiva: defaults + la existente (gana la existente) + apps recién detectadas.
 * @returns {object}
 */
export function mergePolicy(root, existing, apps, flags = {}) {
  const project = String(existing?.project || '').trim() || basename(root).replace(/-ai$/, '') || 'proyecto';
  const base = defaultPolicy({ project });
  const ai = existing?.branches?.ai ?? base.branches.ai;
  const merged = {
    ...base,
    ...(existing ?? {}),
    project,
    branches: { ...base.branches, ...(existing?.branches ?? {}) },
    guard: { ...base.guard, ...(existing?.guard ?? {}) },
    network: { ...base.network, ...(existing?.network ?? {}) },
    mcp: { ...base.mcp, ...(existing?.mcp ?? {}) },
    owners: { ...base.owners, ...(existing?.owners ?? {}) },
    scan: { ...base.scan, ...(existing?.scan ?? {}) },
    db: { ...base.db, ...(existing?.db ?? {}) },
    apps: normalizeApps(apps, ai),
  };
  if (!existing) merged.db.engine = detectEngine(apps, { root }) ?? merged.db.engine;
  if (typeof flags.profile === 'string') merged.profile = flags.profile;
  if (typeof flags.mode === 'string') merged.mode = flags.mode;
  if (typeof flags.engine === 'string') merged.db.engine = flags.engine;
  if (flags.level !== undefined && Number.isInteger(Number(flags.level))) merged.level = Number(flags.level);
  if (typeof flags.runtime === 'string') merged.runtime = flags.runtime;
  return merged;
}

/** Escaneo informativo: nunca aborta la generación (las guardas protegen aunque haya hallazgos). */
async function quickScan(ctx, root, policy) {
  const { log, t } = ctx;
  log.step(t('cli-core.initScanning'));
  try {
    const { scanPaths, writeReports } = await import('../engine/index.mjs');
    const report = await scanPaths({
      root, mode: 'scan', apps: policy.apps ?? [], lang: ctx.lang,
      exclude: [...(policy.scan?.exclude ?? []), '.bot-secure/reports/**'],
      maxFileSizeMB: policy.scan?.maxFileSizeMB ?? 1,
    });
    const total = report.findings.length;
    if (!total) { log.ok(t('cli-core.initScanClean')); return { findings: 0, critical: 0 }; }
    const critical = report.findings.filter((f) => f.severity === 'CRITICAL').length;
    try { writeReports(report, { dir: join(root, '.bot-secure', 'reports'), formats: ['json', 'md'], lang: ctx.lang }); } catch { /* informativo */ }
    log.warn(t('cli-core.initScanFindings', { count: total, critical }));
    return { findings: total, critical };
  } catch (e) {
    log.warn(t('cli-core.initScanFailed', { message: e?.message ?? String(e) }));
    return { findings: null, critical: null };
  }
}

/**
 * Núcleo reutilizable de `init` (lo llama también `start`).
 * @returns {Promise<{root:string, policy:object, results:object[], summary:object, exitCode:number}>}
 */
export async function runInit(ctx, { root = null, prompter = null } = {}) {
  const { log, t } = ctx;
  const ws = root ?? requireRoot(ctx);
  log.step(t('cli-core.initTitle', { root: ws }));

  let existing = null;
  try { existing = loadPolicy(ws); } catch { existing = null; }
  const apps = detectApps(ws, { apps: existing?.apps });
  if (apps.length) log.info(t('cli-core.initDetected', { count: apps.length, names: apps.map((a) => a.name).join(', ') }));
  else log.warn(t('cli-core.initNoApps'));

  const policy = mergePolicy(ws, existing, apps, ctx.flags ?? {});
  const p = prompter ?? createPrompter(ctx);
  const ownPrompter = !prompter;
  try {
    for (const field of OWNER_FIELDS) {
      if (policy.owners[field]) continue;
      policy.owners[field] = await p.ask(t('cli-core.initOwnersAsk', { field }), '');
    }
  } finally { if (ownPrompter) p.close(); }

  const errors = validatePolicy(policy);
  if (errors.length) {
    throw new BotSecureError('cli-core.policyInvalid', {
      vars: { detail: errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ') },
      fix: 'bot-secure policy validate', exitCode: EXIT.ERROR,
    });
  }
  if (!ctx.dryRun) savePolicy(ws, policy);

  const scan = await quickScan(ctx, ws, policy);

  log.step(t('cli-core.initGenerating'));
  const generated = await generateAll(ws, policy, apps);
  for (const w of generated.warnings ?? []) log.info(t('cli-core.initWarning', { warning: w }));
  let compiled;
  try {
    compiled = compile(policy, { os: typeof ctx.flags?.os === 'string' ? ctx.flags.os : process.platform, root: ws });
  } catch (e) {
    // Fail-closed: sin las guardas compiladas no se sigue en silencio (dejaría el workspace abierto).
    throw new BotSecureError('cli-core.compileFailed', {
      vars: { message: e?.message ?? String(e) }, fix: 'npm run build', exitCode: EXIT.ERROR, cause: e,
    });
  }
  const artifacts = [...generated, ...compiled];

  const known = knownHashes(ws);
  const force = !!ctx.flags?.force;
  const results = [];
  const summary = { created: 0, updated: 0, unchanged: 0, pending: 0 };
  for (const a of artifacts) {
    const rel = toPosix(a.path);
    const abs = join(ws, a.path);
    if (ctx.dryRun) { results.push({ rel, action: existsSync(abs) ? 'unchanged' : 'created' }); continue; }
    const r = writeGenerated(abs, a.content, { known: known[rel] ?? null, force });
    if (a.mode === '0755' && r.action !== 'new') { try { chmodSync(abs, 0o755); } catch { /* Windows */ } }
    results.push({ rel, action: r.action });
    if (r.action === 'created') summary.created++;
    else if (r.action === 'updated') summary.updated++;
    else if (r.action === 'unchanged') summary.unchanged++;
    else { summary.pending++; log.warn(t('cli-core.initHumanEdited', { path: rel })); }
  }
  for (const r of results) if (r.action === 'created' || r.action === 'updated') log.info(t('cli-core.initArtifact', { action: r.action, path: r.rel }));

  const guard = installGuard(ws, { dryRun: ctx.dryRun });
  if (guard.action === 'shim') log.warn(t('cli-core.initGuardShim'));
  else log.info(t('cli-core.initGuardBundle', { from: guard.from }));

  const hooks = [];
  if (!ctx.dryRun) {
    for (const repo of [{ name: '.', dir: ws }, ...policy.apps.map((a) => ({ name: a.name, dir: join(ws, ...String(a.path).split('/').filter((s) => s && s !== '.')) }))]) {
      if (!existsSync(join(repo.dir, '.git'))) continue;
      const r = installHooks(repo.dir, artifacts.filter((a) => toPosix(a.path).includes('.githooks/')));
      hooks.push({ app: repo.name, hooksPath: r.hooksPath, files: r.files.length });
      log.info(t('cli-core.initHooks', { app: repo.name, hooksPath: r.hooksPath }));
    }
    await writeLock(ws, artifacts);
  }

  log.ok(t('cli-core.initSummary', summary));
  log.info(t('cli-core.initDone', { root: ws }));
  const exitCode = EXIT.OK;
  ctx.log.data({ command: 'init', root: ws, project: policy.project, apps: policy.apps.map((a) => a.name), scan, artifacts: results, summary, guard, hooks, dryRun: !!ctx.dryRun });
  return { root: ws, policy, results, summary, guard, hooks, scan, exitCode };
}

export default {
  name: 'init',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Genera el contexto, las reglas y las guardas del workspace (idempotente)',
    en: 'Generate the workspace context, rules and guardrails (idempotent)',
  },
  usage: {
    es: 'bot-secure init [--profile sensitive|standard] [--mode clone|mirror|worktree] [--level 0|1|2] [--engine postgres|mysql|…] [--force] [--yes] [--json]',
    en: 'bot-secure init [--profile sensitive|standard] [--mode clone|mirror|worktree] [--level 0|1|2] [--engine postgres|mysql|…] [--force] [--yes] [--json]',
  },
  async run(ctx) {
    const r = await runInit(ctx);
    ctx.log.info(ctx.t('cli-core.initNext'));
    return r.exitCode;
  },
};
