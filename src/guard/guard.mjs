// Guarda de Claude Code: se ejecuta desde los hooks (.claude/hooks/run → node guard.mjs <evento>)
// con el JSON del hook por stdin. Fail-closed: cualquier excepción bloquea (exit 2) salvo guard.mode='warn'.
// Nunca escribe el VALOR de un secreto en stdout, stderr, audit.log ni en el parte de incidente.
import { realpathSync, appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import MENSAJES_ES from '../i18n/es/guard.json' with { type: 'json' };
import MENSAJES_EN from '../i18n/en/guard.json' with { type: 'json' };
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { git } from '../lib/exec.mjs';
import { findWorkspaceRoot } from '../lib/paths.mjs';
import { allowedDomains } from '../policy/compile.mjs';
import { isGuardArtifact, readLock, verifyIntegrity } from '../policy/lock.mjs';
import { readLocal } from '../policy/local.mjs';
import { protectedBranchRe } from '../policy/schema.mjs';
import { classifyPath, isGuardPath, isInside } from '../policy/sensitive.mjs';
import { analyze, isLiteralIp, resolvePath } from './bash-parser.mjs';

// Importación estática: esbuild la empaqueta dentro de dist/guard.mjs (el guard
// se despliega como un solo archivo y no puede resolver rutas relativas en destino).
const MESSAGES = { es: MENSAJES_ES, en: MENSAJES_EN };

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const rank = (s) => { const i = SEVERITIES.indexOf(s); return i < 0 ? SEVERITIES.length : i; };
const atLeast = (sev, min) => rank(sev) <= rank(min);
const toPosix = (p) => String(p).split(sep).join('/');

/** Marcadores de supresión que nunca se pueden escribir desde la IA. */
const ALLOW_MARKER_RE = /gitleaks:allow|bot-secure:\s*allow|allowlist[- ]secret|nosecrets?|trufflehog:ignore|detect-secrets:\s*allow/i;
/** Subcomandos de git que exponen historia (se deniegan en modo worktree). */
const GIT_HISTORY = /^(show|stash|cat-file|rev-list|bundle|archive|format-patch|reflog|blame|ls-tree|read-tree|bisect|cherry-pick|grep|fast-export)$/;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function makeT(lang) {
  const primary = MESSAGES[lang] ?? MESSAGES.es;
  return (key, vars = {}) => {
    const k = key.startsWith('guard.') ? key.slice(6) : key;
    const raw = primary[k] ?? MESSAGES.es[k] ?? key;
    return String(raw).replace(/\{(\w+)\}/g, (_, n) => (n in vars ? String(vars[n]) : `{${n}}`));
  };
}

function parseInput(stdinJson) {
  if (!stdinJson) return {};
  try { return JSON.parse(stdinJson) || {}; } catch { return { _raw: String(stdinJson) }; }
}

/** Contexto compartido por todos los eventos. */
function buildCtx(input, event) {
  const cwd = input.cwd || process.cwd();
  const root = findWorkspaceRoot(cwd);
  if (!root) {
    const t = makeT('es');
    const e = new Error(t('noWorkspace', { cwd }));
    e.noWorkspace = true;
    throw e;
  }
  const policy = JSON.parse(readFileSync(join(root, '.bot-secure', 'policy.json'), 'utf8'));
  const lang = policy.lang === 'en' ? 'en' : 'es';
  return {
    event, input, cwd, root, policy, lang, t: makeT(lang),
    home: homedir(),
    stateDir: join(root, '.claude', 'state'),
    warnMode: policy.guard?.mode === 'warn',
    sensitive: policy.profile === 'sensitive',
    ai: policy.branches?.ai ?? 'ai-dev',
    prefix: policy.branches?.taskPrefix ?? 'ai/',
    protectedRe: protectedBranchRe(policy),
  };
}

const stateFile = (ctx, name) => join(ctx.stateDir, name);
function readState(ctx, name, fallback = null) {
  try { return JSON.parse(readFileSync(stateFile(ctx, name), 'utf8')); } catch { return fallback; }
}
function writeState(ctx, name, obj) {
  try { mkdirSync(ctx.stateDir, { recursive: true }); writeFileSync(stateFile(ctx, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); } catch { /* estado best-effort */ }
}
/** Marca la sesión como contaminada (hubo un intento contra un recurso sensible). */
function markContaminated(ctx, reason) {
  writeState(ctx, 'contaminated', JSON.stringify({ at: new Date().toISOString(), reason, session: ctx.input.session_id ?? null }));
}
const isContaminated = (ctx) => existsSync(stateFile(ctx, 'contaminated'));

/** audit.log: una línea JSON por decisión. NUNCA valores de secretos. */
function audit(ctx, entry) {
  try {
    const p = join(ctx.root, '.bot-secure', 'audit.log');
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({
      ts: new Date().toISOString(), event: ctx.event, session: ctx.input.session_id ?? null,
      agent: ctx.input.agent_id ?? null, tool: ctx.input.tool_name ?? null, ...entry,
    }) + '\n');
  } catch { /* el audit nunca rompe la guarda */ }
}

// ---------------------------------------------------------------------------
// Motor de detección (import dinámico; stub si engine-core aún no publicó index.mjs)
// ---------------------------------------------------------------------------

let scanImpl;
const STUB_RULES = [
  { ruleId: 'stub-aws-akid', re: /\bAKIA[0-9A-Z]{16}\b/g, severity: 'CRITICAL' },
  { ruleId: 'stub-stripe-live', re: /\bsk_live_[0-9a-zA-Z]{10,}\b/g, severity: 'CRITICAL' },
  { ruleId: 'stub-private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, severity: 'CRITICAL' },
];
/** Stub local mientras `src/engine/index.mjs` no existe (ver openIssues). */
function stubScanText(text) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  for (const r of STUB_RULES) {
    for (let i = 0; i < lines.length; i++) {
      r.re.lastIndex = 0;
      if (r.re.test(lines[i])) out.push({ id: `${r.ruleId}:${i + 1}`, ruleId: r.ruleId, category: 'secret', severity: r.severity, line: i + 1, masked: '…', source: 'native' });
    }
  }
  return out;
}
async function getScan() {
  if (scanImpl) return scanImpl;
  try {
    const m = await import('../engine/index.mjs');
    if (typeof m.scanText === 'function') { scanImpl = m.scanText; return scanImpl; }
  } catch { /* engine aún no disponible */ }
  scanImpl = stubScanText;
  return scanImpl;
}
/** Escanea texto; nunca lanza (fallo → stub). Devuelve Finding[]. */
async function scanText(ctx, text, path = 'prompt') {
  if (!text) return [];
  const fn = await getScan();
  try {
    const r = await fn(String(text), { path, mode: 'guard', maxMs: 1500 });
    return Array.isArray(r) ? r : [];
  } catch { return stubScanText(text); }
}
const worst = (findings) => findings.reduce((acc, f) => (rank(f.severity) < rank(acc) ? f.severity : acc), 'INFO');
const ruleList = (findings) => [...new Set(findings.map((f) => f.ruleId))].slice(0, 5).join(', ');

// ---------------------------------------------------------------------------
// Integridad (con caché por mtime+size)
// ---------------------------------------------------------------------------

function integritySignature(root, lock) {
  const parts = [];
  for (const g of lock.generated ?? []) {
    if (!isGuardArtifact(g.path)) continue;
    const p = join(root, ...g.path.split('/'));
    try { const st = statSync(p); parts.push(`${g.path}:${st.mtimeMs}:${st.size}`); } catch { parts.push(`${g.path}:missing`); }
  }
  const gp = join(root, '.claude', 'hooks', 'guard.mjs');
  try { const st = statSync(gp); parts.push(`guard:${st.mtimeMs}:${st.size}`); } catch { parts.push('guard:missing'); }
  return parts.join('|');
}

/** Verifica las guardas contra lock.json reutilizando caché si no cambió mtime/size. */
function checkIntegrity(ctx) {
  const lock = readLock(ctx.root);
  if (!lock) return { ok: false, drift: [{ path: '.bot-secure/lock.json', expected: 'lock', actual: 'missing' }] };
  const sig = integritySignature(ctx.root, lock);
  const cached = readState(ctx, 'integrity.json');
  if (cached && cached.sig === sig) return cached.result;
  const result = verifyIntegrity(ctx.root, { only: isGuardArtifact, allowMissingGuard: true });
  writeState(ctx, 'integrity.json', { sig, result, at: new Date().toISOString() });
  return result;
}

// ---------------------------------------------------------------------------
// Salidas
// ---------------------------------------------------------------------------

function deny(ctx, reason, { code = 'deny', path } = {}) {
  audit(ctx, { decision: 'deny', code, reason, path: path ? toPosix(path) : undefined });
  if (ctx.warnMode) {
    process.stderr.write(ctx.t('warnMode', { message: reason }) + '\n');
    return 0;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }) + '\n');
  return 0;
}
function block(ctx, message) {
  audit(ctx, { decision: 'block', reason: message });
  if (ctx.warnMode) { process.stderr.write(ctx.t('warnMode', { message }) + '\n'); return 0; }
  process.stderr.write(message + '\n');
  return 2;
}

