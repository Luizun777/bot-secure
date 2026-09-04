// `bot-secure branch <create|clone-ai|verify>`: rama `ai-dev` en el remoto, clon restringido
// a esa rama y verificación (refspec, refs protegidas, hooksPath, rama actual, nombre `*-ai`).
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { readJson } from '../lib/fsx.mjs';
import { findWorkspaceRoot, POLICY_FILE } from '../lib/paths.mjs';
import { aiBranch, applyFixes, cloneAi, ensureAiDevBranch, verify } from '../git/index.mjs';

/** Política del workspace que contiene `dir`; objeto vacío si aún no hay workspace. */
function policyFor(dir) {
  const root = findWorkspaceRoot(dir);
  if (!root) return {};
  const p = join(root, ...POLICY_FILE.split('/'));
  return existsSync(p) ? readJson(p, {}) : {};
}

async function cmdCreate(ctx) {
  const { log, t } = ctx;
  const remote = ctx.args[1];
  if (!remote) throw new BotSecureError('git.needRemote', { fix: 'bot-secure branch create git@servidor:equipo/api.git --from dev --push', exitCode: EXIT.ERROR });
  const branch = typeof ctx.flags.branch === 'string' ? ctx.flags.branch : aiBranch(policyFor(ctx.cwd));
  const from = typeof ctx.flags.from === 'string' ? ctx.flags.from : undefined;
  if (ctx.dryRun) {
    log.info(t('git.createDryRun', { remote, branch, from: from ?? 'dev|main|master' }));
    log.data({ dryRun: true, remote, branch, from: from ?? null });
    return EXIT.OK;
  }
  const r = ensureAiDevBranch(remote, { from, branch, push: !!ctx.flags.push, cwd: ctx.cwd });
  if (r.created) log.ok(t('git.branchCreated', { branch: r.branch, from: r.from, remote }));
  else log.info(t('git.branchExists', { branch: r.branch, remote }));
  log.info(t('git.nextClone', { remote, branch: r.branch }));
  log.data(r);
  return EXIT.OK;
}

async function cmdCloneAi(ctx) {
  const { log, t } = ctx;
  const remote = ctx.args[1];
  if (!remote) throw new BotSecureError('git.needRemote', { fix: 'bot-secure branch clone-ai git@servidor:equipo/api.git backend', exitCode: EXIT.ERROR });
  const branch = typeof ctx.flags.branch === 'string' ? ctx.flags.branch : aiBranch(policyFor(ctx.cwd));
  const dest = resolve(ctx.cwd, ctx.args[2] ?? basename(String(remote).replace(/[\\/]+$/, '')).replace(/\.git$/, ''));
  if (ctx.dryRun) {
    log.info(t('git.cloneDryRun', { remote, branch, dest }));
    log.data({ dryRun: true, remote, branch, dest });
    return EXIT.OK;
  }
  const r = cloneAi(remote, dest, { branch });
  log.ok(t('git.cloned', { dest: r.dest, branch: r.branch }));
  log.info(t('git.nextVerify', { dest: r.dest }));
  log.data(r);
  return EXIT.OK;
}

/**
 * Carpetas a verificar: la indicada, o todas las apps de policy.apps si estamos en la raíz
 * del workspace y no se indicó ninguna.
 * @returns {string[]}
 */
function verifyTargets(ctx, dir, policy) {
  if (ctx.args[1]) return [dir];
  const root = findWorkspaceRoot(dir);
  const apps = Array.isArray(policy.apps) ? policy.apps : [];
  if (!root || resolve(root) !== dir || !apps.length) return [dir];
  return apps.map((a) => join(root, ...String(a.path).split('/').filter((s) => s && s !== '.')));
}

/** Verifica una carpeta (y aplica los arreglos con --fix). @returns {{ok:boolean, problems:object[], applied?:object[]}} */
function verifyOne(ctx, dir, policy) {
  const { log, t } = ctx;
  const opts = { requireHooks: !ctx.flags['no-hooks'] };
  const first = verify(dir, policy, opts);
  if (first.ok) { log.ok(t('git.verifyOk', { dir, branch: aiBranch(policy) })); return { ok: true, problems: [] }; }
  log.info(t('git.verifyTitle', { dir, count: first.problems.length }));
  for (const p of first.problems) {
    log.error(t(`git.code_${p.code.replace(/-/g, '')}`, { detail: p.detail ?? '' }));
    log.info(t('cli.fix', { fix: p.fix }));
  }
  if (!ctx.flags.fix) { log.info(t('git.verifyHint')); return { ok: false, problems: first.problems }; }
  const applied = applyFixes(dir, first.problems, policy);
  for (const a of applied) {
    if (a.fixed) log.ok(t('git.fixApplied', { code: a.code }));
    else log.warn(t('git.fixSkipped', { code: a.code, reason: a.reason ?? 'manual' }));
  }
  const again = verify(dir, policy, opts);
  if (again.ok) { log.ok(t('git.verifyOk', { dir, branch: aiBranch(policy) })); return { ok: true, applied, problems: [] }; }
  log.warn(t('git.verifyRemaining', { count: again.problems.length }));
  return { ok: false, applied, problems: again.problems };
}

async function cmdVerify(ctx) {
  const { log, t } = ctx;
  const dir = resolve(ctx.cwd, ctx.args[1] ?? '.');
  const policy = policyFor(dir);
  const targets = verifyTargets(ctx, dir, policy);
  const resultados = [];
  for (const target of targets) {
    if (targets.length > 1) log.step(t('git.verifyTarget', { dir: target }));
    resultados.push({ dir: target, ...verifyOne(ctx, target, policy) });
  }
  log.data({ ok: resultados.every((r) => r.ok), results: resultados });
  return resultados.every((r) => r.ok) ? EXIT.OK : EXIT.FINDINGS;
}

export default {
  name: 'branch',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Crea la rama ai-dev en el remoto, clona solo esa rama y verifica el clon',
    en: 'Create the ai-dev branch on the remote, clone only that branch and verify the clone',
  },
  usage: {
    es: 'bot-secure branch <create <remoto> [--from dev] [--push] | clone-ai <remoto> [destino] | verify [carpeta] [--fix]>',
    en: 'bot-secure branch <create <remote> [--from dev] [--push] | clone-ai <remote> [dest] | verify [dir] [--fix]>',
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'verify';
    if (sub === 'create') return cmdCreate(ctx);
    if (sub === 'clone-ai' || sub === 'clone') return cmdCloneAi(ctx);
    if (sub === 'verify') return cmdVerify(ctx);
    throw new BotSecureError('git.unknownSub', { vars: { sub }, fix: 'bot-secure branch verify', exitCode: EXIT.ERROR });
  },
};
