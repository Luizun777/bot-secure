// Máscaras para el reporte: nunca el valor, nunca más información de la indicada por tipo.
// Tarjeta: PCI DSS 3.4 (solo últimos 4). CLABE: solo banco (3). RFC/CURP/NSS: cero caracteres.

/** Prefijos conocidos de tokens (orden: más específico primero). */
const PREFIXES = [
  /^sk-ant-(?:api\d+|oat\d+|admin\d+)-/, /^sk_(?:live|test)_/, /^rk_(?:live|test)_/, /^pk_(?:live|test)_/,
  /^whsec_/, /^github_pat_/, /^gh[pousr]_/, /^glpat-/, /^npm_/, /^xox[abprs]-/, /^AKIA/, /^ASIA/, /^AIza/,
  /^SG\./, /^sk-proj-/, /^sk-/, /^eyJ/, /^AC(?=[a-f0-9]{32}$)/, /^SK(?=[a-f0-9]{32}$)/, /^APP_USR-/, /^TEST-/,
];

/** Longitudes nominales de PII MX (no se expone la longitud real). */
const PII_LEN = { rfc: 13, curp: 18, nss: 11, ine: 13 };

/**
 * Enmascara un valor según su tipo.
 * @param {string} value
 * @param {'token'|'secret'|'card'|'clabe'|'rfc'|'curp'|'nss'|'ine'|'email'|'pem'|'pii'|'generic'|string} kind
 * @returns {string}
 */
export function mask(value, kind = 'generic') {
  const v = String(value ?? '').trim();
  switch (String(kind).toLowerCase()) {
    case 'card': return maskCard(v);
    case 'clabe': return maskClabe(v);
    case 'rfc': case 'curp': case 'nss': case 'ine': return `${kind.toUpperCase()} ***(${PII_LEN[kind.toLowerCase()]})`;
    case 'pii': case 'phone': case 'address': return '***';
    case 'email': return maskEmail(v);
    case 'pem': case 'private-key': return 'PEM ***';
    case 'token': case 'secret': case 'sdk-key': return maskToken(v);
    default: return maskGeneric(v);
  }
}

/** '**** **** **** 1234' (PCI DSS 3.4: solo los últimos 4). */
export function maskCard(v) {
  const digits = v.replace(/\D/g, '');
  return `**** **** **** ${digits.slice(-4).padStart(4, '*')}`;
}

/** CLABE: primeros 3 dígitos (banco) + '…'. */
export function maskClabe(v) {
  const digits = v.replace(/\D/g, '');
  return `${digits.slice(0, 3)}…`;
}

/** Correo: solo el dominio. */
export function maskEmail(v) {
  const at = v.lastIndexOf('@');
  return at > 0 ? `***@${v.slice(at + 1)}` : '***';
}

/** Token: prefijo conocido + '…' + '(len)'; sin prefijo conocido → genérica. */
export function maskToken(v) {
  const p = knownPrefix(v);
  if (p) return `${p}…(${v.length})`;
  return maskGeneric(v);
}

/** Genérica: primeros 2 + '…' + '(len)' si len ≥ 12; si no, '***'. */
export function maskGeneric(v) {
  if (v.length >= 12) return `${v.slice(0, 2)}…(${v.length})`;
  return '***';
}

/** Devuelve el prefijo conocido del token o null. */
export function knownPrefix(v) {
  for (const re of PREFIXES) { const m = re.exec(v); if (m && m[0]) return m[0]; }
  return null;
}