// ---------------------------------------------------------------------------
// Ramas / apps
// ---------------------------------------------------------------------------

function appDirs(ctx) {
  const apps = (ctx.policy.apps ?? []).map((a) => ({ ...a, dir: join(ctx.root, ...String(a.path).split('/')) }));
  return apps.filter((a) => existsSync(a.dir));
}
function branchOf(dir) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  return r.status === 0 ? r.stdout.trim() : null;
}
const isClean = (dir) => { const r = git(['status', '--porcelain'], { cwd: dir }); return r.status === 0 && r.stdout.trim() === ''; };
const isWorktree = (dir) => { try { return statSync(join(dir, '.git')).isFile(); } catch { return false; } };
const hasBranch = (dir, b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: dir }).status === 0;

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/** SessionStart: NUNCA bloquea (exit 0). Deja los bloqueos en flags.json y los inyecta como contexto. */
async function onSessionStart(ctx) {
  const { t } = ctx;
  const flags = [];
  const notes = [];

  const integrity = checkIntegrity(ctx);
  if (!integrity.ok) flags.push({ code: 'drift', message: t('flag.drift', { count: integrity.drift.length, paths: integrity.drift.map((d) => d.path).slice(0, 4).join(', ') }) });

  if (ctx.policy.requireOrgAccount) {
    const acc = readLocal(ctx.root).account;
    if (acc && acc.type === 'personal') flags.push({ code: 'account', message: t('flag.account', { email: acc.email ?? '' }) });
  }

  const apps = appDirs(ctx);
  const known = new Set([ctx.root, ...apps.map((a) => a.dir)]);
  if (![...known].some((d) => resolve(d) === resolve(ctx.cwd))) flags.push({ code: 'cwd', message: t('flag.cwd', { cwd: ctx.cwd, root: ctx.root }) });

  for (const app of apps) {
    const br = branchOf(app.dir);
    if (!br) continue;
    if (!ctx.protectedRe.test(br)) continue;
    let switched = false;
    if (ctx.policy.autoSwitch && ctx.input.source === 'startup' && isClean(app.dir) && !isWorktree(app.dir) && hasBranch(app.dir, ctx.ai)) {
      switched = git(['switch', ctx.ai], { cwd: app.dir }).status === 0;
      if (switched) notes.push(t('ctx.autoSwitched', { app: app.name, ai: ctx.ai }));
    }
    if (!switched) flags.push({ code: 'branch', app: app.name, branch: br, message: t('flag.branch', { app: app.path, branch: br, ai: ctx.ai }) });
  }

  writeState(ctx, 'flags.json', { session: ctx.input.session_id ?? null, at: new Date().toISOString(), source: ctx.input.source ?? null, flags, notes });
  audit(ctx, { decision: 'info', code: 'session-start', flags: flags.map((f) => f.code) });

  const lines = [t('ctx.title', { project: ctx.policy.project || '(sin nombre)', profile: ctx.policy.profile, mode: ctx.policy.mode })];
  lines.push('', t('ctx.apps'));
  for (const a of ctx.policy.apps ?? []) {
    lines.push(t('ctx.app', { name: a.name, path: a.path, kind: a.kind, stack: a.stack, port: a.port ? `, :${a.port}` : '', branch: branchOf(join(ctx.root, ...String(a.path).split('/'))) ?? a.branch ?? ctx.ai }));
  }
  if (flags.length) { lines.push('', t('ctx.flags')); for (const f of flags) lines.push(`- ${f.message}`); }
  else lines.push('', t('ctx.ok', { ai: ctx.ai, prefix: ctx.prefix }));
  if (notes.length) { lines.push('', t('ctx.notes')); for (const n of notes) lines.push(`- ${n}`); }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  }) + '\n');
  return 0;
}

