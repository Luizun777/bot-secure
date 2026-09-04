import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hmacFingerprint, piiFingerprint, loadHmacKey, repoId, keyPath, normalizeLine, decodeKey } from '../../src/engine/fingerprint.mjs';

const FAKE = 'AKIAIOSFODNN7EXAMPLE'; // valor de ejemplo oficial de AWS, no es un secreto real
const KEY = Buffer.alloc(32, 7);
const KEY2 = Buffer.alloc(32, 9);

test('hmacFingerprint: 16 hex, estable e igual para valores con comillas/espacios', () => {
  const a = hmacFingerprint(KEY, 'aws-key', 'src/a.js', FAKE);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(hmacFingerprint(KEY, 'aws-key', 'src/a.js', `  "${FAKE}"  `), a);
  assert.equal(hmacFingerprint(KEY, 'aws-key', 'src/a.js', `'${FAKE}'`), a);
  assert.equal(hmacFingerprint(KEY, 'aws-key', 'src\\a.js', FAKE), a, 'ruta Windows normalizada a posix');
});

test('hmacFingerprint: distinta clave, regla, archivo o valor → distinto fingerprint', () => {
  const a = hmacFingerprint(KEY, 'aws-key', 'src/a.js', FAKE);
  assert.notEqual(hmacFingerprint(KEY2, 'aws-key', 'src/a.js', FAKE), a);
  assert.notEqual(hmacFingerprint(KEY, 'other', 'src/a.js', FAKE), a);
  assert.notEqual(hmacFingerprint(KEY, 'aws-key', 'src/b.js', FAKE), a);
  assert.notEqual(hmacFingerprint(KEY, 'aws-key', 'src/a.js', FAKE + 'X'), a);
});

test('piiFingerprint: no cambia al cambiar dígitos (misma forma) y NUNCA contiene el valor', () => {
  // Implicación documentada: dos CURP/CLABE distintas en una línea con la misma forma comparten fingerprint;
  // el baseline las suprime juntas. Es deliberado: el reporte no debe servir de oráculo para fuerza bruta.
  const l1 = 'clabe = 012345678901234567';
  const l2 = 'clabe = 098765432109876543';
  const a = piiFingerprint(KEY, 'clabe', 'data/c.csv', normalizeLine(l1));
  assert.equal(piiFingerprint(KEY, 'clabe', 'data/c.csv', normalizeLine(l2)), a);
  assert.equal(piiFingerprint(KEY, 'clabe', 'data/c.csv', l2), a, 'normaliza aunque le pasen la línea cruda');
  assert.notEqual(piiFingerprint(KEY, 'clabe', 'data/c.csv', 'otra_cosa = 012345678901234567'), a);
  assert.equal(normalizeLine(l1), 'clabe = ##################');
  assert.doesNotMatch(normalizeLine(l1), /\d/);
});

test('loadHmacKey: crea clave 0600 en BOT_SECURE_HOME, la reutiliza y respeta create:false', () => {
  const home = mkdtempSync(join(tmpdir(), 'bs-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'bs-repo-'));
  try {
    const env = { BOT_SECURE_HOME: home };
    assert.throws(() => loadHmacKey(repo, { create: false, env }), (e) => e.key === 'report.keyMissing' && /bot-secure init/.test(e.fix));
    const k = loadHmacKey(repo, { env });
    assert.equal(k.length, 32);
    const p = keyPath(repo, env);
    assert.ok(existsSync(p));
    if (process.platform !== 'win32') assert.equal(statSync(p).mode & 0o777, 0o600);
    assert.match(readFileSync(p, 'utf8').trim(), /^[0-9a-f]{64}$/);
    assert.deepEqual(loadHmacKey(repo, { env }), k, 'misma clave en segunda carga');
    assert.equal(repoId(repo).length, 64);
    assert.equal(repoId(repo), repoId(repo));
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

test('loadHmacKey: env BOT_SECURE_HMAC_KEY en hex o base64; inválida → error con fix', () => {
  const hex = KEY.toString('hex');
  assert.deepEqual(loadHmacKey('/nowhere', { env: { BOT_SECURE_HMAC_KEY: hex } }), KEY);
  assert.deepEqual(loadHmacKey('/nowhere', { env: { BOT_SECURE_HMAC_KEY: KEY.toString('base64') } }), KEY);
  assert.throws(() => loadHmacKey('/nowhere', { env: { BOT_SECURE_HMAC_KEY: 'corta' } }), (e) => e.key === 'report.badEnvKey' && !!e.fix);
  assert.equal(decodeKey('zz'), null);
});
