// Adaptador de gitleaks: mapa de reglas y degradación limpia cuando el binario no está.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RULE_MAP, available, candidates, nativeRuleId } from '../../src/engine/adapters/gitleaks.mjs';
import { loadRules } from '../../src/engine/rules.mjs';

test('todos los ruleIds destino del mapa existen en el catálogo nativo', () => {
  const ids = new Set(loadRules().map((r) => r.id));
  for (const [glRule, nativo] of Object.entries(RULE_MAP)) {
    assert.ok(ids.has(nativo), `${glRule} apunta a un ruleId inexistente: ${nativo}`);
  }
  assert.ok(Object.keys(RULE_MAP).length >= 30);
});

test('nativeRuleId traduce y devuelve null si no hay equivalente', () => {
  assert.equal(nativeRuleId('aws-access-token'), 'aws-access-key-id');
  assert.equal(nativeRuleId('regla-inventada'), null);
});

test('available() no lanza aunque gitleaks no esté instalado', () => {
  const av = available();
  assert.equal(typeof av.ok, 'boolean');
});

test('candidates() degrada sin gitleaks en vez de fallar', () => {
  const res = candidates(process.cwd(), { history: false, timeout: 5000 });
  assert.equal(typeof res.ok, 'boolean');
  assert.ok(Array.isArray(res.candidates));
  if (!res.ok) assert.ok(res.reason, 'debe explicar por qué no se usó');
  for (const c of res.candidates) {
    assert.equal(typeof c.file, 'string');
    assert.equal(c.source, 'gitleaks');
  }
});
