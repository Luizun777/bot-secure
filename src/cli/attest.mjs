// `bot-secure attest [--rotation-id <ticket>]`: manifiesto de evidencia para Seguridad.
// Reúne el sha256 del último reporte, el commit de cada app, las versiones, el resultado de
// `doctor --json` y el firmante (con el correo enmascarado). Nunca incluye valores ni PII en claro.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { git, run } from '../lib/exec.mjs';
import { sha256, writeText } from '../lib/fsx.mjs';
import { findGitRoot, findWorkspaceRoot } from '../lib/paths.mjs';
import { readLock, verifyIntegrity } from '../policy/lock.mjs';
import { RULES_VERSION } from '../engine/index.mjs';
import { list as baselineList } from '../engine/baseline.mjs';
import { detectClaudeInstall, maskEmail } from '../detect/index.mjs';
import { collect as doctorCollect, exitFor, globalState } from './doctor.mjs';
import { safePolicy, REPORTS_DIR } from './scan.mjs';

export const ATTEST_DIR = join('.bot-secure', 'attest');
const posix = (p) => String(p).split(sep).join('/');

/** Correos y valores con forma de PII fuera de la evidencia: siempre enmascarados. */
export function scrub(text) {
  return String(text ?? '').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m));
}

/**
 * Diagnóstico para la evidencia: se llama a `collect()` de doctor por import (sin spawn) y se
 * guarda solo el estado de cada fila, con los mensajes ya saneados.
 */
export async function doctorReport(ctx, { root, policy }) {
  try {
    const { rows } = await doctorCollect(ctx, { root, policy, writeLocal: false });
    const state = globalState(rows);
    return {
      available: true, state, exitCode: exitFor(state),
      rows: rows.map((r) => ({ id: r.id, state: r.state, message: scrub(r.message), fix: r.fix ? scrub(r.fix) : null })),
    };
  } catch (e) {
    return { available: true, error: e?.key ?? e?.message ?? String(e) };
  }
}

/** Commit, rama y estado de cada app declarada en la política (más la raíz). */
export function appCommits(root, policy) {
  const apps = (policy.apps ?? []).map((a) => ({ name: a.name, path: posix(a.path ?? '.') }));
  if (!apps.length) apps.push({ name: policy.project ?? 'root', path: '.' });
  return apps.map((a) => {
    const cwd = join(root, a.path);
    const head = git(['rev-parse', 'HEAD'], { cwd });
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const dirty = git(['status', '--porcelain'], { cwd });
    return {
      name: a.name, path: a.path,
      commit: head.status === 0 ? head.stdout.trim() : null,
      branch: branch.status === 0 ? branch.stdout.trim() : null,
      dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : null,
    };
  });
}

/** Firmante: git config user.name / user.email (el correo SIEMPRE enmascarado). */
export function signer(root) {
  const name = git(['config', '--get', 'user.name'], { cwd: root });
  const email = git(['config', '--get', 'user.email'], { cwd: root });
  const raw = email.status === 0 ? email.stdout.trim() : '';
  return { name: name.status === 0 ? name.stdout.trim() || null : null, emailMasked: raw ? maskEmail(raw) : null };
}

/** Datos del último reporte (sha256 del archivo tal cual está en disco). */
export function reportEvidence(root) {
  const rel = join(REPORTS_DIR, 'report.json');
  const abs = join(root, rel);
  if (!existsSync(abs)) return { path: posix(rel), present: false };
  const buf = readFileSync(abs);
  let parsed = null;
  try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = null; }
  return {
    path: posix(rel), present: true, sha256: sha256(buf),
    reportSha256: parsed?.reportSha256 ?? null,
    generatedAt: parsed?.generatedAt ?? null,
    mode: parsed?.mode ?? null,
    findings: parsed?.findings?.length ?? null,
    bySeverity: parsed?.stats?.bySeverity ?? null,
    rulesVersion: parsed?.rulesVersion ?? null,
  };
}