/** UserPromptSubmit: bloquea (exit 2) si hay flags activos o si el prompt trae secretos/PII. */
async function onPrompt(ctx) {
  const state = readState(ctx, 'flags.json', { flags: [] });
  const flags = state?.flags ?? [];
  if (flags.length) return block(ctx, ctx.t('blocked', { reasons: flags.map((f) => f.message).join(' | ') }));

  const prompt = ctx.input.prompt ?? ctx.input.user_prompt ?? '';
  const findings = await scanText(ctx, prompt, 'prompt');
  if (!findings.length) return 0;
  const min = ctx.policy.guard?.promptBlockSeverity ?? 'HIGH';
  const top = worst(findings);
  if (atLeast(top, min)) {
    markContaminated(ctx, 'prompt-secret');
    return block(ctx, ctx.t('prompt.secret', { count: findings.length, rules: ruleList(findings) }));
  }
  if (atLeast(top, 'MEDIUM')) process.stderr.write(ctx.t('prompt.warn', { count: findings.length, rules: ruleList(findings) }) + '\n');
  return 0;
}

/** PreToolUse: verifica integridad, flags y la herramienta concreta. Deny → JSON + exit 0. */
async function onPreTool(ctx) {
  const { t } = ctx;
  const tool = ctx.input.tool_name ?? '';
  const ti = ctx.input.tool_input ?? {};
  const allowedWhileBlocked = tool === 'Bash' && isRecoveryCommand(ctx, ti.command ?? '');

  const integrity = checkIntegrity(ctx);
  if (!integrity.ok && !allowedWhileBlocked) {
    markContaminated(ctx, 'integrity-drift');
    return deny(ctx, t('deny.drift', { paths: integrity.drift.map((d) => d.path).slice(0, 4).join(', ') }), { code: 'drift' });
  }
  const flags = readState(ctx, 'flags.json', { flags: [] })?.flags ?? [];
  if (flags.length && !allowedWhileBlocked) return deny(ctx, t('deny.flag', { reason: flags.map((f) => f.message).join(' | ') }), { code: 'flag' });

  if (tool === 'Bash' || tool === 'BashOutput') return checkBash(ctx, ti.command ?? '');
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return checkWrite(ctx, tool, ti);
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return checkRead(ctx, ti);
  if (tool.startsWith('mcp__')) return checkMcp(ctx, tool, ti);
  return 0;
}

