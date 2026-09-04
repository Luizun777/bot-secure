// Los refactors convierten hallazgos en cambios revisables. Dos invariantes: el "antes" del diff
// va SIEMPRE enmascarado (nunca el valor real) y en la configuración versionada el campo queda VACÍO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRefactors, emptyLine, envRead, envVarFor, isEmptyFieldFile, langOf, proposeRefactors, toUnifiedDiff } from '../../src/generate/refactor.mjs';
import { parseEnv } from '../../src/generate/env-ai.mjs';
import { isFake } from '../../src/generate/fakes.mjs';

const POLICY = { project: 'tienda', db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app' } };
const APP = { name: 'web', path: 'frontend', kind: 'frontend', stack: 'angular', envStrategy: 'angular-environments' };

// Valor FALSO con forma de URL real: nunca un secreto de verdad en una prueba.
const URL_FALSA = 'https://api.ejemplo-ai-test.mx/v1';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'bs-refactor-'));
  mkdirSync(join(root, 'frontend', 'src', 'environments'), { recursive: true });
  writeFileSync(join(root, 'frontend', 'src', 'environments', 'environment.ts'), [
    'export const environment = {',
    '  production: false,',
    `  apiUrl: '${URL_FALSA}',`,
    '};',
    '',
  ].join('\n'));
  return root;
}

const FINDING = {
  file: 'frontend/src/environments/environment.ts',
  line: 3,
  masked: 'ht…(33)',
  category: 'config',
  ruleId: 'generic-url',
  remediation: { kind: 'url', envVar: 'API_URL' },
};

