// `bot-secure sanitize [--dry-run] [--apply] [--refactor <lenguaje|auto>] [--mirror]`:
// convierte los hallazgos del último reporte en cambios revisables (literal → variable de entorno,
// campo de configuración → VACÍO) y en reglas de saneamiento tipadas.
// Las reglas contienen VALORES REALES: se escriben en ~/.bot-secure/<id-repo>/rules.txt, jamás
// dentro del repositorio. La salida (diff, TODO, logs) solo muestra valores enmascarados.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { EXIT } from '../lib/errors.mjs';
import { writeText } from '../lib/fsx.mjs';
import { loadRules, scanPaths } from '../engine/index.mjs';
import { botSecureHome, loadHmacKey, repoId } from '../engine/fingerprint.mjs';
import { applyRefactors, envVarFor, proposeRefactors, toUnifiedDiff } from '../generate/refactor.mjs';
import { safePolicy, REPORTS_DIR, scanRoot } from './scan.mjs';

export const TODO_FILE = join('.bot-secure', 'SANITIZE-TODO.md');
const posix = (p) => String(p).split(sep).join('/');

/** Recupera el valor real de un hallazgo releyendo su línea con la regla que lo produjo. */
export function valueFor(root, finding, rulesById) {
  const abs = join(root, finding.file);
  if (!existsSync(abs)) return null;
  let line = '';
  try { line = readFileSync(abs, 'utf8').split(/\r?\n/)[(finding.line ?? 1) - 1] ?? ''; } catch { return null; }
  if (!line) return null;
  const rule = rulesById.get(finding.ruleId);
  if (!rule?.regex) return { line, value: null };
  let re;
  try { re = new RegExp(rule.regex, (rule.flags ?? '').replace(/g/g, '') + 'g'); } catch { return { line, value: null }; }
  const m = re.exec(line);
  if (!m) return { line, value: null };
  const value = rule.secretGroup ? m[rule.secretGroup] : m[0];
  return { line, value: value ?? null };
}

/**
 * Reglas tipadas de saneamiento (literal/pii/path) para el espejo y para `git filter-repo`.
 * CONTIENEN VALORES REALES: quien llama debe escribirlas fuera del repositorio.
 */
export function buildRules(root, findings, rulesById, { now = new Date() } = {}) {
  const lines = [
    `# bot-secure sanitize — ${now.toISOString()}`,
    '# CONTIENE VALORES REALES. Vive fuera del repositorio: no lo versiones ni lo compartas.',
    '# Formato: literal:<valor>==><reemplazo> · regex:<patrón>==><reemplazo> · pii:<tipo>:<huella> · path:<glob>',
  ];
  let literals = 0, piis = 0, paths = 0;
  for (const f of findings) {
    if (f.category === 'pii') { lines.push(`pii:${f.remediation?.kind ?? 'pii'}:${f.fingerprint}`); piis++; continue; }
    if (f.category === 'file') { lines.push(`path:${f.file}`); paths++; continue; }
    const got = valueFor(root, f, rulesById);
    if (!got?.value) continue;
    lines.push(`literal:${got.value}==>__AI_PLACEHOLDER__${envVarFor(f)}__`);
    literals++;
  }
  return { text: lines.join('\n') + '\n', literals, piis, paths };
}

