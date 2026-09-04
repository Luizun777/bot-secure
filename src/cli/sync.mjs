// `bot-secure sync [--quarantine] [--rebase-open]`: trae `dev` → `ai-dev`.
// v1: comprueba el rango con el motor; si hay hallazgos por encima del umbral escribe
// .bot-secure/QUARANTINE.md (huella, commit, autor, plazo) y NO mergea. Si está limpio,
// hace el avance rápido (nunca un merge commit). Normalmente lo ejecuta el job de CI.
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { git } from '../lib/exec.mjs';
import { writeText } from '../lib/fsx.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { scanText } from '../engine/index.mjs';
import { loadHmacKey } from '../engine/fingerprint.mjs';
import { SEVERITY_ORDER } from '../engine/report.mjs';
import { safePolicy, normalizeSeverity } from './scan.mjs';

export const QUARANTINE_FILE = join('.bot-secure', 'QUARANTINE.md');
const QUARANTINE_DAYS = 7;
const MAX_BLOB = 1024 * 1024;
const posix = (p) => String(p).split(sep).join('/');

const trim = (r) => (r.status === 0 ? r.stdout.trim() : null);

/** Apps a sincronizar: las de la política, o el propio repo si no hay ninguna. */
export function reposFor(root, policy) {
  const apps = (policy.apps ?? []).filter((a) => a?.path);
  if (!apps.length) return [{ name: policy.project ?? 'root', path: '.', dir: root }];
  return apps.map((a) => ({ name: a.name, path: posix(a.path), dir: join(root, a.path), branch: a.branch }));
}

/** ¿Existe la referencia? */
const hasRef = (dir, ref) => git(['rev-parse', '--verify', '--quiet', ref], { cwd: dir }).status === 0;

/** Commits del rango, con autor. */
export function rangeCommits(dir, range) {
  const r = git(['log', '--format=%H%x1f%an%x1f%s', range], { cwd: dir });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
    const [commit, author, subject] = l.split('\x1f');
    return { commit, author, subject };
  });
}

/** Commit y autor que tocaron ese archivo dentro del rango. */
function blameInRange(dir, range, file) {
  const r = git(['log', '-1', '--format=%H%x1f%an%x1f%aI', range, '--', file], { cwd: dir });
  if (r.status !== 0 || !r.stdout.trim()) return { commit: null, author: null, at: null };
  const [commit, author, at] = r.stdout.trim().split('\x1f');
  return { commit, author, at };
}

/** Escanea el estado final de los archivos que cambian en el rango. */
export async function scanRange(dir, range, head, { hmacKey, lang }) {
  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', range], { cwd: dir });
  if (changed.status !== 0) return [];
  const files = changed.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const file of files) {
    const blob = git(['show', `${head}:${file}`], { cwd: dir });
    if (blob.status !== 0) continue;
    if (blob.stdout.length > MAX_BLOB || blob.stdout.includes('\u0000')) continue;
    const found = await scanText(blob.stdout, { path: file, mode: 'ci', root: dir, hmacKey, lang, worker: false });
    for (const f of found) out.push({ ...f, file });
  }
  return out;
}

/** QUARANTINE.md: huella, commit, autor y plazo. Nunca el valor del secreto. */
export function quarantineMarkdown(t, { app, range, findings, dir, now = new Date() }) {
  const deadline = new Date(now.getTime() + QUARANTINE_DAYS * 86400000).toISOString().slice(0, 10);
  const L = [`# ${t('cli-tools.quarantineTitle')}`, ''];
  L.push(`- ${t('cli-tools.quarantineApp', { app })}`);
  L.push(`- ${t('cli-tools.quarantineRange', { range })}`);
  L.push(`- ${t('cli-tools.quarantineAt', { at: now.toISOString() })}`);
  L.push(`- ${t('cli-tools.quarantineDeadline', { date: deadline })}`, '');
  L.push(`| ${t('cli-tools.colSeverity')} | ${t('cli-tools.colFingerprint')} | ${t('cli-tools.colRule')} | ${t('cli-tools.colFile')} | ${t('cli-tools.colCommit')} | ${t('cli-tools.colAuthor')} |`);
  L.push('|---|---|---|---|---|---|');
  for (const f of findings) {
    const b = blameInRange(dir, range, f.file);
    L.push(`| ${f.severity} | \`${f.fingerprint}\` | ${f.ruleId} | ${f.file}:${f.line} | \`${(b.commit ?? '?').slice(0, 12)}\` | ${b.author ?? '?'} |`);
  }
  L.push('', t('cli-tools.quarantineNext'), '');
  return L.join('\n');
}

