// API pública del motor: scanText (con worker + timeout en guard) y scanPaths (Report del contrato).
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import PKG_JSON from '../../package.json' with { type: 'json' };
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { BotSecureError } from '../lib/errors.mjs';
import { readJson } from '../lib/fsx.mjs';
import { git } from '../lib/exec.mjs';
import { decode, keystoreMagic } from './encoding.mjs';
import { loadHmacKey } from './fingerprint.mjs';
import { loadBaseline, isSuppressed } from './baseline.mjs';
import { buildReport } from './report.mjs';
import { RULES_VERSION, compiledRules, fileFinding, fileRulesFor, finalize, loadRules, scanContent } from './rules.mjs';
import { collect } from './walker.mjs';
import { finalSeverity, isTestPath } from './severity.mjs';

export { RULES_VERSION, loadRules } from './rules.mjs';
export { writeReports, buildReport, toMarkdown, toSarif, verifyReport } from './report.mjs';
export { collect } from './walker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'worker.mjs');
const CHUNK = 1024 * 1024;
const OVERLAP = 512;

/** El escaneo excedió el presupuesto de tiempo: en guard se traduce en `deny` (fail-closed). */
export class ScanTimeout extends Error {
  constructor(ms, path) {
    super(`scan timeout after ${ms}ms`);
    this.name = 'ScanTimeout';
    this.key = 'engine.scanTimeout';
    this.vars = { ms, path: path ?? '' };
    this.fix = 'bot-secure scan --exclude "<ruta>"';
  }
}

let PKG = null;
/** Versión del paquete (para el encabezado del reporte). */
function version() {
  if (PKG) return PKG;
  PKG = PKG_JSON.version ?? '0.0.0';
  return PKG;
}

const posix = (p) => String(p).split(sep).join('/');

/**
 * Escanea un texto suelto (prompt, diff, contenido de un Edit…).
 * En `guard` corre en un worker con presupuesto de tiempo: si vence lanza `ScanTimeout`.
 * @param {string} text
 * @param {{path?:string, mode?:'scan'|'guard'|'ci'|'pre-commit', hmacKey?:Buffer, root?:string,
 *   maxMs?:number, lang?:string, worker?:boolean}} [opts]
 * @returns {Promise<object[]>} hallazgos ya enmascarados
 */
export async function scanText(text, { path = '', mode = 'scan', hmacKey, root = process.cwd(), maxMs = 150, lang = 'es', worker } = {}) {
  const key = hmacKey ?? loadHmacKey(root);
  // Sin worker.mjs en disco (guard empaquetado con esbuild) se escanea en línea: nunca se deja de escanear.
  const useWorker = (worker ?? (mode === 'guard')) && existsSync(WORKER);
  if (!useWorker) {
    const raw = await scanContent(text, { path, mode, lang });
    return finalize(raw, { hmacKey: key, lang });
  }
  return runInWorker({ text, path, mode, lang, hmacKey: key }, maxMs);
}

/** Ejecuta el pipeline en un worker; el reloj arranca cuando el worker avisa que ya cargó. */
function runInWorker(data, maxMs) {
  return new Promise((res, rej) => {
    let w;
    try { w = new Worker(WORKER, { workerData: data }); } catch (e) { rej(e); return; }
    let timer = null;
    const done = (fn, arg) => { if (timer) clearTimeout(timer); w.terminate().catch(() => { /* ya terminado */ }); fn(arg); };
    w.on('message', (msg) => {
      if (msg?.ready) { timer = setTimeout(() => done(rej, new ScanTimeout(maxMs, data.path)), maxMs); return; }
      if (msg?.ok) done(res, msg.findings);
      else done(rej, new BotSecureError(msg?.error?.key ?? 'engine.workerFailed', { vars: { path: data.path, message: msg?.error?.message ?? '' }, fix: msg?.error?.fix ?? 'bot-secure scan --json' }));
    });
    w.on('error', (err) => done(rej, err));
    w.on('exit', (code) => { if (code !== 0 && timer) done(rej, new BotSecureError('engine.workerFailed', { vars: { path: data.path, message: `exit ${code}` }, fix: 'bot-secure scan --json' })); });
  });
}

