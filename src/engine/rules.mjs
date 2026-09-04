// Carga de reglas (src/engine/rules/*.json) y motor de coincidencias sobre un texto ya decodificado.
// Orden del pipeline: prefiltro de keywords por regla → regex por línea (troceada a 4 KB) → grupo
// secreto → anti-FP → entropía → severidad. Nunca sale de aquí el valor sin enmascarar.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, hasInlineAllow, STRONG_KEY_RE } from './antifp.mjs';
import { isHighEntropy, looksRandom, passesEntropy, shannon } from './entropy.mjs';
import { stripDataUris } from './encoding.mjs';
import { flattenConfig, formatFor, isStrongKey } from './flatten.mjs';
import { adjustJwt, finalSeverity, isBuildArtifact, isTestPath } from './severity.mjs';
import { hmacFingerprint, piiFingerprint } from './fingerprint.mjs';
import { mask } from './masks.mjs';
import { makeT } from '../lib/i18n.mjs';
import { BotSecureError } from '../lib/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(HERE, 'rules');

/** Versión del catálogo de reglas (va en el reporte y en lock.json). */
export const RULES_VERSION = '2026.09.0';

/** Máximo de caracteres por trozo de línea que se pasa a una regex (defensa ReDoS). */
export const MAX_LINE = 4096;
const LINE_OVERLAP = 96;

/** Prioridad por familia: las reglas específicas reclaman el rango antes que las genéricas. */
const PRIORITY = { prefixed: 0, files: 0, connection: 1, k8s: 1, frontend: 1, encrypted: 1, env: 2, config: 3, generic: 4 };
const OVERLAP_FAMILIES = new Set(['env', 'config', 'generic']);

let RULES = null;
let COMPILED = null;
let PII = undefined; // módulo pii-mx.mjs (import dinámico; undefined = sin intentar, null = ausente)

/**
 * Carga todas las reglas de `src/engine/rules/*.json` (memoizado).
 * @returns {object[]} reglas ordenadas por prioridad de familia
 */
