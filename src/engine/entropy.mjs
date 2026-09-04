// Entropía de Shannon y heurísticas de "forma de token". Señal secundaria: nunca sola.

/** Umbrales por juego de caracteres (trufflehog/detect-secrets). */
export const DEFAULT_THRESHOLDS = Object.freeze({ hex: 3.0, base64: 4.5, other: 3.5 });

const HEX_RE = /^[0-9a-fA-F]+$/;
const B64_RE = /^[A-Za-z0-9+/=_-]+$/;

/** Entropía de Shannon en bits por carácter. */
export function shannon(str) {
  const s = String(str ?? '');
  if (!s.length) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return Math.round(h * 100) / 100;
}

/** Juego de caracteres dominante del valor. */
export function charsetOf(str) {
  const s = String(str ?? '');
  if (HEX_RE.test(s)) return 'hex';
  if (B64_RE.test(s)) return 'base64';
  return 'other';
}

/**
 * ¿Supera el umbral? `threshold` numérico (estilo gitleaks) o 'auto' (por juego de caracteres).
 * @param {string} value
 * @param {number|'auto'|undefined} threshold
 */
export function passesEntropy(value, threshold) {
  if (threshold === undefined || threshold === null || threshold === false) return true;
  const h = shannon(value);
  if (threshold === 'auto') return h >= DEFAULT_THRESHOLDS[charsetOf(value)];
  return h >= Number(threshold);
}

/** Forma de token: ≥ 16 chars, letras y dígitos mezclados, entropía ≥ 3.5. */
export function looksRandom(value, { minLen = 16, minEntropy = 3.5 } = {}) {
  const s = String(value ?? '');
  if (s.length < minLen) return false;
  if (!/[0-9]/.test(s) || !/[A-Za-z]/.test(s)) return false;
  return shannon(s) >= minEntropy;
}

/** Valor "aleatorio" (para subir severidad en claves fuertes): ≥ 12 chars y H ≥ 3.5. */
export function isHighEntropy(value, minLen = 12, minEntropy = 3.5) {
  const s = String(value ?? '');
  return s.length >= minLen && shannon(s) >= minEntropy;
}
