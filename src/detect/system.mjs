// Entorno de la máquina: Claude Code instalado, cuenta (org/personal) y runtime de contenedores.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { run } from '../lib/exec.mjs';
import { readJsonSafe } from './manifests.mjs';

/** Busca un binario en PATH sin depender de `which` (portable, PATH inyectable para pruebas). */
export function findInPath(bin, { env = process.env } = {}) {
  const PATH = env.PATH ?? env.Path ?? '';
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  for (const dir of PATH.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      try { if (statSync(p).isFile()) return p; } catch { /* siguiente */ }
    }
  }
  return null;
}

const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/** Binario `claude*` empaquetado dentro de la app de escritorio (hasta 4 niveles). */
function bundledCli(dir, depth = 4) {
  if (depth < 0 || !existsSync(dir)) return undefined;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isFile() && /^claude(\.exe)?$/.test(e.name)) return p;
    if (e.isDirectory()) { const hit = bundledCli(p, depth - 1); if (hit) return hit; }
  }
  return undefined;
}

function desktopApp(env) {
  if (process.platform === 'darwin' && existsSync('/Applications/Claude.app')) return '/Applications/Claude.app';
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    const p = join(env.LOCALAPPDATA, 'Programs', 'Claude');
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** @returns {{cli?:string, desktopApp?:string, bundledCli?:string, version?:string, configDir:string, configDirExists:boolean}} */
export function detectClaudeInstall({ env = process.env, home = homedir() } = {}) {
  const cli = findInPath('claude', { env });
  let version;
  if (cli) {
    const r = run(cli, ['--version'], { env, timeout: 8000 });
    if (r.status === 0) version = /\d+\.\d+\.\d+/.exec(r.stdout)?.[0];
  }
  const app = desktopApp(env);
  const configDir = join(home, '.claude');
  return prune({
    cli: cli ?? undefined,
    desktopApp: app,
    bundledCli: app && !cli ? bundledCli(join(app, 'Contents', 'Resources')) : undefined,
    version,
    configDir,
    configDirExists: existsSync(configDir),
  });
}

/** Enmascara un correo: primera letra + *** + dominio. Nunca se imprime completo. */
export function maskEmail(email) {
  const at = String(email).indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

const PUBLIC_MAIL = /@(gmail|hotmail|outlook|live|yahoo|icloud|proton(mail)?|me)\./i;

/**
 * Cuenta de Claude según ~/.claude.json (oauthAccount). El email se devuelve enmascarado.
 * @returns {{type:'org'|'personal'|'unknown', email?:string, org?:string}}
 */
export function detectAccount({ home = homedir() } = {}) {
  const cfg = readJsonSafe(join(home, '.claude.json'));
  const acct = cfg?.oauthAccount;
  if (!acct || typeof acct !== 'object') return { type: 'unknown' };
  const org = typeof acct.organizationName === 'string' ? acct.organizationName.trim() : '';
  const rawEmail = typeof acct.emailAddress === 'string' ? acct.emailAddress : '';
  const personal = !org || /'s\s+organization$/i.test(org) || /^personal$/i.test(org) || (!acct.organizationUuid && PUBLIC_MAIL.test(rawEmail));
  return prune({ type: personal ? 'personal' : 'org', email: rawEmail ? maskEmail(rawEmail) : undefined, org: org || undefined });
}

/** @returns {{kind:'docker'|'podman'|null, compose:string[], bin?:string}} */
export function detectContainerRuntime({ env = process.env } = {}) {
  const probe = (bin, args) => run(bin, args, { env, timeout: 8000 }).status === 0;
  const docker = findInPath('docker', { env });
  if (docker) {
    const compose = probe(docker, ['compose', 'version']) ? ['docker', 'compose'] : (findInPath('docker-compose', { env }) ? ['docker-compose'] : []);
    return { kind: 'docker', compose, bin: docker };
  }
  const podman = findInPath('podman', { env });
  if (podman) {
    const compose = probe(podman, ['compose', 'version']) ? ['podman', 'compose'] : (findInPath('podman-compose', { env }) ? ['podman-compose'] : []);
    return { kind: 'podman', compose, bin: podman };
  }
  return { kind: null, compose: [] };
}
