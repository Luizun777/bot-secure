import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBaseline, isSuppressed, add, expire, list, approve, pendingApprovals } from '../../src/engine/baseline.mjs';

const FP = 'deadbeef00112233';
const NOW = new Date('2026-09-03T12:00:00Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'bs-baseline-'));

test('baseline vacío si no existe; add LOW sin reason; suprime por fingerprint', () => {
  const root = tmp();
  try {
    assert.deepEqual(loadBaseline(root), { version: 1, entries: [] });
    const e = add(root, FP, { by: 'ana', severity: 'LOW', now: NOW, ruleId: 'generic', file: 'a.js' });
    assert.equal(e.needsSecondApproval, false);
    const b = loadBaseline(root);
    assert.equal(b.entries.length, 1);
    assert.ok(isSuppressed({ fingerprint: FP }, b, NOW));
    assert.ok(isSuppressed({ id: FP }, b, NOW), 'también por id');
    assert.ok(!isSuppressed({ fingerprint: '0000000000000000' }, b, NOW));
    assert.match(readFileSync(join(root, '.bot-secure', 'baseline.json'), 'utf8'), /"version": 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('expiresAt: vigente antes, expirado después (expirado = no suprimido); expire() la vence ya', () => {
  const root = tmp();
  try {
    add(root, FP, { by: 'ana', severity: 'MEDIUM', expiresAt: '2026-12-31', now: NOW });
    const b = loadBaseline(root);
    assert.ok(isSuppressed({ fingerprint: FP }, b, NOW));
    assert.ok(!isSuppressed({ fingerprint: FP }, b, new Date('2027-01-01T00:00:00Z')));
    assert.equal(list(root, { now: NOW })[0].status, 'active');
    assert.equal(list(root, { now: new Date('2027-01-01') })[0].status, 'expired');
    expire(root, FP, { now: NOW });
    assert.ok(!isSuppressed({ fingerprint: FP }, loadBaseline(root), NOW));
    assert.throws(() => expire(root, '1111111111111111'), (e) => e.key === 'report.baselineNotFound' && !!e.fix);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('HIGH/CRITICAL: exigen reason y quedan needsSecondApproval:true; approve exige otra persona', () => {
  const root = tmp();
  try {
    assert.throws(() => add(root, FP, { by: 'ana', severity: 'HIGH', now: NOW }), (e) => e.key === 'report.reasonRequired' && /--reason/.test(e.fix));
    assert.throws(() => add(root, FP, { by: 'ana', severity: 'CRITICAL', reason: '   ', now: NOW }), (e) => e.key === 'report.reasonRequired');
    const e = add(root, FP, { by: 'ana', severity: 'CRITICAL', reason: 'llave pública de prueba de reCAPTCHA', now: NOW });
    assert.equal(e.needsSecondApproval, true);
    assert.equal(list(root, { now: NOW })[0].status, 'pending');
    assert.equal(pendingApprovals(loadBaseline(root), NOW).length, 1);
    assert.throws(() => approve(root, FP, { by: 'ana', now: NOW }), (e) => e.key === 'report.secondPersonRequired');
    approve(root, FP, { by: 'infosec', now: NOW });
    assert.equal(list(root, { now: NOW })[0].status, 'active');
    assert.equal(pendingApprovals(loadBaseline(root), NOW).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('validaciones: fingerprint, severidad y fecha inválidas → BotSecureError con fix; baseline corrupto', () => {
  const root = tmp();
  try {
    assert.throws(() => add(root, 'xyz', { severity: 'LOW' }), (e) => e.key === 'report.badFingerprint' && !!e.fix);
    assert.throws(() => add(root, FP, { severity: 'URGENTE' }), (e) => e.key === 'report.badSeverity');
    assert.throws(() => add(root, FP, { severity: 'LOW', expiresAt: 'mañana' }), (e) => e.key === 'report.badDate');
    mkdirSync(join(root, '.bot-secure'), { recursive: true });
    writeFileSync(join(root, '.bot-secure', 'baseline.json'), '{ no json');
    assert.throws(() => loadBaseline(root), (e) => e.key === 'report.baselineCorrupt' && !!e.fix);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
