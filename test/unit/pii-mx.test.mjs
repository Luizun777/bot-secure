import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRFC, validateCURP, validateCLABE, validateNSS, luhn, luhnOk, validateINE, validateIBAN,
  validateEmail, validateTelefonoMX, rfcCheckDigit, curpCheckDigit, clabeCheckDigit,
  loadPiiRules, piiRule, applyPiiRule, hasContext, hasSyntheticMarker, validate,
} from '../../src/engine/pii-mx.mjs';
import { createRng, person, SYNTHETIC_MARKER } from '../../src/engine/synthetic-mx.mjs';

/* ---------------------------------------------------------------------------------------- */
/* RFC                                                                                       */
/* ---------------------------------------------------------------------------------------- */

// RFC de personas MORALES: son datos públicos (aparecen en cualquier factura). No se usan RFC de
// personas físicas reales: los de persona física del test se generan con synthetic-mx.
const RFC_PUBLICOS = ['SAT970701NN3', 'CFE370814QI0', 'BBA830831LJ2', 'TME840315KT6', 'IMS421231I45', 'BNM840515VB1'];

test('RFC: 6 RFC morales públicos pasan formato, fecha y dígito verificador', () => {
  for (const rfc of RFC_PUBLICOS) {
    assert.deepEqual(validateRFC(rfc), { valid: true, reason: 'ok', kind: 'moral' }, rfc);
  }
});

test('RFC: dígito verificador alterado → checksum', () => {
  for (const rfc of RFC_PUBLICOS.slice(0, 5)) {
    const otro = String((Number(rfc.slice(-1)) + 1) % 10);
    const malo = rfc.slice(0, -1) + otro;
    const r = validateRFC(malo);
    assert.equal(r.valid, false, malo);
    assert.equal(r.reason, 'checksum', malo);
  }
});

test('RFC: acepta separadores y minúsculas; rechaza longitud, formato y fecha imposible', () => {
  assert.equal(validateRFC('sat-970701-nn3').valid, true);
  assert.equal(validateRFC('SAT970701NN').reason, 'length');
  assert.equal(validateRFC('SAT9707011N33').reason, 'format');   // 13 con 3 letras
  assert.equal(validateRFC('SAT971301NN9').reason, 'date');      // mes 13
  assert.equal(validateRFC('SAT970230NNX').reason, 'date');      // 30 de febrero
});

test('RFC: genéricos del SAT no son PII (reason generic, nunca valid)', () => {
  assert.deepEqual(validateRFC('XAXX010101000'), { valid: false, reason: 'generic', kind: 'fisica' });
  assert.deepEqual(validateRFC('XEXX010101000'), { valid: false, reason: 'generic', kind: 'fisica' });
});

test('RFC de persona física generado por synthetic-mx valida (13, kind fisica)', () => {
  const rng = createRng(11);
  for (let i = 0; i < 5; i++) {
    const p = person(rng);
    assert.deepEqual(validateRFC(p.rfc), { valid: true, reason: 'ok', kind: 'fisica' }, p.rfc);
  }
});

test('rfcCheckDigit reproduce el dígito publicado de cada RFC público', () => {
  for (const rfc of RFC_PUBLICOS) assert.equal(rfcCheckDigit(rfc.slice(0, -1)), rfc.slice(-1), rfc);
});

/* ---------------------------------------------------------------------------------------- */
/* CURP                                                                                      */
/* ---------------------------------------------------------------------------------------- */

test('CURP: las generadas por synthetic-mx validan (entidad de catálogo + mod 10)', () => {
  const rng = createRng(3);
  for (let i = 0; i < 5; i++) {
    const p = person(rng);
    const r = validateCURP(p.curp);
    assert.equal(r.valid, true, `${p.curp} → ${r.reason}`);
  }
});

