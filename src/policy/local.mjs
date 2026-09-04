// local.json (gitignored): datos de la máquina (ruta de node, SO, shell, sonda de sandbox, versión de Claude, cuenta).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const LOCAL_FILE = join('.bot-secure', 'local.json');

/**
 * @typedef {{node?:string, os?:string, shell?:string, sandboxProbe?:boolean|null, claudeVersion?:string|null,
 *            account?:{type:'org'|'personal'|'unknown', email?:string, org?:string}, updatedAt?:string}} LocalInfo
 */

/** @returns {LocalInfo} objeto vacío si no existe. */
export function readLocal(root) {
  try { return JSON.parse(readFileSync(join(root, LOCAL_FILE), 'utf8')); } catch { return {}; }
}

/**
 * Fusiona y escribe local.json. Nunca escribe valores de secretos.
 * @param {string} root
 * @param {LocalInfo} data
 * @returns {LocalInfo}
 */
export function writeLocal(root, data) {
  const merged = { ...readLocal(root), ...data, updatedAt: new Date().toISOString() };
  const p = join(root, LOCAL_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}
