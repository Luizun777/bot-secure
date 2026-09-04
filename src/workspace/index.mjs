// Workspace de IA: <proyecto>-ai/ con las apps dentro (clones single-branch ai-dev o subcarpetas).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { git } from '../lib/exec.mjs';
import { BotSecureError } from '../lib/errors.mjs';
import { readJson, writeJson, writeText } from '../lib/fsx.mjs';
import { POLICY_FILE } from '../lib/paths.mjs';
import { makeT } from '../lib/i18n.mjs';
import { describeApp, STACK_LABEL } from '../detect/index.mjs';
import { ensureAiDevBranch, cloneAi, currentBranch, isDirty, behindCount, protectedBranchRe, aiBranch } from '../git/index.mjs';

const WS_GITIGNORE = [
  '# bot-secure: workspace de IA',
  '.bot-secure/local.json', '.bot-secure/reports/', '.bot-secure/ai-keys/',
  '.claude/state/', '.claude/settings.local.json', 'CLAUDE.local.md',
  '.env', '.env.local', '.env.*.local', 'mocks/db/data/',
  '# apps clonadas (multi-repo): las registra `bot-secure workspace add`',
];

/** Policy mínima si src/policy aún no existe (mismo esquema que CONTRACTS.md). */
function fallbackPolicy(project) {
  return {
    version: 1, project, profile: 'sensitive', level: 1, mode: 'clone', runtime: 'tests',
    autoSwitch: false, requireOrgAccount: false, lang: 'es',
    guard: { mode: 'block', strictRead: false, docsReminder: false, promptBlockSeverity: 'HIGH' },
    branches: { ai: 'ai-dev', taskPrefix: 'ai/', protected: ['dev', 'qa', 'prd', 'prod', 'main', 'master', 'release/*'] },
    apps: [],
    db: { engine: 'postgres', port: 5433, database: 'app_ai', user: 'app', generic: false, rows: 1000, seed: 42 },
    network: { allowedDomains: [], registries: [], prodHosts: [] }, mcp: { allowed: [] },
    owners: { repoOwner: '', infosec: '', platform: '' },
    scan: { exclude: [], failOn: 'HIGH', maxFileSizeMB: 1 },
  };
}

async function minimalPolicy(project) {
  try {
    const mod = await import('../policy/index.mjs');
    if (typeof mod.defaultPolicy === 'function') return mod.defaultPolicy({ project, apps: [], db: null });
  } catch { /* módulo policy aún no disponible: fallback */ }
  return fallbackPolicy(project);
}

const policyPath = (root) => join(root, ...POLICY_FILE.split('/'));
export function loadPolicyFile(root) {
  const p = policyPath(root);
  if (!existsSync(p)) throw new BotSecureError('workspace.noPolicy', { vars: { root }, fix: `bot-secure workspace create ${basename(root).replace(/-ai$/, '') || 'mi-proyecto'}` });
  const policy = readJson(p);
  policy.apps = Array.isArray(policy.apps) ? policy.apps : [];
  return policy;
}
export function savePolicyFile(root, policy) { writeJson(policyPath(root), policy); }

/**
 * Crea `<name>-ai/` (git init, .gitignore, policy mínima). Devuelve la ruta absoluta.
 * @returns {Promise<string>}
 */
export async function createWorkspace(name, { cwd = process.cwd(), project } = {}) {
  const clean = String(name).replace(/[\\/]+$/, '');
  if (!clean || /[\\/]/.test(clean)) throw new BotSecureError('workspace.badName', { vars: { name }, fix: 'bot-secure workspace create mi-proyecto' });
  const dirName = /-ai$/.test(clean) ? clean : `${clean}-ai`;
  const root = resolve(cwd, dirName);
  if (existsSync(root) && readdirSync(root).length) throw new BotSecureError('workspace.exists', { vars: { root }, fix: `cd "${root}" && bot-secure workspace status` });
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, '.git'))) {
    let r = git(['init', '-b', 'main'], { cwd: root });
    if (r.status !== 0) r = git(['init'], { cwd: root });
    if (r.status !== 0) throw new BotSecureError('workspace.gitInitFailed', { vars: { detail: r.stderr.trim().split('\n')[0] }, fix: `git -C "${root}" init` });
  }
  writeJson(policyPath(root), await minimalPolicy(project ?? dirName.replace(/-ai$/, '')));
  writeText(join(root, '.gitignore'), WS_GITIGNORE.join('\n') + '\n');
  return root;
}

const toPosix = (p) => p.split(sep).join('/');
const repoName = (src) => String(src).replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/, '') || 'app';
const safeName = (n) => String(n).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

/** Si `source` es una carpeta existente dentro de root → {dir, rel}; si no, null. */
function localSubfolder(root, source) {
  const dir = resolve(root, source);
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) return null;
  if (!existsSync(dir)) return null;
  return { dir, rel: toPosix(rel) };
}

function originUrl(dir) {
  const r = git(['config', '--get', 'remote.origin.url'], { cwd: dir });
  return r.status === 0 ? r.stdout.trim() || null : null;
}

function addGitignoreEntry(root, entry) {
  const p = join(root, '.gitignore');
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (cur.split(/\r?\n/).includes(entry)) return;
  appendFileSync(p, (cur.endsWith('\n') || !cur ? '' : '\n') + entry + '\n');
}