test('CURP: checksum VÁLIDO pero entidad fuera de catálogo → invalid (reason entidad)', () => {
  const base = 'MUMG620322HSRNZS2';               // CURP sintética válida sin el dígito
  const conEntidadMala = base.slice(0, 11) + 'ZZ' + base.slice(13);
  const curp = conEntidadMala + curpCheckDigit(conEntidadMala);
  assert.equal(curpCheckDigit(curp.slice(0, 17)), curp[17], 'el checksum debe ser válido');
  assert.deepEqual(validateCURP(curp), { valid: false, reason: 'entidad', entidad: 'ZZ' });
});

test('CURP: entidad NE (nacido en el extranjero) sí es válida', () => {
  const base = 'MUMG620322HNENZS2';
  const curp = base + curpCheckDigit(base);
  assert.equal(validateCURP(curp).valid, true);
});

test('CURP: longitud, formato, fecha y dígito', () => {
  assert.equal(validateCURP('MUMG620322HSRNZS2').reason, 'length');
  assert.equal(validateCURP('MUMG620322XSRNZS27').reason, 'format');   // sexo X
  assert.equal(validateCURP('MUMG620332HSRNZS27').reason, 'date');     // día 32
  const rng = createRng(3);
  const p = person(rng);
  const malo = p.curp.slice(0, 17) + String((Number(p.curp[17]) + 1) % 10);
  assert.equal(validateCURP(malo).reason, 'checksum');
});

/* ---------------------------------------------------------------------------------------- */
/* CLABE                                                                                     */
/* ---------------------------------------------------------------------------------------- */

test('CLABE: banco del catálogo Banxico + dígito de control', () => {
  const base = '01218000123456789';
  const clabe = base + clabeCheckDigit(base);
  const r = validateCLABE(clabe);
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.banco, 'BBVA MEXICO');
});

test('CLABE: checksum VÁLIDO con banco 999 (no asignado) → invalid (reason banco)', () => {
  const base = '99918000123456789';
  const clabe = base + clabeCheckDigit(base);
  assert.equal(clabeCheckDigit(clabe.slice(0, 17)), clabe[17], 'el checksum debe ser válido');
  assert.deepEqual(validateCLABE(clabe), { valid: false, reason: 'banco' });
});

test('CLABE: plaza 000 y dígito alterado', () => {
  const plazaCero = '012000123456789';
  const c1 = `${plazaCero}00` + clabeCheckDigit(`${plazaCero}00`);
  assert.equal(validateCLABE(c1).reason, 'plaza');
  const base = '01218000123456789';
  const malo = base + String((Number(clabeCheckDigit(base)) + 1) % 10);
  assert.equal(validateCLABE(malo).reason, 'checksum');
  assert.equal(validateCLABE('0121800012345678').reason, 'length');
});

test('CLABE: los IDs tipo Snowflake (18-19 dígitos) NO son CLABE', () => {
  const snowflakes = [
    '175928847299117063', '1053286132894392320', '1180964836364419072',
    '987654321098765432', '123456789012345678', '1725381234567890123',
  ];
  for (const s of snowflakes) {
    const r = validateCLABE(s);
    assert.equal(r.valid, false, `${s} no debe ser CLABE (${r.reason})`);
  }
});

/* ---------------------------------------------------------------------------------------- */
/* NSS                                                                                       */
/* ---------------------------------------------------------------------------------------- */

test('NSS: los generados por synthetic-mx validan (Luhn + subdelegación + años)', () => {
  const rng = createRng(5);
  for (let i = 0; i < 5; i++) {
    const p = person(rng);
    const r = validateNSS(p.nss);
    assert.equal(r.valid, true, `${p.nss} → ${r.reason}`);
  }
});

test('NSS: subdelegación 00/98/99, años imposibles y Luhn alterado', () => {
  assert.equal(validateNSS('00081234567').reason, 'subdelegacion');
  assert.equal(validateNSS('99081234567').reason, 'subdelegacion');
  assert.equal(validateNSS('12301234567').reason, 'years');   // alta 1930 < 1943
  assert.equal(validateNSS('12029912345').reason, 'years');   // nace 1999, alta 2002 → 3 años
  const rng = createRng(5);
  const nss = person(rng).nss;
  assert.equal(validateNSS(nss.slice(0, 10) + String((Number(nss[10]) + 1) % 10)).reason, 'checksum');
  assert.equal(validateNSS('1234567890').reason, 'length');
});