test('un hallazgo en environment.ts deja apiUrl VACÍO y crea la variable', () => {
  const root = workspace();
  try {
    const [p] = proposeRefactors([FINDING], APP, { root, project: 'tienda' });
    assert.equal(p.kind, 'config-to-empty', 'environment.ts es configuración versionada: campo vacío');
    assert.equal(p.envVar, 'API_URL');
    assert.equal(p.lang, 'js');
    assert.equal(p.after.trim(), "apiUrl: '',");
    assert.ok(!p.before.includes(URL_FALSA), 'el "antes" no puede llevar el valor');
    assert.ok(p.before.includes('ht…(33)'), `el "antes" debe ir enmascarado: ${p.before}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyRefactors escribe .env.ai/.env.example y vacía el campo', () => {
  const root = workspace();
  try {
    const proposals = proposeRefactors([FINDING], APP, { root, project: 'tienda' });
    const res = applyRefactors(root, proposals, { app: APP, policy: POLICY, project: 'tienda' });

    assert.deepEqual(res.changed.slice(0, 2), ['frontend/.env.ai', 'frontend/.env.example']);
    const envAi = readFileSync(join(root, 'frontend', '.env.ai'), 'utf8');
    const apiUrl = parseEnv(envAi).find((v) => v.name === 'API_URL');
    assert.ok(apiUrl, envAi);
    assert.ok(isFake(apiUrl.value), `el valor nuevo debe ser un fake: ${apiUrl.value}`);
    assert.ok(!envAi.includes(URL_FALSA), 'el .env.ai no puede llevar el valor original');

    const ejemplo = readFileSync(join(root, 'frontend', '.env.example'), 'utf8');
    assert.match(ejemplo, /^API_URL=$/m);

    const ts = readFileSync(join(root, 'frontend', 'src', 'environments', 'environment.ts'), 'utf8');
    assert.match(ts, /apiUrl: '',/);
    assert.ok(!ts.includes(URL_FALSA), 'el valor debe haber desaparecido del archivo');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--dry-run no escribe nada y devuelve un diff unificado sin valores', () => {
  const root = workspace();
  try {
    const antes = readFileSync(join(root, 'frontend', 'src', 'environments', 'environment.ts'), 'utf8');
    const proposals = proposeRefactors([FINDING], APP, { root, project: 'tienda' });
    const res = applyRefactors(root, proposals, { app: APP, policy: POLICY, dryRun: true });

    assert.equal(res.dryRun, true);
    assert.deepEqual(res.changed, []);
    assert.equal(readFileSync(join(root, 'frontend', 'src', 'environments', 'environment.ts'), 'utf8'), antes);

    const diff = res.diff;
    assert.match(diff, /^--- a\/frontend\/src\/environments\/environment\.ts$/m);
    assert.match(diff, /^\+\+\+ b\/frontend\/src\/environments\/environment\.ts$/m);
    assert.match(diff, /^@@ -3,1 \+3,1 @@ config-to-empty$/m);
    assert.match(diff, /^-.*ht…\(33\)/m);
    assert.match(diff, /^\+\s*apiUrl: '',/m);
    assert.ok(!diff.includes(URL_FALSA), 'el diff nunca lleva el valor real');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('en código (no configuración) el literal pasa a leer la variable de entorno', () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-refactor2-'));
  try {
    mkdirSync(join(root, 'api'), { recursive: true });
    writeFileSync(join(root, 'api', 'cliente.js'), `const key = '${URL_FALSA}';\n`);
    const app = { name: 'api', path: 'api', kind: 'backend', stack: 'node' };
    const [p] = proposeRefactors([{ file: 'api/cliente.js', line: 1, masked: 'ht…(33)', ruleId: 'generic', remediation: { kind: 'secret', envVar: 'PAYMENTS_KEY' } }], app, { root });
    assert.equal(p.kind, 'literal-to-env');
    assert.match(p.after, /process\.env\.PAYMENTS_KEY/);
    assert.ok(!p.after.includes(URL_FALSA));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('los hallazgos de otra app no se proponen (cada app tiene su .env.ai)', () => {
  const props = proposeRefactors([{ ...FINDING, file: 'backend/src/main/resources/application.yml' }], APP, {});
  assert.deepEqual(props, []);
});

test('PII y archivos completos no generan propuestas de variable de entorno', () => {
  const props = proposeRefactors([
    { file: 'frontend/clientes.csv', line: 2, category: 'pii', ruleId: 'rfc' },
    { file: 'frontend/id_rsa', line: 1, category: 'file', ruleId: 'private-key-file' },
  ], APP, {});
  assert.deepEqual(props, []);
});

test('envRead da la lectura idiomática de cada lenguaje', () => {
  assert.equal(envRead('js', 'API_URL'), "process.env.API_URL ?? ''");
  assert.equal(envRead('python', 'API_URL'), 'os.environ.get("API_URL", "")');
  assert.equal(envRead('java', 'API_URL'), 'System.getenv("API_URL")');
  assert.equal(envRead('csharp', 'API_URL'), 'Environment.GetEnvironmentVariable("API_URL") ?? ""');
  assert.equal(envRead('go', 'API_URL'), 'os.Getenv("API_URL")');
  assert.equal(envRead('yaml', 'API_URL'), '${API_URL:}');
});

test('langOf e isEmptyFieldFile reconocen la configuración versionada', () => {
  assert.equal(langOf('src/main/resources/application.yml'), 'yaml');
  assert.equal(langOf('Api/appsettings.json'), 'json');
  assert.equal(langOf('app/settings.py'), 'python');
  assert.ok(isEmptyFieldFile('backend/src/main/resources/application.yml'));
  assert.ok(isEmptyFieldFile('Api/appsettings.Development.json'));
  assert.ok(isEmptyFieldFile('web/src/environments/environment.ts'));
  assert.ok(!isEmptyFieldFile('api/src/cliente.js'));
});

test('emptyLine deja el campo vacío conservando clave e indentación', () => {
  assert.equal(emptyLine('    url: postgres://real', 'yaml'), '    url: ""');
  assert.equal(emptyLine('    "Default": "Server=real"', 'json'), '    "Default": ""');
  assert.equal(emptyLine('DB_PASSWORD=real', 'properties'), 'DB_PASSWORD=');
});

test('envVarFor normaliza el nombre de la variable', () => {
  assert.equal(envVarFor({ remediation: { envVar: 'stripe.secret-key' } }), 'STRIPE_SECRET_KEY');
  assert.equal(envVarFor({ keyPath: 'spring.datasource.password' }), 'PASSWORD');
});

test('toUnifiedDiff agrupa por archivo y ordena por línea', () => {
  const diff = toUnifiedDiff([
    { file: 'a.ts', line: 9, before: 'x…(9)', after: "x: ''", kind: 'config-to-empty', envVar: 'X' },
    { file: 'a.ts', line: 2, before: 'y…(9)', after: "y: ''", kind: 'config-to-empty', envVar: 'Y' },
  ]);
  const lineas = diff.split('\n');
  assert.equal(lineas[0], '--- a/a.ts');
  assert.ok(lineas.indexOf('@@ -2,1 +2,1 @@ config-to-empty') < lineas.indexOf('@@ -9,1 +9,1 @@ config-to-empty'));
});
