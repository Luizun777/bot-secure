// `bot-secure doctor [--smoke] [--onboarding] [--json]`: tabla OK/AVISO/ERROR con el arreglo
// exacto de cada fila. Es la fuente de verdad de `status`, `start` y `claude`: todos importan
// `collect()` de aquí para no duplicar comprobaciones.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BotSecureError, EXIT } from '../lib/errors.mjs';
import { color } from '../lib/log.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { detectAccount, detectClaudeInstall, detectContainerRuntime, findInPath } from '../detect/index.mjs';
import { ENV_FILES } from '../policy/sensitive.mjs';
import { CLAUDE_CODE_MIN, isGuardArtifact, loadPolicy, readLock, validatePolicy, verifyIntegrity, writeLocal } from '../policy/index.mjs';
import { currentBranch, protectedBranchRe, verify as verifyRepo } from '../git/index.mjs';

const NODE_MIN = 20;
/** Presupuesto de tiempo del smoke por stack (ms). Los que compilan una JVM/SDK tardan más. */
const SMOKE_MS = {
  spring: 900_000, java: 900_000, kotlin: 900_000, android: 900_000, dotnet: 600_000, ios: 900_000, flutter: 600_000,
};
const SMOKE_MS_DEFAULT = 300_000;

/** Fila del diagnóstico. */
const row = (id, state, message, fix = null) => ({ id, state, message, fix });

/** Compara "2.1.246" con "2.1.300". -1 | 0 | 1 */
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Estado global a partir de las filas: error > warn > ok. `drift` es un error con salida 3. */
export function globalState(rows) {
  if (rows.some((r) => r.state === 'error' && r.id === 'integrity')) return 'drift';
  if (rows.some((r) => r.state === 'error')) return 'error';
  if (rows.some((r) => r.state === 'warn')) return 'warn';
  return 'ok';
}

/** Código de salida del contrato: 0 ok/aviso · 2 error · 3 drift. */
export function exitFor(state) {
  if (state === 'drift') return EXIT.DRIFT;
  if (state === 'error') return EXIT.ERROR;
  return EXIT.OK;
}

/** Pares NOMBRE=valor de un archivo tipo .env (sin expandir nada). */
export function parseEnvFile(path) {
  const out = [];
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.push({ name, value });
  }
  return out;
}

/** ¿El valor es un placeholder/fake del ambiente de IA (y por tanto inofensivo)? */
function looksFake(value) {
  if (!value) return true;
  if (value.startsWith('__AI_PLACEHOLDER__')) return true;
  if (/^(true|false|\d+)$/i.test(value)) return true;
  if (/(localhost|127\.0\.0\.1|\[::1\]|\.local\b|@ai\.local|example|EXAMPLE|AIPLACEHOLDER|dummy|fake|changeme|xxx+)/.test(value)) return true;
  return false;
}

/** Variables de .env.ai de la raíz y de cada app (para el launcher y el smoke). */
export function envAiVars(root, apps = []) {
  const vars = {};
  const files = [join(root, '.env.ai'), ...apps.map((a) => join(root, ...String(a.path ?? '.').split('/').filter((s) => s && s !== '.'), '.env.ai'))];
  for (const f of files) for (const { name, value } of parseEnvFile(f)) vars[name] = value;
  return vars;
}

/**
 * Texto legible de un error: los BotSecureError llevan la clave i18n en `message`, así que
 * imprimirlo tal cual mostraba "db.noRuntime" al usuario.
 */
export function errText(ctx, e) {
  if (e && typeof e.key === 'string') return ctx.t(e.key, e.vars ?? {});
  return e?.message ?? String(e);
}

/** Workspace + política, o BotSecureError con el arreglo exacto. */
export function requireWorkspace(ctx) {
  const root = findWorkspaceRoot(ctx.cwd);
  if (!root) throw new BotSecureError('cli-core.noWorkspace', { fix: 'bot-secure start', exitCode: EXIT.ERROR });
  let policy;
  try { policy = loadPolicy(root); } catch { throw new BotSecureError('cli-core.noPolicy', { fix: 'bot-secure init', exitCode: EXIT.ERROR }); }
  return { root, policy };
}

/* --------------------------------- comprobaciones ------------------------------------------ */

function checkNode(t) {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  if (major < NODE_MIN) return row('node', 'error', t('cli-core.nodeOld', { version }), 'https://nodejs.org');
  return row('node', 'ok', t('cli-core.nodeOk', { version, path: process.execPath }));
}

