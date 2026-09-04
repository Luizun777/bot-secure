import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { extractText, colIndex, pdfContentText, translateWarnings, LIMITS, OFFICE_EXTENSIONS } from '../../src/engine/office.mjs';
import { detectPiiColumns } from '../../src/engine/columns.mjs';
import { makeZip, makeXlsx, makeDocx, makePdf, makeOle } from '../fixtures/office/make.mjs';

// Datos SINTÉTICOS (RFC de personas morales públicas y CURP generada); nunca PII real.
const RFC = 'SAT970701NN3';
const CURP = 'MUMG620322HSRNZS27';
const CLABE = '012180001234567895';

const keys = (r) => r.warnings.map((w) => w.key);

/* ---------------------------------------------------------------------------------------- */
/* xlsx                                                                                      */
/* ---------------------------------------------------------------------------------------- */

test('xlsx: sharedStrings + sheet1 → texto y filas con la cabecera en la fila 1', () => {
  const buf = makeXlsx([{
    name: 'Clientes',
    rows: [
      ['nombre', 'rfc', 'curp'],
      ['Ana Ruiz', RFC, CURP],
      ['Luis Paz', 'CFE370814QI0', CURP],
      ['Mar Sosa', 'BBA830831LJ2', CURP],
    ],
  }]);
  const r = extractText(buf, 'xlsx');
  assert.equal(r.kind, 'xlsx');
  assert.equal(r.partial, false);
  assert.match(r.text, new RegExp(RFC));
  assert.match(r.text, new RegExp(CURP));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].name, 'Clientes');
  assert.deepEqual(r.rows[0].rows[0], ['nombre', 'rfc', 'curp']);
  assert.equal(r.rows[0].rows.length, 4);
});

test('xlsx: las filas extraídas alimentan al detector de columnas', () => {
  const rows = [['nombre', 'rfc', 'curp'], ['Ana', RFC, CURP], ['Luis', 'CFE370814QI0', CURP], ['Mar', 'BBA830831LJ2', CURP]];
  const buf = makeXlsx([{ name: 'Hoja1', rows }]);
  const r = extractText(buf, 'xlsx');
  const f = detectPiiColumns('', { path: 'data/clientes.xlsx', rows: r.rows });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'sheet');
  assert.equal(f[0].rows, 3);
});

test('xlsx: varias hojas y ruta en disco', () => {
  const buf = makeXlsx([
    { name: 'Uno', rows: [['rfc'], [RFC]] },
    { name: 'Dos', rows: [['curp'], [CURP]] },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-office-'));
  const file = join(dir, 'libro.xlsx');
  writeFileSync(file, buf);
  const r = extractText(file);           // extensión deducida de la ruta
  assert.equal(r.kind, 'xlsx');
  assert.deepEqual(r.rows.map((s) => s.name), ['Uno', 'Dos']);
  assert.match(r.text, new RegExp(CURP));
});

test('xlsx: celda numérica en notación científica bajo cabecera PII → aviso de truncado + partial', () => {
  const buf = makeXlsx([{
    name: 'Cuentas',
    rows: [['nombre', 'clabe'], ['Ana', '=NUM:1.2345678901234E+17'], ['Luis', CLABE]],
  }]);
  const r = extractText(buf, 'xlsx');
  assert.equal(r.partial, true, 'Excel trunca a 15 dígitos: el archivo queda como parcial');
  assert.ok(keys(r).includes('office.truncatedCell'));
  const w = r.warnings.find((x) => x.key === 'office.truncatedCell');
  assert.equal(w.vars.sheet, 'Cuentas');
  assert.equal(w.vars.header, 'clabe');
  assert.equal(w.vars.cell, 'B2');
});

test('xlsx: notación científica bajo cabecera NO sensible no genera aviso', () => {
  const buf = makeXlsx([{ name: 'Ventas', rows: [['producto', 'total'], ['x', '=NUM:1.2345678901234E+17']] }]);
  const r = extractText(buf, 'xlsx');
  assert.equal(r.partial, false);
  assert.deepEqual(r.warnings, []);
});

test('xlsx: comentarios de celda también se leen', () => {
  const base = makeXlsx([{ name: 'H', rows: [['a'], ['b']] }]);
  // se reconstruye el zip añadiendo xl/comments1.xml
  const buf = makeZip([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="H" sheetId="1"/></sheets></workbook>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row></sheetData></worksheet>' },
    { name: 'xl/comments1.xml', data: `<?xml version="1.0"?><comments><commentList><comment ref="A1"><text><t>CURP del titular: ${CURP}</t></text></comment></commentList></comments>` },
  ]);
  assert.ok(base.length > 0);
  const r = extractText(buf, 'xlsx');
  assert.match(r.text, new RegExp(CURP));
});

test('colIndex traduce la referencia de columna', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('B12'), 1);
  assert.equal(colIndex('Z1'), 25);
  assert.equal(colIndex('AA1'), 26);
  assert.equal(colIndex('AB3'), 27);
});

