// Extracción de texto de archivos de ofimática SIN dependencias: lector zip mínimo (directorio
// central + inflateRawSync) para OOXML/ODF y descompresión de streams FlateDecode para PDF.
//
// Por qué existe (redteam-detector, hallazgo "la extracción de PDF/xlsx es inefectiva"): casi todo
// el PII de una empresa vive en un xlsx o un PDF, y leer el binario en crudo no encuentra nada; el
// equipo cree que está cubierto y no lo está. Riesgos que se controlan aquí:
//  - zip bomb: `maxOutputLength` por entrada, presupuesto total y ratio de compresión máximo.
//  - Excel trunca los números a 15 dígitos: una CLABE/NSS/tarjeta capturada como número aparece
//    como `1.2345678901234E+17` y su checksum falla → se avisa como "posible truncado".
//  - PDF con fuentes subset (Identity-H): los operandos Tj son IDs de glifo, no texto → partial.
//  - .xls/.doc/.ppt (OLE/CFB) no se pueden leer sin dependencias → {text:'', partial:true}.
//
// Todos los avisos se devuelven como {key, vars} (claves i18n de src/i18n/<lang>/pii.json); usa
// `translateWarnings(warnings, t)` para convertirlos a texto.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { decodeEntities } from './columns.mjs';

/* ------------------------------------------------------------------------------------------ */
/* Límites (anti zip-bomb / anti DoS).                                                          */
/* ------------------------------------------------------------------------------------------ */

export const LIMITS = Object.freeze({
  maxEntries: 200,          // entradas del zip que se leen
  maxEntryBytes: 32 * 1024 * 1024,   // 32 MB por entrada descomprimida
  maxTotalBytes: 64 * 1024 * 1024,   // 64 MB de presupuesto total por archivo
  maxRatio: 200,            // ratio descomprimido/comprimido admitido
  maxPdfStream: 32 * 1024 * 1024,
});

const ZIP_EXT = new Set(['xlsx', 'xlsm', 'xltx', 'docx', 'docm', 'dotx', 'pptx', 'pptm', 'odt', 'ods', 'odp']);
const OLE_EXT = new Set(['xls', 'doc', 'ppt', 'xlt', 'dot', 'pps']);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/* ------------------------------------------------------------------------------------------ */
/* Lector zip mínimo (directorio central).                                                      */
/* ------------------------------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;

/** Localiza el End Of Central Directory (últimos 64 KB + comentario). */
function findEocd(buf) {
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  return -1;
}

/**
 * Lista las entradas del zip leyendo el directorio central.
 * @param {Buffer} buf
 * @param {{warn: Function, path: string}} ctx
 * @returns {Array<{name: string, method: number, csize: number, usize: number, offset: number, encrypted: boolean}>}
 */