function checkClaude(t, install) {
  const min = CLAUDE_CODE_MIN;
  if (!install.cli && !install.desktopApp) {
    return [row('claude', 'error', t('cli-core.claudeMissing'), 'https://claude.com/code')];
  }
  const rows = [];
  if (!install.cli) {
    rows.push(row('claude', 'warn', t('cli-core.claudeDesktopOnly', { path: install.desktopApp }), 'npm i -g @anthropic-ai/claude-code'));
  } else if (!install.version) {
    rows.push(row('claude', 'warn', t('cli-core.claudeCliNoVersion', { path: install.cli }), `${install.cli} --version`));
  } else if (cmpVersion(install.version, min) < 0) {
    rows.push(row('claude', 'error', t('cli-core.claudeOld', { version: install.version, min }), 'npm i -g @anthropic-ai/claude-code@latest'));
  } else {
    rows.push(row('claude', 'ok', t('cli-core.claudeCli', { version: install.version, path: install.cli })));
  }
  if (!install.configDirExists) rows.push(row('claude-config', 'warn', t('cli-core.claudeConfigMissing', { dir: install.configDir }), 'claude'));
  return rows;
}

function checkAccount(t, account, policy) {
  const email = account.email ?? '***';
  if (account.type === 'org') return row('account', 'ok', t('cli-core.accountOrg', { org: account.org ?? '?', email }));
  const requireOrg = !!policy?.requireOrgAccount;
  if (account.type === 'personal') {
    return requireOrg
      ? row('account', 'error', t('cli-core.accountPersonalBlocked', { email }), 'claude /logout')
      : row('account', 'warn', t('cli-core.accountPersonal', { email }), 'https://claude.ai/settings/data-privacy-controls');
  }
  return row('account', requireOrg ? 'error' : 'warn', t('cli-core.accountUnknown'), 'claude /login');
}

function checkPolicy(t, root, policy) {
  const errors = validatePolicy(policy);
  if (errors.length) {
    const detail = errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ');
    return row('policy', 'error', t('cli-core.policyInvalid', { detail }), 'bot-secure policy validate');
  }
  return row('policy', 'ok', t('cli-core.policyOk', { profile: policy.profile, apps: (policy.apps ?? []).length }));
}

function checkIntegrity(t, root) {
  // `lock` (nunca se ejecutó init) es un error normal; `integrity` (drift real) sale con 3.
  if (!readLock(root)) return row('lock', 'error', t('cli-core.integrityNoLock'), 'bot-secure init');
  // Solo las guardas: los .md generados son editables a mano (writeGenerated deja .new).
  const { ok, drift } = verifyIntegrity(root, { only: isGuardArtifact });
  if (ok) return row('integrity', 'ok', t('cli-core.integrityOk'));
  const paths = drift.slice(0, 3).map((d) => d.path).join(', ');
  return row('integrity', 'error', t('cli-core.integrityDrift', { count: drift.length, paths }), 'bot-secure init --force');
}

/** Ramas, refspec y hooksPath de cada app + `.env` con valores reales dentro del workspace. */
function checkApps(t, root, policy) {
  const rows = [];
  const apps = policy.apps ?? [];
  const prot = protectedBranchRe(policy);
  for (const app of apps) {
    const dir = join(root, ...String(app.path ?? '.').split('/').filter((s) => s && s !== '.'));
    if (!existsSync(dir)) {
      rows.push(row(`app:${app.name}`, 'error', t('cli-core.appMissing', { app: app.name, path: app.path }), 'bot-secure workspace clone'));
      continue;
    }
    const branch = currentBranch(dir);
    if (branch && prot.test(branch)) {
      rows.push(row(`app:${app.name}`, 'error', t('cli-core.appProtected', { app: app.name, branch }), `git -C "${dir}" switch ${policy.branches?.ai ?? 'ai-dev'}`));
      continue;
    }
    const { ok, problems } = verifyRepo(dir, policy);
    if (ok) rows.push(row(`app:${app.name}`, 'ok', t('cli-core.appOk', { app: app.name, branch: branch ?? '?' })));
    else {
      const p = problems[0];
      rows.push(row(`app:${app.name}`, 'error', t('cli-core.appProblems', { app: app.name, detail: problems.map((x) => x.code).join(', ') }), p.fix));
    }
  }
  rows.push(...checkEnvFiles(t, root, apps));
  return rows;
}