/** ¿Comando permitido incluso con la sesión bloqueada (para poder salir del bloqueo)? */
function isRecoveryCommand(ctx, cmd) {
  const c = String(cmd).trim();
  if (!/^git\s/.test(c)) return false;
  if (/--no-verify|;|\||&&|`|\$\(/.test(c)) return false;
  return /^git\s+(-C\s+\S+\s+)?(status|branch)\b/.test(c) || new RegExp(`^git\\s+(-C\\s+\\S+\\s+)?switch\\s+(-c\\s+)?(${escapeRe(ctx.ai)}|${escapeRe(ctx.prefix)}\\S+)$`).test(c);
}
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bash: se analiza cada segmento (lecturas, escrituras, red, entorno, git). */
async function checkBash(ctx, cmd) {
  const { t } = ctx;
  const cwd = ctx.input.cwd || ctx.root;
  const res = analyze(cmd, { cwd, home: ctx.home });
  if (res.unanalyzable && ctx.sensitive) return deny(ctx, t('deny.unanalyzable', { what: res.unanalyzable }), { code: 'unanalyzable' });
  if (/--no-verify/.test(cmd)) return deny(ctx, t('deny.noVerify'), { code: 'no-verify' });
  if (/docker\.sock/.test(cmd)) { markContaminated(ctx, 'docker-sock'); return deny(ctx, t('deny.dockerSock'), { code: 'docker-sock' }); }
  if (/core\.hooksPath/.test(cmd)) return deny(ctx, t('deny.hooksPath'), { code: 'hooks-path' });

  const domains = new Set(allowedDomains(ctx.policy).map((d) => d.toLowerCase()));
  for (const s of res.segments) {
    if (s.envDump) return deny(ctx, t('deny.envDump', { bin: s.bin }), { code: 'env-dump' });

    if (s.network.binary) {
      if (s.network.resolveOverride) return deny(ctx, t('deny.networkResolve', { bin: s.network.binary }), { code: 'net-resolve' });
      if (s.network.unresolved || !s.network.hosts.length) return deny(ctx, t('deny.networkUnresolved', { bin: s.network.binary }), { code: 'net-unresolved' });
      for (const h of s.network.hosts) {
        if (isLiteralIp(h) && !domains.has(h)) return deny(ctx, t('deny.networkResolve', { bin: s.network.binary }), { code: 'net-ip' });
        if (!domains.has(h)) return deny(ctx, t('deny.network', { bin: s.network.binary, hosts: h, allowed: [...domains].join(', ') }), { code: 'net-host' });
      }
    }

    if (s.git) {
      const d = checkGit(ctx, s.git);
      if (d) return deny(ctx, d.reason, { code: d.code });
    }

    for (const p of s.reads) {
      const c = classifyPath(p, { ws: ctx.root, home: ctx.home });
      if (c.sensitive) { markContaminated(ctx, `bash-read:${c.reason}`); return deny(ctx, t('deny.sensitiveRead', { path: rel(ctx, p), reason: c.reason }), { code: 'read-sensitive', path: p }); }
      if (!isInside(p, ctx.root)) { markContaminated(ctx, 'bash-read-outside'); return deny(ctx, t('deny.outsideWs', { path: p, root: ctx.root }), { code: 'read-outside', path: p }); }
      if (/\.sql$/i.test(p) && isDumpLike(p)) return deny(ctx, t('deny.largeSql', { path: rel(ctx, p) }), { code: 'sql-dump', path: p });
    }
    for (const p of s.writes) {
      if (isGuardPath(p, ctx.root)) { markContaminated(ctx, 'bash-write-guard'); return deny(ctx, t('deny.guardWrite', { path: rel(ctx, p) }), { code: 'write-guard', path: p }); }
      const c = classifyPath(p, { ws: ctx.root, home: ctx.home });
      if (c.sensitive) return deny(ctx, t('deny.sensitivePath', { path: rel(ctx, p), reason: c.reason }), { code: 'write-sensitive', path: p });
      if (!isInside(p, ctx.root)) return deny(ctx, t('deny.outsideWs', { path: p, root: ctx.root }), { code: 'write-outside', path: p });
    }
  }
  audit(ctx, { decision: 'allow', code: 'bash' });
  return 0;
}

/** ¿Un .sql parece volcado (nombre o > 1 MB)? Las migraciones normales se permiten. */
function isDumpLike(p) {
  if (/(dump|backup|respaldo|export|snapshot)/i.test(basename(p))) return true;
  try { return statSync(p).size > 1024 * 1024; } catch { return false; }
}
const rel = (ctx, p) => { const r = toPosix(relative(ctx.root, p)); return r && !r.startsWith('..') ? r : toPosix(p); };

/** Reglas de git: rama protegida, push, remotos, worktree e historia. */
function checkGit(ctx, g) {
  const { t } = ctx;
  const sub = g.sub;
  const args = g.args ?? [];
  if (g.repo && !isInside(g.repo, ctx.root)) return { code: 'git-outside', reason: t('deny.gitOutside', { path: g.repo }) };
  if (sub === 'worktree') return { code: 'git-worktree', reason: t('deny.gitHistory', { sub }) };
  if (sub === 'remote' && /^(add|set-url|rename)$/.test(args[0] ?? '')) return { code: 'git-remote', reason: t('deny.gitRemote') };
  if (sub === 'config' && args.some((a) => /core\.hooksPath/.test(a))) return { code: 'hooks-path', reason: t('deny.hooksPath') };
  if (sub === 'switch' || sub === 'checkout') {
    const creating = args.includes('-c') || args.includes('-b');
    const target = args.find((a) => !a.startsWith('-') && a !== '--');
    if (!creating && target && ctx.protectedRe.test(target)) return { code: 'git-switch', reason: t('deny.gitSwitch', { branch: target, ai: ctx.ai, prefix: ctx.prefix }) };
  }
  if (sub === 'push') {
    const plain = args.filter((a) => !a.startsWith('-'));
    const [remote, refspec] = plain;
    if (remote && remote !== 'origin') return { code: 'git-push', reason: t('deny.gitPush', { args: args.join(' '), ai: ctx.ai, prefix: ctx.prefix }) };
    const branchRef = (refspec ?? '').split(':').pop();
    if (!branchRef) return { code: 'git-push', reason: t('deny.gitPush', { args: args.join(' '), ai: ctx.ai, prefix: ctx.prefix }) };
    if (branchRef === ctx.ai) {
      if (process.env.BOT_SECURE_CI !== '1') return { code: 'git-push-ai', reason: t('deny.gitPush', { args: args.join(' '), ai: ctx.ai, prefix: ctx.prefix }) };
    } else if (!branchRef.startsWith(ctx.prefix)) {
      return { code: 'git-push', reason: t('deny.gitPush', { args: args.join(' '), ai: ctx.ai, prefix: ctx.prefix }) };
    }
  }
  if (ctx.policy.mode === 'worktree') {
    if (GIT_HISTORY.test(sub)) return { code: 'git-history', reason: t('deny.gitHistory', { sub }) };
    if (sub === 'log' && args.some((a) => /^(-p|--patch|-S|-G|-U\d*)/.test(a))) return { code: 'git-history', reason: t('deny.gitHistory', { sub: 'log -p' }) };
  }
  return null;
}

/** Edit/Write/NotebookEdit: ruta sensible, guardas, contenido con secretos o supresiones. */
async function checkWrite(ctx, tool, ti) {
  const { t } = ctx;
  const cwd = ctx.input.cwd || ctx.root;
  const raw = ti.file_path ?? ti.notebook_path ?? ti.path ?? '';
  if (raw) {
    const p = resolvePath(raw, cwd, ctx.home);
    if (isGuardPath(p, ctx.root)) { markContaminated(ctx, 'write-guard'); return deny(ctx, t('deny.guardWrite', { path: rel(ctx, p) }), { code: 'write-guard', path: p }); }
    const c = classifyPath(p, { ws: ctx.root, home: ctx.home });
    if (c.sensitive) { markContaminated(ctx, `write:${c.reason}`); return deny(ctx, t('deny.sensitivePath', { path: rel(ctx, p), reason: c.reason }), { code: 'write-sensitive', path: p }); }
    if (!isInside(p, ctx.root)) { markContaminated(ctx, 'write-outside'); return deny(ctx, t('deny.outsideWs', { path: p, root: ctx.root }), { code: 'write-outside', path: p }); }
  }
  const content = writeContent(ti);
  if (!content) return 0;
  if (ALLOW_MARKER_RE.test(content)) return deny(ctx, t('deny.allowMarker'), { code: 'allow-marker' });
  const findings = await scanText(ctx, content, raw ? toPosix(raw) : 'edit');
  if (findings.length && atLeast(worst(findings), 'MEDIUM')) {
    markContaminated(ctx, 'write-secret');
    return deny(ctx, t('deny.secretContent', { rules: ruleList(findings), path: raw ? rel(ctx, resolvePath(raw, cwd, ctx.home)) : '(edición)' }), { code: 'write-secret' });
  }
  return 0;
}
function writeContent(ti) {
  const parts = [];
  if (typeof ti.content === 'string') parts.push(ti.content);
  if (typeof ti.new_string === 'string') parts.push(ti.new_string);
  if (typeof ti.new_source === 'string') parts.push(ti.new_source);
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (typeof e?.new_string === 'string') parts.push(e.new_string);
  return parts.join('\n');
}

/** Read/Grep/Glob (solo si guard.strictRead): realpath + catálogo sensible + confinamiento. */
async function checkRead(ctx, ti) {
  const { t } = ctx;
  const cwd = ctx.input.cwd || ctx.root;
  const raw = ti.file_path ?? ti.path ?? ti.notebook_path ?? '';
  if (!raw) return 0;
  const p = resolvePath(raw, cwd, ctx.home);
  const c = classifyPath(p, { ws: ctx.root, home: ctx.home });
  if (c.sensitive) { markContaminated(ctx, `read:${c.reason}`); return deny(ctx, t('deny.sensitiveRead', { path: rel(ctx, p), reason: c.reason }), { code: 'read-sensitive', path: p }); }
  if (!isInside(p, ctx.root)) { markContaminated(ctx, 'read-outside'); return deny(ctx, t('deny.outsideWs', { path: p, root: ctx.root }), { code: 'read-outside', path: p }); }
  return 0;
}

/** mcp__servidor__herramienta: solo los servidores de policy.mcp.allowed y con argumentos limpios. */
async function checkMcp(ctx, tool, ti) {
  const { t } = ctx;
  const server = tool.split('__')[1] ?? tool;
  const allowed = (ctx.policy.mcp?.allowed ?? []).map((s) => s.replace(/^mcp__/, ''));
  if (!allowed.includes(server)) return deny(ctx, t('deny.mcp', { server, allowed: allowed.join(', ') || '—' }), { code: 'mcp' });
  const findings = await scanText(ctx, JSON.stringify(ti ?? {}), `mcp/${server}`);
  if (findings.length && atLeast(worst(findings), 'MEDIUM')) {
    markContaminated(ctx, 'mcp-secret');
    return deny(ctx, t('deny.mcpContent', { rules: ruleList(findings) }), { code: 'mcp-secret' });
  }
  return 0;
}

/** PostToolUse: registra los archivos tocados (para el recordatorio de docs). */
async function onPostTool(ctx) {
  const ti = ctx.input.tool_input ?? {};
  const p = ti.file_path ?? ti.notebook_path ?? null;
  if (!p) return 0;
  const state = readState(ctx, 'touched.json', { files: [] }) ?? { files: [] };
  const r = toPosix(relative(ctx.root, resolvePath(p, ctx.input.cwd || ctx.root, ctx.home)));
  if (!state.files.includes(r)) state.files.push(r);
  writeState(ctx, 'touched.json', state);
  return 0;
}

/** Stop: recordatorio de documentación (una sola vez por sesión) si se tocó código y no docs. */
async function onStop(ctx) {
  if (!ctx.policy.guard?.docsReminder) return 0;
  if (existsSync(stateFile(ctx, 'docs-reminded'))) return 0;
  const files = readState(ctx, 'touched.json', { files: [] })?.files ?? [];
  const code = files.filter((f) => !/^docs\//.test(f) && !/\.(md|txt)$/i.test(f));
  const docs = files.filter((f) => /^docs\//.test(f) || /CLAUDE\.md$/.test(f));
  if (!code.length || docs.length) return 0;
  writeState(ctx, 'docs-reminded', String(Date.now()));
  return block(ctx, ctx.t('stop.docs', { count: code.length }));
}

/** SessionEnd: escanea el transcript por trozos (decodificando base64/hex/gzip) y abre INCIDENT si hace falta. */
async function onSessionEnd(ctx) {
  const tp = ctx.input.transcript_path ?? null;
  const findings = tp && existsSync(tp) ? await scanTranscript(ctx, tp) : [];
  const contaminated = isContaminated(ctx);
  if (!findings.length && !contaminated) return 0;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const p = join(ctx.root, '.bot-secure', `INCIDENT-${ts}.md`);
  const reason = readState(ctx, 'contaminated', null);
  const lines = [
    `# Incidente bot-secure — ${new Date().toISOString()}`, '',
    `- Sesión: ${ctx.input.session_id ?? '—'}`,
    `- Workspace: ${ctx.policy.project || ctx.root}`,
    `- Transcript analizado: ${tp ? 'sí' : 'no'}`,
    `- Intentos contra recursos sensibles: ${contaminated ? 'sí' : 'no'}${reason ? ` (${typeof reason === 'string' ? reason : reason.reason ?? ''})` : ''}`,
    `- Hallazgos en el transcript: ${findings.length}${findings.length ? ` (${ruleList(findings)})` : ''}`,
    '', '## Qué hacer', '',
    '1. Rota las credenciales afectadas (SLA 24 h).',
    '2. Ejecuta `bot-secure attest --rotation-id <id>` cuando termines.',
    '3. Revisa `.bot-secure/audit.log` para el detalle de los intentos (sin valores).',
    '', '> Este parte NUNCA contiene el valor de un secreto: solo regla, severidad y conteo.', '',
  ];
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, lines.join('\n')); } catch { /* best-effort */ }
  process.stderr.write(ctx.t('sessionEnd.incident', { path: toPosix(relative(ctx.root, p)) }) + '\n');
  audit(ctx, { decision: 'incident', code: 'session-end', findings: findings.length });
  return 0;
}

