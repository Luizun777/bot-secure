// Historia git: escanea TODOS los blobs del ODB (alcanzables o no) con cat-file --batch-all-objects.
// scanText se inyecta (no importa engine-core). Reachable = alcanzable desde refs (no reflog);
// el mapeo blob→(commit, path) usa además el reflog para dar contexto a objetos amendeados.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { git } from '../../lib/exec.mjs';
import { BotSecureError } from '../../lib/errors.mjs';

const LFS_MAGIC = 'version https://git-lfs.github.com/spec/';
const DEFAULT_MAX_BLOB = 5 * 1024 * 1024;

/** Ejecuta git o lanza BotSecureError con arreglo. */
function gitOrThrow(args, cwd) {
  const r = git(args, { cwd, timeout: 600_000 });
  if (r.status !== 0) {
    throw new BotSecureError('report.gitFailed', { vars: { cmd: args.join(' '), stderr: r.stderr.trim().slice(0, 300) }, fix: `cd "${cwd}" && git ${args.join(' ')}` });
  }
  return r.stdout;
}

/** Lista todos los blobs del ODB: [{oid, size}]. */
function listAllBlobs(cwd) {
  const out = gitOrThrow(['cat-file', '--batch-all-objects', '--batch-check', '--unordered'], cwd);
  const blobs = [];
  for (const line of out.split('\n')) {
    const [oid, type, size] = line.trim().split(/\s+/);
    if (type === 'blob') blobs.push({ oid, size: Number(size) });
  }
  return blobs;
}

/** Mapa oid → path de `rev-list --objects` (+ flags). Si falla (sin commits), mapa vacío. */
function objectPaths(cwd, extra = []) {
  const r = git(['rev-list', '--all', ...extra, '--objects'], { cwd, timeout: 600_000 });
  const map = new Map();
  if (r.status !== 0) return map;
  for (const line of r.stdout.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    map.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return map;
}

/** Mapa oid(blob) → {commit, path, time} con el commit que lo introdujo (refs + reflog). */
function blobCommits(cwd) {
  const r = git(['log', '--all', '--reflog', '--raw', '--no-renames', '--no-abbrev', '--format=commit %H %ct'], { cwd, timeout: 600_000 });
  const map = new Map();
  if (r.status !== 0) return map;
  let commit = null, time = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('commit ')) { const [, h, t] = line.split(' '); commit = h; time = Number(t); continue; }
    if (!line.startsWith(':')) continue;
    // :100644 100644 <old> <new> M\t<path>
    const tab = line.indexOf('\t');
    const meta = line.slice(1, tab).split(/\s+/);
    const newOid = meta[3];
    if (!newOid || /^0+$/.test(newOid)) continue;
    map.set(newOid, { commit, path: line.slice(tab + 1), time }); // el log va de nuevo a viejo: gana el más antiguo
  }
  return map;
}

/** ¿Binario? NUL en los primeros 8000 bytes sin patrón UTF-16. */
function isBinary(buf) {
  const head = buf.subarray(0, 8000);
  if (head[0] === 0xff && head[1] === 0xfe) return false;
  if (head[0] === 0xfe && head[1] === 0xff) return false;
  let nul = 0;
  for (const b of head) if (b === 0) nul++;
  if (nul === 0) return false;
  return nul < head.length * 0.3; // muchos NUL alternos = UTF-16 sin BOM; pocos NUL = binario
}

/** Decodifica el blob a texto (UTF-8 o UTF-16 con BOM). */
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8');
}

/**
 * Lee blobs con `git cat-file --batch` en streaming y llama `onBlob(oid, buffer)` por cada uno (secuencial).
 * @param {string} cwd
 * @param {string[]} oids
 * @param {(oid:string, buf:Buffer)=>Promise<void>} onBlob
 */