/** Un `.env` con valores reales dentro del clon de IA es un ERROR del contrato. */
function checkEnvFiles(t, root, apps) {
  const dirs = [{ name: 'workspace', dir: root }, ...apps.map((a) => ({ name: a.name, dir: join(root, ...String(a.path ?? '.').split('/').filter((s) => s && s !== '.')) }))];
  const rows = [];
  for (const { name, dir } of dirs) {
    for (const file of ENV_FILES) {
      const p = join(dir, file);
      if (!existsSync(p)) continue;
      const real = parseEnvFile(p).some((v) => !looksFake(v.value));
      if (real) rows.push(row(`env:${name}:${file}`, 'error', t('cli-core.envReal', { app: name, file }), `rm "${p}"`));
    }
  }
  if (!rows.length) rows.push(row('env', 'ok', t('cli-core.envClean')));
  return rows;
}

/** Sonda del aislamiento del sistema operativo. */
export function sandboxProbe({ env = process.env } = {}) {
  if (process.platform === 'darwin') return { bin: 'sandbox-exec', path: findInPath('sandbox-exec', { env }) ?? (existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : null) };
  if (process.platform === 'linux') return { bin: 'bwrap', path: findInPath('bwrap', { env }) };
  return { bin: 'win32', path: null };
}

function checkSandbox(t) {
  const probe = sandboxProbe();
  if (process.platform === 'win32') return row('sandbox', 'warn', t('cli-core.sandboxWindows'), 'wsl --install');
  if (probe.path) return row('sandbox', 'ok', t('cli-core.sandboxOk', { probe: probe.bin }));
  const fix = process.platform === 'linux' ? 'sudo apt install bubblewrap' : 'xcode-select --install';
  return row('sandbox', 'warn', t('cli-core.sandboxMissing', { probe: probe.bin }), fix);
}

async function checkDb(t, root, policy) {
  const engine = policy.db?.engine;
  if (!engine) return row('db', 'warn', t('cli-core.dbNone'), 'bot-secure db init');
  const runtime = detectContainerRuntime();
  const port = policy.db?.port ?? '';
  if (!runtime.kind) return row('db', 'warn', t('cli-core.dbNoRuntime'), 'https://podman.io');
  try {
    const { status } = await import('../db/index.mjs');
    const st = await status(root, policy, { noRows: true });
    if (st.running) return row('db', 'ok', t('cli-core.dbOk', { engine, port: st.port ?? port }));
    return row('db', 'warn', t('cli-core.dbDown', { engine, port: st.port ?? port }), 'bot-secure up');
  } catch {
    return row('db', 'warn', t('cli-core.dbDown', { engine, port }), 'bot-secure up');
  }
}

function checkWindowsShell(t) {
  if (process.platform !== 'win32') return null;
  const sh = findInPath('sh') ?? ['C:/Program Files/Git/bin/sh.exe', 'C:/Program Files (x86)/Git/bin/sh.exe'].find((p) => existsSync(p));
  return sh
    ? row('shell', 'ok', t('cli-core.shellOk', { path: sh }))
    : row('shell', 'error', t('cli-core.shellMissing'), 'winget install Git.Git');
}

function checkJava(t, policy) {
  const usesFirebase = (policy.apps ?? []).some((a) => (a.sdks ?? []).some((s) => /firebase/i.test(s)));
  if (!usesFirebase) return null;
  const java = findInPath('java');
  return java
    ? row('java', 'ok', t('cli-core.javaOk', { path: java }))
    : row('java', 'warn', t('cli-core.javaMissing'), 'brew install openjdk');
}

/* ------------------------------------- smoke ----------------------------------------------- */

