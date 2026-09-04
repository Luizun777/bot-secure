// Catálogo de rutas sensibles compartido por compile (globs de settings.json / sandbox) y el guard (realpath).
import { homedir } from 'node:os';
import { relative, isAbsolute, sep } from 'node:path';

/** Nombres exactos de archivos de entorno que se niegan (lista explícita: .env.ai y .env.example se permiten). */
export const ENV_FILES = [
  '.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local',
  '.env.staging', '.env.staging.local', '.env.test', '.env.test.local', '.env.dev', '.env.prod', '.env.qa', '.env.prd',
  '.env.backup', '.env.bak', '.env.secret', '.env.secrets', '.env.private', '.env.old', '.env.orig',
];
export const ENV_ALLOWED = ['.env.ai', '.env.example', '.env.ai.example', '.env.sample', '.env.template'];

/** Extensiones de certificados, llaves y almacenes. */
export const KEY_EXTS = ['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'ppk', 'gpg', 'asc', 'kdbx', 'p8', 'der'];
/** Volcados / respaldos. */
export const DUMP_EXTS = ['dump', 'bak', 'har', 'sql.gz', 'sql.zip', 'dmp', 'rdb'];
/** Ofimática (solo dentro de carpetas de datos). */
export const OFFICE_EXTS = ['xlsx', 'xls', 'xlsm', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'ods', 'odt', 'odp', 'csv'];
export const DATA_DIRS = ['data', 'datos', 'dumps', 'backups', 'backup', 'respaldos', 'exports', 'uploads', 'reports', 'reportes', 'fixtures-reales'];

/** Rutas del workspace que nunca se leen / escriben desde Claude (relativas a la raíz o de cada app). */
export const WS_DENY_READ = [
  '.bot-secure/reports/**', '.bot-secure/local.json', '.bot-secure/ai-keys/**', '.bot-secure/audit.log',
  '.git/**', '.mcp.json', '.claude/settings.local.json', '.claude/state/**', '.vscode/launch.json', '.idea/**',
];
export const WS_DENY_WRITE = ['.claude/**', '.githooks/**', '.bot-secure/**', '.env.ai'];

/** Rutas de HOME que nunca se leen (sintaxis ~/ de Claude Code). */
export const HOME_DENY = [
  '~/.claude/**', '~/.claude.json', '~/.config/claude/**', '~/.aws/**', '~/.ssh/**', '~/.npmrc', '~/.netrc', '~/.git-credentials',
  '~/.kube/**', '~/.docker/**', '~/.gnupg/**', '~/.config/gh/**', '~/.zshrc', '~/.bashrc', '~/.bash_profile', '~/.profile',
  '~/.zprofile', '~/.zshenv', '~/.bash_history', '~/.zsh_history', '~/.pgpass', '~/.my.cnf', '~/.azure/**', '~/.config/gcloud/**',
];
const HOME_DENY_RE = [
  /^\.claude(\/|$)/, /^\.claude\.json$/, /^\.config\/claude(\/|$)/, /^\.aws(\/|$)/, /^\.ssh(\/|$)/, /^\.npmrc$/, /^\.netrc$/, /^\.git-credentials$/,
  /^\.kube(\/|$)/, /^\.docker(\/|$)/, /^\.gnupg(\/|$)/, /^\.config\/gh(\/|$)/, /^\.(zshrc|bashrc|bash_profile|profile|zprofile|zshenv|bash_history|zsh_history|pgpass|my\.cnf)$/,
  /^\.azure(\/|$)/, /^\.config\/gcloud(\/|$)/, /^\.bot-secure\/keys(\/|$)/,
];

const toPosix = (p) => p.split(sep).join('/');

/**
 * ¿Es sensible una ruta ABSOLUTA ya canonicalizada? Se decide por nombre; independiente de existencia.
 * @param {string} abs ruta absoluta (realpath o resolve)
 * @param {{ws?:string, home?:string}} [opts]
 * @returns {{sensitive:boolean, reason?:string}}
 */
export function classifyPath(abs, { ws, home = homedir() } = {}) {
  const posix = toPosix(abs);
  const base = posix.slice(posix.lastIndexOf('/') + 1);
  const lower = base.toLowerCase();
  // Archivos de entorno: lista explícita + comodín .env.* salvo permitidos.
  if (ENV_ALLOWED.includes(lower)) return { sensitive: false };
  if (ENV_FILES.includes(lower) || /^\.env\.[^/]+$/.test(lower) || /^\.env$/.test(lower)) return { sensitive: true, reason: 'env-file' };
  if (KEY_EXTS.some((e) => lower.endsWith('.' + e))) return { sensitive: true, reason: 'key-material' };
  if (DUMP_EXTS.some((e) => lower.endsWith('.' + e))) return { sensitive: true, reason: 'dump' };
  if (/\.tfstate(\.|$)/.test(lower)) return { sensitive: true, reason: 'tfstate' };
  if (/(^|\/)\.terraform(\/|$)/.test(posix)) return { sensitive: true, reason: 'tfstate' };
  if (/(^|\/)(backups?|dumps|respaldos)(\/|$)/i.test(posix)) return { sensitive: true, reason: 'dump-dir' };
  if (/\/(\.git)(\/|$)/.test(posix) || /^\.git(\/|$)/.test(posix)) return { sensitive: true, reason: 'git-internals' };
  if (/(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/.test(posix) && !posix.endsWith('.pub')) return { sensitive: true, reason: 'key-material' };
  if (/(^|\/)(credentials|credentials\.json|service-account[^/]*\.json|secrets?\.ya?ml|secrets?\.json)$/i.test(posix)) return { sensitive: true, reason: 'credentials-file' };
  if (/(^|\/)docker\.sock$/.test(posix)) return { sensitive: true, reason: 'docker-sock' };
  if (/^\/proc\/[^/]+\/environ$/.test(posix)) return { sensitive: true, reason: 'env-dump' };
  if (/^\/etc\/(shadow|passwd|sudoers|ssh\/)/.test(posix)) return { sensitive: true, reason: 'system-credentials' };
  const dataDir = DATA_DIRS.some((d) => new RegExp(`(^|/)${d}(/|$)`, 'i').test(posix));
  if (dataDir && OFFICE_EXTS.some((e) => lower.endsWith('.' + e))) return { sensitive: true, reason: 'office-in-data' };
  // HOME
  if (home) {
    const rel = toPosix(relative(home, abs));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      if (HOME_DENY_RE.some((re) => re.test(rel))) return { sensitive: true, reason: 'home-credentials' };
    }
  }
  // Rutas internas del workspace (raíz o cualquier app: se comprueba por segmento)
  if (ws) {
    const rel = toPosix(relative(ws, abs));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      if (/(^|\/)\.bot-secure\/(reports|ai-keys|local\.json|audit\.log|INCIDENT-)/.test(rel)) return { sensitive: true, reason: 'bot-secure-internal' };
      if (/(^|\/)\.claude\/(state|settings\.local\.json)/.test(rel)) return { sensitive: true, reason: 'claude-state' };
      if (/(^|\/)\.mcp\.json$/.test(rel) || /(^|\/)\.vscode\/launch\.json$/.test(rel) || /(^|\/)\.idea(\/|$)/.test(rel)) return { sensitive: true, reason: 'ide-config' };
    }
  }
  return { sensitive: false };
}

