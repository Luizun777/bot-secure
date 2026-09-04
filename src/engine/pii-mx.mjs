// Validadores de PII mexicana. Cada validador devuelve {valid, reason} donde `reason` es una clave
// i18n corta (ver src/i18n/<lang>/pii.json → "reason.*"): 'ok' | 'length' | 'format' | 'date' |
// 'checksum' | 'generic' | 'entidad' | 'banco' | 'plaza' | 'subdelegacion' | 'years' | 'iin' |
// 'test-card' | 'country' | 'domain' | 'synthetic'.
//
// Motivo del diseño (redteam-detector, hallazgo "PII solo si pasa checksum"): un checksum acepta
// 1 de cada 10 corridas de dígitos aleatorias (~10 % de falsos positivos sobre Snowflake IDs,
// timestamps, folios). Por eso TODO validador combina checksum + estructura (catálogos Banxico/IIN/
// entidades, fechas plausibles, rangos de subdelegación) antes de dar `valid: true`.

import { readFileSync } from 'node:fs';
import { SYNTHETIC_MARKER } from './synthetic-mx.mjs';

/* ------------------------------------------------------------------------------------------ */
/* Catálogos (carga perezosa; JSON en src/engine/catalogs/).                                   */
/* ------------------------------------------------------------------------------------------ */

const catalogCache = new Map();

/**
 * Carga (y memoiza) un catálogo JSON de `src/engine/catalogs/`.
 * @param {'banxico'|'iin'|'entidades'|'cp-mx'} name
 * @returns {object}
 */
export function catalog(name) {
  if (!catalogCache.has(name)) {
    const url = new URL(`./catalogs/${name}.json`, import.meta.url);
    catalogCache.set(name, JSON.parse(readFileSync(url, 'utf8')));
  }
  return catalogCache.get(name);
}

const ok = (extra = {}) => ({ valid: true, reason: 'ok', ...extra });
const no = (reason, extra = {}) => ({ valid: false, reason, ...extra });

/** Normaliza: mayúsculas, sin espacios, guiones ni puntos (formatos «RFC: ABC-010101-XX1»). */
function norm(value) {
  return String(value ?? '').toUpperCase().replace(/[\s.\-_/]/g, '');
}

const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');

/* ------------------------------------------------------------------------------------------ */
/* Fechas.                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * ¿`yymmdd` es una fecha real en alguno de los dos siglos posibles?
 * (RFC/CURP guardan el año con 2 dígitos: el siglo es ambiguo por diseño.)
 * @param {string} yymmdd
 * @returns {boolean}
 */
export function validYYMMDD(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd)) return false;
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4)), dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  for (const century of [1900, 2000]) {
    const y = century + yy;
    if (y > CURRENT_YEAR) continue;
    const dim = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    if (dd <= dim) return true;
  }
  return false;
}

/** Año de 2 dígitos → año de 4 en la ventana (CURRENT_YEAR-99, CURRENT_YEAR]. */
function resolveYY(yy) {
  const n = Number(yy);
  const candidate = 2000 + n;
  return candidate <= CURRENT_YEAR ? candidate : 1900 + n;
}

/* ------------------------------------------------------------------------------------------ */
/* RFC (SAT). Fuente: "Algoritmo para la generación del RFC / dígito verificador" (Anexo 3 de la */
/* RMF, tabla de valores + módulo 11). Persona física = 13 (4 letras), moral = 12 (3 letras).   */
/* ------------------------------------------------------------------------------------------ */

// Tabla de valores del Anexo 3: el índice de cada carácter es su valor (espacio = 37, Ñ = 38).
const RFC_DV_TABLA = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

/** RFC genéricos del SAT (público general nacional / extranjero): nunca son PII de una persona. */
export const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{2})([A-Z\d])$/;

/**
 * Dígito verificador del RFC (módulo 11). Para persona moral (11 caracteres antes del dígito) se
 * antepone un espacio para reutilizar los pesos 13..2 (verificado con SAT970701NN3, CFE370814QI0,
 * BBA830831LJ2, TME840315KT6, IMS421231I45).
 * @param {string} rfcSinDigito 11 (moral) o 12 (física) caracteres
 * @returns {string} '0'-'9' o 'A'
 */
export function rfcCheckDigit(rfcSinDigito) {
  const s = rfcSinDigito.length === 11 ? ' ' + rfcSinDigito : rfcSinDigito;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += RFC_DV_TABLA.indexOf(s[i]) * (13 - i);
  const mod = sum % 11;
  if (mod === 0) return '0';
  const d = 11 - mod;
  return d === 10 ? 'A' : String(d);
}

