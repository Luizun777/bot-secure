// Escaneo de extremo a extremo sobre los fixtures: cobertura, falsos positivos, UTF-16, ReDoS,
// supresiones inline por modo, ausencia de valores en el reporte y rendimiento.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanTimeout, scanPaths, scanText, dedupe } from '../../src/engine/index.mjs';
import { RULES_VERSION } from '../../src/engine/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const KEY = Buffer.alloc(32, 7);
const RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

/** Reglas que cada fixture de `secrets-falsos` DEBE producir. */
const ESPERADO = {
  'aws.txt': ['aws-access-key-id', 'aws-secret-access-key'],
  'github.txt': ['github-token', 'github-fine-grained-pat'],
  'gitlab-npm.txt': ['gitlab-pat', 'npm-token'],
  'slack.txt': ['slack-token', 'slack-webhook'],
  'google.json': ['gcp-service-account-key', 'google-api-key'],
  'stripe.js': ['stripe-live-key', 'stripe-webhook-secret'],
  'twilio-sendgrid.txt': ['twilio-api-key', 'sendgrid-api-key'],
  'ia-mail.txt': ['mailgun-api-key', 'openai-api-key', 'anthropic-api-key'],
  'chat.txt': ['telegram-bot-token', 'discord-webhook'],
  'jwt.txt': ['jwt'],
  'pem.txt': ['private-key-pem'],
  'mexico.txt': ['mercadopago-token', 'conekta-key', 'openpay-secret-key'],
  'connection.txt': ['db-connection-url', 'jdbc-password'],
  'appsettings.json': ['ado-connection-string'],
  'application.yml': ['env-secret-assignment'],
  'config.yml': ['config-secret-key'],
  'docker-compose.yml': ['env-secret-assignment'],
  Dockerfile: ['env-secret-assignment'],
  '.env': ['dotenv-file', 'env-secret-assignment'],
  'k8s-secret.yaml': ['k8s-secret-data'],
  '.env.frontend': ['frontend-public-secret'],
};

let cacheSecretos = null;
async function reporteSecretos() {
  if (!cacheSecretos) cacheSecretos = await scanPaths({ root: join(FIXTURES, 'secrets-falsos'), hmacKey: KEY });
  return cacheSecretos;
}

test('secrets-falsos: cada familia se detecta con el ruleId esperado', async () => {
  const report = await reporteSecretos();
  const byFile = new Map();
  for (const f of report.findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, new Set());
    byFile.get(f.file).add(f.ruleId);
  }
  for (const [file, ids] of Object.entries(ESPERADO)) {
    const found = byFile.get(file);
    assert.ok(found, `sin hallazgos en ${file}`);
    for (const id of ids) assert.ok(found.has(id), `${file}: falta ${id} (encontrado: ${[...found].join(', ')})`);
  }
});

test('el reporte nunca contiene el valor de un secreto', async () => {
  const report = await reporteSecretos();
  const json = JSON.stringify(report);
  const prohibidos = [
    'AKIAIOSFODNN7EXAMPLE',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'S3cr3t0Prod2026', 'P4ssw0rdSqlProd', 'S3cr3t0SpringProd', 'Compose5ecretoProd',
    'Docker4piK3yValorReal', 'Env5ecretoDeProduccion', 'K8sS3cret0Prod2026',
    'Zx9Qw2ErTy7Ui4Op1AsD6FgH3JkL0MnB5VcX8ZqW', 'mR8kL2pQ7vT4xN6bY1cW9zA3sD5fG0hJ',
  ];
  for (const v of prohibidos) assert.ok(!json.includes(v), `el reporte filtra el valor ${v.slice(0, 6)}…`);
  for (const f of report.findings) {
    assert.equal(f.value, undefined);
    assert.ok(f.fingerprint && /^[0-9a-f]{16}$/.test(f.fingerprint), 'fingerprint HMAC de 16 hex');
    assert.equal(f.id, f.fingerprint);
    assert.ok(f.remediation?.action, `${f.ruleId}: remediation.action vacío`);
  }
  assert.equal(report.rulesVersion, RULES_VERSION);
  assert.equal(report.tool, 'bot-secure');
});

test('false-positives: ningún hallazgo de severidad LOW o superior', async () => {
  const report = await scanPaths({ root: join(FIXTURES, 'false-positives'), hmacKey: KEY });
  const ruidosos = report.findings.filter((f) => RANK[f.severity] <= RANK.LOW);
  assert.deepEqual(ruidosos.map((f) => `${f.file}:${f.line} ${f.ruleId} ${f.severity}`), [],
    'los placeholders/UUID/hashes/cifrados no deben producir hallazgos');
  assert.ok(report.findings.every((f) => f.severity === 'INFO'));
});

test('utf16: un token en un .resx UTF-16LE se detecta', async () => {
  const report = await scanPaths({ root: join(FIXTURES, 'utf16'), hmacKey: KEY });
  const hit = report.findings.find((f) => f.ruleId === 'github-token');
  assert.ok(hit, 'no se detectó el token en UTF-16LE');
  assert.equal(hit.file, 'Strings.resx');
});

test('redos: un payload hostil termina en menos de 300 ms', async () => {
  const text = readFileSync(join(FIXTURES, 'redos', 'hostile.txt'), 'utf8');
  const t0 = Date.now();
  let timeout = false;
  try { await scanText(text, { path: 'hostile.txt', hmacKey: KEY, mode: 'scan' }); }
  catch (e) { if (e instanceof ScanTimeout) timeout = true; else throw e; }
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `el escaneo tardó ${ms} ms`);
  assert.ok(timeout === false || timeout === true);
});

