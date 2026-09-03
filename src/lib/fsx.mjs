// Utilidades de archivos: JSON, escritura idempotente (.new si el humano editó), sha256.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const exists = (p) => existsSync(p);
export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export function readJson(p, fallback = undefined) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
export function writeJson(p, obj) { writeText(p, JSON.stringify(obj, null, 2) + '\n'); }
export function writeText(p, text) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
export function sha256(bufOrStr) { return createHash('sha256').update(bufOrStr).digest('hex'); }
export function sha256File(p) { return sha256(readFileSync(p)); }

/**
 * Escribe un archivo generado de forma idempotente.
 * - Si no existe: lo escribe.
 * - Si existe con el hash registrado en `known` (sha256 de la última generación): lo sobreescribe.
 * - Si existe y fue editado por un humano: escribe `<p>.new` y devuelve {action:'new'}.
 */
export function writeGenerated(p, content, { known = null, force = false } = {}) {
  if (!existsSync(p)) { writeText(p, content); return { path: p, action: 'created', sha256: sha256(content) }; }
  const current = readFileSync(p, 'utf8');
  if (current === content) return { path: p, action: 'unchanged', sha256: sha256(content) };
  if (force || (known && sha256(current) === known)) { writeText(p, content); return { path: p, action: 'updated', sha256: sha256(content) }; }
  writeText(p + '.new', content); return { path: p + '.new', action: 'new', sha256: sha256(content) };
}
