// `bot-secure scan` visto desde fuera: escribe los tres formatos de reporte, ninguno contiene el
// valor original, el resumen por severidad cuadra y el exit code respeta --fail-on.
// Todos los secretos de este archivo son FALSOS (sufijo EXAMPLE / valores de documentación).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'bot-secure.mjs');

// Valores FALSOS: clave de ejemplo de la documentación de AWS y un token con prefijo reconocible.
export const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
export const FAKE_GH = 'ghp_' + '0123456789abcdefghijklmnopqrstuvwxyzAB';

const POLICY = {
  version: 1, project: 'tienda', profile: 'standard', level: 1, mode: 'clone', runtime: 'tests', lang: 'es',
  guard: { mode: 'block', strictRead: false, docsReminder: false, promptBlockSeverity: 'HIGH' },
  branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'main'] },
  apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'node' }],
  network: { allowedDomains: [], registries: [], prodHosts: [] }, mcp: { allowed: [] },
  owners: { repoOwner: '', infosec: '', platform: '' },
  scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
};

/** Workspace temporal con secretos FALSOS y una casa de bot-secure aislada. */
export function ws(t, { extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bs-scan-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bs-home-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  mkdirSync(join(root, '.bot-secure'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, '.bot-secure', 'policy.json'), JSON.stringify(POLICY, null, 2));
  writeFileSync(join(root, 'backend', 'config.json'), JSON.stringify({ aws_access_key_id: FAKE_AWS }, null, 2) + '\n');
  writeFileSync(join(root, 'backend', 'app.js'), `const token = "${FAKE_GH}";\n`);
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, home };
}

/** Ejecuta el CLI con la casa aislada y sin CI (para que el modo sea el esperado). */
export function cli({ root, home }, ...args) {
  const env = { ...process.env, NO_COLOR: '1', BOT_SECURE_HOME: home, BOT_SECURE_LANG: 'es' };
  delete env.CI;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env });
}

test('scan escribe report.json/md/sarif y ninguno contiene el valor original', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan');
  assert.equal(r.status, 1, r.stderr); // hay CRITICAL ≥ failOn HIGH
  for (const f of ['report.json', 'report.md', 'report.sarif']) {
    const p = join(w.root, '.bot-secure', 'reports', f);
    assert.ok(existsSync(p), `falta ${f}`);
    const text = readFileSync(p, 'utf8');
    assert.ok(!text.includes(FAKE_AWS), `${f} filtró el valor`);
    assert.ok(!text.includes(FAKE_GH), `${f} filtró el valor`);
  }
  assert.ok(existsSync(join(w.root, '.bot-secure', 'reports', '.gitignore')), 'falta el .gitignore de reports/');
});

test('el resumen por severidad cuadra con el reporte y la salida va enmascarada', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan');
  const report = JSON.parse(readFileSync(join(w.root, '.bot-secure', 'reports', 'report.json'), 'utf8'));
  const total = Object.values(report.stats.bySeverity).reduce((a, b) => a + b, 0);
  assert.equal(total, report.findings.length);
  for (const [sev, count] of Object.entries(report.stats.bySeverity)) {
    if (count) assert.match(r.stdout, new RegExp(`${sev}: ${count}`));
  }
  assert.ok(!r.stdout.includes(FAKE_AWS) && !r.stderr.includes(FAKE_AWS), 'la salida filtró el valor');
  assert.match(r.stdout, /AKIA…\(20\)/); // máscara: prefijo + longitud
  assert.match(r.stderr, /Ausencia de hallazgos no garantiza ausencia de secretos/);
});

test('--fail-on decide el exit code (NONE nunca falla, LOW falla)', (t) => {
  const w = ws(t);
  assert.equal(cli(w, 'scan', '--fail-on', 'NONE').status, 0);
  assert.equal(cli(w, 'scan', '--fail-on', 'LOW').status, 1);
  const bad = cli(w, 'scan', '--fail-on', 'GRAVISIMO');
  assert.equal(bad.status, 2);
  assert.match(bad.stdout, /Arreglo: /);
});

test('--json imprime SOLO datos en stdout', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan', '--json');
  const data = JSON.parse(r.stdout);
  assert.equal(data.command, 'scan');
  assert.equal(data.exitCode, 1);
  assert.equal(typeof data.reportSha256, 'string');
  assert.ok(!r.stdout.includes(FAKE_AWS));
});

test('--dry-run no escribe ningún reporte', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan', '--dry-run');
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(w.root, '.bot-secure', 'reports')), false);
  assert.match(r.stdout, /--dry-run/);
});

test('--placeholder-leak detecta el placeholder colado en código y NO lo marca en .env.ai', (t) => {
  const w = ws(t, {
    extra: {
      'backend/leak.js': 'const pass = "__AI_PLACEHOLDER__DB_PASSWORD__";\n',
      '.env.ai': 'DB_PASSWORD=__AI_PLACEHOLDER__DB_PASSWORD__\n',
      'docs/base-de-datos.md': 'La contraseña es `__AI_PLACEHOLDER__DB_PASSWORD__`.\n',
    },
  });
  const data = JSON.parse(cli(w, 'scan', '--placeholder-leak', '--json').stdout);
  assert.equal(data.byRule['ai-placeholder-leak'], 1, 'debe haber exactamente una fuga (la del código)');
  const report = JSON.parse(readFileSync(join(w.root, '.bot-secure', 'reports', 'report.json'), 'utf8'));
  const leaks = report.findings.filter((f) => f.category === 'placeholder-leak');
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].file, 'backend/leak.js');
  assert.equal(leaks[0].severity, 'CRITICAL');
  assert.match(leaks[0].fingerprint, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(report).includes('__AI_PLACEHOLDER__DB_PASSWORD__'), 'el reporte no debe llevar el valor');
});

test('sin nada en el índice, --staged no escanea y termina en 0', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan', '--staged');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /índice de git/);
});

test('--out escribe los reportes en otra carpeta', (t) => {
  const w = ws(t);
  const r = cli(w, 'scan', '--out', 'evidencia');
  assert.equal(r.status, 1);
  assert.ok(existsSync(join(w.root, 'evidencia', 'report.json')));
  assert.ok(!existsSync(join(w.root, '.bot-secure', 'reports', 'report.json')));
});