/* ---------------------------------------------------------------------------------------- */
/* docx / odt                                                                                */
/* ---------------------------------------------------------------------------------------- */

test('docx: un párrafo por línea, entidades decodificadas', () => {
  // makeDocx escapa el XML, así que esto prueba el viaje de ida y vuelta de las entidades.
  const r = extractText(makeDocx([`RFC del proveedor: ${RFC}`, 'Área de nómina & tesorería <urgente>']), 'docx');
  assert.equal(r.kind, 'docx');
  assert.equal(r.partial, false);
  assert.deepEqual(r.text.split('\n'), [`RFC del proveedor: ${RFC}`, 'Área de nómina & tesorería <urgente>']);
});

test('odt: content.xml con text:p', () => {
  const buf = makeZip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
    { name: 'content.xml', data: `<?xml version="1.0"?><office:document-content><office:body><text:p>CURP: ${CURP}</text:p><text:p>Segunda línea</text:p></office:body></office:document-content>` },
  ]);
  const r = extractText(buf, 'odt');
  assert.match(r.text, new RegExp(CURP));
  assert.match(r.text, /Segunda línea/);
});

/* ---------------------------------------------------------------------------------------- */
/* pdf                                                                                       */
/* ---------------------------------------------------------------------------------------- */

test('pdf: stream FlateDecode con operandos Tj → texto', () => {
  const r = extractText(makePdf([`CURP: ${CURP}`, `RFC: ${RFC}`, 'Cuenta (CLABE) 012…']), 'pdf');
  assert.equal(r.kind, 'pdf');
  assert.equal(r.partial, false);
  assert.match(r.text, new RegExp(CURP));
  assert.match(r.text, new RegExp(RFC));
  assert.match(r.text, /Cuenta \(CLABE\)/, 'los paréntesis escapados se recuperan');
});

test('pdf: con fuentes subset (Identity-H) → partial + aviso', () => {
  const base = makePdf([`RFC: ${RFC}`]).toString('latin1');
  const conFuente = Buffer.from(base.replace('%%EOF', '5 0 obj\n<< /Subtype /Type0 /Encoding /Identity-H >>\nendobj\n%%EOF'), 'latin1');
  const r = extractText(conFuente, 'pdf');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.pdfSubsetFont'));
});

test('pdf cifrado → sin texto, partial y aviso', () => {
  const buf = Buffer.from('%PDF-1.4\ntrailer\n<< /Encrypt 9 0 R /Root 1 0 R >>\n%%EOF', 'latin1');
  const r = extractText(buf, 'pdf');
  assert.equal(r.text, '');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.pdfEncrypted'));
});

test('pdf sin texto extraíble → aviso pdfNoText (nunca "sin hallazgos" en silencio)', () => {
  const buf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF', 'latin1');
  const r = extractText(buf, 'pdf');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.pdfNoText'));
});

