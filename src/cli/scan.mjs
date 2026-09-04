// `bot-secure scan [--history] [--staged] [--build] [--full] [--fail-on SEV] [--placeholder-leak]
//  [--transcript ruta] [--out dir] [--gitleaks]`: escanea con el motor y escribe los reportes.
// El reporte NUNCA contiene el valor de un secreto: solo máscara y huella HMAC.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { git } from '../lib/exec.mjs';
import { writeText } from '../lib/fsx.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { loadPolicy } from '../policy/index.mjs';
import { readLock } from '../policy/lock.mjs';
import { buildReport, collect, scanPaths, scanText, writeReports } from '../engine/index.mjs';
import { available as gitleaksAvailable, candidates as gitleaksCandidates } from '../engine/adapters/gitleaks.mjs';
import { loadBaseline } from '../engine/baseline.mjs';
import { decode } from '../engine/encoding.mjs';
import { hmacFingerprint, loadHmacKey } from '../engine/fingerprint.mjs';
import { mask } from '../engine/masks.mjs';
import { SEVERITY_ORDER } from '../engine/report.mjs';
import { isFake } from '../generate/fakes.mjs';

export const REPORTS_DIR = join('.bot-secure', 'reports');
export const LEAK_RULE = 'ai-placeholder-leak';
const TOP_ROWS = 10;
const MAX_LEAK_BYTES = 2 * 1024 * 1024;
const posix = (p) => String(p).split(sep).join('/');

/** Rutas permitidas para valores del ambiente de IA (no son fuga). */
const LEAK_ALLOW = [
  '.env.ai', '**/.env.ai', '.env.example', '**/.env.example',
  'docs/**', '**/docs/**', '**/ai-env.*', '.bot-secure/**', '**/.bot-secure/**',
];

/** Glob muy simple (`**`, `*`, `?`) sobre rutas posix. */
export function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matchesAny = (rel, globs) => globs.some((g) => globToRe(g).test(rel));

/**
 * Raíz a escanear: workspace de IA → repo git → cwd. Nunca falla: `scan` debe poder
 * usarse antes de que exista el workspace.
 */
export function scanRoot(ctx) {
  return findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd) ?? resolve(ctx.cwd);
}

/** policy.json del workspace, o {} si aún no existe (scan funciona antes de `init`). */
export function safePolicy(root) {
  try { return loadPolicy(root) ?? {}; } catch { return {}; }
}

/** Severidad válida (o 'NONE' para no fallar nunca). */
export function normalizeSeverity(value, fix) {
  const sev = String(value ?? '').toUpperCase();
  if (sev === 'NONE' || SEVERITY_ORDER.includes(sev)) return sev;
  throw new BotSecureError('cli-tools.badSeverity', { vars: { severity: String(value) }, fix, exitCode: EXIT.ERROR });
}

/** ¿Cuántos hallazgos alcanzan el umbral? */
export function countAtLeast(findings, failOn) {
  if (failOn === 'NONE') return 0;
  const limit = SEVERITY_ORDER.indexOf(failOn);
  return findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= limit).length;
}

/** Archivos del índice de git, por app (rutas relativas a la raíz). */
export function stagedPaths(root, apps) {
  const dirs = apps.length ? apps.map((a) => a.path || '.') : ['.'];
  const out = [];
  for (const d of dirs) {
    const cwd = join(root, d);
    if (!existsSync(cwd)) continue;
    const r = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd });
    if (r.status !== 0) continue;
    for (const line of r.stdout.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      const rel = posix(d === '.' ? p : `${d}/${p}`);
      if (existsSync(join(root, rel))) out.push(rel);
    }
  }
  return [...new Set(out)];
}

/** Modo del motor según las banderas (contrato: scan | ci | pre-commit). */
export function modeFor(ctx) {
  if (ctx.flags.staged) return 'pre-commit';
  if (ctx.flags['fail-on'] && process.env.CI) return 'ci';
  return 'scan';
}

/** Un hallazgo de fuga de valores del ambiente de IA. */
function leakFinding({ key, file, line, column, value, action }) {
  const fp = hmacFingerprint(key, LEAK_RULE, file, value);
  return {
    id: fp, ruleId: LEAK_RULE, category: 'placeholder-leak', severity: 'CRITICAL',
    file, line, column, masked: mask(value, 'token'), fingerprint: fp,
    remediation: { kind: 'secret', action },
    source: 'native',
  };
}

/**
 * Busca valores del ambiente de IA (`__AI_PLACEHOLDER__…`, fakes tipados) fuera de la lista
 * permitida: lock.generated, .env.ai, .env.example, docs/ y los loaders ai-env de cada app.
 * @returns {object[]} hallazgos CRITICAL
 */