/** Ejecuta una línea de comando del proyecto con el shell del sistema (sin heredar el entorno). */
function runCommandLine(cmd, { cwd, env, timeout }) {
  const argv = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd]]
    : ['sh', ['-c', cmd]];
  return spawnSync(argv[0], argv[1], { cwd, env, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

/** ¿Hay algo escuchando en 127.0.0.1:port? */
function portOpen(port, timeout = 1000) {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

async function waitPort(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * `--smoke`: en `runtime: tests` corre el testCmd de cada app con AI_ENV=1 y las variables de
 * .env.ai; en `runtime: app` arranca runCmd y espera al puerto.
 * @returns {Promise<object[]>} filas
 */
export async function smoke(ctx, { root, policy }) {
  const { t } = ctx;
  const apps = policy.apps ?? [];
  if (!apps.length) return [row('smoke', 'warn', t('cli-core.smokeSkip'), 'bot-secure workspace add <repo> --kind backend')];
  const mode = policy.runtime === 'app' ? 'app' : 'tests';
  const base = { ...process.env, ...envAiVars(root, apps), AI_ENV: '1' };
  const rows = [];
  for (const app of apps) {
    const dir = join(root, ...String(app.path ?? '.').split('/').filter((s) => s && s !== '.'));
    const budget = SMOKE_MS[app.stack] ?? SMOKE_MS_DEFAULT;
    const cmd = mode === 'tests' ? app.testCmd : app.runCmd;
    if (!cmd) {
      rows.push(row(`smoke:${app.name}`, 'warn', t('cli-core.smokeNoCmd', { app: app.name, kind: mode }), 'bot-secure init'));
      continue;
    }
    if (mode === 'tests') {
      const t0 = Date.now();
      const r = runCommandLine(cmd, { cwd: dir, env: base, timeout: budget });
      const seconds = Math.round((Date.now() - t0) / 1000);
      if (r.error && /ETIMEDOUT/i.test(String(r.error.code ?? r.error.message))) {
        rows.push(row(`smoke:${app.name}`, 'error', t('cli-core.smokeTimeout', { app: app.name, cmd, seconds: Math.round(budget / 1000) }), `cd "${dir}" && ${cmd}`));
      } else if (r.status === 0) {
        rows.push(row(`smoke:${app.name}`, 'ok', t('cli-core.smokeOk', { app: app.name, cmd, seconds })));
      } else {
        rows.push(row(`smoke:${app.name}`, 'error', t('cli-core.smokeFail', { app: app.name, cmd, code: r.status ?? '?' }), `cd "${dir}" && ${cmd}`));
      }
      continue;
    }
    if (!app.port) {
      rows.push(row(`smoke:${app.name}`, 'warn', t('cli-core.smokeNoCmd', { app: app.name, kind: 'puerto' }), 'bot-secure init'));
      continue;
    }
    const seconds = Math.round(budget / 1000);
    const proc = spawn(
      process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh',
      process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd],
      { cwd: dir, env: base, stdio: 'ignore', detached: process.platform !== 'win32' },
    );
    const ok = await waitPort(app.port, Math.min(budget, 120_000));
    try { process.platform === 'win32' ? proc.kill() : process.kill(-proc.pid, 'SIGTERM'); } catch { /* ya terminó */ }
    rows.push(ok
      ? row(`smoke:${app.name}`, 'ok', t('cli-core.smokePortOk', { app: app.name, port: app.port }))
      : row(`smoke:${app.name}`, 'error', t('cli-core.smokePortFail', { app: app.name, port: app.port, seconds }), `cd "${dir}" && ${cmd}`));
  }
  return rows;
}

/* ------------------------------------ recolección ------------------------------------------ */

/**
 * Ejecuta todas las comprobaciones. No lanza: si no hay workspace devuelve la fila `workspace`.
 * @param {object} ctx contexto del CLI
 * @param {{smoke?:boolean, root?:string, policy?:object, writeLocal?:boolean}} [opts]
 * @returns {Promise<{rows:object[], root:string|null, policy:object|null, install:object, account:object}>}
 */
export async function collect(ctx, opts = {}) {
  const { t } = ctx;
  const rows = [];
  const install = detectClaudeInstall();
  const account = detectAccount({ home: homedir() });
  const root = opts.root ?? findWorkspaceRoot(ctx.cwd);
  let policy = opts.policy ?? null;
  if (root && !policy) { try { policy = loadPolicy(root); } catch { policy = null; } }

  rows.push(checkNode(t));
  rows.push(...checkClaude(t, install));
  rows.push(checkAccount(t, account, policy));

  if (!root) {
    rows.push(row('workspace', 'error', t('cli-core.workspaceMissing'), 'bot-secure start'));
    rows.push(checkSandbox(t));
    const win = checkWindowsShell(t);
    if (win) rows.push(win);
    return { rows, root: null, policy: null, install, account };
  }
  rows.push(row('workspace', 'ok', t('cli-core.workspaceOk', { root })));
  if (!policy) {
    rows.push(row('policy', 'error', t('cli-core.noPolicy'), 'bot-secure init'));
    return { rows, root, policy: null, install, account };
  }
  rows.push(checkPolicy(t, root, policy));
  rows.push(checkIntegrity(t, root));
  rows.push(...checkApps(t, root, policy));
  rows.push(checkSandbox(t));
  rows.push(await checkDb(t, root, policy));
  const win = checkWindowsShell(t);
  if (win) rows.push(win);
  const java = checkJava(t, policy);
  if (java) rows.push(java);
  if (opts.smoke) rows.push(...await smoke(ctx, { root, policy }));

  if (opts.writeLocal !== false) {
    // local.json es una comodidad para los hooks (ruta de node): nunca debe tumbar el diagnóstico.
    try {
      writeLocal(root, {
        node: process.execPath, os: process.platform, shell: process.env.SHELL ?? process.env.ComSpec ?? '',
        sandboxProbe: sandboxProbe().path !== null, claudeVersion: install.version ?? null, account,
      });
    } catch { /* workspace de solo lectura */ }
  }
  return { rows, root, policy, install, account };
}

/* ------------------------------------- impresión ------------------------------------------- */

const PAINT = { ok: color.ok, warn: color.warn, error: color.err };

/** Imprime la tabla de filas con su `Arreglo:`. */
export function renderRows(ctx, rows) {
  const { log, t } = ctx;
  const label = { ok: t('cli-core.stateOk'), warn: t('cli-core.stateWarn'), error: t('cli-core.stateError') };
  const width = Math.max(...rows.map((r) => label[r.state].length));
  for (const r of rows) {
    log.info(`  ${PAINT[r.state](label[r.state].padEnd(width))}  ${r.message}`);
    if (r.fix && r.state !== 'ok') log.info(`  ${' '.repeat(width)}  ${color.dim(t('cli-core.fixLine', { fix: r.fix }))}`);
  }
}

/** Resumen final (una línea) según el estado global. */
export function renderSummary(ctx, rows) {
  const { log, t } = ctx;
  const count = (s) => rows.filter((r) => r.state === s).length;
  const state = globalState(rows);
  if (state === 'ok') log.ok(t('cli-core.doctorSummaryOk', { ok: count('ok') }));
  else if (state === 'warn') log.info(t('cli-core.doctorSummaryWarn', { warn: count('warn') }));
  else log.info(t('cli-core.doctorSummaryError', { error: count('error'), warn: count('warn') }));
  return state;
}

function onboarding(ctx) {
  const { log, t } = ctx;
  const os = process.platform;
  log.info(t('cli-core.onboardingTitle', { os }));
  const steps = [
    t('cli-core.onboardingNode'), t('cli-core.onboardingGit'),
    t('cli-core.onboardingClaude', { min: CLAUDE_CODE_MIN }), t('cli-core.onboardingDocker'),
  ];
  if (os === 'darwin') steps.push(t('cli-core.onboardingDarwin'));
  else if (os === 'linux') steps.push(t('cli-core.onboardingLinux'));
  else if (os === 'win32') steps.push(t('cli-core.onboardingWin32'));
  for (const s of steps) log.info(`  - ${s}`);
  log.info('\n' + t('cli-core.onboardingNext'));
  log.data({ command: 'doctor --onboarding', os, steps });
  return EXIT.OK;
}

export default {
  name: 'doctor',
  aliases: [],
  advanced: false,
  hidden: false,
  summary: {
    es: 'Diagnóstico completo: qué está mal y el comando exacto para arreglarlo',
    en: 'Full diagnosis: what is wrong and the exact command to fix it',
  },
  usage: {
    es: 'bot-secure doctor [--smoke] [--onboarding] [--json]',
    en: 'bot-secure doctor [--smoke] [--onboarding] [--json]',
  },
  async run(ctx) {
    if (ctx.flags.onboarding) return onboarding(ctx);
    const { rows, root, policy } = await collect(ctx, { smoke: !!ctx.flags.smoke });
    ctx.log.info(ctx.t('cli-core.doctorTitle') + '\n');
    renderRows(ctx, rows);
    ctx.log.info('');
    const state = renderSummary(ctx, rows);
    if (!ctx.flags.smoke && state !== 'error' && state !== 'drift') ctx.log.info(ctx.t('cli-core.doctorNextSmoke'));
    ctx.log.data({ command: 'doctor', root, project: policy?.project ?? null, state, exitCode: exitFor(state), rows });
    return exitFor(state);
  },
};
