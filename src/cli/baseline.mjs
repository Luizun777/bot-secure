// `bot-secure baseline <add|list|expire|approve>`: excepciones aceptadas del escáner.
// Solo huellas (nunca valores). LOW/MEDIUM se aceptan localmente; HIGH y CRITICAL exigen
// `--reason` y la aprobación de una segunda persona.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { add, approve, expire, list } from '../engine/baseline.mjs';
import { REPORTS_DIR } from './scan.mjs';

const SUBS = ['add', 'list', 'expire', 'approve'];
const HIGH = new Set(['HIGH', 'CRITICAL']);

/** Raíz del workspace (o del repo git) donde vive `.bot-secure/baseline.json`. */
function baselineRoot(ctx) {
  const root = findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd);
  if (!root) throw new BotSecureError('cli-tools.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  return root;
}

/** Hallazgo del último reporte con esa huella (para conocer severidad, regla y archivo). */
export function findingFor(root, fp) {
  const p = join(root, REPORTS_DIR, 'report.json');
  if (!existsSync(p)) return null;
  try {
    const report = JSON.parse(readFileSync(p, 'utf8'));
    return (report.findings ?? []).find((f) => f.fingerprint === fp || f.id === fp) ?? null;
  } catch { return null; }
}

function requireFingerprint(ctx, sub) {
  const fp = ctx.args[1];
  if (!fp) throw new BotSecureError('cli-tools.baselineNoFingerprint', { vars: { sub }, fix: 'bot-secure scan --json', exitCode: EXIT.ERROR });
  return String(fp);
}

function flagString(ctx, name) {
  const v = ctx.flags[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function cmdAdd(ctx, root) {
  const { log, t } = ctx;
  const fp = requireFingerprint(ctx, 'add');
  const finding = findingFor(root, fp);
  const severity = (flagString(ctx, 'severity') ?? finding?.severity ?? null);
  const sev = severity ? String(severity).toUpperCase() : null;
  const reason = flagString(ctx, 'reason');
  const by = flagString(ctx, 'by') ?? process.env.USER ?? process.env.USERNAME ?? 'unknown';
  const expiresAt = flagString(ctx, 'expires');

  if (sev && HIGH.has(sev) && !reason) {
    throw new BotSecureError('cli-tools.reasonRequired', { vars: { fp, severity: sev }, fix: `bot-secure baseline add ${fp} --reason "por qué es aceptable" --by tu.nombre --expires 2026-12-31`, exitCode: EXIT.ERROR });
  }
  if (ctx.dryRun) {
    log.info(t('cli-tools.dryRun'));
    log.data({ command: 'baseline add', fingerprint: fp, severity: sev, reason, by, expiresAt, dryRun: true });
    return EXIT.OK;
  }
  const entry = add(root, fp, {
    reason, by, expiresAt, severity: sev,
    ruleId: finding?.ruleId, file: finding?.file,
  });
  log.ok(t('cli-tools.baselineAdded', { fp, severity: sev ?? '—', by: entry.by }));
  if (entry.expiresAt) log.info(t('cli-tools.baselineExpires', { date: entry.expiresAt.slice(0, 10) }));
  else log.warn(t('cli-tools.baselineNoExpiry'));
  if (entry.needsSecondApproval) log.warn(t('cli-tools.secondPerson', { fp }));
  log.info(t('cli-tools.nextScan'));
  log.data({ command: 'baseline add', ...entry });
  return EXIT.OK;
}

async function cmdList(ctx, root) {
  const { log, t } = ctx;
  const entries = list(root);
  if (!entries.length) {
    log.info(t('cli-tools.baselineEmpty'));
    log.data({ command: 'baseline list', entries: [] });
    return EXIT.OK;
  }
  const rows = [[t('cli-tools.colFingerprint'), t('cli-tools.colStatus'), t('cli-tools.colSeverity'), t('cli-tools.colBy'), t('cli-tools.colReason')]];
  for (const e of entries) rows.push([e.fingerprint, e.status, e.severity ?? '—', e.by, e.reason ?? '—']);
  log.table(rows);
  const pending = entries.filter((e) => e.status === 'pending');
  if (pending.length) log.warn(t('cli-tools.pendingApprovals', { count: pending.length }));
  log.data({ command: 'baseline list', entries });
  return EXIT.OK;
}

async function cmdExpire(ctx, root) {
  const { log, t } = ctx;
  const fp = requireFingerprint(ctx, 'expire');
  if (ctx.dryRun) {
    log.info(t('cli-tools.dryRun'));
    log.data({ command: 'baseline expire', fingerprint: fp, dryRun: true });
    return EXIT.OK;
  }
  const entry = expire(root, fp);
  log.ok(t('cli-tools.baselineExpired', { fp }));
  log.info(t('cli-tools.nextScan'));
  log.data({ command: 'baseline expire', ...entry });
  return EXIT.OK;
}

async function cmdApprove(ctx, root) {
  const { log, t } = ctx;
  const fp = requireFingerprint(ctx, 'approve');
  const by = flagString(ctx, 'by');
  if (!by) throw new BotSecureError('cli-tools.approveNeedsBy', { vars: { fp }, fix: `bot-secure baseline approve ${fp} --by otra.persona`, exitCode: EXIT.ERROR });
  if (ctx.dryRun) {
    log.info(t('cli-tools.dryRun'));
    log.data({ command: 'baseline approve', fingerprint: fp, by, dryRun: true });
    return EXIT.OK;
  }
  const entry = approve(root, fp, { by });
  log.ok(t('cli-tools.baselineApproved', { fp, by: entry.approvedBy }));
  log.data({ command: 'baseline approve', ...entry });
  return EXIT.OK;
}

export default {
  name: 'baseline',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Acepta falsos positivos por huella: add, list, expire, approve (HIGH+ exige segunda persona)',
    en: 'Accept false positives by fingerprint: add, list, expire, approve (HIGH+ needs a second person)',
  },
  usage: {
    es: 'bot-secure baseline <add <huella> --reason "…" [--by nombre] [--expires 2026-12-31] [--severity HIGH] | list | expire <huella> | approve <huella> --by otra.persona>',
    en: 'bot-secure baseline <add <fingerprint> --reason "…" [--by name] [--expires 2026-12-31] [--severity HIGH] | list | expire <fingerprint> | approve <fingerprint> --by another.person>',
  },
  async run(ctx) {
    const sub = ctx.args[0] ?? 'list';
    if (!SUBS.includes(sub)) {
      throw new BotSecureError('cli-tools.unknownSub', { vars: { sub, subs: SUBS.join('|') }, fix: 'bot-secure baseline list', exitCode: EXIT.ERROR });
    }
    const root = baselineRoot(ctx);
    if (sub === 'add') return cmdAdd(ctx, root);
    if (sub === 'expire') return cmdExpire(ctx, root);
    if (sub === 'approve') return cmdApprove(ctx, root);
    return cmdList(ctx, root);
  },
};
