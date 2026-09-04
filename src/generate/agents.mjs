// AGENTS.md del workspace (≤ 80 líneas, universal) y subagentes .claude/agents/*.md.
import { artifact, renderTemplate } from './md-helpers.mjs';

export const AGENTS_MAX_LINES = 80;
export const SUBAGENTS = ['explorador', 'revisor-seguridad', 'docs-sync'];

/**
 * AGENTS.md: qué es el proyecto, mapa de apps, comandos, ramas, secretos, puntero a docs.
 * Usa view.appMap (de workspace.appMap si existe; si no, el bloque local).
 * @returns {import('./md-helpers.mjs').Artifact[]}
 */
export function generateAgentsMd(view) {
  return [artifact(['AGENTS.md'], renderTemplate('md', 'AGENTS.md', view))];
}

/** Subagentes de solo lectura (explorador, revisor-seguridad) y docs-sync (escribe solo docs/). */
export function generateSubagents(view) {
  return SUBAGENTS.map((name) => artifact(['.claude', 'agents', `${name}.md`], renderTemplate('claude', `agents/${name}.md`, view)));
}