export function placeholderLeaks({ root, key, exclude = [], action, build = false, full = false, maxFileSizeMB = 1 }) {
  const lock = readLock(root);
  const generated = new Set((lock?.generated ?? []).map((g) => posix(g.path)));
  const walked = collect({ root, exclude, build, full, maxFileSizeMB });
  const out = [];
  for (const file of walked.files) {
    const rel = posix(file.rel);
    if (generated.has(rel) || matchesAny(rel, LEAK_ALLOW)) continue;
    let buf;
    try { buf = readFileSync(file.abs); } catch { continue; }
    if (buf.length > MAX_LEAK_BYTES) buf = buf.subarray(0, MAX_LEAK_BYTES);
    const dec = decode(buf);
    if (dec.binary || !dec.text) continue;
    const lines = dec.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (text.length > 4096) continue;
      for (const m of text.matchAll(/__AI_PLACEHOLDER__[A-Z0-9_]+__[A-Za-z0-9]*/g)) {
        out.push(leakFinding({ key, file: rel, line: i + 1, column: m.index + 1, value: m[0], action }));
      }
      if (text.includes('__AI_PLACEHOLDER__')) continue;
      for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9._+@-]{15,}/g)) {
        if (!isFake(m[0])) continue;
        out.push(leakFinding({ key, file: rel, line: i + 1, column: m.index + 1, value: m[0], action }));
      }
    }
  }
  return out;
}

/** Reescanea con el motor nativo las líneas que localizó gitleaks (nunca usa su valor). */
async function gitleaksFindings(ctx, { root, key, mode }) {
  const av = gitleaksAvailable();
  if (!av.ok) { ctx.log.warn(ctx.t('cli-tools.gitleaksMissing')); return []; }
  const res = gitleaksCandidates(root, { history: !!ctx.flags.history });
  if (!res.ok) { ctx.log.warn(ctx.t('cli-tools.gitleaksFailed', { reason: res.reason ?? '?' })); return []; }
  const out = [];
  const seen = new Set();
  for (const c of res.candidates) {
    if (c.commit) continue; // los de historia ya los cubre --history
    const abs = join(root, c.file);
    const k = `${c.file}:${c.line}`;
    if (seen.has(k) || !existsSync(abs)) continue;
    seen.add(k);
    let text = '';
    try { text = readFileSync(abs, 'utf8').split(/\r?\n/)[c.line - 1] ?? ''; } catch { continue; }
    if (!text) continue;
    const found = await scanText(text, { path: c.file, mode, root, hmacKey: key, worker: false });
    for (const f of found) out.push({ ...f, file: c.file, line: c.line, source: 'gitleaks' });
  }
  ctx.log.info(ctx.t('cli-tools.gitleaksDone', { version: av.version ?? '?', count: out.length }));
  return out;
}

/** Escanea un transcript de Claude Code (o cualquier texto suelto). */
async function transcriptFindings(ctx, { root, key, mode }) {
  const p = String(ctx.flags.transcript);
  const abs = isAbsolute(p) ? p : resolve(ctx.cwd, p);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new BotSecureError('cli-tools.transcriptMissing', { vars: { path: p }, fix: `bot-secure scan --transcript ${p}`, exitCode: EXIT.ERROR });
  }
  const text = readFileSync(abs, 'utf8');
  const rel = posix(relative(root, abs)) || posix(abs);
  const found = await scanText(text, { path: rel, mode, root, hmacKey: key, worker: false });
  ctx.log.info(ctx.t('cli-tools.transcriptDone', { path: rel, count: found.length }));
  return found.map((f) => ({ ...f, file: rel }));
}

