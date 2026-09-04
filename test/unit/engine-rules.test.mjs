// Catálogo de reglas: esquema, unicidad, compilación y prefiltro de keywords.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compiledRules, globToRegExp, loadRules, matchesAny, sliceLine, RULES_VERSION, scanContent, MAX_LINE } from '../../src/engine/rules.mjs';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const CATEGORIES = ['secret', 'pii', 'file', 'placeholder-leak', 'config'];

test('RULES_VERSION tiene el formato esperado', () => {
  assert.match(RULES_VERSION, /^\d{4}\.\d{2}\.\d+$/);
});

test('todas las reglas cumplen el esquema del contrato', () => {
  const rules = loadRules();
  assert.ok(rules.length >= 60, `esperaba ≥60 reglas, hay ${rules.length}`);
  const ids = new Set();
  for (const r of rules) {
    assert.ok(r.id, 'regla sin id');
    assert.ok(!ids.has(r.id), `id duplicado: ${r.id}`);
    ids.add(r.id);
    assert.ok(CATEGORIES.includes(r.category), `${r.id}: category inválida (${r.category})`);
    assert.ok(SEVERITIES.includes(r.severity), `${r.id}: severity inválida (${r.severity})`);
    assert.equal(typeof r.description?.es, 'string', `${r.id}: falta description.es`);
    assert.equal(typeof r.description?.en, 'string', `${r.id}: falta description.en`);
    assert.ok(Array.isArray(r.keywords), `${r.id}: keywords debe ser array`);
    assert.ok(r.remediation?.kind, `${r.id}: falta remediation.kind`);
    assert.ok(r.regex || r.filesOnly || r.scope, `${r.id}: sin regex ni scope ni filesOnly`);
  }
});

test('todas las regex compilan y no llevan cuantificadores anidados', () => {
  const nested = /\([^()]*[+*]\)\s*[+*]|\[[^\]]*\][+*]\{?\d*,?\d*\}?[+*]/;
  for (const { rule, re } of compiledRules()) {
    if (!re) continue;
    assert.ok(re instanceof RegExp, `${rule.id}: no compiló`);
    assert.ok(!nested.test(rule.regex), `${rule.id}: posible cuantificador anidado -> ${rule.regex}`);
  }
});

test('las reglas con prefijo usan el prefijo en minúsculas como keyword', () => {
  const expected = {
    'aws-access-key-id': 'akia', 'github-token': 'ghp_', 'anthropic-api-key': 'sk-ant-',
    jwt: 'eyj', 'private-key-pem': '-----begin', 'npm-token': 'npm_', 'gitlab-pat': 'glpat-',
  };
  const byId = new Map(loadRules().map((r) => [r.id, r]));
  for (const [id, kw] of Object.entries(expected)) {
    assert.ok(byId.get(id)?.keywords.includes(kw), `${id}: falta el keyword ${kw}`);
  }
});

test('el prefiltro por keyword no impide detectar tokens sin palabra de contexto', async () => {
  const text = [
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_FAKE0000FAKE0000FAKE0000FAKE0000FAKE',
    'glpat-VALOR_RETIRADO',
    'npm_FAKE0000FAKE0000FAKE0000FAKE0000FAKE',
    'AIzaFAKE0000FAKE0000FAKE0000FAKE0000FAK',
    'sk_live_VALOR_RETIRADO',
    'sk-ant-api03-FAKE0000FAKE0000FAKE0000FAKE0000',
    'xoxb-VALOR-RETIRADO',
    'hf_VALOR_RETIRADO',
    '-----BEGIN RSA PRIVATE KEY-----',
  ].join('\n');
  const found = await scanContent(text, { path: 'sin-contexto.txt' });
  const ids = new Set(found.map((f) => f.ruleId));
  for (const id of ['aws-access-key-id', 'github-token', 'gitlab-pat', 'npm-token', 'google-api-key',
    'stripe-live-key', 'anthropic-api-key', 'slack-token', 'huggingface-token', 'private-key-pem']) {
    assert.ok(ids.has(id), `no se detectó ${id} sin palabra de contexto`);
  }
});

test('globToRegExp respeta los límites de directorio', () => {
  assert.ok(globToRegExp('**/.env').test('.env'));
  assert.ok(globToRegExp('**/.env').test('backend/config/.env'));
  assert.ok(!globToRegExp('**/.env').test('placeholders.env'));
  assert.ok(globToRegExp('**/*.pem').test('certs/server.pem'));
  assert.ok(!globToRegExp('**/*.pem').test('certs/server.pem.bak'));
  assert.ok(matchesAny('a/b/.npmrc', ['**/.npmrc']));
});

test('sliceLine trocea líneas largas con solapamiento', () => {
  const line = 'x'.repeat(MAX_LINE * 3);
  const slices = sliceLine(line);
  assert.ok(slices.length >= 3);
  assert.equal(slices[0].offset, 0);
  assert.ok(slices[1].offset < MAX_LINE, 'debe haber solapamiento entre trozos');
  assert.equal(sliceLine('corta').length, 1);
});