/** SANITIZE-TODO.md: lo que hay que hacer a mano. Nunca contiene valores. */
export function todoMarkdown(t, { manual, proposals, rulesPath }) {
  const L = [`# ${t('cli-tools.todoTitle')}`, ''];
  L.push(`- ${t('cli-tools.todoRules', { path: rulesPath })}`);
  L.push(`- ${t('cli-tools.todoCount', { proposals: proposals.length, manual: manual.length })}`, '');
  L.push(`## ${t('cli-tools.todoManual')}`, '');
  if (!manual.length) L.push(t('cli-tools.todoNone'), '');
  else {
    L.push(`| ${t('cli-tools.colSeverity')} | ${t('cli-tools.colRule')} | ${t('cli-tools.colFile')} | ${t('cli-tools.colMasked')} | ${t('cli-tools.colReason')} |`);
    L.push('|---|---|---|---|---|');
    for (const m of manual) {
      const f = m.finding;
      L.push(`| ${f.severity} | ${f.ruleId} | ${f.file}:${f.line} | ${f.masked ?? '***'} | ${m.reason} |`);
    }
    L.push('');
  }
  L.push(`## ${t('cli-tools.todoAuto')}`, '');
  if (!proposals.length) L.push(t('cli-tools.todoNone'), '');
  else {
    L.push(`| ${t('cli-tools.colFile')} | ${t('cli-tools.colKind')} | ${t('cli-tools.colEnvVar')} |`);
    L.push('|---|---|---|');
    for (const p of proposals) L.push(`| ${p.file}:${p.line} | ${p.kind} | ${p.envVar ?? '—'} |`);
    L.push('');
  }
  L.push(t('cli-tools.todoFooter'), '');
  return L.join('\n');
}

/** Último reporte en disco; si no hay, se escanea al vuelo. */
async function loadReport(ctx, root, policy) {
  const p = join(root, REPORTS_DIR, 'report.json');
  if (existsSync(p)) {
    try {
      const report = JSON.parse(readFileSync(p, 'utf8'));
      ctx.log.info(ctx.t('cli-tools.usingReport', { path: posix(relative(root, p)) }));
      return report;
    } catch { ctx.log.warn(ctx.t('cli-tools.reportUnreadable', { path: posix(relative(root, p)) })); }
  }
  ctx.log.step(ctx.t('cli-tools.scanningNow'));
  return scanPaths({
    root, mode: 'scan', apps: policy.apps ?? [], hmacKey: loadHmacKey(root), lang: ctx.lang,
    exclude: policy.scan?.exclude ?? [], maxFileSizeMB: Number(policy.scan?.maxFileSizeMB) || 1,
  });
}

/**
 * Red de seguridad del comando: ninguna línea que se imprima puede llevar el valor real.
 * Se vuelve a enmascarar el "antes" y se descarta la propuesta cuyo "después" seguiría
 * conteniendo el valor (esa se resuelve a mano).
 * @returns {{safe:object[], leaking:object[]}}
 */
export function maskProposals(root, proposals, findings, rulesById) {
  const byLine = new Map(findings.map((f) => [`${f.file}:${f.line}`, f]));
  const safe = [], leaking = [];
  for (const p of proposals) {
    const f = byLine.get(`${p.file}:${p.line}`);
    const value = f ? valueFor(root, f, rulesById)?.value : null;
    if (!value) { safe.push(p); continue; }
    const masked = f.masked ?? '***';
    if (String(p.after ?? '').includes(value)) { leaking.push({ finding: f, reason: 'sin-cambio' }); continue; }
    safe.push({ ...p, before: String(p.before ?? '').split(value).join(masked) });
  }
  return { safe, leaking };
}

/** Apps sobre las que se propone (cada una escribe su propio .env.ai). */
function appsOf(policy) {
  const apps = (policy.apps ?? []).filter((a) => a?.path);
  return apps.length ? apps : [{ name: policy.project ?? 'app', path: '.' }];
}