/**
 * Registra una app: clona single-branch `ai-dev` desde un remoto/ruta (creando la rama si falta)
 * o registra una subcarpeta ya existente. Actualiza policy.apps y .gitignore.
 * @returns {import('../detect/apps.mjs').App & {remote?:string, branch:string, dependsOn:string[]}}
 */
export function addApp(root, source, { kind, name, branch, from, push = false } = {}) {
  const policy = loadPolicyFile(root);
  const ai = branch ?? aiBranch(policy);
  const local = localSubfolder(root, source);
  const kindFree = kind && !policy.apps.some((a) => a.name === kind);
  const appName = safeName(name ?? (local ? basename(local.dir) : (kindFree ? kind : repoName(source))));
  if (policy.apps.some((a) => a.name === appName)) {
    throw new BotSecureError('workspace.appExists', { vars: { name: appName }, fix: `bot-secure workspace add ${source} --kind ${kind ?? 'backend'} --name <otro-nombre>` });
  }
  let dir, remote = null, cloned = false;
  if (local) {
    dir = local.dir; remote = originUrl(dir);
  } else {
    dir = join(root, appName);
    if (existsSync(dir)) throw new BotSecureError('workspace.destExists', { vars: { dest: dir }, fix: `bot-secure workspace add ${appName} --kind ${kind ?? 'backend'}` });
    ensureAiDevBranch(source, { from, branch: ai, push, cwd: root });
    cloneAi(source, dir, { branch: ai });
    remote = source; cloned = true;
  }
  const app = describeApp(dir, { name: appName, path: toPosix(relative(root, dir)) || '.', kind });
  if (remote) app.remote = remote;
  app.branch = ai;
  app.dependsOn = app.kind === 'frontend' ? policy.apps.filter((a) => a.kind === 'backend').map((a) => a.name) : [];
  policy.apps.push(app);
  savePolicyFile(root, policy);
  if (cloned) addGitignoreEntry(root, `${app.path}/`);
  return app;
}

/**
 * Reproduce en otra máquina las apps clonadas (policy.apps con `remote`).
 * @returns {{app:string, action:'cloned'|'exists'|'no-remote'}[]}
 */
export function cloneWorkspace(root) {
  const policy = loadPolicyFile(root);
  const out = [];
  for (const app of policy.apps) {
    const dir = join(root, ...app.path.split('/'));
    if (existsSync(dir) && readdirSync(dir).length) { out.push({ app: app.name, action: 'exists' }); continue; }
    if (!app.remote) { out.push({ app: app.name, action: 'no-remote' }); continue; }
    cloneAi(app.remote, dir, { branch: app.branch ?? aiBranch(policy) });
    out.push({ app: app.name, action: 'cloned' });
  }
  return out;
}

/**
 * Estado por app. `fetch:true` actualiza origin/<ai> antes de medir el atraso.
 * @returns {{app:string, path:string, branch:string|null, dirty:boolean, behind:number|null, ok:boolean, missing:boolean}[]}
 */
export function status(root, { fetch = false } = {}) {
  const policy = loadPolicyFile(root);
  const prot = protectedBranchRe(policy);
  return policy.apps.map((app) => {
    const dir = join(root, ...app.path.split('/'));
    const want = app.branch ?? aiBranch(policy);
    if (!existsSync(dir) || git(['rev-parse', '--show-toplevel'], { cwd: dir }).status !== 0) {
      return { app: app.name, path: app.path, branch: null, dirty: false, behind: null, ok: false, missing: true };
    }
    if (fetch) git(['fetch', '--quiet', 'origin', want], { cwd: dir });
    const branch = currentBranch(dir);
    const dirty = isDirty(dir);
    const behind = behindCount(dir, `origin/${want}`);
    const ok = branch === want && !prot.test(branch ?? '');
    return { app: app.name, path: app.path, branch, dirty, behind, ok, missing: false };
  });
}

/** Bloque markdown con el mapa de apps para CLAUDE.md/AGENTS.md. */
export function appMap(policy, { lang = policy?.lang ?? 'es' } = {}) {
  const t = makeT(lang);
  const apps = policy?.apps ?? [];
  if (!apps.length) return t('workspace.mapEmpty');
  const backends = apps.filter((a) => a.kind === 'backend' && a.port);
  return apps.map((a) => {
    const label = STACK_LABEL[a.stack] ?? a.stack;
    const parts = [`- ${a.name} → ./${a.path} (${label}${a.port ? `, :${a.port}` : ''})`];
    if (a.runCmd) parts.push(`${t('workspace.mapRun')}: ${a.runCmd}`);
    if (a.testCmd) parts.push(`${t('workspace.mapTests')}: ${a.testCmd}`);
    const deps = (a.dependsOn ?? []).map((d) => apps.find((x) => x.name === d)).filter((x) => x?.port);
    const consumes = deps.length ? deps : (a.kind !== 'backend' && a.kind !== 'lib' ? backends : []);
    if (consumes.length) parts.push(`${t('workspace.mapConsumes')} ${consumes.map((b) => `http://localhost:${b.port}`).join(', ')}`);
    return parts.join(' · ');
  }).join('\n');
}