test('pdf con filtro distinto de FlateDecode → aviso pdfOtherFilter', () => {
  const stream = Buffer.from('binario');
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.4\n4 0 obj\n<< /Length 7 /Filter /DCTDecode >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const r = extractText(buf, 'pdf');
  assert.ok(keys(r).includes('office.pdfOtherFilter'));
  assert.equal(r.partial, true);
});

test('pdfContentText: literales con escapes, octales y cadenas hex', () => {
  assert.equal(pdfContentText('BT (Hola\\040mundo) Tj ET'), 'Hola mundo\n');
  assert.equal(pdfContentText('BT (a\\(b\\)) Tj ET'), 'a(b)\n');
  assert.equal(pdfContentText('BT <48656C6C6F> Tj ET'), 'Hello\n');
});

/* ---------------------------------------------------------------------------------------- */
/* OLE, límites y errores                                                                    */
/* ---------------------------------------------------------------------------------------- */

test('.xls/.doc (OLE) → text vacío, partial y kind ole', () => {
  const r = extractText(makeOle(), 'xls');
  assert.deepEqual({ text: r.text, partial: r.partial, kind: r.kind }, { text: '', partial: true, kind: 'ole' });
  assert.ok(keys(r).includes('office.ole'));
  // también por magic aunque la extensión diga xlsx (Office cifrado)
  assert.equal(extractText(makeOle(), 'xlsx').kind, 'ole');
});

test('zip-bomb: una entrada que declara más de 32 MB se omite y el archivo queda parcial', () => {
  // Se falsea el tamaño descomprimido en el directorio central sin generar 32 MB reales.
  const buf = makeXlsx([{ name: 'H', rows: [['rfc'], [RFC]] }]);
  const eocd = buf.length - 22;
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === 'xl/worksheets/sheet1.xml') buf.writeUInt32LE(LIMITS.maxEntryBytes + 1, p + 24);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  const r = extractText(buf, 'xlsx');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.zipBomb'));
  const w = r.warnings.find((x) => x.key === 'office.zipBomb');
  assert.equal(w.vars.limit, 32);
});

test('zip-bomb: ratio de compresión desproporcionado se omite', () => {
  const raw = Buffer.alloc(400000, 0x41);           // 400 KB de 'A' → comprime > 200:1
  const deflated = deflateRawSync(raw);
  assert.ok(raw.length / deflated.length > LIMITS.maxRatio);
  const buf = makeZip([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="H" sheetId="1"/></sheets></workbook>' },
    { name: 'xl/worksheets/sheet1.xml', data: raw },
  ]);
  const r = extractText(buf, 'xlsx');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.zipRatio'));
});

test('zip dañado / no zip → badZip y partial', () => {
  const r = extractText(Buffer.from('esto no es un zip'), 'docx');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.badZip'));
});

test('archivo inexistente y entrada no válida no lanzan', () => {
  const r = extractText(join(tmpdir(), 'no-existe-bot-secure.xlsx'), 'xlsx');
  assert.equal(r.partial, true);
  assert.ok(keys(r).includes('office.notFound'));
  const b = extractText(42, 'xlsx');
  assert.ok(keys(b).includes('office.badInput'));
});

test('extensión no soportada → unsupported', () => {
  const r = extractText(Buffer.from('x'), 'rtf');
  assert.equal(r.kind, 'unknown');
  assert.ok(keys(r).includes('office.unsupported'));
  assert.ok(OFFICE_EXTENSIONS.includes('xlsx') && OFFICE_EXTENSIONS.includes('pdf') && OFFICE_EXTENSIONS.includes('doc'));
});

test('translateWarnings usa las claves i18n de pii.json', () => {
  const r = extractText(makeOle(), 'doc');
  const t = (key, vars) => `${key}:${JSON.stringify(vars)}`;
  const msgs = translateWarnings(r.warnings, t);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /^office\.ole:/);
});
