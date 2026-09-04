// Anti-falsos-positivos: placeholders, referencias, cifrados, forma del valor, stopwords, supresiones inline.
import { readFileSync, existsSync } from 'node:fs';
import { readAsset } from '../assets/index.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Claves fuertes: aquí el anti-FP de forma (UUID/hex/solo letras) NO aplica. */
export const STRONG_KEY_RE = /(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret|credentials?)/i;

// Placeholders universales (todas las familias): los del propio bot y marcadores obvios.
const UNIVERSAL_PLACEHOLDER_RE = /__AI_PLACEHOLDER__|AIPLACEHOLDER|^<[^>]+>$|^\{\{.*\}\}$|^\[[^\]]+\]$|^\*{3,}$|^x{4,}$|^\.{3,}$|^_{3,}$|^-{3,}$|^•+$|^REDACTED$|^\[REDACTED\]$|^TOKEN-API$/i;
// Referencias a variables/plantillas.
const REFERENCE_RE = /^\$\{?[A-Za-z_][\w.:-]*\}?$|^\$\{.*\}$|^\$\(.*\)$|^%[A-Za-z_][\w]*%$|^\{\{.*\}\}$|^<%=?.*%>$|^\$\{\{.*\}\}$|^!(?:Ref|Sub|GetAtt|ImportValue)\b|^(?:process\.env|os\.environ|os\.getenv|System\.getenv|Environment\.GetEnvironmentVariable|env|getenv|ENV|Deno\.env|import\.meta\.env|config|settings|secrets)[.([]|^@[\w.]+$|^#\{.*\}$|^\{\$.*\}$|^\$[A-Za-z_]\w*$|^@Value\(|^\[\[.*\]\]$|^%\(.*\)s$/;
// Valor con forma de código (llamada, acceso a propiedad, plantilla).
const CODE_RE = /^[\w.$]+\(.*\)$|^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*$|^`.*\$\{.*\}.*`$|^new\s+\w+/;
// Palabras débiles (valor exacto).
const WEAK_WORD_RE = /^(true|false|null|none|nil|undefined|nan|yes|no|on|off|changeme|change_me|change-me|changeit|password|passwd|secret|example|sample|dummy|fake|test|testing|placeholder|lorem|todo|fixme|xxx+|your[_-]?\w*|replace[_-]?me|replaceme|to[_-]?be[_-]?filled|insert[_-]?\w*|enter[_-]?\w*|my[_-]?(?:secret|password|token|api[_-]?key|key)|the[_-]?(?:secret|password|token|key)|\w*[_-]?here|contraseña|contrasena|clave|ejemplo|prueba|cambiar|cambiame|pendiente|secreto|token|password123|admin|root|user|guest|default|string|value|empty|unset|not[_-]?set|n\/a|tbd|redacted|masked|hidden|\*+|\.+|-+|_+|0+|1+|x+|a+|z+|abc|abcd|abcdef|123|1234|12345|123456|12345678|123456789|1234567890|qwerty|letmein|welcome)$/i;
const SEQ_RE = /^(?:0123456789|1234567890|abcdefghij|abcdefghijklmnopqrstuvwxyz)/i;
const REPEATED_RE = /^(.)\1+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_HASH_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{56}|[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})$/i;
const ONLY_LETTERS_RE = /^[a-zA-Z_.-]+$/;
const SRI_HASH_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/=]{40,}$/;
const ENCRYPTED_RE = /^(?:ENC\[|\$ANSIBLE_VAULT;|AQICAHh|\{cipher\}|vault:v\d+:|AgB[A-Za-z0-9+/=]{40,}|-----BEGIN PGP MESSAGE-----|gAAAAA|SECRET_REF::|ref\+(?:vault|awssm|gcpsecrets|azurekeyvault):\/\/|arn:aws:secretsmanager:|projects\/[\w-]+\/secrets\/|op:\/\/|sm:\/\/|ssm:\/\/|secretsmanager:|akeyless:)/;
const FAKE_FORM_RE = /AIPLACEHOLDER|EXAMPLE|PLACEHOLDER|FAKE|DUMMY|CHANGEME|XXXX|__AI_/i;
const INLINE_ALLOW_RE = /gitleaks:allow|pragma:\s*allowlist\s+secret|bot-secure:allow|trufflehog:ignore|nosecret|secretlint-disable/i;
const FAKE_MARKER_RE = /bot-secure:fake/i;
// Archivos que POR DISEÑO llevan valores falsos generados por el bot (.env.ai y su ejemplo).
// Solo en ellos la marca "# bot-secure:fake" es autoritativa fuera del modo scan: así el
// hook de pre-commit no bloquea un .env.ai legítimo, y a la vez añadir la marca a un
// secreto real en cualquier otro archivo NO sirve para saltarse el escáner.
const FAKE_CARRIER_RE = /(^|\/)\.env\.(ai|example)$/;
/** ¿Ese archivo es un portador legítimo de valores falsos? */
export function isFakeCarrier(path) { return FAKE_CARRIER_RE.test(String(path ?? '').split(sepNorm).join('/')); }
const sepNorm = '\\';

export function isPlaceholder(v) { return UNIVERSAL_PLACEHOLDER_RE.test(String(v ?? '').trim()); }
export function isReference(v) { const s = String(v ?? '').trim(); return REFERENCE_RE.test(s) || CODE_RE.test(s); }
export function isEncrypted(v) { return ENCRYPTED_RE.test(String(v ?? '').trim()); }
export function isWeakWord(v) { const s = String(v ?? '').trim(); return WEAK_WORD_RE.test(s) || REPEATED_RE.test(s) || SEQ_RE.test(s); }
export function isUuid(v) { return UUID_RE.test(String(v ?? '').trim()); }
export function isHexHash(v) { return HEX_HASH_RE.test(String(v ?? '').trim()) || SRI_HASH_RE.test(String(v ?? '').trim()); }
export function isOnlyLetters(v) { return ONLY_LETTERS_RE.test(String(v ?? '').trim()); }
export function looksFake(v) { return FAKE_FORM_RE.test(String(v ?? '')); }
export function hasInlineAllow(lineText) { const m = String(lineText ?? '').match(INLINE_ALLOW_RE); return m ? m[0] : null; }
export function hasFakeMarker(lineText) { return FAKE_MARKER_RE.test(String(lineText ?? '')); }

let STOPWORDS = null;
/** Stopwords EN+ES (una por línea, `#` comenta). Se cargan una vez. */
export function loadStopwords() {
  if (STOPWORDS) return STOPWORDS;
  const set = new Set();
  for (const f of ['stopwords.en.txt', 'stopwords.es.txt']) {
    const texto = readAsset('rules', f);
    if (!texto) continue;
    for (const raw of texto.split(/\r?\n/)) { const w = raw.trim().toLowerCase(); if (w && !w.startsWith('#')) set.add(w); }
  }
  STOPWORDS = set; return set;
}

/** ¿El valor (normalizado) es una palabra de diccionario? */
export function isStopword(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/[^a-záéíóúñü]/g, '');
  if (!s || s.length !== String(v ?? '').trim().length) return false; // solo si TODO el valor es la palabra
  return loadStopwords().has(s);
}

