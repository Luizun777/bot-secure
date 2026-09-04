// docs/*.md: INDEX, ARCHITECTURE, CONVENTIONS, TESTING, RUNBOOK, SECURITY, GLOSSARY, LESSONS.
import { artifact, renderTemplate } from './md-helpers.mjs';

export const DOCS = ['INDEX', 'ARCHITECTURE', 'CONVENTIONS', 'TESTING', 'RUNBOOK', 'SECURITY', 'GLOSSARY', 'LESSONS'];

/** @returns {import('./md-helpers.mjs').Artifact[]} */
export function generateDocs(view) {
  return DOCS.map((name) => artifact(['docs', `${name}.md`], renderTemplate('md', `docs/${name}.md`, view)));
}