export function loadRules() {
  if (RULES) return RULES;
  const out = [];
  for (const f of readdirSync(RULES_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    let body;
    try { body = JSON.parse(readFileSync(join(RULES_DIR, f), 'utf8')); } catch (e) {
      throw new BotSecureError('engine.rulesCorrupt', { vars: { file: f }, fix: `node -e "JSON.parse(require('fs').readFileSync('src/engine/rules/${f}','utf8'))"`, cause: e });
    }
    const rules = Array.isArray(body) ? body : body.rules;
    if (!Array.isArray(rules)) throw new BotSecureError('engine.rulesCorrupt', { vars: { file: f }, fix: `node -e "console.log(Object.keys(require('./src/engine/rules/${f}')))"` });
    for (const r of rules) out.push({ ...r, source: f.replace(/\.json$/, '') });
  }
  out.sort((a, b) => prio(a) - prio(b));
  RULES = out;
  return out;
}

function prio(rule) {
  if (rule.category === 'pii') return 5;
  return PRIORITY[rule.family] ?? 3;
}

/** Reinicia la caché de reglas (pruebas). */
export function resetRules() { RULES = null; COMPILED = null; }

/** Reglas con sus regex ya compiladas (memoizado). */
export function compiledRules() {
  if (COMPILED) return COMPILED;
  COMPILED = loadRules().map((rule) => {
    const c = { rule };
    try {
      if (rule.regex) c.re = new RegExp(rule.regex, uniqueFlags(`${rule.flags ?? ''}g`));
      if (rule.require) c.require = new RegExp(rule.require, uniqueFlags(rule.requireFlags ?? ''));
      if (rule.contentRegex) c.content = new RegExp(rule.contentRegex, uniqueFlags(rule.contentFlags ?? ''));
      c.allow = (rule.allowlist?.regexes ?? []).map((s) => new RegExp(s, 'i'));
    } catch (e) {
      throw new BotSecureError('engine.badRegex', { vars: { rule: rule.id }, fix: `node -e "new RegExp(require('./src/engine/rules/${rule.source}.json').rules.find(r=>r.id==='${rule.id}').regex)"`, cause: e });
    }
    return c;
  });
  return COMPILED;
}

const uniqueFlags = (f) => [...new Set(f.split(''))].join('');

/* --------------------------------------------------------------------- globs */

/** Convierte un glob (`**`, `*`, `?`) en RegExp anclada sobre una ruta posix. */
export function globToRegExp(glob) {
  let out = '';
  const g = String(glob).replace(/\\/g, '/');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        // `**/` = «cero o más directorios»; `**` suelto = cualquier cosa
        if (g[i + 1] === '/') { out += '(?:.*/)?'; i++; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp(`^${out}$`, 'i');
}

const globCache = new Map();
function globMatch(rel, glob) {
  let re = globCache.get(glob);
  if (!re) { re = globToRegExp(glob); globCache.set(glob, re); }
  const p = String(rel).replace(/\\/g, '/');
  return re.test(p) || re.test(`/${p}`);
}

/** ¿La ruta relativa encaja con alguno de los globs? */
export function matchesAny(rel, globs) {
  return Array.isArray(globs) && globs.some((g) => globMatch(rel, g));
}

/* ------------------------------------------------------------------- troceo */

/** Trocea una línea larga en pedazos de ≤ MAX_LINE con solapamiento; devuelve [{text, offset}]. */
export function sliceLine(line) {
  if (line.length <= MAX_LINE) return [{ text: line, offset: 0 }];
  const out = [];
  const step = MAX_LINE - LINE_OVERLAP;
  for (let i = 0; i < line.length; i += step) out.push({ text: line.slice(i, i + MAX_LINE), offset: i });
  return out;
}

/* ----------------------------------------------------------------- hallazgos */

/**
 * @typedef {{ruleId:string, category:string, severity:string, file:string, line:number, column:number,
 *   value:string, maskKind:string, entropy?:number, remediation:object, inTestPath?:boolean,
 *   inBuildArtifact?:boolean, verifiedChecksum?:boolean, reason?:string}} RawFinding
 */

/**
 * Ejecuta todas las reglas sobre un texto ya decodificado.
 * @param {string} text
 * @param {{path?:string, mode?:'scan'|'guard'|'ci'|'pre-commit', lang?:string, rules?:object[]}} [opts]
 * @returns {Promise<RawFinding[]>} hallazgos crudos (aún con `value`; usar `finalize`)
 */
export async function scanContent(text, { path = '', mode = 'scan', lang = 'es' } = {}) {
  const src = String(text ?? '');
  if (!src) return [];
  const rel = String(path).replace(/\\/g, '/');
  const lower = src.toLowerCase();
  const rawLines = src.split(/\r?\n/);
  const genericLines = lower.includes(';base64,') ? stripDataUris(src).split(/\r?\n/) : rawLines;
  const inTest = isTestPath(rel);
  const inBuild = isBuildArtifact(rel);
  const claimed = new Map(); // línea → [[ini, fin]]
  const out = [];

  const push = (f) => { out.push({ inTestPath: inTest, inBuildArtifact: inBuild, ...f }); };

  for (const { rule, re, require: req, allow } of compiledRules()) {
    if (rule.category === 'pii' || rule.filesOnly || rule.scope === 'meta') continue;
    if (rule.paths && !matchesAny(rel, rule.paths)) continue;
    if (rule.notPaths && matchesAny(rel, rule.notPaths)) continue;
    if (rule.keywords?.length && !rule.keywords.some((k) => lower.includes(k))) continue;

    if (rule.scope === 'config') { scanFlattened(src, rel, rule, mode, inTest, inBuild, push, claimed); continue; }
    if (rule.scope === 'k8s') { scanK8sSecret(src, rawLines, rel, rule, mode, inTest, inBuild, push, claimed); continue; }
    if (!re) continue;

    const lines = rule.family === 'generic' ? genericLines : rawLines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (req && !req.test(line)) continue;
      for (const { text: chunk, offset } of sliceLine(line)) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(chunk)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }
          const value = rule.secretGroup != null ? m[rule.secretGroup] : m[0];
          const start = offset + m.index, end = start + m[0].length;
          if (value == null || value === '') continue;
          const f = judge({ rule, allow, value, line: rawLines[i] ?? line, lineNo: i + 1, column: start + 1, rel, mode, inTest, inBuild, name: rule.nameGroup != null ? m[rule.nameGroup] : null });
          if (!f) continue;
          if (OVERLAP_FAMILIES.has(rule.family) && overlaps(claimed, i + 1, start, end)) continue;
          claim(claimed, i + 1, start, end);
          push(f);
        }
      }
    }
  }

  if (mode !== 'scan') collectSuppressionAttempts(rawLines, rel, inTest, inBuild, push);
  await scanPii(src, rawLines, rel, inTest, inBuild, lang, push);
  return out;
}