/** Fusiona hallazgos extra evitando duplicados por (ruleId, fingerprint). */
function merge(base, extra) {
  const seen = new Set(base.map((f) => `${f.ruleId}|${f.fingerprint}`));
  const out = [...base];
  for (const f of extra) {
    const k = `${f.ruleId}|${f.fingerprint}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(f);
  }
  return out;
}

/** Tabla de las primeras filas, siempre enmascaradas. */
function topRows(ctx, findings) {
  const rows = [[ctx.t('cli-tools.colSeverity'), ctx.t('cli-tools.colRule'), ctx.t('cli-tools.colFile'), ctx.t('cli-tools.colMasked')]];
  for (const f of findings.slice(0, TOP_ROWS)) {
    rows.push([f.severity, f.ruleId, `${f.file}:${f.line}`, f.masked ?? '***']);
  }
  return rows;
}

export default {
  name: 'scan',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Busca secretos y datos personales; escribe report.json/md/sarif sin exponer valores',
    en: 'Find secrets and personal data; write report.json/md/sarif without exposing values',
  },
  usage: {
    es: 'bot-secure scan [--history] [--staged] [--build] [--full] [--fail-on CRITICAL|HIGH|MEDIUM|LOW|NONE] [--placeholder-leak] [--transcript <ruta>] [--out <dir>] [--gitleaks] [--json] [--dry-run]',
    en: 'bot-secure scan [--history] [--staged] [--build] [--full] [--fail-on CRITICAL|HIGH|MEDIUM|LOW|NONE] [--placeholder-leak] [--transcript <path>] [--out <dir>] [--gitleaks] [--json] [--dry-run]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const root = scanRoot(ctx);
    const policy = safePolicy(root);
    const apps = policy.apps ?? [];
    const scanCfg = policy.scan ?? {};
    const failOn = normalizeSeverity(ctx.flags['fail-on'] ?? scanCfg.failOn ?? 'HIGH', 'bot-secure scan --fail-on HIGH');
    const mode = modeFor(ctx);
    const key = loadHmacKey(root);
    const build = !!ctx.flags.build, full = !!ctx.flags.full;
    const maxFileSizeMB = Number(scanCfg.maxFileSizeMB) || 1;
    const exclude = Array.isArray(scanCfg.exclude) ? scanCfg.exclude : [];
    const paths = ctx.flags.staged ? stagedPaths(root, apps) : [];

    if (ctx.flags.staged && !paths.length) {
      log.ok(t('cli-tools.stagedEmpty'));
      log.data({ command: 'scan', mode, findings: [], staged: true, bySeverity: {}, exitCode: EXIT.OK });
      return EXIT.OK;
    }

    log.step(t('cli-tools.scanRunning', { mode, root: posix(root) }));
    let baseline = null;
    try { baseline = loadBaseline(root); } catch (e) { log.warn(t('cli-tools.baselineIgnored', { message: e?.message ?? String(e) })); }

    let report = await scanPaths({
      root, paths, mode, exclude, build, full, baseline: baseline ?? undefined,
      hmacKey: key, apps, maxFileSizeMB, lang: ctx.lang, history: !!ctx.flags.history,
    });

    const extra = [];
    if (ctx.flags['placeholder-leak']) {
      const leaks = placeholderLeaks({ root, key, exclude, action: t('cli-tools.leakAction'), build, full, maxFileSizeMB });
      log.info(t('cli-tools.leakDone', { count: leaks.length }));
      extra.push(...leaks);
    }
    if (ctx.flags.transcript) extra.push(...await transcriptFindings(ctx, { root, key, mode }));
    if (ctx.flags.gitleaks) extra.push(...await gitleaksFindings(ctx, { root, key, mode }));

    if (extra.length) {
      const kept = baseline ? extra.filter((f) => !baseline.entries.some((e) => e.fingerprint === f.fingerprint && (!e.expiresAt || new Date(e.expiresAt) > new Date()))) : extra;
      report = buildReport({
        root: report.root, mode, findings: merge(report.findings, kept), stats: report.stats,
        skipped: report.skipped, warnings: report.warnings, version: report.version,
        rulesVersion: report.rulesVersion, commit: report.commit, lang: ctx.lang,
      });
    }

    const outDir = ctx.flags.out && ctx.flags.out !== true
      ? (isAbsolute(String(ctx.flags.out)) ? String(ctx.flags.out) : resolve(ctx.cwd, String(ctx.flags.out)))
      : join(root, REPORTS_DIR);
    let written = [];
    if (!ctx.dryRun) {
      writeText(join(outDir, '.gitignore'), '# Generado por bot-secure: los reportes no se versionan.\n*\n!.gitignore\n');
      written = writeReports(report, { dir: outDir, formats: ['json', 'md', 'sarif'], lang: ctx.lang });
    }

    const bySeverity = report.stats.bySeverity ?? {};
    const failing = countAtLeast(report.findings, failOn);
    log.ok(t('cli-tools.scanDone', { findings: report.findings.length, files: report.stats.files, ms: report.stats.ms }));
    for (const s of SEVERITY_ORDER) if (bySeverity[s]) log.info(t('cli-tools.sevLine', { severity: s, count: bySeverity[s] }));
    if (report.findings.length) {
      log.table(topRows(ctx, report.findings));
      if (report.findings.length > TOP_ROWS) log.info(t('cli-tools.moreRows', { count: report.findings.length - TOP_ROWS }));
    }
    if (ctx.dryRun) log.info(t('cli-tools.dryRun'));
    else for (const p of written) log.info(t('cli-tools.reportWritten', { path: posix(relative(root, p)) || posix(p) }));
    log.warn(t('report.noFindingsNoGuarantee'));
    if (failing) log.error(t('cli-tools.failOnHit', { count: failing, severity: failOn }));
    else log.info(t('cli-tools.nextSanitize'));

    log.data({
      command: 'scan', mode, root: report.root, failOn, findings: report.findings.length,
      bySeverity, byRule: report.stats.byRule ?? {}, reportSha256: report.reportSha256,
      reports: written.map((p) => posix(p)), dryRun: !!ctx.dryRun,
      exitCode: failing ? EXIT.FINDINGS : EXIT.OK,
    });
    return failing ? EXIT.FINDINGS : EXIT.OK;
  },
};
