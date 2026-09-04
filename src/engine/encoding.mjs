// Detección de codificación (BOM, UTF-16 sin BOM, binario) y preprocesados (data URIs, .ipynb, punteros LFS).

/** @typedef {{text: string, encoding: 'utf8'|'utf8-bom'|'utf16le'|'utf16be'|'binary', binary: boolean}} Decoded */

const SAMPLE = 8192;

function swapBytes(buf) {
  const out = Buffer.allocUnsafe(buf.length - (buf.length % 2));
  for (let i = 0; i + 1 < buf.length; i += 2) { out[i] = buf[i + 1]; out[i + 1] = buf[i]; }
  return out;
}

/** Heurística sin BOM: NUL en posiciones alternas ≥ 90 % → UTF-16; NUL no alterno → binario. */
function sniffNul(buf) {
  const n = Math.min(buf.length, SAMPLE);
  let odd = 0, even = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) { if (i % 2) odd++; else even++; }
  const total = odd + even;
  if (total === 0) return 'utf8';
  const half = Math.max(1, Math.floor(n / 2));
  if (total >= 4 && total >= 0.3 * half) {
    if (odd / total >= 0.9) return 'utf16le';
    if (even / total >= 0.9) return 'utf16be';
  }
  return 'binary';
}

/**
 * Decodifica un buffer a texto UTF-8 en memoria.
 * @param {Buffer} buf
 * @returns {Decoded}
 */
export function decode(buf) {
  if (!buf || !buf.length) return { text: '', encoding: 'utf8', binary: false };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le', binary: false };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: swapBytes(buf.subarray(2)).toString('utf16le'), encoding: 'utf16be', binary: false };
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8-bom', binary: false };
  const kind = sniffNul(buf);
  if (kind === 'utf16le') return { text: buf.toString('utf16le').replace(/^﻿/, ''), encoding: 'utf16le', binary: false };
  if (kind === 'utf16be') return { text: swapBytes(buf).toString('utf16le').replace(/^﻿/, ''), encoding: 'utf16be', binary: false };
  if (kind === 'binary') return { text: '', encoding: 'binary', binary: true };
  return { text: buf.toString('utf8'), encoding: 'utf8', binary: false };
}

const DATA_URI_RE = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g;

/** Elimina el cuerpo de `data:*;base64,…` (no altera saltos de línea → números de línea estables). */
export function stripDataUris(text) {
  if (!text.includes(';base64,')) return text;
  return text.replace(DATA_URI_RE, (m) => m.slice(0, m.indexOf(',') + 1));
}

/** Puntero de Git LFS. */
export function isLfsPointer(text) {
  return typeof text === 'string' && text.startsWith('version https://git-lfs.github.com/spec/v1');
}

/**
 * .ipynb: devuelve solo las líneas de `source[]` de cada celda y un mapa línea-virtual → línea real.
 * @returns {{text: string, lineMap: number[]}|null}
 */
export function ipynbSources(text) {
  let nb;
  try { nb = JSON.parse(text); } catch { return null; }
  if (!nb || !Array.isArray(nb.cells)) return null;
  const rawLines = text.split('\n');
  const out = []; const lineMap = [];
  let cursor = 0;
  for (const cell of nb.cells) {
    const src = Array.isArray(cell.source) ? cell.source : typeof cell.source === 'string' ? cell.source.split(/(?<=\n)/) : [];
    for (const piece of src) {
      const line = piece.replace(/\n$/, '');
      // localiza la línea en el JSON original (búsqueda hacia adelante desde el último acierto)
      const needle = JSON.stringify(line).slice(1, -1);
      let found = -1;
      for (let i = cursor; i < rawLines.length; i++) if (needle && rawLines[i].includes(needle)) { found = i; break; }
      if (found >= 0) cursor = found + 1;
      out.push(line); lineMap.push(found >= 0 ? found + 1 : (lineMap[lineMap.length - 1] ?? 1));
    }
  }
  return { text: out.join('\n'), lineMap };
}

/** Magia de keystores: PKCS#12/PFX (30 82), JKS (FE ED FE ED), JCEKS (CE CE CE CE). */
export function keystoreMagic(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x30 && buf[1] === 0x82) return 'pkcs12';
  if (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfe && buf[3] === 0xed) return 'jks';
  if (buf[0] === 0xce && buf[1] === 0xce && buf[2] === 0xce && buf[3] === 0xce) return 'jceks';
  return null;
}
