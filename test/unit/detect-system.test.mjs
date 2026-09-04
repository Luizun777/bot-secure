// Entorno de la máquina: cuenta de Claude (HOME temporal), runtime de contenedores y PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAccount, detectClaudeInstall, detectContainerRuntime, findInPath, maskEmail } from '../../src/detect/index.mjs';

/** HOME temporal con un ~/.claude.json de contenido controlado. */
function conHome(contenido, fn) {
  const home = mkdtempSync(join(tmpdir(), 'bs-home-'));
  try {
    if (contenido !== null) writeFileSync(join(home, '.claude.json'), JSON.stringify(contenido, null, 2));
    return fn(home);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('detectAccount: cuenta de organización', () => {
  const acct = conHome({
    oauthAccount: { emailAddress: 'ana.lopez@empresa.com.mx', organizationName: 'Empresa Ejemplo SA de CV', organizationUuid: '00000000-0000-4000-8000-000000000000' },
  }, (home) => detectAccount({ home }));
  assert.equal(acct.type, 'org');
  assert.equal(acct.org, 'Empresa Ejemplo SA de CV');
  assert.equal(acct.email, 'a***@empresa.com.mx');
});

test('detectAccount: cuenta personal', () => {
  const acct = conHome({
    oauthAccount: { emailAddress: 'persona@gmail.com', organizationName: "Persona's Organization" },
  }, (home) => detectAccount({ home }));
  assert.equal(acct.type, 'personal');
  assert.equal(acct.email, 'p***@gmail.com');
});

test('detectAccount nunca devuelve el correo completo', () => {
  const acct = conHome({ oauthAccount: { emailAddress: 'ana.lopez@empresa.com.mx', organizationName: 'Empresa Ejemplo SA de CV', organizationUuid: 'x' } }, (home) => detectAccount({ home }));
  assert.doesNotMatch(JSON.stringify(acct), /ana\.lopez@/);
});

test('detectAccount sin ~/.claude.json → unknown', () => {
  const acct = conHome(null, (home) => detectAccount({ home }));
  assert.deepEqual(acct, { type: 'unknown' });
});

test('detectAccount con JSON ilegible → unknown (no lanza)', () => {
  const home = mkdtempSync(join(tmpdir(), 'bs-home-'));
  try {
    writeFileSync(join(home, '.claude.json'), '{ esto no es json');
    assert.deepEqual(detectAccount({ home }), { type: 'unknown' });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('maskEmail enmascara el usuario y respeta el dominio', () => {
  assert.equal(maskEmail('juan@dominio.mx'), 'j***@dominio.mx');
  assert.equal(maskEmail('sin-arroba'), '***');
});

test('detectContainerRuntime con PATH vacío → sin runtime', () => {
  const r = detectContainerRuntime({ env: { PATH: '' } });
  assert.equal(r.kind, null);
  assert.deepEqual(r.compose, []);
});

test('findInPath no encuentra binarios con PATH vacío', () => {
  assert.equal(findInPath('docker', { env: { PATH: '' } }), null);
});

test('detectClaudeInstall devuelve configDir aunque no haya CLI', () => {
  const home = mkdtempSync(join(tmpdir(), 'bs-home-'));
  try {
    const info = detectClaudeInstall({ env: { PATH: '' }, home });
    assert.equal(info.configDir, join(home, '.claude'));
    assert.equal(info.configDirExists, false);
    assert.equal(info.cli, undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