/** Ramas de tarea abiertas (`ai/*`) que quedarían por detrás tras el avance. */
export function openTaskBranches(dir, policy, ai) {
  const prefix = policy.branches?.taskPrefix ?? 'ai/';
  const r = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}*`], { cwd: dir });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((branch) => {
    const c = git(['rev-list', '--count', `${branch}..${ai}`], { cwd: dir });
    return { branch, behind: c.status === 0 ? Number(c.stdout.trim()) || 0 : null };
  });
}

/** Sincroniza un repo. Devuelve el resultado sin imprimir nada. */
async function syncRepo(ctx, root, policy, repo, { from, ai, failOn }) {
  const dir = repo.dir;
  if (!existsSync(join(dir, '.git'))) return { app: repo.name, status: 'not-a-repo' };
  const remotes = trim(git(['remote'], { cwd: dir })) ?? '';
  if (!remotes) return { app: repo.name, status: 'no-remote' };
  const remote = remotes.split(/\r?\n/)[0].trim();

  if (!ctx.dryRun) git(['fetch', remote, from], { cwd: dir });
  const head = hasRef(dir, `${remote}/${from}`) ? `${remote}/${from}` : (hasRef(dir, from) ? from : null);
  if (!head) return { app: repo.name, status: 'no-source', from };
  if (!hasRef(dir, ai)) return { app: repo.name, status: 'no-ai-branch', ai };

  const range = `${ai}..${head}`;
  const commits = rangeCommits(dir, range);
  if (!commits.length) return { app: repo.name, status: 'up-to-date', ai, head };

  const findings = await scanRange(dir, range, head, { hmacKey: loadHmacKey(root), lang: ctx.lang });
  const blocking = findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= SEVERITY_ORDER.indexOf(failOn));
  if (blocking.length) {
    const rel = QUARANTINE_FILE;
    if (!ctx.dryRun) writeText(join(root, rel), quarantineMarkdown(ctx.t, { app: repo.name, range, findings: blocking, dir }));
    return {
      app: repo.name, status: 'quarantined', ai, head, range, commits: commits.length,
      findings: blocking.length, quarantine: posix(rel),
      fingerprints: blocking.map((f) => f.fingerprint),
    };
  }
  if (ctx.dryRun) return { app: repo.name, status: 'would-merge', ai, head, range, commits: commits.length, findings: 0 };

  const current = trim(git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }));
  const r = current === ai
    ? git(['merge', '--ff-only', head], { cwd: dir })
    : git(['fetch', '.', `${head}:${ai}`], { cwd: dir });
  if (r.status !== 0) return { app: repo.name, status: 'not-fast-forward', ai, head, message: (r.stderr || r.stdout).trim().slice(0, 300) };
  return { app: repo.name, status: 'merged', ai, head, range, commits: commits.length, findings: 0 };
}

export default {
  name: 'sync',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Trae dev → ai-dev con avance rápido; si el rango trae hallazgos, deja cuarentena y no mergea',
    en: 'Fast-forward dev → ai-dev; if the range brings findings, quarantine it and do not merge',
  },
  usage: {
    es: 'bot-secure sync [--from dev] [--quarantine] [--rebase-open] [--json] [--dry-run]',
    en: 'bot-secure sync [--from dev] [--quarantine] [--rebase-open] [--json] [--dry-run]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const root = findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd);
    if (!root) throw new BotSecureError('cli-tools.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
    const policy = safePolicy(root);
    const ai = policy.branches?.ai ?? 'ai-dev';
    const from = typeof ctx.flags.from === 'string' ? ctx.flags.from : 'dev';
    const failOn = ctx.flags.quarantine ? 'MEDIUM' : normalizeSeverity(policy.scan?.failOn ?? 'HIGH', 'bot-secure sync --quarantine');

    const results = [];
    for (const repo of reposFor(root, policy)) {
      log.step(t('cli-tools.syncApp', { app: repo.name, from, ai }));
      results.push(await syncRepo(ctx, root, policy, repo, { from, ai, failOn }));
    }

    let exit = EXIT.OK;
    for (const r of results) {
      if (r.status === 'merged') log.ok(t('cli-tools.syncMerged', { app: r.app, ai: r.ai, commits: r.commits }));
      else if (r.status === 'would-merge') log.info(t('cli-tools.syncWouldMerge', { app: r.app, ai: r.ai, commits: r.commits }));
      else if (r.status === 'up-to-date') log.ok(t('cli-tools.syncUpToDate', { app: r.app, ai: r.ai }));
      else if (r.status === 'quarantined') {
        log.error(t('cli-tools.syncQuarantined', { app: r.app, count: r.findings, path: r.quarantine }));
        log.info(t('cli.fix', { fix: `bot-secure scan --fail-on ${failOn}` }));
        exit = EXIT.FINDINGS;
      } else if (r.status === 'no-remote') {
        log.error(t('cli-tools.syncNoRemote', { app: r.app }));
        log.info(t('cli.fix', { fix: 'git remote add origin <url>' }));
        if (exit === EXIT.OK) exit = EXIT.ERROR;
      } else if (r.status === 'no-ai-branch') {
        log.error(t('cli-tools.syncNoAiBranch', { app: r.app, ai: r.ai }));
        log.info(t('cli.fix', { fix: 'bot-secure branch create' }));
        if (exit === EXIT.OK) exit = EXIT.ERROR;
      } else if (r.status === 'no-source') {
        log.error(t('cli-tools.syncNoSource', { app: r.app, from }));
        log.info(t('cli.fix', { fix: `bot-secure sync --from ${from}` }));
        if (exit === EXIT.OK) exit = EXIT.ERROR;
      } else if (r.status === 'not-fast-forward') {
        log.error(t('cli-tools.syncNotFf', { app: r.app, ai: r.ai }));
        log.info(t('cli.fix', { fix: 'bot-secure sync --quarantine' }));
        if (exit === EXIT.OK) exit = EXIT.ERROR;
      } else if (r.status === 'not-a-repo') {
        log.warn(t('cli-tools.syncNotRepo', { app: r.app }));
      }
    }

    if (ctx.flags['rebase-open']) {
      const open = [];
      for (const repo of reposFor(root, policy)) {
        if (!existsSync(join(repo.dir, '.git'))) continue;
        for (const b of openTaskBranches(repo.dir, policy, ai)) open.push({ app: repo.name, ...b });
      }
      if (!open.length) log.info(t('cli-tools.syncNoOpen'));
      else {
        log.info(t('cli-tools.syncOpenTitle', { count: open.length }));
        for (const b of open) log.info(t('cli-tools.syncOpenLine', { app: b.app, branch: b.branch, behind: b.behind ?? '?' }));
      }
      log.data({ command: 'sync', from, ai, failOn, results, open, exitCode: exit });
      return exit;
    }

    if (ctx.dryRun) log.info(t('cli-tools.dryRun'));
    log.data({ command: 'sync', from, ai, failOn, results, exitCode: exit });
    return exit;
  },
};