/**
 * Valida un RFC mexicano (13 física / 12 moral): formato, fecha real y dígito verificador mod 11.
 * Los RFC genéricos (XAXX010101000 / XEXX010101000) se rechazan con reason 'generic' porque son
 * marcadores públicos, no PII (además XAXX010101000 ni siquiera cumple el dígito verificador).
 * @param {string} value
 * @returns {{valid: boolean, reason: string, kind?: 'fisica'|'moral'}}
 */
export function validateRFC(value) {
  const v = norm(value);
  if (RFC_GENERICOS.has(v)) return no('generic', { kind: v.length === 13 ? 'fisica' : 'moral' });
  if (v.length !== 12 && v.length !== 13) return no('length');
  const m = RFC_RE.exec(v);
  if (!m) return no('format');
  const kind = v.length === 13 ? 'fisica' : 'moral';
  if ((kind === 'fisica' && m[1].length !== 4) || (kind === 'moral' && m[1].length !== 3)) return no('format', { kind });
  if (!validYYMMDD(m[2])) return no('date', { kind });
  if (rfcCheckDigit(v.slice(0, -1)) !== v.slice(-1)) return no('checksum', { kind });
  return ok({ kind });
}

/* ------------------------------------------------------------------------------------------ */
/* CURP (RENAPO). Fuente: "Instructivo normativo para la asignación de la CURP" (DOF).          */
/* Estructura: 4 letras + AAMMDD + H|M + entidad(2) + 3 consonantes internas + homonimia + DV.  */
/* ------------------------------------------------------------------------------------------ */

const CURP_TABLA = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
const CURP_RE = /^([A-ZÑ]{4})(\d{6})([HM])([A-Z]{2})([B-DF-HJ-NP-TV-ZÑ]{3})([0-9A-Z])(\d)$/;

/** Dígito verificador de la CURP: Σ valor(c_i) × (18 − i), i = 0..16; DV = (10 − Σ mod 10) mod 10. */
export function curpCheckDigit(curp17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += CURP_TABLA.indexOf(curp17[i]) * (18 - i);
  return String((10 - (sum % 10)) % 10);
}

/**
 * Valida una CURP (18): formato, fecha real, sexo H/M, entidad en el catálogo RENAPO (incluye NE
 * para nacidos en el extranjero), consonantes internas y dígito verificador mod 10 (pesos 18..2).
 * @param {string} value
 * @returns {{valid: boolean, reason: string, entidad?: string}}
 */
export function validateCURP(value) {
  const v = norm(value);
  if (v.length !== 18) return no('length');
  const m = CURP_RE.exec(v);
  if (!m) return no('format');
  if (!validYYMMDD(m[2])) return no('date');
  const entidades = catalog('entidades').curp;
  if (!Object.hasOwn(entidades, m[4])) return no('entidad', { entidad: m[4] });
  if (curpCheckDigit(v.slice(0, 17)) !== v[17]) return no('checksum', { entidad: m[4] });
  return ok({ entidad: m[4] });
}

/* ------------------------------------------------------------------------------------------ */
/* CLABE (Banxico, 18 dígitos): 3 banco + 3 plaza + 11 cuenta + 1 dígito de control.            */
/* Control: Σ (d_i × [3,7,1]_i mod 10) mod 10 → DV = (10 − Σ) mod 10.                           */
/* ------------------------------------------------------------------------------------------ */

const CLABE_PESOS = [3, 7, 1];

/** Dígito de control de la CLABE (pesos 3-7-1 cíclicos sobre los 17 primeros dígitos). */
export function clabeCheckDigit(clabe17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(clabe17[i]) * CLABE_PESOS[i % 3]) % 10;
  return String((10 - (sum % 10)) % 10);
}

/**
 * Valida una CLABE (18 dígitos): estructura, código de banco en el catálogo Banxico (los códigos
 * 000/999 son "no asignados" y se usan a propósito en los seeds sintéticos), plaza distinta de 000
 * y dígito de control. `plazaKnown` solo informa: el catálogo de plazas es una muestra.
 * @param {string} value
 * @returns {{valid: boolean, reason: string, banco?: string, plazaKnown?: boolean}}
 */