function nodeVersions() {
  const claude = detectClaudeInstall();
  return {
    bot: null, rules: RULES_VERSION, node: process.version, os: `${process.platform}/${process.arch}`,
    claudeCode: claude?.version ?? null, claudeCli: claude?.cli ?? null,
    git: (() => { const r = run('git', ['--version']); return r.status === 0 ? r.stdout.trim() : null; })(),
  };
}

export default {
  name: 'attest',
  aliases: [],
  advanced: true,
  hidden: false,
  summary: {
    es: 'Escribe el manifiesto de evidencia (hashes, commits, versiones, doctor, firmante)',
    en: 'Write the evidence manifest (hashes, commits, versions, doctor, signer)',
  },
  usage: {
    es: 'bot-secure attest [--rotation-id SEC-123] [--json] [--dry-run]',
    en: 'bot-secure attest [--rotation-id SEC-123] [--json] [--dry-run]',
  },
  async run(ctx) {
    const { log, t } = ctx;
    const root = findWorkspaceRoot(ctx.cwd) ?? findGitRoot(ctx.cwd);
    if (!root) throw new BotSecureError('cli-tools.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
    const policy = safePolicy(root);
    const report = reportEvidence(root);
    if (!report.present) log.warn(t('cli-tools.attestNoReport'));

    const versions = nodeVersions();
    versions.bot = ctx.version ?? ctx.pkg?.version ?? null;
    const lock = readLock(root);
    let integrity = { ok: null, drift: [] };
    try { integrity = verifyIntegrity(root); } catch { integrity = { ok: null, drift: [] }; }
    let baseline = { entries: 0, pending: 0 };
    try {
      const entries = baselineList(root);
      baseline = { entries: entries.length, pending: entries.filter((e) => e.status === 'pending').length };
    } catch { /* baseline corrupto: no debe tumbar la evidencia */ }

    const now = new Date();
    const manifest = {
      tool: 'bot-secure', kind: 'attestation', version: 1,
      generatedAt: now.toISOString(),
      project: policy.project ?? null,
      profile: policy.profile ?? null,
      rotationId: typeof ctx.flags['rotation-id'] === 'string' ? ctx.flags['rotation-id'] : null,
      report,
      apps: appCommits(root, policy),
      versions,
      lock: { present: !!lock, rulesVersion: lock?.rulesVersion ?? null, claudeCodeMin: lock?.claudeCodeMin ?? null, generated: lock?.generated?.length ?? 0 },
      integrity: { ok: integrity.ok, drift: (integrity.drift ?? []).map((d) => posix(d.path)) },
      baseline,
      doctor: await doctorReport(ctx, { root, policy }),
      signer: signer(root),
    };
    manifest.manifestSha256 = sha256(JSON.stringify(manifest));

    const stamp = now.toISOString().slice(0, 10);
    let rel = join(ATTEST_DIR, `${stamp}.json`);
    if (existsSync(join(root, rel))) rel = join(ATTEST_DIR, `${stamp}-${now.toISOString().slice(11, 19).replace(/:/g, '')}.json`);
    const abs = join(root, rel);

    if (ctx.dryRun) {
      log.info(t('cli-tools.dryRun'));
      log.info(t('cli-tools.attestWould', { path: posix(rel) }));
      log.data({ command: 'attest', path: posix(rel), dryRun: true, manifest });
      return EXIT.OK;
    }
    writeText(abs, JSON.stringify(manifest, null, 2) + '\n');
    log.ok(t('cli-tools.attestWritten', { path: posix(relative(root, abs)) }));
    if (manifest.rotationId) log.info(t('cli-tools.attestRotation', { id: manifest.rotationId }));
    if (manifest.doctor.error) log.warn(t('cli-tools.doctorFailed', { message: manifest.doctor.error }));
    if (lock && integrity.ok === false) log.warn(t('cli-tools.attestDrift', { count: manifest.integrity.drift.length }));
    log.info(t('cli-tools.attestNext'));
    log.data({ command: 'attest', path: posix(relative(root, abs)), manifestSha256: manifest.manifestSha256, reportSha256: report.sha256 ?? null, rotationId: manifest.rotationId });
    return EXIT.OK;
  },
};