const CHUNK = 256 * 1024;
/** Lee el transcript por ventanas solapadas y escanea también el contenido base64/hex/gzip embebido. */
async function scanTranscript(ctx, path) {
  const out = [];
  let fd;
  try { fd = openSync(path, 'r'); } catch { return out; }
  try {
    const size = statSync(path).size;
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = 0;
    let carry = '';
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + buf.slice(0, n).toString('utf8');
      carry = text.slice(-2048); // solape para no partir un secreto
      out.push(...await scanText(ctx, text, 'transcript'));
      for (const decoded of decodeEmbedded(text)) out.push(...await scanText(ctx, decoded, 'transcript:decoded'));
      if (out.length > 200) break;
    }
  } catch { /* transcript ilegible: no es motivo de fallo */ } finally { try { closeSync(fd); } catch { /* ya cerrado */ } }
  return out;
}

/** Decodifica base64 / hex / gzip embebidos en un trozo de texto (máx. 20 candidatos). */
function decodeEmbedded(text) {
  const out = [];
  let n = 0;
  for (const m of String(text).matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    if (n++ > 20) break;
    try {
      const b = Buffer.from(m[0], 'base64');
      if (b.length < 8) continue;
      if (b[0] === 0x1f && b[1] === 0x8b) { try { out.push(gunzipSync(b).toString('utf8')); continue; } catch { /* no era gzip */ } }
      const s = b.toString('utf8');
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(s)) out.push(s);
    } catch { /* base64 inválido */ }
  }
  for (const m of String(text).matchAll(/(?:[0-9a-fA-F]{2}){20,}/g)) {
    if (n++ > 40) break;
    try {
      const s = Buffer.from(m[0], 'hex').toString('utf8');
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(s)) out.push(s);
    } catch { /* hex inválido */ }
  }
  return out;
}

