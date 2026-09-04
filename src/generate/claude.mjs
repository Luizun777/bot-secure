// CLAUDE.md de la raíz (≤ 60 líneas) y CLAUDE.md corto por app (≤ 25 líneas).
import { artifact, renderTemplate } from './md-helpers.mjs';

export const CLAUDE_MAX_LINES = 60;
export const APP_CLAUDE_MAX_LINES = 25;

/** @param {import('./md-helpers.mjs').Artifact[]} */
/**
 * Genera CLAUDE.md raíz y uno por app.
 * @param {ReturnType<import('./md-helpers.mjs').buildView>} view
 * @returns {import('./md-helpers.mjs').Artifact[]}
 */
export function generateClaude(view) {
  const out = [artifact(['CLAUDE.md'], renderTemplate('md', 'CLAUDE.md', view))];
  for (const app of view.apps) {
    out.push(artifact([app.path, 'CLAUDE.md'], renderTemplate('md', 'CLAUDE-app.md', view, app)));
  }
  return out;
}
