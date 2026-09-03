// i18n mínimo: carga src/i18n/<lang>/*.json (se fusionan por nombre de archivo = namespace).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const cache = new Map();

export function detectLang(argvLang) {
  if (argvLang) return argvLang;
  const env = process.env.BOT_SECURE_LANG || process.env.LC_ALL || process.env.LANG || '';
  return /^en/i.test(env) ? 'en' : 'es';
}

function loadDir(lang) {
  const dir = join(HERE, '..', 'i18n', lang);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const ns = f.replace(/\.json$/, '');
    out[ns] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}

export function messages(lang = 'es') {
  if (!cache.has(lang)) cache.set(lang, loadDir(lang));
  return cache.get(lang);
}

function interpolate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Devuelve una función t(key, vars) para el idioma dado; cae a 'es' y luego a la clave. */
export function makeT(lang = 'es') {
  const primary = messages(lang), fallback = messages('es');
  return function t(key, vars = {}) {
    const [ns, ...rest] = key.split('.');
    const k = rest.join('.');
    const v = primary[ns]?.[k] ?? fallback[ns]?.[k];
    return v === undefined ? key : interpolate(v, vars);
  };
}
