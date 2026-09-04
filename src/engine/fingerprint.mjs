// Fingerprints no reversibles (HMAC-SHA256 con clave fuera del repo) y clave por repositorio.
// Motivo: un hash sin sal sobre PII/contraseñas débiles es un oráculo de fuerza bruta (red team, hallazgo crítico).
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { git } from '../lib/exec.mjs';
import { BotSecureError } from '../lib/errors.mjs';

export const KEY_BYTES = 32;
export const FP_LEN = 16;
export const ENV_KEY = 'BOT_SECURE_HMAC_KEY';

/** Directorio base del usuario (BOT_SECURE_HOME permite aislar tests). */
export function botSecureHome(env = process.env) {
  return env.BOT_SECURE_HOME || join(homedir(), '.bot-secure');
}

/**
 * Identificador estable del repo: sha256 del remote origin (si existe) o de la ruta absoluta.
 * @param {string} root
 * @returns {string} hex de 64 caracteres
 */
export function repoId(root) {
  const abs = resolve(root);
  const r = git(['config', '--get', 'remote.origin.url'], { cwd: abs });
  const remote = r.status === 0 ? r.stdout.trim() : '';
  const seed = remote ? `remote:${remote}` : `path:${abs}`;
  return createHash('sha256').update(seed).digest('hex');
}

/** Ruta del archivo de clave para un repo. */
export function keyPath(root, env = process.env) {
  return join(botSecureHome(env), 'keys', `${repoId(root)}.key`);
}

/** Decodifica una clave en hex o base64; null si no mide 32 bytes. */
export function decodeKey(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/]{43}=?$/.test(s) || /^[A-Za-z0-9_-]{43}=?$/.test(s)) {
    const b = Buffer.from(s, 'base64');
    if (b.length === KEY_BYTES) return b;
  }
  return null;
}

/**
 * Carga (o crea) la clave HMAC del repo: env BOT_SECURE_HMAC_KEY o ~/.bot-secure/keys/<repo-id>.key (0600).
 * @param {string} root
 * @param {{create?: boolean, env?: object}} [opts]
 * @returns {Buffer} clave de 32 bytes
 */
export function loadHmacKey(root, { create = true, env = process.env } = {}) {
  if (env[ENV_KEY]) {
    const k = decodeKey(env[ENV_KEY]);
    if (!k) {
      throw new BotSecureError('report.badEnvKey', {
        vars: { env: ENV_KEY },
        fix: `export ${ENV_KEY}=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`,
      });
    }
    return k;
  }
  const p = keyPath(root, env);
  if (existsSync(p)) {
    const k = decodeKey(readFileSync(p, 'utf8'));
    if (!k) throw new BotSecureError('report.keyCorrupt', { vars: { path: p }, fix: `rm "${p}" && bot-secure init` });
    return k;
  }
  if (!create) throw new BotSecureError('report.keyMissing', { vars: { path: p }, fix: 'bot-secure init' });
  return createKey(p);
}

/** Genera y guarda una clave nueva con permisos 0600 (directorio 0700). */
function createKey(p) {
  const key = randomBytes(KEY_BYTES);
  mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(p, key.toString('hex') + '\n', { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* Windows: sin modo POSIX */ }
  return key;
}

/** Normaliza un valor de secreto: trim y sin comillas envolventes. */
export function normalizeValue(value) {
  let v = String(value ?? '').trim();
  const m = /^(["'`])(.*)\1$/s.exec(v);
  if (m) v = m[2].trim();
  return v;
}

/** Normaliza una línea para PII: todos los dígitos → '#'. NUNCA conserva el valor numérico. */
export function normalizeLine(line) {
  return String(line ?? '').replace(/\d/g, '#').trim();
}

/** Ruta relativa en formato posix. */
function posix(file) { return String(file ?? '').replace(/\\/g, '/'); }

function hmac16(key, parts) {
  return createHmac('sha256', key).update(parts.join('|')).digest('hex').slice(0, FP_LEN);
}

/**
 * Fingerprint de un secreto: HMAC-SHA256(key, ruleId|file|valorNormalizado)[0:16].
 * @param {Buffer} key
 */
export function hmacFingerprint(key, ruleId, file, value) {
  return hmac16(key, [ruleId, posix(file), normalizeValue(value)]);
}

/**
 * Fingerprint de PII: HMAC-SHA256(key, ruleId|file|líneaNormalizada)[0:16].
 * Implicación: dos PII distintas con la misma forma en la misma línea comparten fingerprint
 * (se suprimen juntas en el baseline). Es deliberado: el reporte no debe ser un oráculo del valor.
 */
export function piiFingerprint(key, ruleId, file, lineNormalized) {
  return hmac16(key, [ruleId, posix(file), normalizeLine(lineNormalized)]);
}