/** ConfigChange: siempre bloquea (la configuración se cambia con `bot-secure policy compile`). */
async function onConfigChange(ctx) {
  markContaminated(ctx, 'config-change');
  return block(ctx, ctx.t('configChange'));
}

/** statusLine: una línea con rama por app, sandbox, nivel y modo. Caché de 5 s. */
async function onStatusLine(ctx) {
  const cached = readState(ctx, 'status.json');
  if (cached && Date.now() - (cached.at ?? 0) < 5000 && cached.line) { process.stdout.write(cached.line + '\n'); return 0; }
  const { t } = ctx;
  const parts = [];
  for (const app of appDirs(ctx)) {
    const br = branchOf(app.dir) ?? '?';
    const bad = ctx.protectedRe.test(br);
    parts.push(`${bad ? '⛔' : '✅'} ${app.name}:${br}${bad ? '' : isClean(app.dir) ? '' : '*'}`);
  }
  const local = readLocal(ctx.root);
  const sandbox = process.platform === 'win32' ? t('status.sandboxOff') : local.sandboxProbe === true ? t('status.sandboxOn') : local.sandboxProbe === false ? t('status.sandboxOff') : t('status.sandboxUnknown');
  parts.push(sandbox, t('status.level', { level: ctx.policy.level ?? 1 }), ctx.policy.mode);
  const line = parts.join(' | ');
  writeState(ctx, 'status.json', { at: Date.now(), line });
  process.stdout.write(line + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// Hooks de git (los invoca .githooks/run.mjs)
// ---------------------------------------------------------------------------

async function onGitPreCommit(ctx) {
  const { t } = ctx;
  const repo = ctx.input.cwd || ctx.root;
  const r = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: repo });
  const files = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const keys = files.filter((f) => /(^|\/)\.bot-secure\/(ai-keys|local\.json|audit\.log)/.test(f));
  if (keys.length) { process.stderr.write(t('git.preCommit.aiKeys', { files: keys.join(', ') }) + '\n'); return 1; }
  const bad = [];
  const markers = [];
  for (const f of files) {
    const show = git(['show', `:${f}`], { cwd: repo });
    if (show.status !== 0) continue;
    const content = show.stdout;
    if (ALLOW_MARKER_RE.test(content)) markers.push(f);
    const findings = await scanText(ctx, content, f);
    if (findings.length && atLeast(worst(findings), 'HIGH')) bad.push(f);
  }
  if (markers.length) { process.stderr.write(t('git.preCommit.allowMarker', { files: markers.join(', ') }) + '\n'); return 1; }
  if (bad.length) { process.stderr.write(t('git.preCommit.blocked', { count: bad.length, files: bad.join(', ') }) + '\n'); return 1; }
  return 0;
}

