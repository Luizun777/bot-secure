// Severidades: orden, degradación por contexto (rutas de prueba/build) y ajuste de JWT.

/** @typedef {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'} Severity */

export const SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

/** Posición en la escala (0 = más grave). Desconocido → al final. */
export function rank(sev) { const i = SEVERITIES.indexOf(sev); return i < 0 ? SEVERITIES.length : i; }

/** ¿`sev` es al menos tan grave como `min`? */
export function isAtLeast(sev, min) { return rank(sev) <= rank(min); }

/** Baja `steps` niveles sin pasar de INFO. */
export function degrade(sev, steps = 1) { return SEVERITIES[Math.min(SEVERITIES.length - 1, rank(sev) + steps)]; }

/** Sube `steps` niveles sin pasar de CRITICAL. */
export function upgrade(sev, steps = 1) { return SEVERITIES[Math.max(0, rank(sev) - steps)]; }

/** La más grave de dos. */
export function mostSevere(a, b) { return rank(a) <= rank(b) ? a : b; }

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|specs?|fixtures?|__fixtures__|mocks?|__mocks__|examples?|samples?|docs?|stories|testdata)(\/|$)|\.(test|spec|stories)\.\w+$/i;
const BUILD_PATH_RE = /(^|\/)(dist|build|out|target|\.next|\.nuxt|\.output)(\/|$)/i;
const PUBLIC_PREFIX_RE = /(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NG_APP_|NUXT_PUBLIC_|PUBLIC_)/;

/** Ruta relativa posix. */
export function isTestPath(rel) { return TEST_PATH_RE.test(rel || ''); }
export function isBuildArtifact(rel) { return BUILD_PATH_RE.test(rel || ''); }

/** Decodifica el payload de un JWT (segundo segmento, base64url). null si no es JSON. */
export function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' ? obj : null;
  } catch { return null; }
}

/** Decodifica la cabecera de un JWT. */
export function decodeJwtHeader(token) {
  try {
    const b64 = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8'));
  } catch { return null; }
}

/**
 * Ajusta la severidad de un JWT según su contenido:
 * alg none o exp vencido → INFO; role ≠ anon → HIGH (CRITICAL si está en variable pública de front).
 * @returns {{severity: Severity, reason: string}}
 */
export function adjustJwt(base, token, lineText = '') {
  const header = decodeJwtHeader(token);
  const payload = decodeJwtPayload(token);
  if (header && String(header.alg || '').toLowerCase() === 'none') return { severity: 'INFO', reason: 'alg-none' };
  if (payload && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return { severity: 'INFO', reason: 'expired' };
  const role = payload && typeof payload.role === 'string' ? payload.role.toLowerCase() : null;
  if (role && role !== 'anon' && role !== 'authenticated') {
    if (PUBLIC_PREFIX_RE.test(lineText)) return { severity: 'CRITICAL', reason: `role-${role}-public` };
    return { severity: 'HIGH', reason: `role-${role}` };
  }
  return { severity: base, reason: 'jwt' };
}

/** Severidad final: rutas de prueba/docs degradan un nivel (nunca ocultan). */
export function finalSeverity(base, { inTestPath = false, extraDegrade = 0 } = {}) {
  let sev = base;
  if (inTestPath) sev = degrade(sev);
  if (extraDegrade > 0) sev = degrade(sev, extraDegrade);
  return sev;
}
