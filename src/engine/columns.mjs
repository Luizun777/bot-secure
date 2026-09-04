// Detector de PII "por columna": una tabla de personas reales es peor que un dato suelto, y el
// escáner de línea no la ve (un CSV de 25 clientes con nombre + RFC + CLABE son 25 hallazgos LOW
// dispersos en vez de un HIGH claro). Se aplica a TODO el repo (csv, tsv, json, jsonl, yaml, xml,
// sql y filas ya extraídas de xlsx); la carpeta solo modula la severidad.
//
// Umbral (plan §Motor de detección): >= 3 filas con >= 2 columnas PII y al menos una validada por
// checksum/estructura -> MEDIUM; >= 20 filas -> HIGH. Archivos con `bot-secure:synthetic` en las
// primeras 5 líneas -> nada (son los seeds que genera el propio bot).

import { degrade } from './severity.mjs';
import { byType, hasSyntheticMarker } from './pii-mx.mjs';

/* ------------------------------------------------------------------------------------------ */
/* Cabeceras ES/EN -> tipo de PII.                                                             */
/* ------------------------------------------------------------------------------------------ */

// Orden importante: la primera que casa gana (p. ej. `codigo_postal` antes que `codigo`).
const HEADER_PATTERNS = [
  ['rfc', /^(rfc|rfc_?(cliente|emisor|receptor|empleado)?|tax_?id|taxid)$/],
  ['curp', /^(curp|curp_?\w*)$/],
  ['nss', /^(nss|n_?s_?s|imss|num(ero)?_?seguro_?social|seguro_?social|social_?security)$/],
  ['clabe', /^(clabe|clabe_?\w*|cuenta_?clabe|interbancaria)$/],
  ['tarjeta', /^(tarjeta|no_?tarjeta|num(ero)?_?tarjeta|card|card_?number|cardnumber|pan|cc_?num(ber)?)$/],
  ['ine', /^(ine|ife|clave_?(de_?)?elector|elector)$/],
  ['iban', /^(iban)$/],
  ['email', /^(correo|correo_?e(lectronico)?|email|e_?mail|mail)$/],
  ['telefono', /^(tel|tel_?\w*|telefono|telefonos|tele[fp]ono|celular|movil|phone|phone_?number|mobile|whatsapp)$/],
  ['cp', /^(cp|c_?p|codigo_?postal|cod_?postal|zip|zip_?code|postal_?code)$/],
  ['fecha_nac', /^(fecha_?nac(imiento)?|f_?nac|nacimiento|birth|birth_?date|birthdate|dob|date_?of_?birth)$/],
  ['nombre', /^(nombre|nombres|nombre_?completo|first_?name|given_?name|name|full_?name|fullname)$/],
  ['apellido', /^(apellido|apellidos|apellido_?(paterno|materno)|last_?name|lastname|surname|family_?name)$/],
  ['razon_social', /^(razon_?social|razón_?social|empresa|company|company_?name|business_?name)$/],
  ['domicilio', /^(domicilio|direccion|dirección|calle|numero_?ext(erior)?|address|address_?\d?|street|street_?address)$/],
  ['colonia', /^(colonia|col|barrio|neighborhood|suburb)$/],
];

/** Tipos con validación estructural (checksum/catálogo): al menos uno debe validar para reportar. */
export const STRUCTURED_TYPES = new Set(['rfc', 'curp', 'nss', 'clabe', 'tarjeta', 'ine', 'iban', 'email', 'telefono']);

