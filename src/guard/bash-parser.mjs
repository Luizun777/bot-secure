// Analizador de comandos Bash/sh para el guard: parte en segmentos, expande variables SIN ejecutar nada
// y clasifica cada segmento (lecturas, escrituras, red, volcado de entorno, git).
// Todo lo que no se puede analizar (heredocs, $( ), backticks, eval) se marca `unanalyzable`:
// el guard lo deniega en perfil sensitive (fail-closed).
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Binarios que leen contenido de archivos (familia de lectura). */
export const READ_BINS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'base64', 'base32', 'uuencode',
  'openssl', 'dd', 'cp', 'install', 'tar', 'zip', 'gzip', 'gunzip', 'bzip2', 'xz', 'zstd', '7z', 'unzip',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'awk', 'gawk', 'mawk', 'sed', 'perl', 'python', 'python3', 'py',
  'node', 'nodejs', 'ruby', 'php', 'jq', 'yq', 'xargs', 'sort', 'uniq', 'cut', 'tr', 'wc', 'diff', 'cmp', 'md5sum',
  'sha256sum', 'shasum', 'file', 'strings.exe', 'Get-Content', 'gc', 'type', 'Select-String', 'Format-Hex',
]);
/** Binarios que escriben archivos (el destino se toma del último argumento o de flags conocidas). */
export const WRITE_BINS = new Set(['cp', 'mv', 'install', 'tee', 'dd', 'ln', 'touch', 'truncate', 'chmod', 'chown', 'rm', 'rmdir', 'mkdir', 'Set-Content', 'Out-File', 'Add-Content']);
/** Binarios capaces de abrir red. */
export const NET_BINS = new Set([
  'curl', 'curl.exe', 'wget', 'wget.exe', 'nc', 'ncat', 'netcat', 'socat', 'rsync', 'ftp', 'sftp', 'lftp', 'telnet',
  'dig', 'nslookup', 'host', 'getent', 'ping', 'ping6', 'traceroute', 'ssh', 'scp', 'sshpass', 'aws', 'gcloud', 'az',
  'gh', 'glab', 'http', 'httpie', 'xh', 'axel', 'aria2c', 'Invoke-WebRequest', 'Invoke-RestMethod', 'iwr', 'irm', 'wsl',
]);
/** Intérpretes: `-e` / `-c` con código arbitrario (se inspecciona el código como texto). */
export const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3', 'py', 'ruby', 'perl', 'php', 'deno', 'bun', 'osascript', 'powershell', 'pwsh']);
/** Shells: `sh -c "…"` se vuelve a analizar como comando anidado. */
export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'busybox']);

