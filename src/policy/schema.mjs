// Validación de policy.json: devuelve errores con la ruta del campo (p. ej. "apps[0].path").
// Sin dependencias: comprobaciones explícitas, no JSON Schema.

export const PROFILES = ['sensitive', 'standard'];
export const MODES = ['clone', 'mirror', 'worktree'];
export const RUNTIMES = ['tests', 'app'];
export const GUARD_MODES = ['block', 'warn'];
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const APP_KINDS = ['backend', 'frontend', 'mobile', 'lib', 'unknown'];
export const DB_ENGINES = ['postgres', 'mysql', 'mongo', 'redis', 'mssql', 'oracle', 'sqlite'];

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const BRANCH_RE = /^[A-Za-z0-9._\-/*]+$/;
const DOMAIN_RE = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;

/**
 * @param {object} policy
 * @returns {{path:string, message:string}[]} lista vacía si es válida
 */
export function validatePolicy(policy) {
  /** @type {{path:string, message:string}[]} */
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObj(policy)) return [{ path: '', message: 'policy debe ser un objeto' }];

  if (policy.version !== 1) err('version', 'debe ser 1');
  if (!isStr(policy.project)) err('project', 'debe ser texto');
  if (!PROFILES.includes(policy.profile)) err('profile', `debe ser uno de: ${PROFILES.join('|')}`);
  if (!isInt(policy.level) || policy.level < 0 || policy.level > 3) err('level', 'debe ser entero 0..3');
  if (!MODES.includes(policy.mode)) err('mode', `debe ser uno de: ${MODES.join('|')}`);
  if (!RUNTIMES.includes(policy.runtime)) err('runtime', `debe ser uno de: ${RUNTIMES.join('|')}`);
  if (!isBool(policy.autoSwitch)) err('autoSwitch', 'debe ser booleano');
  if (!isBool(policy.requireOrgAccount)) err('requireOrgAccount', 'debe ser booleano');
  if (!['es', 'en'].includes(policy.lang)) err('lang', 'debe ser es|en');

  validateGuard(policy.guard, err);
  validateBranches(policy.branches, err);
  validateApps(policy.apps, err);
  validateDb(policy.db, err);
  validateNetwork(policy.network, err);
  if (!isObj(policy.mcp)) err('mcp', 'debe ser objeto');
  else if (!isStrArr(policy.mcp.allowed)) err('mcp.allowed', 'debe ser lista de textos');
  if (!isObj(policy.owners)) err('owners', 'debe ser objeto');
  else for (const k of ['repoOwner', 'infosec', 'platform']) if (!isStr(policy.owners[k])) err(`owners.${k}`, 'debe ser texto');
  validateScan(policy.scan, err);
  return errors;
}

function validateGuard(g, err) {
  if (!isObj(g)) return err('guard', 'debe ser objeto');
  if (!GUARD_MODES.includes(g.mode)) err('guard.mode', 'debe ser block|warn');
  if (!isBool(g.strictRead)) err('guard.strictRead', 'debe ser booleano');
  if (!isBool(g.docsReminder)) err('guard.docsReminder', 'debe ser booleano');
  if (!SEVERITIES.includes(g.promptBlockSeverity)) err('guard.promptBlockSeverity', `debe ser uno de: ${SEVERITIES.join('|')}`);
}

function validateBranches(b, err) {
  if (!isObj(b)) return err('branches', 'debe ser objeto');
  if (!isStr(b.ai) || !BRANCH_RE.test(b.ai)) err('branches.ai', 'nombre de rama inválido');
  if (!isStr(b.taskPrefix) || !/^[A-Za-z0-9._-]+\/$/.test(b.taskPrefix)) err('branches.taskPrefix', 'debe terminar en "/" (p. ej. "ai/")');
  if (!isStrArr(b.protected) || b.protected.length === 0) err('branches.protected', 'debe ser lista no vacía');
  else b.protected.forEach((p, i) => { if (!BRANCH_RE.test(p)) err(`branches.protected[${i}]`, 'patrón de rama inválido'); });
  if (isStr(b.ai) && Array.isArray(b.protected) && b.protected.includes(b.ai)) err('branches.ai', 'la rama de IA no puede estar protegida');
}

