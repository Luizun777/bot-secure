// Historias de usuario: docs/user-stories/{INDEX,_PLANTILLA-HU,HU-0001-ejemplo}.md (Gherkin `# language: es`).
import { artifact, renderTemplate } from './md-helpers.mjs';

/** @returns {import('./md-helpers.mjs').Artifact[]} */
export function generateHu(view) {
  return ['INDEX', '_PLANTILLA-HU', 'HU-0001-ejemplo'].map((name) =>
    artifact(['docs', 'user-stories', `${name}.md`], renderTemplate('md', `docs/user-stories/${name}.md`, view)));
}

/**
 * Renderiza una HU nueva desde la plantilla (para el comando `hu` futuro o el skill /hu).
 * @param {object} view vista del workspace
 * @param {{id:string, titulo:string, epica?:string, owner?:string}} hu
 */
export function renderHu(view, hu) {
  return renderTemplate('md', 'docs/user-stories/_PLANTILLA-HU.md', view, {
    huId: hu.id, huTitulo: hu.titulo, huEpica: hu.epica || '', huOwner: hu.owner || '',
  });
}

/** Nombre de archivo HU-NNNN-slug.md a partir de número y título. */
export function huFileName(n, titulo) {
  const slug = String(titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `HU-${String(n).padStart(4, '0')}-${slug || 'sin-titulo'}.md`;
}
