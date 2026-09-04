import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPiiColumns, classifyHeader, parseTables, severityForPath, normalizeHeader } from '../../src/engine/columns.mjs';
import { SYNTHETIC_MARKER } from '../../src/engine/synthetic-mx.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pii-mx');
const read = (f) => readFileSync(join(FIX, f), 'utf8');

/* ---------------------------------------------------------------------------------------- */
/* Cabeceras                                                                                 */
/* ---------------------------------------------------------------------------------------- */

test('classifyHeader: cabeceras ES/EN, con acentos, espacios y comillas', () => {
  assert.equal(classifyHeader('RFC'), 'rfc');
  assert.equal(classifyHeader('"curp_cliente"'), 'curp');
  assert.equal(classifyHeader('Código Postal'), 'cp');
  assert.equal(classifyHeader('fecha nacimiento'), 'fecha_nac');
  assert.equal(classifyHeader('Apellido Paterno'), 'apellido');
  assert.equal(classifyHeader('razón social'), 'razon_social');
  assert.equal(classifyHeader('card_number'), 'tarjeta');
  assert.equal(classifyHeader('clave de elector'), 'ine');
  assert.equal(classifyHeader('street_address'), 'domicilio');
  assert.equal(classifyHeader('total'), null);
  assert.equal(classifyHeader(''), null);
  assert.equal(normalizeHeader(' Codigo-Postal '), 'codigo_postal');
});

/* ---------------------------------------------------------------------------------------- */
/* Umbrales                                                                                  */
/* ---------------------------------------------------------------------------------------- */

test('csv de 25 filas con RFC/CURP/CLABE → HIGH', () => {
  const f = detectPiiColumns(read('clientes.csv'), { path: 'data/clientes.csv', ext: 'csv' });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'HIGH');
  assert.equal(f[0].rows, 25);
  assert.equal(f[0].kind, 'table');
  assert.ok(f[0].types.includes('rfc') && f[0].types.includes('curp') && f[0].types.includes('clabe'));
  assert.ok(f[0].columns.some((c) => c.validated), 'al menos una columna validada');
});

test('INSERT INTO multifila con 12 clientes → MEDIUM y nombre de tabla', () => {
  const f = detectPiiColumns(read('seed_clientes.sql'), { path: 'migrations/V3__seed_clientes.sql', ext: 'sql' });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'MEDIUM');
  assert.equal(f[0].rows, 12);
  assert.equal(f[0].table, 'clientes');
});

test('archivo con marcador bot-secure:synthetic → ningún hallazgo', () => {
  const text = read('sintetico.csv');
  assert.ok(text.includes(SYNTHETIC_MARKER));
  assert.deepEqual(detectPiiColumns(text, { path: 'mocks/db/seeds/sintetico.csv', ext: 'csv' }), []);
});

test('menos de 3 filas o menos de 2 columnas PII → nada', () => {
  const pocas = 'nombre,rfc,curp\nAna,SAT970701NN3,MUMG620322HSRNZS27\nLuis,CFE370814QI0,MUMG620322HSRNZS27\n';
  assert.deepEqual(detectPiiColumns(pocas, { path: 'a.csv', ext: 'csv' }), []);
  const unaCol = 'id,rfc,total\n1,SAT970701NN3,10\n2,CFE370814QI0,20\n3,BBA830831LJ2,30\n4,TME840315KT6,40\n';
  assert.deepEqual(detectPiiColumns(unaCol, { path: 'a.csv', ext: 'csv' }), []);
});

test('columnas PII pero SIN ningún valor validado → nada (evita falsos positivos)', () => {
  const basura = 'nombre,rfc,curp\nAna,XXXX,YYYY\nLuis,ZZZZ,WWWW\nMar,AAAA,BBBB\nSol,CCCC,DDDD\n';
  assert.deepEqual(detectPiiColumns(basura, { path: 'a.csv', ext: 'csv' }), []);
});

/* ---------------------------------------------------------------------------------------- */
/* Formatos                                                                                  */
/* ---------------------------------------------------------------------------------------- */