test('NSS: un teléfono US de 11 dígitos no pasa la validación de años', () => {
  assert.equal(validateNSS('15551234567').valid, false);
  assert.equal(validateNSS('15551234567').reason, 'years');
});

/* ---------------------------------------------------------------------------------------- */
/* Tarjeta (luhn)                                                                            */
/* ---------------------------------------------------------------------------------------- */

test('tarjeta: IIN de marca + longitud + Luhn', () => {
  const rng = createRng(9);
  for (let i = 0; i < 4; i++) {
    const p = person(rng);
    const r = luhn(p.tarjeta);
    assert.equal(r.valid, true, `${p.tarjeta} → ${r.reason}`);
  }
  assert.equal(luhn('5555555555554445').reason, 'checksum');   // Luhn roto
  assert.equal(luhn('9999999999999995').reason, 'iin');        // IIN desconocido
  assert.equal(luhn('411111111111').reason, 'length');         // 12 dígitos
});

test('tarjeta: los PAN públicos de prueba no se reportan', () => {
  assert.equal(luhn('4242424242424242').reason, 'test-card');
  assert.equal(luhn('4111 1111 1111 1111').reason, 'test-card');
  assert.equal(luhn('5555555555554444').reason, 'test-card');
});

test('tarjeta: subcadena de una corrida de 20 dígitos → no es hallazgo', () => {
  const rng = createRng(9);
  const pan = person(rng).tarjeta;                    // 16 dígitos válidos
  const corrida = `99${pan}99`;                       // 20 dígitos seguidos
  assert.equal(corrida.length, 20);

  // 1) el validador con vecinos numéricos lo rechaza
  assert.equal(luhn(pan, { before: '9', after: '9' }).reason, 'format');

  // 2) el regex de la regla ni siquiera lo localiza dentro de la corrida
  const rule = piiRule('tarjeta');
  const re = new RegExp(rule.regex, rule.flags);
  assert.equal(corrida.match(re), null);
  // pero sí lo localiza cuando está aislado
  assert.deepEqual(`pan: ${pan}`.match(new RegExp(rule.regex, rule.flags)), [pan]);
});

test('tarjeta: los Snowflake de 18-19 dígitos no tienen IIN válido', () => {
  for (const s of ['1053286132894392320', '175928847299117063', '1725381234567890123']) {
    assert.equal(luhn(s).valid, false, s);
  }
});

test('luhnOk es la primitiva booleana (no valida IIN)', () => {
  assert.equal(luhnOk('4242424242424242'), true);
  assert.equal(luhnOk('4242424242424243'), false);
});

/* ---------------------------------------------------------------------------------------- */
/* INE / IBAN / correo / teléfono                                                            */
/* ---------------------------------------------------------------------------------------- */

test('INE: estructura, fecha y entidad 01-32 (sin checksum verificable)', () => {
  const clave = 'MNRSGS62032209H100';   // 6 consonantes + 620322 + entidad 09 + sexo H + 3 dígitos
  const r = validateINE(clave);
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.checksum, false, 'el dígito final del INE no es verificable');
  assert.equal(validateINE('MNRSGS62032299H100').reason, 'entidad');   // entidad 99
  assert.equal(validateINE('MNRSGS62133209H100').reason, 'date');      // mes 13
  assert.equal(validateINE('MNRSGS62032209X100').reason, 'format');    // sexo X
  assert.equal(validateINE('MNRSGS62032209H10').reason, 'length');
});