export default {
  name: 'sanitize',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Convierte los hallazgos en cambios revisables: campo vacío en config, variable de entorno en código',
    en: 'Turn findings into reviewable changes: empty config fields, environment variables in code',
  },
  usage: {
    es: 'bot-secure sanitize <--dry-run | --apply> [--refactor auto|js|python|java|kotlin|csharp|go|php|ruby|yaml|json|properties|xml] [--mirror] [--json]',
    en: 'bot-secure sanitize <--dry-run | --apply> [--refactor auto|js|python|java|kotlin|csharp|go|php|ruby|yaml|json|properties|xml] [--mirror] [--json]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    if (ctx.flags.mirror) {
      log.warn(t('cli-tools.mirrorNextVersion'));
      log.info(t('cli.fix', { fix: 'ver docs/avanzado.md' }));
      log.data({ command: 'sanitize', mirror: 'not-implemented', version: 'v1.1' });
      return EXIT.OK;
    }
    const apply = !!ctx.flags.apply && !ctx.dryRun;
    if (!apply && !ctx.dryRun) log.warn(t('cli-tools.assumingDryRun'));

    const root = scanRoot(ctx);
    const policy = safePolicy(root);
    const report = await loadReport(ctx, root, policy);
    const findings = report.findings ?? [];
    if (!findings.length) {
      log.ok(t('cli-tools.nothingToSanitize'));
      log.warn(t('report.noFindingsNoGuarantee'));
      log.data({ command: 'sanitize', proposals: [], manual: [], applied: false });
      return EXIT.OK;
    }

    const rulesById = new Map(loadRules().map((r) => [r.id, r]));
    const language = typeof ctx.flags.refactor === 'string' ? ctx.flags.refactor : 'auto';
    const apps = appsOf(policy);
    const perApp = apps.map((app) => {
      const raw = proposeRefactors(findings, app, { root, project: policy.project })
        .filter((p) => language === 'auto' || p.lang === language);
      return { app, ...maskProposals(root, raw, findings, rulesById) };
    });
    const proposals = perApp.flatMap((x) => x.safe);
    const covered = new Set(proposals.map((p) => `${p.file}:${p.line}`));
    const manual = findings
      .filter((f) => !covered.has(`${f.file}:${f.line}`))
      .map((f) => ({ finding: f, reason: f.category === 'pii' || f.category === 'file' ? 'manual' : 'sin-propuesta' }));

    const rules = buildRules(root, findings, rulesById);
    const rulesPath = join(botSecureHome(), repoId(root), 'rules.txt');

    const diff = toUnifiedDiff(proposals);
    if (diff.trim()) log.info(diff.trimEnd());
    log.ok(t('cli-tools.sanitizeSummary', { proposals: proposals.length, manual: manual.length }));

    const summary = {
      rulesPath: posix(rulesPath),
      rules: { literals: rules.literals, pii: rules.piis, paths: rules.paths },
      proposals: proposals.map((p) => ({ file: p.file, line: p.line, kind: p.kind, envVar: p.envVar ?? null })),
      manual: manual.map((m) => ({ file: m.finding.file, line: m.finding.line, ruleId: m.finding.ruleId, reason: m.reason })),
    };

    if (!apply) {
      log.info(t('cli-tools.dryRun'));
      log.info(t('cli-tools.nextApply'));
      log.data({ command: 'sanitize', dryRun: true, applied: false, ...summary });
      return EXIT.OK;
    }

    writeText(rulesPath, rules.text);
    const changed = [];
    for (const { app, safe: list } of perApp) {
      if (!list.length) continue;
      const res = applyRefactors(root, list, { dryRun: false, app, policy, project: policy.project });
      for (const c of res.changed ?? []) if (!changed.includes(posix(c))) changed.push(posix(c));
    }
    writeText(join(root, TODO_FILE), todoMarkdown(t, { manual, proposals, rulesPath: posix(rulesPath) }));

    log.ok(t('cli-tools.sanitizeApplied', { files: changed.length, rules: rules.literals + rules.piis + rules.paths }));
    log.warn(t('cli-tools.rulesOutsideRepo', { path: posix(rulesPath) }));
    log.info(t('cli-tools.todoWritten', { path: posix(TODO_FILE) }));
    log.info(t('cli-tools.nextScan'));
    log.data({ command: 'sanitize', dryRun: false, applied: true, filesChanged: changed, ...summary, todo: posix(TODO_FILE) });
    return EXIT.OK;
  },
};