function claim(map, line, a, b) { const arr = map.get(line) ?? []; arr.push([a, b]); map.set(line, arr); }
function overlaps(map, line, a, b) { return (map.get(line) ?? []).some(([x, y]) => a < y && x < b); }

/**
 * Decide si una coincidencia es hallazgo: anti-FP, entropía, longitud y severidad final.
 * @returns {RawFinding|null}
 */
function judge({ rule, allow, value, line, lineNo, column, rel, mode, inTest, inBuild, name }) {
  const v = String(value);
  if (rule.minLen && v.length < rule.minLen) return null;
  for (const re of allow ?? []) if (re.test(v)) return null;

  const strongKey = STRONG_KEY_RE.test(name ?? '') || STRONG_KEY_RE.test(line ?? '');
  const res = evaluate({ value: v, family: rule.family ?? 'generic', strongKey, lineText: line, mode, rule });
  if (res.drop) return null;

  if (rule.entropy != null && !passesEntropy(v, rule.entropy)) return null;
  if (rule.family === 'frontend' && !(shannon(v) >= 3.5 || looksRandom(v))) return null;

  let severity = rule.severity;
  if (rule.id === 'jwt' || rule.id === 'mapbox-secret-token') severity = adjustJwt(severity, v.replace(/^sk\./, ''), line).severity;
  if (rule.family === 'connection' && !isHighEntropy(v, 8, 2.5)) severity = 'MEDIUM';

  const finding = {
    ruleId: rule.id, category: rule.category, file: rel, line: lineNo, column,
    severity: finalSeverity(severity, { inTestPath: inTest, extraDegrade: res.degrade ?? 0 }),
    value: v, maskKind: rule.maskKind ?? 'generic',
    remediation: { ...(rule.remediation ?? { kind: 'secret' }) },
    inTestPath: inTest, inBuildArtifact: inBuild,
  };
  if (rule.category !== 'pii') finding.entropy = shannon(v);
  if (name && !finding.remediation.envVar) finding.remediation.envVar = envVarFor(name, rule);
  if (res.reason) finding.reason = res.reason;
  return finding;
}

/** Nombre de variable sugerido a partir de la clave detectada. */
function envVarFor(name, rule) {
  const clean = String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!clean) return rule.remediation?.envVar;
  return clean.length > 60 ? clean.slice(0, 60) : clean;
}

/* ------------------------------------------------------- configuración plana */

/** Aplica la regla `config-secret-key` sobre el aplanado de YAML/JSON/TOML/INI/XML/.env. */
function scanFlattened(text, rel, rule, mode, inTest, inBuild, push, claimed) {
  if (!formatFor(rel)) return;
  const lines = text.split(/\r?\n/);
  for (const entry of flattenConfig(text, rel)) {
    if (!isStrongKey(entry.keyPath)) continue;
    const lineText = lines[entry.line - 1] ?? '';
    const f = judge({ rule, allow: [], value: entry.value, line: `${entry.keyPath}: ${entry.value}`, lineNo: entry.line, column: 1, rel, mode, inTest, inBuild, name: entry.keyPath.split('.').pop() });
    if (!f) continue;
    if (overlaps(claimed, entry.line, 0, (lineText.length || 1))) continue;
    claim(claimed, entry.line, 0, lineText.length || 1);
    f.keyPath = entry.keyPath;
    push(f);
  }
}

