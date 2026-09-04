// Regla dura del bot: las semillas sintéticas NO deben aparecer como hallazgos del escáner
// (si aparecieran, `scan` daría exit 1 en cada proyecto y el equipo aprendería a ignorarlo).
// Aquí se escribe el árbol real que genera `db init` y se escanea DE VERDAD con el motor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SYNTHETIC_MARKER } from '../../src/engine/synthetic-mx.mjs';
import { scanPaths } from '../../src/engine/index.mjs';
import { ENGINE_NAMES, ENGINES } from '../../src/db/engines/index.mjs';
import { generate, writeArtifacts } from '../../src/db/index.mjs';

const HMAC = Buffer.from('clave-de-prueba-no-secreta-bot-secure');
const policy = (over = {}) => ({ version: 1, project: 'tienda', profile: 'sensitive', runtime: 'tests', apps: [], db: { rows: 25, seed: 42, ...over } });

function workspace(t, over) {
  const root = mkdtempSync(join(tmpdir(), 'bs-db-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = policy(over);
  writeArtifacts(root, generate(root, p, {}), {});
  return { root, policy: p };
}

test('cada motor escribe la semilla con el marcador sintético en la PRIMERA línea', () => {
  for (const name of ENGINE_NAMES) {
    const e = ENGINES[name];
    const arts = generate('/tmp/no-escribe', policy({ engine: name }), { engine: name });
    const seed = arts.find((a) => a.path.includes('seeds'));
    assert.ok(seed, `${name}: falta la semilla`);
    assert.ok(seed.content.split('\n')[0].includes(SYNTHETIC_MARKER), `${name}: la primera línea no lleva el marcador`);
    assert.match(seed.content.split('\n')[0], /seed=42/, `${name}: el marcador no dice la semilla`);
  }
});

test('scanPaths NO reporta las semillas ni el resto de mocks/db', async (t) => {
  const { root } = workspace(t);
  const report = await scanPaths({ root, mode: 'scan', hmacKey: HMAC });
  const enDb = report.findings.filter((f) => f.file.startsWith('mocks/db/'));
  assert.deepEqual(enDb.map((f) => `${f.ruleId} ${f.file}:${f.line}`), [], 'mocks/db no debe generar hallazgos');
});

test('la prueba anterior es significativa: sin marcador, los MISMOS datos sí se reportan', async (t) => {
  const { root } = workspace(t);
  const seedFile = join(root, 'mocks', 'db', 'seeds', '001-sinteticos.postgres.sql');
  const sin = readFileSync(seedFile, 'utf8').split('\n').filter((l) => !l.includes(SYNTHETIC_MARKER)).join('\n');
  const otro = join(root, 'volcado', 'datos.sql');
  mkdirSync(dirname(otro), { recursive: true });
  writeFileSync(otro, sin);
  const report = await scanPaths({ root, mode: 'scan', hmacKey: HMAC });
  const pii = report.findings.filter((f) => f.file === 'volcado/datos.sql');
  assert.ok(pii.length > 0, 'sin el marcador, los identificadores mexicanos deben detectarse');
  assert.ok(pii.some((f) => f.category === 'pii'), 'debe haber al menos un hallazgo de PII');
});

test('ningún artefacto de mocks/db contiene el valor de un secreto real', (t) => {
  const { root } = workspace(t);
  for (const rel of ['compose.db.yml', 'README.md', join('seeds', '001-sinteticos.postgres.sql')]) {
    const txt = readFileSync(join(root, 'mocks', 'db', rel), 'utf8');
    assert.doesNotMatch(txt, /AKIA[0-9A-Z]{16}|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY-----/, rel);
  }
});

test('`db init` genera compose, init, esquema, migrate.sh, semillas y README', (t) => {
  const { root } = workspace(t);
  for (const rel of ['compose.db.yml', join('init', '00-roles.sql'), 'schema-generic.postgres.sql', 'migrate.sh', join('seeds', '001-sinteticos.postgres.sql'), 'README.md']) {
    assert.ok(existsSync(join(root, 'mocks', 'db', rel)), `falta mocks/db/${rel}`);
  }
  assert.match(readFileSync(join(root, 'mocks', 'db', 'migrate.sh'), 'utf8'), /^#!\/bin\/sh/);
});

test('el mismo seed genera semillas byte a byte idénticas (db reset es reproducible)', () => {
  const a = generate('/tmp/a', policy(), {});
  const b = generate('/tmp/b', policy(), {});
  const sa = a.find((x) => x.path.includes('seeds')).content;
  const sb = b.find((x) => x.path.includes('seeds')).content;
  assert.equal(sa, sb);
  const c = generate('/tmp/c', policy({ seed: 43 }), {}).find((x) => x.path.includes('seeds')).content;
  assert.notEqual(sa, c);
});

test('`db up` regenera las semillas al cambiar --rows en vez de dejar un .new', async (t) => {
  const { root, policy: p } = workspace(t);
  const { up } = await import('../../src/db/index.mjs');
  await up(root, { ...p, runtime: 'clone' }, { runtime: { kind: null, compose: [] }, embedded: true, rows: 7 });
  const seedFile = join(root, 'mocks', 'db', 'seeds', '001-sinteticos.postgres.sql');
  assert.ok(!existsSync(seedFile + '.new'), 'no debe quedar un .new sin aplicar');
  assert.match(readFileSync(seedFile, 'utf8').split('\n')[0], /rows=7/);
});
