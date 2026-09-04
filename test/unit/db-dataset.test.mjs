// Los datos sintéticos de la BD de pruebas deben ser DETERMINISTAS por semilla y pasar los
// validadores reales de PII mexicana (si no, el escáner no podría distinguirlos de datos reales).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/engine/synthetic-mx.mjs';
import { validateRFC, validateCURP, validateCLABE, validateNSS, luhn } from '../../src/engine/pii-mx.mjs';
import { buildDataset } from '../../src/db/dataset.mjs';
import { TABLES } from '../../src/db/schema-generic.mjs';

test('la misma semilla produce exactamente el mismo dataset', () => {
  const a = buildDataset(50, createRng(42));
  const b = buildDataset(50, createRng(42));
  assert.deepEqual(a, b);
});

test('semillas distintas producen datasets distintos', () => {
  const a = buildDataset(20, createRng(42));
  const b = buildDataset(20, createRng(43));
  assert.notDeepEqual(a, b);
});

test('el dataset trae las 8 tablas con `rows` filas cada una', () => {
  const ds = buildDataset(7, createRng(1));
  assert.deepEqual(Object.keys(ds).sort(), [...TABLES].sort());
  for (const t of TABLES) assert.equal(ds[t].length, 7, `tabla ${t}`);
});

test('1.000 personas: 100 % de RFC/CURP/NSS/CLABE/tarjeta válidos y sin CURP duplicada', () => {
  const ds = buildDataset(1000, createRng(42));
  const malos = { rfc: [], curp: [], nss: [], clabe: [], tarjeta: [] };
  const curps = new Set();
  for (let i = 0; i < 1000; i++) {
    const c = ds.clientes[i], cta = ds.cuentas_bancarias[i];
    if (!validateRFC(c.rfc).valid) malos.rfc.push(c.rfc);
    if (!validateCURP(c.curp).valid) malos.curp.push(c.curp);
    if (!validateNSS(c.nss).valid) malos.nss.push(c.nss);
    if (!validateCLABE(cta.clabe).valid) malos.clabe.push(cta.clabe);
    if (!luhn(cta.tarjeta_prueba).valid) malos.tarjeta.push(cta.tarjeta_prueba);
    curps.add(c.curp);
  }
  for (const [k, v] of Object.entries(malos)) assert.equal(v.length, 0, `${v.length} ${k} inválidos, p. ej. ${v[0]}`);
  assert.equal(curps.size, 1000, `hay ${1000 - curps.size} CURP duplicadas`);
});

test('las claves foráneas del dataset son coherentes', () => {
  const ds = buildDataset(25, createRng(9));
  for (let i = 0; i < 25; i++) {
    assert.equal(ds.clientes[i].usuario_id, ds.usuarios[i].id);
    assert.equal(ds.direcciones[i].cliente_id, ds.clientes[i].id);
    assert.equal(ds.facturas[i].pedido_id, ds.pedidos[i].id);
    assert.equal(ds.pagos[i].factura_id, ds.facturas[i].id);
  }
});

test('nunca se escribe una contraseña: el hash es el placeholder del bot', () => {
  const ds = buildDataset(5, createRng(3));
  for (const u of ds.usuarios) assert.equal(u.hash_password, '__AI_PLACEHOLDER__PASSWORD_HASH__');
});
