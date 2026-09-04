// Compila policy.json → artefactos: .claude/settings.json (raíz y por app), .claude/hooks/run(.ps1), .githooks/*.
// Sin rutas absolutas en ningún artefacto (portabilidad + lock.json estable entre máquinas).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_DENY, WS_DENY_WRITE, readDenyGlobs, sandboxDenyRead } from './sensitive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL = join(HERE, '..', '..', 'templates');
const tpl = (...p) => readFileSync(join(TPL, ...p), 'utf8');
const tplJson = (...p) => JSON.parse(tpl(...p));

/** @typedef {{path:string, content:string, mode?:'0755'}} Artifact */

export const HOOK_EVENTS = ['session-start', 'prompt', 'pre-tool', 'post-tool', 'stop', 'session-end', 'config-change', 'statusline'];

/** Registros públicos por stack (se suman a policy.network.registries). */
export const REGISTRIES_BY_STACK = {
  node: ['registry.npmjs.org'], nest: ['registry.npmjs.org'], express: ['registry.npmjs.org'], next: ['registry.npmjs.org'], nuxt: ['registry.npmjs.org'],
  vite: ['registry.npmjs.org'], angular: ['registry.npmjs.org'], cra: ['registry.npmjs.org'], vue: ['registry.npmjs.org'], svelte: ['registry.npmjs.org'],
  expo: ['registry.npmjs.org'], 'react-native': ['registry.npmjs.org'],
  spring: ['repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org'], java: ['repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org'],
  kotlin: ['repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org'],
  android: ['repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org', 'dl.google.com', 'maven.google.com'],
  django: ['pypi.org', 'files.pythonhosted.org'], fastapi: ['pypi.org', 'files.pythonhosted.org'], flask: ['pypi.org', 'files.pythonhosted.org'], python: ['pypi.org', 'files.pythonhosted.org'],
  dotnet: ['api.nuget.org'], laravel: ['repo.packagist.org', 'packagist.org'], symfony: ['repo.packagist.org', 'packagist.org'], php: ['repo.packagist.org', 'packagist.org'],
  go: ['proxy.golang.org', 'sum.golang.org'], rails: ['rubygems.org', 'index.rubygems.org'], ruby: ['rubygems.org', 'index.rubygems.org'],
  flutter: ['pub.dev', 'storage.googleapis.com'], ios: ['cdn.cocoapods.org'],
};
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** Dominios permitidos para el sandbox y el guard: api.anthropic.com + política + registros por stack + loopback. */
export function allowedDomains(policy) {
  const set = new Set(['api.anthropic.com']);
  for (const d of policy.network?.allowedDomains ?? []) set.add(d);
  for (const d of policy.network?.registries ?? []) set.add(d);
  for (const app of policy.apps ?? []) for (const d of REGISTRIES_BY_STACK[app.stack] ?? []) set.add(d);
  for (const d of LOOPBACK) set.add(d);
  return [...set];
}