test('IBAN: vectores públicos del registro SWIFT (mod 97)', () => {
  assert.equal(validateIBAN('ES9121000418450200051332').valid, true);
  assert.equal(validateIBAN('DE89370400440532013000').valid, true);
  assert.equal(validateIBAN('GB82 WEST 1234 5698 7654 32').valid, true);
  assert.equal(validateIBAN('DE89370400440532013001').reason, 'checksum');
  assert.equal(validateIBAN('DE8937040044053201300').reason, 'country');   // longitud del país
  assert.equal(validateIBAN('ZZ0012345678901234').reason, 'country');      // país inexistente
});

test('correo: dominios ficticios/reservados no son PII', () => {
  assert.equal(validateEmail('ana.perez@empresa.com.mx').valid, true);
  assert.equal(validateEmail('ana@example.com').reason, 'domain');
  assert.equal(validateEmail('seed@ai.local').reason, 'domain');
  assert.equal(validateEmail('no-es-correo').reason, 'format');
});

test('teléfono MX: 10 dígitos con o sin +52; bloques ficticios fuera', () => {
  assert.equal(validateTelefonoMX('55 1234 5678').valid, true);
  assert.equal(validateTelefonoMX('+52 55 1234 5678').valid, true);
  assert.equal(validateTelefonoMX('+52 1 55 1234 5678').valid, true);
  assert.equal(validateTelefonoMX('+52 55 0000 3966').reason, 'synthetic');
  assert.equal(validateTelefonoMX('8112345678').valid, true);
  assert.equal(validateTelefonoMX('1111111111').reason, 'synthetic');
  assert.equal(validateTelefonoMX('12345678').reason, 'length');
});

test('validate() despacha por tipo y desconocido → format', () => {
  assert.equal(validate('rfc', 'SAT970701NN3').valid, true);
  assert.equal(validate('desconocido', 'x').reason, 'format');
});

/* ---------------------------------------------------------------------------------------- */
/* Reglas y applyPiiRule                                                                     */
/* ---------------------------------------------------------------------------------------- */

test('rules/pii.json: 9 reglas coherentes y con regex compilable', () => {
  const rules = loadPiiRules();
  assert.equal(rules.length, 9);
  const ids = rules.map((r) => r.id).sort();
  assert.deepEqual(ids, ['clabe', 'curp', 'email', 'iban', 'ine', 'nss', 'rfc', 'tarjeta', 'telefono-mx']);
  for (const r of rules) {
    assert.equal(r.category, 'pii', r.id);
    assert.ok(r.keywords.length, r.id);
    assert.ok(r.description.es && r.description.en, r.id);
    assert.doesNotThrow(() => new RegExp(r.regex, r.flags), r.id);
    assert.ok(r.remediation.action.startsWith('pii.'), r.id);
  }
});

test('applyPiiRule: sin contexto LOW, con contexto MEDIUM, ≥ 20 registros HIGH', () => {
  const rfc = 'SAT970701NN3';
  const sin = applyPiiRule({ value: rfc, ruleId: 'rfc', line: 1 }, { lines: [`const x = "${rfc}";`] });
  assert.equal(sin.drop, false);
  assert.equal(sin.severity, 'LOW');
  assert.equal(sin.context, false);

  const con = applyPiiRule({ value: rfc, ruleId: 'rfc', line: 2 }, { lines: ['// datos del contribuyente', `x = "${rfc}"`] });
  assert.equal(con.severity, 'MEDIUM');
  assert.equal(con.context, true);

  const bulk = applyPiiRule({ value: rfc, ruleId: 'rfc', line: 1 }, { lines: [`rfc,${rfc}`], records: 25 });
  assert.equal(bulk.severity, 'HIGH');
});

test('applyPiiRule: cabecera de columna cuenta como contexto', () => {
  const r = applyPiiRule({ value: 'SAT970701NN3', ruleId: 'rfc', line: 1 }, { lines: ['SAT970701NN3'], header: 'rfc_cliente' });
  assert.equal(r.severity, 'MEDIUM');
  assert.equal(r.context, true);
});