function zipEntries(buf, ctx) {
  const eocd = findEocd(buf);
  if (eocd < 0) { ctx.warn('office.badZip', {}); return []; }
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) { ctx.warn('office.zip64', {}); return []; }
  if (count > LIMITS.maxEntries) { ctx.warn('office.tooManyEntries', { limit: LIMITS.maxEntries }); count = LIMITS.maxEntries; }

  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, csize, usize, offset, encrypted: (flags & 0x1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Descomprime una entrada respetando los límites. Devuelve null si se omite.
 * @returns {Buffer|null}
 */
function readEntry(buf, entry, ctx) {
  if (entry.encrypted) { ctx.warn('office.encryptedEntry', { entry: entry.name }); return null; }
  if (entry.usize > LIMITS.maxEntryBytes) {
    ctx.warn('office.zipBomb', { entry: entry.name, mb: Math.round(entry.usize / 1048576), limit: Math.round(LIMITS.maxEntryBytes / 1048576) });
    ctx.partial = true;
    return null;
  }
  if (entry.csize > 0 && entry.usize / entry.csize > LIMITS.maxRatio) {
    ctx.warn('office.zipRatio', { entry: entry.name, ratio: Math.round(entry.usize / entry.csize) });
    ctx.partial = true;
    return null;
  }
  if (ctx.budget + entry.usize > LIMITS.maxTotalBytes) {
    ctx.warn('office.zipBudget', { limit: Math.round(LIMITS.maxTotalBytes / 1048576) });
    ctx.partial = true;
    return null;
  }
  if (entry.offset + 30 > buf.length || buf.readUInt32LE(entry.offset) !== LOC_SIG) { ctx.warn('office.badZip', {}); return null; }
  const nameLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + (entry.csize || (buf.length - start)));
  try {
    const data = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: LIMITS.maxEntryBytes });
    ctx.budget += data.length;
    return data;
  } catch {
    ctx.warn('office.inflateError', { entry: entry.name });
    ctx.partial = true;
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Utilidades XML.                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Texto de todas las etiquetas `<tag>…</tag>` (sin anidamiento), en orden. */
function tagTexts(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

/** Quita todas las etiquetas y decodifica entidades (último recurso). */
function stripTags(xml) {
  return decodeEntities(String(xml).replace(/<[^>]*>/g, ' ')).replace(/[ \t]+/g, ' ').trim();
}

/* ------------------------------------------------------------------------------------------ */
/* xlsx / xlsm.                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Letra de columna ("AB") → índice 0-based. */
export function colIndex(ref) {
  const letters = String(ref).replace(/\d+$/, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Notación científica que Excel produce al truncar números > 15 dígitos (CLABE, NSS, PAN).
const SCI_RE = /^-?\d(?:\.\d+)?E[+-]?\d+$/i;
// Cabeceras cuya columna numérica truncada importa (subconjunto del detector de columnas).
const NUMERIC_PII_HEADER = /(clabe|cuenta|tarjeta|card|pan|nss|imss|telefono|teléfono|celular|cp|codigo_?postal)/i;

/** sharedStrings.xml → arreglo de cadenas (concatenando los runs `<r><t>`). */
function sharedStrings(xml) {
  const out = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) out.push(tagTexts(m[1], 't').join(''));
  return out;
}

/** Una hoja → filas [[celda,…]] + avisos de celdas truncadas. */
function sheetRows(xml, strings, sheetName, ctx) {
  const rows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] ?? '', body = cm[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const idx = ref ? colIndex(ref) : cells.length;
      let value = '';
      if (type === 's') {
        const v = tagTexts(body, 'v')[0];
        value = strings[Number(v)] ?? '';
      } else if (type === 'inlineStr') {
        value = tagTexts(body, 't').join('');
      } else {
        value = tagTexts(body, 'v')[0] ?? tagTexts(body, 't')[0] ?? '';
        if (SCI_RE.test(value)) {
          const header = rows.length ? rows[0]?.[idx] : null;
          if (header && NUMERIC_PII_HEADER.test(String(header))) {
            ctx.warn('office.truncatedCell', { sheet: sheetName, cell: ref ?? '?', header });
            ctx.partial = true;
          }
        }
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Nombres de hoja en el orden del libro (xl/workbook.xml). */
function sheetNames(xml) {
  const out = [];
  const re = /<sheet\s[^>]*name="([^"]*)"[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

function extractXlsx(buf, ctx) {
  const entries = zipEntries(buf, ctx);
  const get = (name) => {
    const e = entries.find((x) => x.name === name);
    return e ? readEntry(buf, e, ctx)?.toString('utf8') ?? '' : '';
  };
  const strings = sharedStrings(get('xl/sharedStrings.xml'));
  const names = sheetNames(get('xl/workbook.xml'));

  const sheetEntries = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)[1]) - Number(b.name.match(/(\d+)\.xml$/)[1]));

  const sheets = [];
  const parts = [];
  sheetEntries.forEach((e, i) => {
    const xml = readEntry(buf, e, ctx)?.toString('utf8');
    if (!xml) return;
    // El orden de sheetN.xml no es necesariamente el del libro; se empareja por posición (aproximación).
    const name = names[i] ?? `Hoja${i + 1}`;
    const rows = sheetRows(xml, strings, name, ctx);
    sheets.push({ name, rows });
    for (const r of rows) if (r.length) parts.push(r.join('\t'));
  });

  for (const e of entries.filter((x) => /^xl\/(comments\d*\.xml|threadedComments\/.*\.xml)$/.test(x.name))) {
    const xml = readEntry(buf, e, ctx)?.toString('utf8');
    if (xml) parts.push(...tagTexts(xml, 't'));
  }
  if (strings.length && !sheets.length) parts.push(...strings);

  return { text: parts.join('\n'), rows: sheets };
}

/* ------------------------------------------------------------------------------------------ */
/* docx / pptx / odf.                                                                           */
/* ------------------------------------------------------------------------------------------ */

function extractOoxmlText(buf, ctx, { match, textTag, paraTag }) {
  const entries = zipEntries(buf, ctx);
  const parts = [];
  for (const e of entries.filter((x) => match.test(x.name))) {
    const xml = readEntry(buf, e, ctx)?.toString('utf8');
    if (!xml) continue;
    for (const chunk of xml.split(new RegExp(`</(?:\\w+:)?${paraTag}>`))) {
      const t = tagTexts(chunk, textTag).join('');
      if (t.trim()) parts.push(t);
    }
  }
  return { text: parts.join('\n') };
}

function extractOdf(buf, ctx) {
  const entries = zipEntries(buf, ctx);
  const parts = [];
  for (const e of entries.filter((x) => /^(content|styles)\.xml$/.test(x.name))) {
    const xml = readEntry(buf, e, ctx)?.toString('utf8');
    if (!xml) continue;
    for (const chunk of xml.split(/<\/text:p>/)) {
      const t = stripTags(chunk);
      if (t) parts.push(t);
    }
  }
  return { text: parts.join('\n') };
}

/* ------------------------------------------------------------------------------------------ */
/* PDF.                                                                                         */
/* ------------------------------------------------------------------------------------------ */

/** Convierte los operandos de texto de un content stream a texto plano. */
export function pdfContentText(content) {
  const out = [];
  let pending = [];
  const flush = () => { if (pending.length) { out.push(pending.join('')); pending = []; } };
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') { // literal string con escapes y paréntesis balanceados
      let depth = 1, s = '';
      for (i++; i < content.length && depth > 0; i++) {
        const c = content[i];
        if (c === '\\') {
          const n = content[++i];
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (n >= '0' && n <= '7') {
            let oct = n;
            while (oct.length < 3 && content[i + 1] >= '0' && content[i + 1] <= '7') oct += content[++i];
            s += String.fromCharCode(parseInt(oct, 8));
          } else s += map[n] ?? n ?? '';
        } else if (c === '(') { depth++; s += c; }
        else if (c === ')') { depth--; if (depth > 0) s += c; }
        else s += c;
      }
      i--;
      pending.push(s);
    } else if (ch === '<' && content[i + 1] !== '<') { // hex string
      const end = content.indexOf('>', i);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, '');
      let s = '';
      for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      pending.push(s);
      i = end;
    } else if (ch === 'T' && (content[i + 1] === 'j' || content[i + 1] === 'J')) { flush(); i++; }
    else if (ch === "'" || ch === '"') { flush(); out.push('\n'); }
    else if (ch === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D' || content[i + 1] === '*')) { flush(); out.push('\n'); i++; }
    else if (ch === 'E' && content[i + 1] === 'T') { flush(); out.push('\n'); i++; }
  }
  flush();
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

