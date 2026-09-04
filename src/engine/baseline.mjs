// Baseline de supresiones: .bot-secure/baseline.json. Solo fingerprints (nunca valores).
// Escalonado: LOW/MEDIUM se suprimen localmente; HIGH/CRITICAL exigen reason y segunda aprobación.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from '../lib/fsx.mjs';
import { BotSecureError } from '../lib/errors.mjs';

export const BASELINE_FILE = join('.bot-secure', 'baseline.json');
export const BASELINE_VERSION = 1;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const FP_RE = /^[0-9a-f]{16}$/;

/**
 * @typedef {{fingerprint:string, ruleId?:string, file?:string, reason:string|null, by:string, at:string,
 *   expiresAt:string|null, severity:string|null, needsSecondApproval:boolean, approvedBy?:string|null, approvedAt?:string|null}} BaselineEntry
 * @typedef {{version:number, entries:BaselineEntry[]}} Baseline
 */

function baselinePath(root) { return join(root, BASELINE_FILE); }
function emptyBaseline() { return { version: BASELINE_VERSION, entries: [] }; }
function iso(d) { return (d instanceof Date ? d : new Date(d)).toISOString(); }

/** Convierte a Date válida o lanza error con arreglo. */
function parseDate(value, fp) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BotSecureError('report.badDate', { vars: { value: String(value) }, fix: `bot-secure baseline add ${fp} --expires 2026-12-31` });
  }
  return d;
}

/** Lee el baseline; si no existe devuelve uno vacío. Estructura inválida → error con arreglo. */
export function loadBaseline(root) {
  const p = baselinePath(root);
  if (!existsSync(p)) return emptyBaseline();
  let data;
  try { data = readJson(p); } catch { data = null; }
  if (!data || !Array.isArray(data.entries)) {
    throw new BotSecureError('report.baselineCorrupt', { vars: { path: p }, fix: `mv "${p}" "${p}.bak" && bot-secure baseline list` });
  }
  return { version: data.version ?? BASELINE_VERSION, entries: data.entries };
}

function saveBaseline(root, baseline) { writeJson(baselinePath(root), baseline); }

/** ¿La entrada está vigente en `now`? Expirada = no suprime. */
export function isActive(entry, now = new Date()) {
  if (!entry) return false;
  if (!entry.expiresAt) return true;
  return new Date(entry.expiresAt).getTime() > new Date(now).getTime();
}

/**
 * ¿Está suprimido el hallazgo? Coincide por fingerprint (o id); una entrada expirada NO suprime.
 * @param {{fingerprint?:string, id?:string}} finding
 * @param {Baseline} baseline
 * @param {Date|string|number} [now]
 */
export function isSuppressed(finding, baseline, now = new Date()) {
  const fp = finding?.fingerprint ?? finding?.id;
  if (!fp || !baseline?.entries) return false;
  return baseline.entries.some((e) => e.fingerprint === fp && isActive(e, now));
}

/**
 * Añade (o reemplaza) una supresión. HIGH/CRITICAL exigen `reason` y quedan con needsSecondApproval:true.
 * @param {string} root
 * @param {string} fp fingerprint (16 hex)
 * @param {{reason?:string, by?:string, expiresAt?:string|Date|null, severity?:string, ruleId?:string, file?:string, now?:Date}} opts
 * @returns {BaselineEntry}
 */
export function add(root, fp, { reason = null, by, expiresAt = null, severity = null, ruleId, file, now = new Date() } = {}) {
  if (!FP_RE.test(String(fp))) {
    throw new BotSecureError('report.badFingerprint', { vars: { fp: String(fp) }, fix: 'bot-secure scan --json | node -e "…" (copia el campo fingerprint del hallazgo)' });
  }
  const sev = severity ? String(severity).toUpperCase() : null;
  if (sev && !SEVERITIES.includes(sev)) {
    throw new BotSecureError('report.badSeverity', { vars: { severity: String(severity) }, fix: `bot-secure baseline add ${fp} --severity HIGH` });
  }
  const high = sev === 'HIGH' || sev === 'CRITICAL';
  const cleanReason = reason ? String(reason).trim() : '';
  if (high && !cleanReason) {
    throw new BotSecureError('report.reasonRequired', { vars: { fp, severity: sev }, fix: `bot-secure baseline add ${fp} --reason "por qué es aceptable"` });
  }
  const entry = {
    fingerprint: fp,
    ruleId: ruleId ?? undefined,
    file: file ?? undefined,
    reason: cleanReason || null,
    by: by || process.env.USER || process.env.USERNAME || 'unknown',
    at: iso(now),
    expiresAt: expiresAt ? iso(parseDate(expiresAt, fp)) : null,
    severity: sev,
    needsSecondApproval: high,
    approvedBy: null,
    approvedAt: null,
  };
  const baseline = loadBaseline(root);
  baseline.entries = baseline.entries.filter((e) => e.fingerprint !== fp);
  baseline.entries.push(entry);
  saveBaseline(root, baseline);
  return entry;
}

/** Marca la supresión como expirada ahora (deja rastro; no borra). */
export function expire(root, fp, { now = new Date() } = {}) {
  const baseline = loadBaseline(root);
  const entry = baseline.entries.find((e) => e.fingerprint === fp);
  if (!entry) throw new BotSecureError('report.baselineNotFound', { vars: { fp }, fix: 'bot-secure baseline list' });
  entry.expiresAt = iso(now);
  saveBaseline(root, baseline);
  return entry;
}

/** Registra la segunda aprobación (otra persona) de una supresión HIGH/CRITICAL. */
export function approve(root, fp, { by, now = new Date() } = {}) {
  const baseline = loadBaseline(root);
  const entry = baseline.entries.find((e) => e.fingerprint === fp);
  if (!entry) throw new BotSecureError('report.baselineNotFound', { vars: { fp }, fix: 'bot-secure baseline list' });
  if (!by || by === entry.by) {
    throw new BotSecureError('report.secondPersonRequired', { vars: { fp, by: entry.by }, fix: `bot-secure baseline approve ${fp} --by <otra-persona>` });
  }
  entry.approvedBy = by; entry.approvedAt = iso(now);
  saveBaseline(root, baseline);
  return entry;
}

/**
 * Lista las entradas con su estado: 'active' | 'expired' | 'pending' (HIGH+ sin segunda aprobación).
 * @returns {(BaselineEntry & {status:string})[]}
 */
export function list(root, { now = new Date() } = {}) {
  return loadBaseline(root).entries.map((e) => ({
    ...e,
    status: !isActive(e, now) ? 'expired' : (e.needsSecondApproval && !e.approvedBy ? 'pending' : 'active'),
  }));
}

/** Entradas HIGH/CRITICAL vigentes sin segunda aprobación (para el check de CI). */
export function pendingApprovals(baseline, now = new Date()) {
  return (baseline?.entries ?? []).filter((e) => isActive(e, now) && e.needsSecondApproval && !e.approvedBy);
}
