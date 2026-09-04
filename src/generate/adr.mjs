// ADRs (MADR en español) en docs/decisions/: plantilla 0000 y decisiones 0001-0003 del bot.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { artifact, renderTemplate } from './md-helpers.mjs';

export const ADRS = ['0000-plantilla-adr', '0001-rama-ai-dev-y-placeholders', '0002-guarda-de-rama-bloquear-e-instruir', '0003-workspace-de-ia'];

/** @returns {import('./md-helpers.mjs').Artifact[]} */
export function generateAdrs(view) {
  return ADRS.map((name) => artifact(['docs', 'decisions', `${name}.md`], renderTemplate('md', `docs/decisions/${name}.md`, view)));
}

/** Siguiente número ADR libre en <root>/docs/decisions (0004 si solo están los generados). */
export function nextAdrNumber(root) {
  const dir = path.join(root, 'docs', 'decisions');
  if (!existsSync(dir)) return 1;
  const nums = readdirSync(dir).map((f) => /^(\d{4})-/.exec(f)?.[1]).filter(Boolean).map(Number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/** Nombre de archivo NNNN-slug.md. */
export function adrFileName(n, titulo) {
  const slug = String(titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `${String(n).padStart(4, '0')}-${slug || 'sin-titulo'}.md`;
}
