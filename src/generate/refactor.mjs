// De hallazgo a cambio concreto: literal → variable de entorno, o campo de configuración → VACÍO.
// `proposeRefactors` no toca disco; `applyRefactors` escribe (con --dry-run devuelve el diff).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeText } from '../lib/fsx.mjs';
import { fakeComment, fakeFor, inferKind, normName } from './fakes.mjs';
import { appJoin, buildDbUrl, parseEnv, renderEnvAi } from './env-ai.mjs';

/** @typedef {{file:string, line:number, before:string, after:string, envVar:string, kind:'literal-to-env'|'config-to-empty', lang:string}} Proposal */

const CONFIG_EXT = /\.(ya?ml|json|properties|toml|ini|xml|plist)$/i;
const CONFIG_EMPTY_FILE = /(^|\/)(appsettings[^/]*\.json|application[^/]*\.(ya?ml|properties)|environment[^/]*\.ts|config[^/]*\.(php|py|js|ts)|database\.(yml|php)|settings\.py)$/i;

/** Lenguaje del archivo (decide la forma de leer la variable de entorno). */
export function langOf(file) {
  const f = String(file).toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) return 'js';
  if (/\.py$/.test(f)) return 'python';
  if (/\.java$/.test(f)) return 'java';
  if (/\.kt$/.test(f)) return 'kotlin';
  if (/\.cs$/.test(f)) return 'csharp';
  if (/\.go$/.test(f)) return 'go';
  if (/\.php$/.test(f)) return 'php';
  if (/\.rb$/.test(f)) return 'ruby';
  if (/\.dart$/.test(f)) return 'dart';
  if (/\.(ya?ml)$/.test(f)) return 'yaml';
  if (/\.json$/.test(f)) return 'json';
  if (/\.(properties|ini|toml|env)$/.test(f) || /(^|\/)\.env/.test(f)) return 'properties';
  if (/\.(xml|plist|csproj)$/.test(f)) return 'xml';
  return 'text';
}

/** Expresión que lee una variable de entorno en cada lenguaje. */
export function envRead(lang, name) {
  switch (lang) {
    case 'js': return `process.env.${name} ?? ''`;
    case 'python': return `os.environ.get("${name}", "")`;
    case 'java': return `System.getenv("${name}")`;
    case 'kotlin': return `System.getenv("${name}") ?: ""`;
    case 'csharp': return `Environment.GetEnvironmentVariable("${name}") ?? ""`;
    case 'go': return `os.Getenv("${name}")`;
    case 'php': return `getenv('${name}') ?: ''`;
    case 'ruby': return `ENV.fetch('${name}', '')`;
    case 'dart': return `const String.fromEnvironment('${name}')`;
    case 'yaml': return `\${${name}:}`;
    case 'properties': return `\${${name}}`;
    case 'json': return '';
    case 'xml': return `\${${name}}`;
    default: return `\${${name}}`;
  }
}

