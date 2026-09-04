import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport, writeReports, toSarif, toMarkdown, verifyReport } from '../../src/engine/report.mjs';
import { hmacFingerprint, piiFingerprint } from '../../src/engine/fingerprint.mjs';
import { mask } from '../../src/engine/masks.mjs';

const FAKE = 'AKIAIOSFODNN7EXAMPLE';
const CLABE = '012180001234567895';
const KEY = Buffer.alloc(32, 1);

function findings() {
  const fp1 = hmacFingerprint(KEY, 'aws-access-key', '.env', FAKE);
  const fp2 = piiFingerprint(KEY, 'clabe', 'data/clientes.csv', `juan,${CLABE}`);
  return [
    { id: fp2, ruleId: 'clabe', category: 'pii', severity: 'MEDIUM', file: 'data/clientes.csv', line: 7, masked: mask(CLABE, 'clabe'), fingerprint: fp2, entropy: 3.2,
      remediation: { kind: 'pii', action: 'Sustituir por datos sintéticos' }, source: 'native' },
    { id: fp1, ruleId: 'aws-access-key', category: 'secret', severity: 'CRITICAL', file: '.env', line: 3, column: 19, masked: mask(FAKE, 'token'), fingerprint: fp1, entropy: 3.9,
      remediation: { kind: 'secret', action: 'Rotar la llave y moverla a variable de entorno', envVar: 'AWS_ACCESS_KEY_ID' }, source: 'native', reachable: false },
  ];
}

function build(root) {
  return buildReport({ root, mode: 'scan', findings: findings(), stats: { files: 12, bytes: 4096, ms: 33 },
    skipped: [{ path: 'dump.sql', reason: 'size', size: 9000000 }, { path: 'big.xlsx', reason: 'lfs' }],
    warnings: ['gitleaks no disponible'], version: '0.1.0', rulesVersion: '2026.09', commit: 'abc1234', now: new Date('2026-09-03T12:00:00Z') });
}

test('buildReport: reportSha256 sobre el JSON sin ese campo, advertencia fija, orden por severidad, PII sin entropy', () => {
  const r = build('/repo');
  assert.ok(verifyReport(r));
  assert.ok(r.warnings.includes('Ausencia de hallazgos no garantiza ausencia de secretos'));
  assert.ok(r.warnings.includes('gitleaks no disponible'));
  assert.equal(r.findings[0].severity, 'CRITICAL');
  assert.equal(r.findings[1].category, 'pii');
  assert.equal(r.findings[1].entropy, undefined, 'PII nunca expone entropy');
  assert.equal(r.findings[0].entropy, 3.9);
  assert.deepEqual(r.stats.bySeverity, { CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 0, INFO: 0 });
  assert.equal(r.stats.byRule['aws-access-key'], 1);
  assert.equal(r.stats.files, 12);
  const tampered = { ...r, findings: [] };
  assert.ok(!verifyReport(tampered));
  assert.equal(buildReport({ root: '/r', mode: 'scan', findings: [], version: '0', rulesVersion: '0' }).warnings.length, 1, 'no duplica la advertencia fija');
});

test('writeReports: json/md/sarif no contienen el valor original pero sí su máscara', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-report-'));
  try {
    const r = build(dir);
    const paths = writeReports(r, { dir, lang: 'es' });
    assert.deepEqual(paths.map((p) => p.slice(dir.length + 1)), ['report.json', 'report.md', 'report.sarif']);
    for (const p of paths) {
      const txt = readFileSync(p, 'utf8');
      assert.ok(!txt.includes(FAKE), `${p} no contiene el secreto`);
      assert.ok(!txt.includes(CLABE), `${p} no contiene la CLABE`);
      assert.ok(!/\d{11,}/.test(txt), `${p} no contiene corridas de 11+ dígitos (oráculo PII)`);
      assert.ok(txt.includes('AKIA…(20)'), `${p} contiene la máscara del token`);
      assert.ok(txt.includes('012…'), `${p} contiene la máscara de la CLABE`);
    }
    const md = readFileSync(paths[1], 'utf8');
    assert.match(md, /## Resumen por severidad/);
    assert.match(md, /\| CRITICAL \| 1 \|/);
    assert.match(md, /\| CRITICAL \| \.env:3 \(inalcanzable\) \| secret\/aws-access-key \| AKIA…\(20\) \| Rotar la llave[^|]*`AWS_ACCESS_KEY_ID`/);
    assert.match(md, /- \[ \] rotado · \[ \] movido a env \(`AWS_ACCESS_KEY_ID`\) · \[ \] campo vacío/);
    assert.match(md, /## No escaneado[\s\S]*\| dump\.sql \| size \| 9000000 \|[\s\S]*\| big\.xlsx \| lfs \|/);
    assert.match(md, /## Advertencias[\s\S]*Ausencia de hallazgos no garantiza ausencia de secretos/);
    assert.match(md, /Integridad \(sha256\): `[0-9a-f]{64}`/);
    const en = toMarkdown(r, { lang: 'en' });
    assert.match(en, /## Summary by severity/);
    assert.throws(() => writeReports(r, { dir, formats: ['pdf'] }), (e) => e.key === 'report.unknownFormat' && !!e.fix);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SARIF 2.1.0 estructuralmente válido: driver.rules, results con level/locations/ruleIndex', () => {
  const r = build('/repo');
  const s = toSarif(r);
  assert.equal(s.version, '2.1.0');
  assert.match(s.$schema, /sarif-schema-2\.1\.0\.json$/);
  assert.equal(s.runs.length, 1);
  const run = s.runs[0];
  assert.equal(run.tool.driver.name, 'bot-secure');
  assert.equal(run.tool.driver.rules.length, 2);
  for (const rule of run.tool.driver.rules) {
    assert.equal(typeof rule.id, 'string');
    assert.ok(['error', 'warning', 'note', 'none'].includes(rule.defaultConfiguration.level));
  }
  assert.equal(run.results.length, 2);
  for (const res of run.results) {
    assert.ok(['error', 'warning', 'note', 'none'].includes(res.level));
    assert.equal(run.tool.driver.rules[res.ruleIndex].id, res.ruleId);
    assert.equal(typeof res.message.text, 'string');
    const loc = res.locations[0].physicalLocation;
    assert.equal(typeof loc.artifactLocation.uri, 'string');
    assert.equal(loc.artifactLocation.uriBaseId, '%SRCROOT%');
    assert.ok(Number.isInteger(loc.region.startLine) && loc.region.startLine >= 1);
    assert.match(res.partialFingerprints['bot-secure/v1'], /^[0-9a-f]{16}$/);
  }
  assert.equal(run.results[0].level, 'error');
  assert.equal(run.results[1].level, 'warning');
  assert.equal(run.results[0].locations[0].physicalLocation.region.startColumn, 19);
  assert.equal(run.results[0].properties.reachable, false);
  assert.match(run.originalUriBaseIds['%SRCROOT%'].uri, /^file:\/\/.*\/$/);
  assert.ok(!JSON.stringify(s).includes(FAKE));
});