/** ¿La ruta absoluta cae en un directorio protegido de escritura (guardas)? */
export function isGuardPath(abs, ws) {
  const rel = toPosix(relative(ws, abs));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return /(^|\/)\.git\/hooks(\/|$)/.test(toPosix(abs));
  return /(^|\/)(\.claude|\.githooks|\.bot-secure)(\/|$)/.test(rel) || /(^|\/)\.git\/(hooks|config)(\/|$)/.test(rel) || /(^|\/)\.env\.ai$/.test(rel);
}

/** ¿abs está dentro de root (o es root)? Ambas absolutas. */
export function isInside(abs, root) {
  const rel = relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Globs de deny para settings.json (Read/Grep/Glob) relativos al proyecto. */
export function readDenyGlobs() {
  const globs = [];
  for (const f of ENV_FILES) globs.push(`./${f}`, `./**/${f}`);
  for (const e of KEY_EXTS) globs.push(`./**/*.${e}`);
  for (const e of DUMP_EXTS) globs.push(`./**/*.${e}`);
  globs.push('./**/*.tfstate', './**/*.tfstate.*', './**/.terraform/**', './**/backups/**', './**/backup/**', './**/dumps/**', './**/respaldos/**');
  for (const d of DATA_DIRS) for (const e of OFFICE_EXTS) globs.push(`./**/${d}/**/*.${e}`);
  globs.push('./**/id_rsa', './**/id_ed25519', './**/id_ecdsa', './**/credentials', './**/credentials.json', './**/service-account*.json', './**/secrets.yml', './**/secrets.yaml', './**/secrets.json');
  for (const w of WS_DENY_READ) globs.push(`./${w}`, `./**/${w}`);
  return [...new Set(globs)];
}

/** Patrones denyRead del sandbox nativo (rutas relativas + ~/). */
export function sandboxDenyRead() {
  const out = ['~/'];
  for (const f of ENV_FILES) out.push(f, `**/${f}`);
  for (const e of KEY_EXTS) out.push(`**/*.${e}`);
  for (const e of DUMP_EXTS) out.push(`**/*.${e}`);
  out.push('**/*.tfstate', '**/*.tfstate.*', '.bot-secure/reports', '.bot-secure/local.json', '.bot-secure/ai-keys', '.bot-secure/audit.log', '.claude/state', '.claude/settings.local.json', '.mcp.json');
  return [...new Set(out)];
}