test('json con arreglo de objetos anidado', () => {
  const f = detectPiiColumns(read('personas.json'), { path: 'docs/personas.json', ext: 'json' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rows, 5);
  assert.ok(f[0].types.includes('nss'));

  const anidado = JSON.stringify({ meta: { v: 1 }, data: { clientes: JSON.parse(read('personas.json')) } });
  const g = detectPiiColumns(anidado, { path: 'docs/export.json', ext: 'json' });
  assert.equal(g.length, 1);
  assert.equal(g[0].rows, 5);
});

test('jsonl: una fila por línea', () => {
  const lines = JSON.parse(read('personas.json')).map((o) => JSON.stringify(o)).join('\n');
  const f = detectPiiColumns(lines, { path: 'export.jsonl', ext: 'jsonl' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rows, 5);
});

test('tsv y csv con ; y con comillas', () => {
  const rows = readFileSync(join(FIX, 'clientes.csv'), 'utf8').split('\n').filter(Boolean);
  const tsv = rows.map((l) => l.split(',').join('\t')).join('\n');
  assert.equal(detectPiiColumns(tsv, { path: 'x.tsv', ext: 'tsv' })[0].rows, 25);
  const punto = rows.map((l) => l.split(',').join(';')).join('\n');
  assert.equal(detectPiiColumns(punto, { path: 'x.csv', ext: 'csv' })[0].rows, 25);
});

test('yaml: secuencia de mapas', () => {
  const yaml = [
    'clientes:',
    '  - nombre: Ana',
    '    rfc: SAT970701NN3',
    '    curp: MUMG620322HSRNZS27',
    '  - nombre: Luis',
    '    rfc: CFE370814QI0',
    '    curp: MUMG620322HSRNZS27',
    '  - nombre: Mar',
    '    rfc: BBA830831LJ2',
    '    curp: MUMG620322HSRNZS27',
  ].join('\n');
  const f = detectPiiColumns(yaml, { path: 'config/clientes.yaml', ext: 'yaml' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rows, 3);
});

test('xml: el elemento repetido es la fila', () => {
  const uno = (rfc) => `<cliente><nombre>Ana</nombre><rfc>${rfc}</rfc><curp>MUMG620322HSRNZS27</curp></cliente>`;
  const xml = `<clientes>${['SAT970701NN3', 'CFE370814QI0', 'BBA830831LJ2', 'TME840315KT6'].map(uno).join('')}</clientes>`;
  const f = detectPiiColumns(xml, { path: 'data/clientes.xml', ext: 'xml' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rows, 4);
  assert.match(f[0].table, /cliente$/);
});

test('sql: COPY … FROM stdin de pg_dump', () => {
  const filas = [
    ['Ana', 'SAT970701NN3', 'MUMG620322HSRNZS27'],
    ['Luis', 'CFE370814QI0', 'MUMG620322HSRNZS27'],
    ['Mar', 'BBA830831LJ2', 'MUMG620322HSRNZS27'],
    ['Sol', 'TME840315KT6', 'MUMG620322HSRNZS27'],
  ].map((r) => r.join('\t')).join('\n');
  const sql = `COPY public.clientes (nombre, rfc, curp) FROM stdin;\n${filas}\n\\.\n`;
  const f = detectPiiColumns(sql, { path: 'dumps/prod.sql', ext: 'sql' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rows, 4);
  assert.equal(f[0].table, 'clientes');
});

test('filas ya extraídas de un xlsx (rows) → kind sheet', () => {
  const rows = [{
    name: 'Clientes',
    rows: [
      ['nombre', 'rfc', 'curp'],
      ['Ana', 'SAT970701NN3', 'MUMG620322HSRNZS27'],
      ['Luis', 'CFE370814QI0', 'MUMG620322HSRNZS27'],
      ['Mar', 'BBA830831LJ2', 'MUMG620322HSRNZS27'],
    ],
  }];
  const f = detectPiiColumns('', { path: 'data/clientes.xlsx', rows });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'sheet');
  assert.equal(f[0].table, 'Clientes');
  assert.equal(f[0].rows, 3);
});

test('extensión no tabular → parseTables vacío', () => {
  assert.deepEqual(parseTables('const rfc = "SAT970701NN3";', { ext: 'js', path: 'a.js' }), []);
});

/* ---------------------------------------------------------------------------------------- */
/* Severidad por carpeta y privacidad del hallazgo                                           */
/* ---------------------------------------------------------------------------------------- */

test('la carpeta solo modula: test/fixtures baja un nivel, data/ no la cambia', () => {
  assert.equal(severityForPath('HIGH', 'src/data/clientes.csv'), 'HIGH');
  assert.equal(severityForPath('HIGH', 'test/fixtures/clientes.csv'), 'MEDIUM');
  assert.equal(severityForPath('MEDIUM', '__tests__/x.csv'), 'LOW');
  assert.equal(severityForPath('HIGH', 'test/data/clientes.csv'), 'HIGH', 'ruta de prueba pero de datos');
  const f = detectPiiColumns(read('clientes.csv'), { path: 'test/fixtures/clientes.csv', ext: 'csv' });
  assert.equal(f[0].severity, 'MEDIUM');
});

test('el hallazgo NUNCA contiene valores, solo nombres de columna y conteos', () => {
  const text = read('clientes.csv');
  const f = detectPiiColumns(text, { path: 'data/clientes.csv', ext: 'csv' });
  const json = JSON.stringify(f);
  const rfc = text.split('\n')[1].split(',')[2];
  assert.ok(rfc.length >= 12);
  assert.ok(!json.includes(rfc), 'no debe aparecer ningún RFC');
  assert.doesNotMatch(json, /\d{11,}/, 'no debe aparecer ninguna corrida larga de dígitos');
  assert.equal(f[0].remediation.action, 'pii.remediation.columns');
  assert.equal(f[0].message.key, 'pii.columns.finding');
});