export async function readBlobs(cwd, oids, onBlob) {
  if (!oids.length) return;
  const child = spawn('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.on('error', () => { /* git terminó antes: se informa por exit */ });
  child.stdin.end(oids.join('\n') + '\n');
  let buf = Buffer.alloc(0);
  let header = null; // {oid, size}
  for await (const chunk of child.stdout) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (!header) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) break;
        const [oid, type, size] = buf.subarray(0, nl).toString().split(' ');
        buf = buf.subarray(nl + 1);
        if (type === 'missing' || !size) continue;
        header = { oid, size: Number(size) };
      }
      if (buf.length < header.size + 1) break;
      const content = buf.subarray(0, header.size);
      buf = buf.subarray(header.size + 1);
      const h = header; header = null;
      await onBlob(h.oid, Buffer.from(content));
    }
  }
  const code = await new Promise((res) => child.on('close', res));
  if (code !== 0) throw new BotSecureError('report.gitFailed', { vars: { cmd: 'cat-file --batch', stderr: stderr.trim().slice(0, 300) }, fix: `cd "${cwd}" && git fsck` });
}

/**
 * Escanea toda la historia (incluye objetos inalcanzables, stashes y commits amendeados).
 * @param {{root:string, hmacKey:Buffer, since?:string|Date, scanText:(text:string, opts:object)=>Promise<object[]>|object[],
 *   mode?:string, maxBlobBytes?:number}} opts
 * @returns {Promise<{findings:object[], skipped:{path:string, reason:string, size?:number}[], stats:object}>}
 */
export async function scanHistory({ root, hmacKey, since, scanText, mode = 'scan', maxBlobBytes = DEFAULT_MAX_BLOB }) {
  const cwd = resolve(root);
  const t0 = Date.now();
  if (typeof scanText !== 'function') throw new TypeError('scanHistory: scanText es obligatorio (inyección)');
  const probe = git(['rev-parse', '--git-dir'], { cwd });
  if (probe.status !== 0) throw new BotSecureError('report.notGitRepo', { vars: { root: cwd }, fix: `cd "${cwd}" && git init` });

  const blobs = listAllBlobs(cwd);
  const reachable = objectPaths(cwd);
  const reflogPaths = objectPaths(cwd, ['--reflog']);
  const commits = blobCommits(cwd);
  const sinceTs = since ? new Date(since).getTime() / 1000 : null;

  const skipped = [];
  const byFp = new Map();
  const stats = { blobs: blobs.length, scanned: 0, bytes: 0, unreachable: 0, ms: 0 };
  const toRead = [];
  const meta = new Map();

  for (const b of blobs) {
    const info = commits.get(b.oid);
    const path = info?.path ?? reflogPaths.get(b.oid) ?? reachable.get(b.oid) ?? `<blob>/${b.oid.slice(0, 12)}`;
    const isReachable = reachable.has(b.oid);
    if (!isReachable) stats.unreachable++;
    if (sinceTs && info && info.time < sinceTs && isReachable) continue; // viejos y alcanzables: fuera de rango
    if (b.size > maxBlobBytes) { skipped.push({ path, reason: 'size', size: b.size, commit: info?.commit ?? null }); continue; }
    meta.set(b.oid, { path, commit: info?.commit ?? null, reachable: isReachable, size: b.size });
    toRead.push(b.oid);
  }

  await readBlobs(cwd, toRead, async (oid, buf) => {
    const m = meta.get(oid);
    if (!m) return;
    stats.bytes += buf.length;
    if (buf.subarray(0, LFS_MAGIC.length).toString() === LFS_MAGIC) { skipped.push({ path: m.path, reason: 'lfs', size: m.size, commit: m.commit }); return; }
    if (isBinary(buf)) { skipped.push({ path: m.path, reason: 'binary', size: m.size, commit: m.commit }); return; }
    stats.scanned++;
    const found = await scanText(decode(buf), { path: m.path, mode, hmacKey, history: true });
    for (const f of found ?? []) mergeFinding(byFp, f, m, oid);
  });

  stats.ms = Date.now() - t0;
  return { findings: [...byFp.values()], skipped, stats };
}

/** Dedupe por fingerprint: el hallazgo conserva la primera ubicación y acumula occurrences. */
function mergeFinding(byFp, f, m, oid) {
  const occ = { file: m.path, line: f.line, commit: m.commit, blob: oid, reachable: m.reachable };
  const fp = f.fingerprint ?? f.id;
  const prev = byFp.get(fp);
  if (prev) {
    prev.occurrences.push(occ);
    if (m.reachable) prev.reachable = true; // basta una copia alcanzable para ser alcanzable
    return;
  }
  byFp.set(fp, { ...f, id: f.id ?? fp, file: f.file ?? m.path, reachable: m.reachable, commit: m.commit, blob: oid, occurrences: [occ] });
}