/**
 * Escaneo completo de un árbol de archivos (y, opcionalmente, de la historia git).
 * @param {object} opts
 * @param {string} opts.root raíz del repositorio/workspace
 * @param {string[]} [opts.paths] subrutas concretas
 * @param {'scan'|'guard'|'ci'|'pre-commit'} [opts.mode='scan']
 * @param {string[]} [opts.include] globs a incluir
 * @param {string[]} [opts.exclude] globs a excluir
 * @param {boolean} [opts.history] escanear todos los blobs del ODB
 * @param {boolean} [opts.build] incluir artefactos de compilación
 * @param {boolean} [opts.full] sin límite de tamaño
 * @param {object} [opts.baseline] baseline ya cargado (si falta se lee del root)
 * @param {Buffer} [opts.hmacKey]
 * @param {object[]} [opts.apps] apps de policy.json (para etiquetar hallazgos)
 * @param {number} [opts.maxFileSizeMB=1]
 * @param {string} [opts.lang='es']
 * @returns {Promise<object>} Report del contrato
 */
export async function scanPaths({ root, paths = [], mode = 'scan', include = [], exclude = [], history = false,
  build = false, full = false, baseline, hmacKey, apps = [], maxFileSizeMB = 1, lang = 'es', since, now } = {}) {
  if (!root) throw new BotSecureError('engine.noRoot', { fix: 'bot-secure scan --root .' });
  const rootAbs = resolve(root);
  const t0 = Date.now();
  const key = hmacKey ?? loadHmacKey(rootAbs);
  compiledRules(); // falla pronto si una regla está mal escrita

  const walked = collect({ root: rootAbs, paths, include, exclude, build, full, maxFileSizeMB });
  const skipped = [...walked.skipped];
  const warnings = [];
  const raw = [];
  let bytes = 0, scannedFiles = 0;

  for (const file of walked.files) {
    let buf;
    try { buf = file.stream ? readHead(file.abs, CHUNK) : readFileSync(file.abs); } catch { skipped.push({ path: file.rel, reason: 'unreadable', size: file.size }); continue; }
    bytes += file.stream ? file.size : buf.length;

    const magic = keystoreMagic(buf);
    const dec = file.stream ? { text: '', binary: false, encoding: 'utf8' } : decode(buf);
    if (magic && /\.(p12|pfx|jks|keystore|bks)$/i.test(file.rel)) {
      const rule = loadRules().find((r) => r.id === 'pkcs12-keystore');
      if (rule) raw.push({ ...fileFinding(rule, file.rel), reason: magic });
      skipped.push({ path: file.rel, reason: 'binary-keystore', size: file.size });
      continue;
    }
    if (dec.binary) { skipped.push({ path: file.rel, reason: 'binary', size: file.size }); continue; }

    scannedFiles++;
    if (file.stream) {
      skipped.push({ path: file.rel, reason: 'streamed', size: file.size });
      raw.push(...await scanStream(file, mode, lang));
      for (const rule of fileRulesFor(file.rel, buf.toString('utf8'))) raw.push(fileFinding(rule, file.rel));
      continue;
    }
    for (const rule of fileRulesFor(file.rel, dec.text)) raw.push(fileFinding(rule, file.rel));
    raw.push(...await scanContent(dec.text, { path: file.rel, mode, lang }));
  }

  // enlaces simbólicos que escapan del repositorio
  const symRule = loadRules().find((r) => r.id === 'symlink-outside-repo');
  if (symRule) {
    for (const s of walked.symlinks.filter((x) => x.outside)) {
      raw.push({
        ruleId: symRule.id, category: 'file', severity: finalSeverity(symRule.severity, { inTestPath: isTestPath(s.rel) }),
        file: s.rel, line: 1, column: 1, value: `${s.rel}->${s.target}`, maskKind: 'generic',
        remediation: { ...symRule.remediation }, inTestPath: isTestPath(s.rel),
      });
    }
  }

  let findings = finalize(raw, { hmacKey: key, lang });
  const stats = { files: scannedFiles, bytes, ms: 0, dirs: walked.dirs };

  if (history) {
    const { scanHistory } = await import('./adapters/git-history.mjs');
    const hist = await scanHistory({
      root: rootAbs, hmacKey: key, since, mode,
      scanText: async (text, o) => finalize(await scanContent(text, { path: o?.path ?? '', mode, lang }), { hmacKey: key, lang }),
    });
    findings = findings.concat(hist.findings);
    skipped.push(...hist.skipped.map((s) => ({ path: s.path, reason: `history:${s.reason}`, size: s.size })));
    stats.history = hist.stats;
  }

  findings = dedupe(findings);
  if (apps.length) tagApps(findings, apps);

  const base = baseline ?? safeBaseline(rootAbs, warnings);
  if (base) findings = findings.filter((f) => !isSuppressed(f, base));

  for (const w of walked.warnings) warnings.push(w);
  stats.ms = Date.now() - t0;

  return buildReport({
    root: posix(rootAbs), mode, findings, stats, skipped, warnings,
    version: version(), rulesVersion: RULES_VERSION, commit: headCommit(rootAbs), lang, now,
  });
}

