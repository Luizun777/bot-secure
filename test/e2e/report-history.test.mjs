// E2E: repo temporal con .env (AKIAIOSFODNN7EXAMPLE) commiteado y luego quitado con --amend.
// scanHistory debe encontrar el blob inalcanzable (reachable:false) sin exponer el valor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHistory } from '../../src/engine/adapters/git-history.mjs';
import { hmacFingerprint } from '../../src/engine/fingerprint.mjs';
import { mask } from '../../src/engine/masks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, 'tmp', `history-${process.pid}`);
const EVIDENCE = join(HERE, 'evidence', 'report-history.txt');
const FAKE = 'AKIAIOSFODNN7EXAMPLE';
const KEY = Buffer.alloc(32, 3);

const git = (args, cwd) => {
  const r = spawnSync('git', ['-c', 'user.name=bot', '-c', 'user.email=bot@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** scanText mínimo inyectado: solo detecta llaves AKIA. */
const scanText = (text, { path, hmacKey }) => {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /AKIA[0-9A-Z]{16}/.exec(line);
    if (!m) return;
    const fp = hmacFingerprint(hmacKey, 'aws-access-key', path, m[0]);
    out.push({ id: fp, ruleId: 'aws-access-key', category: 'secret', severity: 'CRITICAL', file: path, line: i + 1,
      masked: mask(m[0], 'token'), fingerprint: fp, remediation: { kind: 'secret', action: 'rotar', envVar: 'AWS_ACCESS_KEY_ID' }, source: 'native' });
  });
  return out;
};

test('scanHistory encuentra el secreto amendeado con reachable:false, sin exponer el valor', async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  try {
    git(['init', '-q', '-b', 'main'], TMP);
    writeFileSync(join(TMP, 'README.md'), '# demo\n');
    git(['add', '.'], TMP); git(['commit', '-q', '-m', 'inicio'], TMP);
    writeFileSync(join(TMP, '.env'), `AWS_ACCESS_KEY_ID=${FAKE}\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n`);
    writeFileSync(join(TMP, 'big.bin'), 'version https://git-lfs.github.com/spec/v1\noid sha256:aaaa\nsize 12345\n');
    git(['add', '-f', '.'], TMP); git(['commit', '-q', '-m', 'agrega env (error)'], TMP);
    git(['rm', '-q', '--cached', '.env'], TMP); rmSync(join(TMP, '.env'));
    git(['commit', '-q', '--amend', '-m', 'agrega lfs pointer'], TMP);
    // El .env ya no está en ninguna ref, pero el blob sigue en .git/objects.
    assert.ok(!git(['ls-files'], TMP).includes('.env'));
    assert.ok(!/\.env/.test(spawnSync('git', ['rev-list', '--all', '--objects'], { cwd: TMP, encoding: 'utf8' }).stdout));

    const { findings, skipped, stats } = await scanHistory({ root: TMP, hmacKey: KEY, scanText });
    const json = JSON.stringify({ findings, skipped, stats });
    assert.ok(!json.includes(FAKE), 'el resultado no contiene el valor');
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.file, '.env');
    assert.equal(f.line, 1);
    assert.equal(f.reachable, false);
    assert.equal(f.masked, 'AKIA…(20)');
    assert.match(f.commit ?? '', /^[0-9a-f]{40}$/, 'commit recuperado vía reflog');
    assert.match(f.blob, /^[0-9a-f]{40,64}$/);
    assert.equal(f.occurrences.length, 1);
    assert.ok(skipped.some((s) => s.path === 'big.bin' && s.reason === 'lfs'), 'pointer LFS reportado');
    assert.ok(stats.blobs >= 3 && stats.unreachable >= 1);

    // since en el futuro: los blobs alcanzables viejos quedan fuera, el inalcanzable se escanea igual
    const r2 = await scanHistory({ root: TMP, hmacKey: KEY, scanText, since: '2100-01-01' });
    assert.equal(r2.findings.length, 1);

    mkdirSync(dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, [
      `# report-history e2e — ${new Date().toISOString()}`,
      `git: ${spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim()}`,
      `blobs=${stats.blobs} scanned=${stats.scanned} unreachable=${stats.unreachable}`,
      `finding: ${f.file}:${f.line} ${f.ruleId} masked=${f.masked} reachable=${f.reachable} fp=${f.fingerprint}`,
      `skipped: ${skipped.map((s) => `${s.path}(${s.reason})`).join(', ')}`,
      '',
    ].join('\n'));
    assert.ok(existsSync(EVIDENCE));
  } finally { rmSync(TMP, { recursive: true, force: true }); }
});

test('scanHistory sin repo git → BotSecureError report.notGitRepo con fix', async () => {
  // fuera del repo del bot (test/e2e/tmp está dentro de un repo git)
  const dir = mkdtempSync(join(tmpdir(), 'bs-nogit-'));
  try {
    await assert.rejects(scanHistory({ root: dir, hmacKey: KEY, scanText }), (e) => e.key === 'report.notGitRepo' && /git init/.test(e.fix));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