/** Normaliza una cabecera: minúsculas, sin acentos, sin espacios/puntos (a `_`), sin comillas. */
export function normalizeHeader(name) {
  return String(name ?? '').trim().replace(/^["'`[]+|["'`\]]+$/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s.\-/]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Clasifica una cabecera de columna.
 * @param {string} name
 * @returns {string|null} tipo de PII ('rfc'|'curp'|…|'nombre'|'domicilio') o null
 */
export function classifyHeader(name) {
  const n = normalizeHeader(name);
  if (!n) return null;
  for (const [type, re] of HEADER_PATTERNS) if (re.test(n)) return type;
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Parsers de tablas: cada uno devuelve [{name, headers, rows, line}].                          */
/* ------------------------------------------------------------------------------------------ */

/** Divide una línea delimitada respetando comillas dobles (RFC 4180) y simples. */
function splitDelimited(line, delim) {
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        if (line[i + 1] === quote) { cur += quote; i++; } else quote = null;
      } else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Delimitador más probable de un texto delimitado. */
function guessDelimiter(headerLine, ext) {
  if (ext === 'tsv') return '\t';
  const counts = [',', ';', '\t', '|'].map((d) => [d, headerLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

/** csv/tsv → una tabla. */
function parseDelimited(text, ext, name) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const delim = guessDelimiter(lines[0], ext);
  const headers = splitDelimited(lines[0], delim);
  const rows = lines.slice(1).map((l) => splitDelimited(l, delim));
  return [{ name, headers, rows, line: 1 }];
}

/** Encuentra el primer arreglo de objetos dentro de un JSON (profundidad ≤ 3). */
function findRecordArray(node, depth = 0) {
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return node;
    return null;
  }
  if (node && typeof node === 'object' && depth < 3) {
    for (const v of Object.values(node)) { const f = findRecordArray(v, depth + 1); if (f) return f; }
  }
  return null;
}

/** json / jsonl / ndjson → una tabla. */
function parseJsonish(text, ext, name) {
  let records = null;
  if (ext === 'jsonl' || ext === 'ndjson') {
    records = [];
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) records.push(o); } catch { /* línea no JSON */ }
    }
  } else {
    try { records = findRecordArray(JSON.parse(text)); } catch { return []; }
  }
  if (!records || records.length === 0) return [];
  const headerSet = [];
  for (const r of records.slice(0, 50)) for (const k of Object.keys(r)) if (!headerSet.includes(k)) headerSet.push(k);
  const rows = records.map((r) => headerSet.map((h) => (r[h] == null || typeof r[h] === 'object' ? '' : String(r[h]))));
  return [{ name, headers: headerSet, rows, line: 1 }];
}

/** yaml (mínimo): secuencia de mapas `- clave: valor` con continuación indentada. */
function parseYamlish(text, name) {
  const records = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    let m = /^\s*-\s+([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (m) { if (cur) records.push(cur); cur = { [m[1]]: unquote(m[2]) }; continue; }
    if (/^\s*-\s*$/.test(line)) { if (cur) records.push(cur); cur = {}; continue; }
    m = /^\s+([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (m && cur) { cur[m[1]] = unquote(m[2]); continue; }
    if (/^\S/.test(line) && cur) { records.push(cur); cur = null; }
  }
  if (cur) records.push(cur);
  if (records.length === 0) return [];
  const headers = [];
  for (const r of records) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  const rows = records.map((r) => headers.map((h) => r[h] ?? ''));
  return [{ name, headers, rows, line: 1 }];
}

const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '');

/** xml: el elemento repetido más frecuente que contiene hijos hoja es la "fila". */
function parseXml(text, name) {
  const src = String(text);
  const blocks = new Map(); // tag → [{inner, index}]
  const re = /<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([\s\S]{0,20000}?)<\/\1>/g;
  let m, guard = 0;
  while ((m = re.exec(src)) && guard++ < 20000) {
    // Se retrocede el cursor para poder ver también los elementos ANIDADOS (el regex no recursa):
    // `<clientes><cliente>…` casaría solo con `clientes` si avanzáramos al final del bloque.
    re.lastIndex = m.index + 1;
    if (!/<[A-Za-z_]/.test(m[2])) continue;
    if (!blocks.has(m[1])) blocks.set(m[1], []);
    blocks.get(m[1]).push({ inner: m[2], index: m.index });
  }
  let best = null;
  for (const [tag, list] of blocks) {
    if (list.length < 2) continue;
    if (!best || list.length > best.list.length) best = { tag, list };
  }
  if (!best) return [];
  const records = best.list.map(({ inner }) => {
    const rec = {};
    const leaf = /<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
    let n;
    while ((n = leaf.exec(inner))) rec[n[1]] = decodeEntities(n[2]);
    return rec;
  });
  const headers = [];
  for (const r of records) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  if (!headers.length) return [];
  const rows = records.map((r) => headers.map((h) => r[h] ?? ''));
  const line = src.slice(0, best.list[0].index).split('\n').length;
  return [{ name: `${name}:${best.tag}`, headers, rows, line }];
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Decodifica entidades XML básicas y numéricas. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (full, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return ENTITIES[code] ?? full;
  });
}

/** Trocea la lista de valores de una tupla SQL respetando comillas y paréntesis de funciones. */
function splitSqlTuple(s) {
  const out = [];
  let cur = '', quote = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { if (s[i + 1] === quote) { cur += ch; i++; } else quote = null; }
      else if (ch === '\\' && quote === "'") { cur += s[i + 1] ?? ''; i++; }
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.map((v) => (v.toUpperCase() === 'NULL' ? '' : v));
}

/** Extrae las tuplas `(...),(...)` de un VALUES multifila. */
function sqlTuples(src) {
  const tuples = [];
  let depth = 0, start = -1, quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) { if (src[i + 1] === quote) i++; else quote = null; }
      else if (ch === '\\' && quote === "'") i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { if (depth === 0) start = i + 1; depth++; continue; }
    if (ch === ')') { depth--; if (depth === 0 && start >= 0) { tuples.push(src.slice(start, i)); start = -1; } continue; }
    if (ch === ';' && depth === 0) break;
  }
  return tuples;
}

/** sql: `INSERT INTO t (c) VALUES (…),(…)` multifila y `COPY t (c) FROM stdin` de pg_dump. */
function parseSql(text, name) {
  const src = String(text);
  const tables = new Map(); // tabla|cols → {headers, rows, line}
  const insertRe = /INSERT\s+(?:IGNORE\s+)?INTO\s+([`"[\]\w.]+)\s*(\(([^)]*)\))?\s*VALUES\s*/gi;
  let m;
  while ((m = insertRe.exec(src))) {
    const table = cleanIdent(m[1]);
    const headers = m[3] ? m[3].split(',').map(cleanIdent) : [];
    const tuples = sqlTuples(src.slice(m.index + m[0].length));
    if (!tuples.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const key = `${table}`;
    if (!tables.has(key)) tables.set(key, { name: table, headers, rows: [], line });
    const t = tables.get(key);
    if (!t.headers.length && headers.length) t.headers = headers;
    for (const tup of tuples) t.rows.push(splitSqlTuple(tup).map(stripSqlLiteral));
  }
  const copyRe = /COPY\s+([`"[\]\w.]+)\s*\(([^)]*)\)\s+FROM\s+stdin[^\n]*\n/gi;
  while ((m = copyRe.exec(src))) {
    const table = cleanIdent(m[1]);
    const headers = m[2].split(',').map(cleanIdent);
    const rest = src.slice(m.index + m[0].length);
    const end = rest.search(/^\\\.$/m);
    const body = end === -1 ? rest : rest.slice(0, end);
    const rows = body.split('\n').filter((l) => l.trim() !== '').map((l) => l.split('\t').map((v) => (v === '\\N' ? '' : v)));
    if (!rows.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const key = `copy:${table}`;
    if (!tables.has(key)) tables.set(key, { name: table, headers, rows: [], line });
    tables.get(key).rows.push(...rows);
  }
  return [...tables.values()].filter((t) => t.headers.length && t.rows.length);
}

const cleanIdent = (s) => String(s).trim().replace(/^[`"[]+|[`"\]]+$/g, '').split('.').pop();
const stripSqlLiteral = (v) => String(v).trim().replace(/^N?'([\s\S]*)'$/, '$1').replace(/''/g, "'");

/**
 * Parsea el texto a tablas según la extensión.
 * @param {string} text
 * @param {{ext?: string, path?: string, rows?: Array}} [opts]
 * @returns {Array<{name: string, headers: string[], rows: string[][], line: number}>}
 */
export function parseTables(text, { ext = '', path = '', rows = null } = {}) {
  const name = path ? String(path).split(/[\\/]/).pop() : 'tabla';
  if (rows) return fromRows(rows, name);
  const e = String(ext || (path.includes('.') ? path.split('.').pop() : '')).toLowerCase().replace(/^\./, '');
  switch (e) {
    case 'csv': case 'tsv': case 'txt': return parseDelimited(text, e, name);
    case 'json': case 'jsonl': case 'ndjson': return parseJsonish(text, e, name);
    case 'yaml': case 'yml': return parseYamlish(text, name);
    case 'xml': case 'resx': case 'plist': return parseXml(text, name);
    case 'sql': case 'dump': case 'psql': return parseSql(text, name);
    default: return [];
  }
}

/** Filas ya extraídas (xlsx): `[[h,…],[…]]` o `[{name, rows}]`. La fila 1 son las cabeceras. */
function fromRows(rows, name) {
  const sheets = Array.isArray(rows) && rows.length && !Array.isArray(rows[0]) && rows[0]?.rows
    ? rows : [{ name, rows }];
  const out = [];
  for (const sheet of sheets) {
    const r = (sheet.rows ?? []).map((x) => (Array.isArray(x) ? x.map((v) => (v == null ? '' : String(v))) : []));
    if (r.length < 2) continue;
    out.push({ name: sheet.name ?? name, headers: r[0], rows: r.slice(1), line: 1 });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Severidad por carpeta (solo modula: nunca es el motivo del hallazgo).                        */
/* ------------------------------------------------------------------------------------------ */

const TEST_LIKE = /(^|[\\/])(test|tests|__tests__|spec|specs|fixtures?|mocks?|samples?|examples?|demo)([\\/]|$)/i;
const DATA_LIKE = /(^|[\\/])(data|datos|db|sql|dump|dumps|export|exports|backup|backups|migrations?|seeds?|clientes|customers)([\\/]|$)/i;

/**
 * Modula la severidad según la carpeta. La carpeta NUNCA es el motivo del hallazgo (redteam: los
 * exports reales viven fuera de `seeds|fixtures`), así que solo baja un nivel en rutas de prueba
 * y solo si esa ruta no es a la vez de datos (`test/data/clientes.csv` no se degrada).
 * @param {string} severity severidad base por número de filas
 * @param {string} path ruta relativa
 * @returns {string}
 */
export function severityForPath(severity, path = '') {
  const p = String(path);
  if (TEST_LIKE.test(p) && !DATA_LIKE.test(p)) return degrade(severity);
  return severity;
}

/* ------------------------------------------------------------------------------------------ */
/* Detector.                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const MIN_ROWS = 3, BULK_ROWS = 20, MIN_PII_COLS = 2, SAMPLE_ROWS = 200;

/**
 * Detecta tablas con datos personales.
 *
 * @param {string} text contenido del archivo (vacío si se pasan `rows`)
 * @param {object} [opts]
 * @param {string} [opts.path] ruta relativa (posix) — solo modula severidad y nombra la tabla
 * @param {string} [opts.ext] extensión sin punto (csv|tsv|json|jsonl|yaml|xml|sql); si falta se
 *   deduce de `path`
 * @param {Array} [opts.rows] filas ya extraídas (xlsx): `[[cab…],[…]]` o `[{name, rows}]`
 * @param {boolean} [opts.synthetic] forzar "archivo sintético" (no reportar)
 * @returns {Array<{ruleId: string, category: 'pii', severity: string, kind: 'table'|'sheet',
 *   table: string, line: number, rows: number, columns: {name: string, type: string, validated: boolean}[],
 *   types: string[], message: {key: string, vars: object}, remediation: {kind: string, action: string}}>}
 *   Nunca incluye valores: solo nombres de columna y conteos.
 */
export function detectPiiColumns(text, { path = '', ext = '', rows = null, synthetic = false } = {}) {
  if (synthetic || (text && hasSyntheticMarker(text))) return [];
  const tables = parseTables(text ?? '', { ext, path, rows });
  const isSheet = Boolean(rows);
  const findings = [];

  for (const table of tables) {
    const dataRows = table.rows.filter((r) => r.some((v) => String(v ?? '').trim() !== ''));
    if (dataRows.length < MIN_ROWS) continue;

    const cols = [];
    for (let i = 0; i < table.headers.length; i++) {
      const type = classifyHeader(table.headers[i]);
      if (!type) continue;
      let validated = false;
      if (STRUCTURED_TYPES.has(type)) {
        const fn = byType[type];
        for (const row of dataRows.slice(0, SAMPLE_ROWS)) {
          const v = String(row[i] ?? '').trim();
          if (v && fn && fn(v).valid) { validated = true; break; }
        }
      }
      cols.push({ name: String(table.headers[i]).trim(), type, validated, index: i });
    }

    if (cols.length < MIN_PII_COLS) continue;
    if (!cols.some((c) => c.validated)) continue; // sin al menos un identificador validado no se reporta

    let severity = dataRows.length >= BULK_ROWS ? 'HIGH' : 'MEDIUM';
    severity = severityForPath(severity, path);
    const types = [...new Set(cols.map((c) => c.type))];

    findings.push({
      ruleId: 'pii-columns',
      category: 'pii',
      severity,
      kind: isSheet ? 'sheet' : 'table',
      table: table.name,
      line: table.line,
      rows: dataRows.length,
      columns: cols,
      types,
      message: {
        key: 'pii.columns.finding',
        vars: { rows: dataRows.length, cols: cols.length, types: types.join(', '), table: table.name },
      },
      remediation: { kind: 'pii', action: 'pii.remediation.columns' },
    });
  }
  return findings;
}