const IP4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const ENV_DUMP_CODE = /process\.env|os\.environ|ENV\.to_h|\$ENV\b|%ENV\b|getenv\s*\(\s*\)|Get-ChildItem\s+env:/i;
const NET_CODE = /\bfetch\s*\(|https?\.request|urllib|http\.client|requests\.(get|post)|net\.(connect|Socket)|XMLHttpRequest|WebSocket|LWP|Net::HTTP/i;

const toPosix = (p) => p.split(sep).join('/');

/**
 * Resuelve una ruta a absoluta y canónica (expande `~`, relativas y symlinks existentes).
 * Nunca lanza: si no existe, resuelve el ancestro existente más profundo.
 * @param {string} p
 * @param {string} cwd
 * @param {string} [home]
 * @returns {string}
 */
export function resolvePath(p, cwd, home = homedir()) {
  let s = String(p);
  if (s === '~') s = home;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = join(home, s.slice(2));
  const abs = isAbsolute(s) ? s : resolve(cwd, s);
  try { return realpathSync(abs); } catch { /* no existe: se resuelve el ancestro */ }
  const rest = [basename(abs)];
  let dir = dirname(abs);
  for (let i = 0; i < 64 && dir && dir !== dirname(dir); i++) {
    try { return join(realpathSync(dir), ...rest); } catch { rest.unshift(basename(dir)); dir = dirname(dir); }
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Tokenizador
// ---------------------------------------------------------------------------

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '\n'];
const REDIRECTS = ['&>>', '2>>', '&>', '2>', '>>', '>|', '<<<', '>', '<'];

/**
 * Convierte la línea en tokens: palabras (trozos literales o variables), operadores y redirecciones.
 * @param {string} cmd
 * @returns {{tokens:object[], unanalyzable:string|null}}
 */
function tokenize(cmd) {
  const tokens = [];
  let unanalyzable = null;
  /** @type {{t:'lit'|'var', v?:string, name?:string, quoted?:boolean}[]|null} */
  let chunks = null;
  let lit = '';
  const pushLit = () => { if (lit) { chunks = chunks ?? []; chunks.push({ t: 'lit', v: lit }); lit = ''; } };
  const endWord = () => { pushLit(); if (chunks) { tokens.push({ type: 'word', chunks }); chunks = null; } };
  const s = String(cmd ?? '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { lit += s[i + 1] ?? ''; i += 2; continue; }
    if (c === "'") { // comillas simples: literal, sin expansión
      const end = s.indexOf("'", i + 1);
      if (end < 0) { lit += s.slice(i + 1); i = s.length; continue; }
      lit += s.slice(i + 1, end); i = end + 1; continue;
    }
    if (c === '"') { // comillas dobles: expande $VAR
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') { lit += s[i + 1] ?? ''; i += 2; continue; }
        if (s[i] === '$') { const r = readVar(s, i); if (r) { pushLit(); chunks = chunks ?? []; chunks.push({ t: 'var', name: r.name }); i = r.next; continue; } }
        if (s[i] === '`') { unanalyzable = unanalyzable ?? 'backtick'; }
        lit += s[i]; i++;
      }
      i++; // cierra la comilla
      if (lit === '' && !chunks) { chunks = []; } // "" es una palabra vacía real
      continue;
    }
    if (c === '`') { unanalyzable = unanalyzable ?? 'backtick'; lit += c; i++; continue; }
    if (c === '$' && s[i + 1] === '(') { unanalyzable = unanalyzable ?? 'command-substitution'; i = skipBalanced(s, i + 1); lit += ' '; continue; }
    if (c === '$') { const r = readVar(s, i); if (r) { pushLit(); chunks = chunks ?? []; chunks.push({ t: 'var', name: r.name }); i = r.next; continue; } lit += c; i++; continue; }
    if (c === '#' && lit === '' && !chunks && (i === 0 || /\s/.test(s[i - 1]))) { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    // heredoc: no analizable
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') { unanalyzable = unanalyzable ?? 'heredoc'; endWord(); tokens.push({ type: 'op', value: ';' }); i = s.length; continue; }
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    if (op) { endWord(); tokens.push({ type: 'op', value: op === '\n' ? ';' : op }); i += op.length; continue; }
    const rd = REDIRECTS.find((o) => s.startsWith(o, i));
    if (rd) { endWord(); tokens.push({ type: 'redirect', value: rd }); i += rd.length; continue; }
    lit += c; i++;
  }
  endWord();
  return { tokens, unanalyzable };
}

function readVar(s, i) {
  if (s[i + 1] === '{') {
    const end = s.indexOf('}', i + 2);
    if (end < 0) return null;
    const name = s.slice(i + 2, end).replace(/[:#%/^,!*@].*$/s, '');
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? { name, next: end + 1 } : null;
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i + 1));
  return m ? { name: m[0], next: i + 1 + m[0].length } : null;
}

function skipBalanced(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return s.length;
}

const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/**
 * Parsea un comando de shell en segmentos ejecutables, expandiendo `$VAR` con las asignaciones
 * previas del propio comando y `process.env` (nunca ejecuta nada).
 * @param {string} cmd
 * @param {{env?:object}} [opts]
 * @returns {{segments:{argv:string[], redirects:{op:string,target:string}[], assigns:object, unanalyzable:string|null, raw:string}[], vars:object, unanalyzable:string|null}}
 */
export function parseBash(cmd, { env = process.env } = {}) {
  const { tokens, unanalyzable } = tokenize(cmd);
  /** @type {Record<string,string>} */
  const vars = {};
  const expand = (chunks) => chunks.map((c) => (c.t === 'lit' ? c.v : vars[c.name] ?? env[c.name] ?? '')).join('');
  const segments = [];
  let cur = { argv: [], redirects: [], assigns: {}, unanalyzable: null, raw: '' };
  const flush = () => { if (cur.argv.length || cur.redirects.length || Object.keys(cur.assigns).length) segments.push(cur); cur = { argv: [], redirects: [], assigns: {}, unanalyzable: null, raw: '' }; };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'op') { flush(); continue; }
    if (tk.type === 'redirect') {
      const next = tokens[i + 1];
      if (next && next.type === 'word') { cur.redirects.push({ op: tk.value, target: expand(next.chunks) }); i++; }
      else cur.redirects.push({ op: tk.value, target: '' });
      continue;
    }
    const value = expand(tk.chunks);
    if (cur.argv.length === 0) {
      const m = ASSIGN_RE.exec(value);
      // Solo es asignación si el token original empieza con literal NOMBRE= (no viene de una variable).
      if (m && tk.chunks[0]?.t === 'lit' && tk.chunks[0].v.startsWith(m[1] + '=')) { vars[m[1]] = m[2]; cur.assigns[m[1]] = m[2]; continue; }
    }
    cur.argv.push(value);
  }
  flush();
  for (const s of segments) { s.unanalyzable = unanalyzable; s.raw = String(cmd ?? ''); }
  return { segments, vars, unanalyzable };
}

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

const stripExe = (b) => b.replace(/\.(exe|cmd|bat|ps1)$/i, '');
/** Nombre del binario sin ruta ni extensión de Windows. */
export function binName(argv0 = '') {
  const b = argv0.split(/[\\/]/).pop() || argv0;
  return stripExe(b);
}

/** Extrae host de una URL, de `user@host:ruta` o de un host pelado. null si no se puede. */
export function hostOf(token) {
  if (!token || token.startsWith('-')) return null;
  const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(token);
  if (url) return stripAuth(url[1]);
  const dev = /^\/dev\/(tcp|udp)\/([^/]+)/.exec(token);
  if (dev) return dev[2];
  if (/^[^@\s]+@[^@:\s]+:/.test(token)) return stripAuth(token.split('@')[1].split(':')[0]);
  if (/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(token) && (token.includes('.') || IP4.test(token))) return stripAuth(token);
  if (/^\[[0-9a-fA-F:]+\]/.test(token)) return token.slice(0, token.indexOf(']') + 1);
  return null;
}
function stripAuth(hostport) {
  let h = hostport;
  if (h.includes('@')) h = h.slice(h.lastIndexOf('@') + 1);
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0].replace(/\.$/, '').toLowerCase();
}