/** Baseline tolerante: si está corrupto se avisa y se sigue (nunca se deja de escanear). */
function safeBaseline(root, warnings) {
  try { return loadBaseline(root); } catch (e) { warnings.push(`baseline:${e.key ?? e.message}`); return null; }
}

/** Commit HEAD (o undefined si no hay repo git). */
function headCommit(root) {
  const r = git(['rev-parse', 'HEAD'], { cwd: root });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** Dedupe por (ruleId, fingerprint): el primero gana y el resto se acumula en `occurrences`. */
export function dedupe(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const k = `${f.ruleId}|${f.fingerprint}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...f, occurrences: f.occurrences ?? [{ file: f.file, line: f.line }] }); continue; }
    const occ = f.occurrences ?? [{ file: f.file, line: f.line }];
    for (const o of occ) if (!prev.occurrences.some((p) => p.file === o.file && p.line === o.line)) prev.occurrences.push(o);
    if (f.reachable === true) prev.reachable = true;
  }
  return [...byKey.values()];
}

/** Etiqueta cada hallazgo con la app de `policy.apps` cuya carpeta lo contiene. */
function tagApps(findings, apps) {
  const list = apps.filter((a) => a?.path).map((a) => ({ name: a.name, prefix: posix(a.path).replace(/\/$/, '') + '/' }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  for (const f of findings) { const hit = list.find((a) => f.file.startsWith(a.prefix)); if (hit) f.app = hit.name; }
}

/** Lee como mucho `n` bytes del inicio del archivo (magic bytes y reglas por contenido). */
function readHead(abs, n) {
  const fd = openSync(abs, 'r');
  try { const b = Buffer.alloc(n); const read = readSync(fd, b, 0, n, 0); return b.subarray(0, read); }
  finally { try { closeSync(fd); } catch { /* ya cerrado */ } }
}

/** Escaneo por chunks (1 MB, 512 B de solapamiento) para archivos de datos grandes. */
async function scanStream(file, mode, lang) {
  const out = [];
  let fd;
  try { fd = openSync(file.abs, 'r'); } catch { return out; }
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = 0, lineOffset = 0, tail = '';
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      const text = tail + buf.subarray(0, n).toString('utf8');
      const found = await scanContent(text, { path: file.rel, mode, lang });
      for (const f of found) out.push({ ...f, line: f.line + lineOffset });
      const keep = text.slice(-OVERLAP);
      const consumed = text.slice(0, text.length - keep.length);
      lineOffset += (consumed.match(/\n/g) || []).length;
      tail = keep;
      if (n < CHUNK) break;
    }
  } finally { try { closeSync(fd); } catch { /* ya cerrado */ } }
  return out;
}
