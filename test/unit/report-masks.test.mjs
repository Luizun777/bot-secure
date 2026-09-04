import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mask } from '../../src/engine/masks.mjs';

test('token con prefijo conocido → prefijo + … + (len)', () => {
  assert.equal(mask('AKIAIOSFODNN7EXAMPLE', 'token'), 'AKIA…(20)');
  assert.equal(mask('sk_test_AIPLACEHOLDER0000000000000', 'token'), 'sk_test_…(34)');
  assert.equal(mask('ghp_AIPLACEHOLDERAIPLACEHOLDERAIPLACEHOLD', 'secret'), 'ghp_…(41)');
  assert.equal(mask('sk-ant-api03-AIPLACEHOLDERxxxxxxxxxxxxxxxx', 'token'), 'sk-ant-api03-…(42)');
});

test('token sin prefijo conocido → genérica (2 chars si len ≥ 12, si no ***)', () => {
  assert.equal(mask('Zq9vB2xLp0Qa7Rt3', 'token'), 'Zq…(16)');
  assert.equal(mask('Admin2024!', 'token'), '***');
  assert.equal(mask('abc', 'generic'), '***');
  assert.equal(mask('abcdefghijkl', 'generic'), 'ab…(12)');
});

test('tarjeta: solo últimos 4 (PCI DSS 3.4)', () => {
  assert.equal(mask('4111 1111 1111 1234', 'card'), '**** **** **** 1234');
  assert.equal(mask('5555555555554444', 'card'), '**** **** **** 4444');
  assert.doesNotMatch(mask('4111111111111234', 'card'), /4111/);
});

test('CLABE: primeros 3 (banco) + …; RFC/CURP/NSS: cero caracteres', () => {
  assert.equal(mask('012180001234567895', 'clabe'), '012…');
  assert.equal(mask('XAXX010101000', 'rfc'), 'RFC ***(13)');
  assert.equal(mask('XAXX010101000', 'RFC'), 'RFC ***(13)');
  assert.equal(mask('XEXX010101HNEXXXA4', 'curp'), 'CURP ***(18)');
  assert.equal(mask('12345678901', 'nss'), 'NSS ***(11)');
  for (const [v, k] of [['XAXX010101000', 'rfc'], ['XEXX010101HNEXXXA4', 'curp'], ['12345678901', 'nss']]) {
    const m = mask(v, k);
    assert.ok(!m.includes(v.slice(0, 4)) && !m.includes(v.slice(-4)), `${k} no expone caracteres`);
  }
});

test('email → solo dominio; pem → PEM ***; pii genérica → ***', () => {
  assert.equal(mask('persona@example.com', 'email'), '***@example.com');
  assert.equal(mask('-----BEGIN RSA PRIVATE KEY-----', 'pem'), 'PEM ***');
  assert.equal(mask('55 1234 5678', 'phone'), '***');
  assert.equal(mask('', 'token'), '***');
});