/** ¿El host es una IP literal (v4 o v6 entre corchetes)? */
export function isLiteralIp(host) {
  return !!host && (IP4.test(host) || /^\[[0-9a-fA-F:]+\]$/.test(host) || /^\d+$/.test(host));
}

/**
 * Clasifica un segmento ya parseado.
 * @param {{argv:string[], redirects:object[], assigns:object, unanalyzable:string|null, raw:string}} segment
 * @param {{cwd?:string, home?:string}} [ctx]
 * @returns {{bin:string, reads:string[], writes:string[], network:{binary:string|null, hosts:string[], resolveOverride:boolean, unresolved:boolean}, envDump:boolean, git:{sub:string, args:string[], repo:string|null}|null, interpreterCode:string|null, unanalyzable:string|null}}
 */
export function classify(segment, { cwd = process.cwd(), home = homedir(), _depth = 0 } = {}) {
  const ctxDepth = _depth;
  let nestedGit = null;
  let nestedUnanalyzable = null;
  const argv = segment.argv ?? [];
  const bin = binName(argv[0] ?? '');
  const args = argv.slice(1);
  const reads = new Set();
  const writes = new Set();
  const hosts = new Set();
  let networkBinary = null;
  let resolveOverride = false;
  let unresolved = false;
  let envDump = false;
  let interpreterCode = null;
  const abs = (p) => resolvePath(p, cwd, home);
  const isFlag = (a) => a.startsWith('-');

  // Redirecciones: > y >> escriben; < lee; /dev/tcp abre red.
  for (const r of segment.redirects ?? []) {
    if (!r.target) continue;
    const h = /^\/dev\/(tcp|udp)\//.test(r.target) ? hostOf(r.target) : null;
    if (h) { hosts.add(h); networkBinary = networkBinary ?? 'redirect'; continue; }
    if (r.op.includes('<')) reads.add(abs(r.target));
    else writes.add(abs(r.target));
  }

  // `env VAR=1 cmd` / `nohup cmd` / `sudo cmd`: se reclasifica el comando real.
  if ((bin === 'env' || bin === 'nohup' || bin === 'sudo' || bin === 'time' || bin === 'nice') && args.length) {
    const rest = args.filter((a) => !ASSIGN_RE.test(a) && !isFlag(a));
    if (rest.length) {
      const inner = classify({ ...segment, argv: rest, redirects: [] }, { cwd, home });
      for (const p of inner.reads) reads.add(p);
      for (const p of inner.writes) writes.add(p);
      for (const h of inner.network.hosts) hosts.add(h);
      networkBinary = networkBinary ?? inner.network.binary;
      resolveOverride = resolveOverride || inner.network.resolveOverride;
      unresolved = unresolved || inner.network.unresolved;
      envDump = envDump || inner.envDump;
      interpreterCode = interpreterCode ?? inner.interpreterCode;
      return pack({ bin: inner.bin, reads, writes, networkBinary, hosts, resolveOverride, unresolved, envDump, git: inner.git, interpreterCode, unanalyzable: segment.unanalyzable });
    }
  }

  // `sh -c "…"`: se analiza el comando anidado y se fusiona (profundidad limitada por _depth).
  if (SHELLS.has(bin) && (ctxDepth ?? 0) < 3) {
    const ci = args.findIndex((a) => a === '-c' || a === '-lc' || a === '-ic');
    const inner = ci >= 0 ? args[ci + 1] : null;
    if (inner) {
      const nested = parseBash(inner);
      for (const seg of nested.segments) {
        const r = classify(seg, { cwd, home, _depth: (ctxDepth ?? 0) + 1 });
        for (const p of r.reads) reads.add(p);
        for (const p of r.writes) writes.add(p);
        for (const h of r.network.hosts) hosts.add(h);
        networkBinary = networkBinary ?? r.network.binary;
        resolveOverride = resolveOverride || r.network.resolveOverride;
        unresolved = unresolved || r.network.unresolved;
        envDump = envDump || r.envDump;
        if (r.git && !nestedGit) nestedGit = r.git;
      }
      if (nested.unanalyzable) nestedUnanalyzable = nested.unanalyzable;
    }
  }

  // Volcado de entorno: `env`/`printenv`/`set` sin argumentos, export -p, declare -x, Get-ChildItem env:
  if ((bin === 'env' || bin === 'printenv') && args.filter((a) => !isFlag(a)).length === 0) envDump = true;
  if (bin === 'set' && args.length === 0) envDump = true;
  if ((bin === 'export' || bin === 'declare' || bin === 'typeset' || bin === 'compgen') && args.some((a) => /^-[pxev]/.test(a))) envDump = true;
  if (bin === 'export' && args.length === 0) envDump = true;
  if (/^(Get-ChildItem|gci|ls|dir)$/i.test(bin) && args.some((a) => /^env:?$/i.test(a))) envDump = true;

  // Intérpretes con código en línea.
  if (INTERPRETERS.has(bin)) {
    const idx = args.findIndex((a) => /^(-e|--eval|-c|--command|-E|-p|-Command)$/.test(a));
    if (idx >= 0 && args[idx + 1] !== undefined) interpreterCode = args[idx + 1];
    if (interpreterCode) {
      if (ENV_DUMP_CODE.test(interpreterCode)) envDump = true;
      if (NET_CODE.test(interpreterCode)) { networkBinary = networkBinary ?? bin; unresolved = true; }
      for (const m of interpreterCode.matchAll(/https?:\/\/[^\s'"`)]+/g)) { const h = hostOf(m[0]); if (h) hosts.add(h); }
      for (const m of interpreterCode.matchAll(/['"`]([^'"`\s]*\/[^'"`\s]*)['"`]/g)) { if (/\.(env|pem|key|p12|pfx|jks)\b|\.env$/.test(m[1]) || m[1].startsWith('/') || m[1].startsWith('~')) reads.add(abs(m[1])); }
    }
  }

  // Red.
  if (NET_BINS.has(bin) || NET_BINS.has(argv[0] ?? '')) {
    networkBinary = networkBinary ?? bin;
    let found = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (/^(--resolve|--connect-to|--proxy|--preproxy|-x)$/.test(a)) { resolveOverride = true; i++; continue; }
      if (/^--(resolve|connect-to|proxy)=/.test(a)) { resolveOverride = true; continue; }
      if (isFlag(a)) continue;
      const h = hostOf(a);
      if (h) { hosts.add(h); found = true; }
    }
    if (!found && !hosts.size) unresolved = true;
  }

  // Lecturas.
  if (READ_BINS.has(bin)) {
    for (const a of args) {
      if (isFlag(a) || a === '') continue;
      if (INTERPRETERS.has(bin) && interpreterCode !== null && a === interpreterCode) continue;
      if (/^[A-Za-z]+=/.test(a)) continue;
      if (bin === 'openssl' && /^(x509|rsa|enc|pkcs12|genrsa|s_client|dgst|base64)$/.test(a)) continue;
      if (/^(if|of|bs|count|skip|seek)=/.test(a)) { const v = a.split('=')[1]; if (v) (a.startsWith('of=') ? writes : reads).add(abs(v)); continue; }
      if (/^(sed|awk|gawk|mawk|perl|grep|egrep|fgrep|rg|jq|yq|tr|cut)$/.test(bin) && !reads.size && !/[\\/.]/.test(a)) continue; // primer arg = patrón
      reads.add(abs(a));
    }
  }
  // Escrituras (destino = último argumento no-flag para cp/mv/install/ln).
  if (WRITE_BINS.has(bin)) {
    const plain = args.filter((a) => !isFlag(a) && !/^[a-z]+=/.test(a));
    if (/^(cp|mv|install|ln|rsync)$/.test(bin) && plain.length >= 2) writes.add(abs(plain[plain.length - 1]));
    else if (/^(tee|touch|truncate|mkdir|rm|rmdir|chmod|chown)$/.test(bin)) for (const p of plain) writes.add(abs(p));
  }
  if (/^(Set-Content|Out-File|Add-Content)$/i.test(bin)) { const p = args.find((a) => !isFlag(a)); if (p) writes.add(abs(p)); }

  // git
  let gitInfo = null;
  if (bin === 'git') {
    let repo = null;
    let i = 0;
    while (i < args.length && isFlag(args[i])) {
      if (args[i] === '-C' || args[i] === '--git-dir' || args[i] === '--work-tree') { repo = args[i + 1] ?? null; i += 2; continue; }
      const eq = /^--(git-dir|work-tree)=(.*)$/.exec(args[i]);
      if (eq) { repo = eq[2]; i++; continue; }
      i++;
    }
    gitInfo = { sub: args[i] ?? '', args: args.slice(i + 1), repo: repo ? abs(repo) : null, all: args };
  }

  return pack({ bin, reads, writes, networkBinary, hosts, resolveOverride, unresolved, envDump, git: gitInfo ?? nestedGit, interpreterCode, unanalyzable: segment.unanalyzable ?? nestedUnanalyzable });
}

function pack({ bin, reads, writes, networkBinary, hosts, resolveOverride, unresolved, envDump, git, interpreterCode, unanalyzable }) {
  return {
    bin,
    reads: [...reads].map(toPosix),
    writes: [...writes].map(toPosix),
    network: { binary: networkBinary, hosts: [...hosts], resolveOverride, unresolved },
    envDump,
    git,
    interpreterCode,
    unanalyzable,
  };
}

/**
 * Atajo: parsea y clasifica todos los segmentos de un comando.
 * @param {string} cmd
 * @param {{cwd?:string, home?:string, env?:object}} [ctx]
 */
export function analyze(cmd, ctx = {}) {
  const { segments, unanalyzable } = parseBash(cmd, { env: ctx.env });
  return { unanalyzable, segments: segments.map((s) => ({ segment: s, ...classify(s, ctx) })) };
}