function extractPdf(buf, ctx) {
  const latin = buf.toString('latin1');
  if (/\/Encrypt\b/.test(latin)) { ctx.warn('office.pdfEncrypted', {}); ctx.partial = true; return { text: '' }; }
  const otherFilters = new Set();
  const parts = [];
  let i = 0;
  while ((i = latin.indexOf('stream', i)) !== -1) {
    const dictStart = latin.lastIndexOf('<<', i);
    const dict = dictStart >= 0 ? latin.slice(dictStart, i) : '';
    let start = i + 'stream'.length;
    if (latin[start] === '\r') start++;
    if (latin[start] === '\n') start++;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    i = end + 'endstream'.length;
    if (!/\/Filter/.test(dict)) continue;
    if (!/FlateDecode/.test(dict)) {
      for (const f of dict.match(/\/(\w*Decode|\w*DCT\w*)/g) ?? []) otherFilters.add(f.slice(1));
      continue;
    }
    const raw = buf.subarray(start, end);
    try {
      const inflated = inflateSync(raw, { maxOutputLength: LIMITS.maxPdfStream }).toString('latin1');
      if (/\bT[jJ]\b|\bTd\b|\bBT\b/.test(inflated)) parts.push(pdfContentText(inflated));
    } catch { /* stream no textual o dañado */ }
  }
  if (otherFilters.size) { ctx.warn('office.pdfOtherFilter', { filters: [...otherFilters].join(', ') }); ctx.partial = true; }
  if (/\/Identity-H|\/Subtype\s*\/Type0/.test(latin)) { ctx.warn('office.pdfSubsetFont', {}); ctx.partial = true; }
  const text = parts.join('\n').trim();
  if (!text) { ctx.warn('office.pdfNoText', {}); ctx.partial = true; }
  return { text };
}