function hookCommand(os, event) {
  return os === 'win32'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File ./.claude/hooks/run.ps1 ${event}`
    : `sh ./.claude/hooks/run ${event}`;
}

function hookEntry(os, event, extra = {}) {
  const h = { type: 'command', command: hookCommand(os, event), ...extra };
  if (os === 'win32') h.shell = 'powershell';
  return h;
}

function denyRules(policy) {
  const deny = [];
  const readGlobs = readDenyGlobs();
  for (const g of readGlobs) deny.push(`Read(${g})`);
  for (const h of HOME_DENY) deny.push(`Read(${h})`);
  for (const g of readGlobs) deny.push(`Grep(${g})`);
  for (const h of HOME_DENY) deny.push(`Grep(${h})`);
  for (const g of readGlobs) deny.push(`Glob(${g})`);
  for (const h of HOME_DENY) deny.push(`Glob(${h})`);
  for (const w of WS_DENY_WRITE) deny.push(`Edit(./${w})`, `Edit(./**/${w})`, `Write(./${w})`, `Write(./**/${w})`);
  const netBins = ['curl', 'curl.exe', 'wget', 'wget.exe', 'nc', 'ncat', 'netcat', 'socat', 'rsync', 'ftp', 'sftp', 'telnet', 'dig', 'nslookup', 'host', 'ping', 'ssh', 'scp', 'Invoke-WebRequest', 'Invoke-RestMethod', 'iwr', 'irm'];
  for (const b of netBins) deny.push(`Bash(${b})`, `Bash(${b} *)`);
  deny.push('Bash(env)', 'Bash(env | *)', 'Bash(printenv)', 'Bash(printenv | *)', 'Bash(set)', 'Bash(set | *)', 'Bash(export)', 'Bash(export -p)', 'Bash(export -p *)', 'Bash(declare -x)', 'Bash(declare -x | *)', 'Bash(declare -p)');
  deny.push('Bash(git worktree *)', 'Bash(git remote add *)', 'Bash(git remote set-url *)', 'Bash(git commit --no-verify*)', 'Bash(git commit * --no-verify*)', 'Bash(git push --no-verify*)', 'Bash(git push * --no-verify*)', 'Bash(* --no-verify*)');
  deny.push('Bash(npm publish*)', 'Bash(dangerouslyDisableSandbox:true)');
  deny.push('WebFetch', 'WebSearch');
  if (!(policy.mcp?.allowed ?? []).length) deny.push('mcp__*');
  if (policy.mode === 'worktree') {
    deny.push('Bash(git log -p*)', 'Bash(git log --patch*)', 'Bash(git log -S*)', 'Bash(git log -G*)', 'Bash(git show*)', 'Bash(git stash*)', 'Bash(git cat-file*)',
      'Bash(git -C *)', 'Bash(git rev-list*)', 'Bash(git bundle*)', 'Bash(git archive*)', 'Bash(git format-patch*)', 'Bash(git reflog*)', 'Bash(git fetch*)',
      'Bash(git pull*)', 'Bash(git grep*)', 'Bash(git blame*)', 'Bash(git ls-tree*)', 'Bash(git read-tree*)', 'Bash(git bisect*)', 'Bash(git cherry-pick*)');
  }
  return deny;
}

function askRules(policy, os) {
  const ask = ['Bash(git push*)', 'Bash(git checkout*)', 'Bash(git switch*)', 'Bash(npm run *)'];
  if (os === 'win32') ask.push(...(tplJson('claude', 'settings.win32.json').permissions?.ask ?? []));
  return ask;
}

function allowRules(policy) {
  const ai = policy.branches?.taskPrefix ?? 'ai/';
  return [
    'Read(./.env.ai)', 'Read(./**/.env.ai)', 'Read(./.env.example)', 'Read(./**/.env.example)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git add *)', 'Bash(git commit -m *)', 'Bash(git log --oneline*)', 'Bash(git branch*)',
    `Bash(git switch -c ${ai}*)`, 'Bash(env AI_ENV=1 *)', 'Bash(env *=* *)', 'Bash(npm test*)',
    ...(policy.mcp?.allowed ?? []).map((s) => (s.startsWith('mcp__') ? s : `mcp__${s}`)),
  ];
}

function hooks(policy, os) {
  const pre = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'mcp__.*'];
  if (policy.guard?.strictRead) pre.push('Read', 'Grep', 'Glob');
  return {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hookEntry(os, 'session-start', { timeout: 20 })] }],
    UserPromptSubmit: [{ hooks: [hookEntry(os, 'prompt', { timeout: 10 })] }],
    PreToolUse: [{ matcher: pre.join('|'), hooks: [hookEntry(os, 'pre-tool', { timeout: 10 })] }],
    PostToolUse: [{ matcher: 'Edit|Write|Bash', hooks: [hookEntry(os, 'post-tool', { timeout: 5 })] }],
    Stop: [{ hooks: [hookEntry(os, 'stop', { timeout: 10 })] }],
    SessionEnd: [{ hooks: [hookEntry(os, 'session-end', { timeout: 60 })] }],
    ConfigChange: [{ hooks: [hookEntry(os, 'config-change', { timeout: 5 })] }],
  };
}

function sandbox(policy, os) {
  if (os === 'win32' || (policy.level ?? 1) < 1) return {};
  const base = tplJson('claude', policy.profile === 'sensitive' ? 'settings.sandbox.sensitive.json' : 'settings.sandbox.standard.json');
  base.sandbox.filesystem.denyRead = sandboxDenyRead();
  base.sandbox.network.allowedDomains = allowedDomains(policy);
  return base;
}

/** settings.json compilado (idéntico para raíz y apps: solo rutas relativas). */
export function compileSettings(policy, os) {
  const base = tplJson('claude', 'settings.base.json');
  return {
    permissions: { deny: denyRules(policy), ask: askRules(policy, os), allow: allowRules(policy) },
    hooks: hooks(policy, os),
    statusLine: { type: 'command', command: hookCommand(os, 'statusline') },
    ...sandbox(policy, os),
    ...base,
  };
}

/**
 * @param {object} policy política validada
 * @param {{os?:'darwin'|'linux'|'win32', root?:string}} [opts] root solo se usa para decidir si una app es repo propio (.git)
 * @returns {Artifact[]}
 */
export function compile(policy, { os = process.platform, root = null } = {}) {
  const settings = JSON.stringify(compileSettings(policy, os), null, 2) + '\n';
  const runSh = tpl('hooks', 'run');
  const runPs = tpl('hooks', 'run.ps1');
  const gitHook = tpl('hooks', 'git-hook');
  const gitRun = tpl('hooks', 'run.mjs');
  /** @type {Artifact[]} */
  const out = [];
  const claudeDir = (base) => {
    out.push({ path: join(base, '.claude', 'settings.json'), content: settings });
    out.push({ path: join(base, '.claude', 'hooks', 'run'), content: runSh, mode: '0755' });
    out.push({ path: join(base, '.claude', 'hooks', 'run.ps1'), content: runPs });
  };
  const gitHooks = (base) => {
    for (const h of ['pre-commit', 'pre-push', 'post-checkout']) out.push({ path: join(base, '.githooks', h), content: gitHook, mode: '0755' });
    out.push({ path: join(base, '.githooks', 'run.mjs'), content: gitRun });
  };
  claudeDir('');
  gitHooks('');
  for (const app of policy.apps ?? []) {
    const base = app.path.split('/').join(process.platform === 'win32' ? '\\' : '/');
    claudeDir(base);
    const ownRepo = !!app.remote || (root && existsSync(join(root, base, '.git')));
    if (ownRepo) gitHooks(base);
  }
  return out;
}
