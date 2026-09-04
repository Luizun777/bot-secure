// Construcción y escritura de reportes (json, md, sarif). Nunca contienen el valor de un secreto.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, writeText } from '../lib/fsx.mjs';
import { makeT } from '../lib/i18n.mjs';
import { BotSecureError } from '../lib/errors.mjs';

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SARIF_LEVEL = { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note', INFO: 'note' };
const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';
const HOME = 'https://github.com/bot-secure/bot-secure';

/** Copia defensiva de un hallazgo: PII sin entropy; nunca campos con valor crudo. */
function sanitizeFinding(f) {
  const out = { ...f };
  if (out.category === 'pii') delete out.entropy;
  delete out.value; delete out.raw; delete out.match; delete out.secret;
  return out;
}

/** Conteo por regla y por severidad a partir de los hallazgos. */
function tally(findings) {
  const byRule = {}, bySeverity = {};
  for (const s of SEVERITY_ORDER) bySeverity[s] = 0;
  for (const f of findings) {
    byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }
  return { byRule, bySeverity };
}

function sortFindings(findings) {
  const rank = (s) => { const i = SEVERITY_ORDER.indexOf(s); return i < 0 ? SEVERITY_ORDER.length : i; };
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity) || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Construye el Report del contrato con reportSha256 (sha256 del JSON sin ese campo) y la advertencia fija.
 * @param {{root:string, mode:string, findings:object[], stats?:object, skipped?:object[], warnings?:string[],
 *   version:string, rulesVersion:string, commit?:string, lang?:string, now?:Date}} input
 */
export function buildReport({ root, mode, findings = [], stats = {}, skipped = [], warnings = [], version, rulesVersion, commit, lang = 'es', now = new Date() }) {
  const t = makeT(lang);
  const clean = sortFindings(findings.map(sanitizeFinding));
  const fixed = t('report.noFindingsNoGuarantee');
  const allWarnings = warnings.includes(fixed) ? [...warnings] : [...warnings, fixed];
  const report = {
    tool: 'bot-secure', version, rulesVersion, commit: commit ?? undefined,
    generatedAt: now.toISOString(), root: String(root).replace(/\\/g, '/'), mode,
    findings: clean,
    stats: { files: 0, bytes: 0, ms: 0, ...stats, ...tally(clean) },
    skipped, warnings: allWarnings,
  };
  report.reportSha256 = sha256(JSON.stringify(report));
  return report;
}

/** Verifica la integridad de un reporte leído de disco. */
export function verifyReport(report) {
  const { reportSha256, ...rest } = report;
  return !!reportSha256 && sha256(JSON.stringify(rest)) === reportSha256;
}

/**
 * Escribe report.<formato> en `dir`. Devuelve las rutas escritas.
 * @param {object} report
 * @param {{dir?:string, formats?:('json'|'md'|'sarif')[], lang?:string}} opts
 */
export function writeReports(report, { dir, formats = ['json', 'md', 'sarif'], lang = 'es' } = {}) {
  const outDir = dir ?? join(report.root, '.bot-secure', 'reports');
  const paths = [];
  for (const format of formats) {
    const p = join(outDir, `report.${format}`);
    if (format === 'json') writeText(p, JSON.stringify(report, null, 2) + '\n');
    else if (format === 'md') writeText(p, toMarkdown(report, { lang }));
    else if (format === 'sarif') writeText(p, JSON.stringify(toSarif(report), null, 2) + '\n');
    else throw new BotSecureError('report.unknownFormat', { vars: { format }, fix: 'bot-secure scan --format json,md,sarif' });
    paths.push(p);
  }
  return paths;
}

/** Escapa un texto para celda de tabla markdown. */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function remediationText(f, t) {
  const r = f.remediation ?? {};
  const parts = [r.action, r.envVar ? `\`${r.envVar}\`` : null, r.stackRefactor];
  if (f.reachable === false) parts.push(t('report.md.rotateUnreachable'));
  return parts.filter(Boolean).join(' · ');
}

/** Reporte en markdown (español por defecto). */
export function toMarkdown(report, { lang = 'es' } = {}) {
  const t = makeT(lang);
  const L = [];
  L.push(`# ${t('report.md.title')}`, '');
  L.push(`- ${t('report.md.root')}: \`${report.root}\``);
  L.push(`- ${t('report.md.mode')}: ${report.mode}`);
  L.push(`- ${t('report.md.generatedAt')}: ${report.generatedAt}`);
  L.push(`- ${t('report.md.version')}: ${report.version} · ${t('report.md.rulesVersion')}: ${report.rulesVersion}${report.commit ? ` · ${t('report.md.commit')}: ${report.commit}` : ''}`);
  L.push(`- ${t('report.md.sha')}: \`${report.reportSha256 ?? ''}\``);
  const s = report.stats ?? {};
  L.push(`- ${t('report.md.stats', { files: s.files ?? 0, bytes: s.bytes ?? 0, ms: s.ms ?? 0 })}`, '');

  L.push(`## ${t('report.md.summary')}`, '', `| ${t('report.md.severity')} | ${t('report.md.count')} |`, '|---|---:|');
  for (const sev of SEVERITY_ORDER) L.push(`| ${sev} | ${s.bySeverity?.[sev] ?? 0} |`);
  L.push('');

  L.push(`## ${t('report.md.findings')}`, '');
  const findings = report.findings ?? [];
  if (!findings.length) L.push(t('report.md.noFindings'), '');
  else {
    L.push(`| ${t('report.md.severity')} | ${t('report.md.file')} | ${t('report.md.type')} | ${t('report.md.mask')} | ${t('report.md.remediation')} |`, '|---|---|---|---|---|');
    for (const f of findings) {
      const loc = `${f.file}:${f.line}${f.reachable === false ? ` (${t('report.md.unreachable')})` : ''}`;
      L.push(`| ${f.severity} | ${cell(loc)} | ${cell(`${f.category}/${f.ruleId}`)} | ${cell(f.masked)} | ${cell(remediationText(f, t))} |`);
    }
    L.push('', `## ${t('report.md.checklist')}`, '');
    for (const f of findings) {
      const env = f.remediation?.envVar ? ` (\`${f.remediation.envVar}\`)` : '';
      L.push(`- [ ] ${t('report.md.rotated')} · [ ] ${t('report.md.movedToEnv')}${env} · [ ] ${t('report.md.emptyField')} — \`${cell(f.file)}:${f.line}\` ${f.ruleId} \`${f.fingerprint}\``);
    }
    L.push('');
  }

  L.push(`## ${t('report.md.notScanned')}`, '');
  const skipped = report.skipped ?? [];
  if (!skipped.length) L.push(t('report.md.nothingSkipped'), '');
  else {
    L.push(`| ${t('report.md.path')} | ${t('report.md.reason')} | ${t('report.md.size')} |`, '|---|---|---:|');
    for (const sk of skipped) L.push(`| ${cell(sk.path)} | ${cell(sk.reason)} | ${sk.size ?? ''} |`);
    L.push('');
  }

  L.push(`## ${t('report.md.warnings')}`, '');
  for (const w of report.warnings ?? []) L.push(`- ${w}`);
  L.push('');
  return L.join('\n');
}

/** SARIF 2.1.0 mínimo válido: rules en el driver, results con level y locations. Sin valores. */
export function toSarif(report) {
  const rulesIdx = new Map();
  const rules = [];
  for (const f of report.findings ?? []) {
    if (rulesIdx.has(f.ruleId)) continue;
    rulesIdx.set(f.ruleId, rules.length);
    rules.push({
      id: f.ruleId, name: f.ruleId,
      shortDescription: { text: `${f.category}: ${f.ruleId}` },
      defaultConfiguration: { level: SARIF_LEVEL[f.severity] ?? 'warning' },
      properties: { category: f.category, severity: f.severity, remediation: f.remediation?.kind ?? null },
    });
  }
  const results = (report.findings ?? []).map((f) => {
    const region = { startLine: Math.max(1, Number(f.line) || 1) };
    if (f.column) region.startColumn = Math.max(1, Number(f.column));
    return {
      ruleId: f.ruleId, ruleIndex: rulesIdx.get(f.ruleId),
      level: SARIF_LEVEL[f.severity] ?? 'warning',
      message: { text: `${f.category} ${f.ruleId}: ${f.masked}${f.remediation?.action ? ` — ${f.remediation.action}` : ''}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: String(f.file).replace(/\\/g, '/'), uriBaseId: '%SRCROOT%' }, region } }],
      partialFingerprints: { 'bot-secure/v1': f.fingerprint },
      properties: { severity: f.severity, masked: f.masked, reachable: f.reachable ?? true, source: f.source ?? 'native' },
    };
  });
  return {
    $schema: SARIF_SCHEMA, version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'bot-secure', version: report.version, semanticVersion: report.version, informationUri: HOME, rules } },
      originalUriBaseIds: { '%SRCROOT%': { uri: toFileUri(report.root) } },
      invocations: [{ executionSuccessful: true, endTimeUtc: report.generatedAt }],
      results,
      properties: { mode: report.mode, rulesVersion: report.rulesVersion, reportSha256: report.reportSha256, warnings: report.warnings },
    }],
  };
}

function toFileUri(root) {
  try { const u = pathToFileURL(root).href; return u.endsWith('/') ? u : u + '/'; } catch { return 'file:///'; }
}
