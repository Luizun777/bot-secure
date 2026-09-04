// Generador de archivos de ofimática MÍNIMOS para las pruebas (sin dependencias): un escritor zip
// (deflate raw + directorio central) y armadores de xlsx, docx y pdf.
// Se generan en tiempo de prueba para no versionar binarios y para poder variar el contenido.
// Los datos que se metan aquí deben ser SIEMPRE sintéticos.

import { deflateRawSync, deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC-32 (zip). */
export function crc32(buf) {
  let c = 0 ^ -1;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ -1) >>> 0;
}

/**
 * Construye un zip.
 * @param {Array<{name: string, data: string|Buffer, store?: boolean}>} files
 * @returns {Buffer}
 */
export function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const data = f.store ? raw : deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                    // versión necesaria
    local.writeUInt16LE(0, 6);                     // flags
    local.writeUInt16LE(f.store ? 0 : 8, 8);       // método
    local.writeUInt32LE(0, 10);                    // fecha/hora
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(f.store ? 0 : 8, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);

    offset += 30 + name.length + data.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * xlsx mínimo con sharedStrings: las celdas string van a la tabla compartida; si el valor casa
 * `^=NUM:` se escribe como número crudo (para simular la notación científica de Excel).
 * @param {Array<{name: string, rows: (string|number)[][]}>} sheets
 * @returns {Buffer}
 */
export function makeXlsx(sheets) {
  const strings = [];
  const idx = (v) => {
    const i = strings.indexOf(v);
    return i >= 0 ? i : strings.push(v) - 1;
  };
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${colLetter(c)}${r + 1}`;
        const raw = String(v ?? '');
        if (raw.startsWith('=NUM:')) return `<c r="${ref}"><v>${esc(raw.slice(5))}</v></c>`;
        return `<c r="${ref}" t="s"><v>${idx(raw)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });

  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
  ];
  sheetXml.forEach((xml, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml }));
  files.push({
    name: 'xl/sharedStrings.xml',
    data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
  });
  return makeZip(files);
}

/**
 * docx mínimo (word/document.xml con un `<w:p>` por párrafo).
 * @param {string[]} paragraphs
 * @returns {Buffer}
 */
export function makeDocx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join('');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'word/document.xml', data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
  ]);
}

/**
 * PDF mínimo de una página con el content stream comprimido con FlateDecode.
 * @param {string[]} lines
 * @returns {Buffer}
 */
export function makePdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td\n${lines.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n')}\nET`;
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n',
  ];
  const head = Buffer.from(`%PDF-1.4\n${objs.join('')}4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n', 'latin1');
  return Buffer.concat([head, stream, tail]);
}

/** Cabecera OLE/CFB (.xls, .doc) para probar la rama binaria. */
export function makeOle() {
  return Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 0)]);
}
