// policy/compile.mjs: los artefactos generados deben ser JSON válido, portables (sin rutas
// absolutas ni de máquina) y coherentes con el perfil, el SO y el modo de la política.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileSettings, allowedDomains, REGISTRIES_BY_STACK } from '../../src/policy/compile.mjs';
import { defaultPolicy } from '../../src/policy/index.mjs';

const OSES = ['darwin', 'linux', 'win32'];
const basePolicy = (over = {}) => ({
  ...defaultPolicy({ project: 'tienda', apps: [{ name: 'backend', path: 'backend', kind: 'backend', stack: 'spring' }, { name: 'frontend', path: 'frontend', kind: 'frontend', stack: 'next' }] }),
  ...over,
});
const settingsOf = (artifacts, path = '.claude/settings.json') => JSON.parse(artifacts.find((a) => a.path.split(/[\\/]/).join('/') === path).content);

test('compile produce settings.json parseable para cada perfil y SO', () => {
  for (const profile of ['sensitive', 'standard']) {
    for (const os of OSES) {
      const artifacts = compile(basePolicy({ profile }), { os });
      const s = settingsOf(artifacts);
      assert.ok(Array.isArray(s.permissions.deny) && s.permissions.deny.length > 50, `${profile}/${os}: deny vacío`);
      assert.ok(Array.isArray(s.permissions.ask));
      assert.ok(Array.isArray(s.permissions.allow));
      assert.equal(s.autoMemoryEnabled, false);
      assert.equal(s.cleanupPeriodDays, 7);
      assert.equal(s.env.AI_ENV, '1');
      assert.equal(s.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
      assert.equal(s.env.DISABLE_TELEMETRY, '1');
    }
  }
});

test('settings.json no contiene rutas absolutas ni de máquina', () => {
  for (const os of OSES) {
    for (const a of compile(basePolicy(), { os })) {
      if (!/settings\.json$/.test(a.path)) continue;
      assert.ok(!/"\/(Users|home|etc|opt|var|tmp|private)\//.test(a.content), `${a.path}: ruta absolta POSIX`);
      assert.ok(!/[A-Za-z]:\\\\/.test(a.content), `${a.path}: ruta absoluta Windows`);
    }
  }
});

test('los hooks se invocan con ruta relativa (portabilidad entre máquinas)', () => {
  const posix = settingsOf(compile(basePolicy(), { os: 'darwin' }));
  for (const group of Object.values(posix.hooks)) {
    for (const entry of group) for (const h of entry.hooks) assert.match(h.command, /^sh \.\/\.claude\/hooks\/run [a-z-]+$/);
  }
  assert.match(posix.statusLine.command, /^sh \.\/\.claude\/hooks\/run statusline$/);

  const win = settingsOf(compile(basePolicy(), { os: 'win32' }));
  for (const group of Object.values(win.hooks)) {
    for (const entry of group) for (const h of entry.hooks) assert.match(h.command, /\.\/\.claude\/hooks\/run\.ps1 [a-z-]+$/);
  }
});

test('los eventos de hooks son los del contrato y SessionStart cubre las 4 fuentes', () => {
  const s = settingsOf(compile(basePolicy(), { os: 'linux' }));
  assert.deepEqual(Object.keys(s.hooks).sort(), ['ConfigChange', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort());
  assert.equal(s.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.match(s.hooks.PreToolUse[0].matcher, /Bash\|Edit\|Write\|NotebookEdit\|mcp__\.\*/);
});

test('guard.strictRead añade Read|Grep|Glob al matcher de PreToolUse', () => {
  const off = settingsOf(compile(basePolicy(), { os: 'linux' })).hooks.PreToolUse[0].matcher;
  const on = settingsOf(compile(basePolicy({ guard: { mode: 'block', strictRead: true, docsReminder: false, promptBlockSeverity: 'HIGH' } }), { os: 'linux' })).hooks.PreToolUse[0].matcher;
  assert.ok(!/Read/.test(off));
  assert.ok(/Read\|Grep\|Glob/.test(on));
});

test('el deny cubre .env, material de llaves, tfstate, ~/ y binarios de red', () => {
  const deny = settingsOf(compile(basePolicy(), { os: 'darwin' })).permissions.deny;
  const has = (s) => deny.includes(s);
  assert.ok(has('Read(./.env)') && has('Read(./**/.env)'));
  assert.ok(has('Read(./**/*.pem)') && has('Read(./**/*.jks)') && has('Read(./**/*.p12)'));
  assert.ok(has('Read(./**/*.tfstate)') && has('Read(./**/*.tfstate.*)'));
  assert.ok(has('Read(~/.claude/**)') && has('Read(~/.claude.json)') && has('Read(~/.aws/**)') && has('Read(~/.ssh/**)') && has('Read(~/.npmrc)') && has('Read(~/.netrc)'));
  assert.ok(has('Read(./.git/**)') && has('Read(./.mcp.json)') && has('Read(./.vscode/launch.json)'));
  assert.ok(has('Grep(./.env)') && has('Glob(./.env)'));
  assert.ok(has('Write(./.claude/**)') && has('Edit(./.githooks/**)') && has('Write(./.env.ai)'));
  for (const b of ['curl', 'wget', 'nc', 'socat', 'rsync', 'ftp', 'sftp', 'telnet', 'dig', 'nslookup', 'host', 'ping', 'ssh', 'scp', 'Invoke-WebRequest']) {
    assert.ok(has(`Bash(${b} *)`), `falta deny de ${b}`);
  }
  assert.ok(has('Bash(env)') && has('Bash(printenv)') && has('Bash(set)') && has('Bash(export -p)') && has('Bash(declare -x)'));
  assert.ok(has('Bash(git worktree *)') && has('Bash(git remote add *)') && has('Bash(git remote set-url *)'));
  assert.ok(has('Bash(npm publish*)') && has('Bash(dangerouslyDisableSandbox:true)') && has('Bash(* --no-verify*)'));
  assert.ok(has('WebFetch') && has('WebSearch') && has('mcp__*'));
});

test('*.sql NO se deniega en general (las migraciones deben poder leerse)', () => {
  const deny = settingsOf(compile(basePolicy(), { os: 'darwin' })).permissions.deny;
  assert.ok(!deny.includes('Read(./**/*.sql)'));
});

test('los deny de historia git solo existen en modo worktree', () => {
  const clone = settingsOf(compile(basePolicy({ mode: 'clone' }), { os: 'linux' })).permissions.deny;
  const worktree = settingsOf(compile(basePolicy({ mode: 'worktree' }), { os: 'linux' })).permissions.deny;
  for (const rule of ['Bash(git show*)', 'Bash(git log -p*)', 'Bash(git stash*)', 'Bash(git cat-file*)', 'Bash(git -C *)']) {
    assert.ok(!clone.includes(rule), `clone no debería denegar ${rule}`);
    assert.ok(worktree.includes(rule), `worktree debería denegar ${rule}`);
  }
});

test('ask y allow siguen el plan (push/checkout/switch/npm run vs git seguro y .env.ai)', () => {
  const s = settingsOf(compile(basePolicy(), { os: 'darwin' }));
  for (const r of ['Bash(git push*)', 'Bash(git checkout*)', 'Bash(git switch*)', 'Bash(npm run *)']) assert.ok(s.permissions.ask.includes(r), `falta ask ${r}`);
  for (const r of ['Read(./.env.ai)', 'Read(./.env.example)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git add *)', 'Bash(git commit -m *)', 'Bash(git log --oneline*)', 'Bash(git switch -c ai/*)', 'Bash(env AI_ENV=1 *)', 'Bash(npm test*)']) {
    assert.ok(s.permissions.allow.includes(r), `falta allow ${r}`);
  }
  const win = settingsOf(compile(basePolicy(), { os: 'win32' })).permissions.ask;
  assert.ok(win.includes('Bash(node -e *)') && win.includes('Bash(python -c *)') && win.includes('Bash(powershell *)'));
});

test('mcp: se deniega el comodín solo si no hay servidores permitidos', () => {
  const none = settingsOf(compile(basePolicy(), { os: 'linux' })).permissions;
  assert.ok(none.deny.includes('mcp__*'));
  const some = settingsOf(compile(basePolicy({ mcp: { allowed: ['jira'] } }), { os: 'linux' })).permissions;
  assert.ok(!some.deny.includes('mcp__*'));
  assert.ok(some.allow.includes('mcp__jira'));
});

test('sandbox: se omite en win32 y es fail-closed en perfil sensitive', () => {
  assert.equal(settingsOf(compile(basePolicy(), { os: 'win32' })).sandbox, undefined);
  const sens = settingsOf(compile(basePolicy({ profile: 'sensitive' }), { os: 'darwin' })).sandbox;
  assert.equal(sens.enabled, true);
  assert.equal(sens.failIfUnavailable, true);
  assert.equal(sens.allowUnsandboxedCommands, false);
  assert.ok(sens.filesystem.denyRead.includes('~/'));
  assert.ok(sens.filesystem.denyRead.includes('.env'));
  assert.ok(sens.credentials.files.some((f) => f.path === '~/.aws' && f.mode === 'deny'));
  const std = settingsOf(compile(basePolicy({ profile: 'standard' }), { os: 'linux' })).sandbox;
  assert.equal(std.failIfUnavailable, false);
});

test('allowedDomains suma anthropic, política, registros por stack y loopback', () => {
  const p = basePolicy({ network: { allowedDomains: ['api.interna.mx'], registries: ['nexus.empresa.mx'], prodHosts: [] } });
  const d = allowedDomains(p);
  assert.ok(d.includes('api.anthropic.com'));
  assert.ok(d.includes('api.interna.mx') && d.includes('nexus.empresa.mx'));
  for (const r of REGISTRIES_BY_STACK.spring) assert.ok(d.includes(r), `falta ${r}`);
  assert.ok(d.includes('registry.npmjs.org'));
  for (const l of ['localhost', '127.0.0.1', '[::1]']) assert.ok(d.includes(l));
  const sandboxDomains = settingsOf(compile(p, { os: 'darwin' })).sandbox.network.allowedDomains;
  assert.deepEqual(sandboxDomains, d);
});

test('cada app registrada recibe su copia de .claude (settings + lanzadores)', () => {
  const artifacts = compile(basePolicy(), { os: 'darwin' }).map((a) => a.path.split(/[\\/]/).join('/'));
  for (const app of ['backend', 'frontend']) {
    assert.ok(artifacts.includes(`${app}/.claude/settings.json`), `falta settings de ${app}`);
    assert.ok(artifacts.includes(`${app}/.claude/hooks/run`));
    assert.ok(artifacts.includes(`${app}/.claude/hooks/run.ps1`));
  }
  assert.ok(artifacts.includes('.githooks/pre-commit') && artifacts.includes('.githooks/pre-push') && artifacts.includes('.githooks/post-checkout') && artifacts.includes('.githooks/run.mjs'));
  const settingsRaiz = compile(basePolicy(), { os: 'darwin' }).find((a) => a.path === '.claude/settings.json').content;
  const settingsApp = compile(basePolicy(), { os: 'darwin' }).find((a) => a.path.split(/[\\/]/).join('/') === 'backend/.claude/settings.json').content;
  assert.equal(settingsRaiz, settingsApp, 'las settings de app deben ser idénticas (solo rutas relativas)');
});

test('los hooks git son un único wrapper POSIX (git no ejecuta .cmd)', () => {
  const artifacts = compile(basePolicy(), { os: 'win32' });
  for (const h of ['pre-commit', 'pre-push', 'post-checkout']) {
    const a = artifacts.find((x) => x.path.split(/[\\/]/).join('/') === `.githooks/${h}`);
    assert.ok(a, `falta .githooks/${h}`);
    assert.equal(a.mode, '0755');
    assert.match(a.content, /^#!\/bin\/sh/);
    assert.match(a.content, /run\.mjs/);
  }
  assert.ok(!artifacts.some((a) => /\.cmd$/.test(a.path)), 'no debe generarse ningún .cmd de hook git');
});

test('compileSettings es determinista (mismo JSON en dos llamadas)', () => {
  const p = basePolicy();
  assert.deepEqual(compileSettings(p, 'darwin'), compileSettings(p, 'darwin'));
});