/** ¿En este archivo la remediación correcta es dejar el campo VACÍO (regla del campo vacío)? */
export function isEmptyFieldFile(file) {
  const f = String(file).replace(/\\/g, '/');
  return CONFIG_EMPTY_FILE.test(f) || (CONFIG_EXT.test(f) && /(^|\/)(src\/)?(main\/resources|config|environments|settings)\//i.test(f));
}

/** Nombre de variable propuesto para un hallazgo. */
export function envVarFor(finding) {
  const fromRule = finding?.remediation?.envVar;
  if (fromRule) return normName(fromRule);
  const key = finding?.keyPath || finding?.ruleId || 'VALUE';
  return normName(String(key).split(/[.:]/).pop());
}

/** Máscara del valor original: NUNCA se escribe el valor real en la propuesta. */
function maskedBefore(finding, lineText) {
  const masked = finding?.masked || '…';
  if (!lineText) return masked;
  // Se conserva la forma de la línea pero el valor va enmascarado.
  return lineText.trim().replace(/(["'=:]\s*)([^"'\s,;}]{6,})/, (_, p, v) => (v.includes('AI_PLACEHOLDER') ? `${p}${v}` : `${p}${masked}`));
}

/**
 * Propone cambios a partir de hallazgos del motor.
 * @param {object[]} findings Finding[] del motor (usa file, line, masked, remediation, keyPath)
 * @param {object} app App de policy.apps (para acotar por ruta y elegir el lenguaje)
 * @param {{root?:string, project?:string}} [opts]
 * @returns {Proposal[]}
 */
export function proposeRefactors(findings = [], app = null, opts = {}) {
  const base = app?.path && app.path !== '.' ? `${app.path}/` : '';
  const out = [];
  const seen = new Set();
  for (const f of findings) {
    if (!f?.file) continue;
    const file = String(f.file).replace(/\\/g, '/');
    if (base && !file.startsWith(base)) continue;
    if (f.category === 'pii' || f.category === 'file') continue;
    const key = `${file}:${f.line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lang = langOf(file);
    const envVar = envVarFor(f);
    const lineText = readLine(opts.root, file, f.line);
    const empty = isEmptyFieldFile(file);
    const kind = empty ? 'config-to-empty' : 'literal-to-env';
    const before = maskedBefore(f, lineText);
    const after = empty ? emptyLine(lineText, lang) : replacedLine(lineText, lang, envVar);
    out.push({ file, line: f.line ?? 0, before, after, envVar, kind, lang });
  }
  return out;
}

/** Lee una línea del archivo (o cadena vacía si no hay raíz o no existe). */
function readLine(root, file, line) {
  if (!root || !line) return '';
  const p = join(root, file);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8').split(/\r?\n/)[line - 1] ?? ''; } catch { return ''; }
}

/** Línea con el campo VACÍO, conservando indentación y clave. */
export function emptyLine(lineText, lang) {
  const text = String(lineText || '');
  if (!text.trim()) return '';
  if (lang === 'yaml') return text.replace(/:\s*.*$/, ': ""');
  if (lang === 'json') return text.replace(/:\s*"(?:[^"\\]|\\.)*"/, ': ""').replace(/:\s*[^",{[\]}\s][^,]*/, ': ""');
  if (lang === 'properties') return text.replace(/=.*$/, '=');
  if (lang === 'js') return text.replace(/:\s*(['"`]).*?\1/, ": ''").replace(/=\s*(['"`]).*?\1\s*;?$/, " = '';");
  if (lang === 'python') return text.replace(/:\s*(['"]).*?\1/, ': ""').replace(/=\s*(['"]).*?\1\s*$/, ' = ""');
  if (lang === 'php') return text.replace(/=>\s*(['"]).*?\1/, "=> ''").replace(/=\s*(['"]).*?\1\s*;?$/, " = '';");
  if (lang === 'xml') return text.replace(/>(?:[^<]*)</, '><');
  return text.replace(/(["'])(?:[^"'\\]|\\.)*\1/, '""');
}

/** Línea con el literal sustituido por la lectura de la variable de entorno. */
export function replacedLine(lineText, lang, envVar) {
  const text = String(lineText || '');
  const read = envRead(lang, envVar);
  if (!text.trim()) return `# ${envVar} → ${read}`;
  if (lang === 'yaml' || lang === 'properties') return text.replace(/(:|=)\s*.*$/, (_, sep) => `${sep}${sep === ':' ? ' ' : ''}${read}`);
  if (lang === 'json') return text.replace(/:\s*"(?:[^"\\]|\\.)*"/, ': ""');
  const quoted = /(['"`])(?:[^\\]|\\.)*?\1/;
  return quoted.test(text) ? text.replace(quoted, read) : `${text}  // ${envVar} → ${read}`;
}

/** Diff unificado (para `--dry-run`), sin valores reales: el "antes" va enmascarado. */
export function toUnifiedDiff(proposals = []) {
  const byFile = new Map();
  for (const p of proposals) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  const out = [];
  for (const [file, items] of byFile) {
    out.push(`--- a/${file}`, `+++ b/${file}`);
    for (const p of items.sort((a, b) => a.line - b.line)) {
      out.push(`@@ -${p.line},1 +${p.line},1 @@ ${p.kind}`);
      out.push(`-${p.before}`);
      out.push(`+${p.after}`);
    }
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

/**
 * Aplica las propuestas: escribe `.env.example` y `.env.ai` con las variables nuevas y,
 * si no es simulación, deja VACÍO el campo en los archivos de configuración.
 * @param {string} root raíz del workspace
 * @param {Proposal[]} proposals
 * @param {{dryRun?:boolean, app?:object, policy?:object, project?:string}} [opts]
 * @returns {{changed:string[], diff:string, vars:{name:string, value:string}[], dryRun:boolean}}
 */
export function applyRefactors(root, proposals = [], opts = {}) {
  const dryRun = !!opts.dryRun;
  const app = opts.app ?? null;
  const project = opts.project || opts.policy?.project || 'app';
  const dbUrl = opts.policy?.db ? buildDbUrl(opts.policy.db) : undefined;

  const names = [...new Set(proposals.map((p) => p.envVar).filter(Boolean))].sort();
  const vars = names.map((name) => {
    const kind = inferKind(name);
    return { name, value: fakeFor(kind, name, { project, dbUrl }), kind, comment: kind === 'plain' ? undefined : fakeComment(kind, name), section: 'app' };
  });

  const envAiPath = appJoin(app, '.env.ai');
  const envExamplePath = appJoin(app, '.env.example');
  const merged = mergeEnv(root, envAiPath, vars);
  const changed = [];
  const diff = toUnifiedDiff(proposals);

  if (!dryRun) {
    writeText(join(root, envAiPath), renderEnvAi(merged, { title: envAiPath }));
    changed.push(envAiPath);
    writeText(join(root, envExamplePath), `# .env.example — nombres de variables (sin valores). Generado por bot-secure.\n${merged.map((v) => `${v.name}=`).join('\n')}\n`);
    changed.push(envExamplePath);
    for (const p of proposals) {
      const full = join(root, p.file);
      if (!existsSync(full)) continue;
      const lines = readFileSync(full, 'utf8').split(/\r?\n/);
      if (!lines[p.line - 1]) continue;
      lines[p.line - 1] = p.kind === 'config-to-empty' ? emptyLine(lines[p.line - 1], p.lang) : replacedLine(lines[p.line - 1], p.lang, p.envVar);
      writeText(full, lines.join('\n'));
      if (!changed.includes(p.file)) changed.push(p.file);
    }
  }
  return { changed, diff, vars: merged.map(({ name, value }) => ({ name, value })), dryRun };
}

/** Fusiona las variables nuevas con las que ya estaban en el .env.ai (sin duplicar). */
function mergeEnv(root, rel, vars) {
  const p = join(root, rel);
  const existing = existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : [];
  const out = existing.map((v) => ({ name: v.name, value: v.value, kind: inferKind(v.name), section: 'app' }));
  const seen = new Set(out.map((v) => v.name));
  for (const v of vars) if (!seen.has(v.name)) { seen.add(v.name); out.push(v); }
  return out;
}