export function validateCLABE(value) {
  const raw = String(value ?? '');
  if (/[^\d\s-]/.test(raw.trim())) return no('format');
  const v = digitsOnly(raw);
  if (v.length !== 18) return no('length');
  const { bancos, noAsignados, plazas } = catalog('banxico');
  const codigo = v.slice(0, 3), plaza = v.slice(3, 6);
  if (noAsignados.includes(codigo) || !Object.hasOwn(bancos, codigo)) return no('banco');
  if (plaza === '000') return no('plaza', { banco: bancos[codigo] });
  if (clabeCheckDigit(v.slice(0, 17)) !== v[17]) return no('checksum', { banco: bancos[codigo] });
  return ok({ banco: bancos[codigo], plazaKnown: Object.hasOwn(plazas, plaza) });
}

/* ------------------------------------------------------------------------------------------ */
/* Luhn (ISO/IEC 7812) — base de NSS y tarjetas.                                               */
/* ------------------------------------------------------------------------------------------ */

/** Dígito de control Luhn para una cadena de dígitos SIN el dígito final. */
export function luhnCheckDigit(digits) {
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/** ¿La cadena completa (con dígito de control) pasa Luhn? Primitiva booleana. */
export function luhnOk(s) { return /^\d{2,}$/.test(s) && luhnCheckDigit(s.slice(0, -1)) === s.slice(-1); }

/* ------------------------------------------------------------------------------------------ */
/* NSS (IMSS, 11 dígitos): 2 subdelegación + 2 año de alta + 2 año de nacimiento + 4 folio + Luhn */
/* Fuente: estructura publicada por el IMSS. La subdelegación válida va de 01 a 97.             */
/* ------------------------------------------------------------------------------------------ */

const IMSS_FUNDACION = 1943;

/**
 * Valida un NSS (11 dígitos): Luhn + subdelegación 01-97 + años de alta/nacimiento plausibles
 * (alta ≥ 1943, edad al alta entre 14 y 90 años). La comprobación de años es lo que descarta
 * teléfonos de 11 dígitos y folios que "pasan Luhn por casualidad".
 * @param {string} value
 * @returns {{valid: boolean, reason: string}}
 */
export function validateNSS(value) {
  const raw = String(value ?? '');
  if (/[^\d\s-]/.test(raw.trim())) return no('format');
  const v = digitsOnly(raw);
  if (v.length !== 11) return no('length');
  const sub = Number(v.slice(0, 2));
  if (sub < 1 || sub > 97) return no('subdelegacion');
  const alta = resolveYY(v.slice(2, 4)), nac = resolveYY(v.slice(4, 6));
  if (alta < IMSS_FUNDACION) return no('years');
  const edad = alta - nac;
  if (edad < 14 || edad > 90) return no('years');
  if (!luhnOk(v)) return no('checksum');
  return ok();
}

/* ------------------------------------------------------------------------------------------ */
/* Tarjeta (PAN). Luhn + IIN/BIN del catálogo + longitud por marca + no ser subcadena de una    */
/* corrida de dígitos mayor (un PAN "dentro" de un ID de 20 dígitos es un falso positivo).      */
/* ------------------------------------------------------------------------------------------ */

function iinMatch(digits) {
  for (const b of catalog('iin').brands) {
    const byPrefix = (b.prefixes ?? []).some((p) => digits.startsWith(p));
    const byRange = (b.ranges ?? []).some(([lo, hi]) => {
      const head = digits.slice(0, lo.length);
      return head.length === lo.length && head >= lo && head <= hi;
    });
    if ((byPrefix || byRange) && b.lengths.includes(digits.length)) return b.brand;
  }
  return null;
}

/**
 * Valida un número de tarjeta (PAN). Nombre `luhn` por contrato (CONTRACTS.md → pii-mx.mjs): hace
 * la validación COMPLETA, no solo el checksum. Usa `luhnOk()` si solo quieres la primitiva.
 * @param {string} value PAN con o sin espacios/guiones
 * @param {{before?: string, after?: string}} [ctx] caracteres inmediatamente anterior/posterior en
 *   la línea; si alguno es dígito, el PAN es subcadena de una corrida mayor → 'format'
 * @returns {{valid: boolean, reason: string, brand?: string}}
 */
export function luhn(value, { before = '', after = '' } = {}) {
  const raw = String(value ?? '');
  if (/[^\d\s-]/.test(raw.trim())) return no('format');
  if (/\d$/.test(before) || /^\d/.test(after)) return no('format');
  const v = digitsOnly(raw);
  if (v.length < 13 || v.length > 19) return no('length');
  if (catalog('iin').testPans.includes(v)) return no('test-card');
  const brand = iinMatch(v);
  if (!brand) return no('iin');
  if (!luhnOk(v)) return no('checksum', { brand });
  return ok({ brand });
}

/** Alias legible de `luhn()` (validación completa del PAN). */
export const validateCard = luhn;

/* ------------------------------------------------------------------------------------------ */
/* Clave de elector INE (18): 6 consonantes + AAMMDD + entidad(2) + sexo H|M + 3 dígitos          */
/* (homonimia/"disc"). INCIERTO: el INE no publica ni el algoritmo del último bloque ni una       */
/* especificación oficial del orden; la estructura se tomó de claves de ejemplo públicas. Por eso */
/* solo se valida estructura + fecha + entidad 01-32 y el hallazgo va con verifiedChecksum:false. */
/* ------------------------------------------------------------------------------------------ */

const INE_RE = /^([A-ZÑ]{6})(\d{6})(\d{2})([HM])(\d{3})$/;

/**
 * Valida una clave de elector del INE (18 caracteres).
 * @param {string} value
 * @returns {{valid: boolean, reason: string, entidad?: string, checksum?: boolean}}
 */
export function validateINE(value) {
  const v = norm(value);
  if (v.length !== 18) return no('length');
  const m = INE_RE.exec(v);
  if (!m) return no('format');
  if (!validYYMMDD(m[2])) return no('date');
  const entidades = catalog('entidades').ine;
  if (!Object.hasOwn(entidades, m[3])) return no('entidad', { entidad: m[3] });
  // checksum:false → el llamador debe marcar verifiedChecksum = false en el hallazgo.
  return ok({ entidad: m[3], checksum: false });
}

/* ------------------------------------------------------------------------------------------ */
/* IBAN (ISO 13616): mod 97 = 1 sobre la cadena rotada. México NO usa IBAN (usa CLABE), pero    */
/* aparece en pagos internacionales dentro de repos mexicanos.                                  */
/* ------------------------------------------------------------------------------------------ */

// Longitud del IBAN por país (registro IBAN de SWIFT). Muestra de los países más frecuentes.
const IBAN_LEN = {
  AD: 24, AE: 23, AT: 20, BE: 16, BG: 22, BR: 29, CH: 21, CL: 0, CR: 22, CY: 28, CZ: 24, DE: 22,
  DK: 18, DO: 28, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, GT: 28, HR: 21, HU: 28,
  IE: 22, IL: 23, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15,
  PA: 0, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, TR: 26, UA: 29, VA: 22,
};

/** Resto de la división por 97 de una cadena larga de dígitos (aritmética por trozos). */
function mod97(s) {
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

/**
 * Valida un IBAN: país conocido, longitud del país y checksum mod 97 = 1.
 * @param {string} value
 * @returns {{valid: boolean, reason: string, country?: string}}
 */
export function validateIBAN(value) {
  const v = norm(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return no('format');
  const country = v.slice(0, 2);
  const expected = IBAN_LEN[country];
  if (!expected) return no('country', { country });
  if (v.length !== expected) return no('country', { country });
  const rearranged = v.slice(4) + v.slice(0, 4);
  const numeric = [...rearranged].map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
  if (mod97(numeric) !== 1) return no('checksum', { country });
  return ok({ country });
}

/* ------------------------------------------------------------------------------------------ */
/* Correo y teléfono MX (solo con contexto; ver applyPiiRule).                                  */
/* ------------------------------------------------------------------------------------------ */

const EMAIL_RE = /^[A-Z0-9._%+-]+@([A-Z0-9-]+\.)+[A-Z]{2,}$/;
// Dominios reservados/ficticios (RFC 2606, RFC 6761) y los que genera el propio bot.
const FAKE_DOMAINS = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|local|ai\.local)$/i;

/**
 * Valida un correo como PII: formato y dominio no ficticio.
 * @param {string} value
 * @returns {{valid: boolean, reason: string, domain?: string}}
 */
export function validateEmail(value) {
  const v = String(value ?? '').trim();
  if (!EMAIL_RE.test(v.toUpperCase())) return no('format');
  const domain = v.slice(v.lastIndexOf('@') + 1).toLowerCase();
  if (FAKE_DOMAINS.test(domain)) return no('domain', { domain });
  return ok({ domain });
}

// Ladas mexicanas de 2 dígitos (55 CDMX, 33 GDL, 81 MTY); el resto son de 3 dígitos.
const LADA2 = new Set(['55', '33', '81', '56']);

/**
 * Valida un teléfono mexicano: 10 dígitos nacionales (con o sin +52 / 52 1) y lada plausible.
 * Rechaza bloques ficticios (555 0000 xxxx y dígitos repetidos/secuenciales).
 * @param {string} value
 * @returns {{valid: boolean, reason: string}}
 */
export function validateTelefonoMX(value) {
  const raw = String(value ?? '');
  if (/[^\d\s()+.\-]/.test(raw.trim())) return no('format');
  let v = digitsOnly(raw);
  if (v.startsWith('521') && v.length === 13) v = v.slice(3);
  else if (v.startsWith('52') && v.length === 12) v = v.slice(2);
  if (v.length !== 10) return no('length');
  // Primero los bloques ficticios: 1111111111 es "sintético", no "lada inválida".
  if (/^(\d)\1{9}$/.test(v)) return no('synthetic');
  if ('01234567890'.includes(v) || '09876543210'.includes(v)) return no('synthetic');
  if (v.slice(2, 6) === '0000') return no('synthetic');   // bloque ficticio del bot: +52 55 0000 xxxx
  const lada = LADA2.has(v.slice(0, 2)) ? v.slice(0, 2) : v.slice(0, 3);
  if (lada[0] === '0' || lada[0] === '1') return no('format');
  return ok();
}

/* ------------------------------------------------------------------------------------------ */
/* Registro de validadores y despacho por nombre (lo usan rules/pii.json y columns.mjs).        */
/* ------------------------------------------------------------------------------------------ */

/** Mapa nombre-de-validador → función (el campo `validator` de cada regla de rules/pii.json). */
export const validators = Object.freeze({
  validateRFC, validateCURP, validateCLABE, validateNSS, luhn, validateINE, validateIBAN,
  validateEmail, validateTelefonoMX,
});

/** Tipo de PII → validador (para columns.mjs y para el despacho por tipo). */
export const byType = Object.freeze({
  rfc: validateRFC, curp: validateCURP, clabe: validateCLABE, nss: validateNSS,
  tarjeta: luhn, ine: validateINE, iban: validateIBAN, email: validateEmail, telefono: validateTelefonoMX,
});

/**
 * Valida por nombre de tipo ('rfc'|'curp'|…). Tipo desconocido → {valid:false, reason:'format'}.
 * @param {string} type
 * @param {string} value
 * @param {object} [ctx] opciones del validador (p. ej. {before, after} para tarjeta)
 * @returns {{valid: boolean, reason: string}}
 */
export function validate(type, value, ctx = {}) {
  const fn = byType[String(type).toLowerCase()];
  return fn ? fn(value, ctx) : no('format');
}

/* ------------------------------------------------------------------------------------------ */
/* Reglas PII y applyPiiRule (lo llama engine-core por import dinámico).                        */
/* ------------------------------------------------------------------------------------------ */

let rulesCache = null;

/**
 * Carga `src/engine/rules/pii.json` (memoizado).
 * @returns {Array<object>} reglas con {id, category, severity, keywords, regex, flags, validator, …}
 */
export function loadPiiRules() {
  if (!rulesCache) {
    const url = new URL('./rules/pii.json', import.meta.url);
    rulesCache = JSON.parse(readFileSync(url, 'utf8')).rules;
  }
  return rulesCache;
}

/** Regla por id, o null. */
export function piiRule(ruleId) {
  return loadPiiRules().find((r) => r.id === ruleId) ?? null;
}

/** Palabras de contexto comunes a todas las reglas PII (además de las `keywords` de cada regla). */
export const CONTEXT_KEYWORDS = [
  'rfc', 'curp', 'clabe', 'cuenta', 'banco', 'nss', 'imss', 'tarjeta', 'pan', 'card', 'correo',
  'email', 'telefono', 'teléfono', 'celular', 'cliente', 'titular', 'beneficiario', 'empleado',
  'nomina', 'nómina', 'contribuyente', 'ine', 'elector', 'iban',
];

const wordRe = (words) => new RegExp(`(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');

/**
 * ¿Hay palabras de contexto en ±`radius` líneas alrededor de `line` (1-based)?
 * @param {string[]} lines
 * @param {number} line
 * @param {string[]} keywords
 * @param {number} [radius=2]
 * @returns {boolean}
 */
export function hasContext(lines, line, keywords, radius = 2) {
  if (!Array.isArray(lines) || !lines.length) return false;
  const re = wordRe(keywords);
  const from = Math.max(0, line - 1 - radius), to = Math.min(lines.length - 1, line - 1 + radius);
  for (let i = from; i <= to; i++) if (re.test(lines[i] ?? '')) return true;
  return false;
}

/** ¿Las primeras 5 líneas del texto llevan el marcador `bot-secure:synthetic`? */
export function hasSyntheticMarker(text) {
  return String(text ?? '').split(/\r?\n/, 5).some((l) => l.includes(SYNTHETIC_MARKER));
}

/**
 * Decide si una coincidencia de una regla PII es un hallazgo y con qué severidad.
 * La llama engine-core (import dinámico) por cada match de una regla de `rules/pii.json`.
 *
 * @param {object} match coincidencia
 * @param {string} match.value valor capturado (crudo, tal cual en el archivo)
 * @param {string} match.ruleId id de la regla (`rfc`, `curp`, `clabe`, `nss`, `tarjeta`, `ine`,
 *   `iban`, `email`, `telefono-mx`)
 * @param {number} match.line línea 1-based
 * @param {number} [match.column] columna 1-based
 * @param {object} [ctx] contexto del archivo
 * @param {string[]} [ctx.lines] líneas del archivo (para el contexto ±2)
 * @param {string} [ctx.lineText] línea donde ocurre (si no se pasan `lines`)
 * @param {string} [ctx.text] texto completo (para el marcador sintético)
 * @param {string} [ctx.path] ruta relativa (posix)
 * @param {string} [ctx.header] cabecera de columna si viene de csv/sql/xlsx
 * @param {number} [ctx.records=1] nº de registros del mismo tipo en el archivo (≥ 20 → HIGH)
 * @param {string} [ctx.before] carácter anterior al match (tarjetas: corrida de dígitos)
 * @param {string} [ctx.after] carácter siguiente al match
 * @param {boolean} [ctx.synthetic] el archivo está marcado como sintético
 * @returns {{drop: boolean, reason: string, severity?: string, verifiedChecksum?: boolean,
 *            maskKind?: string, context?: boolean, remediation?: {kind: string, action: string},
 *            detail?: object}}
 *   `drop:true` → no es hallazgo (reason dice por qué). Si `drop:false`, `severity` es la severidad
 *   final y `remediation.action` es una CLAVE i18n de `pii.json` que el llamador traduce con `t()`.
 */
export function applyPiiRule(match, ctx = {}) {
  const { value, ruleId, line = 1 } = match ?? {};
  const rule = piiRule(ruleId);
  if (!rule) return { drop: true, reason: 'format' };

  if (ctx.synthetic || (ctx.text && hasSyntheticMarker(ctx.text))) return { drop: true, reason: 'synthetic' };

  const fn = validators[rule.validator];
  const res = fn ? fn(value, { before: ctx.before ?? '', after: ctx.after ?? '' }) : no('format');
  if (!res.valid) return { drop: true, reason: res.reason, detail: res };

  const lines = ctx.lines ?? (ctx.lineText != null ? [ctx.lineText] : []);
  const keywords = [...(rule.keywords ?? []), ...CONTEXT_KEYWORDS];
  const headerHit = ctx.header ? wordRe(rule.keywords ?? CONTEXT_KEYWORDS).test(ctx.header) : false;
  const context = headerHit || hasContext(lines, line, keywords, rule.contextRadius ?? 2);

  // email/teléfono son PII demasiado común: sin contexto no se reportan (falsos positivos masivos).
  if (rule.requiresContext && !context) return { drop: true, reason: 'format' };

  const records = Number(ctx.records ?? 1);
  let severity = context ? (rule.severity ?? 'MEDIUM') : (rule.severityNoContext ?? 'LOW');
  if (records >= (rule.bulkThreshold ?? 20)) severity = 'HIGH';

  return {
    drop: false,
    reason: 'ok',
    severity,
    context,
    verifiedChecksum: rule.checksum !== false && res.checksum !== false,
    maskKind: rule.maskKind ?? ruleId,
    remediation: { kind: rule.remediation?.kind ?? 'pii', action: rule.remediation?.action ?? 'pii.remediation.identifier' },
    detail: res,
  };
}