test('applyPiiRule: valor inválido → drop con el motivo del validador', () => {
  const r = applyPiiRule({ value: '123456789012345678', ruleId: 'clabe', line: 1 }, { lines: ['cuenta: 123456789012345678'] });
  assert.equal(r.drop, true);
  assert.equal(r.reason, 'banco');
});

test('applyPiiRule: email y teléfono SOLO con contexto', () => {
  const email = 'ana.perez@empresa.com.mx';
  assert.equal(applyPiiRule({ value: email, ruleId: 'email', line: 1 }, { lines: [`autor: ${email}`] }).drop, true);
  const con = applyPiiRule({ value: email, ruleId: 'email', line: 1 }, { lines: [`correo del cliente: ${email}`] });
  assert.equal(con.drop, false);
  assert.equal(con.severity, 'MEDIUM');

  assert.equal(applyPiiRule({ value: '55 1234 5678', ruleId: 'telefono-mx', line: 1 }, { lines: ['55 1234 5678'] }).drop, true);
  assert.equal(applyPiiRule({ value: '55 1234 5678', ruleId: 'telefono-mx', line: 1 }, { lines: ['celular: 55 1234 5678'] }).drop, false);
});

test('applyPiiRule: archivo con marcador sintético → nunca es hallazgo', () => {
  const text = `-- ${SYNTHETIC_MARKER} seed=42\nrfc,SAT970701NN3\n`;
  const r = applyPiiRule({ value: 'SAT970701NN3', ruleId: 'rfc', line: 2 }, { text, lines: text.split('\n') });
  assert.deepEqual(r, { drop: true, reason: 'synthetic' });
});

test('applyPiiRule: el resultado nunca contiene el valor y trae máscara + remediación', () => {
  const pan = person(createRng(9)).tarjeta;
  const r = applyPiiRule({ value: pan, ruleId: 'tarjeta', line: 1 }, { lines: [`tarjeta: ${pan}`] });
  assert.equal(r.drop, false, r.reason);
  assert.equal(r.maskKind, 'card');
  assert.equal(r.remediation.kind, 'pii');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(pan));
});

test('hasContext respeta el radio de ±2 líneas', () => {
  const lines = ['clabe del proveedor', '', '', '', '012180001234567895'];
  assert.equal(hasContext(lines, 5, ['clabe']), false);
  assert.equal(hasContext(lines, 3, ['clabe']), true);
});

test('hasSyntheticMarker solo mira las 5 primeras líneas', () => {
  assert.equal(hasSyntheticMarker(`# ${SYNTHETIC_MARKER}\na\nb`), true);
  assert.equal(hasSyntheticMarker(`a\nb\nc\nd\ne\n# ${SYNTHETIC_MARKER}`), false);
});

/* ---------------------------------------------------------------------------------------- */
/* i18n                                                                                      */
/* ---------------------------------------------------------------------------------------- */

test('todas las claves i18n que usa el módulo existen en es y en en', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const es = JSON.parse(readFileSync(join(raiz, 'i18n', 'es', 'pii.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(raiz, 'i18n', 'en', 'pii.json'), 'utf8'));

  const usadas = new Set();
  for (const f of ['engine/office.mjs', 'engine/columns.mjs', 'engine/pii-mx.mjs']) {
    const src = readFileSync(join(raiz, f), 'utf8');
    for (const m of src.matchAll(/'((?:office|columns|remediation)\.[\w.]+)'/g)) usadas.add(m[1]);
  }
  for (const r of loadPiiRules()) usadas.add(r.remediation.action.replace(/^pii\./, ''));
  for (const v of ['ok', 'length', 'format', 'date', 'checksum', 'generic', 'entidad', 'banco', 'plaza',
    'subdelegacion', 'years', 'iin', 'test-card', 'country', 'domain', 'synthetic']) usadas.add(`reason.${v}`);

  assert.ok(usadas.size > 20, `se esperaban muchas claves, hay ${usadas.size}`);
  for (const k of usadas) {
    assert.ok(k in es, `falta ${k} en es/pii.json`);
    assert.ok(k in en, `falta ${k} en en/pii.json`);
  }
});