async function onGitPrePush(ctx) {
  const { t } = ctx;
  const repo = ctx.input.cwd || ctx.root;
  const lines = String(ctx.input.stdin ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const aiRepo = /-ai$/.test(basename(repo)) || /-ai$/.test(basename(ctx.root));
  for (const line of lines) {
    const [localRef, , remoteRef] = line.split(/\s+/);
    if (!remoteRef) continue;
    const remoteBranch = remoteRef.replace(/^refs\/heads\//, '');
    const localBranch = (localRef ?? '').replace(/^refs\/heads\//, '');
    const fromAi = aiRepo || /^ai/.test(localBranch);
    if (fromAi && ctx.protectedRe.test(remoteBranch)) { process.stderr.write(t('git.prePush.protected', { ref: remoteRef, prefix: ctx.prefix }) + '\n'); return 1; }
    if (remoteBranch === ctx.ai && process.env.BOT_SECURE_CI !== '1') { process.stderr.write(t('git.prePush.aiDev', { ai: ctx.ai }) + '\n'); return 1; }
  }
  return 0;
}

async function onGitPostCheckout(ctx) {
  const repo = ctx.input.cwd || ctx.root;
  const br = branchOf(repo);
  if (br && ctx.protectedRe.test(br)) process.stderr.write(ctx.t('git.postCheckout.protected', { branch: br, ai: ctx.ai }) + '\n');
  return 0;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const HANDLERS = {
  'session-start': onSessionStart,
  prompt: onPrompt,
  'pre-tool': onPreTool,
  'post-tool': onPostTool,
  stop: onStop,
  'session-end': onSessionEnd,
  'config-change': onConfigChange,
  statusline: onStatusLine,
  'git-pre-commit': onGitPreCommit,
  'git-pre-push': onGitPrePush,
  'git-post-checkout': onGitPostCheckout,
};

export const EVENTS = Object.keys(HANDLERS);

/**
 * Punto de entrada de la guarda.
 * @param {string} event uno de EVENTS
 * @param {string} [stdinJson] JSON del hook de Claude Code (o de .githooks/run.mjs)
 * @returns {Promise<number>} código de salida (0 permitir/ok, 2 bloquear)
 */
export async function main(event, stdinJson = '') {
  let ctx = null;
  try {
    const handler = HANDLERS[event];
    const input = parseInput(stdinJson);
    ctx = buildCtx(input, event);
    if (!handler) return block(ctx, ctx.t('unknownEvent', { event }));
    return await handler(ctx);
  } catch (e) {
    const t = ctx?.t ?? makeT('es');
    const msg = e?.noWorkspace ? e.message : t('fatal', { message: e?.message ?? String(e) });
    if (ctx?.warnMode) { process.stderr.write(t('warnMode', { message: msg }) + '\n'); return 0; }
    process.stderr.write(msg + '\n');
    return 2;
  }
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Solo se autoejecuta si ESTE archivo es el que node arrancó.
// Se comparan RUTAS REALES: en macOS /tmp y /var son enlaces simbólicos, así que comparar
// import.meta.url con argv[1] daba falso y el guard no arrancaba (fallo abierto: permitía todo).
function esPuntoDeEntrada() {
  if (!process.argv[1]) return false;
  try {
    const propio = realpathSync(fileURLToPath(import.meta.url));
    const arrancado = realpathSync(resolve(process.argv[1]));
    return propio === arrancado;
  } catch {
    return false;
  }
}
if (esPuntoDeEntrada()) {
  const event = process.argv[2] ?? 'pre-tool';
  main(event, readStdin()).then((code) => process.exit(typeof code === 'number' ? code : 2), () => process.exit(2));
}