test('guard: scanText corre en worker y respeta el presupuesto de tiempo', async () => {
  const found = await scanText('AWS=AKIAIOSFODNN7EXAMPLE\n', { path: 'p.txt', mode: 'guard', hmacKey: KEY, maxMs: 5000 });
  assert.equal(found.length, 1);
  assert.equal(found[0].ruleId, 'aws-access-key-id');
  assert.equal(found[0].value, undefined);

  const hostile = readFileSync(join(FIXTURES, 'redos', 'hostile.txt'), 'utf8');
  await assert.rejects(
    () => scanText(hostile, { path: 'hostile.txt', mode: 'guard', hmacKey: KEY, maxMs: 1 }),
    (e) => e instanceof ScanTimeout && e.key === 'engine.scanTimeout',
  );
});

test('supresiones inline: valen en scan, en guard/ci/pre-commit son hallazgo MEDIUM', async () => {
  const linea = 'API_TOKEN=Zx9Qw2ErTy7Ui4Op1AsD6FgH // gitleaks:allow\n';
  const enScan = await scanText(linea, { path: 'app.js', mode: 'scan', hmacKey: KEY });
  assert.equal(enScan.length, 0, 'en scan la supresión inline se respeta');

  for (const mode of ['guard', 'ci', 'pre-commit']) {
    const found = await scanText(linea, { path: 'app.js', mode, hmacKey: KEY, worker: false });
    const intento = found.find((f) => f.ruleId === 'inline-suppression-attempt');
    assert.ok(intento, `${mode}: no se reportó el intento de supresión`);
    assert.equal(intento.severity, 'MEDIUM');
    assert.ok(found.some((f) => f.ruleId !== 'inline-suppression-attempt'), `${mode}: la supresión no debe ocultar el secreto`);
  }
});

test('dedupe agrupa el mismo hallazgo en occurrences', () => {
  const base = { ruleId: 'aws-access-key-id', fingerprint: 'a'.repeat(16), file: 'a.txt', line: 1 };
  const out = dedupe([base, { ...base, file: 'b.txt', line: 9 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrences.length, 2);
});

test('rendimiento: 2.000 archivos sintéticos en menos de 3 s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-perf-'));
  try {
    for (let i = 0; i < 2000; i++) {
      const sub = join(dir, `pkg${i % 20}`);
      if (i < 20) mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, `mod${i}.js`), [
        `// módulo sintético ${i}`,
        "import { useState } from 'react';",
        `export const NOMBRE = 'componente-${i}';`,
        'export function render(props) { return { ...props, id: NOMBRE }; }',
        `export const config = { retries: ${i % 5}, timeoutMs: 1500, baseUrl: 'https://api.example.com/v${i % 3}' };`,
      ].join('\n'));
    }
    const t0 = Date.now();
    const report = await scanPaths({ root: dir, hmacKey: KEY });
    const ms = Date.now() - t0;
    assert.equal(report.stats.files, 2000);
    assert.ok(ms < 3000, `2.000 archivos tardaron ${ms} ms`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('archivos de datos grandes: se escanean por chunks, no se saltan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-stream-'));
  try {
    const relleno = 'id,nombre,ciudad\n' + '1,Ana,CDMX\n'.repeat(120_000);
    const csv = `${relleno}9,token,AKIAIOSFODNN7EXAMPLE\n${relleno}`;
    writeFileSync(join(dir, 'export.csv'), csv);
    const report = await scanPaths({ root: dir, hmacKey: KEY, maxFileSizeMB: 1 });
    assert.ok(report.findings.some((f) => f.ruleId === 'aws-access-key-id'), 'el token dentro del csv grande debe detectarse');
    assert.ok(report.skipped.some((s) => s.path === 'export.csv' && s.reason === 'streamed'),
      'el archivo grande queda registrado como escaneado por chunks');
    assert.ok(!JSON.stringify(report).includes('AKIAIOSFODNN7EXAMPLE'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un symlink que escapa de la raíz es hallazgo HIGH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-sym-'));
  const fuera = mkdtempSync(join(tmpdir(), 'bot-secure-fuera-'));
  try {
    writeFileSync(join(fuera, 'credentials'), 'aws_secret_access_key = x');
    writeFileSync(join(dir, 'app.js'), 'const a = 1;');
    symlinkSync(join(fuera, 'credentials'), join(dir, 'aws-config'));
    const report = await scanPaths({ root: dir, hmacKey: KEY });
    const hit = report.findings.find((f) => f.ruleId === 'symlink-outside-repo');
    assert.ok(hit, 'no se reportó el enlace que sale del repositorio');
    assert.equal(hit.severity, 'HIGH');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fuera, { recursive: true, force: true }); }
});

test('el reporte registra lo omitido y la advertencia fija', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-secure-skip-'));
  try {
    writeFileSync(join(dir, 'grande.bin2'), 'z'.repeat(2 * 1024 * 1024));
    writeFileSync(join(dir, 'ok.txt'), 'hola');
    const report = await scanPaths({ root: dir, hmacKey: KEY, maxFileSizeMB: 1 });
    assert.ok(report.skipped.some((s) => s.path === 'grande.bin2' && s.reason === 'size'));
    assert.ok(report.warnings.some((w) => /no garantiza|does not guarantee/i.test(w)));
    assert.ok(report.reportSha256);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