/* ------------------------------------------------------------ Secret de k8s */

const K8S_KIND_RE = /^\s*kind\s*:\s*["']?Secret["']?\s*$/im;
const K8S_ENTRY_RE = /^\s{2,}([A-Za-z0-9_.-]+)\s*:\s*["']?([A-Za-z0-9+/=]{8,})["']?\s*$/;

/** `kind: Secret` → decodifica `data:` (base64) y evalúa el contenido; `stringData:` va en claro. */
function scanK8sSecret(text, lines, rel, rule, mode, inTest, inBuild, push, claimed) {
  if (!K8S_KIND_RE.test(text)) return;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(data|stringData)\s*:\s*$/.test(line)) { section = /stringData/.test(line) ? 'string' : 'data'; continue; }
    if (/^\S/.test(line)) { section = null; continue; }
    if (!section) continue;
    const m = section === 'data' ? K8S_ENTRY_RE.exec(line) : /^\s{2,}([A-Za-z0-9_.-]+)\s*:\s*["']?([^\s"']{4,})["']?\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (section === 'data') {
      const buf = Buffer.from(value, 'base64');
      if (!buf.length || buf.includes(0)) continue;
      value = buf.toString('utf8');
      if (!/^[\x20-\x7e]+$/.test(value)) continue;
    }
    const f = judge({ rule, allow: [], value, line: `${m[1]}: ${value}`, lineNo: i + 1, column: 1, rel, mode, inTest, inBuild, name: m[1] });
    if (f) { f.keyPath = m[1]; claim(claimed, i + 1, 0, line.length || 1); push(f); }
  }
}

/* ----------------------------------------------- intentos de supresión inline */

/** En guard/ci/pre-commit escribir `gitleaks:allow` y compañía es un hallazgo MEDIUM. */
function collectSuppressionAttempts(lines, rel, inTest, inBuild, push) {
  const rule = loadRules().find((r) => r.id === 'inline-suppression-attempt');
  if (!rule) return;
  for (let i = 0; i < lines.length; i++) {
    const hit = hasInlineAllow(lines[i]);
    if (!hit) continue;
    push({
      ruleId: rule.id, category: rule.category, severity: rule.severity, file: rel, line: i + 1,
      column: (lines[i].indexOf(hit) + 1) || 1, value: hit, maskKind: 'generic',
      remediation: { ...rule.remediation }, inTestPath: inTest, inBuildArtifact: inBuild, reason: 'suppression-attempt',
    });
  }
}

/* ----------------------------------------------------------------- PII (MX) */

/** Carga perezosa de `pii-mx.mjs`; si el módulo no existe todavía, el motor degrada sin PII. */
async function piiModule() {
  if (PII !== undefined) return PII;
  try { PII = await import('./pii-mx.mjs'); } catch { PII = null; }
  return PII;
}

/** Aplica las reglas de `rules/pii.json` delegando la decisión en `applyPiiRule`. */
async function scanPii(text, lines, rel, inTest, inBuild, lang, push) {
  const rules = loadRules().filter((r) => r.category === 'pii');
  if (!rules.length) return;
  const mod = await piiModule();
  if (!mod?.applyPiiRule) return;
  const t = makeT(lang);
  const lower = text.toLowerCase();
  const synthetic = mod.hasSyntheticMarker ? mod.hasSyntheticMarker(text) : false;
  if (synthetic) return;

  for (const rule of rules) {
    if (!rule.regex) continue;
    let re;
    try { re = new RegExp(rule.regex, uniqueFlags(`${rule.flags ?? ''}g`)); } catch { continue; }
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const { text: chunk, offset } of sliceLine(line)) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(chunk)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }
          hits.push({ value: m[0], line: i + 1, column: offset + m.index + 1, before: chunk[m.index - 1] ?? '', after: chunk[m.index + m[0].length] ?? '' });
        }
      }
    }
    if (!hits.length) continue;
    const valid = [];
    for (const h of hits) {
      const res = mod.applyPiiRule({ value: h.value, ruleId: rule.id, line: h.line, column: h.column },
        { lines, text, path: rel, before: h.before, after: h.after, records: hits.length, synthetic });
      if (!res.drop) valid.push({ h, res });
    }
    for (const { h, res } of valid) {
      // segunda pasada: `records` = coincidencias válidas del mismo tipo (umbral de volumen)
      const final = mod.applyPiiRule({ value: h.value, ruleId: rule.id, line: h.line, column: h.column },
        { lines, text, path: rel, before: h.before, after: h.after, records: valid.length, synthetic });
      if (final.drop) continue;
      push({
        ruleId: rule.id, category: 'pii', file: rel, line: h.line, column: h.column,
        severity: finalSeverity(final.severity ?? res.severity, { inTestPath: inTest }),
        value: h.value, maskKind: final.maskKind ?? rule.maskKind ?? rule.id,
        verifiedChecksum: final.verifiedChecksum ?? true,
        remediation: { kind: final.remediation?.kind ?? 'pii', action: t(final.remediation?.action ?? 'pii.remediation.identifier') },
        inTestPath: inTest, inBuildArtifact: inBuild, piiLine: lines[h.line - 1] ?? '',
      });
    }
    void lower;
  }
}