/* ------------------------------------------------------------------------------------------ */
/* API pública.                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * Traduce los avisos `{key, vars}` con una función `t` de i18n.
 * @param {Array<{key: string, vars: object}>} warnings
 * @param {(key: string, vars?: object) => string} t
 * @returns {string[]}
 */
export function translateWarnings(warnings, t) {
  return (warnings ?? []).map((w) => t(w.key, w.vars));
}

/**
 * Extrae el texto de un archivo de ofimática.
 *
 * @param {string|Buffer} pathOrBuffer ruta del archivo o su contenido
 * @param {string} [ext] extensión con o sin punto; si falta se deduce de la ruta
 * @returns {{text: string, partial: boolean, kind: string, rows?: Array<{name: string, rows: string[][]}>,
 *            warnings: Array<{key: string, vars: object}>}}
 *   `partial:true` = el texto está incompleto (zip-bomb, fuentes subset, OLE, filtro no soportado):
 *   el llamador NO debe concluir "sin hallazgos". `rows` solo en xlsx (para columns.detectPiiColumns).
 */
export function extractText(pathOrBuffer, ext) {
  const isBuffer = Buffer.isBuffer(pathOrBuffer);
  const path = isBuffer ? '' : String(pathOrBuffer ?? '');
  if (!isBuffer && typeof pathOrBuffer !== 'string') {
    return { text: '', partial: true, kind: 'unknown', warnings: [{ key: 'office.badInput', vars: { type: typeof pathOrBuffer } }] };
  }

  const e = String(ext ?? extname(path)).toLowerCase().replace(/^\./, '');
  const warnings = [];
  const ctx = {
    partial: false, budget: 0,
    path: path ? basename(path) : '(buffer)',
    warn(key, vars) { warnings.push({ key, vars: { path: this.path, ...vars } }); },
  };

  let buf;
  if (isBuffer) buf = pathOrBuffer;
  else {
    try { buf = readFileSync(path); }
    catch (err) { return { text: '', partial: true, kind: 'unknown', warnings: [{ key: 'office.notFound', vars: { path: ctx.path, error: err.code ?? err.message } }] }; }
  }

  const done = (kind, res) => ({ text: res?.text ?? '', partial: ctx.partial, kind, ...(res?.rows ? { rows: res.rows } : {}), warnings });

  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE_MAGIC)) {
    ctx.partial = true;
    ctx.warn('office.ole', {});
    return done('ole', { text: '' });
  }
  if (OLE_EXT.has(e)) {
    ctx.partial = true;
    ctx.warn('office.ole', {});
    return done('ole', { text: '' });
  }
  if (e === 'pdf') return done('pdf', extractPdf(buf, ctx));

  if (ZIP_EXT.has(e)) {
    if (buf.length < 4 || buf.readUInt32LE(0) !== LOC_SIG) {
      ctx.partial = true;
      ctx.warn('office.badZip', {});
      return done(e, { text: '' });
    }
    if (e === 'xlsx' || e === 'xlsm' || e === 'xltx') return done('xlsx', extractXlsx(buf, ctx));
    if (e === 'docx' || e === 'docm' || e === 'dotx') return done('docx', extractOoxmlText(buf, ctx, { match: /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/, textTag: 't', paraTag: 'p' }));
    if (e === 'pptx' || e === 'pptm') return done('pptx', extractOoxmlText(buf, ctx, { match: /^ppt\/(slides|notesSlides)\/\w+\.xml$/, textTag: 't', paraTag: 'p' }));
    return done(e, extractOdf(buf, ctx));
  }

  ctx.partial = true;
  ctx.warn('office.unsupported', { ext: e || '(sin extensión)' });
  return done('unknown', { text: '' });
}

/** Extensiones que `extractText` sabe abrir (las usa el walker del engine). */
export const OFFICE_EXTENSIONS = Object.freeze([...ZIP_EXT, ...OLE_EXT, 'pdf']);