/**
 * Evalúa un candidato.
 * @param {object} p
 * @param {string} p.value valor capturado
 * @param {'prefixed'|'generic'|'connection'|'env'|'frontend'|'mobile'|'config'|'k8s'|'files'|'encrypted'} p.family
 * @param {boolean} p.strongKey ¿la clave/variable es fuerte?
 * @param {string} [p.lineText]
 * @param {'scan'|'guard'|'ci'|'pre-commit'} p.mode
 * @param {object} [p.rule] regla (allowlist)
 * @param {string} [p.path] ruta del archivo (para reconocer .env.ai como portador de valores falsos)
 * @returns {{drop: boolean, reason?: string, degrade?: number}}
 */
export function evaluate({ value, family, strongKey = false, lineText = '', mode = 'scan', rule = null, path = '' }) {
  const v = String(value ?? '').trim();
  const shapeFamily = family !== 'prefixed' && family !== 'files' && family !== 'encrypted';
  if (!v || (v.length < 4 && family !== 'files')) return { drop: true, reason: 'short' };
  if (isPlaceholder(v)) return { drop: true, reason: 'placeholder' };
  if (shapeFamily && isReference(v)) return { drop: true, reason: 'reference' };
  if (family === 'connection' && REFERENCE_RE.test(v)) return { drop: true, reason: 'reference' };
  if (hasFakeMarker(lineText) && (mode === 'scan' || looksFake(v) || isFakeCarrier(path))) return { drop: true, reason: 'fake-marker' };
  if (mode === 'scan' && hasInlineAllow(lineText)) return { drop: true, reason: 'inline-allow' };
  if (family !== 'encrypted' && isEncrypted(v)) return { drop: true, reason: 'encrypted' };
  if (rule?.allowlist?.regexes?.length) {
    for (const re of rule.allowlist.regexes) { try { if (new RegExp(re, 'i').test(v)) return { drop: true, reason: 'allowlist' }; } catch { /* regex inválida: ignora */ } }
  }
  if (family === 'connection') {
    if (isWeakWord(v) || isStopword(v)) return { drop: true, reason: 'weak-password' };
    return { drop: false };
  }
  if (shapeFamily) {
    if (isWeakWord(v)) return { drop: true, reason: 'weak-word' };
    if (!strongKey) {
      if (isOnlyLetters(v)) return { drop: true, reason: 'only-letters' };
      if (isUuid(v)) return { drop: true, reason: 'uuid' };
      if (isHexHash(v)) return { drop: true, reason: 'hash' };
      if (isStopword(v)) return { drop: true, reason: 'stopword' };
      if (rule?.allowlist?.stopwords !== false && /^[a-zA-Z]+$/.test(v) && isStopword(v)) return { drop: true, reason: 'stopword' };
    } else if (isStopword(v)) {
      return { drop: false, reason: 'dictionary-word-strong-key', degrade: 1 };
    }
  }
  return { drop: false };
}