function validateApps(apps, err) {
  if (!Array.isArray(apps)) return err('apps', 'debe ser lista');
  const names = new Set();
  apps.forEach((a, i) => {
    const p = `apps[${i}]`;
    if (!isObj(a)) return err(p, 'debe ser objeto');
    if (!isStr(a.name) || !/^[A-Za-z0-9._-]+$/.test(a.name)) err(`${p}.name`, 'nombre inválido (letras, números, . _ -)');
    else if (names.has(a.name)) err(`${p}.name`, 'nombre duplicado'); else names.add(a.name);
    if (!isStr(a.path) || a.path === '' || a.path.startsWith('/') || /^[A-Za-z]:/.test(a.path) || a.path.split(/[\\/]/).includes('..')) err(`${p}.path`, 'debe ser ruta relativa dentro del workspace');
    if (!APP_KINDS.includes(a.kind)) err(`${p}.kind`, `debe ser uno de: ${APP_KINDS.join('|')}`);
    if (!isStr(a.stack)) err(`${p}.stack`, 'debe ser texto');
    if (a.port !== undefined && (!isInt(a.port) || a.port < 1 || a.port > 65535)) err(`${p}.port`, 'puerto inválido');
    if (a.dependsOn !== undefined && !isStrArr(a.dependsOn)) err(`${p}.dependsOn`, 'debe ser lista de textos');
    if (a.remote !== undefined && !isStr(a.remote)) err(`${p}.remote`, 'debe ser texto');
    if (a.branch !== undefined && (!isStr(a.branch) || !BRANCH_RE.test(a.branch))) err(`${p}.branch`, 'rama inválida');
  });
}

function validateDb(db, err) {
  if (!isObj(db)) return err('db', 'debe ser objeto');
  if (!DB_ENGINES.includes(db.engine)) err('db.engine', `debe ser uno de: ${DB_ENGINES.join('|')}`);
  if (!isInt(db.port) || db.port < 1 || db.port > 65535) err('db.port', 'puerto inválido');
  for (const k of ['database', 'user']) if (!isStr(db[k]) || db[k] === '') err(`db.${k}`, 'debe ser texto no vacío');
  if (!isBool(db.generic)) err('db.generic', 'debe ser booleano');
  if (!isInt(db.rows) || db.rows < 0) err('db.rows', 'debe ser entero ≥ 0');
  if (!isInt(db.seed)) err('db.seed', 'debe ser entero');
}

function validateNetwork(n, err) {
  if (!isObj(n)) return err('network', 'debe ser objeto');
  for (const k of ['allowedDomains', 'registries', 'prodHosts']) {
    if (!isStrArr(n[k])) { err(`network.${k}`, 'debe ser lista de textos'); continue; }
    n[k].forEach((d, i) => { if (!DOMAIN_RE.test(d)) err(`network.${k}[${i}]`, `dominio inválido: ${d}`); });
  }
}

function validateScan(s, err) {
  if (!isObj(s)) return err('scan', 'debe ser objeto');
  if (!isStrArr(s.exclude)) err('scan.exclude', 'debe ser lista de textos');
  if (!SEVERITIES.includes(s.failOn)) err('scan.failOn', `debe ser uno de: ${SEVERITIES.join('|')}`);
  if (typeof s.maxFileSizeMB !== 'number' || s.maxFileSizeMB <= 0) err('scan.maxFileSizeMB', 'debe ser número > 0');
}

/** Convierte un patrón de rama (con "*") a RegExp anclado. */
export function branchPatternToRegExp(pattern) {
  return new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

/** RegExp que reconoce ramas protegidas según la política. */
export function protectedBranchRe(policy) {
  const pats = policy?.branches?.protected ?? ['dev', 'qa', 'prd', 'prod', 'main', 'master', 'release/*'];
  const parts = pats.map((p) => p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
  return new RegExp(`^(${parts.join('|')})$`);
}
