// `bot-secure policy <compile|diff|validate|show>`: convierte .bot-secure/policy.json en los
// artefactos de guardas (.claude/settings.json, hooks, .githooks) y actualiza lock.json.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { sha256, writeGenerated, writeText } from '../lib/fsx.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { compile } from '../policy/compile.mjs';
import { readLock, writeLock } from '../policy/lock.mjs';
import { validatePolicy } from '../policy/schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const GUARD_REL = join('.claude', 'hooks', 'guard.mjs');
const OSES = ['darwin', 'linux', 'win32'];
const toPosix = (p) => p.split(sep).join('/');

/** Carga la política del workspace o lanza un BotSecureError con el arreglo exacto. */
function loadWorkspace(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('policy.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  let policy;
  try { policy = JSON.parse(readFileSync(join(root, '.bot-secure', 'policy.json'), 'utf8')); }
  catch (e) { throw new BotSecureError('policy.readError', { vars: { path: '.bot-secure/policy.json', message: e.message }, fix: 'bot-secure init', exitCode: EXIT.ERROR }); }
  return { root, policy };
}

function targetOs(ctx) {
  const os = ctx.flags.os ?? process.platform;
  if (!OSES.includes(os)) throw new BotSecureError('policy.unknownSub', { vars: { sub: `--os ${os}` }, fix: `bot-secure policy compile --os ${process.platform}`, exitCode: EXIT.ERROR });
  return os;
}

/**
 * Instala `.claude/hooks/guard.mjs`: el bundle de `npm run build` si existe, o un shim de
 * desarrollo que importa el código fuente por ruta absoluta.
 * @returns {{action:'bundle'|'shim', from:string, sha256:string}}
 */
export function installGuard(root, { dryRun = false } = {}) {
  const dist = join(REPO, 'dist', 'guard.mjs');
  const dest = join(root, GUARD_REL);
  if (existsSync(dist)) {
    const content = readFileSync(dist, 'utf8');
    if (!dryRun) writeText(dest, content);
    return { action: 'bundle', from: toPosix(relative(REPO, dist)), sha256: sha256(content) };
  }
  const src = pathToFileURL(join(REPO, 'src', 'guard', 'guard.mjs')).href;
  const content = [
    '#!/usr/bin/env node',
    '// Generado por bot-secure (modo desarrollo): importa la guarda desde el código fuente.',
    "// El definitivo (autocontenido) lo produce `npm run build` en dist/guard.mjs.",
    "import { readFileSync } from 'node:fs';",
    "import { pathToFileURL } from 'node:url';",
    `import { main } from ${JSON.stringify(src)};`,
    'export { main };',
    '// Solo se autoejecuta si node arrancó ESTE archivo (.githooks/run.mjs lo importa y llama a main()).',
    'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {',
    "  const event = process.argv[2] ?? 'pre-tool';",
    "  let stdin = '';",
    "  try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; }",
    '  main(event, stdin).then((c) => process.exit(typeof c === "number" ? c : 2), () => process.exit(2));',
    '}',
    '',
  ].join('\n');
  if (!dryRun) writeText(dest, content);
  return { action: 'shim', from: toPosix(relative(REPO, join('src', 'guard', 'guard.mjs'))), sha256: sha256(content) };
}

function knownHashes(root) {
  const lock = readLock(root);
  const map = new Map();
  for (const g of lock?.generated ?? []) map.set(g.path, g.sha256);
  return map;
}

async function cmdCompile(ctx, { root, policy }) {
  const { log, t } = ctx;
  const errors = validatePolicy(policy);
  if (errors.length) return reportInvalid(ctx, errors);
  const os = targetOs(ctx);
  const artifacts = compile(policy, { os, root });
  const known = knownHashes(root);
  const force = !!ctx.flags.force;
  const results = [];
  for (const a of artifacts) {
    const abs = join(root, a.path);
    const posix = toPosix(a.path);
    if (ctx.dryRun) { results.push({ path: posix, action: existsSync(abs) ? (readFileSync(abs, 'utf8') === a.content ? 'unchanged' : 'updated') : 'created' }); continue; }
    const r = writeGenerated(abs, a.content, { known: known.get(posix) ?? null, force });
    if (a.mode === '0755') { try { chmodSync(abs, 0o755); } catch { /* Windows: sin bits de ejecución */ } }
    results.push({ path: posix, action: r.action });
    if (r.action === 'new') log.warn(t('policy.humanEdited', { path: posix }));
  }
  const guard = installGuard(root, { dryRun: ctx.dryRun });
  if (guard.action === 'shim') log.warn(t('policy.guardShim'));
  else log.info(t('policy.guardCopied', { from: guard.from }));
  if (os === 'win32' && policy.profile === 'sensitive') log.warn(t('policy.win32Sensitive'));

  if (ctx.dryRun) {
    log.info(t('policy.compiled', { count: artifacts.length, os, profile: policy.profile }));
    for (const r of results) log.info(t('policy.artifact', { action: r.action, path: r.path }));
    log.info(t('policy.dryRun'));
    log.data({ os, profile: policy.profile, dryRun: true, artifacts: results });
    return EXIT.OK;
  }
  const lock = await writeLock(root, artifacts);
  log.ok(t('policy.compiled', { count: artifacts.length, os, profile: policy.profile }));
  for (const r of results) log.info(t('policy.artifact', { action: r.action, path: r.path }));
  log.info(t('policy.lockWritten', { count: lock.generated.length }));
  log.data({ os, profile: policy.profile, artifacts: results, guard, lock: { generated: lock.generated.length } });
  return EXIT.OK;
}

async function cmdDiff(ctx, { root, policy }) {
  const { log, t } = ctx;
  const os = targetOs(ctx);
  const artifacts = compile(policy, { os, root });
  const changes = [];
  for (const a of artifacts) {
    const abs = join(root, a.path);
    const posix = toPosix(a.path);
    if (!existsSync(abs)) { changes.push({ path: posix, state: 'falta' }); continue; }
    if (sha256(readFileSync(abs)) !== sha256(a.content)) changes.push({ path: posix, state: 'difiere' });
  }
  if (!changes.length) { log.ok(t('policy.diffNone')); log.data({ os, changes: [] }); return EXIT.OK; }
  log.info(t('policy.diffTitle', { os }));
  for (const c of changes) log.info(t('policy.diffLine', { state: c.state, path: c.path }));
  log.data({ os, changes });
  return EXIT.DRIFT;
}

function reportInvalid(ctx, errors) {
  const { log, t } = ctx;
  log.error(t('policy.invalid', { count: errors.length }));
  for (const e of errors) log.error(t('policy.invalidLine', { path: e.path, message: e.message }));
  log.data({ valid: false, errors });
  return EXIT.ERROR;
}

async function cmdValidate(ctx, { policy }) {
  const errors = validatePolicy(policy);
  if (errors.length) return reportInvalid(ctx, errors);
  ctx.log.ok(ctx.t('policy.valid', { apps: (policy.apps ?? []).length, profile: policy.profile, mode: policy.mode }));
  ctx.log.data({ valid: true, errors: [] });
  return EXIT.OK;
}

async function cmdShow(ctx, { policy }) {
  ctx.log.info(JSON.stringify(policy, null, 2));
  ctx.log.data(policy);
  return EXIT.OK;
}

export default {
  name: 'policy',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Compila policy.json a settings.json, hooks y lock.json; valida y muestra diferencias',
    en: 'Compile policy.json into settings.json, hooks and lock.json; validate and diff',
  },
  usage: {
    es: 'bot-secure policy <compile [--os darwin|linux|win32] [--dry-run] [--force] | diff | validate | show>',
    en: 'bot-secure policy <compile [--os darwin|linux|win32] [--dry-run] [--force] | diff | validate | show>',
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'compile';
    const ws = loadWorkspace(ctx);
    if (sub === 'compile') return cmdCompile(ctx, ws);
    if (sub === 'diff') return cmdDiff(ctx, ws);
    if (sub === 'validate') return cmdValidate(ctx, ws);
    if (sub === 'show') return cmdShow(ctx, ws);
    throw new BotSecureError('policy.unknownSub', { vars: { sub }, fix: 'bot-secure policy compile', exitCode: EXIT.ERROR });
  },
};