/* ------------------------------------------------------------- finalización */

/**
 * Convierte hallazgos crudos en `Finding` del contrato: máscara + fingerprint y SIN el valor.
 * @param {RawFinding[]} raw
 * @param {{hmacKey:Buffer, lang?:string, source?:'native'|'gitleaks'}} opts
 * @returns {object[]}
 */
export function finalize(raw, { hmacKey, lang = 'es', source = 'native' } = {}) {
  const t = makeT(lang);
  return raw.map((f) => {
    const fingerprint = f.category === 'pii'
      ? piiFingerprint(hmacKey, f.ruleId, f.file, f.piiLine ?? '')
      : hmacFingerprint(hmacKey, f.ruleId, f.file, f.value);
    const out = {
      id: fingerprint, ruleId: f.ruleId, category: f.category, severity: f.severity,
      file: String(f.file).replace(/\\/g, '/'), line: f.line, column: f.column,
      masked: f.category === 'file' ? t('engine.maskedFile') : mask(f.value, f.maskKind), fingerprint,
      remediation: { ...f.remediation, action: f.remediation?.action ?? t(`engine.remediation.${f.remediation?.kind ?? 'secret'}`) },
      source,
    };
    if (f.category !== 'pii' && f.entropy != null) out.entropy = f.entropy;
    if (f.verifiedChecksum != null) out.verifiedChecksum = f.verifiedChecksum;
    if (f.inTestPath) out.inTestPath = true;
    if (f.inBuildArtifact) out.inBuildArtifact = true;
    if (f.keyPath) out.keyPath = f.keyPath;
    return out;
  });
}

/**
 * Reglas por archivo (`filesOnly`): coinciden por nombre y, opcionalmente, por contenido.
 * @param {string} rel ruta relativa posix
 * @param {string|null} content texto (null si binario o no leído)
 * @returns {object[]} reglas que aplican
 */
export function fileRulesFor(rel, content) {
  const hits = [];
  for (const { rule, content: re } of compiledRules()) {
    if (!rule.filesOnly) continue;
    if (!matchesAny(rel, rule.paths)) continue;
    if (rule.notPaths && matchesAny(rel, rule.notPaths)) continue;
    if (re) { if (content == null) continue; re.lastIndex = 0; if (!re.test(content)) continue; }
    hits.push(rule);
  }
  return hits;
}

/** Hallazgo crudo por archivo sensible (el `value` es la ruta: nunca hay valor que enmascarar). */
export function fileFinding(rule, rel) {
  return {
    ruleId: rule.id, category: rule.category ?? 'file', severity: finalSeverity(rule.severity, { inTestPath: isTestPath(rel) }),
    file: rel, line: 1, column: 1, value: rel, maskKind: 'generic',
    remediation: { ...(rule.remediation ?? { kind: 'file' }) },
    inTestPath: isTestPath(rel), inBuildArtifact: isBuildArtifact(rel),
  };
}
